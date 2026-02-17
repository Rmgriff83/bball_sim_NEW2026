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
   * Strips duplicate keys and heavy data to keep the snapshot under server limits.
   * Local IndexedDB retains full-fidelity data.
   */
  async function _serializeCampaignSnapshot(campaignId) {
    const campaign = await CampaignRepository.get(campaignId)
    const teams = await TeamRepository.getAllForCampaign(campaignId)
    const players = await PlayerRepository.getAllForCampaign(campaignId)
    const seasons = await SeasonRepository.getAllForCampaign(campaignId)

    return {
      campaign,
      teams: teams.map(_stripTeamForSync),
      players: players.map(_stripPlayerForSync),
      seasons: seasons.map(_stripSeasonForSync),
      clientUpdatedAt: new Date().toISOString(),
    }
  }

  // -------------------------------------------------------------------------
  // Snapshot size reduction helpers
  // -------------------------------------------------------------------------
  // Players have dual camelCase/snake_case keys (both serialized by JSON.stringify
  // even though they reference the same data in memory). Arrays like
  // development_history (up to 200 entries × 530 players × 2 copies) can push
  // the snapshot well over 20 MB. These helpers strip duplicates and trim heavy
  // arrays so the sync payload stays lean while IndexedDB keeps full fidelity.

  /** Keys to drop from player objects for sync (camelCase duplicates of snake_case). */
  const PLAYER_DROP_KEYS = [
    // Duplicate identity fields (keep snake_case)
    'firstName', 'lastName', 'secondaryPosition', 'jerseyNumber',
    'heightInches', 'weightLbs',
    // Duplicate rating fields
    'overallRating', 'potentialRating',
    // Duplicate contract fields
    'contractYearsRemaining', 'contractSalary', 'contractDetails',
    // Duplicate status fields
    'isInjured', 'injuryDetails',
    // Duplicate evolution fields (arrays — biggest savings)
    'developmentHistory', 'recentPerformances',
    'streakData', 'upgradePoints',
    'gamesPlayedThisSeason', 'minutesPlayedThisSeason', 'careerSeasons',
    // Duplicate award fields
    'allStarSelections', 'mvpAwards', 'finalsMvpAwards',
    // Duplicate misc
    'birthDate', 'wingspanInches', 'tradeValueTotal',
  ]

  function _stripPlayerForSync(player) {
    const slim = { ...player }

    // Remove camelCase duplicates
    for (const key of PLAYER_DROP_KEYS) {
      delete slim[key]
    }

    // Trim development_history to last 20 entries (from up to 200)
    if (Array.isArray(slim.development_history) && slim.development_history.length > 20) {
      slim.development_history = slim.development_history.slice(-20)
    }

    // Trim recent_performances to last 5 (from up to 10)
    if (Array.isArray(slim.recent_performances) && slim.recent_performances.length > 5) {
      slim.recent_performances = slim.recent_performances.slice(-5)
    }

    return slim
  }

  function _stripTeamForSync(team) {
    const slim = { ...team }
    // Remove draft picks detail (can be regenerated)
    delete slim.draftPicks
    return slim
  }

  function _stripSeasonForSync(season) {
    const slim = { ...season }

    // Compact schedule: strip box scores, evolution, and saved game state
    if (Array.isArray(slim.schedule)) {
      slim.schedule = slim.schedule.map(game => {
        const g = { ...game }
        // Remove heavy fields from completed games
        delete g.savedGameState
        delete g.evolution

        // Compact box scores for all games (keep only essential stats)
        if (g.boxScore && g.isComplete) {
          g.boxScore = _compactBoxScore(g.boxScore)
        }

        return g
      })
    }

    return slim
  }

  function _compactBoxScore(boxScore) {
    const compact = {}
    for (const side of ['home', 'away']) {
      compact[side] = (boxScore[side] ?? []).map(p => ({
        player_id: p.player_id ?? p.playerId ?? null,
        name: p.name ?? 'Unknown',
        points: p.points ?? 0,
        rebounds: p.rebounds ?? 0,
        assists: p.assists ?? 0,
        minutes: p.minutes ?? 0,
      }))
    }
    return compact
  }

  /**
   * Rebuild camelCase keys from snake_case when restoring from a stripped snapshot.
   * Ensures restored players have the same shape as locally-created ones.
   */
  function _hydratePlayerKeys(player) {
    const p = { ...player }

    // Identity
    if (p.first_name && !p.firstName) p.firstName = p.first_name
    if (p.last_name && !p.lastName) p.lastName = p.last_name
    if (p.secondary_position !== undefined && !p.secondaryPosition) p.secondaryPosition = p.secondary_position
    if (p.jersey_number !== undefined && !p.jerseyNumber) p.jerseyNumber = p.jersey_number
    if (p.height_inches !== undefined && !p.heightInches) p.heightInches = p.height_inches
    if (p.weight_lbs !== undefined && !p.weightLbs) p.weightLbs = p.weight_lbs
    if (p.birth_date && !p.birthDate) p.birthDate = p.birth_date

    // Ratings
    if (p.overall_rating !== undefined && !p.overallRating) p.overallRating = p.overall_rating
    if (p.potential_rating !== undefined && !p.potentialRating) p.potentialRating = p.potential_rating

    // Contract
    if (p.contract_years_remaining !== undefined && p.contractYearsRemaining === undefined) p.contractYearsRemaining = p.contract_years_remaining
    if (p.contract_salary !== undefined && p.contractSalary === undefined) p.contractSalary = p.contract_salary
    if (p.contract_details && !p.contractDetails) p.contractDetails = p.contract_details

    // Status
    if (p.is_injured !== undefined && p.isInjured === undefined) p.isInjured = p.is_injured
    if (p.injury_details !== undefined && !p.injuryDetails) p.injuryDetails = p.injury_details

    // Evolution
    if (p.development_history && !p.developmentHistory) p.developmentHistory = p.development_history
    if (p.recent_performances && !p.recentPerformances) p.recentPerformances = p.recent_performances
    if (p.streak_data !== undefined && p.streakData === undefined) p.streakData = p.streak_data
    if (p.upgrade_points !== undefined && p.upgradePoints === undefined) p.upgradePoints = p.upgrade_points
    if (p.games_played_this_season !== undefined && p.gamesPlayedThisSeason === undefined) p.gamesPlayedThisSeason = p.games_played_this_season
    if (p.minutes_played_this_season !== undefined && p.minutesPlayedThisSeason === undefined) p.minutesPlayedThisSeason = p.minutes_played_this_season
    if (p.career_seasons !== undefined && p.careerSeasons === undefined) p.careerSeasons = p.career_seasons

    // Awards
    if (p.all_star_selections !== undefined && p.allStarSelections === undefined) p.allStarSelections = p.all_star_selections
    if (p.mvp_awards !== undefined && p.mvpAwards === undefined) p.mvpAwards = p.mvp_awards
    if (p.finals_mvp_awards !== undefined && p.finalsMvpAwards === undefined) p.finalsMvpAwards = p.finals_mvp_awards

    return p
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
        // Rebuild camelCase keys stripped during sync
        const hydrated = data.players.map(_hydratePlayerKeys)
        await PlayerRepository.saveBulk(hydrated)
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
