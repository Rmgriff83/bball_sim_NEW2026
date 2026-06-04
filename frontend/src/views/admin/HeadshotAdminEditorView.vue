<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, AlertTriangle, Layers } from 'lucide-vue-next'

import api from '@/composables/useApi'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { useAuthStore } from '@/stores/auth'
import {
  composeSvg, defaultConfig, setLayerTier, listAllVariants, LAYERS,
  getCurrentVariantKey, layerContentVersion,
} from '@/services/headshotComposer'
import HeadshotPreview from '@/components/headshot/HeadshotPreview.vue'
import AdminVariantStrip from '@/components/admin/headshot/AdminVariantStrip.vue'
import AdminVariantEditor from '@/components/admin/headshot/AdminVariantEditor.vue'
import BaseModal from '@/components/ui/BaseModal.vue'

const router = useRouter()
const toastStore = useToastStore()
const audioStore = useAudioStore()
const authStore = useAuthStore()

// Preview config — fixed-seed so the admin sees the SAME face every session.
// A toggling tier move triggers a Vite full-reload (the watcher sees the
// SVG file enter/leave a globbed path and can't HMR-patch import.meta.glob);
// using a stable seed means the face survives that reload instead of
// regenerating into a new random head.
const config = ref(defaultConfig('admin-preview'))

// Right-panel state
const activeLayerId = ref('hair')
const visibleLayers = ref(new Set(LAYERS.map(l => l.id)))

// Variant being toggled — disables the switch to prevent double-clicks.
const pendingVariant = ref(null)

// Bumped by the editor every time a save succeeds. Used as the strip's
// :key so a successful save always forces a full strip remount — bypasses
// any subtlety around Vue's reactivity tracking of LAYER_CONTENT.
const stripRefreshKey = ref(0)
function handleEditorSaved() { stripRefreshKey.value++ }

// Editor mode: when set, the center area swaps from catalog view (preview +
// variant strip) to the in-place variant editor. Phase 2's whole point.
//
// Persisted to sessionStorage so the Save (stay) flow survives the full
// page reload Vite triggers when the backend writes the SVG file (raw +
// eager glob imports can't HMR, so Vite falls back to full reload). With
// the persistence, the editor seamlessly re-opens on the same variant
// after the reload — without it, the admin gets bounced to catalog mode.
const EDITING_STORAGE_KEY = 'admin.headshot.editingVariant'
const editingVariant = ref(null)  // { variant, tier, isNew } or null

// One-time restore from sessionStorage on mount. New (unsaved) variants are
// dropped from the restore — they exist purely in editor memory and there's
// nothing on disk to keep editing, so re-opening them on reload would just
// strand the admin on an empty canvas with no file backing it.
try {
  const raw = sessionStorage.getItem(EDITING_STORAGE_KEY)
  if (raw) {
    const data = JSON.parse(raw)
    if (data && data.variant && !data.isNew) {
      editingVariant.value = { ...data, isNew: false }
      // Match the active layer to the editing layer so the catalog scaffold
      // is consistent when the editor is closed.
      if (data.layerId) activeLayerId.value = data.layerId
    } else {
      // Stale `isNew` entry — clear so we don't keep ignoring it forever.
      sessionStorage.removeItem(EDITING_STORAGE_KEY)
    }
  }
} catch (err) {
  console.warn('[HeadshotAdminEditorView] editingVariant restore failed', err)
}

// New-variant modal state
const newVariantModalOpen = ref(false)
const newVariantName = ref('')
const newVariantTier = ref('paid')
const newVariantError = ref('')

const isDesktop = ref(window.innerWidth >= 1024)
function handleResize() { isDesktop.value = window.innerWidth >= 1024 }

// ----- catalog backdrop preview -----
// Same idea as the variant editor's backdrop picker, but for the catalog
// landing page: lets the admin compose any combination of layer variants
// in the main preview without entering edit mode. Persisted to
// localStorage per-user so the chosen "preview face" carries across
// sessions.
const catalogBackdrop = ref({})    // { hairStyle: 'mohawk', faceVariantOverride: 'square', ... }

