import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { PlayoffManager } from '@/engine/season/PlayoffManager'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { useAuthStore } from '@/stores/auth'
import { useCampaignStore } from '@/stores/campaign'
import { useToastStore } from '@/stores/toast'
import api from '@/composables/useApi'

// Postseason token payouts. Each tier is paid as an INCREMENT on top of the
// previous tier so a champion ends up with the full 5,000:
//   • Made the playoffs:                    750  (paid: 750)
//   • Win R1 (lose in R2):                +250  (total 1,000)
//   • Win R2 (lose in conference finals): +250  (total 1,250)
//   • Win conference finals (lose finals): +250  (total 1,500)
//   • Win the finals (champion):         +3,500 (total 5,000)
const PLAYOFF_PAYOUTS = {
  madePlayoffs: 750,
  round1Won: 250,
  round2Won: 250,
  round3Won: 250,
  championship: 3500,
}

const ROUND_TO_KEY = {
  1: 'round1Won',
  2: 'round2Won',
  3: 'round3Won',
  4: 'championship',
}

const PAYOUT_LABEL = {
  madePlayoffs: 'Made the playoffs',
  round1Won: 'Advanced past the first round',
  round2Won: 'Reached the conference finals',
  round3Won: 'Reached the League Finals',
  championship: 'Won the championship',
}

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

  // Get playoff round label
  function getPlayoffRoundLabel(round) {
    switch (round) {
      case 1: return 'First Round'
      case 2: return 'Semifinals'
      case 3: return 'Conference Finals'
      case 4: return 'Finals'
      default: return 'Playoffs'
    }
  }

  // Look up a series from the already-loaded bracket (synchronous)
  function getSeriesFromBracket(seriesId) {
    if (!bracket.value || !seriesId) return null
    for (const conf of ['east', 'west']) {
      const confData = bracket.value[conf]
      if (!confData) continue
      for (const series of (confData.round1 || [])) {
        if (series?.seriesId === seriesId) return series
      }
      for (const series of (confData.round2 || [])) {
        if (series?.seriesId === seriesId) return series
      }
      if (confData.confFinals?.seriesId === seriesId) return confData.confFinals
    }
    if (bracket.value.finals?.seriesId === seriesId) return bracket.value.finals
    return null
  }

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

      // Show season end modal if regular season just completed and bracket not yet generated.
      // Don't show if already in any offseason sub-phase — the user has already
      // handled the season-end transition (legacy 'offseason', the 2-week
      // 'offseason_free_agency' window, or post-FA 'offseason_draft').
      const phase = campaign?.phase
      const inOffseason = phase === 'offseason'
        || phase === 'offseason_free_agency'
        || phase === 'offseason_draft'
      if (regularSeasonComplete.value && !bracketGenerated.value && !inOffseason) {
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

  /**
   * Pay out a postseason bonus to the user. Idempotent per `(seasonData,
   * tierKey)` — tracks already-paid tiers on the bracket itself so re-running
   * the same hook (e.g. on game replays) doesn't double-grant.
   */
  async function _awardPlayoffTokens(seasonData, tierKey) {
    if (!seasonData?.playoffBracket) return false
    if (!PLAYOFF_PAYOUTS[tierKey]) return false

    const bracketObj = seasonData.playoffBracket
    if (!bracketObj.userPayouts) bracketObj.userPayouts = {}
    if (bracketObj.userPayouts[tierKey]) return false // already paid this tier

    const amount = PLAYOFF_PAYOUTS[tierKey]
    const authStore = useAuthStore()
    const toastStore = useToastStore()

    try {
      const response = await api.post('/api/user/tokens', { amount })
      if (authStore.profile && typeof response.data?.tokens === 'number') {
        authStore.profile.tokens = response.data.tokens
      }
      bracketObj.userPayouts[tierKey] = true
      toastStore.showTokenAward({ label: PAYOUT_LABEL[tierKey], amount })
      return true
    } catch (err) {
      console.error('Failed to award playoff tokens:', err)
      return false
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

      // Pay the "made the playoffs" bonus once when the bracket is generated
      // and the user's team qualified.
      if (userStatus.value?.qualified) {
        await _awardPlayoffTokens(seasonData, 'madePlayoffs')
      }

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

      // Award the user any postseason tokens they unlocked by winning this
      // series. Tier increments: 250 for R1/R2/R3 wins, 3,500 for the title.
      // series.winner is the TEAM OBJECT (PlayoffManager stamps team1/team2),
      // so compare its teamId — comparing the object itself never matches.
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const winnerId = seriesUpdate.series?.winner?.teamId ?? seriesUpdate.series?.winner ?? null
      if (winnerId && userTeamId && winnerId === userTeamId) {
        const tierKey = ROUND_TO_KEY[seriesUpdate.round]
        if (tierKey) {
          await _awardPlayoffTokens(seasonData, tierKey)
        }
        if (seriesUpdate.round === 4) {
          // User just won the title: stamp the owner-congrats marker.
          // CampaignHomeView consumes it (impromptu owner text + bonus
          // rewards) after the championship recap closes, before offseason.
          try {
            const marker = {
              year: campaign?.currentSeasonYear ?? campaign?.current_season_year ?? null,
            }
            await CampaignRepository.updateSettings(campaignId, {
              pendingOwnerTitleCongrats: marker,
            })
            // Mirror into the reactive campaign so the congrats chain fires
            // immediately after the recap closes (no refetch needed).
            const campaignStore = useCampaignStore()
            if (campaignStore.currentCampaign?.id === campaignId) {
              campaignStore.currentCampaign.settings = {
                ...campaignStore.currentCampaign.settings,
                pendingOwnerTitleCongrats: marker,
              }
            }
          } catch (err) {
            console.warn('[Playoffs] failed to stamp owner congrats marker:', err)
          }
        }
      }

      // Generate schedule for the next round if new matchups were created
      const nextRound = seriesUpdate.round + 1
      if (nextRound <= 4) {
        const teams = await TeamRepository.getAllForCampaign(campaignId)
        const year = campaign?.currentSeasonYear ?? 2025
        PlayoffManager.generatePlayoffSchedule(seasonData, teams, nextRound, year)
      }
    }

    // Note: caller (_persistGameResult) saves seasonData to IndexedDB

    // Update local bracket state
    bracket.value = seasonData.playoffBracket

    return seriesUpdate
  }

  // Show the championship recap modal straight from a bracket object. Used by
  // the bulk-sim path (user eliminated, AI champion crowned) and the
  // enter-offseason gate — neither goes through handlePlayoffUpdate.
  function showChampionshipRecap(bracketObj) {
    const finalsSeries = bracketObj?.finals
    if (!finalsSeries?.winner) return false
    seriesResult.value = {
      seriesId: finalsSeries.seriesId,
      series: finalsSeries,
      seriesComplete: true,
      round: 4,
      isFinals: true,
      isChampion: true,
    }
    showChampionshipModal.value = true
    return true
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
    getPlayoffRoundLabel,
    getSeriesFromBracket,

    // Actions
    checkRegularSeasonEnd,
    fetchBracket,
    generateBracket,
    fetchSeries,
    fetchNextUserSeries,
    processPlayoffGameResult,
    handlePlayoffUpdate,
    showChampionshipRecap,
    updateSeriesInBracket,
    closeSeasonEndModal,
    closeSeriesResultModal,
    closeChampionshipModal,
    $reset,
  }
})
