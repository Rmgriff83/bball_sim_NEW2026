// =============================================================================
// DraftOrderService.js
// =============================================================================
// Builds 60-pick rookie draft order from standings and traded draft picks.
// =============================================================================

/**
 * Build the full 60-pick rookie draft order based on standings.
 * Worst team picks first; traded picks go to the current owner.
 *
 * @param {Array} teams - All 30 teams
 * @param {Object} standings - { east: [...], west: [...] }
 * @param {number} gameYear - The draft year
 * @returns {Array} 60-slot array matching draft store format
 */
export function buildRookieDraftOrder(teams, standings, gameYear) {
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
    return {
      team,
      wins: standing?.wins ?? 0,
      losses: standing?.losses ?? 0,
      pointDiff: standing?.pointDifferential ?? standing?.pointDiff ?? 0,
    }
  })

  // 3. Sort by wins ascending (worst first), tiebreak by point differential ascending
  teamRecords.sort((a, b) => {
    if (a.wins !== b.wins) return a.wins - b.wins
    return a.pointDiff - b.pointDiff
  })

  // 4. Build draft order: for each standing position, look up who owns the pick
  const draftOrder = []
  let pickNumber = 1

  for (let round = 1; round <= 2; round++) {
    for (let i = 0; i < teamRecords.length; i++) {
      const { team: originalTeam } = teamRecords[i]

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
          teamName: `${ownerTeam.city} ${ownerTeam.name}`,
          teamColor: ownerTeam.primary_color || '#666',
          originalTeamId: originalTeam.id,
          originalTeamAbbr: originalTeam.abbreviation,
          originalTeamName: `${originalTeam.city} ${originalTeam.name}`,
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
          teamName: `${originalTeam.city} ${originalTeam.name}`,
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
 */
export function assignDraftPickNumbers(teams, standings, gameYear) {
  const order = buildRookieDraftOrder(teams, standings, gameYear)

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
