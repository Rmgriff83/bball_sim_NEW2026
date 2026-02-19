// =============================================================================
// DraftPickService.js
// =============================================================================
// Manages draft pick lifecycle: generating future picks and consuming used picks.
// =============================================================================

import { TeamRepository } from '../db/TeamRepository'

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Generate Round 1 + Round 2 draft picks for a target year for all teams,
 * if they don't already exist.
 *
 * @param {Array} teams - All teams (will be mutated)
 * @param {string} campaignId
 * @param {number} targetYear - The year to generate picks for
 */
export function generateNewDraftPicks(teams, campaignId, targetYear) {
  for (const team of teams) {
    if (!team.draftPicks) team.draftPicks = []

    for (const round of [1, 2]) {
      // Check if pick already exists
      const exists = team.draftPicks.some(
        p => p.original_team_abbreviation === team.abbreviation &&
             p.year === targetYear &&
             p.round === round
      )

      if (!exists) {
        team.draftPicks.push({
          id: generateUUID(),
          campaignId,
          originalTeamId: team.id,
          currentOwnerId: team.id,
          original_team_abbreviation: team.abbreviation,
          year: targetYear,
          round,
          pick_number: null,
          projected_position: null,
          isTraded: false,
          display_name: `${targetYear} Round ${round} (${team.abbreviation})`,
          trade_value: round === 1 ? 5 : 0.5,
        })
      }
    }
  }
}

/**
 * Remove all draft picks for a completed year from every team's draftPicks array.
 *
 * @param {Array} teams - All teams (will be mutated)
 * @param {number} completedYear - The draft year to consume
 */
export function consumeDraftPicks(teams, completedYear) {
  for (const team of teams) {
    if (!team.draftPicks) continue
    team.draftPicks = team.draftPicks.filter(p => p.year !== completedYear)
  }
}

/**
 * Consume used picks and generate new future picks, then save teams.
 *
 * @param {Array} teams
 * @param {string} campaignId
 * @param {number} completedYear - Year just drafted
 * @param {number} futureYear - Year to generate new picks for (typically completedYear + 5)
 */
export async function rollDraftPicks(teams, campaignId, completedYear, futureYear) {
  consumeDraftPicks(teams, completedYear)
  generateNewDraftPicks(teams, campaignId, futureYear)
  await TeamRepository.saveBulk(teams)
}
