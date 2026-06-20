import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import {
  enrichPlayerData,
  getFinanceSummary,
  getRosterContracts,
  buildSeasonStatsLookup,
  resignPlayer as financeResignPlayer,
  signFreeAgent as financeSignFreeAgent,
  dropPlayer as financeDropPlayer,
  DEFAULT_SALARY_CAP,
} from '@/engine/finance/FinanceManager'
import { useTeamStore } from '@/stores/team'
import { useSyncStore } from '@/stores/sync'
import { useToastStore } from '@/stores/toast'
import { isPastResignDeadline, isInFreeAgencyPeriod } from '@/engine/season/SeasonDeadlines'
import { resignAsk } from '@/engine/ai/ResignValuationService'
import { getMarketSize } from '@/engine/ai/MotivationService'
import {
  startFreeAgency as engineStartFreeAgency,
  simFreeAgencyDay as engineSimFreeAgencyDay,
} from '@/engine/draft/OffseasonOrchestrator'

export const useFinanceStore = defineStore('finance', () => {
  // State
  const rosterWithContracts = ref([])
  const freeAgents = ref([])
  const transactions = ref([])
  const financeSummary = ref(null)
  const loading = ref(false)
  const error = ref(null)

  // Cache tracking
  const _rosterCampaignId = ref(null)
  const _freeAgentsCampaignId = ref(null)
  const _transactionsCampaignId = ref(null)

  // Modal state
  const selectedPlayer = ref(null)
  const showResignModal = ref(false)
  const showSignModal = ref(false)
  const showDropModal = ref(false)

  // Build the re-sign valuation context for a player: their season stats plus the
  // team situation (roster for co-star/star-pairing, market size, record). Used by
  // BOTH the ResignModal (display + retention) and the floor check in resignPlayer,
  // so the asking number the user sees matches what the store enforces.
  function buildResignContext(player) {
    if (!player) return { stats: null }
    const teamStore = useTeamStore()
    const team = teamStore.team
    const roster = (teamStore.roster?.length ? teamStore.roster : rosterWithContracts.value) ?? []
    const wins = team?.wins ?? team?.record?.wins
    const losses = team?.losses ?? team?.record?.losses
    const gp = (wins ?? 0) + (losses ?? 0)
    const abbr = team?.abbreviation ?? player.teamAbbreviation ?? player.team_abbreviation
    return {
      stats: player.stats ?? player.season_stats ?? null,
      teamRoster: roster,
      teamMarketSize: getMarketSize(abbr),
      ...(gp > 0 ? { teamWinPct: wins / gp } : {}),
      yearsWithTeam: player.careerSeasons ?? player.career_seasons ?? undefined,
    }
  }

  // Context for whichever player the re-sign modal currently has open.
  const resignContext = computed(() => buildResignContext(selectedPlayer.value))

  // Getters
  const playersEligibleForResign = computed(() =>
    rosterWithContracts.value.filter(player => player.contractYearsRemaining === 1)
  )

  const totalPayroll = computed(() =>
    rosterWithContracts.value.reduce((sum, player) => sum + (player.contractSalary || 0), 0)
  )

  const salaryCap = computed(() => financeSummary.value?.salary_cap || 0)

  const capSpace = computed(() => salaryCap.value - totalPayroll.value)

  const rosterCount = computed(() => rosterWithContracts.value.length)

  const canSignPlayers = computed(() => rosterCount.value < 15)

  // Actions
  async function fetchFinanceSummary(campaignId, { force = false } = {}) {
    // Summary is always loaded alongside roster contracts
    if (!force && _rosterCampaignId.value === campaignId && financeSummary.value) {
      return financeSummary.value
    }

    loading.value = true
    error.value = null
    try {
      // Get campaign, team, and roster data
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const userTeamId = campaign.teamId ?? campaign.userTeamId ?? campaign.team_id ?? campaign.user_team_id
      if (!userTeamId) throw new Error('No user team found')

      const [teamData, players] = await Promise.all([
        TeamRepository.get(campaignId, userTeamId),
        PlayerRepository.getByTeam(campaignId, userTeamId),
      ])

      const teamSalaryCap = teamData?.salary_cap ?? teamData?.salaryCap ?? DEFAULT_SALARY_CAP
      const seasonYear = campaign.currentSeasonYear ?? new Date().getFullYear()

      // Compute finance summary using FinanceManager
      const summary = getFinanceSummary({
        roster: players || [],
        salaryCap: teamSalaryCap,
        currentSeasonYear: seasonYear,
      })

      financeSummary.value = summary
      return summary
    } catch (err) {
      error.value = err.message || 'Failed to fetch finance summary'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchRosterContracts(campaignId, { force = false } = {}) {
    if (!force && _rosterCampaignId.value === campaignId && rosterWithContracts.value.length > 0) {
      return { roster: rosterWithContracts.value, summary: financeSummary.value }
    }

    loading.value = true
    error.value = null
    try {
      // Get campaign, team, and roster data
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const userTeamId = campaign.teamId ?? campaign.userTeamId ?? campaign.team_id ?? campaign.user_team_id
      if (!userTeamId) throw new Error('No user team found')

      const seasonYear = campaign.currentSeasonYear ?? new Date().getFullYear()

      const [teamData, players, seasonData] = await Promise.all([
        TeamRepository.get(campaignId, userTeamId),
        PlayerRepository.getByTeam(campaignId, userTeamId),
        SeasonRepository.get(campaignId, seasonYear),
      ])

      // Build season stats lookup for enrichment
      const seasonStats = seasonData ? buildSeasonStatsLookup(seasonData) : {}

      // Enrich roster with contract info and composite scores
      const enrichedRoster = getRosterContracts({
        roster: players || [],
        seasonStats,
      })

      rosterWithContracts.value = enrichedRoster

      // Compute finance summary
      const teamSalaryCap = teamData?.salary_cap ?? teamData?.salaryCap ?? DEFAULT_SALARY_CAP
      const summary = getFinanceSummary({
        roster: players || [],
        salaryCap: teamSalaryCap,
        currentSeasonYear: seasonYear,
      })
      financeSummary.value = summary

      _rosterCampaignId.value = campaignId
      return { roster: enrichedRoster, summary }
    } catch (err) {
      error.value = err.message || 'Failed to fetch roster contracts'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchFreeAgents(campaignId, { force = false } = {}) {
    if (!force && _freeAgentsCampaignId.value === campaignId && freeAgents.value.length > 0) {
      return { free_agents: freeAgents.value }
    }

    loading.value = true
    error.value = null
    try {
      const allAgents = await PlayerRepository.getFreeAgents(campaignId)
      // Filter out draft prospects — they belong on the scouting page, not free agency
      // Filter out retirees defensively (PlayerRepository already filters but a
      // race or stale index could still surface them).
      const agents = (allAgents || []).filter(p =>
        !p.isDraftProspect && !p.rookieTier && !p.isRetired && !p.is_retired
      )

      // During the offseason FA window, enrich each player with offer state so
      // ContractCard can render the offers-count badge / "Offered" chip.
      const campaign = await CampaignRepository.get(campaignId)
      const offersMap = isInFreeAgencyPeriod(campaign)
        ? (campaign?.settings?.freeAgencyOffers || {})
        : {}

      const enrichedAgents = agents.map(player => {
        const enriched = enrichPlayerData(player)
        const offers = offersMap[player.id] || []
        return {
          ...enriched,
          pendingOfferCount: offers.length,
          userOffer: offers.find(o => o.isUserOffer) || null,
        }
      })
      freeAgents.value = enrichedAgents
      _freeAgentsCampaignId.value = campaignId
      return { free_agents: enrichedAgents }
    } catch (err) {
      error.value = err.message || 'Failed to fetch free agents'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchTransactions(campaignId, { force = false } = {}) {
    if (!force && _transactionsCampaignId.value === campaignId && transactions.value.length > 0) {
      return { transactions: transactions.value }
    }

    loading.value = true
    error.value = null
    try {
      // Transactions are not yet stored in IndexedDB -- return empty for now
      // Future: read from a dedicated transactions store in IndexedDB
      transactions.value = []
      _transactionsCampaignId.value = campaignId
      return { transactions: [] }
    } catch (err) {
      error.value = err.message || 'Failed to fetch transactions'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function resignPlayer(campaignId, playerId, years, salary = null) {
    loading.value = true
    error.value = null
    try {
      // Find the player in the enriched roster
      const player = rosterWithContracts.value.find(p => p.id === playerId)
      if (!player) throw new Error('Player not found in roster')

      // Re-sign deadline gate. The campaign flag is flipped by
      // _processMidSeasonEvents on Feb 5 alongside trade_deadline_passed.
      const campaign = await CampaignRepository.get(campaignId)
      const resignDeadlinePassed = isPastResignDeadline(campaign)
      if (resignDeadlinePassed) {
        useToastStore().showError('Re-signing is closed — the deadline has passed for this season.')
        throw new Error('Re-sign deadline has passed')
      }

      // Market-value floor: a player won't re-sign below their ask, and the
      // incumbent can offer at most a 5-year deal. Enforced here (not just in the
      // modal's RNG) so the offer can't be lowballed past what they'd accept.
      const ask = resignAsk(player, buildResignContext(player))
      if (salary != null && salary < ask.requiredSalary) {
        const askM = `$${(ask.requiredSalary / 1_000_000).toFixed(1)}M`
        useToastStore().showError(
          `${player.name || 'He'} won't re-sign for that — he wants at least ${askM}/yr.`
        )
        throw new Error('Offer below the player\'s asking salary')
      }
      if (years > ask.maxYears) {
        useToastStore().showError(`You can offer at most a ${ask.maxYears}-year re-sign.`)
        throw new Error('Re-sign exceeds the maximum contract length')
      }

      // Use FinanceManager to compute the re-sign result. Pass the flag so the
      // engine layer also short-circuits as defense in depth.
      const result = financeResignPlayer({ player, years, salary, resignDeadlinePassed })
      if (!result.success) throw new Error(result.message || result.error || 'Failed to re-sign player')

      const newSalary = result.player.contractSalary ?? salary ?? player.contractSalary

      // Persist to IndexedDB -- update the player's contract. Match
      // signFreeAgent's behavior: throw if the player record is missing so a
      // silent skip can't masquerade as success in the UI toast.
      const dbPlayer = await PlayerRepository.get(campaignId, playerId)
      if (!dbPlayer) throw new Error('Player not found in database')
      dbPlayer.contractYearsRemaining = years
      dbPlayer.contract_years_remaining = years
      dbPlayer.contractSalary = newSalary
      dbPlayer.contract_salary = newSalary
      // One-shot flag so processSeasonEnd() doesn't immediately decrement the
      // just-signed extension at the next season rollover. Cleared there.
      dbPlayer.resignedThisSeason = true
      dbPlayer.resigned_this_season = true

      // Rebuild contract_details.salaries to match the new term so any
      // downstream code that reads the year-by-year breakdown sees the
      // updated values rather than the stale pre-resign array.
      const flatSalaries = Array.from({ length: years }, () => newSalary)
      const newDetails = {
        ...(dbPlayer.contract_details || dbPlayer.contractDetails || {}),
        totalYears: years,
        yearsRemaining: years,
        salaries: flatSalaries,
        currentYearSalary: newSalary,
        totalValue: newSalary * years,
      }
      dbPlayer.contract_details = newDetails
      dbPlayer.contractDetails = newDetails

      await PlayerRepository.save(dbPlayer)

      // VERIFY: read the record back to make sure the write actually
      // persisted (production has had reports of the resign appearing to
      // succeed but the contract not updating). If the verify fails, throw
      // so the parent handler shows an error toast instead of a misleading
      // "Player re-signed" success message.
      const verifyPlayer = await PlayerRepository.get(campaignId, playerId)
      const verifyYears = verifyPlayer?.contract_years_remaining ?? verifyPlayer?.contractYearsRemaining
      if (verifyYears !== years) {
        console.error('[FinanceStore] Resign verify failed — IndexedDB read back', {
          expected: years, got: verifyYears, player: verifyPlayer,
        })
        throw new Error('Re-sign did not persist — please try again')
      }

      // Update the player in the local roster — keep both casings in sync so
      // any UI reading the snake_case form (e.g. contract_years_remaining)
      // doesn't display stale data until the next fetchTeam round-trip.
      const playerIndex = rosterWithContracts.value.findIndex(p => p.id === playerId)
      if (playerIndex !== -1) {
        rosterWithContracts.value[playerIndex] = {
          ...rosterWithContracts.value[playerIndex],
          contractYearsRemaining: years,
          contract_years_remaining: years,
          contractSalary: newSalary,
          contract_salary: newSalary,
          contractDetails: newDetails,
          contract_details: newDetails,
          resignedThisSeason: true,
          resigned_this_season: true,
        }
      }

      // Refresh team store so roster/lineup tabs reflect the change immediately
      await useTeamStore().fetchTeam(campaignId, { force: true })
      const syncStore = useSyncStore()
      syncStore.markDirty()

      // Push immediately to the cloud so a subsequent navigation that
      // triggers `fetchCampaign → pullChanges` can't drag back the stale
      // pre-resign state. Fire-and-forget — don't block the UI on it. In dev
      // this is effectively a no-op; in prod it closes the push/pull race
      // window where a slow cloud round-trip would let the pull win.
      if (typeof syncStore.syncNow === 'function') {
        syncStore.syncNow().catch(err => {
          console.warn('[FinanceStore] Post-resign sync push failed:', err)
        })
      }

      closeResignModal()
      return result
    } catch (err) {
      error.value = err.message || 'Failed to re-sign player'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function signFreeAgent(campaignId, playerId, offer = {}) {
    loading.value = true
    error.value = null
    try {
      // Get campaign for team info
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const userTeamId = campaign.teamId ?? campaign.userTeamId ?? campaign.team_id ?? campaign.user_team_id
      if (!userTeamId) throw new Error('No user team found')

      // Get the free agent player from IndexedDB
      const dbPlayer = await PlayerRepository.get(campaignId, playerId)
      if (!dbPlayer) throw new Error('Player not found')

      // Use FinanceManager to compute the signing result. Honor the negotiated
      // salary/years (defaults to the player's market value when omitted); the
      // engine enforces the minimum-salary cap exception.
      const result = financeSignFreeAgent({
        playerId,
        leaguePlayers: [dbPlayer],
        currentRoster: rosterWithContracts.value,
        salary: offer.salary ?? null,
        years: offer.years ?? null,
        salaryCap: financeSummary.value?.salary_cap ?? DEFAULT_SALARY_CAP,
      })

      if (!result.success) throw new Error(result.error || 'Failed to sign free agent')

      // Look up the signing team so we can stamp its abbreviation on the
      // player record. Without this the player stays labeled 'FA' in their
      // stats row and anywhere else that reads teamAbbreviation directly.
      const teamData = await TeamRepository.get(campaignId, userTeamId)
      const teamAbbr = teamData?.abbreviation ?? teamData?.abbr ?? null

      // Persist to IndexedDB -- update player's team assignment and contract
      dbPlayer.teamId = userTeamId
      dbPlayer.team_id = userTeamId
      if (teamAbbr) {
        dbPlayer.teamAbbreviation = teamAbbr
        dbPlayer.team_abbreviation = teamAbbr
      }
      dbPlayer.isFreeAgent = 0
      dbPlayer.is_free_agent = 0
      dbPlayer.contractSalary = result.player.contractSalary ?? 0
      dbPlayer.contract_salary = result.player.contractSalary ?? 0
      dbPlayer.contractYearsRemaining = result.player.contractYearsRemaining ?? 0
      dbPlayer.contract_years_remaining = result.player.contractYearsRemaining ?? 0
      if (result.player.contractDetails) {
        dbPlayer.contractDetails = result.player.contractDetails
        dbPlayer.contract_details = result.player.contractDetails
      }
      await PlayerRepository.save(dbPlayer)

      // Remove from free agents list
      freeAgents.value = freeAgents.value.filter(p => p.id !== playerId)

      // Add enriched player to roster
      const enrichedPlayer = enrichPlayerData(dbPlayer)
      rosterWithContracts.value.push(enrichedPlayer)

      // Update summary
      const teamSalaryCap = teamData?.salary_cap ?? teamData?.salaryCap ?? DEFAULT_SALARY_CAP
      const players = await PlayerRepository.getByTeam(campaignId, userTeamId)
      const seasonYear = campaign.currentSeasonYear ?? new Date().getFullYear()
      financeSummary.value = getFinanceSummary({
        roster: players || [],
        salaryCap: teamSalaryCap,
        currentSeasonYear: seasonYear,
      })

      // Refresh team store so roster/lineup tabs reflect the change immediately
      await useTeamStore().fetchTeam(campaignId, { force: true })
      useSyncStore().markDirty()

      closeSignModal()
      return result
    } catch (err) {
      error.value = err.message || 'Failed to sign free agent'
      throw err
    } finally {
      loading.value = false
    }
  }

  // ===========================================================================
  // OFFSEASON FREE AGENCY: PENDING OFFERS
  // ===========================================================================

  async function makeFreeAgentOffer(campaignId, playerId, { years, salary }) {
    loading.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')
      if (!isInFreeAgencyPeriod(campaign)) {
        throw new Error('Free agency is not active.')
      }
      if (!years || years < 1 || years > 5) throw new Error('Years must be 1–5')
      if (!salary || salary <= 0) throw new Error('Invalid salary')

      const userTeamId = campaign.teamId
      if (!userTeamId) throw new Error('No user team found')
      const teamData = await TeamRepository.get(campaignId, userTeamId)
      const teamAbbr = teamData?.abbreviation ?? teamData?.abbr ?? null

      // No cap-space throw here. The user is allowed to bid above their cap
      // on multiple players — players don't pick a team until the window
      // ends, so taking swings at several stars is the realistic play. If
      // more players accept than the cap can fit, resolveFreeAgency surfaces
      // a "Decision Required" step in the EndOfFreeAgencyModal so the user
      // picks which signings to keep.

      const newOffer = {
        teamId: userTeamId,
        teamAbbr,
        salary: Math.floor(salary),
        years,
        dayOffered: campaign.settings?.freeAgencyDay ?? 0,
        isUserOffer: true,
      }

      // Atomic upsert — wraps read+put in a single IDB txn so a concurrent
      // simFreeAgencyDay (which also does a read-modify-write of the whole
      // campaign object) can't clobber the offer mid-write. Without this,
      // a race could drop the user's offer and the player would silently
      // resurface in the FA pool after resolution.
      const updatedCampaign = await CampaignRepository.upsertFreeAgencyUserOffer(
        campaignId, playerId, newOffer
      )
      const updatedList = updatedCampaign.settings?.freeAgencyOffers?.[String(playerId)] ?? [newOffer]

      // Update local FA cache so ContractCard immediately reflects the offer.
      const idx = freeAgents.value.findIndex(p => String(p.id) === String(playerId))
      if (idx >= 0) {
        freeAgents.value[idx] = {
          ...freeAgents.value[idx],
          pendingOfferCount: updatedList.length,
          userOffer: newOffer,
        }
      }

      closeSignModal()
      return newOffer
    } catch (err) {
      error.value = err.message || 'Failed to submit offer'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function withdrawFreeAgentOffer(campaignId, playerId) {
    loading.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')
      if (!isInFreeAgencyPeriod(campaign)) {
        throw new Error('Free agency is not active.')
      }
      if (!campaign.settings?.freeAgencyOffers?.[playerId]) return

      // Atomic remove — same race-protection rationale as the upsert path.
      const updatedCampaign = await CampaignRepository.removeFreeAgencyUserOffer(
        campaignId, playerId
      )
      const remaining = updatedCampaign?.settings?.freeAgencyOffers?.[String(playerId)] ?? []

      const idx = freeAgents.value.findIndex(p => String(p.id) === String(playerId))
      if (idx >= 0) {
        freeAgents.value[idx] = {
          ...freeAgents.value[idx],
          pendingOfferCount: remaining.length,
          userOffer: null,
        }
      }
    } catch (err) {
      error.value = err.message || 'Failed to withdraw offer'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function startFreeAgencyPeriod(campaignId) {
    loading.value = true
    error.value = null
    try {
      const campaign = await engineStartFreeAgency(campaignId)
      _freeAgentsCampaignId.value = null // force refresh
      await fetchFreeAgents(campaignId, { force: true })
      return campaign
    } catch (err) {
      error.value = err.message || 'Failed to start free agency'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function simFreeAgencyDay(campaignId) {
    loading.value = true
    error.value = null
    try {
      const result = await engineSimFreeAgencyDay(campaignId)
      _freeAgentsCampaignId.value = null
      await fetchFreeAgents(campaignId, { force: true })
      // If resolution happened, also refresh roster/team for newly-signed players.
      if (result.resolved) {
        await useTeamStore().fetchTeam(campaignId, { force: true })
      }
      useSyncStore().markDirty()
      return result
    } catch (err) {
      error.value = err.message || 'Failed to sim free-agency day'
      throw err
    } finally {
      loading.value = false
    }
  }

  // Loop the engine day-sim until resolution. Only refreshes the FA cache /
  // team store ONCE at the end so we don't thrash IndexedDB or re-render the
  // UI 14 times.
  async function simRestOfFreeAgency(campaignId) {
    loading.value = true
    error.value = null
    try {
      let last
      // Hard cap at FREE_AGENCY_DURATION_DAYS iterations as a safety belt.
      for (let i = 0; i < 30; i++) {
        last = await engineSimFreeAgencyDay(campaignId)
        if (last?.resolved) break
      }
      _freeAgentsCampaignId.value = null
      await fetchFreeAgents(campaignId, { force: true })
      if (last?.resolved) {
        await useTeamStore().fetchTeam(campaignId, { force: true })
      }
      useSyncStore().markDirty()
      return last
    } catch (err) {
      error.value = err.message || 'Failed to sim free agency'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function consumeFreeAgencyResults(campaignId) {
    const campaign = await CampaignRepository.get(campaignId)
    const results = campaign?.settings?.freeAgencyResults || null
    if (results && campaign?.settings) {
      campaign.settings.freeAgencyResults = null
      await CampaignRepository.save(campaign)
    }
    return results
  }

  /**
   * Finalize the user's pending free-agency choices when their winning bids
   * totaled more than their cap space. Called from the EndOfFreeAgencyModal
   * after the user picks which signings to keep.
   *
   * `pendingOffers` is the array carried by `results.pendingChoice.offers`
   * (snapshot at resolution time). `selectedIds` is the subset of playerIds
   * the user wants to actually sign — anything not in the set is recorded as
   * a passed-on signing (player stays a free agent).
   */
  async function finalizeFreeAgencyUserChoices(campaignId, pendingOffers, selectedIds) {
    loading.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      if (!campaign) throw new Error('Campaign not found')
      const userTeamId = campaign.teamId
      if (!userTeamId) throw new Error('No user team found')
      const teamData = await TeamRepository.get(campaignId, userTeamId)
      const userTeamAbbr = teamData?.abbreviation ?? teamData?.abbr ?? null

      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
      const selected = new Set((selectedIds || []).map(String))

      const playerUpdates = []
      const accepted = []
      const declined = []

      for (const offer of pendingOffers ?? []) {
        const player = allPlayers.find(p => String(p.id) === String(offer.playerId))
        if (!player) continue
        if (selected.has(String(offer.playerId))) {
          playerUpdates.push({
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
          accepted.push({
            playerId: offer.playerId,
            playerName: offer.playerName,
            years: offer.years,
            salary: offer.salary,
          })
        } else if (offer.fallback?.teamId) {
          // User passed → runner-up AI team scoops the player. The fallback
          // was scored against the same threshold pickBestOffer enforces, so
          // we just apply it without re-scoring.
          playerUpdates.push({
            ...player,
            teamId: offer.fallback.teamId,
            team_id: offer.fallback.teamId,
            teamAbbreviation: offer.fallback.teamAbbr,
            team_abbreviation: offer.fallback.teamAbbr,
            isFreeAgent: 0,
            is_free_agent: 0,
            contractYearsRemaining: offer.fallback.years,
            contract_years_remaining: offer.fallback.years,
            contractSalary: offer.fallback.salary,
            contract_salary: offer.fallback.salary,
            previousTeamId: undefined,
            previous_team_id: undefined,
            previousTeamAbbreviation: undefined,
            previous_team_abbreviation: undefined,
            campaignId,
          })
          declined.push({
            playerId: offer.playerId,
            playerName: offer.playerName,
            signedWith: offer.fallback.teamAbbr,
            signedWithAbbr: offer.fallback.teamAbbr,
            userOffer: { salary: offer.salary, years: offer.years },
            winningOffer: { salary: offer.fallback.salary, years: offer.fallback.years },
            reason: offer.fallback.reason || `You passed — ${offer.fallback.teamAbbr} signed them as the runner-up bidder.`,
          })
        } else {
          // No AI team was a viable backup → player stays a free agent.
          declined.push({
            playerId: offer.playerId,
            playerName: offer.playerName,
            signedWith: 'unsigned',
            signedWithAbbr: null,
            userOffer: { salary: offer.salary, years: offer.years },
            winningOffer: null,
            reason: 'You passed on this offer, and no AI team had a competing bid.',
          })
        }
      }

      if (playerUpdates.length > 0) {
        await PlayerRepository.saveBulk(playerUpdates)
      }

      await Promise.all([
        fetchRosterContracts(campaignId, { force: true }),
        fetchFreeAgents(campaignId, { force: true }),
      ])

      return { accepted, declined }
    } catch (err) {
      error.value = err.message || 'Failed to finalize free-agency choices'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function dropPlayer(campaignId, playerId) {
    loading.value = true
    error.value = null
    try {
      // Find the player in the enriched roster
      const player = rosterWithContracts.value.find(p => p.id === playerId)
      if (!player) throw new Error('Player not found in roster')

      // Use FinanceManager to compute the drop result
      const result = financeDropPlayer({
        player,
        leaguePlayers: [], // Not needed for the core drop logic
      })

      if (!result.success) throw new Error(result.error || 'Failed to drop player')

      // Persist to IndexedDB -- clear team, mark as free agent
      const dbPlayer = await PlayerRepository.get(campaignId, playerId)
      if (dbPlayer) {
        dbPlayer.teamId = null
        dbPlayer.isFreeAgent = 1
        dbPlayer.contractSalary = 0
        dbPlayer.contract_salary = 0
        dbPlayer.contractYearsRemaining = 0
        dbPlayer.contract_years_remaining = 0
        await PlayerRepository.save(dbPlayer)
      }

      // Remove from roster
      rosterWithContracts.value = rosterWithContracts.value.filter(p => p.id !== playerId)

      // Update summary
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.teamId ?? campaign?.userTeamId ?? campaign?.user_team_id
      if (userTeamId) {
        const teamData = await TeamRepository.get(campaignId, userTeamId)
        const teamSalaryCap = teamData?.salary_cap ?? teamData?.salaryCap ?? DEFAULT_SALARY_CAP
        const players = await PlayerRepository.getByTeam(campaignId, userTeamId)
        const seasonYear = campaign.currentSeasonYear ?? new Date().getFullYear()
        financeSummary.value = getFinanceSummary({
          roster: players || [],
          salaryCap: teamSalaryCap,
          currentSeasonYear: seasonYear,
        })
      }

      // Refresh team store so roster/lineup tabs reflect the change immediately
      await useTeamStore().fetchTeam(campaignId, { force: true })
      useSyncStore().markDirty()

      closeDropModal()
      return result
    } catch (err) {
      error.value = err.message || 'Failed to drop player'
      throw err
    } finally {
      loading.value = false
    }
  }

  // Modal actions
  function openResignModal(player) {
    selectedPlayer.value = player
    showResignModal.value = true
  }

  function closeResignModal() {
    selectedPlayer.value = null
    showResignModal.value = false
  }

  function openSignModal(player) {
    selectedPlayer.value = player
    showSignModal.value = true
  }

  function closeSignModal() {
    selectedPlayer.value = null
    showSignModal.value = false
  }

  function openDropModal(player) {
    selectedPlayer.value = player
    showDropModal.value = true
  }

  function closeDropModal() {
    selectedPlayer.value = null
    showDropModal.value = false
  }

  function clearFinanceState() {
    rosterWithContracts.value = []
    freeAgents.value = []
    transactions.value = []
    financeSummary.value = null
    selectedPlayer.value = null
    showResignModal.value = false
    showSignModal.value = false
    showDropModal.value = false
    _rosterCampaignId.value = null
    _freeAgentsCampaignId.value = null
    _transactionsCampaignId.value = null
  }

  function invalidate() {
    _rosterCampaignId.value = null
    _freeAgentsCampaignId.value = null
    _transactionsCampaignId.value = null
  }

  // Utility functions
  function formatSalary(salary) {
    if (salary >= 1000000) {
      return `$${(salary / 1000000).toFixed(1)}M`
    }
    return `$${(salary / 1000).toFixed(0)}K`
  }

  function formatContractYears(years) {
    if (years === 1) return '1 yr'
    return `${years} yrs`
  }

  function getContractStatus(yearsRemaining) {
    if (yearsRemaining === 1) return 'expiring'
    if (yearsRemaining <= 2) return 'short'
    return 'long'
  }

  return {
    // State
    rosterWithContracts,
    freeAgents,
    transactions,
    financeSummary,
    loading,
    error,
    selectedPlayer,
    showResignModal,
    resignContext,
    showSignModal,
    showDropModal,
    // Getters
    playersEligibleForResign,
    totalPayroll,
    salaryCap,
    capSpace,
    rosterCount,
    canSignPlayers,
    // Actions
    fetchFinanceSummary,
    fetchRosterContracts,
    fetchFreeAgents,
    fetchTransactions,
    resignPlayer,
    signFreeAgent,
    makeFreeAgentOffer,
    withdrawFreeAgentOffer,
    startFreeAgencyPeriod,
    simFreeAgencyDay,
    simRestOfFreeAgency,
    consumeFreeAgencyResults,
    finalizeFreeAgencyUserChoices,
    dropPlayer,
    openResignModal,
    closeResignModal,
    openSignModal,
    closeSignModal,
    openDropModal,
    closeDropModal,
    clearFinanceState,
    invalidate,
    // Utilities
    formatSalary,
    formatContractYears,
    getContractStatus,
  }
})
