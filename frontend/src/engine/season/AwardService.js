import { SeasonManager } from './SeasonManager'
import { T } from '../simulation/commentaryTemplate'

// ---------------------------------------------------------------------------
// AwardService
// ---------------------------------------------------------------------------
// Handles end-of-season award selection: MVP, Rookie of the Year, All-NBA,
// All-Rookie, All-Defense. Pure functions — no file I/O or database access.
// ---------------------------------------------------------------------------

const MVP_MIN_GAMES_PCT = 0.75
const ROTY_MIN_GAMES_PCT = 0.50
// Matches MVP_MIN_GAMES_PCT so a player can't qualify for an All-Defensive
// team while being filtered out of the All-NBA pool on games played alone.
const DEFENSE_MIN_GAMES_PCT = 0.75

// Full body template per All-League/All-Defense/All-Rookie tier — one
// complete sentence each (the tier word is part of the sentence, never a
// concatenated fragment). The `*_TPLS` naming is load-bearing:
// wl-i18n.config.js regex-extracts the quoted strings of these const blocks
// (plus direct quoted first args of T calls).
const TEAM_AWARD_BODY_TPLS = {
  first: 'Your player {player} has been selected to the {label} First Team.',
  second: 'Your player {player} has been selected to the {label} Second Team.',
  third: 'Your player {player} has been selected to the {label} Third Team.',
}

// Module-level exports so the live in-season MVP Race tab (League page)
// can score candidates with the exact same formula + min-games gate
// that the end-of-season MVP selection uses. Single source of truth:
// whoever is leading the in-season race on the final day matches the
// AwardService's actual MVP pick.
export { MVP_MIN_GAMES_PCT }

export function scoreMVPCandidate(stats, teamWinPct) {
  return AwardService._scoreMVP(stats, teamWinPct)
}

export class AwardService {

  // -----------------------------------------------------------------------
  // Main Entry Point
  // -----------------------------------------------------------------------

  /**
   * Process all end-of-season awards.
   *
   * @param {Object} params
   * @param {Object} params.seasonData - Current season data
   * @param {number} params.year - Season year
   * @param {Array} params.allPlayers - All player objects
   * @param {Array} params.teams - All team objects
   * @param {number|string} params.userTeamId - The user's team ID
   * @returns {Object} { mvp, rookieOfTheYear, dpoy, allNba, allRookie, allDefense, newsEvents }
   */
  static processSeasonAwards({ seasonData, year, allPlayers, teams, userTeamId }) {
    const allStats = SeasonManager.getAllPlayerStats(seasonData)
    const standings = SeasonManager.getStandings(seasonData)

    const teamWinPcts = AwardService._buildTeamWinPcts(standings)
    const playerLookup = AwardService._buildPlayerLookup(allPlayers, teams)

    // Find max games played
    let maxGames = 0
    for (const stats of Object.values(allStats)) {
      const gp = stats.gamesPlayed ?? 0
      if (gp > maxGames) maxGames = gp
    }

    // MVP
    const mvp = AwardService._selectMVP(allStats, playerLookup, teamWinPcts, maxGames)

    // Rookie of the Year
    const rookieOfTheYear = AwardService._selectROTY(allStats, playerLookup, teamWinPcts, maxGames, year)

    // All-NBA (3 teams, position-based)
    const allNba = AwardService._selectAllNBA(allStats, playerLookup, teamWinPcts, maxGames)

    // All-Rookie (2 teams, no position requirement)
    const allRookie = AwardService._selectAllRookie(allStats, playerLookup, teamWinPcts, maxGames, year)

    // All-Defense (2 teams, position-based)
    const allDefense = AwardService._selectAllDefense(allStats, playerLookup, teamWinPcts, maxGames)

    // Defensive Player of the Year (single winner)
    const dpoy = AwardService._selectDPOY(allStats, playerLookup, teamWinPcts, maxGames)

    // Finals MVP — computed during the playoffs (see PlayoffManager.
    // advanceWinnerToNextRound stamping `bracket.finalsMVP` when round 4
    // wraps). We just surface it here so `applyAwardsToPlayers` can bump
    // the player's `finalsMvpAwards` counter.
    const finalsMVPRaw = seasonData?.playoffBracket?.finalsMVP ?? null
    const finalsMVP = finalsMVPRaw
      ? {
          playerId: finalsMVPRaw.playerId ?? finalsMVPRaw.id ?? null,
          playerName: finalsMVPRaw.playerName ?? finalsMVPRaw.name ?? null,
          teamId: finalsMVPRaw.teamId ?? null,
          teamAbbreviation: finalsMVPRaw.teamAbbreviation ?? null,
        }
      : null

    // Determine the end-of-season date for news events
    const schedule = seasonData?.schedule || []
    const lastGame = schedule.filter(g => g.played).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
    const date = lastGame?.date || `${year + 1}-04-15`

    const newsEvents = AwardService._generateNewsEvents(
      { mvp, rookieOfTheYear, dpoy, allNba, allRookie, allDefense, finalsMVP },
      playerLookup, userTeamId, date
    )

    return { mvp, rookieOfTheYear, dpoy, allNba, allRookie, allDefense, finalsMVP, newsEvents }
  }

