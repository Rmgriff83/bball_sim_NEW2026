import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { campaignCacheService } from '@/services/CampaignCacheService'

export const useLeagueStore = defineStore('league', () => {
  // State
  const standings = ref({ east: [], west: [] })
  const playerLeaders = ref([])
  const schedule = ref([])
  const loading = ref(false)
  const loadingLeaders = ref(false)
  const error = ref(null)

  // Cache tracking
  const _standingsCampaignId = ref(null)
  const _leadersCampaignId = ref(null)

  // Getters
  const eastStandings = computed(() => standings.value.east || [])
  const westStandings = computed(() => standings.value.west || [])

  const topEightEast = computed(() => eastStandings.value.slice(0, 8))
  const topEightWest = computed(() => westStandings.value.slice(0, 8))

  const playoffTeams = computed(() => [
    ...topEightEast.value,
    ...topEightWest.value,
  ])

  const leagueLeaders = computed(() => {
    // Combine standings and sort by win percentage
    const all = [...eastStandings.value, ...westStandings.value]
    return all.sort((a, b) => {
      const totalA = a.wins + a.losses
      const totalB = b.wins + b.losses
      const pctA = totalA > 0 ? a.wins / totalA : 0
      const pctB = totalB > 0 ? b.wins / totalB : 0
      if (pctA !== pctB) return pctB - pctA
      const diffA = (a.pointsFor || 0) - (a.pointsAgainst || 0)
      const diffB = (b.pointsFor || 0) - (b.pointsAgainst || 0)
      return diffB - diffA
    })
  })

  // Actions
  async function fetchStandings(campaignId, { force = false } = {}) {
    // Return cached data if already loaded for this campaign
    if (!force && _standingsCampaignId.value === campaignId && (standings.value.east?.length > 0 || standings.value.west?.length > 0)) {
      return standings.value
    }

    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/standings`)
      standings.value = response.data.standings
      _standingsCampaignId.value = campaignId

      // Get year from response or use current year
      const seasonYear = response.data.year || new Date().getFullYear()

      // Always update standings in cache
      await campaignCacheService.updateStandings(campaignId, seasonYear, standings.value)

      return standings.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch standings'
      throw err
    } finally {
      loading.value = false
    }
  }

  function updateStandings(newStandings) {
    standings.value = newStandings
  }

  function getTeamRank(teamId, conference) {
    const conferenceStandings = conference === 'east' ? eastStandings.value : westStandings.value
    const index = conferenceStandings.findIndex(s => s.teamId === teamId)
    return index >= 0 ? index + 1 : null
  }

  function getWinPercentage(wins, losses) {
    const total = wins + losses
    if (total === 0) return '.000'
    const pct = wins / total
    return pct.toFixed(3).substring(1) // Remove leading 0
  }

  function getGamesBehind(wins, losses, leaderWins, leaderLosses) {
    const gb = ((leaderWins - wins) + (losses - leaderLosses)) / 2
    if (gb === 0) return '-'
    return gb.toFixed(1)
  }

  function clearStandings() {
    standings.value = { east: [], west: [] }
    _standingsCampaignId.value = null
  }

  async function fetchPlayerLeaders(campaignId, { force = false } = {}) {
    // Return cached data if already loaded for this campaign
    if (!force && _leadersCampaignId.value === campaignId && playerLeaders.value.length > 0) {
      return playerLeaders.value
    }

    loadingLeaders.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/league-leaders`)
      playerLeaders.value = response.data.leaders || []
      _leadersCampaignId.value = campaignId
      return playerLeaders.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch league leaders'
      throw err
    } finally {
      loadingLeaders.value = false
    }
  }

  function clearPlayerLeaders() {
    playerLeaders.value = []
    _leadersCampaignId.value = null
  }

  function invalidate() {
    _standingsCampaignId.value = null
    _leadersCampaignId.value = null
  }

  return {
    // State
    standings,
    playerLeaders,
    schedule,
    loading,
    loadingLeaders,
    error,
    // Getters
    eastStandings,
    westStandings,
    topEightEast,
    topEightWest,
    playoffTeams,
    leagueLeaders,
    // Actions
    fetchStandings,
    fetchPlayerLeaders,
    updateStandings,
    getTeamRank,
    getWinPercentage,
    getGamesBehind,
    clearStandings,
    clearPlayerLeaders,
    invalidate,
  }
})