const CATALOG_BACKDROP_PREFIX = 'headshot.catalog.backdrop'
function _catalogBackdropStorageKey() {
  const userId = authStore.user?.id ?? 'anon'
  return `${CATALOG_BACKDROP_PREFIX}.${userId}`
}

try {
  const raw = localStorage.getItem(_catalogBackdropStorageKey())
  if (raw) {
    const data = JSON.parse(raw)
    if (data && typeof data === 'object') catalogBackdrop.value = data
  }
} catch (err) {
  console.warn('[HeadshotAdminEditorView] catalog backdrop restore failed', err)
}

watch(
  catalogBackdrop,
  (next) => {
    try {
      localStorage.setItem(_catalogBackdropStorageKey(), JSON.stringify(next || {}))
    } catch (err) {
      console.warn('[HeadshotAdminEditorView] catalog backdrop persist failed', err)
    }
  },
  { deep: true },
)

const effectiveConfig = computed(() => ({ ...config.value, ...catalogBackdrop.value }))

const displaySvg = computed(() => {
  // Touch the composer's content version so an admin save/delete/rename
  // forces this computed to re-evaluate (LAYER_CONTENT mutations aren't
  // reactive on their own).
  void layerContentVersion.value
  return composeSvg(effectiveConfig.value)
})

