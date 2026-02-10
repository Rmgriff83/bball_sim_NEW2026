import { useLocalCache } from '@/composables/useLocalCache'
import { useSyncStore } from '@/stores/sync'
import api from '@/composables/useApi'

/**
 * Service that coordinates between Pinia stores, local cache, and API.
 *
 * Data sources:
 * - MySQL database: user team/player data (always fetched fresh via API)
 * - S3/JSON files: AI teams, season schedules, standings (cached in IndexedDB)
 *
 * Sync strategy on load:
 * 1. No local cache → use remote
 * 2. Local older than remote → use remote
 * 3. Local newer than remote → use local, push to remote
 */
class CampaignCacheService {
  constructor() {
    this.cache = useLocalCache()
  }

  /**
   * Get the sync store (lazy to avoid circular deps)
   */
  getSyncStore() {
    return useSyncStore()
  }

  // ==================== Campaign Data ====================

  /**
   * Try to get campaign from cache only (no API fallback)
   * @returns {Promise<Object|null>} Cached campaign data or null
   */
  async getCachedCampaign(campaignId) {
    try {
      return await this.cache.getCampaign(campaignId)
    } catch (err) {
      console.warn('[CampaignCache] Failed to read from cache:', err)
    }
    return null
  }

  /**
   * Load campaign data with smart sync strategy:
   * - Compares local IndexedDB with remote S3/JSON timestamps
   * - Uses newer source, pushes local to remote if local is newer
   * @returns {Promise<Object|null>} Campaign data or null if not found
   */
  async loadCampaign(campaignId) {
    // Fetch both local cache and remote data in parallel
    const [localData, remoteResponse] = await Promise.all([
      this.getCachedCampaign(campaignId),
      api.get(`/api/campaigns/${campaignId}`).catch(() => null)
    ])

    if (!remoteResponse) {
      // API failed - use local if available
      if (localData) {
        console.log('[CampaignCache] API unavailable, using local cache')
        return localData
      }
      return null
    }

    // Build remote data object
    const remoteData = {
      ...remoteResponse.data.campaign,
      team: remoteResponse.data.team,
      roster: remoteResponse.data.roster,
      coach: remoteResponse.data.coach,
      season: remoteResponse.data.season,
      standings: remoteResponse.data.standings,
      upcoming_games: remoteResponse.data.upcoming_games,
      news: remoteResponse.data.news,
      metadata: {
        updatedAt: remoteResponse.data.metadata?.updatedAt || remoteResponse.data.campaign?.updated_at || null
      }
    }

    // Case 1: No local data → use remote
    if (!localData) {
      console.log('[CampaignCache] No local cache, using remote')
      await this.saveToLocalCache(campaignId, remoteData)
      return remoteData
    }

    // Compare timestamps
    const localTime = this.getTimestamp(localData)
    const remoteTime = this.getTimestamp(remoteData)

    console.log('[CampaignCache] Comparing timestamps:', {
      local: localTime ? new Date(localTime).toISOString() : 'none',
      remote: remoteTime ? new Date(remoteTime).toISOString() : 'none'
    })

    // Case 2: Local is older than remote → use remote
    if (remoteTime && (!localTime || remoteTime > localTime)) {
      console.log('[CampaignCache] Remote is newer, using remote')
      await this.saveToLocalCache(campaignId, remoteData)
      return remoteData
    }

    // Case 3: Local is newer than remote → use local, push to remote
    if (localTime && (!remoteTime || localTime > remoteTime)) {
      console.log('[CampaignCache] Local is newer, using local and pushing to remote')
      // Push local data to remote in background
      this.pushLocalToRemote(campaignId, localData).catch(err => {
        console.warn('[CampaignCache] Failed to push local to remote:', err)
      })
      return localData
    }

    // Timestamps equal or couldn't compare - prefer local (it's the working copy)
    console.log('[CampaignCache] Timestamps equal, using local')
    return localData
  }

  /**
   * Get timestamp from data object (checks multiple possible locations)
   */
  getTimestamp(data) {
    if (!data) return null

    // Check metadata.updatedAt first
    if (data.metadata?.updatedAt) {
      return new Date(data.metadata.updatedAt).getTime()
    }

    // Check _cachedAt (set by IndexedDB cache)
    if (data._cachedAt) {
      return new Date(data._cachedAt).getTime()
    }

    // Check updated_at from database
    if (data.updated_at) {
      return new Date(data.updated_at).getTime()
    }

    return null
  }

  /**
   * Save data to local IndexedDB cache
   */
  async saveToLocalCache(campaignId, data) {
    try {
      const cacheData = {
        ...data,
        metadata: {
          ...data.metadata,
          updatedAt: data.metadata?.updatedAt || new Date().toISOString()
        }
      }
      await this.cache.setCampaign(campaignId, cacheData)
      console.log('[CampaignCache] Saved to local cache:', campaignId)
    } catch (err) {
      console.warn('[CampaignCache] Failed to save to cache:', err)
    }
  }

  /**
   * Push local data to remote (S3/JSON files via API)
   */
  async pushLocalToRemote(campaignId, data) {
    const syncStore = this.getSyncStore()

    // Mark as dirty and trigger push
    await syncStore.markDirty(`campaign_${campaignId}_meta`)
    await syncStore.pushChanges(campaignId)

    console.log('[CampaignCache] Pushed local data to remote:', campaignId)
  }

