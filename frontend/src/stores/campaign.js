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
      const localCampaigns = await listCampaigns()
      const syncStore = useSyncStore()
      const serverCampaigns = await syncStore.fetchServerCampaigns()

      // If the server is unreachable, don't reconcile — just show local data.
      // (fetchServerCampaigns returns null on failure, [] on a successful
      // empty list, so we can distinguish offline from "no campaigns".)
      if (serverCampaigns === null) {
        campaigns.value = localCampaigns
        return campaigns.value
      }

      const localIds = new Set(localCampaigns.map(c => c.id))
      const serverIds = new Set(serverCampaigns.map(c => c.id))

      // Reconcile deletions: a campaign in the local cache but missing from the
      // server's authoritative list was deleted on another device. Remove it
      // locally — but skip campaigns that haven't been synced yet AND were
      // created very recently, to avoid wiping a brand-new campaign whose
      // initial push hasn't completed.
      const RECENT_CREATE_GRACE_MS = 60_000
      const now = Date.now()
      for (const local of localCampaigns) {
        if (serverIds.has(local.id)) continue
        const createdMs = local.createdAt ? new Date(local.createdAt).getTime() : 0
        const isRecent = createdMs && (now - createdMs) < RECENT_CREATE_GRACE_MS
        const wasSynced = !!local.lastSyncedAt
        if (isRecent && !wasSynced) continue

        try {
          await engineDeleteCampaign(local.id)
          console.log(`[Campaign] Removed local campaign deleted on another device: ${local.name} (${local.id})`)
        } catch (err) {
          console.warn(`[Campaign] Failed to remove deleted campaign ${local.id}:`, err)
        }
      }

      // Pull any cloud-only campaigns into IndexedDB
      const cloudOnlyCampaigns = serverCampaigns.filter(sc => !localIds.has(sc.id))
      for (const sc of cloudOnlyCampaigns) {
        try {
          await syncStore.pullChanges(sc.id)
          console.log(`[Campaign] Recovered cloud campaign: ${sc.name} (${sc.id})`)
        } catch (pullErr) {
          console.warn(`[Campaign] Failed to pull cloud campaign ${sc.id}:`, pullErr)
        }
      }

      // Stamp `lastSyncedAt` on every campaign confirmed to exist on the server.
      // This lets future fetchCampaigns reliably reconcile deletions even for
      // campaigns that pre-date this code path. We use markSyncedWithServer
      // (not save) so we don't bump `updatedAt` — bumping it would make local
      // appear newer than the cloud, and pullChanges would then refuse to apply
      // remote campaign updates (e.g. scouting progress from another device).
      const refreshed = await listCampaigns()
      for (const local of refreshed) {
        if (serverIds.has(local.id) && !local.lastSyncedAt) {
          await CampaignRepository.markSyncedWithServer(local.id)
        }
      }

      campaigns.value = await listCampaigns()
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

      // Always check cloud for newer data before using local
      try {
        const pullResult = await syncStore.pullChanges(id)
        if (pullResult.usedRemote) {
          console.log('[Campaign] Remote data was newer, reloading from IndexedDB')
        }
      } catch (pullErr) {
        console.warn('[Campaign] Cloud pull failed, will use local data:', pullErr.message)
      }

      try {
        result = await engineLoadCampaign(id)
      } catch (loadErr) {
        throw loadErr
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
