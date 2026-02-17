import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { PlayoffManager } from '@/engine/season/PlayoffManager'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'

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

  // Helper: get campaign year and season data
  async function _getSeasonData(campaignId) {
    const campaign = await CampaignRepository.get(campaignId)
    const year = campaign?.currentSeasonYear ?? 2025
    const seasonData = await SeasonRepository.get(campaignId, year)
    return { campaign, year, seasonData }
  }

  // Actions
  async function checkRegularSeasonEnd(campaignId) {
    loading.value = true
    error.value = null
    try {
      const { campaign, seasonData } = await _getSeasonData(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const teams = await TeamRepository.getAllForCampaign(campaignId)

      // Check if regular season is complete using PlayoffManager
      const isComplete = PlayoffManager.isRegularSeasonComplete(seasonData)
      regularSeasonComplete.value = isComplete

      // Check if bracket already exists
      const existingBracket = PlayoffManager.getBracket(seasonData)
      bracketGenerated.value = existingBracket !== null

      // Get user playoff status
      if (isComplete && seasonData) {
        userStatus.value = PlayoffManager.getUserPlayoffStatus(seasonData, userTeamId, teams)
      }

      // Show season end modal if regular season just completed and bracket not yet generated
      if (regularSeasonComplete.value && !bracketGenerated.value) {
        showSeasonEndModal.value = true
      }

      return {
        regularSeasonComplete: regularSeasonComplete.value,
        bracketGenerated: bracketGenerated.value,
        userStatus: userStatus.value,
      }
    } catch (err) {
      error.value = err.message || 'Failed to check season status'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchBracket(campaignId) {
    loading.value = true
    error.value = null
    try {
      const { seasonData } = await _getSeasonData(campaignId)

      bracket.value = PlayoffManager.getBracket(seasonData)
      return bracket.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch bracket'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function generateBracket(campaignId) {
    loading.value = true
    error.value = null
    try {
      const { campaign, year, seasonData } = await _getSeasonData(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const teams = await TeamRepository.getAllForCampaign(campaignId)

      // Generate the bracket (mutates seasonData in place)
      const generatedBracket = PlayoffManager.generatePlayoffBracket(seasonData, teams)
      bracket.value = generatedBracket

      // Generate round 1 playoff schedule
      PlayoffManager.generatePlayoffSchedule(seasonData, teams, 1, year)

      // Get user playoff status
      userStatus.value = PlayoffManager.getUserPlayoffStatus(seasonData, userTeamId, teams)

      bracketGenerated.value = true

      // Persist updated season data with bracket and round 1 schedule
      await SeasonRepository.save(seasonData)

      return {
        bracket: bracket.value,
        userStatus: userStatus.value,
      }
    } catch (err) {
      error.value = err.message || 'Failed to generate bracket'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchSeries(campaignId, seriesId) {
    loading.value = true
    error.value = null
    try {
      const { seasonData } = await _getSeasonData(campaignId)

      currentSeries.value = PlayoffManager.getSeries(seasonData, seriesId)
      return currentSeries.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch series'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchNextUserSeries(campaignId) {
    loading.value = true
    error.value = null
    try {
      const { campaign, seasonData } = await _getSeasonData(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId

      currentSeries.value = PlayoffManager.getNextUserSeries(seasonData, userTeamId)
      return currentSeries.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch next series'
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Process a completed playoff game: update series, advance rounds, generate schedule.
   * Called from game store after persisting a playoff game result.
   * @returns {Object|null} Playoff update for UI (modals, bracket refresh)
   */
  async function processPlayoffGameResult(campaignId, seasonData, game, homeScore, awayScore) {
    const seriesUpdate = PlayoffManager.updateSeriesAfterGame(seasonData, game, homeScore, awayScore)
    if (!seriesUpdate) return null

    // If series is complete, advance to next round
    if (seriesUpdate.seriesComplete) {
      PlayoffManager.advanceWinnerToNextRound(seasonData, seriesUpdate)

      // Generate schedule for the next round if new matchups were created
      const nextRound = seriesUpdate.round + 1
      if (nextRound <= 4) {
        const teams = await TeamRepository.getAllForCampaign(campaignId)
        const campaign = await CampaignRepository.get(campaignId)
        const year = campaign?.currentSeasonYear ?? 2025
        PlayoffManager.generatePlayoffSchedule(seasonData, teams, nextRound, year)
      }
    }

    // Note: caller (_persistGameResult) saves seasonData to IndexedDB

    // Update local bracket state
    bracket.value = seasonData.playoffBracket

    return seriesUpdate
  }

  // Handle playoff update from game simulation (updates UI state / modals)
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
    processPlayoffGameResult,
    handlePlayoffUpdate,
    updateSeriesInBracket,
    closeSeasonEndModal,
    closeSeriesResultModal,
    closeChampionshipModal,
    $reset,
  }
})
