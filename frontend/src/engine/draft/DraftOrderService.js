// =============================================================================
// DraftOrderService.js
// =============================================================================
// Builds 60-pick rookie draft order from standings and traded draft picks.
// =============================================================================

import { lotteryPositionMap } from './DraftLotteryService'

/**
 * Build the full 60-pick rookie draft order based on standings.
 * Worst team picks first; traded picks go to the current owner.
 *
 * When `lotteryResult` is supplied (from runDraftLottery), the round-1
 * team order is taken from the lottery result instead of reverse standings
 * — this is how the NBA-style lottery randomizes picks 1-14 while leaving
 * picks 15-30 in reverse standings. Round 2 stays pure reverse standings
 * since real NBA lottery only affects round 1.
 *
 * @param {Array} teams - All 30 teams
 * @param {Object} standings - { east: [...], west: [...] }
 * @param {number} gameYear - The draft year
 * @param {Object|null} [lotteryResult] - Optional output of runDraftLottery
 * @returns {Array} 60-slot array matching draft store format
 */
export function buildRookieDraftOrder(teams, standings, gameYear, lotteryResult = null) {
  // 1. Combine all standings into one list
  const allStandings = [
    ...(standings.east || []),
    ...(standings.west || []),
  ]

  // 2. Map standings to teams with win/loss data
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

  // 3. Sort by wins ascending (worst first), tiebreak by point differential ascending
  teamRecords.sort((a, b) => {
    if (a.wins !== b.wins) return a.wins - b.wins
    return a.pointDiff - b.pointDiff
  })

  // 3b. Lottery reorder for round 1. The lottery moves teams within the
  // 30-slot round-1 order; round 2 stays in reverse standings unchanged.
  // We sort a copy of teamRecords using the lottery's actualPick as the
  // primary key — teams not present in the lottery (shouldn't happen for
  // a properly constructed result, but defensive) fall back to their
  // reverse-standings index. Round 2 still walks teamRecords in standings
  // order, so we keep the original array intact.
  const round1Order = (() => {
    if (!lotteryResult?.actualOrder) return teamRecords
    // Keyed by abbreviation (stable) — see lotteryPositionMap. An id-keyed
    // lookup can miss for every team and silently fall back to reverse
    // standings (the "lottery did nothing" bug).
    const lotteryMap = lotteryPositionMap(lotteryResult)
    return [...teamRecords].sort((a, b) => {
      const aPick = lotteryMap.get(a.team.abbreviation) ?? 999
      const bPick = lotteryMap.get(b.team.abbreviation) ?? 999
      return aPick - bPick
    })
  })()

  // 4. Build draft order: for each standing position, look up who owns the pick
  const draftOrder = []
  let pickNumber = 1

  for (let round = 1; round <= 2; round++) {
    // Round 1 follows the lottery order (when present); round 2 follows
    // the unmodified reverse-standings order.
    const orderForRound = round === 1 ? round1Order : teamRecords
    for (let i = 0; i < orderForRound.length; i++) {
      const { team: originalTeam } = orderForRound[i]

      // Find the draft pick for this original team + year + round
      const pick = findDraftPick(teams, originalTeam.abbreviation, gameYear, round)

      if (pick) {
        // The currentOwnerId determines who actually drafts
        const ownerTeam = teams.find(t => t.id === pick.currentOwnerId) || originalTeam

        draftOrder.push({
          round,
          pick: pickNumber,
          pickInRound: i + 1,
          teamId: ownerTeam.id,
          teamAbbr: ownerTeam.abbreviation,
          teamName: ownerTeam.name,
          teamColor: ownerTeam.primary_color || '#666',
          originalTeamId: originalTeam.id,
          originalTeamAbbr: originalTeam.abbreviation,
          originalTeamName: originalTeam.name,
          originalTeamColor: originalTeam.primary_color || '#666',
          isTraded: pick.isTraded || false,
          pickId: pick.id,
        })
      } else {
        // No pick found (shouldn't happen normally) — default to original team
        draftOrder.push({
          round,
          pick: pickNumber,
          pickInRound: i + 1,
          teamId: originalTeam.id,
          teamAbbr: originalTeam.abbreviation,
          teamName: originalTeam.name,
          teamColor: originalTeam.primary_color || '#666',
          originalTeamAbbr: originalTeam.abbreviation,
          isTraded: false,
          pickId: null,
        })
      }

      pickNumber++
    }
  }

  return draftOrder
}

