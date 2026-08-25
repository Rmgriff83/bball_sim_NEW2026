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
import { BreakingNewsService } from '../season/BreakingNewsService'
import { generateAndSaveRookieClass, shouldGenerateGenerational } from './RookieGenerationService'
import { buildRookieDraftOrder } from './DraftOrderService'
import { runDraftLottery } from './DraftLotteryService'
import { assignRookieContract, assignUndraftedContract } from './RookieContractService'
import { rollDraftPicks } from './DraftPickService'
import { selectRookieDraftPick } from '../../services/AIDraftService'
import { analyzeTeamDirection, buildContext } from '../ai/AITradeService'
import { getEffectiveExpectation } from '../season/OwnerExpectationService'
import { findOwnerForTeam } from '../data/owners'
import {
  initializeTeamLineup,
  initializeUserTeamLineup,
} from '../ai/AILineupService'
import { generateAITargetMinutes } from '../simulation/SubstitutionEngine'
import { startNewSeason } from '../campaign/CampaignManager'
import { aiFinishUserTeamSetup } from '../campaign/UserTeamFinalizer'
import { generateAIFreeAgencyOffers } from '../ai/AIContractService'
import { pickBestOffer } from '../ai/FreeAgentDecisionService'
import { buildSeasonStatsLookup } from '../finance/FinanceManager'
import { FREE_AGENCY_DURATION_DAYS } from '../season/SeasonDeadlines'
import { SALARY_CAP } from '../data/teams'
import { capNumbersFor, veteranMinSalary } from '../data/salaryScale'

