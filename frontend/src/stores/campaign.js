import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { campaignCacheService } from '@/services/CampaignCacheService'
import { useSyncStore } from '@/stores/sync'

export const useCampaignStore = defineStore('campaign', () => {
  // State
  const campaigns = ref([])
  const currentCampaign = ref(null)
  const availableTeams = ref([])
  const loading = ref(false)
  const error = ref(null)

  // Getters
  const hasCampaigns = computed(() => campaigns.value.length > 0)
  const currentTeam = computed(() => currentCampaign.value?.team)
  const currentDate = computed(() => currentCampaign.value?.current_date)
  const currentSeason = computed(() => currentCampaign.value?.season)

  // Actions
  async function fetchCampaigns() {
    loading.value = true
    error.value = null
    try {
      const response = await api.get('/api/campaigns')
      campaigns.value = response.data.campaigns
      return campaigns.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch campaigns'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchCampaign(id, forceRefresh = false) {
    loading.value = true
    error.value = null
    try {
      // Set active campaign for sync
      const syncStore = useSyncStore()
      syncStore.setActiveCampaign(id)

      let campaignData = null

      // Force refresh bypasses cache entirely
      if (forceRefresh) {
        const response = await api.get(`/api/campaigns/${id}`)
        // Note: roster is included here for backwards compatibility, but
        // teamStore.roster should be used as the single source of truth.
        // Access roster and lineup data via teamStore.fetchTeam() instead.
        campaignData = {
          ...response.data.campaign,
          team: response.data.team,
          roster: response.data.roster, // @deprecated - use teamStore.roster
          coach: response.data.coach,
          season: response.data.season,
          standings: response.data.standings,
          upcoming_games: response.data.upcoming_games,
          news: response.data.news,
        }
        // Save fresh data to cache
        await campaignCacheService.saveCampaign(id, campaignData)
      } else {
        // Use cache-first strategy (service handles cache + API fallback)
        campaignData = await campaignCacheService.loadCampaign(id)
      }

      if (!campaignData) {
        throw new Error('Failed to load campaign')
      }

      currentCampaign.value = campaignData
      return currentCampaign.value
    } catch (err) {
      error.value = err.response?.data?.message || err.message || 'Failed to fetch campaign'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function createCampaign(data) {
    loading.value = true
    error.value = null
    try {
      const response = await api.post('/api/campaigns', data)
      const newCampaign = response.data.campaign
      campaigns.value.push(newCampaign)
      return newCampaign
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to create campaign'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function updateCampaign(id, data) {
    loading.value = true
    error.value = null
    try {
      const response = await api.put(`/api/campaigns/${id}`, data)
      const updated = response.data.campaign

      // Update in list
      const index = campaigns.value.findIndex(c => c.id === id)
      if (index !== -1) {
        campaigns.value[index] = updated
      }

      // Update current if same
      if (currentCampaign.value?.id === id) {
        currentCampaign.value = { ...currentCampaign.value, ...updated }
      }

      // Update cache
      await campaignCacheService.updateCampaign(id, updated)

      return updated
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to update campaign'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function deleteCampaign(id) {
    loading.value = true
    error.value = null
    try {
      await api.delete(`/api/campaigns/${id}`)
      campaigns.value = campaigns.value.filter(c => c.id !== id)

      if (currentCampaign.value?.id === id) {
        currentCampaign.value = null
      }
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to delete campaign'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchAvailableTeams() {
    try {
      const response = await api.get('/api/teams')
      availableTeams.value = response.data.teams
      return availableTeams.value
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to fetch teams'
      throw err
    }
  }

  function updateCurrentDate(date) {
    if (currentCampaign.value) {
      currentCampaign.value.current_date = date
    }
  }

  function clearCurrentCampaign() {
    currentCampaign.value = null
  }

  return {
    // State
    campaigns,
    currentCampaign,
    availableTeams,
    loading,
    error,
    // Getters
    hasCampaigns,
    currentTeam,
    currentDate,
    currentSeason,
    // Actions
    fetchCampaigns,
    fetchCampaign,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    fetchAvailableTeams,
    updateCurrentDate,
    clearCurrentCampaign,
  }
})
