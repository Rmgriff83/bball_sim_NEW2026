// =============================================================================
// DraftLotteryService.js
// =============================================================================
// NBA 2019+ draft lottery rules. The bottom 14 teams by record enter the
// lottery; the top 4 picks are drawn from a weighted urn that flattens odds
// for the worst 3 teams (all 14.0% at #1). Remaining lottery picks (5-14)
// fill in by reverse standings of the teams who weren't drawn for a top-4
// slot. Picks 15-30 stay deterministic reverse standings of the playoff
// teams (worst playoff team picks 15th).
// =============================================================================

// Worst → 14th-worst, percentage odds of winning the #1 pick.
// Sums to 100.0. After each top-4 draw, the remaining team odds are
// renormalized over the survivors for the next draw.
const NBA_LOTTERY_ODDS = [
  14.0, // worst team (1st in lottery order)
  14.0, // 2nd worst
  14.0, // 3rd worst — flattened with the other two for the 2019+ rules
  12.5, // 4th
  10.5, // 5th
  9.0,  // 6th
  7.5,  // 7th
  6.0,  // 8th
  4.5,  // 9th
  3.0,  // 10th
  2.0,  // 11th
  1.5,  // 12th
  1.0,  // 13th
  0.5,  // 14th
]

const LOTTERY_SIZE = 14
const TOP_PICKS_DRAWN = 4
const LEAGUE_SIZE = 30

/**
 * Run the rookie draft lottery for the current offseason.
 *
 * Determines the actual draft order for picks 1-30 using NBA 2019+ rules.
 * The returned `actualOrder` is a 30-slot array each carrying the team id
 * that picks at that slot, the team's pre-lottery projected pick (reverse
 * standings position), and the delta (positive = moved up, negative = moved
 * down). Playoff team slots (15-30) always have delta = 0.
 *
 * @param {Array}  teams      All 30 team objects
 * @param {Object} standings  { east: [...], west: [...] } final standings
 * @param {number} gameYear   The draft year this lottery is for
 * @returns {Object} { actualOrder, runAt, year }
 */
export function runDraftLottery(teams, standings, gameYear) {
  // 1. Compute pre-lottery reverse-standings ranking (worst → best).
  //    Mirrors DraftOrderService.buildRookieDraftOrder sort logic exactly
  //    so projected positions line up with what users saw before the lottery.
  const allStandings = [
    ...(standings.east || []),
    ...(standings.west || []),
  ]
  const teamRecords = teams.map(team => {
    const standing = allStandings.find(s =>
      (s.teamId ?? s.team_id) === team.id ||
      s.teamAbbreviation === team.abbreviation
    )
    const pointDiff = standing
      ? (standing.pointDifferential ?? standing.pointDiff ?? ((standing.pointsFor ?? 0) - (standing.pointsAgainst ?? 0)))
      : 0
    return {
      team,
      wins: standing?.wins ?? 0,
      losses: standing?.losses ?? 0,
      pointDiff,
    }
  })
  teamRecords.sort((a, b) => {
    if (a.wins !== b.wins) return a.wins - b.wins
    return a.pointDiff - b.pointDiff
  })

  // Snapshot each team's projected pick (1-indexed) by its position in
  // reverse standings. Used later to compute the delta after the lottery.
  const projectedByTeamId = new Map()
  teamRecords.forEach((rec, idx) => {
    projectedByTeamId.set(rec.team.id, idx + 1)
  })

  // 2. Split into lottery pool (bottom 14) and playoff pool (top 16).
  const lotteryPool = teamRecords.slice(0, LOTTERY_SIZE).map(r => r.team)
  const playoffPool = teamRecords.slice(LOTTERY_SIZE).map(r => r.team)

  // 3. Draw picks 1-4 via weighted urn. Each draw renormalizes the
  //    remaining teams' odds. Worst team's index in the lottery pool
  //    keeps its NBA_LOTTERY_ODDS[i] weight even after another team
  //    is drawn — real lottery just removes the winner and re-rolls.
  const remaining = lotteryPool.map((team, idx) => ({
    team,
    odds: NBA_LOTTERY_ODDS[idx],
  }))
  const topFourTeams = []
  for (let pick = 0; pick < TOP_PICKS_DRAWN; pick++) {
    const winnerIdx = _weightedDraw(remaining)
    topFourTeams.push(remaining[winnerIdx].team)
    remaining.splice(winnerIdx, 1)
  }

  // 4. Picks 5-14 = remaining lottery teams in their original reverse-
  //    standings order (the worst surviving team picks 5th).
  const lotteryFill = remaining.map(r => r.team)

  // 5. Picks 15-30 = playoff teams in reverse standings — unchanged.
  const playoffOrder = playoffPool

  // 6. Stitch into the final 30-slot order.
  const finalTeamOrder = [...topFourTeams, ...lotteryFill, ...playoffOrder]
  const actualOrder = finalTeamOrder.map((team, idx) => {
    const actualPick = idx + 1
    const projectedPick = projectedByTeamId.get(team.id) ?? actualPick
    return {
      teamId: team.id,
      teamAbbr: team.abbreviation,
      projectedPick,
      actualPick,
      // Positive delta = team moved UP (from a higher pick number to a
      // lower one — better outcome). Negative = moved down.
      delta: projectedPick - actualPick,
      isLotteryTeam: actualPick <= LOTTERY_SIZE,
    }
  })

  return {
    actualOrder,
    runAt: new Date().toISOString(),
    year: gameYear,
  }
}

/**
 * Build a Map from team ABBREVIATION to that team's actual lottery position
 * (1-30). Used by buildRookieDraftOrder to honor the lottery result.
 *
 * Keyed by abbreviation rather than `teamId` on purpose: a team object's `id`
 * can differ in type/representation between the persisted lottery snapshot and
 * the live team list a consumer passes in (number vs string, stale vs fresh).
 * When that happens an id-keyed lookup silently misses for every team and the
 * board "freezes" at plain reverse standings with no movement. Abbreviations
 * are stable strings present everywhere (teams, standings, the lottery result),
 * so they match reliably.
 *
 * @param {Object} lotteryResult - The object returned by runDraftLottery
 * @returns {Map<string, number>} teamAbbr → actual pick number (1-indexed)
 */
export function lotteryPositionMap(lotteryResult) {
  const map = new Map()
  if (!lotteryResult?.actualOrder) return map
  for (const slot of lotteryResult.actualOrder) {
    if (slot.teamAbbr != null) map.set(slot.teamAbbr, slot.actualPick)
  }
  return map
}

/**
 * Pick a winner from a [{ team, odds }] array, weighted by `odds`. Returns
 * the winning entry's index. Total odds don't need to sum to 100 — the
 * function normalizes by summing and rolling against the total.
 */
function _weightedDraw(entries) {
  const total = entries.reduce((s, e) => s + e.odds, 0)
  if (total <= 0) return 0
  let roll = Math.random() * total
  for (let i = 0; i < entries.length; i++) {
    roll -= entries[i].odds
    if (roll <= 0) return i
  }
  return entries.length - 1
}

// Re-exports for tests / external probes if ever needed.
export const _internals = {
  NBA_LOTTERY_ODDS,
  LOTTERY_SIZE,
  TOP_PICKS_DRAWN,
  LEAGUE_SIZE,
}
