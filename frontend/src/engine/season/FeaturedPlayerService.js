// =============================================================================
// FeaturedPlayerService
// =============================================================================
// Picks the user team's "Featured Player" for a rolling 14-day window. Walks
// completed games whose `gameDate` falls in (sinceDate, untilDate], aggregates
// per-player box-score stats, scores each player, and returns the winner plus
// the per-game averages and a list of those games (so the home view can render
// a recent-performances strip directly on the Featured Player card).
//
// Pure function — no IndexedDB writes, no Pinia. Caller persists the result
// onto `campaign.settings.featuredPlayer`.
// =============================================================================

const DEFAULT_WINDOW_DAYS = 14

// Game-score weighting — a lightweight John Hollinger-style game score, tuned
// so the obvious all-around game (e.g. 30/10/10) clears the obvious volume
// scorer (35/3/2) but doesn't penalise a pure scorer too heavily.
function _gameScore(stats) {
  const pts = stats.points ?? 0
  const reb = stats.rebounds ?? 0
  const ast = stats.assists ?? 0
  const stl = stats.steals ?? 0
  const blk = stats.blocks ?? 0
  const to = stats.turnovers ?? 0
  return pts + reb * 0.8 + ast * 0.7 + stl * 1.5 + blk * 1.5 - to * 0.8
}

function _round1(n) {
  return Math.round(n * 10) / 10
}

function _pct(made, att) {
  if (!att || att <= 0) return 0
  return Math.round((made / att) * 1000) / 10
}

/**
 * Format a per-player aggregate into the shape the FP card / recent
 * performances strip expect.
 */
function _formatStats(agg) {
  const gp = agg.gamesPlayed
  if (gp <= 0) return null
  return {
    gamesPlayed: gp,
    ppg: _round1(agg.points / gp),
    rpg: _round1(agg.rebounds / gp),
    apg: _round1(agg.assists / gp),
    spg: _round1(agg.steals / gp),
    bpg: _round1(agg.blocks / gp),
    topg: _round1(agg.turnovers / gp),
    mpg: _round1(agg.minutes / gp),
    fgPct: _pct(agg.fgm, agg.fga),
    threePct: _pct(agg.fg3m, agg.fg3a),
    ftPct: _pct(agg.ftm, agg.fta),
    gameScore: _round1(agg.totalScore / gp),
  }
}

/**
 * Build the recent-games list for the Featured Player. Mirrors the shape
 * that `recent_performances` entries on a player record use (so the
 * existing PlayerDetailModal columns map 1:1).
 */
function _buildRecentGames(perPlayerGames, playerId) {
  const games = perPlayerGames.get(String(playerId)) || []
  return games
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(g => ({
      date: g.date,
      opponent: g.opponent,
      won: g.won,
      min: Math.round(g.minutes ?? 0),
      pts: g.points ?? 0,
      reb: g.rebounds ?? 0,
      ast: g.assists ?? 0,
      stl: g.steals ?? 0,
      blk: g.blocks ?? 0,
      to: g.turnovers ?? 0,
      fgm: g.fgm ?? 0,
      fga: g.fga ?? 0,
      tpm: g.fg3m ?? 0,
      tpa: g.fg3a ?? 0,
      ftm: g.ftm ?? 0,
      fta: g.fta ?? 0,
    }))
}

/**
 * Add `days` to a YYYY-MM-DD date and return the new YYYY-MM-DD string.
 * Local-time math — matches how the campaign cursor advances.
 */