// ----- catalog backdrop picker helpers (mirrors the variant editor's) -----
function _titleCase(s) {
  return String(s || '').split(/[-_]/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

const FACE_JAW_OPTIONS = [
  { value: 0, label: 'Narrow' },
  { value: 1, label: 'Medium' },
  { value: 2, label: 'Wide' },
]

const catalogBackdropLayers = computed(() =>
  LAYERS.filter(l => l.styleKey || l.toggleKey)
)

function catalogVariantOptionsFor(layer) {
  if (layer.toggleKey) {
    return [
      { value: true, label: 'On' },
      { value: false, label: 'Off' },
    ]
  }
  let opts
  if (layer.id === 'face' || layer.id === 'eyebrows') {
    opts = listAllVariants(layer.id).map(v => ({ value: v, label: _titleCase(v) }))
  } else {
    opts = listAllVariants(layer.id).map(v => ({
      value: v.replace(/-/g, '_'),
      label: _titleCase(v),
    }))
  }
  if (!opts.some(o => o.value === 'none')) {
    opts.push({ value: 'none', label: 'None' })
  }
  return opts
}

function catalogBackdropFieldKey(layer) {
  if (layer.id === 'face')     return 'faceVariantOverride'
  if (layer.id === 'eyebrows') return 'browVariantOverride'
  return layer.styleKey || layer.toggleKey
}

function catalogBackdropValueFor(layer) {
  if (layer.id === 'face' || layer.id === 'eyebrows') {
    return effectiveConfig.value[catalogBackdropFieldKey(layer)]
      || getCurrentVariantKey(layer.id, effectiveConfig.value)
  }
  return effectiveConfig.value[catalogBackdropFieldKey(layer)]
}

function setCatalogBackdropValue(layer, value) {
  const key = catalogBackdropFieldKey(layer)
  catalogBackdrop.value = { ...catalogBackdrop.value, [key]: value }
}

function resetCatalogBackdrop() {
  catalogBackdrop.value = {}
}

const visibilityClasses = computed(() => {
  const classes = {}
  for (const layer of LAYERS) {
    classes[`hide-${layer.id}`] = !visibleLayers.value.has(layer.id)
  }
  return classes
})

function selectLayer(id) {
  activeLayerId.value = id
}


async function handleToggleTier({ variant, tier }) {
  pendingVariant.value = variant
  try {
    // Server-side body still uses 'generic'/'upgraded' to match the folder
    // convention; the UI calls it 'Free'/'Paid'. Map at the boundary.
    const serverTier = tier === 'paid' ? 'upgraded' : 'generic'
    const { data } = await api.post('/api/admin/headshot-layers/tier', {
      layer: activeLayerId.value,
      variant,
      tier: serverTier,
    })
    // Mutate the reactive tier store in the composer so the switch flips
    // immediately — no remount, no preview reflow. Backend response is the
    // source of truth for what tier the variant actually landed in.
    const newTier = data.tier === 'upgraded' ? 'paid' : 'generic'
    setLayerTier(activeLayerId.value, variant, newTier)
    // Free→Paid is the meaningful promotion — affirmation. Paid→Free is
    // a normal demotion and keeps the generic click tap the global listener
    // already played for the underlying button click.
    if (newTier === 'paid') audioStore.affirm()
    toastStore.showSuccess(newTier === 'paid' ? 'Moved to Paid.' : 'Moved to Free.')
  } catch (err) {
    const status = err?.response?.status
    if (status === 503) {
      toastStore.showError('Admin endpoint disabled (set FRONTEND_ASSETS_PATH in dev).')
    } else if (status === 403) {
      toastStore.showError('Not authorized.')
    } else {
      toastStore.showError(err?.response?.data?.detail || 'Failed to move variant.')
    }
  } finally {
    pendingVariant.value = null
  }
}

function exit() {
  router.push({ name: 'dashboard' })
}

// ----- variant editor mode -----

function enterEdit({ variant, tier }) {
  editingVariant.value = {
    layerId: activeLayerId.value,
    variant,
    tier: tier ?? 'generic',
    isNew: false,
  }
}

function exitEdit() {
  editingVariant.value = null
}

// Sync editingVariant → sessionStorage so it survives Vite's full reload
// on file save. The restore at module init reads from the same key.
watch(
  editingVariant,
  (next) => {
    try {
      if (next && !next.isNew) {
        sessionStorage.setItem(EDITING_STORAGE_KEY, JSON.stringify(next))
      } else {
        sessionStorage.removeItem(EDITING_STORAGE_KEY)
      }
    } catch (err) {
      console.warn('[HeadshotAdminEditorView] editingVariant persist failed', err)
    }
  },
  { deep: true },
)

// Variant was renamed (on disk for existing variants, or just in memory for
// brand-new unsaved ones). Update the editor's `variantName` prop so the
// next Save/Delete targets the right file.
function handleRenamed(newName) {
  if (!editingVariant.value) return
  editingVariant.value = { ...editingVariant.value, variant: newName }
}

// ----- new variant flow -----

function openNewVariantModal() {
  newVariantName.value = ''
  newVariantTier.value = 'paid'
  newVariantError.value = ''
  newVariantModalOpen.value = true
}

function validateNewVariantName() {
  const name = newVariantName.value.trim()
  if (!name) {
    newVariantError.value = 'Name is required'
    return false
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    newVariantError.value = 'Use lowercase letters, numbers, and hyphens only'
    return false
  }
  const existing = listAllVariants(activeLayerId.value)
  // listAllVariants returns hyphenated filenames; the form uses the same.
  if (existing.includes(name)) {
    newVariantError.value = `"${name}" already exists for ${activeLayerId.value}`
    return false
  }
  newVariantError.value = ''
  return true
}

function confirmNewVariant() {
  if (!validateNewVariantName()) return
  const name = newVariantName.value.trim()
  newVariantModalOpen.value = false
  editingVariant.value = {
    layerId: activeLayerId.value,
    variant: name,
    tier: newVariantTier.value,
    isNew: true,
  }
}

onMounted(() => window.addEventListener('resize', handleResize))
onUnmounted(() => window.removeEventListener('resize', handleResize))
</script>

<template>
  <div class="admin-editor">
    <header class="ae-header">
      <button class="ae-exit" @click="exit">
        <ArrowLeft :size="18" />
        <span>Exit</span>
      </button>
      <h1 class="ae-title">Headshot Forge / Admin</h1>
      <div class="ae-right-spacer" />
    </header>

    <div v-if="!isDesktop" class="ae-desktop-required">
      <AlertTriangle :size="28" />
      <p>The admin editor requires a desktop viewport (≥ 1024px).</p>
    </div>

    <!-- Editor mode: full-page variant editor swaps in over the catalog -->
    <main v-else-if="editingVariant" class="ae-main editor-mode">
      <AdminVariantEditor
        :layer-id="activeLayerId"
        :variant-name="editingVariant.variant"
        :tier="editingVariant.tier"
        :config="config"
        :is-new="editingVariant.isNew"
        @exit="exitEdit"
        @renamed="handleRenamed"
        @saved="handleEditorSaved"
      />
    </main>

    <!-- Catalog mode: layer pills (now in the strip header) + preview +
         variant strip. Tools panel and right-side layer panel were removed
         in favor of the consolidated header pill picker. -->
    <main v-else class="ae-main">
      <!-- Top row: always-open backdrop picker (left) + preview (right). -->
      <div class="ae-top">
        <aside class="ae-backdrop-sidebar">
          <header class="ae-backdrop-header">
            <Layers :size="13" />
            <span>Preview Backdrop</span>
          </header>
          <p class="ae-backdrop-hint">
            Swap any layer's variant in the preview. Saved locally so the
            same head greets you next time.
          </p>
          <div
            v-for="layer in catalogBackdropLayers"
            :key="layer.id"
            class="ae-backdrop-row"
          >
            <label>{{ layer.label }}</label>
            <select
              :value="catalogBackdropValueFor(layer)"
              @change="setCatalogBackdropValue(layer, catalogVariantOptionsFor(layer).find(o => String(o.value) === $event.target.value)?.value)"
            >
              <option
                v-for="opt in catalogVariantOptionsFor(layer)"
                :key="String(opt.value)"
                :value="opt.value"
              >{{ opt.label }}</option>
            </select>
          </div>
          <button
            v-if="Object.keys(catalogBackdrop).length > 0"
            class="ae-backdrop-reset"
            @click="resetCatalogBackdrop"
          >
            Reset all
          </button>
        </aside>

        <section class="ae-center">
          <div class="ae-preview-wrap" :class="visibilityClasses">
            <HeadshotPreview :svg-string="displaySvg" :size="380" />
          </div>
        </section>
      </div>

      <!-- Variant strip spans the full screen width below the top row. -->
      <AdminVariantStrip
        :key="`strip-${stripRefreshKey}`"
        :active-layer-id="activeLayerId"
        :layers="LAYERS"
        :config="config"
        :pending-variant="pendingVariant"
        class="ae-strip"
        @toggle-tier="handleToggleTier"
        @enter-edit="enterEdit"
        @create-variant="openNewVariantModal"
        @select-layer="selectLayer"
      />
    </main>

    <!-- New Variant modal -->
    <BaseModal
      :show="newVariantModalOpen"
      title="New Variant"
      size="sm"
      @close="newVariantModalOpen = false"
    >
      <div class="nv-form">
        <div class="nv-field">
          <label>Layer</label>
          <div class="nv-layer">{{ activeLayerId }}</div>
        </div>
        <div class="nv-field">
          <label>Name <span class="req">*</span></label>
          <input
            v-model="newVariantName"
            type="text"
            class="nv-input"
            placeholder="e.g. mohawk"
            maxlength="40"
            @input="newVariantError = ''"
            @keydown.enter.prevent="confirmNewVariant"
          />
          <div class="nv-hint">lowercase letters, numbers, hyphens — no spaces or extension</div>
        </div>
        <div class="nv-field">
          <label>Tier</label>
          <div class="nv-tier-toggle">
            <button
              type="button"
              class="nv-tier"
              :class="{ active: newVariantTier === 'generic' }"
              @click="newVariantTier = 'generic'"
            >Free</button>
            <button
              type="button"
              class="nv-tier"
              :class="{ active: newVariantTier === 'paid' }"
              @click="newVariantTier = 'paid'"
            >Paid</button>
          </div>
          <div class="nv-hint">
            Paid variants don't ship in the procedural campaign pool until you
            promote to Free.
          </div>
        </div>
        <div v-if="newVariantError" class="nv-error">{{ newVariantError }}</div>
      </div>
      <template #footer>
        <div class="nv-actions">
          <button class="nv-btn" @click="newVariantModalOpen = false">Cancel</button>
          <button class="nv-btn primary" @click="confirmNewVariant">Create &amp; Edit</button>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.admin-editor {
  /* Definite viewport height — was `min-height: 100vh`, which let descendants
     push the editor past the viewport (a zoomed canvas would balloon the
     page rather than triggering the inner scroll container). Combined with
     `overflow: hidden`, this gives every flex/grid `min-height: 0` in the
     chain a real anchor, so the canvas scroll-wrap finally clips and pans. */
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0 16px 16px;
}

.ae-header {
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

.ae-exit {
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
}

.ae-title {
  margin: 0;
  text-align: center;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.4rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--color-text-primary);
}

.ae-right-spacer {
  width: 80px;  /* keeps title centered */
}

.ae-desktop-required {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-secondary);
  text-align: center;
  padding: 32px;
}

.ae-main {
  flex: 1;
  /* Catalog mode: column with a top row (backdrop sidebar + preview) and
     the variant strip filling the full screen width below. */
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.ae-top {
  display: flex;
  gap: 12px;
  flex: 0 0 auto;
  min-height: 0;
}

.ae-preview-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  flex: 0 0 auto;
}

/* Catalog backdrop sidebar — always-open column on the left of .ae-main.
   Flush with the surrounding glass surfaces, scrolls internally if the
   layer list grows beyond viewport height. */
.ae-backdrop-sidebar {
  width: 260px;
  flex-shrink: 0;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow-y: auto;
  min-height: 0;
}

.ae-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ae-strip {
  flex: 1;
  min-height: 0;
}

.ae-backdrop-header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  padding-bottom: 6px;
  border-bottom: 1px solid var(--glass-border);
}

