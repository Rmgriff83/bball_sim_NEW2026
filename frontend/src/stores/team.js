import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'

export const useTeamStore = defineStore('team', () => {
  // State
  const team = ref(null)
  const roster = ref([])
  const coach = ref(null)
  const selectedPlayer = ref(null)
  const freeAgents = ref([])
  const allTeams = ref([])
  const coachingSchemes = ref({})
  const recommendedScheme = ref(null)
  const loading = ref(false)
  const error = ref(null)

  // Getters
  const starters = computed(() =>
    roster.value.filter((_, index) => index < 5)
  )

  const bench = computed(() =>
    roster.value.filter((_, index) => index >= 5)
  )

  const rosterByPosition = computed(() => {
    const positions = { PG: [], SG: [], SF: [], PF: [], C: [] }
    roster.value.forEach(player => {
      if (positions[player.position]) {
        positions[player.position].push(player)
      }
    })
    return positions
  })

  const totalSalary = computed(() =>
    roster.value.reduce((sum, player) => sum + (player.contract?.salary || 0), 0)
  )

  const capSpace = computed(() =>
    team.value ? team.value.salary_cap - totalSalary.value : 0
  )

  const averageOverall = computed(() => {
    if (roster.value.length === 0) return 0
    return Math.round(
      roster.value.reduce((sum, p) => sum + p.overall_rating, 0) / roster.value.length
    )
  })

  // Actions
  async function fetchTeam(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/team`)
      team.value = response.data.team
      roster.value = response.data.roster
      coach.value = response.data.coach
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch team'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchPlayer(campaignId, playerId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/players/${playerId}`)
      selectedPlayer.value = response.data.player
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch player'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function updateLineup(campaignId, starters, rotation = []) {
    loading.value = true
    error.value = null
    try {
      const response = await api.put(`/api/campaigns/${campaignId}/team/lineup`, {
        starters,
        rotation,
      })
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to update lineup'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchAllTeams(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/teams`)
      allTeams.value = response.data.teams
      return allTeams.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch teams'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchTeamRoster(campaignId, teamId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/teams/${teamId}/roster`)
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch team roster'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchFreeAgents(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/free-agents`)
      freeAgents.value = response.data.free_agents
      return freeAgents.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch free agents'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function signPlayer(campaignId, playerId, years, salary) {
    loading.value = true
    error.value = null
    try {
      const response = await api.post(`/api/campaigns/${campaignId}/players/${playerId}/sign`, {
        years,
        salary,
      })

      // Remove from free agents
      freeAgents.value = freeAgents.value.filter(p => p.id !== playerId)

      // Add to roster
      roster.value.push(response.data.player)

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to sign player'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function releasePlayer(campaignId, playerId) {
    loading.value = true
    error.value = null
    try {
      await api.post(`/api/campaigns/${campaignId}/players/${playerId}/release`)

      // Remove from roster
      const player = roster.value.find(p => p.id === playerId)
      roster.value = roster.value.filter(p => p.id !== playerId)

      // Add to free agents
      if (player) {
        freeAgents.value.push({ ...player, contract: { years_remaining: 0, salary: 0 } })
      }
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to release player'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchCoachingSchemes(campaignId) {
    loading.value = true
    error.value = null
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/team/coaching-schemes`)
      coachingSchemes.value = response.data.schemes
      recommendedScheme.value = response.data.recommended
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch coaching schemes'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function updateCoachingScheme(campaignId, offensiveScheme, defensiveScheme = null) {
    loading.value = true
    error.value = null
    try {
      // Get current defensive scheme if not provided
      const currentDefensive = team.value?.coaching_scheme?.defensive || 'man'
      const payload = {
        offensive: offensiveScheme,
        defensive: defensiveScheme || currentDefensive
      }
      const response = await api.put(`/api/campaigns/${campaignId}/team/coaching-scheme`, payload)
      // Update local team state with new format
      if (team.value) {
        team.value.coaching_scheme = response.data.coaching_scheme || payload
      }
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to update coaching scheme'
      throw err
    } finally {
      loading.value = false
    }
  }

  function clearSelectedPlayer() {
    selectedPlayer.value = null
  }

  function clearTeam() {
    team.value = null
    roster.value = []
    coach.value = null
    coachingSchemes.value = {}
    recommendedScheme.value = null
  }

  // Utility functions
  function getPositionColor(position) {
    const colors = {
      PG: '#3B82F6', // Blue
      SG: '#10B981', // Green
      SF: '#F59E0B', // Amber
      PF: '#EF4444', // Red
      C: '#8B5CF6', // Purple
    }
    return colors[position] || '#6B7280'
  }

  function getRatingColor(rating) {
    if (rating >= 90) return 'var(--color-success)'
    if (rating >= 80) return 'var(--color-tertiary)'
    if (rating >= 70) return 'var(--color-primary)'
    if (rating >= 60) return 'var(--color-warning)'
    return 'var(--color-error)'
  }

  function formatSalary(salary) {
    if (salary >= 1000000) {
      return `$${(salary / 1000000).toFixed(1)}M`
    }
    return `$${(salary / 1000).toFixed(0)}K`
  }

  return {
    // State
    team,
    roster,
    coach,
    selectedPlayer,
    freeAgents,
    allTeams,
    coachingSchemes,
    recommendedScheme,
    loading,
    error,
    // Getters
    starters,
    bench,
    rosterByPosition,
    totalSalary,
    capSpace,
    averageOverall,
    // Actions
    fetchTeam,
    fetchPlayer,
    updateLineup,
    fetchAllTeams,
    fetchTeamRoster,
    fetchFreeAgents,
    signPlayer,
    releasePlayer,
    fetchCoachingSchemes,
    updateCoachingScheme,
    clearSelectedPlayer,
    clearTeam,
    // Utilities
    getPositionColor,
    getRatingColor,
    formatSalary,
  }
})