function _addDays(dateStr, days) {
  if (!dateStr || dateStr.length < 10) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * Days between two YYYY-MM-DD strings (positive when `b > a`).
 */
function _daysBetween(a, b) {
  if (!a || !b) return Infinity
  const ms = new Date(b).getTime() - new Date(a).getTime()
  return Math.floor(ms / 86400000)
}

/**
 * Score every player on the user's roster across all completed user-team
 * games whose `gameDate` is in (windowStart, windowEnd]. Returns the best
 * player by per-game game-score (tie-broken by minutes), along with their
 * 14-day per-game averages and the games that contributed to the window.
 *
 * @param {Object}  params
 * @param {string}  params.userTeamId
 * @param {string}  params.windowStart  - YYYY-MM-DD (exclusive)
 * @param {string}  params.windowEnd    - YYYY-MM-DD (inclusive)
 * @param {Object}  params.seasonData   - must include `schedule` (with boxScore)
 * @param {Array}   params.roster       - user team roster (for name/position fallback)
 * @returns {{ playerId, playerName, position, teamAbbreviation, stats, recentGames, windowStart, windowEnd } | null}
 */
export function selectFeaturedPlayer({ userTeamId, windowStart, windowEnd, seasonData, roster = [] }) {
  if (!userTeamId || !windowStart || !windowEnd) return null
  if (!seasonData || !Array.isArray(seasonData.schedule)) return null

  const userTeamIdStr = String(userTeamId)

  // Aggregates keyed by playerId (string).
  const aggregates = new Map()
  // Per-player game list, used to build the recent-performances strip on the card.
  const perPlayerGames = new Map()

  for (const game of seasonData.schedule) {
    if (!game.isComplete || game.isCancelled) continue
    if (!game.boxScore) continue
    const gd = game.gameDate || ''
    if (gd <= windowStart) continue
    if (gd > windowEnd) continue

    const homeIsUser = String(game.homeTeamId) === userTeamIdStr
    const awayIsUser = String(game.awayTeamId) === userTeamIdStr
    if (!homeIsUser && !awayIsUser) continue

    const userSide = homeIsUser ? game.boxScore.home : game.boxScore.away
    if (!Array.isArray(userSide)) continue

    const userScore = homeIsUser ? game.homeScore : game.awayScore
    const oppScore = homeIsUser ? game.awayScore : game.homeScore
    const won = userScore > oppScore
    const opponent = homeIsUser ? game.awayTeamAbbreviation : game.homeTeamAbbreviation

    for (const entry of userSide) {
      const pid = String(entry.player_id ?? entry.playerId ?? '')
      if (!pid) continue
      // Skip DNPs — they shouldn't contribute to either the score or the gp count.
      const minutes = entry.minutes ?? 0
      if (minutes <= 0) continue

      const points = entry.points ?? 0
      const rebounds = entry.rebounds ?? 0
      const assists = entry.assists ?? 0
      const steals = entry.steals ?? 0
      const blocks = entry.blocks ?? 0
      const turnovers = entry.turnovers ?? 0
      const fgm = entry.fgm ?? 0
      const fga = entry.fga ?? 0
      const fg3m = entry.fg3m ?? 0
      const fg3a = entry.fg3a ?? 0
      const ftm = entry.ftm ?? 0
      const fta = entry.fta ?? 0

      let agg = aggregates.get(pid)
      if (!agg) {
        agg = {
          playerId: pid,
          playerName: entry.name ?? '',
          position: entry.position ?? '',
          gamesPlayed: 0,
          minutes: 0,
          points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0,
          fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
          totalScore: 0,
        }
        aggregates.set(pid, agg)
      }
      agg.gamesPlayed++
      agg.minutes += minutes
      agg.points += points
      agg.rebounds += rebounds
      agg.assists += assists
      agg.steals += steals
      agg.blocks += blocks
      agg.turnovers += turnovers
      agg.fgm += fgm
      agg.fga += fga
      agg.fg3m += fg3m
      agg.fg3a += fg3a
      agg.ftm += ftm
      agg.fta += fta
      agg.totalScore += _gameScore({
        points, rebounds, assists, steals, blocks, turnovers,
      })

      // Track the per-game line for the recent-performances strip
      if (!perPlayerGames.has(pid)) perPlayerGames.set(pid, [])
      perPlayerGames.get(pid).push({
        date: gd,
        opponent,
        won,
        minutes,
        points, rebounds, assists, steals, blocks, turnovers,
        fgm, fga, fg3m, fg3a, ftm, fta,
      })
    }
  }

  if (aggregates.size === 0) return null

  // Rank by per-game score (tie-break by minutes per game). Require at least
  // 1 game played — already enforced by skipping DNPs above.
  let best = null
  for (const agg of aggregates.values()) {
    const gp = agg.gamesPlayed
    if (gp <= 0) continue
    const score = agg.totalScore / gp
    const mpg = agg.minutes / gp
    if (!best || score > best.score || (score === best.score && mpg > best.mpg)) {
      best = { agg, score, mpg }
    }
  }
  if (!best) return null

  const winner = best.agg
  const rosterPlayer = (roster || []).find(p => String(p?.id) === winner.playerId)
  const stats = _formatStats(winner)
  const recentGames = _buildRecentGames(perPlayerGames, winner.playerId)

  return {
    playerId: winner.playerId,
    playerName: rosterPlayer?.name || winner.playerName,
    position: rosterPlayer?.position || winner.position,
    teamAbbreviation: rosterPlayer?.teamAbbreviation
      || rosterPlayer?.team_abbreviation
      || null,
    stats,
    recentGames,
    windowStart,
    windowEnd,
  }
}

/**
 * True when the campaign's stored Featured Player selection is stale (older
 * than the rolling window length) or missing entirely. The caller is
 * responsible for triggering a re-selection in that case.
 */
export function shouldRefreshFeaturedPlayer(campaign, currentDate, windowDays = DEFAULT_WINDOW_DAYS) {
  if (!campaign) return false
  if (!currentDate || currentDate.length < 10) return false
  const fp = campaign.settings?.featuredPlayer
  if (!fp || !fp.windowEnd) return true
  return _daysBetween(fp.windowEnd, currentDate) >= windowDays
}

/**
 * Helper: compute the rolling window bounds anchored to a cursor date.
 * `windowStart` is exclusive (the strict-greater-than check in `select…`),
 * `windowEnd` is inclusive (the games played on the cursor day count).
 */
export function computeFeaturedWindow(currentDate, windowDays = DEFAULT_WINDOW_DAYS) {
  if (!currentDate || currentDate.length < 10) return null
  return {
    windowStart: _addDays(currentDate, -windowDays),
    windowEnd: currentDate,
  }
}

export const FEATURED_WINDOW_DAYS = DEFAULT_WINDOW_DAYS
