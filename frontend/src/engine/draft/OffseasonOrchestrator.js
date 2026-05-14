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
import { generateAndSaveRookieClass, shouldGenerateGenerational } from './RookieGenerationService'
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
import { generateAIFreeAgencyOffers } from '../ai/AIContractService'
import { pickBestOffer } from '../ai/FreeAgentDecisionService'
import { FREE_AGENCY_DURATION_DAYS } from '../season/SeasonDeadlines'
import { SALARY_CAP } from '../data/teams'

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

  if (campaign.phase === 'offseason_free_agency') {
    throw new Error('Free agency must be resolved before the rookie draft.')
  }

  // Skip if rookie draft already completed for this year
  if (campaign[`rookieDraftCompleted_${gameYear}`]) {
    // Phase may be 'offseason_draft' after FA resolution; startNewSeason
    // expects 'offseason'. Normalize before delegating.
    if (campaign.phase === 'offseason_draft') {
      campaign.phase = 'offseason'
      await CampaignRepository.save(campaign)
    }
    return startNewSeason(campaignId)
  }

  const teams = await TeamRepository.getAllForCampaign(campaignId)
  let allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

  // 1. Generate rookies if not already generated.
  //    Prospects' draftYear = season year they'll first play (currentSeasonYear + 1).
  //    Migration: older campaigns generated rookies with draftYear set to the
  //    `gameYear` counter (1, 2, 3...). Detect those and rewrite to the proper
  //    season year so the upcoming draft still finds them.
  const currentSeasonYear = campaign.currentSeasonYear ?? 2025
  const rookieDraftYear = currentSeasonYear + 1
  const stalePropsects = allPlayers.filter(p =>
    p.isDraftProspect && typeof p.draftYear === 'number' && p.draftYear < 2000
  )
  if (stalePropsects.length > 0) {
    for (const p of stalePropsects) {
      p.draftYear = rookieDraftYear
    }
    await PlayerRepository.saveBulk(stalePropsects.map(p => ({ ...p, campaignId })))
    allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
  }

  let rookies = allPlayers.filter(p => p.isDraftProspect && p.draftYear === rookieDraftYear)
  if (rookies.length === 0) {
    const includeGenerational = shouldGenerateGenerational(campaign, rookieDraftYear)
    rookies = await generateAndSaveRookieClass(campaignId, rookieDraftYear, { includeGenerational })
    if (includeGenerational) {
      campaign.settings = campaign.settings ?? {}
      campaign.settings.lastGenerationalDraftYear = rookieDraftYear
      await CampaignRepository.save(campaign)
    }
    // Re-load all players to include new rookies
    allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
    rookies = allPlayers.filter(p => p.isDraftProspect && p.draftYear === rookieDraftYear)
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
      team_id: team.id,
      teamAbbreviation: team.abbreviation,
      team_abbreviation: team.abbreviation,
      isFreeAgent: 0,
      is_free_agent: 0,
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
        is_free_agent: 1,
        teamId: null,
        team_id: null,
        teamAbbreviation: 'FA',
        team_abbreviation: 'FA',
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
  // Phase normalization: after FA we're in 'offseason_draft'. startNewSeason
  // requires 'offseason'.
  if (campaign.phase === 'offseason_draft') {
    campaign.phase = 'offseason'
  }
  await CampaignRepository.save(campaign)

  // 9. Start new season
  return startNewSeason(campaignId)
}

// =============================================================================
// FREE AGENCY PHASE
// =============================================================================
//
// `enterOffseason()` already releases every expiring contract and sets
// campaign.phase = 'offseason'. From there the user explicitly enters the
// 2-week free-agency window via `startFreeAgency()`, advances days with
// `simFreeAgencyDay()`, and on day 14 the engine resolves all pending offers
// and flips the phase to 'offseason_draft' so the rookie draft can run.

function teamFromAbbr(teams, abbr) {
  return teams.find(t => t.abbreviation === abbr) || null
}

function teamFromId(teams, id) {
  return teams.find(t => t.id === id) || null
}

function rosterByTeamAbbr(allPlayers, abbr) {
  return allPlayers.filter(p => (p.teamAbbreviation ?? p.team_abbreviation ?? null) === abbr)
}