  // -----------------------------------------------------------------------
  // Team Win Percentages
  // -----------------------------------------------------------------------

  static _buildTeamWinPcts(standings) {
    const winPcts = {}
    for (const conf of ['east', 'west']) {
      for (const standing of (standings[conf] ?? [])) {
        const teamId = standing.teamId ?? null
        if (!teamId) continue
        const wins = standing.wins ?? 0
        const losses = standing.losses ?? 0
        const total = wins + losses
        winPcts[teamId] = total > 0 ? wins / total : 0
      }
    }
    return winPcts
  }

  // -----------------------------------------------------------------------
  // Player Lookup
  // -----------------------------------------------------------------------

  static _buildPlayerLookup(allPlayers, teams) {
    const lookup = {}
    const teamsById = {}
    const teamsByAbbr = {}
    for (const t of teams) {
      teamsById[t.id] = t
      teamsByAbbr[t.abbreviation] = t
    }

    for (const player of allPlayers) {
      const playerId = String(player.id ?? '')
      if (!playerId) continue

      const teamAbbr = player.teamAbbreviation ?? player.team_abbreviation ?? null
      const teamId = player.teamId ?? player.team_id ?? null

      if (teamAbbr === 'FA') continue

      let team = null
      if (teamId) team = teamsById[teamId]
      if (!team && teamAbbr) team = teamsByAbbr[teamAbbr]
      if (!team) continue

      const firstName = player.firstName ?? player.first_name ?? ''
      const lastName = player.lastName ?? player.last_name ?? ''

      lookup[playerId] = {
        playerId,
        playerName: `${firstName} ${lastName}`.trim(),
        position: player.position ?? 'SG',
        secondaryPosition: player.secondaryPosition ?? player.secondary_position ?? null,
        draftYear: player.draftYear ?? player.draft_year ?? null,
        careerSeasons: player.careerSeasons ?? player.career_seasons ?? null,
        teamId: team.id,
        teamAbbr: team.abbreviation,
        teamColor: team.primary_color ?? team.primaryColor ?? '#6B7280',
        conference: team.conference ?? 'east',
        overallRating: player.overallRating ?? player.overall_rating ?? 70,
        attributes: player.attributes ?? null,
      }
    }

    return lookup
  }

  // -----------------------------------------------------------------------
  // Position Classification
  // -----------------------------------------------------------------------

  static _classifyPosition(pos) {
    if (pos === 'PG' || pos === 'SG') return 'guard'
    if (pos === 'SF' || pos === 'PF') return 'forward'
    if (pos === 'C') return 'center'
    return 'forward'
  }

  // -----------------------------------------------------------------------
  // Scoring Functions
  // -----------------------------------------------------------------------

  static _scoreMVP(stats, teamWinPct) {
    let gp = stats.gamesPlayed ?? 1
    if (gp === 0) gp = 1

    const ppg = (stats.points ?? 0) / gp
    const rpg = (stats.rebounds ?? 0) / gp
    const apg = (stats.assists ?? 0) / gp
    const spg = (stats.steals ?? 0) / gp
    const bpg = (stats.blocks ?? 0) / gp
    const tovpg = (stats.turnovers ?? 0) / gp
    const fgPct = (stats.fieldGoalsAttempted ?? 0) > 0
      ? (stats.fieldGoalsMade ?? 0) / stats.fieldGoalsAttempted
      : 0

    return (ppg * 3.5) + (rpg * 2) + (apg * 3) + (spg * 2) + (bpg * 1.5)
           - (tovpg * 1.5) + (fgPct * 5) + (teamWinPct * 15)
  }

