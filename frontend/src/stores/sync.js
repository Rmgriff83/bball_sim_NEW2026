import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { useLocalCache } from '@/composables/useLocalCache'
import { useToastStore } from '@/stores/toast'

const SYNC_INTERVAL_MS = 60000 // 60 seconds

export const useSyncStore = defineStore('sync', () => {
  const cache = useLocalCache()

  // State
  const isSyncing = ref(false)
  const lastSyncAt = ref(null)
  const dirtyKeys = ref(new Set())
  const syncError = ref(null)
  const autoSyncIntervalId = ref(null)
  const activeCampaignId = ref(null)

  // Getters
  const hasPendingChanges = computed(() => dirtyKeys.value.size > 0)

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
   * Initialize sync state from IndexedDB
   */
  async function initFromCache() {
    const state = await cache.getSyncState()
    lastSyncAt.value = state.lastSyncAt
    dirtyKeys.value = new Set(state.dirtyKeys || [])
  }

  /**
   * Set the active campaign for syncing
   */
  function setActiveCampaign(campaignId) {
    activeCampaignId.value = campaignId
  }

  /**
   * Mark a cache key as dirty (needs sync)
   */
  async function markDirty(key) {
    dirtyKeys.value.add(key)
    await cache.markDirty(key)
  }

  /**
   * Clear a key from dirty set (synced successfully)
   */
  async function clearDirty(key) {
    dirtyKeys.value.delete(key)
    await cache.clearDirty(key)
  }

  /**
   * Start the auto-sync timer (60 second interval)
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
   * Stop the auto-sync timer
   */
  function stopAutoSync() {
    if (autoSyncIntervalId.value) {
      clearInterval(autoSyncIntervalId.value)
      autoSyncIntervalId.value = null
    }
  }

  /**
   * Trigger immediate sync (for "Save to Cloud" button)
   * Push-only: local IndexedDB is always the source of truth
   */
  async function syncNow() {
    if (!activeCampaignId.value) return
    if (isSyncing.value) return

    const toastStore = useToastStore()

    try {
      isSyncing.value = true
      syncError.value = null

      // Push local changes to cloud (push-only, no pull)
      await pushChanges(activeCampaignId.value)

      // Update sync timestamp
      lastSyncAt.value = new Date().toISOString()
      await cache.updateLastSyncAt()

      toastStore.showSuccess('Saved to cloud', 2000)
    } catch (err) {
      syncError.value = err.message || 'Sync failed'
      toastStore.showError('Sync failed - will retry', 3000)
    } finally {
      isSyncing.value = false
    }
  }

  /**
   * Push dirty data to the server
   */
  async function pushChanges(campaignId) {
    const dirtyList = [...dirtyKeys.value].filter(k => k.startsWith(`campaign_${campaignId}`))

    if (dirtyList.length === 0) return

    const payload = {}

    // Gather dirty data
    for (const key of dirtyList) {
      if (key.includes('_meta')) {
        const data = await cache.getCampaign(campaignId)
        if (data) payload.campaign = data
      } else if (key.includes('_season_')) {
        const match = key.match(/_season_(\d+)/)
        if (match) {
          const year = parseInt(match[1])
          const data = await cache.getSeason(campaignId, year)
          if (data) {
            payload.seasons = payload.seasons || {}
            payload.seasons[year] = data
          }
        }
      } else if (key.includes('_players')) {
        const data = await cache.getPlayers(campaignId)
        if (data) payload.players = data
      }
    }

    if (Object.keys(payload).length === 0) return

    // Add client timestamp for conflict resolution
    payload.clientUpdatedAt = new Date().toISOString()

    // Push to server
    const response = await api.post(`/api/campaigns/${campaignId}/sync/push`, payload)

    // Clear dirty keys on success
    for (const key of dirtyList) {
      await clearDirty(key)
    }

    return response.data
  }

  /**
   * Pull latest data from the server
   * Only updates local cache if local data doesn't exist (remote is fallback only)
   */
  async function pullChanges(campaignId) {
    const response = await api.get(`/api/campaigns/${campaignId}/sync/pull`)
    const { campaign, season, players, metadata } = response.data

    // Only use remote data if local doesn't exist (local is always preferred)
    if (campaign) {
      const localCampaign = await cache.getCampaign(campaignId)
      if (!localCampaign) {
        // No local data - use remote as initial seed
        await cache.setCampaign(campaignId, { ...campaign, metadata })
        console.log('[Sync] No local campaign data, using remote')
      } else {
        console.log('[Sync] Local campaign data exists, keeping local')
      }
    }

    if (season) {
      const year = season.year
      const localSeason = await cache.getSeason(campaignId, year)
      if (!localSeason) {
        // No local data - use remote as initial seed
        await cache.setSeason(campaignId, year, { ...season, metadata })
        console.log('[Sync] No local season data, using remote')
      } else {
        console.log('[Sync] Local season data exists, keeping local')
      }
    }

    if (players) {
      const localPlayers = await cache.getPlayers(campaignId)
      if (!localPlayers) {
        // No local data - use remote as initial seed
        await cache.setPlayers(campaignId, { players, metadata })
        console.log('[Sync] No local players data, using remote')
      } else {
        console.log('[Sync] Local players data exists, keeping local')
      }
    }

    return response.data
  }

  /**
   * Resolve conflict between local and remote data
   * Strategy: Local always wins if it exists (local is the working copy)
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
   * Check sync status without full sync
   */
  async function checkSyncStatus(campaignId) {
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/sync/status`)
      return response.data
    } catch {
      return { needsSync: false }
    }
  }

  /**
   * Queue a background sync check
   * Now push-only: just pushes local changes if dirty, never pulls
   */
  async function queueSyncCheck(campaignId) {
    // Only push if we have dirty local changes
    const dirtyList = [...dirtyKeys.value].filter(k => k.startsWith(`campaign_${campaignId}`))

    if (dirtyList.length > 0) {
      try {
        await pushChanges(campaignId)
        lastSyncAt.value = new Date().toISOString()
        await cache.updateLastSyncAt()
      } catch {
        // Ignore errors for background sync
      }
    }
  }

  return {
    // State
    isSyncing,
    lastSyncAt,
    dirtyKeys,
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
    checkSyncStatus,
    queueSyncCheck,
  }
})
