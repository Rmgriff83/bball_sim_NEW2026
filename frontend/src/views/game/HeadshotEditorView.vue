<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Save, AlertTriangle, Pencil, Check, Sparkles } from 'lucide-vue-next'

import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { PlayerHeadshotRepository } from '@/engine/db/PlayerHeadshotRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { CoachHeadshotRepository } from '@/engine/db/CoachHeadshotRepository'
import { PersonnelHeadshotRepository } from '@/engine/db/PersonnelHeadshotRepository'
import { PERSONNEL_POOL_KEY, PERSONNEL_SETTINGS_KEY } from '@/engine/data/personnelTiers'
import { useSyncStore } from '@/stores/sync'
import { useTeamStore } from '@/stores/team'
import { useWalkthroughStore } from '@/stores/walkthrough'
import WalkthroughReplayButton from '@/components/walkthrough/WalkthroughReplayButton.vue'
import { useToastStore } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { useAudioStore } from '@/stores/audio'
import { useHeadshotEditorReturnStore } from '@/stores/headshotEditorReturn'
import {
  composeSvg,
  configFromSvg,
  getLayersForAudience,
} from '@/services/headshotComposer'
import { listPremades, getCoachHeadshotByName } from '@/services/headshotPremades'
import { resolveHeadshotSrc, invalidateCustomHeadshot } from '@/services/headshotResolver'
import HeadshotPreview from '@/components/headshot/HeadshotPreview.vue'
import LayerContextMenu from '@/components/headshot/LayerContextMenu.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { t } from '@wl-i18n/i18n.js'

const route = useRoute()
const router = useRouter()
const syncStore = useSyncStore()
const teamStore = useTeamStore()
const walkthroughStore = useWalkthroughStore()
const toastStore = useToastStore()
const audio = useAudioStore()
const returnStore = useHeadshotEditorReturnStore()

const campaignId = computed(() => route.params.id)
// Three route shapes feed this view:
//   - headshot-editor/:playerId            (audience = 'player')
//   - coach-headshot-editor/:coachId       (audience = 'coach', kind = 'coach')
//   - personnel-headshot-editor/:kind/:personnelId
//                                          (audience = 'coach' for non-player kinds)
// Audience drives variant + premade pool filtering; personnelKind drives
// where we load/save from (team.coach vs campaign.settings.*).
const personnelKind = computed(() => {
  if (route.name === 'personnel-headshot-editor') return route.params.kind || 'coach'
  if (route.name === 'coach-headshot-editor') return 'coach'
  return null
})
const audience = computed(() => personnelKind.value ? 'coach' : 'player')
const playerId = computed(() => route.params.playerId)
const coachId = computed(() => route.params.coachId)
const personnelId = computed(() => route.params.personnelId)
const subjectId = computed(() => {
  if (audience.value === 'player') return playerId.value
  if (route.name === 'personnel-headshot-editor') return personnelId.value
  return coachId.value
})
// Cached on coach-mode load so handleSave can write back to the same team.
const coachTeam = ref(null)
// Cached on personnel-mode load so handleSave can write hasCustomHeadshot
// back into the right campaign.settings slot without re-fetching.
const personnelCampaign = ref(null)

const player = ref(null)
const originalSvg = ref('')      // raw SVG string loaded from resolver
const config = ref(null)         // parsed-or-default config
const isModified = ref(false)
// Forces the preview off `originalSvg` and onto the composer-driven
// output even when the user hasn't touched anything yet — used for
// coaches/personnel that loaded from a PNG master or had no headshot
// at all, so the user immediately sees an editable composed face
// instead of a blank surface. Kept separate from `isModified` so the
// Unsaved Changes confirm doesn't fire on a clean exit from those flows.
const forceComposedPreview = ref(false)
// Layers editable for the current audience — coaches don't get the headband
// layer (only players wear headbands), so the picker is filtered accordingly.
const audienceLayers = computed(() => getLayersForAudience(audience.value))
// Default to the first non-derived layer so the variant + color picker is
// open by default (mirrors the admin editor's always-visible variant strip).
// Seeded from the audience-filtered list so coaches don't open on a hidden
// (headband) layer.
const activeLayer = ref(audienceLayers.value[0]?.id ?? 'hair')
const showExitConfirm = ref(false)
const saving = ref(false)