  static _scoreROTY(stats, teamWinPct) {
    let gp = stats.gamesPlayed ?? 1
    if (gp === 0) gp = 1

    const ppg = (stats.points ?? 0) / gp
    const rpg = (stats.rebounds ?? 0) / gp
    const apg = (stats.assists ?? 0) / gp
    const spg = (stats.steals ?? 0) / gp
    const bpg = (stats.blocks ?? 0) / gp
    const tovpg = (stats.turnovers ?? 0) / gp

    return (ppg * 3) + (rpg * 2) + (apg * 2.5) + (spg * 2) + (bpg * 1.5)
           - (tovpg * 0.5) + (teamWinPct * 5)
  }

  static _scoreDefense(stats, teamWinPct, attributes) {
    let gp = stats.gamesPlayed ?? 1
    if (gp === 0) gp = 1

    const spg = (stats.steals ?? 0) / gp
    const bpg = (stats.blocks ?? 0) / gp
    const drpg = (stats.defensiveRebounds ?? 0) / gp
    const rpg = (stats.rebounds ?? 0) / gp
    const pfpg = (stats.personalFouls ?? 0) / gp

    // Defensive attribute average
    let defAttrAvg = 70
    if (attributes?.defense) {
      const d = attributes.defense
      const vals = [d.perimeterDefense ?? d.perimeter_defense ?? 70,
                    d.interiorDefense ?? d.interior_defense ?? 70,
                    d.helpDefenseIQ ?? d.defensiveIQ ?? d.defensive_iq ?? 70]
      defAttrAvg = vals.reduce((a, b) => a + b, 0) / vals.length
    }

    return (spg * 5) + (bpg * 5) + (drpg * 1.5) + (rpg * 0.5)
           - (pfpg * 0.5) + (defAttrAvg / 10) + (teamWinPct * 5)
  }

  // -----------------------------------------------------------------------
  // Build Per-Game Stats Object
  // -----------------------------------------------------------------------

  static _buildPerGameStats(stats) {
    let gp = stats.gamesPlayed ?? 1
    if (gp === 0) gp = 1

    return {
      gp,
      ppg: Math.round(((stats.points ?? 0) / gp) * 10) / 10,
      rpg: Math.round(((stats.rebounds ?? 0) / gp) * 10) / 10,
      apg: Math.round(((stats.assists ?? 0) / gp) * 10) / 10,
      spg: Math.round(((stats.steals ?? 0) / gp) * 10) / 10,
      bpg: Math.round(((stats.blocks ?? 0) / gp) * 10) / 10,
      fgPct: (stats.fieldGoalsAttempted ?? 0) > 0
        ? Math.round(((stats.fieldGoalsMade ?? 0) / stats.fieldGoalsAttempted * 100) * 10) / 10
        : 0,
    }
  }

  // -----------------------------------------------------------------------
  // MVP Selection
  // -----------------------------------------------------------------------

  static _selectMVP(allStats, playerLookup, teamWinPcts, maxGames) {
    const minGames = Math.ceil(maxGames * MVP_MIN_GAMES_PCT)
    let bestPlayer = null
    let bestScore = -Infinity

    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0
      if (gp < minGames) continue

      const info = playerLookup[pid]
      if (!info) continue

      const teamWinPct = teamWinPcts[info.teamId] ?? 0
      const score = AwardService._scoreMVP(stats, teamWinPct)

      if (score > bestScore) {
        bestScore = score
        bestPlayer = {
          playerId: pid,
          playerName: info.playerName,
          teamAbbr: info.teamAbbr,
          teamColor: info.teamColor,
          position: info.position,
          score: Math.round(score * 10) / 10,
          stats: AwardService._buildPerGameStats(stats),
        }
      }
    }

