<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Save, AlertTriangle, Pencil, Check } from 'lucide-vue-next'

import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { PlayerHeadshotRepository } from '@/engine/db/PlayerHeadshotRepository'
import { useSyncStore } from '@/stores/sync'
import { useTeamStore } from '@/stores/team'
import { useWalkthroughStore } from '@/stores/walkthrough'
import { useToastStore } from '@/stores/toast'
import { useHeadshotEditorReturnStore } from '@/stores/headshotEditorReturn'
import {
  composeSvg,
  configFromSvg,
  LAYERS,
} from '@/services/headshotComposer'
import { resolveHeadshotSrc, invalidateCustomHeadshot } from '@/services/headshotResolver'
import HeadshotPreview from '@/components/headshot/HeadshotPreview.vue'
import LayerSidebar from '@/components/headshot/LayerSidebar.vue'
import LayerBottomNav from '@/components/headshot/LayerBottomNav.vue'
import LayerContextMenu from '@/components/headshot/LayerContextMenu.vue'
import BaseModal from '@/components/ui/BaseModal.vue'

const route = useRoute()
const router = useRouter()
const syncStore = useSyncStore()
const teamStore = useTeamStore()
const walkthroughStore = useWalkthroughStore()
const toastStore = useToastStore()
const returnStore = useHeadshotEditorReturnStore()

const campaignId = computed(() => route.params.id)
const playerId = computed(() => route.params.playerId)

const player = ref(null)
const originalSvg = ref('')      // raw SVG string loaded from resolver
const config = ref(null)         // parsed-or-default config
const isModified = ref(false)
const activeLayer = ref(null)
const showExitConfirm = ref(false)
const saving = ref(false)

// Inline name editing — local to this editor only. Persisted alongside the
// headshot save so the unsaved-changes prompt covers both.
const editingName = ref(false)
const nameBuffer = ref('')
const nameInputRef = ref(null)

const isMobile = ref(window.innerWidth < 1024)
function handleResize() { isMobile.value = window.innerWidth < 1024 }

// While the user hasn't touched anything, render the original SVG directly
// (preserves the player's existing look, metadata or not). On first mutation
// we switch to the composer-driven preview which can express the edits.
const displaySvg = computed(() => {
  if (!isModified.value) return originalSvg.value
  if (!config.value) return originalSvg.value
  return composeSvg(config.value)
})

const playerName = computed(() => {
  if (!player.value) return ''
  if (player.value.firstName || player.value.lastName) {
    return `${player.value.firstName || ''} ${player.value.lastName || ''}`.trim()
  }
  return player.value.name || 'Player'
})

const playerPosition = computed(() => player.value?.position || '')

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
  player.value = await PlayerRepository.get(campaignId.value, playerId.value)
  if (!player.value) {
    toastStore.showError('Player not found.')
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

function setActiveLayer(id) {
  activeLayer.value = activeLayer.value === id ? null : id
}

function applyConfigUpdate(next) {
  config.value = next
  isModified.value = true
}

async function handleSave() {
  if (!isModified.value || saving.value) return
  saving.value = true
  try {
    const svg = composeSvg(config.value)
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
    toastStore.showSuccess('Headshot saved.')
    handleExit(true)
  } catch (err) {
    console.error('[HeadshotEditor] save failed', err)
    toastStore.showError(err?.message || 'Save failed.')
  } finally {
    saving.value = false
  }
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
  const ctx = returnStore.peek()
  if (ctx.route?.name) {
    router.push({ name: ctx.route.name, params: ctx.route.params || {} })
  } else {
    // Fallback — return to campaign home.
    router.push({ name: 'campaign-home', params: { id: campaignId.value } })
  }
}

function discardAndExit() {
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
  window.addEventListener('resize', handleResize)
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
        <span class="header-btn-label">Exit</span>
      </button>
      <div class="editor-title-wrap">
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
            title="Save name"
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
            title="Edit name"
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
        <span class="header-btn-label">{{ saving ? 'Saving…' : 'Save' }}</span>
      </button>
    </header>

    <main class="editor-main">
      <HeadshotPreview
        :svg-string="displaySvg"
        :size="isMobile ? 320 : 420"
      />
    </main>

    <LayerSidebar
      v-if="!isMobile"
      :layers="LAYERS"
      :active-id="activeLayer"
      @select="setActiveLayer"
    />
    <LayerBottomNav
      v-else
      :layers="LAYERS"
      :active-id="activeLayer"
      @select="setActiveLayer"
    />

    <LayerContextMenu
      v-if="activeLayer && config"
      :layer-id="activeLayer"
      :config="config"
      :in-sheet="isMobile"
      @update:config="applyConfigUpdate"
      @close="activeLayer = null"
    />

    <BaseModal
      :show="showExitConfirm"
      title="Unsaved Changes"
      size="sm"
      @close="showExitConfirm = false"
    >
      <div class="exit-modal-body">
        <div class="warn-icon"><AlertTriangle :size="28" /></div>
        <p>You have unsaved changes. What would you like to do?</p>
      </div>
      <template #footer>
        <div class="exit-modal-actions">
          <button class="action-btn ghost" @click="showExitConfirm = false">Keep editing</button>
          <button class="action-btn danger" @click="discardAndExit">Discard</button>
          <button class="action-btn primary" :disabled="saving" @click="saveAndExit">
            {{ saving ? 'Saving…' : 'Save & Exit' }}
          </button>
        </div>
      </template>
    </BaseModal>
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
  background: linear-gradient(to bottom, var(--color-bg-secondary) 70%, transparent);
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
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 120px;
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
  .header-btn-label {
    display: none;
  }
  .editor-title,
  .name-input {
    font-size: 1.1rem;
  }
  .name-input {
    width: 160px;
  }
  .player-position {
    font-size: 1rem;
  }
  .editor-main {
    padding-bottom: 140px;
  }
}
</style>