/**
 * Build the round-1 display rows for the draft-lottery results modal.
 * Each row carries the current pick owner (post-trades), the original team whose
 * record entered the lottery, and the lottery delta (how far that original team
 * moved from its pre-lottery projected pick — positive = moved up).
 *
 * @param {Array}  teams         All team objects
 * @param {Object} standings     { east, west } final standings
 * @param {Object} lotteryResult campaign.settings.draftLottery (has actualOrder + year)
 * @returns {Array} rows: { pick, isLotteryTeam, isTraded, currentOwner, originalOwner, deltaLabel, deltaDir, delta }
 */
export function buildLotteryResultRows(teams, standings, lotteryResult, pickYear = null) {
  if (!lotteryResult || !Array.isArray(teams) || teams.length === 0) return []
  const safeStandings = standings || { east: [], west: [] }
  // Pick OWNERSHIP (for traded-pick "via" credit) is keyed by the draft pick's
  // `year`, which uses the campaign GAME-YEAR counter (1,2,3…) — NOT the calendar
  // year on `lotteryResult.year`. Use the injected counter `pickYear` (the same
  // value the draft room passes) so findDraftPick matches; fall back to
  // lotteryResult.year for older callers.
  const lookupYear = pickYear ?? lotteryResult.year
  const fullOrder = buildRookieDraftOrder(teams, safeStandings, lookupYear, lotteryResult)
  // Round 1 only — round 2 isn't lottery-affected (just reverse standings).
  const round1 = fullOrder.filter(slot => slot.round === 1)

  // The lottery operates on ORIGINAL teams (whoever's record finished bottom-14),
  // so deltas key off the original team — by ABBREVIATION (stable, and always
  // present on every slot, unlike originalTeamId which the no-pick-found branch
  // of buildRookieDraftOrder omits).
  const deltaByAbbr = new Map(
    (lotteryResult.actualOrder || []).map(s => [s.teamAbbr, s.delta])
  )
  const teamById = new Map(teams.map(t => [t.id, t]))

  return round1.map(slot => {
    const delta = deltaByAbbr.get(slot.originalTeamAbbr) ?? 0
    return {
      pick: slot.pick,
      isLotteryTeam: slot.pick <= 14,
      isTraded: slot.isTraded,
      currentOwner: teamById.get(slot.teamId) ?? null,
      originalOwner: teamById.get(slot.originalTeamId) ?? null,
      delta,
      deltaLabel: delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : null,
      deltaDir: delta > 0 ? 'up' : delta < 0 ? 'down' : null,
    }
  })
}

/**
 * Find a draft pick across all teams matching original team, year, and round.
 */
function findDraftPick(teams, originalAbbr, year, round) {
  for (const team of teams) {
    const picks = team.draftPicks || []
    const match = picks.find(p =>
      p.original_team_abbreviation === originalAbbr &&
      p.year === year &&
      p.round === round
    )
    if (match) return match
  }
  return null
}

/**
 * Assign pick numbers to draft pick objects on teams based on standings.
 * Mutates pick objects in place and returns them for saving.
 *
 * @param {Array} teams
 * @param {Object} standings
 * @param {number} gameYear
 * @param {Object|null} [lotteryResult] - Pass-through to buildRookieDraftOrder.
 */
export function assignDraftPickNumbers(teams, standings, gameYear, lotteryResult = null) {
  const order = buildRookieDraftOrder(teams, standings, gameYear, lotteryResult)

  for (const slot of order) {
    if (!slot.pickId) continue

    // Find the pick object on the owning team and set pick_number
    for (const team of teams) {
      const picks = team.draftPicks || []
      const pick = picks.find(p => p.id === slot.pickId)
      if (pick) {
        pick.pick_number = slot.pick
        pick.projected_position = slot.pickInRound
        break
      }
    }
  }
}
