import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  createCampaign as engineCreateCampaign,
  loadCampaign as engineLoadCampaign,
  deleteCampaign as engineDeleteCampaign,
  listCampaigns,
} from '@/engine/campaign/CampaignManager'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { backfillBirthDates, catchUpPlayerAging } from '@/engine/migrations/backfillBirthDates'
import { backfillOrigins } from '@/engine/migrations/backfillOrigins'
import { TEAMS } from '@/engine/data/teams'
import { useSyncStore } from '@/stores/sync'
import { usePlayoffStore } from '@/stores/playoff'
import { useTeamStore } from '@/stores/team'
import { useGameStore } from '@/stores/game'
import { useFinanceStore } from '@/stores/finance'
import { useLeagueStore } from '@/stores/league'
import { useBreakingNewsStore } from '@/stores/breakingNews'
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

  /**
   * Clear every per-campaign Pinia store so stale state from a previous
   * campaign can't leak into a freshly-loaded one. Called whenever the
   * loaded campaign id is about to change (including switching from one
   * existing campaign to another, or loading a brand-new campaign).
   * Without this, e.g. `playoffStore.bracket` from a campaign that was in
   * the playoffs persists across navigations and the new campaign shows
   * playoff buttons / brackets until a hard refresh.
   */
  function _resetCampaignScopedStores() {
    try { usePlayoffStore().$reset() } catch (_) { /* noop */ }
    try { useTeamStore().clearTeam() } catch (_) { /* noop */ }
    try { useGameStore().invalidate() } catch (_) { /* noop */ }
    try { useGameStore().clearCurrentGame() } catch (_) { /* noop */ }
    try { useFinanceStore().clearFinanceState() } catch (_) { /* noop */ }
    try { useLeagueStore().invalidate() } catch (_) { /* noop */ }
    try { useLeagueStore().clearStandings() } catch (_) { /* noop */ }
    try { useBreakingNewsStore().clear() } catch (_) { /* noop */ }
  }

  async function fetchCampaign(id) {
    loading.value = true
    error.value = null
    try {
      // Set active campaign for sync
      const syncStore = useSyncStore()
      syncStore.setActiveCampaign(id)

      // When switching campaigns, blow away every per-campaign store so the
      // previous campaign's state (bracket, roster, games, finances, news)
      // can't leak into the new one. The cleared stores will repopulate
      // below via `engineLoadCampaign` + the views' own fetch calls.
      const previousId = currentCampaign.value?.id ?? null
      if (previousId && previousId !== id) {
        _resetCampaignScopedStores()
      } else if (!previousId) {
        // Fresh app load — clearing is also safe (no-op if everything is
        // already empty) and protects against hot-reload state retention.
        _resetCampaignScopedStores()
      }

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

      // One-shot legacy migration: fill `birthDate` on any pre-existing
      // players that were generated before the birthday-driven aging system,
      // and stamp `_lastBirthdayYear` so the first tick doesn't re-age them.
      // Guarded internally by campaign.settings.birthDateMigrationDone.
      try {
        await backfillBirthDates(id)
      } catch (migrationErr) {
        console.warn('[Campaign] birthDate backfill failed:', migrationErr)
      }

      // Catch-up aging: brings stored `age` in line with what each player's
      // birthDate + the campaign's cursor date imply. Idempotent — no-ops when
      // every player's age already matches their cursor age. Repairs campaigns
      // that ran under earlier birthday-tick code (which used currentSeasonYear
      // as the candidate year and skipped most birthdays).
      try {
        await catchUpPlayerAging(id)
      } catch (catchUpErr) {
        console.warn('[Campaign] player-aging catchup failed:', catchUpErr)
      }

      // One-shot legacy migration: fill `country` + `college` on any player
      // generated before generatePlayer started stamping them. Deterministic
      // per-player so re-runs produce the same origin. Guarded internally by
      // campaign.settings.originsBackfillDone.
      try {
        await backfillOrigins(id)
      } catch (originsErr) {
        console.warn('[Campaign] origins backfill failed:', originsErr)
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

      // Wipe any per-campaign store state from the previous campaign before
      // the user navigates into this fresh one. Without this, going from a
      // campaign in the playoffs straight into a brand-new campaign leaves
      // the playoffStore.bracket populated → the new campaign's home view
      // renders playoff buttons / brackets until a hard refresh.
      currentCampaign.value = null
      _resetCampaignScopedStores()

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