/**
 * Run the entire offseason in one shot:
 * 1. Generate rookies if needed
 * 2. Build draft order from standings (honoring/rolling the lottery)
 * 2b. Run the free-agency market headlessly (AI offers all 14 days at
 *     market prices under the campaign cap set, then resolveFreeAgency
 *     distributes every FA to their best offer — identical rules to a
 *     manually played window where the user placed no bids)
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
  // Honor the lottery result if one was already run this cycle — the user
  // clicks the Draft Lottery CTA before free agency, which persists it onto
  // campaign.settings.draftLottery. If none exists for THIS draft year (e.g. the
  // user skipped the whole offseason via Sim Offseason), roll a fresh one here
  // so round 1 still gets real lottery randomization instead of flat reverse
  // standings — and persist it so the order is recorded and viewable.
  let lotteryResult = campaign?.settings?.draftLottery ?? null
  if (!lotteryResult || lotteryResult.year !== rookieDraftYear) {
    lotteryResult = runDraftLottery(teams, standings, rookieDraftYear)
    campaign.settings = campaign.settings ?? {}
    campaign.settings.draftLottery = lotteryResult
    campaign.settings.draftLotteryCompleted = true
    await CampaignRepository.save(campaign)
  }
  const draftOrder = buildRookieDraftOrder(teams, standings, gameYear, lotteryResult)

  // 2b. Free-agency market. The user skipped the FA window, so run the REAL
  // market headlessly: AI teams place their paced, cap-gated offers for all
  // 14 window days (priced via the same market-value engine, gated against
  // the campaign's current cap set incl. the first/second aprons via
  // capNumbersFor), then resolveFreeAgency distributes every FA to their
  // best offer — identical to fast-forwarding the window without bidding.
  // The user places no offers, so stars spread across AI teams at market
  // salaries; the roster-floor fill later only sees genuine leftovers.
  // Skipped when FA already resolved this year (phase 'offseason_draft').
  if (campaign.phase === 'offseason' && !campaign[`freeAgencyCompleted_${gameYear}`]) {
    // Enter the window on the already-loaded object (mirrors startFreeAgency);
    // saved immediately so a mid-step failure leaves the campaign in a
    // normal, manually playable FA window instead of a broken state.
    campaign.phase = 'offseason_free_agency'
    campaign.settings = campaign.settings ?? {}
    campaign.settings.freeAgencyDay = 0
    campaign.settings.freeAgencyStartDate = new Date().toISOString()
    campaign.settings.freeAgencyOffers = {}
    campaign.settings.freeAgencyResults = null
    await CampaignRepository.save(campaign)

    const faStatsLookup = buildSeasonStatsLookup(seasonData)
    const getPlayerStatsFn = (id) => faStatsLookup[id] ?? null
    const faAiTeams = teams.filter(t => t.id !== campaign.teamId)
    const faCapNumbers = capNumbersFor(campaign)
    // One roster snapshot for all 14 days is faithful: offers never change
    // rosters mid-window (signings only resolve at day 14) and the skip
    // path has no user actions between days.
    for (let faDay = 1; faDay <= FREE_AGENCY_DURATION_DAYS; faDay++) {
      generateAIFreeAgencyOffers({
        aiTeams: faAiTeams,
        leaguePlayers: allPlayers,
        standings,
        allTeams: teams,
        offersMap: campaign.settings.freeAgencyOffers,
        day: faDay,
        campaignId,
        gameYear,
        getPlayerStatsFn,
        capNumbers: faCapNumbers,
      })
      campaign.settings.freeAgencyDay = faDay
    }

    // Signs every FA to their best AI offer, saves players, sets
    // freeAgencyCompleted_{gameYear} and phase='offseason_draft'.
    await resolveFreeAgency(campaign, { teams, allPlayers, standings, seasonData })
    // No user offers existed, so the wrap-up payload is empty — drop it
    // rather than leave a stale record (persisted by the later campaign save).
    campaign.settings.freeAgencyResults = null
    // Rosters changed league-wide — reload so direction analysis and the
    // AI draft evaluate post-market rosters.
    allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
  }

  // 3. Compute team directions for AI. The user team carries its live (dynamic)
  // owner expectation so its direction reflects how the franchise is trending.
  const context = buildContext({ standings, teams, seasonPhase: 'offseason' })
  const userTeamForDir = teams.find(t => t.id === campaign.teamId)
  const userTier = userTeamForDir
    ? getEffectiveExpectation(campaign, findOwnerForTeam(userTeamForDir.abbreviation)).tier
    : null
  const directions = {}
  for (const team of teams) {
    const teamRoster = allPlayers.filter(p => p.teamId === team.id)
    const dirTeam = (userTier && team.id === campaign.teamId)
      ? { ...team, effectiveExpectation: userTier }
      : team
    directions[team.id] = analyzeTeamDirection(dirTeam, teamRoster, context)
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
      // Mirror the live rookie draft (`stores/draft.js:finalizeRookieDraft`)
      // so auto-drafted rookies surface a draft-history card in the player
      // detail modal — round, pick, team, draft year all come from here.
      draftInfo: {
        year: gameYear,
        round: result.round,
        pick: result.pick,
        teamAbbreviation: team.abbreviation,
        teamName: team.name,
      },
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
  const pickCalendarBase = (campaign.currentSeasonYear ?? 2025) - gameYear + 1
  await rollDraftPicks(teams, campaignId, gameYear, gameYear + 5, pickCalendarBase)

  // 8. Mark draft completed
  campaign[`rookieDraftCompleted_${gameYear}`] = true
  // Phase normalization: after FA we're in 'offseason_draft'. startNewSeason
  // requires 'offseason'.
  if (campaign.phase === 'offseason_draft') {
    campaign.phase = 'offseason'
  }
  await CampaignRepository.save(campaign)

  // 8b. Finalize the USER team before the season starts. The one-click "sim the
  // whole offseason" delegates everything to the AI, so we must fill the user's
  // roster to the engine floor and hire a free coach if needed — startNewSeason's
  // backfill excludes the user team and its coach gate would otherwise throw (or
  // leave the user short-handed after expiry/retirements). Mirrors the manual
  // "Let AI finish setup" path. Best-effort: never block the season on it.
  try {
    const finishResult = await aiFinishUserTeamSetup(campaignId)
    // News: an auto-hired user coach is a real coaching move. Written straight
    // to the season feed (engine context — no stores here); the season is
    // still the OLD year at this point, matching where the other pre-rollover
    // offseason news lands.
    if (finishResult?.coachHired?.name) {
      try {
        const seasonYear = campaign.currentSeasonYear ?? campaign.current_season_year
        const seasonData = await SeasonRepository.get(campaignId, seasonYear)
        if (seasonData) {
          const item = BreakingNewsService.coachHired({
            coachName: finishResult.coachHired.name,
            teamName: finishResult.coachHired.team ?? 'Your team',
            date: campaign.currentDate ?? `${seasonYear + 1}-07-01`,
          })
          if (!seasonData.news) seasonData.news = []
          const record = {
            id: `news_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            event_type: 'coaching',
            headline: item.headline,
            body: item.body,
            date: item.date,
          }
          // Carry the additive translation-template fields through when present.
          if (item.headline_tpl) {
            record.headline_tpl = item.headline_tpl
            record.headline_params = item.headline_params ?? null
          }
          if (item.body_tpl) {
            record.body_tpl = item.body_tpl
            record.body_params = item.body_params ?? null
          }
          seasonData.news.push(record)
          if (seasonData.news.length > 50) seasonData.news = seasonData.news.slice(-50)
          await SeasonRepository.save(seasonData)
        }
      } catch (newsErr) {
        console.warn('[Offseason] coach hire news failed:', newsErr)
      }
    }
  } catch (err) {
    console.warn('[Offseason] aiFinishUserTeamSetup failed:', err)
  }

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
  // Per-player season stats so AI offers reflect how the FA actually produced —
  // keeps the FA market consistent with the production-aware re-sign valuation.
  const faStatsLookup = buildSeasonStatsLookup(seasonData)
  const getPlayerStatsFn = (id) => faStatsLookup[id] ?? null

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
    getPlayerStatsFn,
    capNumbers: capNumbersFor(campaign),
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
  // Production stats so each FA judges offers against their production-aware value.
  const faStatsLookup = buildSeasonStatsLookup(seasonData)

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
    }, faStatsLookup[player.id] ?? null)

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
      }, faStatsLookup[player.id] ?? null)
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
    if (!targetTeam) {
      // Winning team is missing from the league snapshot (orphaned offer
      // from a deleted/merged team, etc). Surface the user's offer in the
      // declined list with an unsigned reason rather than silently dropping
      // it — otherwise the offer just vanishes from the wrap-up modal and
      // the player resurfaces in the FA pool with no explanation.
      console.warn('[resolveFreeAgency] Winning team not found for player', player.id, 'teamId=', winningOffer.teamId)
      if (userOffer) {
        declined.push({
          playerId: player.id,
          playerName,
          signedWith: 'unsigned',
          signedWithAbbr: null,
          userOffer,
          winningOffer: null,
          reason: 'No team finalized the bid — the player went unsigned.',
        })
      }
      continue
    }

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
  // Outside signings can push all the way to the SECOND APRON (spending past
  // the cap is a penalized choice, not a block — the ops lock only bites above
  // apron 2). Bird-rights re-signs and minimum-salary deals are exempt.
  const userCapNumbers = capNumbersFor(campaign)
  const userCapSpace = (userCapNumbers.secondApron ?? userCapNumbers.salaryCap ?? SALARY_CAP) - userRosterPayroll
  // Bird-rights signings (re-signing your own player from last season) don't
  // count toward the overflow check — real NBA teams can exceed the cap to
  // retain their own free agents. Minimum-salary offers ride the minimum
  // exception. Only the NEW non-minimum outside signings need to fit.
  const isUserIncumbent = (player) => {
    const prev = player?.previousTeamId ?? player?.previous_team_id ?? null
    return prev != null && String(prev) === String(userTeamId)
  }
  const isMinOffer = (x) => (x.offer?.salary || 0) <= veteranMinSalary(x.player)
  const nonBirdSignings = pendingUserSignings.filter(x => !isUserIncumbent(x.player) && !isMinOffer(x))
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
    // auto-finalize since Bird rights bypass the cap, and minimum-salary
    // deals auto-finalize under the minimum exception; the user shouldn't
    // be forced to "pick" between keeping their own player and a free
    // agent that's competing for the same cap dollars.
    for (const { player, offer } of pendingUserSignings.filter(x => isUserIncumbent(x.player) || isMinOffer(x))) {
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

/**
 * Run the rookie draft lottery for the current offseason. Persists the
 * result on the campaign so subsequent reads (results view, the actual
 * draft trigger) all see the same outcome. Idempotent — if the lottery
 * has already been run this offseason, returns the cached result.
 *
 * Guarded so the lottery can only run during the offseason and only
 * once per year. The user is gated into running it before free agency
 * by the CampaignHomeView CTA (replaces "Enter Free Agency" while
 * draftLotteryCompleted is false).
 *
 * @param {string} campaignId
 * @returns {Promise<Object>} The lottery result ({ actualOrder, runAt, year })
 */
