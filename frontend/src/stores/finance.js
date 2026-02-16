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
      const agents = await PlayerRepository.getFreeAgents(campaignId)

      // Enrich each free agent with composite scores
      const enrichedAgents = (agents || []).map(player => enrichPlayerData(player))
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

  async function resignPlayer(campaignId, playerId, years) {
    loading.value = true
    error.value = null
    try {
      // Find the player in the enriched roster
      const player = rosterWithContracts.value.find(p => p.id === playerId)
      if (!player) throw new Error('Player not found in roster')

      // Use FinanceManager to compute the re-sign result
      const result = financeResignPlayer({ player, years })
      if (!result.success) throw new Error(result.error || 'Failed to re-sign player')

      // Persist to IndexedDB -- update the player's contract
      const dbPlayer = await PlayerRepository.get(campaignId, playerId)
      if (dbPlayer) {
        dbPlayer.contractYearsRemaining = years
        dbPlayer.contract_years_remaining = years
        await PlayerRepository.save(dbPlayer)
      }

      // Update the player in the local roster
      const playerIndex = rosterWithContracts.value.findIndex(p => p.id === playerId)
      if (playerIndex !== -1) {
        rosterWithContracts.value[playerIndex] = {
          ...rosterWithContracts.value[playerIndex],
          contractYearsRemaining: years,
        }
      }

      // Refresh team store so roster/lineup tabs reflect the change immediately
      await useTeamStore().fetchTeam(campaignId, { force: true })
      useSyncStore().markDirty()

      closeResignModal()
      return result
    } catch (err) {
      error.value = err.message || 'Failed to re-sign player'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function signFreeAgent(campaignId, playerId) {
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

      // Use FinanceManager to compute the signing result
      // Build a minimal league players list with just this free agent
      const result = financeSignFreeAgent({
        playerId,
        leaguePlayers: [dbPlayer],
        currentRoster: rosterWithContracts.value,
        capMode: campaign.settings?.capMode ?? 'normal',
        salaryCap: financeSummary.value?.salary_cap ?? DEFAULT_SALARY_CAP,
      })

      if (!result.success) throw new Error(result.error || 'Failed to sign free agent')

      // Persist to IndexedDB -- update player's team assignment and contract
      dbPlayer.teamId = userTeamId
      dbPlayer.isFreeAgent = 0
      dbPlayer.contractSalary = result.player.contractSalary ?? 0
      dbPlayer.contract_salary = result.player.contractSalary ?? 0
      dbPlayer.contractYearsRemaining = result.player.contractYearsRemaining ?? 0
      dbPlayer.contract_years_remaining = result.player.contractYearsRemaining ?? 0
      await PlayerRepository.save(dbPlayer)

      // Remove from free agents list
      freeAgents.value = freeAgents.value.filter(p => p.id !== playerId)

      // Add enriched player to roster
      const enrichedPlayer = enrichPlayerData(dbPlayer)
      rosterWithContracts.value.push(enrichedPlayer)

      // Update summary
      const teamData = await TeamRepository.get(campaignId, userTeamId)
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
