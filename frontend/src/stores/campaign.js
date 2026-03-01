import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  createCampaign as engineCreateCampaign,
  loadCampaign as engineLoadCampaign,
  deleteCampaign as engineDeleteCampaign,
  listCampaigns,
} from '@/engine/campaign/CampaignManager'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { TEAMS } from '@/engine/data/teams'
import { useSyncStore } from '@/stores/sync'
import api from '@/composables/useApi'

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
      // Load campaigns from IndexedDB (local)
      const localCampaigns = await listCampaigns()

      // Also check server for cloud-synced campaigns not in IndexedDB
      const syncStore = useSyncStore()
      const serverCampaigns = await syncStore.fetchServerCampaigns()

      // Find campaigns that exist on server but not locally
      const localIds = new Set(localCampaigns.map(c => c.id))
      const cloudOnlyCampaigns = serverCampaigns.filter(sc => !localIds.has(sc.id))

      // Pull any cloud-only campaigns into IndexedDB
      for (const sc of cloudOnlyCampaigns) {
        try {
          await syncStore.pullChanges(sc.id)
          console.log(`[Campaign] Recovered cloud campaign: ${sc.name} (${sc.id})`)
        } catch (pullErr) {
          console.warn(`[Campaign] Failed to pull cloud campaign ${sc.id}:`, pullErr)
        }
      }

      // Re-read from IndexedDB if we pulled anything
      if (cloudOnlyCampaigns.length > 0) {
        campaigns.value = await listCampaigns()
      } else {
        campaigns.value = localCampaigns
      }

      return campaigns.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch campaigns'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchCampaign(id) {
    loading.value = true
    error.value = null
    try {
      // Set active campaign for sync
      const syncStore = useSyncStore()
      syncStore.setActiveCampaign(id)

      let result
      try {
        result = await engineLoadCampaign(id)
      } catch (loadErr) {
        // Campaign not found locally — try pulling from cloud
        console.log(`[Campaign] Not found locally, trying cloud recovery for ${id}`)
        try {
          await syncStore.pullChanges(id)
          result = await engineLoadCampaign(id)
        } catch (pullErr) {
          throw loadErr // Re-throw original error if pull also fails
        }
      }

      if (!result || !result.campaign) {
        throw new Error('Failed to load campaign')
      }

      const { campaign, teams, userTeam, seasonData, year } = result

      // Map engine result to the currentCampaign shape expected by Vue views
      const campaignData = {
        ...campaign,
        team: userTeam,
        roster: null, // @deprecated - use teamStore.roster
        coach: userTeam?.coach ?? null,
        season: seasonData,
        standings: seasonData?.standings ?? null,
        upcoming_games: seasonData?.schedule?.filter(g => !g.played) ?? [],
        news: seasonData?.news ?? [],
        current_date: campaign.currentDate,
        allTeams: teams,
      }

      currentCampaign.value = campaignData
      return currentCampaign.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch campaign'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function createCampaign(data) {
    loading.value = true
    error.value = null
    try {
      const result = await engineCreateCampaign(data)
      const newCampaign = result.campaign
      campaigns.value.push(newCampaign)

      // Mark for cloud sync
      const syncStore = useSyncStore()
      syncStore.setActiveCampaign(newCampaign.id)
      syncStore.markDirty()

      return newCampaign
    } catch (err) {
      error.value = err.message || 'Failed to create campaign'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function updateCampaign(id, data) {
    loading.value = true
    error.value = null
    try {
      // Fetch current campaign from IndexedDB, merge updates, and save back
      const existing = await CampaignRepository.get(id)
      if (!existing) {
        throw new Error(`Campaign ${id} not found`)
      }
      const updated = { ...existing, ...data }
      await CampaignRepository.save(updated)

      // Update in list
      const index = campaigns.value.findIndex(c => c.id === id)
      if (index !== -1) {
        campaigns.value[index] = updated
      }

      // Update current if same
      if (currentCampaign.value?.id === id) {
        currentCampaign.value = { ...currentCampaign.value, ...updated }
      }

      return updated
    } catch (err) {
      error.value = err.message || 'Failed to update campaign'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function deleteCampaign(id) {
    loading.value = true
    error.value = null
    try {
      await engineDeleteCampaign(id)
      campaigns.value = campaigns.value.filter(c => c.id !== id)

      if (currentCampaign.value?.id === id) {
        currentCampaign.value = null
      }

      // Best-effort S3 cleanup — deletion succeeds locally even if API fails
      try {
        await api.delete(`/api/sync/${id}`)
      } catch {
        console.warn(`[Campaign] S3 cleanup failed for ${id}, data will be orphaned`)
      }
    } catch (err) {
      error.value = err.message || 'Failed to delete campaign'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchAvailableTeams() {
    try {
      availableTeams.value = TEAMS
      return availableTeams.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch teams'
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