// Inline name editing — local to this editor only. Persisted alongside the
// headshot save so the unsaved-changes prompt covers both.
const editingName = ref(false)
const nameBuffer = ref('')
const nameInputRef = ref(null)

const isMobile = ref(window.innerWidth < 1024)
function handleResize() { isMobile.value = window.innerWidth < 1024 }

// Bundled premade headshots authored by admins on /admin/headshots. Loaded
// once at mount via Vite's eager glob — no API call, no async race.
const premades = ref([])

// While the user hasn't touched anything, render the original SVG directly
// (preserves the player's existing look, metadata or not). On first mutation
// we switch to the composer-driven preview which can express the edits.
const displaySvg = computed(() => {
  if (!isModified.value && !forceComposedPreview.value) return originalSvg.value
  if (!config.value) return originalSvg.value
  return composeSvg(config.value, null, audience.value)
})

const playerName = computed(() => {
  if (!player.value) return ''
  if (player.value.firstName || player.value.lastName) {
    return `${player.value.firstName || ''} ${player.value.lastName || ''}`.trim()
  }
  return player.value.name || t('Player')
})

const playerPosition = computed(() => {
  if (audience.value === 'coach') return t('Head Coach')
  return player.value?.position || ''
})

function startNameEdit() {
  if (!player.value) return
  nameBuffer.value = playerName.value
  editingName.value = true
  nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

function commitNameEdit() {
  if (!editingName.value || !player.value) return
  const trimmed = nameBuffer.value.trim()
  editingName.value = false
  if (!trimmed || trimmed === playerName.value) return
  // Split on the first space: first word = firstName, remainder = lastName.
  // Handles single-name inputs too — lastName becomes empty.
  const spaceIdx = trimmed.indexOf(' ')
  const first = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  const last  = spaceIdx === -1 ? ''      : trimmed.slice(spaceIdx + 1).trim()
  player.value.firstName  = first
  player.value.first_name = first
  player.value.lastName   = last
  player.value.last_name  = last
  player.value.name = trimmed
  isModified.value = true
}

function cancelNameEdit() {
  editingName.value = false
}

async function loadPlayer() {
  if (route.name === 'personnel-headshot-editor' && personnelKind.value !== 'coach') {
    await _loadPersonnel()
  } else if (audience.value === 'coach') {
    await _loadCoach()
  } else {
    await _loadPlayerSubject()
  }
}

async function _loadPlayerSubject() {
  player.value = await PlayerRepository.get(campaignId.value, playerId.value)
  if (!player.value) {
    toastStore.showError(t('Player not found.'))
    handleExit(true)
    return
  }
  // Resolve the player's current SVG (custom override OR bundled base).
  // The resolver returns a URL — for custom it's a blob URL of an in-IDB
  // SVG, for bundled it's the Vite-processed module URL.
  const url = await resolveHeadshotSrc(player.value, campaignId.value)
  if (url) {
    try {
      const resp = await fetch(url)
      originalSvg.value = await resp.text()
    } catch (err) {
      console.warn('[HeadshotEditor] failed to fetch SVG', err)
      originalSvg.value = ''
    }
  }
  // Seed the editable config from the loaded SVG. Falls back to a
  // playerId-seeded default if the SVG has no metadata.
  config.value = configFromSvg(originalSvg.value, playerId.value)
}

/**
 * Locate the personnel record (a candidate from the hire pool OR the
 * currently-hired singleton) inside campaign.settings, and return the
 * useful slices for load/save: the record itself, the pool entry (if found),
 * the singleton entry (if found), and the singleton key. Either pool or
 * singleton may be null; both null = personnel not found.
 */
function _findPersonnelIn(campaign, kind, id) {
  if (!campaign?.settings) return { record: null, poolEntry: null, singleton: null, singletonKey: null }
  const poolKey = PERSONNEL_POOL_KEY[kind]
  const singletonKey = PERSONNEL_SETTINGS_KEY[kind]
  const pool = poolKey ? (campaign.settings[poolKey] || []) : []
  const poolEntry = pool.find(p => String(p.id) === String(id)) || null
  const singleton = singletonKey ? campaign.settings[singletonKey] : null
  const singletonMatches = singleton && String(singleton.id) === String(id) ? singleton : null
  return {
    record: poolEntry || singletonMatches,
    poolEntry,
    singleton: singletonMatches,
    singletonKey,
  }
}

async function _loadPersonnel() {
  const campaign = await CampaignRepository.get(campaignId.value)
  if (!campaign) {
    toastStore.showError(t('Campaign not found.'))
    handleExit(true)
    return
  }
  personnelCampaign.value = campaign

  const { record } = _findPersonnelIn(campaign, personnelKind.value, personnelId.value)
  if (!record) {
    toastStore.showError(t('Personnel not found.'))
    handleExit(true)
    return
  }
  player.value = record   // reuse the slot

  // Resolution order: custom IDB → bundled coach-headshots SVG → fallback
  // to default config (matches the coach load path).
  let svgText = ''
  const hasCustom = record.hasCustomHeadshot ?? record.has_custom_headshot
  if (hasCustom) {
    try {
      const rec = await PersonnelHeadshotRepository.get(campaignId.value, personnelKind.value, personnelId.value)
      if (rec?.svgContent) svgText = rec.svgContent
    } catch (err) {
      console.warn('[HeadshotEditor] personnel IDB read failed', err)
    }
  }
  if (!svgText && record.headshot) {
    const entry = getCoachHeadshotByName?.(record.headshot)
    if (entry?.kind === 'svg' && entry.svgContent) {
      svgText = entry.svgContent
    }
  }
  originalSvg.value = svgText
  config.value = configFromSvg(svgText, personnelId.value)
  if (!svgText) forceComposedPreview.value = true
}

async function _loadCoach() {
  // Coaches live inside team.coach; walk the campaign's teams to find ours.
  const teams = await TeamRepository.getAllForCampaign(campaignId.value)
  const owningTeam = teams.find(t => t?.coach?.id === coachId.value)
  if (!owningTeam) {
    toastStore.showError(t('Coach not found.'))
    handleExit(true)
    return
  }
  coachTeam.value = owningTeam
  player.value = owningTeam.coach   // reuse the `player` ref slot; semantics unify enough

  // Resolution order:
  //   1. Custom IDB override (user previously edited this coach).
  //   2. The admin-authored SVG file referenced by coach.headshot in
  //      coach-headshots/ (e.g. 'coach_001.svg').
  //   3. Legacy PNG master portrait — can't be parsed by configFromSvg, so
  //      we leave originalSvg empty and let the composer-driven preview
  //      seed from defaultConfig(coachId). The user gets an editable face
  //      to start from; saving replaces the PNG association with a custom
  //      SVG in IDB on the next render.
  //   4. No headshot assigned — same as 3.
  let svgText = ''
  const hasCustom = player.value?.hasCustomHeadshot ?? player.value?.has_custom_headshot
  if (hasCustom) {
    try {
      const record = await CoachHeadshotRepository.get(campaignId.value, coachId.value)
      if (record?.svgContent) svgText = record.svgContent
    } catch (err) {
      console.warn('[HeadshotEditor] coach IDB read failed', err)
    }
  }
  if (!svgText && player.value?.headshot) {
    const entry = getCoachHeadshotByName(player.value.headshot)
    if (entry?.kind === 'svg' && entry.svgContent) {
      svgText = entry.svgContent
    }
  }
  originalSvg.value = svgText
  config.value = configFromSvg(svgText, coachId.value)
  // If we couldn't load an SVG (PNG master / no headshot), force the
  // preview to render from the parsed-or-default config so the user sees
  // something editable instead of a blank canvas. Uses the dedicated
  // forceComposedPreview flag so the Unsaved Changes confirm doesn't
  // pop on a clean exit from this flow.
  if (!svgText) forceComposedPreview.value = true
}

function setActiveLayer(id) {
  // Always set — the picker stays open at all times (no toggle-off on
  // double-click) so the admin-style "variant strip always visible"
  // behaviour applies here too.
  activeLayer.value = id
}

// If the active layer isn't valid for the current audience (e.g. a coach
// landing on the now-hidden headband layer), snap to the first visible one.
watch(audienceLayers, (layers) => {
  if (activeLayer.value && !layers.some((l) => l.id === activeLayer.value)) {
    activeLayer.value = layers[0]?.id ?? null
  }
}, { immediate: true })

function applyConfigUpdate(next) {
  config.value = next
  isModified.value = true
}

function selectPremade(p) {
  // configFromSvg parses the premade's <g data-layer="..." data-*="..."> metadata
  // back into a full config — the same function used at editor load.
  // Swap is wholesale and silent per the "immediately replaces" spec; any
  // unsaved tweaks the user had on the canvas are discarded.
  if (!p?.svgContent) return
  const nextConfig = configFromSvg(p.svgContent, subjectId.value)
  applyConfigUpdate(nextConfig)
}

async function handleSave() {
  if (!isModified.value || saving.value) return
  saving.value = true
  // Save fires from a click — suppress the generic tap so the affirm cue
  // below isn't doubled up by the global click handler in main.js.
  audio.suppressClickSound()
  try {
    const svg = composeSvg(config.value, null, audience.value)
    if (route.name === 'personnel-headshot-editor' && personnelKind.value !== 'coach') {
      await _savePersonnel(svg)
    } else if (audience.value === 'coach') {
      await _saveCoach(svg)
    } else {
      await _savePlayer(svg)
    }
    audio.affirm()
    toastStore.showSuccess(t('Headshot saved.'))
    handleExit(true)
  } catch (err) {
    console.error('[HeadshotEditor] save failed', err)
    toastStore.showError(err?.message || t('Save failed.'))
  } finally {
    saving.value = false
  }
}

async function _savePlayer(svg) {
  await PlayerHeadshotRepository.save(campaignId.value, playerId.value, svg)
  // Read-modify-write the player to set the flag both ways for downstream
  // consumers that branch on either casing.
  const current = await PlayerRepository.get(campaignId.value, playerId.value)
  if (current) {
    current.hasCustomHeadshot = true
    current.has_custom_headshot = true
    // Persist any inline name edits made in this session. We mirror to both
    // casings so downstream consumers (engine box scores, modals, sync
    // payloads) all see the change regardless of which side they read.
    current.firstName  = player.value.firstName
    current.first_name = player.value.firstName
    current.lastName   = player.value.lastName
    current.last_name  = player.value.lastName
    if (player.value.name) current.name = player.value.name
    await PlayerRepository.save(current)
  }
  invalidateCustomHeadshot(campaignId.value, playerId.value)
  syncStore.markDirty('headshots')
  // Refresh the user-team roster in memory so any PlayerAvatar bound to
  // teamStore.roster (player cards, lineup grids, etc.) picks up the new
  // hasCustomHeadshot flag without a hard refresh. No-op for players not
  // on the user's team.
  try {
    await teamStore.fetchTeam(campaignId.value, { force: true })
  } catch { /* not always user team — ignore */ }
}

async function _saveCoach(svg) {
  await CoachHeadshotRepository.save(campaignId.value, coachId.value, svg)
  // Write the hasCustomHeadshot flag back into the team's coach record so
  // CoachAvatar picks up the IDB path on next render. CRITICAL: re-read a
  // fresh plain object from IDB instead of reusing coachTeam.value — that
  // ref holds a Vue reactive proxy which IDB's structured-clone can't
  // serialize ("could not be cloned" DataCloneError).
  const teams = await TeamRepository.getAllForCampaign(campaignId.value)
  const team = teams.find(t => t?.coach?.id === coachId.value)
  if (team) {
    team.coach.hasCustomHeadshot = true
    team.coach.has_custom_headshot = true
    if (player.value?.firstName) {
      team.coach.firstName = player.value.firstName
      team.coach.first_name = player.value.firstName
    }
    if (player.value?.lastName) {
      team.coach.lastName = player.value.lastName
      team.coach.last_name = player.value.lastName
    }
    if (player.value?.name) team.coach.name = player.value.name
    await TeamRepository.save(team)
  }
  syncStore.markDirty('headshots')
  try {
    await teamStore.fetchTeam(campaignId.value, { force: true })
  } catch { /* not always user team — ignore */ }
}

async function _savePersonnel(svg) {
  await PersonnelHeadshotRepository.save(campaignId.value, personnelKind.value, personnelId.value, svg)
  // Re-read the campaign fresh from IDB. The cached `personnelCampaign.value`
  // ref is a Vue reactive proxy and IDB's structured-clone can't serialize
  // those — same issue we hit for the coach save path.
  const campaign = await CampaignRepository.get(campaignId.value)
  if (campaign) {
    const { poolEntry, singleton, singletonKey } = _findPersonnelIn(campaign, personnelKind.value, personnelId.value)
    if (poolEntry) {
      poolEntry.hasCustomHeadshot = true
      poolEntry.has_custom_headshot = true
    }
    if (singleton) {
      singleton.hasCustomHeadshot = true
      singleton.has_custom_headshot = true
      campaign.settings[singletonKey] = singleton
    }
    await CampaignRepository.save(campaign)
  }
  syncStore.markDirty('headshots')
}

function handleExitClick() {
  if (isModified.value && !saving.value) {
    showExitConfirm.value = true
    return
  }
  handleExit(true)
}

function handleExit(skipDirtyCheck = false) {
  if (!skipDirtyCheck && isModified.value) {
    showExitConfirm.value = true
    return
  }
  // consume() clears the captured playerId so nothing downstream tries to
  // act on it. The destination view no longer auto-reopens the modal — the
  // user just lands on its default state (e.g. TeamManagementView's lineup
  // tab) and the editor has done its job.
  const ctx = returnStore.consume()
  if (ctx.route?.name) {
    router.push({ name: ctx.route.name, params: ctx.route.params || {} })
  } else {
    // Fallback — return to campaign home.
    router.push({ name: 'campaign-home', params: { id: campaignId.value } })
  }
}

function discardAndExit() {
  // cancel() also calls suppressClickSound() internally so the discard
  // button's generic tap doesn't ride on top of the dismissal cue.
  audio.cancel()
  showExitConfirm.value = false
  handleExit(true)
}

function saveAndExit() {
  showExitConfirm.value = false
  handleSave()
}

const FIRST_VISIT_KEY = 'headshot.editor.firstVisit'

function maybeStartWalkthrough() {
  let firstVisit = false
  try {
    firstVisit = localStorage.getItem(FIRST_VISIT_KEY) !== 'done'
    if (firstVisit) localStorage.setItem(FIRST_VISIT_KEY, 'done')
  } catch { /* private mode etc. */ }

  if (firstVisit) {
    walkthroughStore.forceStart('headshotEditor')
  } else {
    walkthroughStore.maybeStart('headshotEditor')
  }
}

// Walkthrough side-effect channel: the registry's context-menu step asks the
// editor to open the Hair layer so the spotlight has something to anchor to,
// and to close it when the step leaves.
watch(() => walkthroughStore.requestedAction, (req) => {
  if (!req || req.view !== 'headshotEditor') return
  if (req.action === 'openHairContext') {
    activeLayer.value = 'hair'
  } else if (req.action === 'closeContext') {
    activeLayer.value = null
  }
})

onMounted(async () => {
  // Entitlement gate: the editor is a paid feature. The brush buttons that
  // route here are all v-if gated, but a direct URL (or stale bookmark) must
  // bounce non-owners rather than open the editor.
  if (!useAuthStore().hasFeature('headshot_editor')) {
    toastStore.showError(t('The Headshot Editor is a separate purchase — grab it from the store to edit faces.'))
    router.replace(`/campaign/${route.params.id}`)
    return
  }
  window.addEventListener('resize', handleResize)
  // Filter premades by audience so the coach editor's bottom strip only
  // shows coach-tagged snapshots.
  premades.value = listPremades(audience.value)
  await loadPlayer()
  maybeStartWalkthrough()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

// Belt-and-suspenders: if the user navigates away via browser back, prompt.
function beforeUnload(e) {
  if (isModified.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}
watch(isModified, (dirty) => {
  if (dirty) window.addEventListener('beforeunload', beforeUnload)
  else window.removeEventListener('beforeunload', beforeUnload)
})
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <div class="headshot-editor">
    <header class="editor-header">
      <button
        type="button"
        class="header-btn exit-btn"
        data-tour="editor-exit"
        @click="handleExitClick"
      >
        <ArrowLeft :size="18" />
        <span class="header-btn-label">{{ $t('Exit') }}</span>
      </button>
      <div class="editor-title-wrap" data-tour="editor-name">
        <template v-if="editingName">
          <input
            ref="nameInputRef"
            v-model="nameBuffer"
            class="name-input"
            :placeholder="playerName"
            maxlength="40"
            @keydown.enter.prevent="commitNameEdit"
            @keydown.escape.prevent="cancelNameEdit"
            @blur="commitNameEdit"
          />
          <button
            type="button"
            class="name-icon-btn"
            :title="$t('Save name')"
            @mousedown.prevent="commitNameEdit"
          >
            <Check :size="14" />
          </button>
        </template>
        <template v-else>
          <h1 class="editor-title">{{ playerName }}</h1>
          <button
            type="button"
            class="name-icon-btn"
            :title="$t('Edit name')"
            @click="startNameEdit"
          >
            <Pencil :size="13" />
          </button>
        </template>
        <span v-if="playerPosition" class="player-position">• {{ playerPosition }}</span>
      </div>
      <button
        type="button"
        class="header-btn save-btn"
        :disabled="!isModified || saving"
        data-tour="editor-save"
        @click="handleSave"
      >
        <Save :size="16" />
        <span class="header-btn-label">{{ saving ? $t('Saving…') : $t('Save') }}</span>
      </button>
    </header>

    <main class="editor-main">
      <div class="editor-preview-col">
        <HeadshotPreview
          :svg-string="displaySvg"
          :size="isMobile ? 320 : 420"
        />

        <!-- Premade headshots (admin-authored defaults). Tap a card to swap
             the player's current head wholesale — user can keep customizing
             colors/layers on top from the right-side picker. Hidden when the
             bundled folder has none. -->
        <section v-if="premades.length" class="he-premades">
          <header class="he-premades-header">
            <Sparkles :size="13" />
            <span>{{ $t('Defaults') }}</span>
            <span class="he-premades-hint">{{ $t('Tap to start from a premade head') }}</span>
          </header>
          <div class="he-premades-scroll">
            <button
              v-for="p in premades"
              :key="p.name"
              class="he-premade-card"
              type="button"
              :aria-label="`Swap to ${p.name}`"
              @click="selectPremade(p)"
            >
              <HeadshotPreview :svg-string="p.svgContent" :size="72" />
            </button>
          </div>
        </section>
      </div>

      <!-- Combined layer pill picker + variant/color box. Embedded on
           desktop (sits in the right column of .editor-main); sheet mode
           on mobile (anchored to the bottom of the viewport). -->
      <LayerContextMenu
        v-if="activeLayer && config"
        :layer-id="activeLayer"
        :config="config"
        :layers="audienceLayers"
        :audience="audience"
        :embedded="!isMobile"
        :in-sheet="isMobile"
        class="editor-picker-col"
        @update:config="applyConfigUpdate"
        @select-layer="setActiveLayer"
        @close="activeLayer = null"
      />
    </main>

    <BaseModal
      :show="showExitConfirm"
      :title="$t('Unsaved Changes')"
      size="xs"
      @close="showExitConfirm = false"
    >
      <div class="exit-modal-body">
        <div class="warn-icon"><AlertTriangle :size="28" /></div>
        <p>{{ $t('You have unsaved changes. What would you like to do?') }}</p>
      </div>
      <template #footer>
        <div class="exit-modal-actions">
          <button class="action-btn ghost" @click="showExitConfirm = false">{{ $t('Keep editing') }}</button>
          <button class="action-btn danger" @click="discardAndExit">{{ $t('Discard') }}</button>
          <button class="action-btn primary" :disabled="saving" @click="saveAndExit">
            {{ saving ? $t('Saving…') : $t('Save & Exit') }}
          </button>
        </div>
      </template>
    </BaseModal>

    <WalkthroughReplayButton walkthrough-key="headshotEditor" />
  </div>
</template>

<style scoped>
.headshot-editor {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 0 16px 16px;
  position: relative;
}

.editor-header {
  position: sticky;
  top: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 14px 4px;
}

.header-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
  border-radius: var(--radius-full);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.15s ease, opacity 0.15s ease;
}

.header-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-btn:not(:disabled) {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border-color: transparent;
  color: white;
}

.editor-title-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  margin: 16px;
  background: transparent;
}

.editor-title {
  margin: 0;
  text-align: center;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.4rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.name-input {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.4rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(168, 85, 247, 0.4);
  border-radius: var(--radius-lg);
  padding: 4px 10px;
  min-width: 0;
  width: 220px;
  max-width: 60vw;
  outline: none;
  transition: border-color 0.15s ease;
}

.name-input:focus {
  border-color: rgba(168, 85, 247, 0.7);
}

.name-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s ease, background 0.15s ease;
}

.name-icon-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.player-position {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.2rem;
  letter-spacing: 0.02em;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.editor-main {
  flex: 1;
  /* Desktop: row layout — preview column on the left, embedded picker on
     the right. Mobile media query below collapses back to a single column
     so the LayerContextMenu (which switches to sheet mode at < 1024px)
     doesn't compete with the preview for space. */
  display: flex;
  flex-direction: row;
  align-items: stretch;
  justify-content: center;
  gap: 24px;
  min-height: 0;
  padding-bottom: 24px;
}

.editor-preview-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  min-width: 0;
}

/* Swap the main HeadshotPreview's solid background for the same Photoshop-
   style checkerboard the admin variant strip + pixel canvas use, so the
   user sees an unambiguous "transparent" backdrop behind their headshot
   rather than the surrounding glass surface bleeding through. Scoped via
   :deep so the per-piece previews and premade thumbs elsewhere keep their
   solid bg. The :nth-child(1) targets only the main preview, not the
   smaller premade thumbnails further down the column. */
.editor-preview-col > :deep(.headshot-preview) {
  background-color: var(--glass-bg);
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}

[data-theme="light"] .editor-preview-col > :deep(.headshot-preview) {
  background-image:
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%),
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%);
}

