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
import { backfillGmContract } from '@/engine/migrations/backfillGmContract'
import { backfillPersonnelIds } from '@/engine/migrations/backfillPersonnelIds'
import { backfillInitialRookies } from '@/engine/migrations/backfillInitialRookies'
import { reconcileTeamFields } from '@/engine/migrations/reconcileTeamFields'
import { rescaleContracts } from '@/engine/migrations/rescaleContracts'
import { pruneRetiredPlayers } from '@/engine/migrations/pruneRetiredPlayers'
import { useAuthStore } from '@/stores/auth'
import { TEAMS } from '@/engine/data/teams'
import { useSyncStore } from '@/stores/sync'
import { usePlayoffStore } from '@/stores/playoff'
import { useTeamStore } from '@/stores/team'
import { useGameStore } from '@/stores/game'
import { useFinanceStore } from '@/stores/finance'
import { useLeagueStore } from '@/stores/league'
import { useBreakingNewsStore } from '@/stores/breakingNews'
import api from '@/composables/useApi'

// Highest GM level reached among a campaign's recorded `gm_promotion`
// achievements. Reads the numeric `level` field, falling back to parsing the
// legacy id form `ach_gm_<level>_<year>` for entries written before that field
// existed. Returns 0 when there are none.
function maxRecordedGmLevel(campaign) {
  const list = Array.isArray(campaign?.achievements) ? campaign.achievements : []
  let max = 0
  for (const a of list) {
    if (a?.type !== 'gm_promotion') continue
    let lvl = Number.isInteger(a.level) ? a.level : null
    if (lvl == null && typeof a.id === 'string') {
      const m = a.id.match(/^ach_gm_(\d+)_/)
      if (m) lvl = parseInt(m[1], 10)
    }
    if (lvl != null && lvl > max) max = lvl
  }
  return max
}

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

      // Reconcile deletions: a campaign that WAS synced (server once had it)
      // but is now missing from the server's list was deleted on another
      // device — remove it locally.
      //
      // A NEVER-synced campaign missing from the server is a completely
      // different situation: its first push simply hasn't landed, and the
      // local copy is the ONLY copy in existence. Deleting it here destroyed
      // real users' campaigns (the old code only spared never-synced
      // campaigns younger than 60s). Instead, self-heal: push it to the
      // server now. Push failure leaves it untouched locally.
      for (const local of localCampaigns) {
        if (serverIds.has(local.id)) continue
        const wasSynced = !!local.lastSyncedAt

        if (!wasSynced) {
          try {
            await syncStore.pushChanges(local.id, { isolated: true })
            await CampaignRepository.markSyncedWithServer(local.id)
            console.log(`[Campaign] Recovered unsynced local campaign to cloud: ${local.name} (${local.id})`)
          } catch (err) {
            console.warn(`[Campaign] Could not push unsynced campaign ${local.id} (kept locally):`, err)
          }
          continue
        }

        try {
          await engineDeleteCampaign(local.id)
          console.log(`[Campaign] Removed local campaign deleted on another device: ${local.name} (${local.id})`)
        } catch (err) {
          console.warn(`[Campaign] Failed to remove deleted campaign ${local.id}:`, err)
        }
      }

      // Pull any cloud-only campaigns into IndexedDB. Failures are handled
      // below: campaigns that still aren't local get rendered as cloud
      // stubs with a Restore button — a campaign that exists on the server
      // must never be invisible to the player.
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

      const finalLocal = await listCampaigns()
      const finalLocalIds = new Set(finalLocal.map(c => c.id))
      // Server campaigns whose pull failed (or hasn't happened) are shown as
      // cloud-only stubs so the user can see them and retry via Restore.
      const cloudStubs = serverCampaigns
        .filter(sc => !finalLocalIds.has(sc.id))
        .map(sc => ({
          id: sc.id,
          name: sc.name || 'Cloud Campaign',
          cloudOnly: true,
          updatedAt: sc.updatedAt ?? null,
        }))
      campaigns.value = [...finalLocal, ...cloudStubs]
      return campaigns.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch campaigns'
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Re-attempt downloading a cloud-only campaign (rendered as a stub in the
   * campaigns list after its automatic pull failed). Throws on failure so
   * the UI can surface an error; refreshes the list on success.
   */
  async function restoreCloudCampaign(id) {
    const syncStore = useSyncStore()
    await syncStore.pullChanges(id)
    const restored = await CampaignRepository.get(id)
    if (!restored) {
      throw new Error('Could not download this campaign from the cloud. Check your connection and try again.')
    }
    await fetchCampaigns()
    return restored
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

  // Per-campaign timestamp of the last cloud sync-pull. fetchCampaign runs on
  // every navigation to a campaign view (the home view re-fetches on each
  // mount), and pulling on every one is wasteful. We throttle the pull to at
  // most once per cooldown per campaign — cross-device freshness is still caught
  // separately by the visibility/focus pull in the sync store.
  const _lastPullAt = new Map()
  const PULL_COOLDOWN_MS = 120_000

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

      // Check cloud for newer data before using local — but throttle: skip the
      // pull if this campaign was pulled within the cooldown (avoids a redundant
      // /sync/pull on every re-navigation to the same campaign). Stamp the time
      // up front so a failed pull (e.g. a fresh campaign that 404s) also throttles.
      //
      // CRITICAL (stability): never let the cloud pull block navigation when we
      // already have the campaign locally. A slow/dead connection here used to hang
      // the whole load (and the UI) until the request timed out — or forever, before
      // the axios timeout. So: if a local copy exists, fire the pull in the
      // BACKGROUND (newer remote data is written to IDB and picked up next load);
      // only AWAIT the pull on a genuine cold load (no local copy at all), which is
      // now bounded by the request timeout.
      if (Date.now() - (_lastPullAt.get(id) ?? 0) > PULL_COOLDOWN_MS) {
        _lastPullAt.set(id, Date.now())
        const hasLocal = !!(await CampaignRepository.get(id))
        const runPull = async () => {
          try {
            const pullResult = await syncStore.pullChanges(id)
            if (pullResult?.usedRemote) {
              console.log('[Campaign] Remote data was newer, reloading from IndexedDB')
            }
          } catch (pullErr) {
            console.warn('[Campaign] Cloud pull failed, will use local data:', pullErr?.message)
          }
        }
        if (hasLocal) {
          // Don't await — navigation stays responsive regardless of connection.
          runPull()
        } else {
          // Cold cloud-only load: we need the data, but the axios timeout guarantees
          // this resolves/fails instead of hanging.
          await runPull()
        }
      }

      // One-shot migration (Team Owners Part 2): backfill the GM contract +
      // sub-task progress for campaigns that predate the lifecycle, and report
      // whether the user's current team is a gated Strong/Elite franchise.
      // Runs BEFORE engineLoadCampaign so the loaded campaign reflects the
      // backfilled gmContract. The GM-Level grandfather floor is applied after.
      let gmTeamRequiredLevel = 0
      try {
        const res = await backfillGmContract(id)
        gmTeamRequiredLevel = res.requiredGmLevel ?? 0
      } catch (gmErr) {
        console.warn('[Campaign] GM contract backfill failed:', gmErr)
      }

      // One-shot salary-cap rebase: re-derive every player's contract onto the
      // 2025-26 salary scale so the higher cap actually binds in pre-rebase
      // campaigns. Runs BEFORE engineLoadCampaign so the loaded payrolls reflect
      // the new numbers. Guarded by campaign.settings.salaryRescaleDone.
      try {
        await rescaleContracts(id)
      } catch (rescaleErr) {
        console.warn('[Campaign] salary rescale failed:', rescaleErr)
      }

      // One-shot legacy migration: stamp a stable `id` on hired staff (and pool
      // candidates) that predate the id-carrying hire flow, so the per-staff
      // headshot-edit brush (gated on `personnel.id`) renders for them. Runs
      // BEFORE engineLoadCampaign so the loaded campaign.settings carries the ids.
      // Guarded internally by campaign.settings.personnelIdsBackfillDone.
      try {
        await backfillPersonnelIds(id)
      } catch (personnelErr) {
        console.warn('[Campaign] personnel id backfill failed:', personnelErr)
      }

      try {
        result = await engineLoadCampaign(id)
      } catch (loadErr) {
        throw loadErr
      }

      // Grandfather legacy GMs already running a gated team up to that tier's
      // floor (Silver for Strong, Gold for Elite) so the new GM-Level gate stays
      // consistent with the seat they hold. Floor only — never lowers an earned
      // level. Best-effort (profile-global).
      if (gmTeamRequiredLevel > 0) {
        try {
          const authStore = useAuthStore()
          if (authStore.gmLevel < gmTeamRequiredLevel) {
            // Fire-and-forget: ensureGmLevelAtLeast updates local profile.gmLevel
            // synchronously and persists to the backend in the background, so a slow
            // gm-level POST can't stall the campaign load on a poor connection.
            authStore.ensureGmLevelAtLeast(gmTeamRequiredLevel).catch(() => {})
          }
        } catch (floorErr) {
          console.warn('[Campaign] GM level grandfather floor failed:', floorErr)
        }
      }

      if (!result || !result.campaign) {
        throw new Error('Failed to load campaign')
      }

      // Self-heal the profile-global GM level from this campaign's recorded
      // promotions. The promotion ACHIEVEMENT is stored per-campaign (IndexedDB,
      // durable), but the gmLevel itself lives on the user profile and is only
      // persisted to the backend — so an earlier re-sign whose backend write was
      // lost (e.g. before the /api/user/gm-level endpoint existed) leaves the
      // owner card showing "Unranked" despite the unlocked achievement. Floor
      // only — never lowers a higher career level earned elsewhere.
      try {
        const authStore = useAuthStore()
        const recorded = maxRecordedGmLevel(result.campaign)
        if (recorded > 0 && authStore.gmLevel < recorded) {
          // Fire-and-forget (local update is synchronous; backend persist is bg).
          authStore.ensureGmLevelAtLeast(recorded).catch(() => {})
        }
      } catch (gmHealErr) {
        console.warn('[Campaign] GM level self-heal failed:', gmHealErr)
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

      // One-shot legacy migration: tag season-1 rookies for campaigns whose
      // initial league was never rookie-tagged (fantasy drafts / pre-fix saves),
      // so Rookie of the Year / All-Rookie have candidates. Self-limiting to an
      // untagged first season; guarded by settings.initialRookiesBackfilled.
      try {
        await backfillInitialRookies(id)
      } catch (rookieErr) {
        console.warn('[Campaign] initial-rookie backfill failed:', rookieErr)
      }

      // One-shot repair: reconcile snake_case team fields (team_id/abbrs/
      // is_free_agent) with the canonical teamId. Pre-fix user trades left
      // split-field players that the AI-AI trade engine could steal off the
      // user's roster. Guarded by settings.teamFieldsReconciled.
      try {
        await reconcileTeamFields(id)
      } catch (reconcileErr) {
        console.warn('[Campaign] team-field reconcile failed:', reconcileErr)
      }

      // One-shot catch-up: prune retired players accumulated before the
      // offseason retiree prune existed (their single-game records are folded
      // into settings.allTimeHighs first). Shrinks the players_fa sync part
      // and IndexedDB. Guarded by settings.retireePruneDone.
      try {
        const pruned = await pruneRetiredPlayers(id)
        if (pruned > 0) console.info(`[Campaign] pruned ${pruned} retired players`)
      } catch (pruneErr) {
        console.warn('[Campaign] retiree prune failed:', pruneErr)
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

      // Mark for cloud sync and push immediately (fire-and-forget). The old
      // flow waited for the next route-leave/visibility event to do the
      // first push, leaving a window where the brand-new campaign existed
      // nowhere but this device. Failure here is fine — fetchCampaigns'
      // reconciliation now recovers never-synced campaigns by pushing them.
      const syncStore = useSyncStore()
      syncStore.setActiveCampaign(newCampaign.id)
      syncStore.markDirty()
      syncStore.syncNow().catch(err => {
        console.warn('[Campaign] Initial push after creation failed (will retry on next sync):', err)
      })

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
    restoreCloudCampaign,
    fetchCampaign,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    fetchAvailableTeams,
    updateCurrentDate,
    clearCurrentCampaign,
  }
})
