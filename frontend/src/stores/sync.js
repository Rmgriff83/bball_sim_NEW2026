import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { useToastStore } from '@/stores/toast'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'

const SYNC_INTERVAL_MS = 60000 // 60 seconds

export const useSyncStore = defineStore('sync', () => {
  // State
  const isSyncing = ref(false)
  const lastSyncAt = ref(null)
  const isDirty = ref(false)
  const syncError = ref(null)
  const autoSyncIntervalId = ref(null)
  const activeCampaignId = ref(null)

  // Getters
  const hasPendingChanges = computed(() => isDirty.value)

  const lastSyncText = computed(() => {
    if (!lastSyncAt.value) return 'Never synced'
    const date = new Date(lastSyncAt.value)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`

    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`

    return date.toLocaleDateString()
  })

  // Actions

  /**
   * Initialize sync state.
   * Simplified: just check if we have local data that might need syncing.
   */
  async function initFromCache() {
    // No granular dirty tracking to restore; isDirty starts false
    // and gets set whenever a write happens via markDirty()
  }

  /**
   * Set the active campaign for syncing.
   */
  function setActiveCampaign(campaignId) {
    activeCampaignId.value = campaignId
  }

  /**
   * Mark data as dirty (needs sync).
   * Simplified: just sets a boolean flag.
   */
  async function markDirty(_key) {
    isDirty.value = true
  }

  /**
   * Clear dirty flag after successful sync.
   */
  async function clearDirty(_key) {
    isDirty.value = false
  }

  /**
   * Start the auto-sync timer (60 second interval).
   */
  function startAutoSync() {
    if (autoSyncIntervalId.value) return

    autoSyncIntervalId.value = setInterval(async () => {
      if (activeCampaignId.value && hasPendingChanges.value) {
        await syncNow()
      }
    }, SYNC_INTERVAL_MS)
  }

  /**
   * Stop the auto-sync timer.
   */
  function stopAutoSync() {
    if (autoSyncIntervalId.value) {
      clearInterval(autoSyncIntervalId.value)
      autoSyncIntervalId.value = null
    }
  }

  /**
   * Serialize full campaign state from IndexedDB into a single payload.
   */
  async function _serializeCampaignSnapshot(campaignId) {
    const campaign = await CampaignRepository.get(campaignId)
    const teams = await TeamRepository.getAllForCampaign(campaignId)
    const players = await PlayerRepository.getAllForCampaign(campaignId)
    const seasons = await SeasonRepository.getAllForCampaign(campaignId)

    return {
      campaign,
      teams,
      players,
      seasons,
      clientUpdatedAt: new Date().toISOString(),
    }
  }

  /**
   * Trigger immediate sync (for "Save to Cloud" button).
   * Serializes the full campaign snapshot and pushes to server.
   */
  async function syncNow() {
    if (!activeCampaignId.value) return
    if (isSyncing.value) return

    const toastStore = useToastStore()

    try {
      isSyncing.value = true
      syncError.value = null

      // Push full snapshot to cloud
      await pushChanges(activeCampaignId.value)

      // Update sync timestamp
      lastSyncAt.value = new Date().toISOString()
      isDirty.value = false

      toastStore.showSuccess('Saved to cloud', 2000)
    } catch (err) {
      syncError.value = err.message || 'Sync failed'
      toastStore.showError('Sync failed - will retry', 3000)
    } finally {
      isSyncing.value = false
    }
  }

  /**
   * Push full campaign snapshot to the server.
   */
  async function pushChanges(campaignId) {
    const snapshot = await _serializeCampaignSnapshot(campaignId)

    // Only make API call if we have data to push
    if (!snapshot.campaign) return

    const response = await api.post(`/api/sync/${campaignId}/push`, snapshot)
    return response.data
  }

  /**
   * Pull latest data from the server and hydrate IndexedDB.
   * Only used for initial load or recovery -- local is always preferred if it exists.
   */
  async function pullChanges(campaignId) {
    const response = await api.get(`/api/sync/${campaignId}/pull`)
    const data = response.data

    // Hydrate IndexedDB from remote snapshot
    if (data.campaign) {
      const localCampaign = await CampaignRepository.get(campaignId)
      if (!localCampaign) {
        await CampaignRepository.save(data.campaign)
        console.log('[Sync] No local campaign data, using remote')
      } else {
        console.log('[Sync] Local campaign data exists, keeping local')
      }
    }

    if (data.teams && Array.isArray(data.teams) && data.teams.length > 0) {
      const localTeams = await TeamRepository.getAllForCampaign(campaignId)
      if (!localTeams || localTeams.length === 0) {
        await TeamRepository.saveBulk(data.teams)
        console.log('[Sync] No local teams data, using remote')
      } else {
        console.log('[Sync] Local teams data exists, keeping local')
      }
    }

    if (data.players && Array.isArray(data.players) && data.players.length > 0) {
      const localPlayers = await PlayerRepository.getAllForCampaign(campaignId)
      if (!localPlayers || localPlayers.length === 0) {
        await PlayerRepository.saveBulk(data.players)
        console.log('[Sync] No local players data, using remote')
      } else {
        console.log('[Sync] Local players data exists, keeping local')
      }
    }

    if (data.seasons && Array.isArray(data.seasons)) {
      for (const season of data.seasons) {
        const year = season.metadata?.year ?? season.year
        if (!year) continue
        const localSeason = await SeasonRepository.get(campaignId, year)
        if (!localSeason) {
          await SeasonRepository.save(season)
          console.log(`[Sync] No local season ${year} data, using remote`)
        } else {
          console.log(`[Sync] Local season ${year} data exists, keeping local`)
        }
      }
    }

    return data
  }

  /**
   * Resolve conflict between local and remote data.
   * Strategy: Local always wins if it exists (local is the working copy).
   */
  function resolveConflict(localData, remoteData) {
    // If local data exists, it always wins (it's the active working copy)
    if (localData) {
      return { winner: 'local', data: localData }
    }
    // Only use remote if no local data exists
    return { winner: 'remote', data: remoteData }
  }

  /**
   * Fetch list of campaigns that exist on the server (for recovery).
   */
  async function fetchServerCampaigns() {
    try {
      const response = await api.get('/api/sync/campaigns')
      return response.data?.campaigns ?? []
    } catch {
      return []
    }
  }

  /**
   * Queue a background sync check.
   * Push-only: just pushes local changes if dirty, never pulls.
   */
  async function queueSyncCheck(campaignId) {
    if (isDirty.value) {
      try {
        await pushChanges(campaignId)
        lastSyncAt.value = new Date().toISOString()
        isDirty.value = false
      } catch {
        // Ignore errors for background sync
      }
    }
  }

  return {
    // State
    isSyncing,
    lastSyncAt,
    isDirty,
    syncError,
    activeCampaignId,
    // Getters
    hasPendingChanges,
    lastSyncText,
    // Actions
    initFromCache,
    setActiveCampaign,
    markDirty,
    clearDirty,
    startAutoSync,
    stopAutoSync,
    syncNow,
    pushChanges,
    pullChanges,
    resolveConflict,
    fetchServerCampaigns,
    queueSyncCheck,
  }
})
