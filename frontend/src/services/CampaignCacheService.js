import { useLocalCache } from '@/composables/useLocalCache'
import { useSyncStore } from '@/stores/sync'
import api from '@/composables/useApi'

/**
 * Service that coordinates between Pinia stores, local cache, and API.
 * Implements cache-first loading with background sync.
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
      const cached = await this.cache.getCampaign(campaignId)
      if (cached) {
        // Queue background sync check
        this.getSyncStore().queueSyncCheck(campaignId)
        return cached
      }
    } catch (err) {
      console.warn('[CampaignCache] Failed to read from cache:', err)
    }
    return null
  }

  /**
   * Load campaign data with cache-first strategy
   * @returns {Promise<Object|null>} Campaign data or null if not found
   */
  async loadCampaign(campaignId) {
    // Try cache first
    const cached = await this.getCachedCampaign(campaignId)
    if (cached) {
      return cached
    }

    // Fallback to API
    try {
      const response = await api.get(`/api/campaigns/${campaignId}`)
      const campaignData = {
        ...response.data.campaign,
        team: response.data.team,
        roster: response.data.roster,
        coach: response.data.coach,
        season: response.data.season,
        standings: response.data.standings,
        upcoming_games: response.data.upcoming_games,
        news: response.data.news,
        metadata: {
          updatedAt: new Date().toISOString()
        }
      }

      // Save to cache (don't let cache failure break the flow)
      try {
        await this.cache.setCampaign(campaignId, campaignData)
        console.log('[CampaignCache] Saved campaign to cache:', campaignId)
      } catch (cacheErr) {
        console.warn('[CampaignCache] Failed to save to cache:', cacheErr)
      }

      return campaignData
    } catch {
      return null
    }
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
