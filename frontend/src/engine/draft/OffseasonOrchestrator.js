// =============================================================================
// OffseasonOrchestrator.js
// =============================================================================
// "Sim Offseason" one-click flow: auto-drafts rookies for all teams,
// applies contracts, handles undrafted, rolls picks, and starts the new season.
// =============================================================================

import { CampaignRepository } from '../db/CampaignRepository'
import { TeamRepository } from '../db/TeamRepository'
import { PlayerRepository } from '../db/PlayerRepository'
import { SeasonRepository } from '../db/SeasonRepository'
import { generateAndSaveRookieClass } from './RookieGenerationService'
import { buildRookieDraftOrder } from './DraftOrderService'
import { assignRookieContract, assignUndraftedContract } from './RookieContractService'
import { rollDraftPicks } from './DraftPickService'
import { selectRookieDraftPick } from '../../services/AIDraftService'
import { analyzeTeamDirection, buildContext } from '../ai/AITradeService'
import {
  initializeTeamLineup,
  initializeUserTeamLineup,
} from '../ai/AILineupService'
import { generateAITargetMinutes } from '../simulation/SubstitutionEngine'
import { startNewSeason } from '../campaign/CampaignManager'

/**
 * Run the entire offseason in one shot:
 * 1. Generate rookies if needed
 * 2. Build draft order from standings
 * 3. Auto-draft all 60 picks (user: BPA, AI: direction-aware)
 * 4. Apply rookie contracts
 * 5. Handle undrafted rookies
 * 6. Roll draft picks
 * 7. Start new season
 *
 * @param {string} campaignId
 * @returns {Promise<Object>}
 */
export async function simFullOffseason(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  const gameYear = campaign.gameYear ?? 1

  // Skip if rookie draft already completed for this year
  if (campaign[`rookieDraftCompleted_${gameYear}`]) {
    return startNewSeason(campaignId)
  }

  const teams = await TeamRepository.getAllForCampaign(campaignId)
  let allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

  // 1. Generate rookies if not already generated
  let rookies = allPlayers.filter(p => p.isDraftProspect && p.draftYear === gameYear)
  if (rookies.length === 0) {
    rookies = await generateAndSaveRookieClass(campaignId, gameYear)
    // Re-load all players to include new rookies
    allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
    rookies = allPlayers.filter(p => p.isDraftProspect && p.draftYear === gameYear)
  }

  // 2. Load standings and build draft order
  const seasonYear = campaign.currentSeasonYear ?? 2025
  const seasonData = await SeasonRepository.get(campaignId, seasonYear)
  const standings = seasonData?.standings || { east: [], west: [] }
  const draftOrder = buildRookieDraftOrder(teams, standings, gameYear)

  // 3. Compute team directions for AI
  const context = buildContext({ standings, teams, seasonPhase: 'offseason' })
  const directions = {}
  for (const team of teams) {
    const teamRoster = allPlayers.filter(p => p.teamId === team.id)
    directions[team.id] = analyzeTeamDirection(team, teamRoster, context)
  }

  // 4. Auto-draft all 60 picks
  const available = [...rookies]
  const draftResults = []
  const teamDraftedPlayers = {} // teamId → [drafted player objects]

  for (const slot of draftOrder) {
    if (available.length === 0) break

    const teamId = slot.teamId
    const isUser = teamId === campaign.teamId

    let selected

    if (isUser) {
      // User auto-pick: Best Player Available (highest OVR)
      available.sort((a, b) => (b.overallRating || 0) - (a.overallRating || 0))
      selected = available[0]
    } else {
      // AI pick: direction-aware
      const direction = directions[teamId] || 'ascending'
      const existingRoster = allPlayers.filter(p => p.teamId === teamId)
      const alreadyDrafted = teamDraftedPlayers[teamId] || []
      const fullRoster = [...existingRoster, ...alreadyDrafted]

      selected = selectRookieDraftPick(
        available,
        fullRoster,
        direction,
        slot.pick,
        slot.round
      )
    }

    if (!selected) continue

    // Remove from available pool
    const idx = available.findIndex(p => p.id === selected.id)
    if (idx >= 0) available.splice(idx, 1)

    // Track draft result
    draftResults.push({
      pick: slot.pick,
      round: slot.round,
      teamId,
      playerId: selected.id,
    })

    // Track per-team drafted players for roster context
    if (!teamDraftedPlayers[teamId]) teamDraftedPlayers[teamId] = []
    teamDraftedPlayers[teamId].push(selected)
  }

  // 5. Apply rookie contracts and assign to teams
  const playerUpdates = []

  for (const result of draftResults) {
    const player = rookies.find(p => p.id === result.playerId)
    if (!player) continue

    const team = teams.find(t => t.id === result.teamId)
    if (!team) continue

    const contract = assignRookieContract(result.pick)
    const updated = {
      ...player,
      teamId: team.id,
      teamAbbreviation: team.abbreviation,
      isFreeAgent: 0,
      isDraftProspect: false,
      campaignId,
      ...contract,
    }
    playerUpdates.push(updated)
  }

  // 6. Handle undrafted rookies → regular free agents with min contracts
  const draftedIds = new Set(draftResults.map(r => r.playerId))
  for (const rookie of rookies) {
    if (!draftedIds.has(rookie.id)) {
      const contract = assignUndraftedContract()
      playerUpdates.push({
        ...rookie,
        isDraftProspect: false,
        isFreeAgent: 1,
        teamId: null,
        teamAbbreviation: 'FA',
        campaignId,
        ...contract,
      })
    }
  }

  if (playerUpdates.length > 0) {
    await PlayerRepository.saveBulk(playerUpdates)
  }

  // 7. Roll draft picks: consume this year's, generate year+5
  await rollDraftPicks(teams, campaignId, gameYear, gameYear + 5)

  // 8. Mark draft completed
  campaign[`rookieDraftCompleted_${gameYear}`] = true
  await CampaignRepository.save(campaign)

  // 9. Start new season
  return startNewSeason(campaignId)
}
