import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'

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

  // Actions
  async function fetchTradeableTeams(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/trade/teams`)
      tradeableTeams.value = response.data.teams
      return tradeableTeams.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch teams'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchTeamDetails(campaignId, teamId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/trade/teams/${teamId}`)
      selectedTeam.value = response.data.team
      selectedTeamRoster.value = response.data.roster
      selectedTeamPicks.value = response.data.picks
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch team details'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchUserAssets(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/trade/user-assets`)
      userAssets.value = response.data
      return userAssets.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch your assets'
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
      const response = await api.post(`/api/campaigns/${campaignId}/trade/propose`, {
        aiTeamId: selectedTeam.value.id,
        userGives: userOffering.value.map(formatAssetForApi),
        userReceives: userRequesting.value.map(formatAssetForApi),
      })

      lastProposalResult.value = response.data
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to propose trade'
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
      const response = await api.post(`/api/campaigns/${campaignId}/trade/execute`, {
        aiTeamId: selectedTeam.value.id,
        userGives: userOffering.value.map(formatAssetForApi),
        userReceives: userRequesting.value.map(formatAssetForApi),
      })

      // Clear the trade after successful execution
      clearTrade()

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to execute trade'
      throw err
    } finally {
      proposing.value = false
    }
  }

  async function fetchTradeHistory(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/trade/history`)
      tradeHistory.value = response.data.trades
      return tradeHistory.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch trade history'
      throw err
    } finally {
      loading.value = false
    }
  }

  // AI-initiated trade proposal actions
  async function fetchPendingProposals(campaignId) {
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/trade/proposals`)
      pendingProposals.value = response.data.proposals
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
      const response = await api.post(`/api/campaigns/${campaignId}/trade/proposals/${proposalId}/accept`)
      // Remove from pending list
      pendingProposals.value = pendingProposals.value.filter(p => p.id !== proposalId)
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to accept trade proposal'
      throw err
    } finally {
      proposing.value = false
    }
  }

  async function rejectProposal(campaignId, proposalId) {
    try {
      await api.post(`/api/campaigns/${campaignId}/trade/proposals/${proposalId}/reject`)
      // Remove from pending list
      pendingProposals.value = pendingProposals.value.filter(p => p.id !== proposalId)
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to reject trade proposal'
      throw err
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
    addToUserOffering,
    removeFromUserOffering,
    addToUserRequesting,
    removeFromUserRequesting,
    clearTrade,
    selectTeam,
    clearSelectedTeam,
    isInOffering,
    isInRequesting,

    // Utilities
    formatSalary,
    getDirectionLabel,
    getDirectionColor,
  }
})
