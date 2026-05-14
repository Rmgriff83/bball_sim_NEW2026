// =============================================================================
// UserTeamFinalizer.js
// =============================================================================
// "Let AI finish my team setup" — the missing-pieces version of
// simFullOffseason. The user has already done their offseason work; they're
// just missing a head coach and/or roster slots needed to start the season.
// =============================================================================

import { CampaignRepository } from '../db/CampaignRepository'
import { TeamRepository } from '../db/TeamRepository'
import { PlayerRepository } from '../db/PlayerRepository'
import { ensureMinimumRosters, getVeteranMinSalary } from '../ai/AIContractService'
import { generatePlayer } from './CampaignManager'
import { getCoachActionBudget } from '../data/coaches'

// Engine roster floor — same constant used by ensureMinimumRosters.
const TARGET_ROSTER_SIZE = 14

function isOnUserTeam(player, userTeamId) {
  const tid = player?.teamId ?? player?.team_id
  if (tid !== userTeamId) return false
  if (player.isRetired || player.is_retired) return false
  if (player.isFreeAgent === 1 || player.is_free_agent === 1) return false
  return true
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Pre-release any players whose contractYearsRemaining hit zero. This is
 * what `startNewSeason` does first; we run it now so the FA pool is fresh
 * before we try to fill the user's roster from it. Returns the count of
 * players moved to FA. Mutates `players` in place and persists them.
 */
async function releaseExpiredContracts(campaignId, players) {
  const released = []
  for (let i = 0; i < players.length; i++) {
    const p = players[i]
    const years = p.contractYearsRemaining ?? p.contract_years_remaining ?? 1
    const tid = p.teamId ?? p.team_id
    if (years === 0 && tid) {
      players[i] = {
        ...p,
        isFreeAgent: 1,
        is_free_agent: 1,
        teamId: null,
        team_id: null,
        teamAbbreviation: 'FA',
        team_abbreviation: 'FA',
      }
      released.push(players[i])
    }
  }
  if (released.length > 0) {
    await PlayerRepository.saveBulk(released.map(p => JSON.parse(JSON.stringify(p))))
  }
  return released.length
}

/**
 * Generate emergency tryout-camp players to fill the user's remaining roster
 * holes. Used when the existing FA pool has nothing left to sign. Realistic
 * mid-summer roster filler — low overall (50-60), vet-min 1-year deals.
 */
async function generateEmergencyFillers(campaignId, team, userTeamId, slotsNeeded) {
  if (slotsNeeded <= 0) return []
  const positions = ['PG', 'SG', 'SF', 'PF', 'C']
  const fillers = []
  for (let i = 0; i < slotsNeeded; i++) {
    const pos = positions[i % positions.length]
    const overall = randInt(50, 60)
    const player = generatePlayer({
      campaignId,
      teamId: userTeamId,
      teamAbbreviation: team.abbreviation,
      position: pos,
      overall,
      teamIndex: 999, // out-of-band index for emergency fillers
      posIndex: 100 + i,
    })
    const minSalary = getVeteranMinSalary(player)
    player.contractYearsRemaining = 1
    player.contract_years_remaining = 1
    player.contractSalary = minSalary
    player.contract_salary = minSalary
    player.isFreeAgent = 0
    player.is_free_agent = 0
    player.team_id = userTeamId
    player.team_abbreviation = team.abbreviation
    fillers.push(player)
  }
  await PlayerRepository.saveBulk(fillers.map(p => JSON.parse(JSON.stringify(p))))
  return fillers.map(p => ({
    team: team.abbreviation,
    player: p.name,
    playerId: p.id,
    years: 1,
    salary: p.contractSalary,
    isGenerated: true,
  }))
}

/**
 * Finish the user team's offseason setup automatically:
 *   1. Hire the highest-rated free coach (hireCost === 0), if no coach.
 *   2. Refresh the FA pool by releasing expired contracts league-wide.
 *   3. Sign FAs to fill the user roster to the engine's floor (14).
 *   4. If the FA pool can't satisfy the gap, generate emergency tryout-camp
 *      players at vet min for the remaining slots.
 */
export async function aiFinishUserTeamSetup(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error('Campaign not found')

  const userTeamId = campaign.teamId ?? campaign.userTeamId ?? campaign.user_team_id
  if (!userTeamId) throw new Error('No user team found on campaign')

  const team = await TeamRepository.get(campaignId, userTeamId)
  if (!team) throw new Error('User team not found')

  let coachHired = null
  let playersSigned = []

  // --- Step 1: hire a free coach if needed --------------------------------
  if (!team.coach) {
    const pool = Array.isArray(campaign.settings?.availableCoaches)
      ? campaign.settings.availableCoaches
      : []
    const freeCoaches = pool
      .filter(c => (c.hireCost ?? 0) === 0)
      .sort((a, b) => (b.overallRating ?? b.overall_rating ?? 0) - (a.overallRating ?? a.overall_rating ?? 0))
    const candidate = freeCoaches[0]
    if (candidate) {
      const currentSeason = campaign.currentSeasonYear ?? campaign.settings?.currentSeasonYear ?? 2025
      const { hireCost: _drop, ...coachWithoutCost } = candidate
      const newCoach = {
        ...coachWithoutCost,
        hiredSeason: currentSeason,
        contractYearsRemaining: 2,
        contract_years_remaining: 2,
        actionsRemaining: 0,
      }
      // Mirror the team store's hireCoach flow — stamp the per-season Coach
      // Meeting budget so the auto-hired coach starts with free meetings.
      newCoach.actionsRemaining = getCoachActionBudget(newCoach)
      team.coach = newCoach
      await TeamRepository.save(team)

      campaign.settings = campaign.settings ?? {}
      campaign.settings.availableCoaches = pool.filter(c => c.id !== candidate.id)
      coachHired = newCoach
    }
  }

  // --- Step 2: refresh the FA pool ----------------------------------------
  // After offseason FA most of the original pool is signed. Pre-running the
  // contract-expiry release that startNewSeason does first refreshes the
  // pool so we have someone to sign.
  let allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
  await releaseExpiredContracts(campaignId, allPlayers)
  allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

  // --- Step 3: try to fill from the FA pool -------------------------------
  let userRoster = allPlayers.filter(p => isOnUserTeam(p, userTeamId))
  if (userRoster.length < TARGET_ROSTER_SIZE) {
    // Reuse the AI backfill logic by passing the user team in `aiTeams`.
    // `minRating: 0` skips the 50-OVR floor AI teams use — after offseason
    // FA the pool can be sparse and we'd rather fill weak slots than leave
    // the user stuck.
    const result = ensureMinimumRosters({
      aiTeams: [team],
      leaguePlayers: allPlayers,
      minRating: 0,
    })
    if (result?.signings?.length > 0) {
      playersSigned = result.signings
      const dirty = (result.updatedPlayers || []).map(p => JSON.parse(JSON.stringify(p)))
      await PlayerRepository.saveBulk(dirty)
    }
  }

  // --- Step 4: generate emergency fillers if still short -------------------
  // Even after refreshing the pool, top FAs may already have been picked
  // over. Real NBA teams hold tryout camps for undrafted vets / G-League
  // bodies in this situation — model the same with generated low-overall
  // players on vet-min deals.
  const afterPool = await PlayerRepository.getAllForCampaign(campaignId)
  const currentRoster = afterPool.filter(p => isOnUserTeam(p, userTeamId))
  if (currentRoster.length < TARGET_ROSTER_SIZE) {
    const slotsStillNeeded = TARGET_ROSTER_SIZE - currentRoster.length
    const generated = await generateEmergencyFillers(campaignId, team, userTeamId, slotsStillNeeded)
    playersSigned = [...playersSigned, ...generated]
  }

  // Persist coach-pool / settings change made above
  if (coachHired) {
    await CampaignRepository.save(campaign)
  }

  // Final roster count for the caller to confirm we're above the threshold
  const finalAll = await PlayerRepository.getAllForCampaign(campaignId)
  const finalRosterCount = finalAll.filter(p => isOnUserTeam(p, userTeamId)).length

  return { coachHired, playersSigned, rosterAfterCount: finalRosterCount }
}