export async function runDraftLotteryForCampaign(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  // Idempotency: return the cached lottery if a VALID one already ran this
  // offseason. A cached result with an empty/missing actualOrder (e.g. rolled
  // before teams finished loading, or by an older build) is treated as invalid
  // so the click re-rolls a real lottery instead of handing back a frozen board.
  const cached = campaign.settings?.draftLottery
  if (
    campaign.settings?.draftLotteryCompleted &&
    Array.isArray(cached?.actualOrder) &&
    cached.actualOrder.length > 0
  ) {
    return cached
  }

  // Phase guard: lottery should only fire in the offseason proper, before
  // free agency. After FA the phase shifts to 'offseason_free_agency' /
  // 'offseason_draft' and the lottery action button is hidden anyway, but
  // the guard prevents accidental console-triggered runs at the wrong time.
  if (campaign.phase !== 'offseason') {
    throw new Error(`Draft lottery can only be run during the offseason (current phase: ${campaign.phase})`)
  }

  const teams = await TeamRepository.getAllForCampaign(campaignId)
  const seasonYear = campaign.currentSeasonYear ?? 2025
  const seasonData = await SeasonRepository.get(campaignId, seasonYear)
  const standings = seasonData?.standings || { east: [], west: [] }

  // gameYear here is the upcoming draft's year (the year the rookies enter
  // the league), matching simFullOffseason's convention.
  const gameYear = seasonYear + 1
  const lotteryResult = runDraftLottery(teams, standings, gameYear)

  campaign.settings = campaign.settings ?? {}
  campaign.settings.draftLottery = lotteryResult
  campaign.settings.draftLotteryCompleted = true
  await CampaignRepository.save(campaign)

  return lotteryResult
}
