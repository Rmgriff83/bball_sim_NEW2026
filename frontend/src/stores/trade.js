import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { SALARY_CAP } from '@/engine/data/teams'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { SeasonManager } from '@/engine/season/SeasonManager'
import { useSyncStore } from '@/stores/sync'
import {
  evaluateTrade,
  generateWeeklyProposals,
  buildAiOffer,
  findTargetPlayers,
  identifyNeed,
  analyzeTeamDirection,
  buildContext,
  expireStaleProposals,
  isBeforeDeadline,
} from '@/engine/ai/AITradeService'
import { buildPickValueFn } from '@/engine/ai/PickValuationService'
import {
  validateSalaryCap,
  buildTradeDetails,
  executeTrade as executeTradeEngine,
  formatTradeForDisplay,
} from '@/engine/finance/TradeExecutor'

/**
 * Move draft picks between teams during a trade and persist the changed
 * teams. Uses a global pickId lookup across every team's draftPicks
 * array — picks SHOULD live on exactly one team at any moment, so this
 * find-anywhere approach is more robust than guessing the source team
 * from the trade asset's `from` field, which can be stale if a prior
 * AI-side trade moved the pick out from under the wizard's snapshot.
 *
 * Replaces an earlier inline pattern in executeTrade / acceptProposal
 * that did `findIndex` on the expected source team only and silently
 * skipped picks it couldn't find — that was the root cause of a bug
 * where users acquired picks that never landed in their draftPicks
 * array (the trade appeared to succeed but the pick stayed put).
 *
 * @param {Object} args
 * @param {Array}  args.pickAssets  - The `pick` assets from buildTradeDetails
 * @param {Array}  args.allTeams    - All teams in the campaign (will be mutated for the touched ones)
 * @throws if any pick can't be located on any team, OR if the
 *   destination team id doesn't resolve to a known team. Failing
 *   loudly stops a trade from committing with a ghost asset.
 */
async function _movePicksBetweenTeams({ pickAssets, allTeams }) {
  if (!pickAssets || pickAssets.length === 0) return

  // Build pickId → { team, indexInDraftPicks } lookup once per trade.
  // For a 30-team league with ~10 picks each this is ~300 entries —
  // negligible cost and saves us repeated O(team × picks) scans.
  const pickLocations = new Map()
  for (const team of allTeams) {
    const picks = team.draftPicks || []
    for (let i = 0; i < picks.length; i++) {
      pickLocations.set(picks[i].id, { team, indexInTeam: i })
    }
  }

  const updatedTeamIds = new Set()
  for (const asset of pickAssets) {
    const located = pickLocations.get(asset.pickId)
    if (!located) {
      throw new Error(`Draft pick ${asset.pickId} not found on any team — trade aborted.`)
    }

    const sourceTeam = located.team
    const destTeam = allTeams.find(t => t.id === asset.to)
    if (!destTeam) {
      throw new Error(`Destination team ${asset.to} not found — trade aborted.`)
    }

    // splice() invalidates other indexes into the same array, so we
    // splice in place. The pickLocations map is regenerated below for
    // any subsequent picks in the same trade (e.g. a multi-pick deal
    // where pick #2's source team might be the same as pick #1's).
    const [pick] = sourceTeam.draftPicks.splice(located.indexInTeam, 1)
    pick.currentOwnerId = destTeam.id
    pick.current_owner_id = destTeam.id
    pick.isTraded = true
    pick.is_traded = true
    if (!destTeam.draftPicks) destTeam.draftPicks = []
    destTeam.draftPicks.push(pick)

    updatedTeamIds.add(sourceTeam.id)
    updatedTeamIds.add(destTeam.id)

    // Rebuild the index map for the source team since splice shifted
    // every subsequent pick's index. Cheap — only touches the one team
    // we just mutated, not the whole league.
    const refreshedPicks = sourceTeam.draftPicks
    for (let i = 0; i < refreshedPicks.length; i++) {
      pickLocations.set(refreshedPicks[i].id, { team: sourceTeam, indexInTeam: i })
    }
    pickLocations.delete(asset.pickId)
    // The dest team's index map entry for the new pick gets added at
    // the array's tail; only matters if a later asset in this trade
    // moves the same pick back out, which shouldn't happen but is safe.
    pickLocations.set(asset.pickId, { team: destTeam, indexInTeam: destTeam.draftPicks.length - 1 })
  }

  const teamsToSave = [...updatedTeamIds]
    .map(id => allTeams.find(t => t.id === id))
    .filter(Boolean)
  if (teamsToSave.length > 0) {
    await TeamRepository.saveBulk(teamsToSave)
  }
}

// Whether the USER may propose/make trades right now. The in-season trade
// deadline (Feb 5) only governs the regular season; once the playoffs are over
// and the campaign enters any offseason phase, user→AI trades reopen. (AI-to-AI
// trades and AI-generated proposals stay regular-season-only — those gates live
// in AITradeService and are intentionally left unchanged.)
function userTradingAllowed(campaign, currentDate, seasonYear) {
  const phase = campaign?.phase ?? campaign?.settings?.season_phase ?? 'regular_season'
  if (typeof phase === 'string' && phase.startsWith('offseason')) {
    // Forbid trading during the live rookie draft for now — picks are being
    // consumed there and the user is in the draft room, not the Trades tab.
    // TODO: support draft-day trades (allow 'offseason_draft') in the future.
    if (phase === 'offseason_draft') return false
    return true
  }
  return isBeforeDeadline(currentDate, seasonYear)
}