.editor-picker-col {
  flex: 0 0 340px;
  align-self: stretch;
  max-height: 100%;
}

/* Premade headshots strip — sits at the bottom of the preview column. The
   .he-premades-scroll handles arbitrary card counts via horizontal overflow
   so the page height stays bounded. */
.he-premades {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.he-premades-header {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
}

.he-premades-hint {
  margin-left: 4px;
  font-size: 0.68rem;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: var(--color-text-tertiary);
}

.he-premades-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.he-premade-card {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  /* Match the variant cell containment pattern: card never grows past its
     intended box even if the inline SVG renders at native viewBox size. */
  max-height: 100px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease;
}

.he-premade-card:hover,
.he-premade-card:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(168, 85, 247, 0.55);
  background: rgba(168, 85, 247, 0.08);
  outline: none;
}

/* Hard-clamp the inline HeadshotPreview to a 72×72 box (mirrors the admin
   .avs-thumb pattern). The inner SVG renders to 100% of the clamp. */
.he-premade-card :deep(.headshot-preview) {
  width: 72px;
  height: 72px;
  overflow: hidden;
  border-radius: var(--radius-md);
  flex: 0 0 auto;
  /* Same checkerboard the admin variant thumbs use, for a consistent feel. */
  background-color: var(--glass-bg);
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%);
  background-size: 12px 12px;
  background-position: 0 0, 6px 6px;
}