.ae-backdrop-hint {
  margin: 0 0 6px;
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.ae-backdrop-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.ae-backdrop-row select {
  width: 100%;
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.ae-backdrop-row select:focus {
  outline: none;
  border-color: rgba(168, 85, 247, 0.6);
}

.ae-backdrop-reset {
  margin-top: 6px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-lg);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.ae-backdrop-reset:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

/* Replace the HeadshotPreview's solid background with the same checkerboard
   pattern used by the pixel canvas + variant thumbs. Scoped to the admin
   page via :deep() so other consumers of HeadshotPreview keep their solid bg. */
.ae-preview-wrap :deep(.headshot-preview) {
  background-color: var(--glass-bg);
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}

[data-theme="light"] .ae-preview-wrap :deep(.headshot-preview) {
  background-image:
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%),
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%);
}

/* Editor mode: the variant editor takes the full main area (single column). */
.ae-main.editor-mode {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* New Variant modal */
.nv-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0;
}

.nv-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nv-field label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
}

.nv-field label .req { color: #f87171; }

.nv-layer {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  font-family: ui-monospace, monospace;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.nv-input {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-family: ui-monospace, monospace;
  font-size: 0.9rem;
}

.nv-input:focus {
  outline: none;
  border-color: rgba(168, 85, 247, 0.5);
}

.nv-hint {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
}

.nv-tier-toggle {
  display: inline-flex;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  padding: 2px;
  width: fit-content;
}

.nv-tier {
  padding: 6px 14px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  border-radius: var(--radius-full);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.nv-tier.active {
  background: rgba(168, 85, 247, 0.3);
  color: var(--color-text-primary);
}

.nv-error {
  color: #f87171;
  font-size: 0.8rem;
}

.nv-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.nv-btn {
  padding: 8px 16px;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
  background: transparent;
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.nv-btn.primary {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border-color: transparent;
  color: white;
}

/* Layer visibility — driven by visibilityClasses on the preview wrap. */
.ae-preview-wrap.hide-hair     :deep([data-layer="hair"])     { display: none; }
.ae-preview-wrap.hide-face     :deep([data-layer="face"])     { display: none; }
.ae-preview-wrap.hide-stubble  :deep([data-layer="stubble"])  { display: none; }
.ae-preview-wrap.hide-headband :deep([data-layer="headband"]) { display: none; }
.ae-preview-wrap.hide-eyebrows :deep([data-layer="eyebrows"]) { display: none; }
.ae-preview-wrap.hide-eyes     :deep([data-layer="eyes"])     { display: none; }
.ae-preview-wrap.hide-nose     :deep([data-layer="nose"])     { display: none; }
.ae-preview-wrap.hide-mouth    :deep([data-layer="mouth"])    { display: none; }
.ae-preview-wrap.hide-neck     :deep([data-layer="neck"])     { display: none; }
</style>