function buildTeamLookup(teams, allPlayers, standings, championTeamId) {
  return (teamId) => {
    const team = teamFromId(teams, teamId)
    if (!team) return null
    const teamRoster = rosterByTeamAbbr(allPlayers, team.abbreviation)
    const eastEntry = standings?.east?.find(e => e.teamId === team.id)
    const westEntry = standings?.west?.find(e => e.teamId === team.id)
    const standingsEntry = eastEntry || westEntry || {}
    return {
      team: {
        ...team,
        wins: standingsEntry.wins ?? team.wins ?? 0,
        losses: standingsEntry.losses ?? team.losses ?? 0,
        madePlayoffs: !!standingsEntry.madePlayoffs,
      },
      teamRoster,
      coach: team.coach || null,
      hasChampionship: championTeamId && team.id === championTeamId,
    }
  }
}

/**
 * Begin the 2-week free agency window.
 */
export async function startFreeAgency(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  if (campaign.phase === 'offseason_free_agency') return campaign
  if (campaign.phase !== 'offseason') {
    throw new Error(`Cannot enter free agency from phase '${campaign.phase}'`)
  }

  const gameYear = campaign.gameYear ?? 1
  if (campaign[`freeAgencyCompleted_${gameYear}`]) {
    // Already resolved this year — skip straight to draft phase
    campaign.phase = 'offseason_draft'
    await CampaignRepository.save(campaign)
    return campaign
  }

  campaign.phase = 'offseason_free_agency'
  if (!campaign.settings) campaign.settings = {}
  campaign.settings.freeAgencyDay = 0
  campaign.settings.freeAgencyStartDate = new Date().toISOString()
  campaign.settings.freeAgencyOffers = {}
  campaign.settings.freeAgencyResults = null

  await CampaignRepository.save(campaign)
  return campaign
}

/**
 * Advance one in-game day of free agency. AI teams add pending offers; on the
 * final day, run resolution and flip phase to 'offseason_draft'.
 */
export async function simFreeAgencyDay(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)
  if (campaign.phase !== 'offseason_free_agency') {
    throw new Error(`Free agency is not active (phase=${campaign.phase})`)
  }

  if (!campaign.settings) campaign.settings = {}
  if (!campaign.settings.freeAgencyOffers) campaign.settings.freeAgencyOffers = {}

  const day = (campaign.settings.freeAgencyDay ?? 0) + 1
  const gameYear = campaign.gameYear ?? 1
  const seasonYear = campaign.currentSeasonYear ?? 2025

  const teams = await TeamRepository.getAllForCampaign(campaignId)
  const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
  const seasonData = await SeasonRepository.get(campaignId, seasonYear)
  const standings = seasonData?.standings || { east: [], west: [] }

  const aiTeams = teams.filter(t => t.id !== campaign.teamId)

  const placedToday = generateAIFreeAgencyOffers({
    aiTeams,
    leaguePlayers: allPlayers,
    standings,
    allTeams: teams,
    offersMap: campaign.settings.freeAgencyOffers,
    day,
    campaignId,
    gameYear,
  })

  campaign.settings.freeAgencyDay = day

  if (day >= FREE_AGENCY_DURATION_DAYS) {
    await resolveFreeAgency(campaign, { teams, allPlayers, standings })
  } else {
    await CampaignRepository.save(campaign)
  }

  return {
    campaign,
    day,
    placedToday,
    resolved: day >= FREE_AGENCY_DURATION_DAYS,
  }
}

/**
 * Score every offer for every FA, sign each player to their best offer,
 * persist roster changes, and fill `freeAgencyResults` for the wrap-up modal.
 *
 * Mutates the passed-in campaign object and saves it. Does NOT call
 * startNewSeason — leaves the user at phase='offseason_draft' so they can run
 * the rookie draft.
 */
