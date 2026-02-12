import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { campaignCacheService } from '@/services/CampaignCacheService'
import { useToastStore } from '@/stores/toast'

export const useGameStore = defineStore('game', () => {
  // State
  const games = ref([])
  const currentGame = ref(null)
  const simulationResult = ref(null)
  const loading = ref(false)
  const simulating = ref(false)
  const error = ref(null)

  // Live simulation state (quarter-by-quarter)
  const isLiveSimulation = ref(false)
  const currentSimQuarter = ref(0)
  const quarterAnimationData = ref([])

  // Simulate to next game state
  const simulatePreview = ref(null)
  const loadingPreview = ref(false)

  // Cache tracking
  const _loadedCampaignId = ref(null)

  // Background simulation state
  const backgroundSimulating = ref(false)
  const simulationBatchId = ref(null)
  const simulationProgress = ref(null)
  let simulationPollTimer = null
  let simulationProgressToastId = null

  // Getters
  const upcomingGames = computed(() =>
    games.value.filter(g => !g.is_complete).slice(0, 10)
  )

  const completedGames = computed(() =>
    games.value.filter(g => g.is_complete)
  )

  const userGames = computed(() =>
    games.value.filter(g => g.is_user_game)
  )

  const nextUserGame = computed(() =>
    userGames.value.find(g => !g.is_complete)
  )

  // Actions
  async function fetchGames(campaignId, { force = false } = {}) {
    // Return cached data if already loaded for this campaign
    if (!force && _loadedCampaignId.value === campaignId && games.value.length > 0) {
      return games.value
    }

    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/games`)
      games.value = response.data.games
      _loadedCampaignId.value = campaignId
      return games.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch games'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchGame(campaignId, gameId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/games/${gameId}`)
      currentGame.value = response.data.game
      return currentGame.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch game'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function simulateGame(campaignId, gameId, mode = 'animated', year = null) {
    simulating.value = true
    error.value = null
    try {
      const response = await api.post(`/api/campaigns/${campaignId}/games/${gameId}/simulate`, { mode })
      simulationResult.value = response.data.result

      // Update game in list
      const index = games.value.findIndex(g => g.id === gameId)
      if (index !== -1) {
        games.value[index] = {
          ...games.value[index],
          is_complete: true,
          home_score: response.data.result.home_score,
          away_score: response.data.result.away_score,
        }
      }

      currentGame.value = {
        ...currentGame.value,
        is_complete: true,
        home_score: response.data.result.home_score,
        away_score: response.data.result.away_score,
        box_score: response.data.result.box_score,
        quarter_scores: response.data.result.quarter_scores,
        play_by_play: response.data.result.play_by_play,
        animation_data: response.data.result.animation_data,
        evolution: response.data.result.evolution,
        rewards: response.data.result.rewards,
      }

      // Update cache with game result
      if (year) {
        await campaignCacheService.updateGameResult(campaignId, year, gameId, {
          home_score: response.data.result.home_score,
          away_score: response.data.result.away_score,
        })
      }

      // Start background polling if batch was dispatched
      if (response.data.batchId) {
        startPollingSimulationStatus(campaignId, response.data.batchId)
      }

      return response.data.result
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to simulate game'
      throw err
    } finally {
      simulating.value = false
    }
  }

  async function simulateDay(campaignId) {
    simulating.value = true
    error.value = null
    try {
      const response = await api.post(`/api/campaigns/${campaignId}/simulate-day`)

      // Update user's game result if present
      if (response.data.userGameResult) {
        const result = response.data.userGameResult
        const index = games.value.findIndex(g => g.id === result.game_id)
        if (index !== -1) {
          games.value[index] = {
            ...games.value[index],
            is_complete: true,
            home_score: result.home_score,
            away_score: result.away_score,
          }
        }
      }

      // Start background polling if batch was dispatched
      if (response.data.batchId) {
        startPollingSimulationStatus(campaignId, response.data.batchId)
      }

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to simulate day'
      throw err
    } finally {
      simulating.value = false
    }
  }

  function clearSimulationResult() {
    simulationResult.value = null
  }

  function clearCurrentGame() {
    currentGame.value = null
  }

  /**
   * Start a live quarter-by-quarter game simulation (Q1).
   * @param {Object} settings - Optional { home_lineup, away_lineup, offensive_style, defensive_style }
   */
  async function startLiveGame(campaignId, gameId, settings = null) {
    simulating.value = true
    isLiveSimulation.value = true
    currentSimQuarter.value = 0
    quarterAnimationData.value = []
    error.value = null

    try {
      const response = await api.post(`/api/campaigns/${campaignId}/games/${gameId}/start`, settings || {})

      currentSimQuarter.value = 1

      // Store Q1 animation data
      quarterAnimationData.value.push({
        quarter: 1,
        possessions: response.data.animation_data.possessions,
        quarterEndIndex: response.data.animation_data.quarter_end_index,
      })

      // Update current game state
      currentGame.value = {
        ...currentGame.value,
        is_in_progress: true,
        home_score: response.data.scores.home,
        away_score: response.data.scores.away,
        box_score: response.data.box_score,
        quarter_scores: response.data.scores.quarterScores,
      }

      // Also update in games list so homepage shows in-progress state
      const index = games.value.findIndex(g => g.id === gameId)
      if (index !== -1) {
        games.value[index] = {
          ...games.value[index],
          is_in_progress: true,
          home_score: response.data.scores.home,
          away_score: response.data.scores.away,
          current_quarter: 1,
        }
      }

      // Start background polling if pre-game AI games were dispatched
      if (response.data.batchId) {
        startPollingSimulationStatus(campaignId, response.data.batchId)
      }

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to start game'
      isLiveSimulation.value = false
      throw err
    } finally {
      simulating.value = false
    }
  }

  /**
   * Continue a live game simulation (Q2+).
   * @param {Object} adjustments - Optional { home_lineup, offensive_style, defensive_style }
   */
  async function continueGame(campaignId, gameId, adjustments = null) {
    simulating.value = true
    error.value = null

    try {
      const response = await api.post(
        `/api/campaigns/${campaignId}/games/${gameId}/continue`,
        adjustments
      )

      currentSimQuarter.value = response.data.quarter

      // Append this quarter's animation data
      quarterAnimationData.value.push({
        quarter: response.data.quarter,
        possessions: response.data.animation_data.possessions,
        quarterEndIndex: response.data.animation_data.quarter_end_index,
      })

      if (response.data.isGameComplete) {
        // Game finished
        isLiveSimulation.value = false

        // Merge all quarter animation data for replay
        const allPossessions = quarterAnimationData.value.flatMap(q => q.possessions)
        const quarterEndIndices = quarterAnimationData.value.map(q => q.quarterEndIndex)

        currentGame.value = {
          ...currentGame.value,
          is_complete: true,
          is_in_progress: false,
          home_score: response.data.result.home_score,
          away_score: response.data.result.away_score,
          box_score: response.data.result.box_score,
          quarter_scores: response.data.result.quarter_scores,
          evolution: response.data.result.evolution,
          rewards: response.data.result.rewards,
          animation_data: {
            possessions: allPossessions,
            quarter_end_indices: quarterEndIndices,
            total_possessions: allPossessions.length,
          },
        }

        // Update game in list
        const index = games.value.findIndex(g => g.id === gameId)
        if (index !== -1) {
          games.value[index] = {
            ...games.value[index],
            is_complete: true,
            is_in_progress: false,
            home_score: response.data.result.home_score,
            away_score: response.data.result.away_score,
          }
        }

        // Save game result to IndexedDB
        const year = response.data.year || new Date().getFullYear()
        await campaignCacheService.updateGameResult(campaignId, year, gameId, {
          home_score: response.data.result.home_score,
          away_score: response.data.result.away_score,
        })

        // Save updated standings if returned
        if (response.data.standings) {
          await campaignCacheService.updateStandings(campaignId, year, response.data.standings)
        }

        // Save updated player stats if returned
        if (response.data.playerStats) {
          await campaignCacheService.updatePlayerStats(campaignId, year, response.data.playerStats)
        }

        // Start background polling if batch was dispatched for remaining day games
        if (response.data.batchId) {
          startPollingSimulationStatus(campaignId, response.data.batchId)
        }
      } else {
        // Game continues
        currentGame.value = {
          ...currentGame.value,
          home_score: response.data.scores.home,
          away_score: response.data.scores.away,
          box_score: response.data.box_score,
          quarter_scores: response.data.scores.quarterScores,
        }

        // Keep games list in sync with scores/quarter
        const idx = games.value.findIndex(g => g.id === gameId)
        if (idx !== -1) {
          games.value[idx] = {
            ...games.value[idx],
            is_in_progress: true,
            home_score: response.data.scores.home,
            away_score: response.data.scores.away,
            current_quarter: response.data.quarter,
          }
        }
      }

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to continue game'
      throw err
    } finally {
      simulating.value = false
    }
  }

  /**
   * Sim an in-progress game to completion (skip remaining quarters).
   */
  async function simToEnd(campaignId, gameId) {
    simulating.value = true
    error.value = null

    try {
      const response = await api.post(`/api/campaigns/${campaignId}/games/${gameId}/sim-to-end`)

      isLiveSimulation.value = false

      currentGame.value = {
        ...currentGame.value,
        is_complete: true,
        is_in_progress: false,
        home_score: response.data.result.home_score,
        away_score: response.data.result.away_score,
        box_score: response.data.result.box_score,
        quarter_scores: response.data.result.quarter_scores,
        evolution: response.data.result.evolution,
        rewards: response.data.rewards,
      }

      // Update game in list
      const index = games.value.findIndex(g => g.id === gameId)
      if (index !== -1) {
        games.value[index] = {
          ...games.value[index],
          is_complete: true,
          is_in_progress: false,
          home_score: response.data.result.home_score,
          away_score: response.data.result.away_score,
        }
      }

      // Start background polling if batch was dispatched
      if (response.data.batchId) {
        startPollingSimulationStatus(campaignId, response.data.batchId)
      }

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to sim to end'
      throw err
    } finally {
      simulating.value = false
    }
  }

  /**
   * Clear live simulation state.
   */
  function clearLiveSimulation() {
    isLiveSimulation.value = false
    currentSimQuarter.value = 0
    quarterAnimationData.value = []
  }

  /**
   * Fetch preview data for simulating to the next user game.
   */
  async function fetchSimulateToNextGamePreview(campaignId) {
    loadingPreview.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/simulate-to-next-game/preview`)
      simulatePreview.value = response.data
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch preview'
      throw err
    } finally {
      loadingPreview.value = false
    }
  }

  /**
   * Simulate all games up to and including the next user game.
   * @param {boolean} excludeUserGame - If true, only simulate games BEFORE user's game (for live play)
   */
  async function simulateToNextGame(campaignId, excludeUserGame = false) {
    simulating.value = true
    error.value = null
    try {
      const response = await api.post(`/api/campaigns/${campaignId}/simulate-to-next-game`, {
        excludeUserGame,
      })

      // Update user's game in list if it was simulated
      if (response.data.userGameResult) {
        const result = response.data.userGameResult
        const index = games.value.findIndex(g => g.id === result.game_id)
        if (index !== -1) {
          games.value[index] = {
            ...games.value[index],
            is_complete: true,
            home_score: result.home_score,
            away_score: result.away_score,
          }
        }

        // Update currentGame with full details if it matches
        if (currentGame.value?.id === result.game_id) {
          currentGame.value = {
            ...currentGame.value,
            is_complete: true,
            home_score: result.home_score,
            away_score: result.away_score,
            box_score: result.box_score,
            evolution: result.evolution,
            rewards: result.rewards,
          }
        }
      }

      // Start background polling if AI games were dispatched
      if (response.data.batchId) {
        startPollingSimulationStatus(campaignId, response.data.batchId)
      }

      // Release user-facing simulating immediately
      simulating.value = false

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to simulate to next game'
      simulating.value = false
      throw err
    }
  }

  /**
   * Clear the simulate preview state.
   */
  function clearSimulatePreview() {
    simulatePreview.value = null
  }

  function invalidate() {
    _loadedCampaignId.value = null
  }

  /**
   * Start polling for background simulation status.
   */
  function startPollingSimulationStatus(campaignId, batchId) {
    stopPolling()
    backgroundSimulating.value = true
    simulationBatchId.value = batchId
    simulationProgress.value = null

    const toastStore = useToastStore()
    simulationProgressToastId = toastStore.showProgress('League games', 0, 0)

    simulationPollTimer = setInterval(async () => {
      try {
        const response = await api.get(`/api/campaigns/${campaignId}/simulation-status/${batchId}`)
        simulationProgress.value = response.data.progress

        if (response.data.progress && simulationProgressToastId !== null) {
          toastStore.updateProgress(
            simulationProgressToastId,
            response.data.progress.completed,
            response.data.progress.total
          )
        }

        const status = response.data.status
        if (status === 'completed' || status === 'completed_with_errors' || status === 'cancelled') {
          stopPolling()
        }
      } catch (err) {
        console.error('Failed to poll simulation status:', err)
        // Stop polling on repeated errors
        stopPolling()
      }
    }, 2500)
  }

  /**
   * Stop polling and reset background simulation state.
   */
  function stopPolling() {
    if (simulationPollTimer) {
      clearInterval(simulationPollTimer)
      simulationPollTimer = null
    }
    if (simulationProgressToastId !== null) {
      const toastStore = useToastStore()
      toastStore.removeMinimalToast(simulationProgressToastId)
      simulationProgressToastId = null
    }
    backgroundSimulating.value = false
    simulationBatchId.value = null
    simulationProgress.value = null
  }

  /**
   * Resume polling if a batch ID is known (e.g., on page reload).
   */
  function resumePollingIfNeeded(campaignId, batchId) {
    if (batchId && !simulationPollTimer) {
      startPollingSimulationStatus(campaignId, batchId)
    }
  }

  return {
    // State
    games,
    currentGame,
    simulationResult,
    loading,
    simulating,
    error,
    isLiveSimulation,
    currentSimQuarter,
    quarterAnimationData,
    simulatePreview,
    loadingPreview,
    // Background simulation state
    backgroundSimulating,
    simulationBatchId,
    simulationProgress,
    // Getters
    upcomingGames,
    completedGames,
    userGames,
    nextUserGame,
    // Actions
    fetchGames,
    fetchGame,
    simulateGame,
    simulateDay,
    startLiveGame,
    continueGame,
    simToEnd,
    clearSimulationResult,
    clearCurrentGame,
    clearLiveSimulation,
    fetchSimulateToNextGamePreview,
    simulateToNextGame,
    clearSimulatePreview,
    invalidate,
    startPollingSimulationStatus,
    stopPolling,
    resumePollingIfNeeded,
  }
})
