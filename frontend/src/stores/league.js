import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'

export const useLeagueStore = defineStore('league', () => {
  // State
  const standings = ref({ east: [], west: [] })
  const schedule = ref([])
  const loading = ref(false)
  const error = ref(null)

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
    // Combine standings and sort by wins
    const all = [...eastStandings.value, ...westStandings.value]
    return all.sort((a, b) => b.wins - a.wins)
  })

  // Actions
  async function fetchStandings(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/standings`)
      standings.value = response.data.standings
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
  }

  return {
    // State
    standings,
    schedule,
    loading,
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
    updateStandings,
    getTeamRank,
    getWinPercentage,
    getGamesBehind,
    clearStandings,
  }
})