  /**
   * Save campaign data to cache and mark as dirty
   */
  async saveCampaign(campaignId, data) {
    try {
      const campaignData = {
        ...data,
        metadata: {
          updatedAt: new Date().toISOString()
        }
      }

      await this.cache.setCampaign(campaignId, campaignData)
      await this.getSyncStore().markDirty(`campaign_${campaignId}_meta`)
      console.log('[CampaignCache] Saved and marked dirty:', campaignId)
    } catch (err) {
      console.warn('[CampaignCache] Failed to save campaign:', err)
    }
  }

  /**
   * Update specific fields in campaign cache
   */
  async updateCampaign(campaignId, updates) {
    try {
      const existing = await this.cache.getCampaign(campaignId)
      if (existing) {
        const updated = {
          ...existing,
          ...updates,
          metadata: {
            updatedAt: new Date().toISOString()
          }
        }
        await this.cache.setCampaign(campaignId, updated)
        await this.getSyncStore().markDirty(`campaign_${campaignId}_meta`)
      } else {
        // No existing cache, create new entry with just the updates
        const newData = {
          ...updates,
          metadata: {
            updatedAt: new Date().toISOString()
          }
        }
        await this.cache.setCampaign(campaignId, newData)
        await this.getSyncStore().markDirty(`campaign_${campaignId}_meta`)
        console.log('[CampaignCache] Created new cache entry for:', campaignId)
      }
    } catch (err) {
      console.warn('[CampaignCache] Failed to update campaign:', err)
    }
  }

  // ==================== Season Data ====================

  /**
   * Load season data with cache-first strategy
   */
  async loadSeason(campaignId, year) {
    const cached = await this.cache.getSeason(campaignId, year)

    if (cached) {
      return cached
    }

    // Fallback to API
    try {
      const response = await api.get(`/api/campaigns/${campaignId}/season`)
      const seasonData = {
        ...response.data,
        year,
        metadata: {
          updatedAt: new Date().toISOString()
        }
      }

      await this.cache.setSeason(campaignId, year, seasonData)
      return seasonData
    } catch {
      return null
    }
  }

  /**
   * Save season data to cache and mark as dirty
   */
  async saveSeason(campaignId, year, data) {
    const seasonData = {
      ...data,
      year,
      metadata: {
        updatedAt: new Date().toISOString()
      }
    }

    await this.cache.setSeason(campaignId, year, seasonData)
    await this.getSyncStore().markDirty(`campaign_${campaignId}_season_${year}`)
  }

  /**
   * Update standings in season cache
   */
  async updateStandings(campaignId, year, standings) {
    const existing = await this.cache.getSeason(campaignId, year)
    if (existing) {
      existing.standings = standings
      existing.metadata = { updatedAt: new Date().toISOString() }
      await this.cache.setSeason(campaignId, year, existing)
      await this.getSyncStore().markDirty(`campaign_${campaignId}_season_${year}`)
    }
  }

  /**
   * Update player stats in season cache
   */
  async updatePlayerStats(campaignId, year, playerStats) {
    const existing = await this.cache.getSeason(campaignId, year)
    if (existing) {
      existing.playerStats = playerStats
      existing.metadata = { updatedAt: new Date().toISOString() }
      await this.cache.setSeason(campaignId, year, existing)
      await this.getSyncStore().markDirty(`campaign_${campaignId}_season_${year}`)
    }
  }

  // ==================== Team/Roster Data ====================

  /**
   * Update roster in campaign cache
   */
  async updateRoster(campaignId, roster) {
    await this.updateCampaign(campaignId, { roster })
  }

  /**
   * Update team data in campaign cache
   */
  async updateTeam(campaignId, team) {
    await this.updateCampaign(campaignId, { team })
  }

  // ==================== Game Results ====================

  /**
   * Update game result in season cache
   */
  async updateGameResult(campaignId, year, gameId, result) {
    const existing = await this.cache.getSeason(campaignId, year)
    if (existing) {
      // Update schedule
      if (existing.schedule) {
        const gameIndex = existing.schedule.findIndex(g => g.id === gameId)
        if (gameIndex !== -1) {
          existing.schedule[gameIndex] = {
            ...existing.schedule[gameIndex],
            is_complete: true,
            home_score: result.home_score,
            away_score: result.away_score,
          }
        }
      }

      existing.metadata = { updatedAt: new Date().toISOString() }
      await this.cache.setSeason(campaignId, year, existing)
      await this.getSyncStore().markDirty(`campaign_${campaignId}_season_${year}`)
    }
  }

  // ==================== Sync Operations ====================

  /**
   * Force refresh from server (invalidate cache)
   */
  async forceRefresh(campaignId) {
    await this.cache.clearCampaign(campaignId)
    return this.loadCampaign(campaignId)
  }

  /**
   * Clear all cached data
   */
  async clearAllCache() {
    await this.cache.clearAll()
  }

  /**
   * Get cache status for a campaign
   */
  async getCacheStatus(campaignId) {
    const keys = await this.cache.getCampaignKeys(campaignId)
    const state = await this.cache.getSyncState()

    return {
      cachedKeys: keys,
      dirtyKeys: state.dirtyKeys.filter(k => k.startsWith(`campaign_${campaignId}`)),
      lastSyncAt: state.lastSyncAt,
    }
  }
}

// Export singleton instance
export const campaignCacheService = new CampaignCacheService()

// Export class for testing
export { CampaignCacheService }