export async function resolveFreeAgency(campaign, preloaded = {}) {
  const campaignId = campaign.id
  const gameYear = campaign.gameYear ?? 1
  const seasonYear = campaign.currentSeasonYear ?? 2025

  const teams = preloaded.teams || (await TeamRepository.getAllForCampaign(campaignId))
  const allPlayers = preloaded.allPlayers || (await PlayerRepository.getAllForCampaign(campaignId))
  const seasonData = preloaded.seasonData || (await SeasonRepository.get(campaignId, seasonYear))
  const standings = preloaded.standings || seasonData?.standings || { east: [], west: [] }

  const championTeamId = seasonData?.playoffs?.championTeamId || null
  const offersMap = campaign.settings?.freeAgencyOffers || {}
  const userTeamId = campaign.teamId

  const resolveCtx = buildTeamLookup(teams, allPlayers, standings, championTeamId)
  const accepted = []
  const declined = []
  const playerUpdates = []
  // Deferred user-winning signings. These are players who accepted the user's
  // offer; we may have to ask the user to pick which to keep if accepting all
  // of them would exceed the cap (the user is allowed to bid above cap on
  // multiple players since signings only resolve at window end).
  const pendingUserSignings = []

  const userTeamRecord = teamFromId(teams, userTeamId)
  const userTeamAbbr = userTeamRecord?.abbreviation || null

  // Build a user-signing update payload from a (player, offer) pair. Used in
  // two places: immediate auto-sign when cap fits, and deferred finalization
  // when the user picks via the modal.
  const buildUserSigningUpdate = (player, offer) => ({
    ...player,
    teamId: userTeamId,
    team_id: userTeamId,
    teamAbbreviation: userTeamAbbr,
    team_abbreviation: userTeamAbbr,
    isFreeAgent: 0,
    is_free_agent: 0,
    contractYearsRemaining: offer.years,
    contract_years_remaining: offer.years,
    contractSalary: offer.salary,
    contract_salary: offer.salary,
    previousTeamId: undefined,
    previous_team_id: undefined,
    previousTeamAbbreviation: undefined,
    previous_team_abbreviation: undefined,
    campaignId,
  })

  for (const [playerId, offers] of Object.entries(offersMap)) {
    if (!offers || offers.length === 0) continue
    const player = allPlayers.find(p => String(p.id) === String(playerId))
    if (!player) continue

    const userOffer = offers.find(o => o.isUserOffer) || null

    const result = pickBestOffer(player, offers, (teamId, offer) => {
      const ctx = resolveCtx(teamId === 'user' ? userTeamId : teamId) || {}
      const previousTeamId = player.previousTeamId ?? null
      ctx.isIncumbent = previousTeamId && (teamId === previousTeamId || (teamId === 'user' && userTeamId === previousTeamId))
      return ctx
    })

    if (!result || !result.offer) {
      // Player went unsigned — leave as FA
      if (userOffer) {
        declined.push({
          playerId: player.id,
          playerName: player.name || `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim(),
          signedWith: 'unsigned',
          signedWithAbbr: null,
          userOffer,
          winningOffer: null,
          reason: 'No offer reached the minimum fit threshold.',
        })
      }
      continue
    }

    const winningOffer = result.offer
    const isUserWinner = winningOffer.isUserOffer === true
    const playerName = player.name || `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim()

    if (isUserWinner) {
      // Defer until we know whether all user-winning bids fit under cap.
      // Pre-compute the runner-up AI offer now so we don't have to re-score
      // later: if the user ultimately passes (or can't fit them all), the
      // player auto-signs with whichever AI team was their second choice.
      const aiOnlyOffers = offers.filter(o => !o.isUserOffer)
      const fallbackResult = pickBestOffer(player, aiOnlyOffers, (teamId, offer) => {
        const ctx = resolveCtx(teamId) || {}
        const previousTeamId = player.previousTeamId ?? null
        ctx.isIncumbent = previousTeamId && teamId === previousTeamId
        return ctx
      })
      const fallbackOffer = fallbackResult?.offer || null
      const fallbackTeam = fallbackOffer ? teamFromId(teams, fallbackOffer.teamId) : null
      pendingUserSignings.push({
        player,
        offer: userOffer,
        playerName,
        fallback: fallbackOffer && fallbackTeam
          ? {
              teamId: fallbackTeam.id,
              teamAbbr: fallbackTeam.abbreviation,
              salary: fallbackOffer.salary,
              years: fallbackOffer.years,
              reason: fallbackResult?.reason || null,
            }
          : null,
      })
      continue
    }

    // AI team won — finalize immediately.
    const targetTeam = teamFromId(teams, winningOffer.teamId)
    if (!targetTeam) continue

    playerUpdates.push({
      ...player,
      // BOTH casings are required: AI flows (ensureMinimumRosters,
      // processTeamSignings, etc.) check `p.isFreeAgent === 1 || p.is_free_agent === 1`,
      // so missing the snake_case duplicate leaves a stale FA flag and the
      // signed player gets re-scooped onto an AI roster on the next backfill.
      teamId: targetTeam.id,
      team_id: targetTeam.id,
      teamAbbreviation: targetTeam.abbreviation,
      team_abbreviation: targetTeam.abbreviation,
      isFreeAgent: 0,
      is_free_agent: 0,
      contractYearsRemaining: winningOffer.years,
      contract_years_remaining: winningOffer.years,
      contractSalary: winningOffer.salary,
      contract_salary: winningOffer.salary,
      previousTeamId: undefined,
      previous_team_id: undefined,
      previousTeamAbbreviation: undefined,
      previous_team_abbreviation: undefined,
      campaignId,
    })

    if (userOffer) {
      declined.push({
        playerId: player.id,
        playerName,
        signedWith: targetTeam.abbreviation,
        signedWithAbbr: targetTeam.abbreviation,
        userOffer,
        winningOffer,
        reason: result.reason,
      })
    }
  }

  // Compute the user's available cap room based on their current roster
  // (excluding the player records about to be modified above — they're either
  // already on the user team or about to join an AI team).
  const userRosterPayroll = allPlayers
    .filter(p => {
      const tid = p.teamId ?? p.team_id
      if (tid !== userTeamId) return false
      if (p.isFreeAgent === 1 || p.is_free_agent === 1) return false
      if (p.isRetired || p.is_retired) return false
      return true
    })
    .reduce((sum, p) => sum + (p.contractSalary ?? p.contract_salary ?? 0), 0)
  const userCapSpace = SALARY_CAP - userRosterPayroll
  // Bird-rights signings (re-signing your own player from last season) don't
  // count toward the cap-overflow check — real NBA teams can exceed the cap
  // to retain their own free agents. Only the NEW outside signings need to
  // fit in available room.
  const isUserIncumbent = (player) => {
    const prev = player?.previousTeamId ?? player?.previous_team_id ?? null
    return prev != null && String(prev) === String(userTeamId)
  }
  const nonBirdSignings = pendingUserSignings.filter(x => !isUserIncumbent(x.player))
  const pendingTotal = nonBirdSignings.reduce((s, x) => s + (x.offer?.salary || 0), 0)

  let pendingChoice = null
  if (pendingTotal <= userCapSpace) {
    // All user-winning offers fit — finalize them all now (incumbents under
    // Bird rights are always finalized regardless of cap math above).
    for (const { player, offer } of pendingUserSignings) {
      playerUpdates.push(buildUserSigningUpdate(player, offer))
      accepted.push({
        playerId: player.id,
        playerName: player.name || `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim(),
        years: offer.years,
        salary: offer.salary,
      })
    }
  } else if (pendingUserSignings.length > 0) {
    // User won more than they can afford on outside signings — surface a
    // choice in the modal for NON-Bird signings. Bird-rights incumbents
    // auto-finalize since Bird rights bypass the cap; the user shouldn't
    // be forced to "pick" between keeping their own player and a free
    // agent that's competing for the same cap dollars.
    for (const { player, offer } of pendingUserSignings.filter(x => isUserIncumbent(x.player))) {
      playerUpdates.push(buildUserSigningUpdate(player, offer))
      accepted.push({
        playerId: player.id,
        playerName: player.name || `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim(),
        years: offer.years,
        salary: offer.salary,
      })
    }
    if (nonBirdSignings.length > 0) {
      pendingChoice = {
        capSpace: userCapSpace,
        offers: nonBirdSignings.map(({ player, offer, playerName, fallback }) => ({
          playerId: player.id,
          playerName,
          position: player.position ?? null,
          overallRating: player.overallRating ?? player.overall_rating ?? null,
          years: offer.years,
          salary: offer.salary,
          // Pre-computed runner-up AI offer. If the user passes on this
          // player, they immediately sign with the fallback team — the
          // players were willing to sign there anyway, so it would be
          // unrealistic to leave them on the FA pile just because the user
          // took a swing.
          fallback,
        })),
      }
    }
  }

  if (playerUpdates.length > 0) {
    await PlayerRepository.saveBulk(playerUpdates)
  }

  campaign[`freeAgencyCompleted_${gameYear}`] = true
  campaign.phase = 'offseason_draft'
  if (!campaign.settings) campaign.settings = {}
  campaign.settings.freeAgencyOffers = {}
  campaign.settings.freeAgencyResults = { accepted, declined, pendingChoice }
  campaign.settings.freeAgencyDay = FREE_AGENCY_DURATION_DAYS

  await CampaignRepository.save(campaign)
  return campaign
}
