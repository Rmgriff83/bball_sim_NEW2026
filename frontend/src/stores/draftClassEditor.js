// =============================================================================
// draftClassEditor store — backs the Rookie Class editor (custom_roster IAP)
// =============================================================================
// A flat-pool sibling of rosterEditor: edits the ONE draft class scoped to
// (campaign, targetDraftYear) in place. Two hosts load it:
//   • In-campaign "Generate & Edit" — targetDraftYear = currentSeasonYear + 1,
//     reachable only during the season-start rookie-class setup window.
//   • Builder draft-class workshops — teams-less pseudo-campaigns flagged
//     settings.workshopMode === 'draft_class' (never loaded via
//     campaignStore.loadCampaign; this store reads only campaign + players).
// Rows persist via PlayerRepository like every other player, so cloud sync
// (players_fa part) carries the class with zero sync-shape changes.

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { t } from '@wl-i18n/i18n.js'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { PlayerHeadshotRepository } from '@/engine/db/PlayerHeadshotRepository'
import { cloneForPersist } from '@/utils/cloneForPersist'
import { useSyncStore } from '@/stores/sync'
import {
  generateAndSaveRookieClass,
  shouldGenerateGenerational,
  createProspect,
  ROOKIE_TIER_NAMES,
} from '@/engine/draft/RookieGenerationService'
import { importDraftClassBuild, MIN_CLASS_SIZE, MAX_CLASS_SIZE } from '@/engine/community/DraftClassImporter'
import { MAX_PLAYER_BADGES } from '@/stores/rosterEditor'
import {
  recalculateOverall,
  deriveOverallFromAttributes,
  derivePotential,
  ensureAttributeCaps,
} from '@/engine/evolution/PlayerEvolution'

export { MIN_CLASS_SIZE, MAX_CLASS_SIZE }

// Tier display order (best → worst) for the class table sort.
const TIER_ORDER = Object.fromEntries(ROOKIE_TIER_NAMES.map((t, i) => [t, i]))

function _isProspect(p) {
  return !!(p.isDraftProspect || p.is_draft_prospect)
}