[data-theme="light"] .he-premade-card :deep(.headshot-preview) {
  background-image:
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%),
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%);
}

.he-premade-card :deep(.headshot-preview svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.exit-modal-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 8px 0;
}

.warn-icon {
  color: #f59e0b;
}

.exit-modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.action-btn {
  padding: 10px 16px;
  border-radius: var(--radius-full);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--glass-border);
  background: transparent;
  color: var(--color-text-primary);
}

.action-btn.ghost:hover {
  background: rgba(255, 255, 255, 0.05);
}

.action-btn.danger {
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.4);
}

.action-btn.primary {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  color: white;
  border-color: transparent;
}

.action-btn.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 1023px) {
  /* Cap the editor to the live viewport on mobile — no whole-page scroll.
     100dvh tracks iOS Safari's collapsing chrome so the editor doesn't
     poke off-screen when the URL bar appears/disappears; 100vh fallback
     for engines that don't support dvh. Combined with overflow:hidden,
     the interior columns own their own scroll behavior. */
  .headshot-editor {
    min-height: 0;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }
  .editor-main {
    flex-direction: column;
    padding-bottom: 24px;
    min-height: 0;
    overflow-y: auto;
  }
  /* On mobile the picker switches to sheet mode (fixed to viewport bottom),
     so it doesn't participate in the column layout — give it zero width. */
  .editor-picker-col {
    flex: 0 0 auto;
    align-self: auto;
  }
  /* Mobile: anchor the preview column to the top of the scrollable area
     and give the HeadshotPreview a little breathing room below the
     sticky header. Desktop keeps its vertical-center treatment. */
  .editor-preview-col {
    justify-content: flex-start;
  }
  .editor-preview-col > :deep(.headshot-preview) {
    margin-top: 20px;
  }
}

/* Desktop: overlay the campaign top nav. The editor is a full-screen
   modal-style surface — the user opted into this view from a player card
   and the campaign nav links would just distract from the editing task.
   Mobile keeps the in-flow layout (its own header doubles as the page
   header and the editor never competes with the campaign chrome there). */
@media (min-width: 1024px) {
  .headshot-editor {
    position: fixed;
    inset: 0;
    /* Above the campaign-header (sticky, z-index ≤ 40) but BELOW the
       walkthrough overlay (z-index: 90) so tour spotlights/tooltips still
       render on top of the editor. */
    z-index: 50;
    min-height: 0;
    height: 100vh;
    overflow-y: auto;        /* sticky editor-header stays anchored here */
    background: var(--color-bg-primary);
  }
  /* Anchor the preview column to the bottom of its row on desktop and
     give the HeadshotPreview a touch of breathing room below it before
     the premade strip. Mobile keeps its flex-start + margin-top
     treatment from the mobile media query above. */
  .editor-preview-col {
    justify-content: flex-end;
  }
  .editor-preview-col > :deep(.headshot-preview) {
    margin-bottom: 60px;
  }
}
</style>
