import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'

export const usePlayoffStore = defineStore('playoff', () => {
  // State
  const bracket = ref(null)
  const userStatus = ref(null)
  const currentSeries = ref(null)
  const seriesResult = ref(null)
  const loading = ref(false)
  const error = ref(null)

  // Modal state
  const showSeasonEndModal = ref(false)
  const showSeriesResultModal = ref(false)
  const showChampionshipModal = ref(false)

  // Regular season completion tracking
  const regularSeasonComplete = ref(false)
  const bracketGenerated = ref(false)

  // Getters
  const isInPlayoffs = computed(() => bracket.value !== null)

  const champion = computed(() => bracket.value?.champion ?? null)

  const userQualified = computed(() => userStatus.value?.qualified ?? false)

  const userSeed = computed(() => userStatus.value?.seed ?? null)

  const userConference = computed(() => userStatus.value?.conference ?? null)

  const userNextOpponent = computed(() => userStatus.value?.opponent ?? null)

  const eastBracket = computed(() => bracket.value?.east ?? null)

  const westBracket = computed(() => bracket.value?.west ?? null)

  const finals = computed(() => bracket.value?.finals ?? null)

  const finalsMVP = computed(() => bracket.value?.finalsMVP ?? null)

  // Get all series for a conference
  const getConferenceSeries = (conference) => {
    if (!bracket.value || !bracket.value[conference]) return []
    const conf = bracket.value[conference]
    return [
      ...(conf.round1 || []),
      ...(conf.round2 || []),
      ...(conf.confFinals ? [conf.confFinals] : [])
    ]
  }

  // Actions
  async function checkRegularSeasonEnd(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/playoffs/check-regular-season-end`)
      regularSeasonComplete.value = response.data.regularSeasonComplete
      bracketGenerated.value = response.data.bracketGenerated
      userStatus.value = response.data.userStatus

      // Show season end modal if regular season just completed and bracket not yet generated
      if (regularSeasonComplete.value && !bracketGenerated.value) {
        showSeasonEndModal.value = true
      }

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to check season status'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchBracket(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/playoffs/bracket`)
      bracket.value = response.data.bracket
      return bracket.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch bracket'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function generateBracket(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.post(`/api/campaigns/${campaignId}/playoffs/generate`)
      bracket.value = response.data.bracket
      userStatus.value = response.data.userStatus
      bracketGenerated.value = true
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to generate bracket'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchSeries(campaignId, seriesId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/playoffs/series/${seriesId}`)
      currentSeries.value = response.data.series
      return currentSeries.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch series'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchNextUserSeries(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/playoffs/next-series`)
      currentSeries.value = response.data.series
      return currentSeries.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch next series'
      throw err
    } finally {
      loading.value = false
    }
  }

  // Handle playoff update from game simulation
  function handlePlayoffUpdate(playoffUpdate) {
    if (!playoffUpdate) return

    seriesResult.value = playoffUpdate

    // Refresh bracket with updated series
    if (playoffUpdate.series) {
      updateSeriesInBracket(playoffUpdate.seriesId, playoffUpdate.series)
    }

    // Show appropriate modal
    if (playoffUpdate.seriesComplete) {
      if (playoffUpdate.isChampion) {
        showChampionshipModal.value = true
      } else {
        showSeriesResultModal.value = true
      }
    }
  }

  // Update a series in the local bracket state
  function updateSeriesInBracket(seriesId, updatedSeries) {
    if (!bracket.value) return

    // Search and update in both conferences
    for (const conf of ['east', 'west']) {
      if (!bracket.value[conf]) continue

      // Round 1
      for (let i = 0; i < (bracket.value[conf].round1?.length || 0); i++) {
        if (bracket.value[conf].round1[i].seriesId === seriesId) {
          bracket.value[conf].round1[i] = updatedSeries
          return
        }
      }

      // Round 2
      for (let i = 0; i < (bracket.value[conf].round2?.length || 0); i++) {
        if (bracket.value[conf].round2[i].seriesId === seriesId) {
          bracket.value[conf].round2[i] = updatedSeries
          return
        }
      }

      // Conference Finals
      if (bracket.value[conf].confFinals?.seriesId === seriesId) {
        bracket.value[conf].confFinals = updatedSeries
        return
      }
    }

    // Finals
    if (bracket.value.finals?.seriesId === seriesId) {
      bracket.value.finals = updatedSeries

      // Update champion if finals complete
      if (updatedSeries.status === 'complete' && updatedSeries.winner) {
        bracket.value.champion = updatedSeries.winner
      }
    }
  }

  // Modal control
  function closeSeasonEndModal() {
    showSeasonEndModal.value = false
  }

  function closeSeriesResultModal() {
    showSeriesResultModal.value = false
    seriesResult.value = null
  }

  function closeChampionshipModal() {
    showChampionshipModal.value = false
    seriesResult.value = null
  }

  // Reset store state
  function $reset() {
    bracket.value = null
    userStatus.value = null
    currentSeries.value = null
    seriesResult.value = null
    loading.value = false
    error.value = null
    showSeasonEndModal.value = false
    showSeriesResultModal.value = false
    showChampionshipModal.value = false
    regularSeasonComplete.value = false
    bracketGenerated.value = false
  }

  return {
    // State
    bracket,
    userStatus,
    currentSeries,
    seriesResult,
    loading,
    error,
    regularSeasonComplete,
    bracketGenerated,

    // Modal state
    showSeasonEndModal,
    showSeriesResultModal,
    showChampionshipModal,

    // Getters
    isInPlayoffs,
    champion,
    userQualified,
    userSeed,
    userConference,
    userNextOpponent,
    eastBracket,
    westBracket,
    finals,
    finalsMVP,
    getConferenceSeries,

    // Actions
    checkRegularSeasonEnd,
    fetchBracket,
    generateBracket,
    fetchSeries,
    fetchNextUserSeries,
    handlePlayoffUpdate,
    updateSeriesInBracket,
    closeSeasonEndModal,
    closeSeriesResultModal,
    closeChampionshipModal,
    $reset,
  }
})