export const useDraftClassEditorStore = defineStore('draftClassEditor', () => {
  const campaignId = ref(null)
  const campaign = ref(null)
  const prospects = ref([])
  const targetDraftYear = ref(null)

  const loading = ref(false)
  const saving = ref(false)
  const error = ref(null)

  // Bulk-table editing state — mirrors rosterEditor (selected row drives the
  // hero header; dirty ids drive the contextual Save button + leave guards).
  const selectedId = ref(null)
  const dirtyIds = ref(new Set())
  const isDirty = computed(() => dirtyIds.value.size > 0)
  const selectedPlayer = computed(() =>
    prospects.value.find((p) => p.id === selectedId.value) ?? null)

  const isWorkshop = computed(() =>
    campaign.value?.settings?.workshopMode === 'draft_class')

  // Whether the start choice (generated / scratch / imported) has been made.
  // The prospect-count fallback grandfathers workshops created before the
  // start screen existed — those were auto-generated at creation.
  const hasStarted = computed(() =>
    !!campaign.value?.settings?.draftClassStartMode || prospects.value.length > 0)

  function select(player) {
    selectedId.value = player?.id ?? null
  }

  function markDirtyPlayer(id) {
    if (!id) return
    const next = new Set(dirtyIds.value)
    next.add(id)
    dirtyIds.value = next
  }

  function _clearDirty(id) {
    if (!dirtyIds.value.has(id)) return
    const next = new Set(dirtyIds.value)
    next.delete(id)
    dirtyIds.value = next
  }

  function _sync() {
    const s = useSyncStore()
    s.setActiveCampaign(campaignId.value)
    s.markDirty('draft_class')
  }

  function _sortClass(list) {
    return list.sort((a, b) => {
      const ta = TIER_ORDER[a.rookieTier] ?? 99
      const tb = TIER_ORDER[b.rookieTier] ?? 99
      if (ta !== tb) return ta - tb
      return (b.overallRating ?? b.overall_rating ?? 0) - (a.overallRating ?? a.overall_rating ?? 0)
    })
  }

  async function _loadProspects() {
    const all = await PlayerRepository.getAllForCampaign(campaignId.value)
    prospects.value = _sortClass(all.filter((p) =>
      _isProspect(p) && (p.draftYear ?? p.draft_year) === targetDraftYear.value))
  }

  async function load(id) {
    loading.value = true
    error.value = null
    try {
      campaignId.value = id
      campaign.value = await CampaignRepository.get(id)
      if (!campaign.value) throw new Error('Campaign not found')
      const seasonYear = campaign.value.currentSeasonYear
        ?? campaign.value.current_season_year ?? 2025
      targetDraftYear.value = seasonYear + 1
      await _loadProspects()
      selectedId.value = null
      dirtyIds.value = new Set()
    } catch (e) {
      error.value = e?.message ?? 'Failed to load the class editor'
      throw e
    } finally {
      loading.value = false
    }
  }

  // Workshop start screen: stamp how this class begins. 'generated' rolls a
  // fresh class; 'scratch' leaves it empty (Add Prospect / fill-to-minimum
  // populate it); 'downloaded' is stamped by the view after applyImportedClass.
  // Generation runs BEFORE the stamp so the chooser stays up (busy) until the
  // class exists — and a failed generation leaves the choice retryable.
  async function chooseStart(mode) {
    if (!campaign.value) return
    if (mode === 'generated') await regenerate()
    campaign.value.settings = campaign.value.settings ?? {}
    campaign.value.settings.draftClassStartMode = mode
    await CampaignRepository.save(cloneForPersist(campaign.value))
    if (mode !== 'generated') _sync() // regenerate() already marked dirty
  }

  // Throw away the current class and roll a fresh generated one. Delete-first
  // is load-bearing: generateAndSaveRookieClass early-returns when prospects
  // for the year already exist.
  async function regenerate() {
    saving.value = true
    try {
      await _deleteCurrentClass()
      await generateAndSaveRookieClass(campaignId.value, targetDraftYear.value, {
        includeGenerational: shouldGenerateGenerational(campaign.value, targetDraftYear.value),
      })
      await _loadProspects()
      selectedId.value = null
      dirtyIds.value = new Set()
      await _stampInstall()
      _sync()
    } finally {
      saving.value = false
    }
  }

  // Remove the current class rows (positively identified only) + their custom
  // headshots + stale scouting reveal entries.
  async function _deleteCurrentClass() {
    const current = [...prospects.value]
    if (!current.length) return
    await PlayerRepository.deleteBulk(campaignId.value, current.map((p) => p.id))
    for (const p of current) {
      if (p.hasCustomHeadshot || p.has_custom_headshot) {
        try {
          await PlayerHeadshotRepository.delete(campaignId.value, p.id)
        } catch { /* non-fatal */ }
      }
    }
    const scouted = campaign.value?.settings?.scoutedPlayers
    if (scouted && typeof scouted === 'object') {
      for (const p of current) delete scouted[p.id]
      await CampaignRepository.save(cloneForPersist(campaign.value))
    }
  }

  // Class replacement re-ids every row — stamp the install so the sync
  // pull-merge stops resurrecting the OLD prospects still in the cloud
  // snapshot (same guard applyDownloadedBuild uses; sync.js drops remote
  // players absent locally when this stamp is newer than the snapshot).
  async function _stampInstall() {
    if (!campaign.value) return
    campaign.value.settings = campaign.value.settings ?? {}
    campaign.value.settings.rosterInstalledAt = new Date().toISOString()
    await CampaignRepository.save(cloneForPersist(campaign.value))
    try {
      await useSyncStore().pushChanges(campaignId.value, { isolated: true })
    } catch { /* retried by the normal event-driven sync */ }
  }

  // Apply a downloaded community draft class (replaces the current class).
  async function applyImportedClass(blob) {
    saving.value = true
    try {
      const result = await importDraftClassBuild(campaignId.value, blob, {
        targetDraftYear: targetDraftYear.value,
      })
      await _loadProspects()
      selectedId.value = null
      dirtyIds.value = new Set()
      await _stampInstall()
      _sync()
      return result
    } finally {
      saving.value = false
    }
  }

  // Add one prospect at the chosen tier (the editor's Add Prospect flow).
  async function addProspect({ tier = 'secondRound', position = null } = {}) {
    if (prospects.value.length >= MAX_CLASS_SIZE) return null
    const existingNames = new Set(prospects.value.map((p) => p.name))
    const player = createProspect({
      campaignId: campaignId.value,
      draftYear: targetDraftYear.value,
      tier,
      position,
      existingNames,
    })
    prospects.value.push(player)
    _sortClass(prospects.value)
    selectedId.value = player.id
    await PlayerRepository.save(cloneForPersist(player))
    _sync()
    return player
  }

  // Top the class up to the draft minimum with late-tier fillers (the finish
  // gate's "auto-fill" affordance).
  async function fillToMinimum() {
    const added = []
    while (prospects.value.length + added.length < MIN_CLASS_SIZE) {
      const idx = prospects.value.length + added.length
      added.push(createProspect({
        campaignId: campaignId.value,
        draftYear: targetDraftYear.value,
        tier: idx % 2 === 0 ? 'undrafted' : 'secondRound',
        existingNames: new Set([...prospects.value, ...added].map((p) => p.name)),
      }))
    }
    if (!added.length) return 0
    await PlayerRepository.saveBulk(added.map((p) => cloneForPersist(p)))
    prospects.value.push(...added)
    _sortClass(prospects.value)
    _sync()
    return added.length
  }

  async function removeProspect(player) {
    await PlayerRepository.delete(campaignId.value, player.id)
    const i = prospects.value.findIndex((p) => p.id === player.id)
    if (i >= 0) prospects.value.splice(i, 1)
    _clearDirty(player.id)
    const scouted = campaign.value?.settings?.scoutedPlayers
    if (scouted && typeof scouted === 'object' && scouted[player.id]) {
      delete scouted[player.id]
      await CampaignRepository.save(cloneForPersist(campaign.value))
    }
    if (selectedId.value === player.id) selectedId.value = null
    _sync()
  }

  // Same derived-rating refresh the roster editor applies on save.
  function refreshDerived(player) {
    ensureAttributeCaps(player)
    const ovr = deriveOverallFromAttributes(player.attributes, player.position ?? 'SF')
    player.overallRating = ovr
    player.overall_rating = ovr
    player._overallExact = ovr
    delete player._overallCalcAnchor
    recalculateOverall(player)
    const pot = derivePotential(player)
    // A prospect's potential can never sit below its current overall.
    player.potentialRating = Math.max(pot, ovr)
    player.potential_rating = player.potentialRating
    return player
  }

  async function savePlayer(player) {
    refreshDerived(player)
    await PlayerRepository.save(cloneForPersist(player))
    const i = prospects.value.findIndex((p) => p.id === player.id)
    if (i >= 0) prospects.value.splice(i, 1, player)
    _clearDirty(player.id)
    _sync()
  }

  async function saveDirty() {
    if (!dirtyIds.value.size) return
    saving.value = true
    try {
      const players = prospects.value.filter((p) => dirtyIds.value.has(p.id))
      players.forEach(refreshDerived)
      await PlayerRepository.saveBulk(players.map(cloneForPersist))
      dirtyIds.value = new Set()
      _sync()
    } finally {
      saving.value = false
    }
  }

  async function discardDirty() {
    dirtyIds.value = new Set()
    await _loadProspects()
  }

  async function refreshPlayerFromDb(playerId) {
    const fresh = await PlayerRepository.get(campaignId.value, playerId)
    if (!fresh) return
    const i = prospects.value.findIndex((p) => p.id === playerId)
    if (i >= 0) prospects.value.splice(i, 1, fresh)
  }

  // Human-readable problems blocking finish (empty = good to go).
  function validate() {
    const problems = []
    const n = prospects.value.length
    if (n < MIN_CLASS_SIZE) {
      problems.push(t('Class has {n} prospects; the draft needs at least {min} (30 teams × 2 rounds).', { n, min: MIN_CLASS_SIZE }))
    }
    if (n > MAX_CLASS_SIZE) {
      problems.push(t('Class has {n} prospects — over the {max} limit.', { n, max: MAX_CLASS_SIZE }))
    }
    for (const p of prospects.value) {
      if (!(p.name || p.firstName)) { problems.push(t('A prospect has no name.')); break }
    }
    for (const p of prospects.value) {
      const badgeCount = new Set([
        ...(p.badges ?? []).map((b) => b.id),
        ...Object.keys(p.badgeCaps ?? {}),
      ]).size
      if (badgeCount > MAX_PLAYER_BADGES) {
        const pName = p.name ?? t('A prospect')
        problems.push(t('{name} has {n} badges — max {max}.', { name: pName, n: badgeCount, max: MAX_PLAYER_BADGES }))
        break
      }
    }
    return problems
  }

  function $reset() {
    campaignId.value = null
    campaign.value = null
    prospects.value = []
    targetDraftYear.value = null
    selectedId.value = null
    dirtyIds.value = new Set()
    loading.value = false
    saving.value = false
    error.value = null
  }

  return {
    campaignId, campaign, prospects, targetDraftYear, isWorkshop, hasStarted,
    loading, saving, error,
    selectedId, selectedPlayer, dirtyIds, isDirty,
    select, markDirtyPlayer, saveDirty, discardDirty, refreshPlayerFromDb,
    load, chooseStart, regenerate, applyImportedClass,
    addProspect, fillToMinimum, removeProspect,
    refreshDerived, savePlayer, validate, $reset,
  }
})