export const useTradeStore = defineStore('trade', () => {
  // State
  const tradeableTeams = ref([])
  const selectedTeam = ref(null)
  const selectedTeamRoster = ref([])
  const selectedTeamPicks = ref([])
  const userAssets = ref({ roster: [], picks: [], team: null })
  const tradeHistory = ref([])

  // Trade proposal state
  const userOffering = ref([]) // Assets user is giving
  const userRequesting = ref([]) // Assets user wants

  // AI-initiated trade proposals
  const pendingProposals = ref([])

  // Trading block
  const userTradingBlock = ref([])

  // Whether the season's trade deadline has passed. Set by fetchTradeableTeams /
  // fetchPendingProposals so the UI can disable trade actions (the execute paths
  // also hard-block, but disabling avoids a dead-end error after building a deal).
  const tradeDeadlinePassed = ref(false)

  // Negotiation prefill — set when the user clicks "Negotiate" on an inbound
  // AI proposal. TradesTab watches this and forwards it to TradeCenter, which
  // opens the wizard prefilled with the proposal's asset breakdown so the user
  // can adjust and counter-propose. Shape:
  //   { teamId, receiving: [proposal.ai_gives assets], giving: [proposal.ai_receives assets] }
  const negotiationPrefill = ref(null)
  // Tracks the inbound AI proposal that seeded the current negotiation
  // session, so a successful executeTrade can mark that source proposal
  // accepted instead of leaving it pending. Without this, a trade
  // negotiated through the wizard goes through correctly but the stale
  // offer is re-served the next day because `executeTrade` doesn't know
  // it originated from a proposal. Set in setNegotiationFromProposal;
  // consumed and cleared inside executeTrade.
  const pendingNegotiationProposalId = ref(null)

  const loading = ref(false)
  const proposing = ref(false)
  const error = ref(null)
  const lastProposalResult = ref(null)

  // Getters
  const selectedTeamId = computed(() => selectedTeam.value?.id)

  const userOfferingSalary = computed(() => {
    return userOffering.value
      .filter(a => a.type === 'player')
      .reduce((sum, a) => sum + (a.contractSalary || 0), 0)
  })

  const userRequestingSalary = computed(() => {
    return userRequesting.value
      .filter(a => a.type === 'player')
      .reduce((sum, a) => sum + (a.contractSalary || 0), 0)
  })

  const salaryDifference = computed(() => {
    return userRequestingSalary.value - userOfferingSalary.value
  })

  const canProposeTrade = computed(() => {
    return userOffering.value.length > 0 && userRequesting.value.length > 0 && !proposing.value
  })

  // Helper: build a player lookup function from an array
  // Uses String keys to prevent type mismatches (number vs string from IndexedDB)
  function _buildPlayerLookup(players) {
    const map = {}
    for (const p of players) {
      map[String(p.id)] = p
    }
    return (playerId) => map[String(playerId)] || null
  }

  // Helper: build a draft-pick display function across every team's pick
  // pool. Without this, breaking-news / display strings fall back to the
  // raw "Pick #<uuid>" default in `buildTradeDetails` — which produces the
  // ugly headline the user reported. Format example: "2026 R1 Pick (PHI)".
  function _buildPickDisplayFn(allTeams) {
    const byId = new Map()
    for (const team of allTeams || []) {
      for (const pick of team.draftPicks || []) {
        if (pick?.id) byId.set(String(pick.id), pick)
      }
    }
    return (pickId) => {
      const pick = byId.get(String(pickId))
      if (!pick) return 'Draft Pick'
      const year = pick.year || ''
      const round = pick.round ? `R${pick.round}` : ''
      const orig = pick.original_team_abbreviation || pick.originalTeamAbbreviation || ''
      const parts = [year, round, 'Pick']
      const main = parts.filter(Boolean).join(' ').trim()
      return orig ? `${main} (${orig})` : main || 'Draft Pick'
    }
  }

  // Helper: get campaign year
  async function _getCampaignYear(campaignId) {
    const campaign = await CampaignRepository.get(campaignId)
    // CampaignManager's canonical field is `currentSeasonYear`; the others
    // are read-only fallbacks for older payload shapes and external sync.
    return campaign?.currentSeasonYear
      ?? campaign?.current_season_year
      ?? campaign?.settings?.currentYear
      ?? campaign?.year
      ?? new Date().getFullYear()
  }

  // Shared pre-execution guard for BOTH trade-commit paths (wizard executeTrade
  // and inbound-offer acceptProposal). Throws a user-facing Error — surfaced via
  // each caller's catch into `error` — if the trade can't legally commit:
  //   1. past the Feb 5 trade deadline
  //   2. fails the 125% + $100K salary-matching rule (hard block; capMode 'normal')
  //   3. references a player that has changed hands since the offer was built
  //      (prevents TradeExecutor.movePlayer from silently no-op'ing one side and
  //      committing a lopsided trade).
  // userGiving / userReceiving are API-format asset lists ({ type, playerId|pickId }).
  function _assertTradeAllowed({ userGiving, userReceiving, getPlayerFn, currentDate, seasonYear, userTeamId, aiTeamId, campaign }) {
    if (!userTradingAllowed(campaign, currentDate, seasonYear)) {
      throw new Error('The trade deadline has passed — no more trades can be made this season.')
    }

    const capCheck = validateSalaryCap({ userGiving, userReceiving, capMode: 'normal', getPlayerFn })
    if (!capCheck.valid) {
      throw new Error(capCheck.reason || 'Trade violates salary-cap matching rules.')
    }

    const nameOf = (p) => p
      ? `${p.firstName || p.first_name || ''} ${p.lastName || p.last_name || ''}`.trim()
      : ''
    const teamOf = (playerId) => {
      const p = getPlayerFn(playerId)
      return p ? (p.teamId ?? p.team_id ?? null) : null
    }
    for (const a of userGiving) {
      if (a.type !== 'player') continue
      if (String(teamOf(a.playerId)) !== String(userTeamId)) {
        const who = nameOf(getPlayerFn(a.playerId)) || 'A player'
        throw new Error(`${who} is no longer on your roster — the trade can't be completed.`)
      }
    }
    for (const a of userReceiving) {
      if (a.type !== 'player') continue
      if (String(teamOf(a.playerId)) !== String(aiTeamId)) {
        const who = nameOf(getPlayerFn(a.playerId)) || 'A requested player'
        throw new Error(`${who} is no longer available — the other team's roster changed since this offer.`)
      }
    }
  }

  // Recompute and persist `total_payroll` for the two teams a trade touched, so
  // Cap Space displays don't drift. Re-reads the teams fresh (AFTER any pick
  // moves have saved them) to avoid clobbering draftPicks with a stale snapshot,
  // and sums salaries by current teamId from the executor's post-trade arrays.
  async function _persistPostTradePayrolls({ campaignId, userTeamId, aiTeamId, postTradePlayers }) {
    const sumFor = (teamId) => postTradePlayers.reduce((sum, p) => {
      const tid = p.teamId ?? p.team_id
      return String(tid) === String(teamId)
        ? sum + parseFloat(p.contractSalary ?? p.contract_salary ?? 0)
        : sum
    }, 0)

    const [freshUserTeam, freshAiTeam] = await Promise.all([
      TeamRepository.get(campaignId, userTeamId),
      TeamRepository.get(campaignId, aiTeamId),
    ])
    const apply = (team, payroll) => {
      if (!team) return null
      team.total_payroll = payroll
      team.totalPayroll = payroll
      return team
    }
    const toSave = [
      apply(freshUserTeam, sumFor(userTeamId)),
      apply(freshAiTeam, sumFor(aiTeamId)),
    ].filter(Boolean)
    if (toSave.length > 0) await TeamRepository.saveBulk(toSave)
  }

  // Actions
  async function fetchTradeableTeams(campaignId) {
    loading.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const allTeams = await TeamRepository.getAllForCampaign(campaignId)
      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

      // Load standings to attach win/loss records. Use the canonical season-year
      // chain (matching the other trade.js callers) — NOT campaign.gameYear, which
      // is a 1,2,3 counter and would yield a wrong year if currentSeasonYear is absent.
      const year = campaign?.currentSeasonYear
        ?? campaign?.current_season_year
        ?? campaign?.settings?.currentYear
        ?? campaign?.year
        ?? new Date().getFullYear()
      const currentDate = campaign?.currentDate ?? campaign?.current_date ?? new Date().toISOString().split('T')[0]
      tradeDeadlinePassed.value = !userTradingAllowed(campaign, currentDate, year)
      const seasonData = await SeasonRepository.get(campaignId, year)
      const standings = seasonData?.standings ?? { east: [], west: [] }
      const allStandings = [...(standings.east ?? []), ...(standings.west ?? [])]

      // Build a lookup from teamId to standings record
      const standingsMap = {}
      for (const s of allStandings) {
        standingsMap[s.teamId] = s
      }

      // Group rosters by team so the displayed direction comes from the SAME
      // canonical analyzer (analyzeTeamDirection) the trade evaluator uses —
      // not a winPct-only heuristic that could never surface 'title_contender'
      // and contradicted the verdict shown after proposing.
      const rostersByTeamId = new Map()
      for (const p of allPlayers) {
        const tid = p.teamId ?? p.team_id
        if (tid == null) continue
        if (!rostersByTeamId.has(tid)) rostersByTeamId.set(tid, [])
        rostersByTeamId.get(tid).push(p)
      }
      const context = buildContext({ standings, teams: allTeams, seasonPhase: 'regular_season' })

      // Filter out the user's team and enrich with record + direction
      tradeableTeams.value = allTeams
        .filter(t => t.id !== userTeamId)
        .map(t => {
          const s = standingsMap[t.id]
          const wins = s?.wins ?? 0
          const losses = s?.losses ?? 0
          const teamRoster = rostersByTeamId.get(t.id) ?? []
          const direction = analyzeTeamDirection(t, teamRoster, context)
          const totalPayroll = t.total_payroll ?? t.totalPayroll ?? 0
          return {
            ...t,
            record: { wins, losses },
            direction,
            cap_space: SALARY_CAP - totalPayroll,
          }
        })

      return tradeableTeams.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch teams'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchTeamDetails(campaignId, teamId) {
    loading.value = true
    error.value = null
    try {
      const team = await TeamRepository.get(campaignId, teamId)
      const roster = await PlayerRepository.getByTeam(campaignId, teamId)

      // Merge with existing selectedTeam to preserve enriched props (record, direction, cap_space)
      const existing = selectedTeam.value
      if (existing && existing.id === teamId) {
        selectedTeam.value = { ...existing, ...team, record: existing.record, direction: existing.direction, cap_space: existing.cap_space }
      } else {
        selectedTeam.value = team
      }
      selectedTeamRoster.value = roster
      selectedTeamPicks.value = team?.draftPicks ?? []

      return { team: selectedTeam.value, roster, picks: selectedTeamPicks.value }
    } catch (err) {
      error.value = err.message || 'Failed to fetch team details'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchUserAssets(campaignId) {
    loading.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const team = await TeamRepository.get(campaignId, userTeamId)
      const roster = await PlayerRepository.getByTeam(campaignId, userTeamId)

      userAssets.value = {
        roster,
        picks: team?.draftPicks ?? [],
        team,
      }
      return userAssets.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch your assets'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function proposeTrade(campaignId) {
    if (!canProposeTrade.value || !selectedTeam.value) return null

    proposing.value = true
    error.value = null
    lastProposalResult.value = null

    try {
      const campaign = await CampaignRepository.get(campaignId)
      // Canonical field set by CampaignManager is `currentSeasonYear`
      // (NOT settings.currentYear or top-level `year`). Reading from the
      // wrong field made `year` fall through to new Date().getFullYear(),
      // which then mismatched against campaign.currentDate's actual year
      // and broke the opening-week trade-quiet gate (`isInFirstWeekOfSeason`
      // got the wrong seasonYear and returned false on day 1).
      const year = campaign?.currentSeasonYear
        ?? campaign?.current_season_year
        ?? campaign?.settings?.currentYear
        ?? campaign?.year
        ?? new Date().getFullYear()
      const difficulty = campaign?.settings?.difficulty ?? 'pro'
      const seasonData = await SeasonRepository.get(campaignId, year)
      const allTeams = await TeamRepository.getAllForCampaign(campaignId)
      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

      const aiTeamId = selectedTeam.value.id
      const aiTeamRoster = await PlayerRepository.getByTeam(campaignId, aiTeamId)
      const getPlayerFn = _buildPlayerLookup(allPlayers)

      const standings = seasonData?.standings ?? { east: [], west: [] }
      const context = buildContext({ standings, teams: allTeams, seasonPhase: 'regular_season' })
      const getPickValueFn = buildPickValueFn({ allTeams, standings, allPlayers, currentSeasonYear: year })

      // Build the proposal in AI format: aiReceives = what user is offering, aiGives = what user is requesting
      const proposal = {
        aiReceives: userOffering.value.map(formatAssetForApi),
        aiGives: userRequesting.value.map(formatAssetForApi),
      }

      // Trade-deadline gate: surface a rejection rather than throwing here so the
      // wizard can show the reason inline (execute paths hard-block separately).
      const currentDate = campaign?.currentDate ?? campaign?.current_date ?? new Date().toISOString().split('T')[0]
      if (!userTradingAllowed(campaign, currentDate, year)) {
        const result = {
          decision: 'reject',
          reason: 'The trade deadline has passed — no more trades can be made this season.',
          deadlinePassed: true,
        }
        lastProposalResult.value = result
        return result
      }

      const result = evaluateTrade({
        proposal,
        team: selectedTeam.value,
        teamRoster: aiTeamRoster,
        difficulty,
        context,
        getPlayerFn,
        getPickValueFn,
      })

      // Attach the engine-backed salary-cap verdict (125% + $100K matching, hard
      // block on the execute paths) so the wizard reflects the same rule the
      // executor enforces rather than its own ad-hoc client check.
      const capCheck = validateSalaryCap({
        userGiving: proposal.aiReceives,
        userReceiving: proposal.aiGives,
        capMode: 'normal',
        getPlayerFn,
      })
      result.capValid = capCheck.valid
      result.capReason = capCheck.valid ? null : capCheck.reason

      lastProposalResult.value = result
      return result
    } catch (err) {
      error.value = err.message || 'Failed to propose trade'
      throw err
    } finally {
      proposing.value = false
    }
  }

  async function executeTrade(campaignId) {
    if (!selectedTeam.value) return null

    proposing.value = true
    error.value = null

    try {
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const userTeam = await TeamRepository.get(campaignId, userTeamId)
      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
      const allTeams = await TeamRepository.getAllForCampaign(campaignId)
      const getPlayerFn = _buildPlayerLookup(allPlayers)
      const getPickDisplayFn = _buildPickDisplayFn(allTeams)

      // Build trade details
      const details = buildTradeDetails({
        userTeam,
        aiTeam: selectedTeam.value,
        userGives: userOffering.value.map(formatAssetForApi),
        userReceives: userRequesting.value.map(formatAssetForApi),
        getPlayerFn,
        getPickDisplayFn,
      })

      // Separate players into user roster vs league players
      const userRoster = allPlayers.filter(p => {
        const tid = p.teamId ?? p.team_id
        return tid == userTeamId
      })
      const leaguePlayers = allPlayers.filter(p => {
        const tid = p.teamId ?? p.team_id
        return tid != userTeamId
      })

      const currentDate = campaign?.currentDate ?? campaign?.current_date ?? new Date().toISOString().split('T')[0]
      const seasonYear = campaign?.currentSeasonYear
        ?? campaign?.current_season_year
        ?? campaign?.settings?.currentYear
        ?? campaign?.year
        ?? new Date().getFullYear()

      // Hard gate: deadline, salary-cap matching, and asset ownership. Throws
      // (caught below) before anything is mutated if the trade can't legally commit.
      _assertTradeAllowed({
        userGiving: userOffering.value.map(formatAssetForApi),
        userReceiving: userRequesting.value.map(formatAssetForApi),
        getPlayerFn,
        currentDate,
        seasonYear,
        userTeamId,
        aiTeamId: selectedTeam.value.id,
        campaign,
      })

      // Collect all draft picks from both teams for the executor
      const aiTeamObj = await TeamRepository.get(campaignId, selectedTeam.value.id)
      const allDraftPicks = [
        ...(userTeam.draftPicks || []),
        ...(aiTeamObj?.draftPicks || []),
      ]

      const result = executeTradeEngine({
        tradeDetails: details,
        leaguePlayers,
        userRoster,
        draftPicks: allDraftPicks,
        userTeam: { id: userTeamId, abbreviation: userTeam.abbreviation },
        currentDate,
      })

      // Persist player changes: stamp the FULL team identity on all moved
      // players (both casings + abbreviation + free-agent flag), mirroring the
      // AI-to-AI trade path — a bare teamId left teamAbbreviation pointing at
      // the old team (stale abbr in the player modal) and snake_case readers
      // misplacing the player.
      const abbrByTeamId = new Map([
        [String(userTeamId), userTeam.abbreviation],
        [String(selectedTeam.value.id), aiTeamObj?.abbreviation ?? selectedTeam.value.abbreviation],
      ])
      const playersToSave = []
      for (const asset of details.assets) {
        if (asset.type === 'player') {
          // Find the player in the combined result arrays
          const player = [...result.updatedLeaguePlayers, ...result.updatedUserRoster]
            .find(p => (p.id ?? '') == asset.playerId)
          if (player) {
            const destAbbr = abbrByTeamId.get(String(asset.to)) ?? player.teamAbbreviation
            player.teamId = asset.to
            player.team_id = asset.to
            player.teamAbbreviation = destAbbr
            player.team_abbreviation = destAbbr
            player.isFreeAgent = 0
            player.is_free_agent = 0
            player.campaignId = campaignId
            playersToSave.push(player)
          }
        }
      }

      if (playersToSave.length > 0) {
        await PlayerRepository.saveBulk(playersToSave)
      }

      // Clean the user's saved lineup: any player traded AWAY must be pulled out
      // of the starting five and target minutes. Otherwise the lineup keeps a
      // dangling starter id (and the gone player's minutes still total 240), so
      // the pre-game check would let you sim with a phantom starter.
      const outgoingPlayerIds = new Set(
        details.assets
          .filter(a => a.type === 'player' && String(a.from) === String(userTeamId))
          .map(a => String(a.playerId))
      )
      if (outgoingPlayerIds.size > 0 && campaign?.settings?.lineup) {
        const lu = campaign.settings.lineup
        const starters = Array.isArray(lu.starters)
          ? lu.starters.map(id => (outgoingPlayerIds.has(String(id)) ? null : id))
          : lu.starters
        const target_minutes = { ...(lu.target_minutes || {}) }
        for (const id of Object.keys(target_minutes)) {
          if (outgoingPlayerIds.has(String(id))) delete target_minutes[id]
        }
        await CampaignRepository.updateSettings(campaignId, {
          lineup: { ...lu, starters, target_minutes },
        })
      }

      // Persist draft pick ownership changes via the shared helper. Uses
      // a global pickId lookup across every team's draftPicks so a pick
      // that's drifted out of aiTeamObj.draftPicks (e.g. moved to a
      // third team between wizard load and trade execute) still resolves
      // correctly. Throws if a pick is genuinely missing — no more
      // silent "successful" trades that omit the pick move.
      const pickAssets = details.assets.filter(a => a.type === 'pick')
      if (pickAssets.length > 0) {
        const allTeamsForPickMove = await TeamRepository.getAllForCampaign(campaignId)
        await _movePicksBetweenTeams({ pickAssets, allTeams: allTeamsForPickMove })

        // Belt-and-suspenders: re-read the user's team and confirm every
        // expected received pick actually landed. Logs a warning if not
        // (Fix 1 makes this unreachable in normal flow, but cloud-sync
        // races could still produce a divergence).
        const persistedUserTeam = await TeamRepository.get(campaignId, userTeamId)
        for (const asset of pickAssets) {
          if (asset.to !== userTeamId) continue
          const owns = (persistedUserTeam?.draftPicks || []).some(p => p.id === asset.pickId)
          if (!owns) {
            console.warn('[trade] post-execute verification: user did not end up owning expected pick', asset.pickId)
          }
        }
      }

      // Recompute both teams' payroll so Cap Space stays accurate post-trade.
      await _persistPostTradePayrolls({
        campaignId,
        userTeamId,
        aiTeamId: selectedTeam.value.id,
        postTradePlayers: [...result.updatedUserRoster, ...result.updatedLeaguePlayers],
      })

      // Save trade to history in season data & update player stats team.
      // `seasonYear` was resolved above (canonical currentSeasonYear) and reused
      // here so the deadline gate and the season-data lookup never disagree.
      const year = seasonYear
      const seasonData = await SeasonRepository.get(campaignId, year)
      if (seasonData) {
        // Update team ID in player stats so league leaders / stats history reflect the new team
        for (const asset of details.assets) {
          if (asset.type === 'player') {
            SeasonManager.updatePlayerStatsTeam(seasonData, asset.playerId, asset.to)
          }
        }

        if (!seasonData.tradeHistory) seasonData.tradeHistory = []
        seasonData.tradeHistory.push({
          id: `trade_${Date.now()}`,
          ...result.trade,
        })
        await SeasonRepository.save(seasonData)
      }

      // Mark for cloud sync
      useSyncStore().markDirty()

      // Build trade context for breaking news before clearing state
      const assetsSent = [
        ...details.assets
          .filter(a => a.type === 'player' && a.from == userTeamId)
          .map(a => { const p = getPlayerFn(a.playerId); return p ? `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() : 'Unknown' }),
        ...details.assets
          .filter(a => a.type === 'pick' && a.from == userTeamId)
          .map(a => a.pickDisplay || `Draft Pick`),
      ]
      const assetsReceived = [
        ...details.assets
          .filter(a => a.type === 'player' && a.to == userTeamId)
          .map(a => { const p = getPlayerFn(a.playerId); return p ? `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() : 'Unknown' }),
        ...details.assets
          .filter(a => a.type === 'pick' && a.to == userTeamId)
          .map(a => a.pickDisplay || `Draft Pick`),
      ]
      const tradeContext = {
        playersSent: assetsSent,
        playersReceived: assetsReceived,
        otherTeamName: selectedTeam.value?.name || 'Unknown',
        userTeamName: userTeam?.name || 'Unknown',
        date: currentDate,
      }

      // If this wizard session was seeded by an inbound AI proposal,
      // mark that source proposal accepted so it doesn't get re-served
      // tomorrow as a stale offer. Guard with a team-match check: if
      // the user switched the other team mid-wizard, the executed trade
      // isn't with the original proposer, so leave the source pending.
      const sourceProposalId = pendingNegotiationProposalId.value
      pendingNegotiationProposalId.value = null
      if (sourceProposalId) {
        const sourceProposal = pendingProposals.value.find(p => p.id === sourceProposalId)
        const sourceTeamId = sourceProposal?.proposing_team_id ?? sourceProposal?.proposing_team?.id ?? null
        if (sourceProposal && String(sourceTeamId) === String(selectedTeam.value.id)) {
          pendingProposals.value = pendingProposals.value.filter(p => p.id !== sourceProposalId)
          await _updateProposalStatus(campaignId, sourceProposalId, 'accepted')
        }
      }

      // Clear the trade after successful execution
      clearTrade()

      return { ...result, tradeContext }
    } catch (err) {
      error.value = err.message || 'Failed to execute trade'
      throw err
    } finally {
      proposing.value = false
    }
  }

  async function fetchTradeHistory(campaignId) {
    loading.value = true
    error.value = null
    try {
      const year = await _getCampaignYear(campaignId)
      const seasonData = await SeasonRepository.get(campaignId, year)

      const rawTrades = seasonData?.tradeHistory ?? []
      tradeHistory.value = rawTrades.map(formatTradeForDisplay)
      return tradeHistory.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch trade history'
      throw err
    } finally {
      loading.value = false
    }
  }

  // AI-initiated trade proposal actions
  async function fetchPendingProposals(campaignId) {
    try {
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      // Canonical field set by CampaignManager is `currentSeasonYear`
      // (NOT settings.currentYear or top-level `year`). Reading from the
      // wrong field made `year` fall through to new Date().getFullYear(),
      // which then mismatched against campaign.currentDate's actual year
      // and broke the opening-week trade-quiet gate (`isInFirstWeekOfSeason`
      // got the wrong seasonYear and returned false on day 1).
      const year = campaign?.currentSeasonYear
        ?? campaign?.current_season_year
        ?? campaign?.settings?.currentYear
        ?? campaign?.year
        ?? new Date().getFullYear()
      const difficulty = campaign?.settings?.difficulty ?? 'pro'
      const currentDate = campaign?.currentDate ?? campaign?.current_date ?? new Date().toISOString().split('T')[0]
      tradeDeadlinePassed.value = !userTradingAllowed(campaign, currentDate, year)

      const allTeams = await TeamRepository.getAllForCampaign(campaignId)
      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
      const seasonData = await SeasonRepository.get(campaignId, year)

      const getPlayerFn = _buildPlayerLookup(allPlayers)

      // 1. Load persisted proposals from seasonData
      const allProposals = seasonData?.tradeProposals ?? []

      // 2. Expire stale proposals
      expireStaleProposals(allProposals, currentDate)

      // 3. Load trading block
      const tradingBlockIds = campaign?.settings?.tradingBlock ?? []
      userTradingBlock.value = tradingBlockIds

      // 4. Generate new proposals — only if game date has advanced since last generation
      const lastGenDate = seasonData?.lastProposalGenerationDate ?? null
      const shouldGenerate = !lastGenDate || lastGenDate !== currentDate

      let newProposals = []
      if (shouldGenerate) {
        const aiTeams = allTeams.filter(t => t.id !== userTeamId)
        const userRoster = allPlayers.filter(p => {
          const tid = p.teamId ?? p.team_id
          return tid == userTeamId
        })

        const standings = seasonData?.standings ?? { east: [], west: [] }

        const getTeamRosterFn = (teamAbbr) => {
          return allPlayers.filter(p => {
            const abbr = p.teamAbbreviation ?? p.team_abbreviation ?? ''
            return abbr === teamAbbr
          })
        }

        // Picks an AI team currently owns, so its return offers can include them.
        const picksByOwner = new Map()
        for (const t of allTeams) {
          for (const pk of t.draftPicks || []) {
            const owner = pk.currentOwnerId ?? pk.current_owner_id ?? t.id
            if (!picksByOwner.has(owner)) picksByOwner.set(owner, [])
            picksByOwner.get(owner).push(pk)
          }
        }
        const getTeamPicksFn = (teamId) => picksByOwner.get(teamId) || []
        const getPickValueFn = buildPickValueFn({ allTeams, standings, allPlayers, currentSeasonYear: year })

        newProposals = generateWeeklyProposals({
          aiTeams,
          userRoster,
          standings,
          allTeams,
          currentDate,
          seasonYear: year,
          difficulty,
          seasonPhase: 'regular_season',
          pendingProposals: allProposals,
          getTeamRosterFn,
          getPlayerFn,
          getTeamPicksFn,
          getPickValueFn,
          userTradingBlock: tradingBlockIds,
        })

        // Track last generation date so we don't re-generate on same game day
        if (seasonData) {
          seasonData.lastProposalGenerationDate = currentDate
        }
      }

      // 5. Enrich new proposals
      for (const proposal of newProposals) {
        proposal.id = `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        const proposingTeam = allTeams.find(t => String(t.id) === String(proposal.proposing_team_id))
        proposal.proposing_team = proposingTeam ? {
          id: proposingTeam.id,
          abbreviation: proposingTeam.abbreviation,
          city: proposingTeam.city,
          name: proposingTeam.name,
          primary_color: proposingTeam.primary_color || proposingTeam.primaryColor || null,
        } : {
          id: proposal.proposing_team_id,
          abbreviation: proposal.proposing_team_abbreviation,
          city: '',
          name: proposal.proposing_team_name,
          primary_color: null,
        }

        // Merge into allProposals
        allProposals.push(proposal)
      }

      // 6. Save back to seasonData
      if (seasonData) {
        seasonData.tradeProposals = allProposals
        await SeasonRepository.save(seasonData)
      }

      // 7. Enrich all pending proposals for the UI and set state
      // Use == for ID comparisons to handle number/string mismatches from IndexedDB
      const playerStatsBucket = seasonData?.playerStats ?? {}
      const buildSeasonStats = (playerId) => {
        const raw = playerStatsBucket[String(playerId)]
        const gp = raw?.gamesPlayed ?? 0
        if (!raw || gp <= 0) return null
        const round1 = v => Math.round(v * 10) / 10
        const tpa = raw.threePointersAttempted ?? 0
        const tpm = raw.threePointersMade ?? 0
        return {
          gp,
          ppg: round1((raw.points ?? 0) / gp),
          rpg: round1((raw.rebounds ?? 0) / gp),
          apg: round1((raw.assists ?? 0) / gp),
          spg: round1((raw.steals ?? 0) / gp),
          bpg: round1((raw.blocks ?? 0) / gp),
          tpPct: tpa > 0 ? Math.round((tpm / tpa) * 1000) / 10 : null,
        }
      }
      const enrichAsset = (asset, proposalTeamId) => {
        if (asset.type === 'player') {
          const player = getPlayerFn(asset.playerId)
          const seasonStats = buildSeasonStats(asset.playerId)
          return { ...asset, player: player || null, seasonStats }
        }
        if (asset.type === 'pick') {
          const team = allTeams.find(t => String(t.id) === String(proposalTeamId))
          const pick = (team?.draftPicks || []).find(p => String(p.id) === String(asset.pickId))
          return { ...asset, pick: pick || null }
        }
        return asset
      }

      const pending = allProposals.filter(p => p.status === 'pending')
      for (const proposal of pending) {
        if (!proposal.proposing_team) {
          const proposingTeam = allTeams.find(t => String(t.id) === String(proposal.proposing_team_id))
          proposal.proposing_team = proposingTeam ? {
            id: proposingTeam.id,
            abbreviation: proposingTeam.abbreviation,
            city: proposingTeam.city,
            name: proposingTeam.name,
            primary_color: proposingTeam.primary_color || proposingTeam.primaryColor || null,
          } : null
        }
        const innerProposal = proposal.proposal || {}
        proposal.ai_gives = (innerProposal.aiGives || []).map(a => enrichAsset(a, proposal.proposing_team_id))
        proposal.ai_receives = (innerProposal.aiReceives || []).map(a => enrichAsset(a, proposal.proposing_team_id))
      }

      pendingProposals.value = pending
      return pendingProposals.value
    } catch (err) {
      console.error('Failed to fetch trade proposals:', err)
      pendingProposals.value = []
      return []
    }
  }

  async function acceptProposal(campaignId, proposalId) {
    proposing.value = true
    error.value = null
    try {
      const proposal = pendingProposals.value.find(p => p.id === proposalId)
      if (!proposal) throw new Error('Proposal not found')

      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const userTeam = await TeamRepository.get(campaignId, userTeamId)
      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
      const allTeams = await TeamRepository.getAllForCampaign(campaignId)
      const getPlayerFn = _buildPlayerLookup(allPlayers)
      const getPickDisplayFn = _buildPickDisplayFn(allTeams)

      // Build trade details from the proposal
      const aiTeam = {
        id: proposal.proposing_team_id,
        name: proposal.proposing_team_name,
        abbreviation: proposal.proposing_team_abbreviation,
      }

      const details = buildTradeDetails({
        userTeam,
        aiTeam,
        userGives: proposal.proposal.aiReceives,   // AI receives = user gives
        userReceives: proposal.proposal.aiGives,    // AI gives = user receives
        getPlayerFn,
        getPickDisplayFn,
      })

      const userRoster = allPlayers.filter(p => {
        const tid = p.teamId ?? p.team_id
        return tid == userTeamId
      })
      const leaguePlayers = allPlayers.filter(p => {
        const tid = p.teamId ?? p.team_id
        return tid != userTeamId
      })

      const currentDate = campaign?.currentDate ?? campaign?.current_date ?? new Date().toISOString().split('T')[0]
      const seasonYear = campaign?.currentSeasonYear
        ?? campaign?.current_season_year
        ?? campaign?.settings?.currentYear
        ?? campaign?.year
        ?? new Date().getFullYear()

      // Hard gate: deadline, salary-cap matching, and asset ownership. Even an
      // AI-originated offer must pass cap matching and can go stale (the AI may
      // have traded the player away in a prior sim day), so guard before mutating.
      _assertTradeAllowed({
        userGiving: proposal.proposal.aiReceives,  // AI receives = user gives
        userReceiving: proposal.proposal.aiGives,   // AI gives = user receives
        getPlayerFn,
        currentDate,
        seasonYear,
        userTeamId,
        aiTeamId: aiTeam.id,
        campaign,
      })

      // Collect all draft picks from both teams for the executor
      const aiTeamObj = await TeamRepository.get(campaignId, aiTeam.id)
      const allDraftPicks = [
        ...(userTeam.draftPicks || []),
        ...(aiTeamObj?.draftPicks || []),
      ]

      const result = executeTradeEngine({
        tradeDetails: details,
        leaguePlayers,
        userRoster,
        draftPicks: allDraftPicks,
        userTeam: { id: userTeamId, abbreviation: userTeam.abbreviation },
        currentDate,
      })

      // Persist player moves — stamp the FULL team identity (both casings +
      // abbreviation + free-agent flag), mirroring executeTrade / the AI-to-AI
      // path, so no reader is left pointing at the player's old team.
      const abbrByTeamId = new Map([
        [String(userTeamId), userTeam.abbreviation],
        [String(aiTeam.id), aiTeamObj?.abbreviation ?? aiTeam.abbreviation],
      ])
      const playersToSave = []
      for (const asset of details.assets) {
        if (asset.type === 'player') {
          const player = [...result.updatedLeaguePlayers, ...result.updatedUserRoster]
            .find(p => (p.id ?? '') == asset.playerId)
          if (player) {
            const destAbbr = abbrByTeamId.get(String(asset.to)) ?? player.teamAbbreviation
            player.teamId = asset.to
            player.team_id = asset.to
            player.teamAbbreviation = destAbbr
            player.team_abbreviation = destAbbr
            player.isFreeAgent = 0
            player.is_free_agent = 0
            player.campaignId = campaignId
            playersToSave.push(player)
          }
        }
      }

      if (playersToSave.length > 0) {
        await PlayerRepository.saveBulk(playersToSave)
      }

      // Strip any traded-away user player from the saved starting five + minutes
      // (same as executeTrade) so the next game's lineup check isn't fooled by a
      // phantom starter / lingering minutes.
      const outgoingPlayerIds = new Set(
        details.assets
          .filter(a => a.type === 'player' && String(a.from) === String(userTeamId))
          .map(a => String(a.playerId))
      )
      if (outgoingPlayerIds.size > 0 && campaign?.settings?.lineup) {
        const lu = campaign.settings.lineup
        const starters = Array.isArray(lu.starters)
          ? lu.starters.map(id => (outgoingPlayerIds.has(String(id)) ? null : id))
          : lu.starters
        const target_minutes = { ...(lu.target_minutes || {}) }
        for (const id of Object.keys(target_minutes)) {
          if (outgoingPlayerIds.has(String(id))) delete target_minutes[id]
        }
        await CampaignRepository.updateSettings(campaignId, {
          lineup: { ...lu, starters, target_minutes },
        })
      }

      // Persist draft pick ownership changes via the shared helper.
      // Same robust find-anywhere lookup + loud failure as executeTrade.
      const pickAssets = details.assets.filter(a => a.type === 'pick')
      if (pickAssets.length > 0) {
        const allTeamsForPickMove = await TeamRepository.getAllForCampaign(campaignId)
        await _movePicksBetweenTeams({ pickAssets, allTeams: allTeamsForPickMove })

        // Post-execute verification — see executeTrade for rationale.
        const persistedUserTeam = await TeamRepository.get(campaignId, userTeamId)
        for (const asset of pickAssets) {
          if (asset.to !== userTeamId) continue
          const owns = (persistedUserTeam?.draftPicks || []).some(p => p.id === asset.pickId)
          if (!owns) {
            console.warn('[trade] acceptProposal post-execute: user did not end up owning expected pick', asset.pickId)
          }
        }
      }

      // Recompute both teams' payroll so Cap Space stays accurate post-trade.
      await _persistPostTradePayrolls({
        campaignId,
        userTeamId,
        aiTeamId: aiTeam.id,
        postTradePlayers: [...result.updatedUserRoster, ...result.updatedLeaguePlayers],
      })

      // Save trade to history & update player stats team. `seasonYear` was
      // resolved above (canonical currentSeasonYear) and reused here.
      const year = seasonYear
      const seasonData = await SeasonRepository.get(campaignId, year)
      if (seasonData) {
        // Update team ID in player stats so league leaders / stats history reflect the new team
        for (const asset of details.assets) {
          if (asset.type === 'player') {
            SeasonManager.updatePlayerStatsTeam(seasonData, asset.playerId, asset.to)
          }
        }

        if (!seasonData.tradeHistory) seasonData.tradeHistory = []
        seasonData.tradeHistory.push({
          id: `trade_${Date.now()}`,
          ...result.trade,
        })
        await SeasonRepository.save(seasonData)
      }

      // Mark for cloud sync
      useSyncStore().markDirty()

      // Build trade context for breaking news
      const assetsSent = [
        ...details.assets
          .filter(a => a.type === 'player' && a.from == userTeamId)
          .map(a => { const p = getPlayerFn(a.playerId); return p ? `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() : 'Unknown' }),
        ...details.assets
          .filter(a => a.type === 'pick' && a.from == userTeamId)
          .map(a => a.pickDisplay || `Draft Pick`),
      ]
      const assetsReceived = [
        ...details.assets
          .filter(a => a.type === 'player' && a.to == userTeamId)
          .map(a => { const p = getPlayerFn(a.playerId); return p ? `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() : 'Unknown' }),
        ...details.assets
          .filter(a => a.type === 'pick' && a.to == userTeamId)
          .map(a => a.pickDisplay || `Draft Pick`),
      ]
      const tradeContext = {
        playersSent: assetsSent,
        playersReceived: assetsReceived,
        otherTeamName: aiTeam.name || 'Unknown',
        userTeamName: userTeam?.name || 'Unknown',
        date: currentDate,
      }

      // Remove from pending list and persist status
      pendingProposals.value = pendingProposals.value.filter(p => p.id !== proposalId)
      await _updateProposalStatus(campaignId, proposalId, 'accepted')

      return { ...result, tradeContext }
    } catch (err) {
      error.value = err.message || 'Failed to accept trade proposal'
      throw err
    } finally {
      proposing.value = false
    }
  }

  async function rejectProposal(campaignId, proposalId) {
    try {
      pendingProposals.value = pendingProposals.value.filter(p => p.id !== proposalId)
      await _updateProposalStatus(campaignId, proposalId, 'rejected')
    } catch (err) {
      error.value = err.message || 'Failed to reject trade proposal'
      throw err
    }
  }

  async function _updateProposalStatus(campaignId, proposalId, status) {
    try {
      const campaign = await CampaignRepository.get(campaignId)
      // Canonical field set by CampaignManager is `currentSeasonYear`
      // (NOT settings.currentYear or top-level `year`). Reading from the
      // wrong field made `year` fall through to new Date().getFullYear(),
      // which then mismatched against campaign.currentDate's actual year
      // and broke the opening-week trade-quiet gate (`isInFirstWeekOfSeason`
      // got the wrong seasonYear and returned false on day 1).
      const year = campaign?.currentSeasonYear
        ?? campaign?.current_season_year
        ?? campaign?.settings?.currentYear
        ?? campaign?.year
        ?? new Date().getFullYear()
      const currentDate = campaign?.currentDate ?? campaign?.current_date ?? new Date().toISOString().split('T')[0]
      const seasonData = await SeasonRepository.get(campaignId, year)
      if (!seasonData?.tradeProposals) return
      const proposal = seasonData.tradeProposals.find(p => p.id === proposalId)
      if (proposal) {
        proposal.status = status
        proposal.resolved_at = currentDate
        await SeasonRepository.save(seasonData)
      }
    } catch (err) {
      console.warn('Failed to update proposal status:', err)
    }
  }

  // Trade management
  function addToUserOffering(asset) {
    // Prevent duplicates
    const exists = userOffering.value.some(a =>
      (a.type === 'player' && asset.type === 'player' && a.id === asset.id) ||
      (a.type === 'pick' && asset.type === 'pick' && a.id === asset.id)
    )
    if (!exists) {
      userOffering.value.push({ ...asset })
    }
  }

  function removeFromUserOffering(asset) {
    userOffering.value = userOffering.value.filter(a =>
      !(a.type === asset.type && a.id === asset.id)
    )
  }

  function addToUserRequesting(asset) {
    // Prevent duplicates
    const exists = userRequesting.value.some(a =>
      (a.type === 'player' && asset.type === 'player' && a.id === asset.id) ||
      (a.type === 'pick' && asset.type === 'pick' && a.id === asset.id)
    )
    if (!exists) {
      userRequesting.value.push({ ...asset })
    }
  }

  function removeFromUserRequesting(asset) {
    userRequesting.value = userRequesting.value.filter(a =>
      !(a.type === asset.type && a.id === asset.id)
    )
  }

  function clearTrade() {
    userOffering.value = []
    userRequesting.value = []
    lastProposalResult.value = null
  }

  function selectTeam(team) {
    // Only clear requesting assets when switching teams (keep user's offering)
    userRequesting.value = []
    lastProposalResult.value = null
    selectedTeam.value = team
    selectedTeamRoster.value = []
    selectedTeamPicks.value = []
  }

  // Map a proposal's player/pick asset (from fetchPendingProposals.enrichAsset)
  // into the shape the trade wizard expects. Shape mirrors what
  // TradeCenter.addPlayerToOffer/addPickToOffer assemble.
  function _proposalAssetToWizardAsset(asset) {
    if (asset?.type === 'player' && asset.player) {
      const p = asset.player
      return {
        type: 'player',
        id: p.id,
        firstName: p.firstName ?? p.first_name,
        lastName: p.lastName ?? p.last_name,
        position: p.position,
        secondaryPosition: p.secondaryPosition ?? p.secondary_position,
        overallRating: p.overallRating ?? p.overall_rating,
        contractSalary: p.contractSalary ?? p.contract_salary,
        contractYearsRemaining: p.contractYearsRemaining ?? p.contract_years_remaining,
        tradeValue: p.tradeValue ?? p.trade_value,
        age: p.age,
        height: p.height,
        headshot: p.headshot,
        hasCustomHeadshot: p.hasCustomHeadshot ?? p.has_custom_headshot ?? false,
      }
    }
    if (asset?.type === 'pick' && asset.pick) {
      const k = asset.pick
      return {
        type: 'pick',
        id: k.id,
        year: k.year,
        round: k.round,
        displayName: k.display_name ?? k.displayName,
        tradeValue: k.trade_value ?? k.tradeValue,
        originalTeamAbbreviation: k.original_team_abbreviation ?? k.originalTeamAbbreviation,
        projectedPosition: k.projected_position ?? k.projectedPosition,
      }
    }
    return null
  }

  // Build a wizard-ready negotiation prefill from an inbound AI proposal.
  // proposal.ai_gives = what the user would receive; proposal.ai_receives =
  // what the user would give.
  function setNegotiationFromProposal(proposal) {
    if (!proposal) return
    const receiving = (proposal.ai_gives || [])
      .map(_proposalAssetToWizardAsset)
      .filter(Boolean)
    const giving = (proposal.ai_receives || [])
      .map(_proposalAssetToWizardAsset)
      .filter(Boolean)
    negotiationPrefill.value = {
      teamId: proposal.proposing_team_id ?? proposal.proposing_team?.id ?? null,
      receiving,
      giving,
    }
    // Remember which proposal this negotiation came from so a successful
    // executeTrade can clear it from the inbound-offers list.
    pendingNegotiationProposalId.value = proposal.id ?? null
  }

  function consumeNegotiationPrefill() {
    const v = negotiationPrefill.value
    negotiationPrefill.value = null
    return v
  }

  function clearSelectedTeam() {
    selectedTeam.value = null
    selectedTeamRoster.value = []
    selectedTeamPicks.value = []
    clearTrade()
  }

  // Format asset for API calls
  function formatAssetForApi(asset) {
    if (asset.type === 'player') {
      return { type: 'player', playerId: asset.id }
    }
    return { type: 'pick', pickId: asset.id }
  }

  // Trading block actions
  async function loadUserTradingBlock(campaignId) {
    try {
      const campaign = await CampaignRepository.get(campaignId)
      userTradingBlock.value = campaign?.settings?.tradingBlock ?? []
    } catch (err) {
      console.warn('Failed to load trading block:', err)
      userTradingBlock.value = []
    }
  }

  async function togglePlayerOnTradingBlock(campaignId, playerId) {
    const idx = userTradingBlock.value.indexOf(playerId)
    let added = false
    if (idx >= 0) {
      userTradingBlock.value.splice(idx, 1)
    } else {
      userTradingBlock.value.push(playerId)
      added = true
    }
    try {
      await CampaignRepository.updateSettings(campaignId, { tradingBlock: [...userTradingBlock.value] })
      useSyncStore().markDirty()
    } catch (err) {
      console.warn('Failed to save trading block:', err)
    }
    return added
  }

  function isOnUserTradingBlock(playerId) {
    return userTradingBlock.value.includes(playerId)
  }

  // Check if asset is in offering
  function isInOffering(assetType, assetId) {
    return userOffering.value.some(a => a.type === assetType && a.id === assetId)
  }

  // Check if asset is in requesting
  function isInRequesting(assetType, assetId) {
    return userRequesting.value.some(a => a.type === assetType && a.id === assetId)
  }

  // Utility functions
  function formatSalary(salary) {
    if (!salary) return '$0'
    if (salary >= 1000000) {
      return `$${(salary / 1000000).toFixed(1)}M`
    }
    return `$${(salary / 1000).toFixed(0)}K`
  }

  function getDirectionLabel(direction) {
    const labels = {
      title_contender: 'Title Contender',
      win_now: 'Win Now',
      ascending: 'Ascending',
      rebuilding: 'Rebuilding',
      // Legacy fallbacks
      contending: 'Contending',
      middling: 'Neutral',
    }
    return labels[direction] || direction
  }

  function getDirectionColor(direction) {
    const colors = {
      title_contender: '#10B981', // Green
      win_now: '#3B82F6',         // Blue
      ascending: '#8B5CF6',       // Purple
      rebuilding: '#F59E0B',      // Amber
      // Legacy fallbacks
      contending: '#10B981',
      middling: '#6B7280',
    }
    return colors[direction] || '#6B7280'
  }

  return {
    // State
    tradeableTeams,
    selectedTeam,
    selectedTeamRoster,
    selectedTeamPicks,
    userAssets,
    tradeHistory,
    userOffering,
    userRequesting,
    pendingProposals,
    userTradingBlock,
    tradeDeadlinePassed,
    negotiationPrefill,
    loading,
    proposing,
    error,
    lastProposalResult,

    // Getters
    selectedTeamId,
    userOfferingSalary,
    userRequestingSalary,
    salaryDifference,
    canProposeTrade,

    // Actions
    fetchTradeableTeams,
    fetchTeamDetails,
    fetchUserAssets,
    proposeTrade,
    executeTrade,
    fetchTradeHistory,
    fetchPendingProposals,
    acceptProposal,
    rejectProposal,
    loadUserTradingBlock,
    togglePlayerOnTradingBlock,
    isOnUserTradingBlock,
    addToUserOffering,
    removeFromUserOffering,
    addToUserRequesting,
    removeFromUserRequesting,
    clearTrade,
    selectTeam,
    clearSelectedTeam,
    setNegotiationFromProposal,
    consumeNegotiationPrefill,
    isInOffering,
    isInRequesting,

    // Utilities
    formatSalary,
    getDirectionLabel,
    getDirectionColor,
  }
})