    return bestPlayer
  }

  // -----------------------------------------------------------------------
  // Rookie of the Year Selection
  // -----------------------------------------------------------------------

  static _selectROTY(allStats, playerLookup, teamWinPcts, maxGames, year) {
    const rookies = AwardService._eligibleRookies(allStats, playerLookup, teamWinPcts, maxGames, year)
    // Prefer rookies who cleared the games floor; if none did, still name the
    // best-performing rookie so a real ROY is always crowned (never silently
    // empty when a rookie class exists — e.g. a low-minute season-1 class).
    return rookies.length ? rookies[0] : null
  }

  /**
   * Build the season's rookie candidate list, sorted best-first. A rookie is a
   * player whose `draftYear` matches this season OR whose `careerSeasons` is 0
   * (defense-in-depth for inconsistently-stamped data). Each entry is flagged
   * with `metGames`; the list is sorted by (metGames desc, score desc) so
   * higher-minute rookies win but the award never empties on the games gate.
   * @private
   */
  static _eligibleRookies(allStats, playerLookup, teamWinPcts, maxGames, year) {
    const minGames = Math.ceil(maxGames * ROTY_MIN_GAMES_PCT)
    const scored = []

    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const info = playerLookup[pid]
      if (!info) continue

      const isRookie = (info.draftYear != null && info.draftYear === year) || info.careerSeasons === 0
      if (!isRookie) continue

      const gp = stats.gamesPlayed ?? 0
      if (gp < 1) continue

      const teamWinPct = teamWinPcts[info.teamId] ?? 0
      const score = AwardService._scoreROTY(stats, teamWinPct)

      scored.push({
        playerId: pid,
        playerName: info.playerName,
        teamAbbr: info.teamAbbr,
        teamColor: info.teamColor,
        position: info.position,
        score: Math.round(score * 10) / 10,
        stats: AwardService._buildPerGameStats(stats),
        metGames: gp >= minGames,
      })
    }

    scored.sort((a, b) => (b.metGames - a.metGames) || (b.score - a.score))
    return scored
  }

  // -----------------------------------------------------------------------
  // Defensive Player of the Year Selection
  // -----------------------------------------------------------------------
  // Single best defender by the same `_scoreDefense` formula that powers the
  // All-Defensive Team — so DPOY and the All-Defense 1st Team align.

  static _selectDPOY(allStats, playerLookup, teamWinPcts, maxGames) {
    const minGames = Math.ceil(maxGames * DEFENSE_MIN_GAMES_PCT)
    let bestPlayer = null
    let bestScore = -Infinity

    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0
      if (gp < minGames) continue

      const info = playerLookup[pid]
      if (!info) continue

      const teamWinPct = teamWinPcts[info.teamId] ?? 0
      const score = AwardService._scoreDefense(stats, teamWinPct, info.attributes)

      if (score > bestScore) {
        bestScore = score
        bestPlayer = {
          playerId: pid,
          playerName: info.playerName,
          teamAbbr: info.teamAbbr,
          teamColor: info.teamColor,
          position: info.position,
          score: Math.round(score * 10) / 10,
          stats: AwardService._buildPerGameStats(stats),
        }
      }
    }

    return bestPlayer
  }

  // -----------------------------------------------------------------------
  // All-NBA Selection (3 teams, 2G/2F/1C each)
  // -----------------------------------------------------------------------

  static _selectAllNBA(allStats, playerLookup, teamWinPcts, maxGames) {
    const minGames = Math.ceil(maxGames * MVP_MIN_GAMES_PCT)

    // Score all eligible players
    const scored = []
    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0
      if (gp < minGames) continue

      const info = playerLookup[pid]
      if (!info) continue

      const teamWinPct = teamWinPcts[info.teamId] ?? 0
      const score = AwardService._scoreMVP(stats, teamWinPct)

      scored.push({
        playerId: pid,
        playerName: info.playerName,
        teamAbbr: info.teamAbbr,
        teamColor: info.teamColor,
        position: info.position,
        posClass: AwardService._classifyPosition(info.position),
        score: Math.round(score * 10) / 10,
        stats: AwardService._buildPerGameStats(stats),
      })
    }

    scored.sort((a, b) => b.score - a.score)

    const used = new Set()
    const result = { first: [], second: [], third: [] }

    for (const tier of ['first', 'second', 'third']) {
      result[tier] = AwardService._fillPositionSlots(scored, used)
    }

    return result
  }

  // -----------------------------------------------------------------------
  // All-Rookie Selection (2 teams, 5 each, no position requirement)
  // -----------------------------------------------------------------------

  static _selectAllRookie(allStats, playerLookup, teamWinPcts, maxGames, year) {
    // Same candidate list as ROY (games-floor preferred, then backfilled), so a
    // low-minute season-1 rookie class still fills the All-Rookie teams.
    const scored = AwardService._eligibleRookies(allStats, playerLookup, teamWinPcts, maxGames, year)
    if (scored.length === 0) return null

    return {
      first: scored.slice(0, 5),
      second: scored.slice(5, 10),
    }
  }

  // -----------------------------------------------------------------------
  // All-Defense Selection (2 teams, 2G/2F/1C each)
  // -----------------------------------------------------------------------

  static _selectAllDefense(allStats, playerLookup, teamWinPcts, maxGames) {
    const minGames = Math.ceil(maxGames * DEFENSE_MIN_GAMES_PCT)

    const scored = []
    for (const [playerId, stats] of Object.entries(allStats)) {
      const pid = String(playerId)
      const gp = stats.gamesPlayed ?? 0
      if (gp < minGames) continue

      const info = playerLookup[pid]
      if (!info) continue

      const teamWinPct = teamWinPcts[info.teamId] ?? 0
      const score = AwardService._scoreDefense(stats, teamWinPct, info.attributes)

      scored.push({
        playerId: pid,
        playerName: info.playerName,
        teamAbbr: info.teamAbbr,
        teamColor: info.teamColor,
        position: info.position,
        posClass: AwardService._classifyPosition(info.position),
        score: Math.round(score * 10) / 10,
        stats: AwardService._buildPerGameStats(stats),
      })
    }

    scored.sort((a, b) => b.score - a.score)

    const used = new Set()
    return {
      first: AwardService._fillPositionSlots(scored, used),
      second: AwardService._fillPositionSlots(scored, used),
    }
  }

  // -----------------------------------------------------------------------
  // Position-Slot Filler (2G, 2F, 1C)
  // -----------------------------------------------------------------------

  static _fillPositionSlots(sortedPlayers, usedIds) {
    const slots = { guard: 2, forward: 2, center: 1 }
    const selected = []

    for (const player of sortedPlayers) {
      if (usedIds.has(player.playerId)) continue
      const cls = player.posClass
      if (slots[cls] > 0) {
        selected.push(player)
        usedIds.add(player.playerId)
        slots[cls]--
      }
      if (selected.length === 5) break
    }

    return selected
  }

  // -----------------------------------------------------------------------
  // Apply Awards to Player Objects
  // -----------------------------------------------------------------------

  static applyAwardsToPlayers(allPlayers, awardResults, year = null) {
    const playerMap = Object.fromEntries(allPlayers.map(p => [String(p.id), p]))

    const pushAwardYear = (p, key, yr) => {
      if (yr == null) return
      if (!p.awards) p.awards = {}
      if (!Array.isArray(p.awards[key])) p.awards[key] = []
      p.awards[key].push(yr)
    }

    // MVP
    if (awardResults.mvp) {
      const p = playerMap[awardResults.mvp.playerId]
      if (p) {
        p.mvpAwards = (p.mvpAwards ?? p.mvp_awards ?? 0) + 1
        p.mvp_awards = p.mvpAwards
        pushAwardYear(p, 'mvp', year)
      }
    }

    // Defensive Player of the Year
    if (awardResults.dpoy) {
      const p = playerMap[awardResults.dpoy.playerId]
      if (p) {
        p.dpoyAwards = (p.dpoyAwards ?? p.dpoy_awards ?? 0) + 1
        p.dpoy_awards = p.dpoyAwards
        pushAwardYear(p, 'dpoy', year)
      }
    }

    // Finals MVP — sourced from `bracket.finalsMVP` via processSeasonAwards.
    // Pre-fix this was always null because the bracket field was never
    // populated; the counter on the player record stayed at 0 forever.
    if (awardResults.finalsMVP) {
      const p = playerMap[String(awardResults.finalsMVP.playerId)]
      if (p) {
        p.finalsMvpAwards = (p.finalsMvpAwards ?? p.finals_mvp_awards ?? 0) + 1
        p.finals_mvp_awards = p.finalsMvpAwards
        pushAwardYear(p, 'finals_mvp', year)
      }
    }

    // Rookie of the Year
    if (awardResults.rookieOfTheYear) {
      const p = playerMap[awardResults.rookieOfTheYear.playerId]
      if (p) {
        p.rookieOfTheYear = (p.rookieOfTheYear ?? p.rookie_of_the_year ?? 0) + 1
        p.rookie_of_the_year = p.rookieOfTheYear
        pushAwardYear(p, 'rookie_of_the_year', year)
      }
    }

    // All-NBA
    if (awardResults.allNba) {
      for (const tier of ['first', 'second', 'third']) {
        for (const entry of (awardResults.allNba[tier] || [])) {
          const p = playerMap[entry.playerId]
          if (p) {
            p.allNbaSelections = (p.allNbaSelections ?? p.all_nba_selections ?? 0) + 1
            p.all_nba_selections = p.allNbaSelections
            if (tier === 'first') {
              p.allNbaFirstTeam = (p.allNbaFirstTeam ?? p.all_nba_first_team ?? 0) + 1
              p.all_nba_first_team = p.allNbaFirstTeam
            }
            pushAwardYear(p, `all_nba_${tier}`, year)
          }
        }
      }
    }

    // All-Rookie
    if (awardResults.allRookie) {
      for (const tier of ['first', 'second']) {
        for (const entry of (awardResults.allRookie[tier] || [])) {
          const p = playerMap[entry.playerId]
          if (p) {
            p.allRookieTeam = (p.allRookieTeam ?? p.all_rookie_team ?? 0) + 1
            p.all_rookie_team = p.allRookieTeam
            pushAwardYear(p, `all_rookie_${tier}`, year)
          }
        }
      }
    }

    // All-Defense
    if (awardResults.allDefense) {
      for (const tier of ['first', 'second']) {
        for (const entry of (awardResults.allDefense[tier] || [])) {
          const p = playerMap[entry.playerId]
          if (p) {
            p.allDefensiveTeam = (p.allDefensiveTeam ?? p.all_defensive_team ?? 0) + 1
            p.all_defensive_team = p.allDefensiveTeam
            pushAwardYear(p, `all_defense_${tier}`, year)
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // News Generation
  // -----------------------------------------------------------------------
  // Headlines/bodies are built via T() (commentaryTemplate.js): each event
  // carries `headline_tpl`/`headline_params` and `body_tpl`/`body_params`
  // alongside the unchanged English `headline`/`body` so the UI can translate
  // via $tDynamic(tpl, params) with fallback to the stored English string.

  static _generateNewsEvents(awards, playerLookup, userTeamId, date) {
    const events = []

    // Spread a T() result pair into the additive template fields.
    const tplFields = (headline, body) => ({
      headline_tpl: headline.tpl,
      headline_params: headline.params,
      body_tpl: body.tpl,
      body_params: body.params,
    })

    // MVP announcement
    if (awards.mvp) {
      const headline = T('{player} wins League MVP', { player: awards.mvp.playerName })
      const body = T('{player} ({team}) has been named the League MVP, averaging {ppg} PPG, {rpg} RPG, and {apg} APG.', {
        player: awards.mvp.playerName, team: awards.mvp.teamAbbr,
        ppg: awards.mvp.stats.ppg, rpg: awards.mvp.stats.rpg, apg: awards.mvp.stats.apg,
      })
      events.push({
        eventType: 'award',
        headline: headline.text,
        body: body.text,
        ...tplFields(headline, body),
        gameDate: date,
      })
    }

    // DPOY announcement
    if (awards.dpoy) {
      const headline = T('{player} wins Defensive Player of the Year', { player: awards.dpoy.playerName })
      const body = T('{player} ({team}) has been named Defensive Player of the Year, averaging {spg} SPG, {bpg} BPG, and {rpg} RPG.', {
        player: awards.dpoy.playerName, team: awards.dpoy.teamAbbr,
        spg: awards.dpoy.stats.spg, bpg: awards.dpoy.stats.bpg, rpg: awards.dpoy.stats.rpg,
      })
      events.push({
        eventType: 'award',
        headline: headline.text,
        body: body.text,
        ...tplFields(headline, body),
        gameDate: date,
      })
    }

    // ROTY announcement
    if (awards.rookieOfTheYear) {
      const headline = T('{player} named Rookie of the Year', { player: awards.rookieOfTheYear.playerName })
      const body = T('{player} ({team}) has been named Rookie of the Year, averaging {ppg} PPG, {rpg} RPG, and {apg} APG.', {
        player: awards.rookieOfTheYear.playerName, team: awards.rookieOfTheYear.teamAbbr,
        ppg: awards.rookieOfTheYear.stats.ppg, rpg: awards.rookieOfTheYear.stats.rpg, apg: awards.rookieOfTheYear.stats.apg,
      })
      events.push({
        eventType: 'award',
        headline: headline.text,
        body: body.text,
        ...tplFields(headline, body),
        gameDate: date,
      })
    }

    // All-NBA 1st Team
    if (awards.allNba?.first?.length > 0) {
      const names = awards.allNba.first.map(p => p.playerName).join(', ')
      const headline = T('All-League teams announced')
      const body = T('All-League First Team: {names}.', { names })
      events.push({
        eventType: 'award',
        headline: headline.text,
        body: body.text,
        ...tplFields(headline, body),
        gameDate: date,
      })
    }

    // User team player individual news
    const userTeamIdStr = String(userTeamId)
    const notified = new Set()

    // Check if MVP is on user team
    if (awards.mvp) {
      const info = playerLookup[awards.mvp.playerId]
      if (info && String(info.teamId) === userTeamIdStr) {
        notified.add(awards.mvp.playerId)
        const headline = T('{player} wins League MVP!', { player: awards.mvp.playerName })
        const body = T('Your player {player} has been named the League MVP.', { player: awards.mvp.playerName })
        events.push({
          eventType: 'award',
          headline: headline.text,
          body: body.text,
          ...tplFields(headline, body),
          playerId: awards.mvp.playerId,
          teamId: userTeamId,
          gameDate: date,
        })
      }
    }

    // Check if DPOY is on user team
    if (awards.dpoy) {
      const info = playerLookup[awards.dpoy.playerId]
      if (info && String(info.teamId) === userTeamIdStr) {
        notified.add(awards.dpoy.playerId)
        const headline = T('{player} wins Defensive Player of the Year!', { player: awards.dpoy.playerName })
        const body = T('Your player {player} has been named Defensive Player of the Year.', { player: awards.dpoy.playerName })
        events.push({
          eventType: 'award',
          headline: headline.text,
          body: body.text,
          ...tplFields(headline, body),
          playerId: awards.dpoy.playerId,
          teamId: userTeamId,
          gameDate: date,
        })
      }
    }

    // Check if ROTY is on user team
    if (awards.rookieOfTheYear) {
      const info = playerLookup[awards.rookieOfTheYear.playerId]
      if (info && String(info.teamId) === userTeamIdStr) {
        notified.add(awards.rookieOfTheYear.playerId)
        const headline = T('{player} wins Rookie of the Year!', { player: awards.rookieOfTheYear.playerName })
        const body = T('Your player {player} has been named Rookie of the Year.', { player: awards.rookieOfTheYear.playerName })
        events.push({
          eventType: 'award',
          headline: headline.text,
          body: body.text,
          ...tplFields(headline, body),
          playerId: awards.rookieOfTheYear.playerId,
          teamId: userTeamId,
          gameDate: date,
        })
      }
    }

    // Check All-NBA, All-Defense, All-Rookie for user team players
    const teamAwards = [
      { key: 'allNba', label: 'All-League' },
      { key: 'allDefense', label: 'All-Defense' },
      { key: 'allRookie', label: 'All-Rookie' },
    ]

    for (const { key, label } of teamAwards) {
      const award = awards[key]
      if (!award) continue
      for (const tier of ['first', 'second', 'third']) {
        for (const entry of (award[tier] || [])) {
          if (notified.has(entry.playerId)) continue
          const info = playerLookup[entry.playerId]
          if (info && String(info.teamId) === userTeamIdStr) {
            notified.add(entry.playerId)
            const headline = T('{player} named to {label} Team', { player: entry.playerName, label })
            const body = T(TEAM_AWARD_BODY_TPLS[tier], { player: entry.playerName, label })
            events.push({
              eventType: 'award',
              headline: headline.text,
              body: body.text,
              ...tplFields(headline, body),
              playerId: entry.playerId,
              teamId: userTeamId,
              gameDate: date,
            })
          }
        }
      }
    }

    return events
  }
}

export default AwardService
