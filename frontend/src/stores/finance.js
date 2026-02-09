import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'

export const useFinanceStore = defineStore('finance', () => {
  // State
  const rosterWithContracts = ref([])
  const freeAgents = ref([])
  const transactions = ref([])
  const financeSummary = ref(null)
  const loading = ref(false)
  const error = ref(null)

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
  async function fetchFinanceSummary(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/finances/summary`)
      financeSummary.value = response.data
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch finance summary'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchRosterContracts(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/finances/roster`)
      rosterWithContracts.value = response.data.roster
      financeSummary.value = response.data.summary
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch roster contracts'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchFreeAgents(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/finances/free-agents`)
      freeAgents.value = response.data.free_agents
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch free agents'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchTransactions(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/finances/transactions`)
      transactions.value = response.data.transactions
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch transactions'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function resignPlayer(campaignId, playerId, years) {
    loading.value = true
    error.value = null
    try {
      const response = await api.post(`/api/campaigns/${campaignId}/finances/resign/${playerId}`, {
        years,
      })

      // Update the player in the roster
      const playerIndex = rosterWithContracts.value.findIndex(p => p.id === playerId)
      if (playerIndex !== -1) {
        rosterWithContracts.value[playerIndex] = {
          ...rosterWithContracts.value[playerIndex],
          contractYearsRemaining: years,
        }
      }

      closeResignModal()
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to re-sign player'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function signFreeAgent(campaignId, playerId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.post(`/api/campaigns/${campaignId}/finances/sign/${playerId}`)

      // Remove from free agents
      freeAgents.value = freeAgents.value.filter(p => p.id !== playerId)

      // Add to roster
      if (response.data.player) {
        rosterWithContracts.value.push(response.data.player)
      }

      // Update summary
      if (response.data.summary) {
        financeSummary.value = response.data.summary
      }

      closeSignModal()
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to sign free agent'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function dropPlayer(campaignId, playerId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.post(`/api/campaigns/${campaignId}/finances/drop/${playerId}`)

      // Remove from roster
      rosterWithContracts.value = rosterWithContracts.value.filter(p => p.id !== playerId)

      // Update summary
      if (response.data.summary) {
        financeSummary.value = response.data.summary
      }

      closeDropModal()
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to drop player'
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
    // Utilities
    formatSalary,
    formatContractYears,
    getContractStatus,
  }
})
