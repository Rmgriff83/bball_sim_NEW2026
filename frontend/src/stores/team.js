import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { campaignCacheService } from '@/services/CampaignCacheService'

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

  // Explicit lineup state - array of 5 player IDs in position order (PG, SG, SF, PF, C)
  const lineup = ref([null, null, null, null, null])

  // Getters
  // Get full player objects for each lineup slot
  const starterPlayers = computed(() => {
    return lineup.value.map(playerId => {
      if (!playerId) return null
      return roster.value.find(p => p.id === playerId) || null
    })
  })

  // Get bench players (not in lineup)
  const benchPlayers = computed(() => {
    const lineupIds = new Set(lineup.value.filter(id => id !== null))
    return roster.value
      .filter(p => p && !lineupIds.has(p.id))
      .sort((a, b) => b.overall_rating - a.overall_rating)
  })

  // Check if lineup has all 5 positions filled
  const isLineupComplete = computed(() =>
    lineup.value.filter(id => id !== null).length === 5
  )

  // Legacy getters (based on roster order) - kept for backwards compatibility
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

      // Populate lineup from saved settings or default to first 5 roster players
      const savedLineup = response.data.lineup_settings?.starters
      if (savedLineup && Array.isArray(savedLineup) && savedLineup.length === 5) {
        lineup.value = [...savedLineup]
      } else if (response.data.roster && response.data.roster.length >= 5) {
        // Default: first 5 players in roster order (they are ordered by lineup)
        lineup.value = response.data.roster.slice(0, 5).map(p => p.id)
      } else {
        lineup.value = [null, null, null, null, null]
      }

      // Update cache with team/roster data
      await campaignCacheService.updateCampaign(campaignId, {
        team: response.data.team,
        roster: response.data.roster,
        coach: response.data.coach,
      })

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
      // Update local state immediately for responsive UI
      if (Array.isArray(starters) && starters.length === 5) {
        lineup.value = [...starters]
      }

      const response = await api.put(`/api/campaigns/${campaignId}/team/lineup`, {
        starters,
        rotation,
      })

      // Mark cache as dirty (lineup changed)
      await campaignCacheService.updateCampaign(campaignId, {
        lineup: { starters, rotation }
      })

      // Refresh roster to ensure order matches new lineup
      await fetchTeam(campaignId)

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

  async function upgradePlayerAttribute(campaignId, playerId, category, attribute) {
    try {
      const response = await api.post(
        `/api/campaigns/${campaignId}/players/${playerId}/upgrade`,
        { category, attribute }
      )

      // Update local roster
      const idx = roster.value.findIndex(p => p.id === playerId)
      if (idx !== -1) {
        roster.value[idx].attributes[category][attribute] = response.data.new_value
        roster.value[idx].upgrade_points = response.data.remaining_points
        roster.value[idx].overall_rating = response.data.new_overall
      }

      return response.data
    } catch (err) {
      throw err
    }
  }

  function clearSelectedPlayer() {
    selectedPlayer.value = null
  }

  function clearTeam() {
    team.value = null
    roster.value = []
    coach.value = null
    lineup.value = [null, null, null, null, null]
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
    lineup,
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
    starterPlayers,
    benchPlayers,
    isLineupComplete,
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
    upgradePlayerAttribute,
    clearSelectedPlayer,
    clearTeam,
    // Utilities
    getPositionColor,
    getRatingColor,
    formatSalary,
  }
})
