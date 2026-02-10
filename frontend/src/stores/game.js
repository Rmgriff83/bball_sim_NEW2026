import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { campaignCacheService } from '@/services/CampaignCacheService'

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
  async function fetchGames(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/games`)
      games.value = response.data.games
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

      console.log('[simulateGame] Evolution data:', response.data.result.evolution)
      console.log('[simulateGame] Rewards data:', response.data.result.rewards)

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

      // Update completed games in list
      for (const result of response.data.results) {
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

        console.log('[continueGame] Evolution data:', response.data.result.evolution)
        console.log('[continueGame] Rewards data:', response.data.result.rewards)

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
            home_score: response.data.result.home_score,
            away_score: response.data.result.away_score,
          }
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

      // Update games list with simulated results
      if (response.data.simulatedDays) {
        for (const day of response.data.simulatedDays) {
          for (const result of day.results || []) {
            const index = games.value.findIndex(g => g.id === result.game_id)
            if (index !== -1) {
              games.value[index] = {
                ...games.value[index],
                is_complete: true,
                home_score: result.home_score,
                away_score: result.away_score,
              }
            }

            // If this is the user's game, update currentGame with full details
            if (result.is_user_game) {
              console.log('[simulateToNextGame] User game evolution data:', result.evolution)
              console.log('[simulateToNextGame] User game rewards data:', result.rewards)

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
          }
        }
      }

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to simulate to next game'
      throw err
    } finally {
      simulating.value = false
    }
  }

  /**
   * Clear the simulate preview state.
   */
  function clearSimulatePreview() {
    simulatePreview.value = null
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
    clearSimulationResult,
    clearCurrentGame,
    clearLiveSimulation,
    fetchSimulateToNextGamePreview,
    simulateToNextGame,
    clearSimulatePreview,
  }
})
