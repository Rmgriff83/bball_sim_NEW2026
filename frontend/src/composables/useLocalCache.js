import { get, set, del, keys, clear } from 'idb-keyval'

/**
 * IndexedDB-based local cache for campaign data.
 *
 * Key patterns:
 * - campaign_{id}_meta      - Campaign info, team, roster
 * - campaign_{id}_season_{year} - Season data (schedule, standings, stats)
 * - campaign_{id}_players   - League players JSON
 * - sync_state              - Sync metadata (lastSyncAt, dirtyKeys)
 */
export function useLocalCache() {
  // Campaign metadata (main campaign data + team + roster)
  async function getCampaign(id) {
    return get(`campaign_${id}_meta`)
  }

  async function setCampaign(id, data) {
    return set(`campaign_${id}_meta`, {
      ...data,
      _cachedAt: new Date().toISOString()
    })
  }

  // Season data (schedule, standings, player stats for a specific year)
  async function getSeason(campaignId, year) {
    return get(`campaign_${campaignId}_season_${year}`)
  }

  async function setSeason(campaignId, year, data) {
    return set(`campaign_${campaignId}_season_${year}`, {
      ...data,
      _cachedAt: new Date().toISOString()
    })
  }

  // League players (all non-user team players)
  async function getPlayers(campaignId) {
    return get(`campaign_${campaignId}_players`)
  }

  async function setPlayers(campaignId, data) {
    return set(`campaign_${campaignId}_players`, {
      players: data.players || data,
      metadata: {
        updatedAt: data.metadata?.updatedAt || new Date().toISOString()
      },
      _cachedAt: new Date().toISOString()
    })
  }

  // Sync state tracking
  async function getSyncState() {
    const state = await get('sync_state')
    return state || { lastSyncAt: null, dirtyKeys: [] }
  }

  async function setSyncState(state) {
    return set('sync_state', state)
  }

  // Add a key to the dirty list (needs sync)
  async function markDirty(key) {
    const state = await getSyncState()
    if (!state.dirtyKeys.includes(key)) {
      state.dirtyKeys.push(key)
      await setSyncState(state)
    }
  }

  // Remove a key from the dirty list (synced)
  async function clearDirty(key) {
    const state = await getSyncState()
    state.dirtyKeys = state.dirtyKeys.filter(k => k !== key)
    await setSyncState(state)
  }

  // Clear all dirty keys for a campaign
  async function clearCampaignDirty(campaignId) {
    const state = await getSyncState()
    state.dirtyKeys = state.dirtyKeys.filter(k => !k.startsWith(`campaign_${campaignId}`))
    await setSyncState(state)
  }

  // Check if a key is dirty
  async function isDirty(key) {
    const state = await getSyncState()
    return state.dirtyKeys.includes(key)
  }

  // Update last sync time
  async function updateLastSyncAt() {
    const state = await getSyncState()
    state.lastSyncAt = new Date().toISOString()
    await setSyncState(state)
  }

  // Generic key operations
  async function remove(key) {
    return del(key)
  }

  async function clearAll() {
    return clear()
  }

  async function getAllKeys() {
    return keys()
  }

  // Get all keys for a specific campaign
  async function getCampaignKeys(campaignId) {
    const allKeys = await keys()
    return allKeys.filter(k => k.startsWith(`campaign_${campaignId}`))
  }

  // Clear all data for a specific campaign
  async function clearCampaign(campaignId) {
    const campaignKeys = await getCampaignKeys(campaignId)
    for (const key of campaignKeys) {
      await del(key)
    }
  }

  return {
    // Campaign data
    getCampaign,
    setCampaign,
    // Season data
    getSeason,
    setSeason,
    // Players data
    getPlayers,
    setPlayers,
    // Sync state
    getSyncState,
    setSyncState,
    markDirty,
    clearDirty,
    clearCampaignDirty,
    isDirty,
    updateLastSyncAt,
    // Generic operations
    remove,
    clearAll,
    getAllKeys,
    getCampaignKeys,
    clearCampaign,
  }
}
