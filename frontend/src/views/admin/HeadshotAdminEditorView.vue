<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, AlertTriangle, Layers, Camera, Info, Trash2, X, RotateCcw } from 'lucide-vue-next'

import api from '@/composables/useApi'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { useAuthStore } from '@/stores/auth'
import {
  composeSvg, defaultConfig, setLayerTier, listAllVariants,
  listAllVariantsForAudience, LAYERS, getLayersForAudience,
  getCurrentVariantKey, getVariantSource, layerContentVersion,
  resolvePieceColor, registerLayerVariant, updateLayerVariantContent,
  SKIN_TONES, HAIR_COLORS, EYE_COLORS, LIP_COLORS, HEADBAND_STYLES,
  paletteVersion,
} from '@/services/headshotComposer'
import { parseVariantPieces } from '@/services/svgPieces'
import HeadshotPreview from '@/components/headshot/HeadshotPreview.vue'
import AdminVariantStrip from '@/components/admin/headshot/AdminVariantStrip.vue'
import AdminVariantEditor from '@/components/admin/headshot/AdminVariantEditor.vue'
import AdminPaletteEditor from '@/components/admin/headshot/AdminPaletteEditor.vue'
import PieceColorPicker from '@/components/headshot/PieceColorPicker.vue'
import BaseModal from '@/components/ui/BaseModal.vue'

const router = useRouter()
const toastStore = useToastStore()
const audioStore = useAudioStore()
const authStore = useAuthStore()

// Active audience tab. The catalog page shows two tabs (Players / Coaches)
// — each pulls its own backdrop/variant pool from the manifest and writes
// premades into the audience-specific folder.
const ACTIVE_AUDIENCE_PREFIX = 'headshot.admin.activeAudience'
function _activeAudienceStorageKey() {
  const userId = authStore.user?.id ?? 'anon'
  return `${ACTIVE_AUDIENCE_PREFIX}.${userId}`
}
const activeAudience = ref('player')
try {
  const raw = localStorage.getItem(_activeAudienceStorageKey())
  if (raw === 'player' || raw === 'coach') activeAudience.value = raw
} catch { /* noop */ }
watch(activeAudience, (next) => {
  try { localStorage.setItem(_activeAudienceStorageKey(), next) } catch { /* noop */ }
})

// Palettes tab — orthogonal to the Players/Coaches audience axis since
// palettes are global (not per-audience). When active, the main column
// swaps from the variant strip / preview catalog to the Palette Editor.
// activeAudience persists separately so going Palettes → back to a
// Player/Coach tab restores their last audience.
const PALETTE_TAB_PREFIX = 'headshot.admin.paletteTabActive'
function _paletteTabStorageKey() {
  const userId = authStore.user?.id ?? 'anon'
  return `${PALETTE_TAB_PREFIX}.${userId}`
}
const paletteTabActive = ref(false)
try {
  const raw = localStorage.getItem(_paletteTabStorageKey())
  if (raw === '1') paletteTabActive.value = true
} catch { /* noop */ }
watch(paletteTabActive, (next) => {
  try { localStorage.setItem(_paletteTabStorageKey(), next ? '1' : '0') } catch { /* noop */ }
})

function selectAudienceTab(next) {
  paletteTabActive.value = false
  activeAudience.value = next
}

function selectPalettesTab() {
  paletteTabActive.value = true
}

// Palette-entry preview controls. While the Palettes tab is active the
// backdrop sidebar grows a "Palette Slot" section that lets the admin
// pick which entry of each palette (skin/hair/eye/lip/headband) the
// preview headshot is composed against — so they can cycle through
// "what does Brown skin / Blue eyes / Warm lips look like with these
// hexes?" without leaving the editor. Writes through the same
// catalogBackdrop override pipeline the variant selectors use so the
// preview reacts instantly.
const PALETTE_PREVIEW_FIELDS = [
  { id: 'skin',     label: 'Skin',     paletteKey: 'skin' },
  { id: 'hair',     label: 'Hair',     paletteKey: 'hair' },
  { id: 'eye',      label: 'Eye',      paletteKey: 'eye' },
  { id: 'lip',      label: 'Lip',      paletteKey: 'lip' },
  { id: 'headband', label: 'Headband', paletteKey: 'headband' },
]

const PALETTE_PREVIEW_SOURCES = {
  skin: SKIN_TONES,
  hair: HAIR_COLORS,
  eye: EYE_COLORS,
  lip: LIP_COLORS,
  headband: HEADBAND_STYLES,
}

function paletteEntryOptionsFor(field) {
  // Touch the reactive palette version so this re-evaluates when the admin
  // saves a palette edit (new entry, deleted entry) — the dropdown should
  // pick up the change immediately.
  void paletteVersion.value
  const source = PALETTE_PREVIEW_SOURCES[field.paletteKey]
  if (!source) return []
  return Object.keys(source).map(key => ({
    value: key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }))
}

function paletteEntryValueFor(field) {
  return effectiveConfig.value[field.id]
}

function setPaletteEntryValue(field, value) {
  catalogBackdrop.value = { ...catalogBackdrop.value, [field.id]: value }
}

// Per-audience preview state. Each tab has its own preview config (so the
// seed face is independent between Players and Coaches) and its own
// backdrop overrides. config/catalogBackdrop below are computed views
// onto the active audience's bucket so existing call sites keep working.
const audienceState = reactive({
  player: { config: defaultConfig('admin-preview-player'), backdrop: {} },
  coach:  { config: defaultConfig('admin-preview-coach'),  backdrop: {} },
})
const config = computed(() => audienceState[activeAudience.value].config)

// Right-panel state. Persisted to sessionStorage so the Vite full-reload
// triggered by tier toggles (and other backend file writes) lands the admin
// back on the same layer tab they were on instead of snapping to 'hair'.
const ACTIVE_LAYER_STORAGE_KEY = 'admin.headshot.activeLayerId'
const activeLayerId = ref('hair')
try {
  const stored = sessionStorage.getItem(ACTIVE_LAYER_STORAGE_KEY)
  if (stored && LAYERS.some(l => l.id === stored)) activeLayerId.value = stored
} catch { /* private mode etc. */ }
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
// localStorage per-user PER-AUDIENCE so each tab keeps its own face.
const CATALOG_BACKDROP_PREFIX = 'headshot.catalog.backdrop'
function _catalogBackdropStorageKey(audience) {
  const userId = authStore.user?.id ?? 'anon'
  return `${CATALOG_BACKDROP_PREFIX}.${audience}.${userId}`
}

// Restore both audiences' backdrops on init so a tab switch doesn't trigger
// a fetch flicker.
for (const audience of ['player', 'coach']) {
  try {
    const raw = localStorage.getItem(_catalogBackdropStorageKey(audience))
    if (raw) {
      const data = JSON.parse(raw)
      if (data && typeof data === 'object') audienceState[audience].backdrop = data
    }
  } catch (err) {
    console.warn(`[HeadshotAdminEditorView] catalog backdrop restore failed for ${audience}`, err)
  }
}

// Writable computed view onto the active audience's backdrop — keeps
// existing `catalogBackdrop.value = ...` call sites working unchanged.
const catalogBackdrop = computed({
  get: () => audienceState[activeAudience.value].backdrop,
  set: (v) => { audienceState[activeAudience.value].backdrop = v || {} },
})

// Persist both backdrops on any deep change.
watch(
  () => ({ player: audienceState.player.backdrop, coach: audienceState.coach.backdrop }),
  (next) => {
    for (const audience of ['player', 'coach']) {
      try {
        localStorage.setItem(_catalogBackdropStorageKey(audience), JSON.stringify(next[audience] || {}))
      } catch (err) {
        console.warn(`[HeadshotAdminEditorView] catalog backdrop persist failed for ${audience}`, err)
      }
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
  return composeSvg(effectiveConfig.value, null, activeAudience.value)
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

// Layers shown for the active audience tab — coaches don't get the headband
// layer (only players wear headbands). Drives the variant-strip pill nav and
// the catalog backdrop picker.
const audienceLayers = computed(() => getLayersForAudience(activeAudience.value))

const catalogBackdropLayers = computed(() =>
  audienceLayers.value.filter(l => l.styleKey || l.toggleKey)
)

function catalogVariantOptionsFor(layer) {
  if (layer.toggleKey) {
    return [
      { value: true, label: 'On' },
      { value: false, label: 'Off' },
    ]
  }
  // Filter variants by the active tab's audience. Touch layerContentVersion
  // so the option list re-evaluates when the admin flips an audience chip.
  void layerContentVersion.value
  const variants = listAllVariantsForAudience(layer.id, activeAudience.value)
  let opts
  if (layer.id === 'face' || layer.id === 'eyebrows') {
    opts = variants.map(v => ({ value: v, label: _titleCase(v) }))
  } else {
    opts = variants.map(v => ({
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
      || getCurrentVariantKey(layer.id, effectiveConfig.value, activeAudience.value)
  }
  return effectiveConfig.value[catalogBackdropFieldKey(layer)]
}

function setCatalogBackdropValue(layer, value) {
  const key = catalogBackdropFieldKey(layer)
  catalogBackdrop.value = { ...catalogBackdrop.value, [key]: value }
}

// ----- per-piece color helpers (mirrors LayerContextMenu Piece Colors) -----
// For layers that declare `colorPalette`, the swatch in each row opens a
// popover listing every authored piece in the current variant. Clicking a
// piece swatch opens the same PieceColorPicker the user editor uses; the
// selected hex / palette token is written into catalogBackdrop.pieceColors[
// layerId][pieceLabel] and the preview's effectiveConfig picks it up.

function piecesForLayer(layer) {
  if (!layer?.colorPalette) return []
  const variantKey = getCurrentVariantKey(layer.id, effectiveConfig.value, activeAudience.value)
  if (variantKey == null) return []
  const source = getVariantSource(layer.id, variantKey, activeAudience.value)
  if (!source) return []
  // Stable order = SVG document order. Skip pieces without a usable label
  // so we don't dump cryptic ids into the UI.
  return parseVariantPieces(source).filter(p => p.label)
}

function _pieceOverride(layerId, label) {
  return catalogBackdrop.value?.pieceColors?.[layerId]?.[label] ?? null
}

function pieceColorFor(layer, piece) {
  const override = _pieceOverride(layer.id, piece.label)
  if (override) {
    if (typeof override === 'string' && override.startsWith('#')) return override
    return resolvePieceColor(
      { colorMode: 'token', colorToken: override },
      effectiveConfig.value,
    ) || '#999'
  }
  return resolvePieceColor(piece, effectiveConfig.value) || '#999'
}

function hasPieceOverride(layer, piece) {
  return Boolean(_pieceOverride(layer.id, piece.label))
}

// Resolved color of the FIRST piece — used by the row's swatch as a visual
// hint. Falls back to a neutral gray when the variant has no pieces.
function layerSwatchHex(layer) {
  const pieces = piecesForLayer(layer)
  if (pieces.length) return pieceColorFor(layer, pieces[0])
  return '#999'
}

function setPieceColor(layer, piece, value) {
  const prev = catalogBackdrop.value?.pieceColors || {}
  const layerMap = { ...(prev[layer.id] || {}), [piece.label]: value }
  catalogBackdrop.value = {
    ...catalogBackdrop.value,
    pieceColors: { ...prev, [layer.id]: layerMap },
  }
}

function clearPieceColor(layer, piece) {
  const prev = catalogBackdrop.value?.pieceColors || {}
  if (!prev[layer.id]) return
  const layerMap = { ...prev[layer.id] }
  delete layerMap[piece.label]
  const nextAll = { ...prev }
  if (Object.keys(layerMap).length === 0) {
    delete nextAll[layer.id]
  } else {
    nextAll[layer.id] = layerMap
  }
  catalogBackdrop.value = { ...catalogBackdrop.value, pieceColors: nextAll }
}

// ----- piece color picker modal -----
const pickerOpen = ref(false)
const pickerLayer = ref(null)
const pickerPiece = ref(null)
const pickerInitial = ref('')

function openPiecePicker(layer, piece) {
  pickerLayer.value = layer
  pickerPiece.value = piece
  // Pre-fill: existing override > piece's authored token > piece's authored hex.
  const override = _pieceOverride(layer.id, piece.label)
  if (override) {
    pickerInitial.value = String(override)
  } else if (piece.colorMode === 'token' && piece.colorToken) {
    pickerInitial.value = piece.colorToken
  } else if (piece.colorMode === 'literal' && piece.colorHex) {
    pickerInitial.value = piece.colorHex
  } else {
    pickerInitial.value = ''
  }
  pickerOpen.value = true
}

function onPickerConfirm(value) {
  if (pickerLayer.value && pickerPiece.value) {
    setPieceColor(pickerLayer.value, pickerPiece.value, value)
  }
  onPickerClose()
}

function onPickerClose() {
  pickerOpen.value = false
  pickerLayer.value = null
  pickerPiece.value = null
  pickerInitial.value = ''
}

// Which layer's per-piece popover is currently open (or null when closed).
// Click-outside dismissal is attached at the document level so clicking
// elsewhere — including another swatch — closes the existing popover.
// The PieceColorPicker modal is excluded so opening it from inside the
// popover doesn't immediately dismiss the popover too.
const openColorLayer = ref(null)
// Viewport-coord position for the teleported popover. Captured from the
// swatch's bounding rect when the popover opens so the popover renders at
// `position: fixed` outside the sidebar's scroll context (otherwise
// `overflow-y: auto` on the sidebar treats the popover as content and
// grows its scrollHeight).
const popoverPos = ref({ top: 0, left: 0 })

const activePopoverLayer = computed(() =>
  LAYERS.find(l => l.id === openColorLayer.value) || null
)

function toggleColorPopover(layer, event) {
  if (openColorLayer.value === layer.id) {
    openColorLayer.value = null
    return
  }
  openColorLayer.value = layer.id
  // Anchor below the swatch's bottom-left corner with a small gap.
  const el = event?.currentTarget
  if (el?.getBoundingClientRect) {
    const rect = el.getBoundingClientRect()
    popoverPos.value = { top: rect.bottom + 6, left: rect.left }
  }
}

function _closeColorPopoverOnDocClick(e) {
  if (!openColorLayer.value) return
  if (pickerOpen.value) return
  if (e.target.closest('.ae-color-swatch, .ae-color-popover')) return
  openColorLayer.value = null
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
      audience: activeAudience.value,
    })
    // Mutate the reactive tier store in the composer so the switch flips
    // immediately — no remount, no preview reflow. Backend response is the
    // source of truth for what tier the variant actually landed in.
    const newTier = data.tier === 'upgraded' ? 'paid' : 'generic'
    setLayerTier(activeLayerId.value, variant, newTier, activeAudience.value)
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
    // Carry the active tab through so a save-as-new from this session
    // (rename → save) inherits the correct audience tag.
    audience: activeAudience.value,
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

// Same idea for the active layer tab — tier toggles (and any other backend
// write) trigger a Vite full reload, and without persistence the catalog
// snaps back to the default 'hair' layer instead of leaving the admin where
// they were. The restore at module init reads from the same key.
watch(activeLayerId, (next) => {
  try {
    if (next) sessionStorage.setItem(ACTIVE_LAYER_STORAGE_KEY, next)
  } catch (err) {
    console.warn('[HeadshotAdminEditorView] activeLayerId persist failed', err)
  }
})

// Switching audience tabs can invalidate the selected layer (e.g. headband is
// player-only) — snap to the first layer valid for the new audience. Runs
// immediately too, so a restored audience+layer mismatch is sanitized on load.
watch(activeAudience, () => {
  if (!audienceLayers.value.some(l => l.id === activeLayerId.value)) {
    activeLayerId.value = audienceLayers.value[0]?.id ?? 'hair'
  }
}, { immediate: true })

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

// Belt-and-suspenders normalization: HTML attributes (autocapitalize="none"
// + autocorrect="off") tell iOS not to auto-capitalize, but if any caps
// still sneak in (paste, switch keyboards, etc.) we lowercase on every
// keystroke so the validator never trips on something that's already
// being saved as lowercase to S3. Same-length transform keeps the
// cursor position stable.
function onNewVariantNameInput() {
  const lowered = newVariantName.value.toLowerCase()
  if (lowered !== newVariantName.value) newVariantName.value = lowered
  newVariantError.value = ''
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
  // Check existing names ONLY within the active audience — coach and player
  // tabs maintain independent variant rosters, so "test" in the player tab
  // doesn't block "test" in the coach tab (different file in different folder).
  const existing = listAllVariants(activeLayerId.value, activeAudience.value)
  if (existing.includes(name)) {
    newVariantError.value = `"${name}" already exists for ${activeLayerId.value} in this tab`
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
    // New variants take their audience from the tab they're created in —
    // no manual chip toggle. AdminVariantEditor.handleSave stamps the
    // tag into the manifest on first save.
    audience: activeAudience.value,
  }
}

// ----- premade headshots (Phase 1: admin-only authoring) -----
// Snapshot the current effectiveConfig preview as a curated SVG on disk.
// Phase 2 will surface these to paid users as default head options.
const PREMADE_TOOLTIP = "Saves the current preview as a premade headshot for the active tab's audience. Player premades show in the user customize screen for paid users; coach premades are randomly assigned at campaign creation."

const premades = ref([])              // [{ name, svgContent }]
const savingPremade = ref(false)
const deletingPremade = ref(null)     // name being deleted (for per-row disable)
const premadesPanelOpen = ref(false)  // floating panel visibility (hidden by default)

async function loadPremades() {
  try {
    const { data } = await api.get('/api/admin/headshot-premades', {
      params: { audience: activeAudience.value },
    })
    premades.value = Array.isArray(data?.premades) ? data.premades : []
  } catch (err) {
    const status = err?.response?.status
    if (status === 503) {
      // Dev env without FRONTEND_ASSETS_PATH — silently no-op so the catalog
      // page still works for read-only browsing.
      premades.value = []
      return
    }
    if (status === 403) { premades.value = []; return }
    console.warn('[HeadshotAdminEditorView] loadPremades failed', err)
  }
}

// Re-fetch when the admin switches tabs so the premade panel reflects only
// the active audience's saved snapshots.
watch(activeAudience, () => {
  premades.value = []
  premadesPanelOpen.value = false
  loadPremades()
})

async function createPremade() {
  if (savingPremade.value) return
  savingPremade.value = true
  try {
    const { data } = await api.post('/api/admin/headshot-premades', {
      content: displaySvg.value,
      audience: activeAudience.value,
    })
    if (data?.name && data?.svgContent) {
      premades.value = [...premades.value, { name: data.name, svgContent: data.svgContent }]
      audioStore.affirm()
      toastStore.showSuccess(`Premade saved as ${data.name}.`)
    }
  } catch (err) {
    const status = err?.response?.status
    if (status === 503) {
      toastStore.showError('Admin endpoint disabled (set FRONTEND_ASSETS_PATH in dev).')
    } else if (status === 403) {
      toastStore.showError('Not authorized.')
    } else {
      toastStore.showError(err?.response?.data?.detail || 'Failed to save premade.')
    }
  } finally {
    savingPremade.value = false
  }
}

async function deletePremade(name) {
  if (deletingPremade.value) return
  if (!window.confirm(`Delete ${name}? This can't be undone.`)) return
  deletingPremade.value = name
  try {
    await api.delete(`/api/admin/headshot-premades/${name}`)
    premades.value = premades.value.filter(p => p.name !== name)
    toastStore.showSuccess(`Deleted ${name}.`)
  } catch (err) {
    const status = err?.response?.status
    if (status === 503) {
      toastStore.showError('Admin endpoint disabled (set FRONTEND_ASSETS_PATH in dev).')
    } else if (status === 403) {
      toastStore.showError('Not authorized.')
    } else if (status === 404) {
      // Already gone from disk — drop from list so the UI catches up.
      premades.value = premades.value.filter(p => p.name !== name)
      toastStore.showSuccess(`Deleted ${name}.`)
    } else {
      toastStore.showError(err?.response?.data?.detail || 'Failed to delete premade.')
    }
  } finally {
    deletingPremade.value = null
  }
}

/**
 * Pull the live S3 layer catalog and rehydrate the composer's in-memory
 * LAYER_CONTENT against S3 truth for EVERY variant, not just the ones
 * missing from the bundle. The bundled glob is a snapshot from the last
 * `npm run build`; any variant edited (or re-saved) after that deploy
 * shows up stale on the main preview's compose path and in the variant
 * editor's load path (both consult LAYER_CONTENT first). The variant
 * strip dodges this because it does its own per-thumb HTTP fetch into
 * a local cache — but composeSvg and AdminVariantEditor don't, so they
 * render last-deploy bytes until this overwrite runs.
 *
 * The N+1 fan-out (one GET per variant) is acceptable here because:
 *   - admin-only path, runs once on mount + once per audience flip
 *   - fetches run in parallel
 *   - each variant SVG is small (~5-20KB)
 */
async function loadLayerManifest(audience) {
  try {
    const { data } = await api.get('/api/admin/headshot-layers/manifest', {
      params: { audience },
    })
    const layers = data?.layers || {}

    // Pass 1: register every name + tier synchronously so the pickers
    // and strip have something to render before the byte fetches finish.
    const allVariants = []
    for (const [layerId, entries] of Object.entries(layers)) {
      for (const entry of entries) {
        const tier = entry.tier === 'upgraded' ? 'paid' : 'generic'
        registerLayerVariant(layerId, entry.name, tier, audience)
        allVariants.push({ layerId, variant: entry.name })
      }
    }

    // Pass 2: fetch fresh bytes for ALL variants and overwrite
    // LAYER_CONTENT. Skipping the ones already in the bundle (the
    // previous behavior) is what was leaving the preview + editor
    // stale after a save → reload cycle.
    await Promise.all(allVariants.map(async ({ layerId, variant }) => {
      try {
        const res = await api.get('/api/admin/headshot-layers/variant', {
          params: { layer: layerId, variant, audience },
        })
        if (res?.data?.content) {
          updateLayerVariantContent(layerId, variant, res.data.content, audience)
        }
      } catch (err) {
        console.warn(`[admin] variant fetch failed: ${layerId}/${variant}`, err)
      }
    }))
  } catch (err) {
    // 503 = ASSETS_AWS_BUCKET unset; fall back to the bundled catalog
    // silently so the editor still functions against whatever was bundled.
    if (err?.response?.status !== 503) {
      console.warn('[admin] layer manifest fetch failed', err)
    }
  }
}

// Refresh the manifest when the audience tab switches so coach variants
// authored post-deploy are visible after a tab flip.
watch(activeAudience, (next) => {
  loadLayerManifest(next)
})

onMounted(() => {
  window.addEventListener('resize', handleResize)
  document.addEventListener('mousedown', _closeColorPopoverOnDocClick)
  loadLayerManifest(activeAudience.value)
  loadPremades()
})
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('mousedown', _closeColorPopoverOnDocClick)
})
</script>

<template>
  <div class="admin-editor">
    <header class="ae-header">
      <button class="ae-exit" @click="exit">
        <ArrowLeft :size="18" />
        <span>Exit</span>
      </button>
      <h1 class="ae-title">Headshot Forge / Admin</h1>
      <!-- Audience tabs live in the header so the catalog page below stays
           the same height regardless of which tab is active. Hidden in
           variant-editor mode since the audience is captured at editor
           entry (the editor doesn't react to tab switches). -->
      <nav
        v-if="isDesktop && !editingVariant"
        class="ae-audience-tabs"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          class="ae-audience-tab"
          :class="{ active: !paletteTabActive && activeAudience === 'player' }"
          :aria-selected="!paletteTabActive && activeAudience === 'player'"
          @click="selectAudienceTab('player')"
        >Players</button>
        <button
          type="button"
          role="tab"
          class="ae-audience-tab"
          :class="{ active: !paletteTabActive && activeAudience === 'coach' }"
          :aria-selected="!paletteTabActive && activeAudience === 'coach'"
          @click="selectAudienceTab('coach')"
        >Coaches</button>
        <button
          type="button"
          role="tab"
          class="ae-audience-tab"
          :class="{ active: paletteTabActive }"
          :aria-selected="paletteTabActive"
          @click="selectPalettesTab"
        >Palettes</button>
      </nav>
      <div v-else class="ae-right-spacer" />
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
        :audience="editingVariant.audience || 'player'"
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
            <!-- Reset-all moved up here as an icon button so it's always
                 visible (the old bottom-of-sidebar text button got pushed
                 off-screen as backdrop rows grew, and using just the icon
                 keeps the header compact). Conditional on having an active
                 override so it doesn't show as a no-op control. -->
            <button
              v-if="Object.keys(catalogBackdrop).length > 0"
              type="button"
              class="ae-backdrop-header-action"
              title="Reset all backdrop overrides"
              aria-label="Reset all backdrop overrides"
              @click="resetCatalogBackdrop"
            >
              <RotateCcw :size="13" />
            </button>
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
            <div class="ae-backdrop-controls">
              <!-- Inline swatch. Click toggles the teleported popover
                   (rendered once at template root) so it can position
                   `fixed` outside the sidebar's scroll context — otherwise
                   `overflow-y: auto` would grow the sidebar's scrollHeight
                   to include the popover. -->
              <div v-if="layer.colorPalette" class="ae-color-anchor">
                <button
                  type="button"
                  class="ae-color-swatch"
                  :style="{ background: layerSwatchHex(layer) }"
                  :title="`Edit ${layer.label.toLowerCase()} piece colors`"
                  :aria-label="`Edit ${layer.label.toLowerCase()} piece colors`"
                  @click="toggleColorPopover(layer, $event)"
                />
              </div>
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
          </div>
        </aside>

        <section class="ae-center">
          <div class="ae-preview-wrap" :class="visibilityClasses">
            <HeadshotPreview :svg-string="displaySvg" :size="380" />
            <!-- Premade authoring controls are catalog-mode only. The
                 Palettes tab repurposes the same preview surface for
                 visualizing palette edits, so the "Create New Headshot"
                 button is irrelevant there. -->
            <div v-if="!paletteTabActive" class="ae-premade-controls">
              <div class="ae-premade-row">
                <button
                  class="ae-premade-btn"
                  :disabled="savingPremade"
                  @click="createPremade"
                >
                  <Camera :size="14" />
                  <span>{{ savingPremade ? 'Saving…' : 'Create New Headshot' }}</span>
                </button>
                <button
                  class="ae-premade-info"
                  type="button"
                  :data-tooltip="PREMADE_TOOLTIP"
                  aria-label="What are premade headshots?"
                  @click.prevent
                >
                  <Info :size="14" />
                </button>
              </div>
              <button
                v-if="premades.length"
                class="ae-premade-view-all"
                type="button"
                @click="premadesPanelOpen = !premadesPanelOpen"
              >
                {{ premadesPanelOpen ? 'Hide' : 'View All' }} ({{ premades.length }})
              </button>
            </div>
          </div>
        </section>

        <!-- Palette-slot dropdowns — floating panel to the right of the
             preview while the Palettes tab is active. Used to be a section
             inside the backdrop sidebar but that stack was tall enough to
             squash the palette editor below. Splitting it out keeps each
             column scannable and lets the editor breathe at full height. -->
        <aside v-if="paletteTabActive" class="ae-palette-slots">
          <header class="ae-palette-slots-header">
            <span>Palette Slot</span>
          </header>
          <p class="ae-palette-slots-hint">
            Cycle each slot to preview different colors with the active
            backdrop layer variants.
          </p>
          <!-- Audience picker scoped to the Palettes tab. Drives which
               layer variant pool (player vs coach) the preview + the
               backdrop dropdowns use without forcing the admin to leave
               Palettes and come back. Just flips activeAudience —
               paletteTabActive stays true so the palette editor at the
               bottom doesn't get swapped out for the variant strip. -->
          <div class="ae-palette-slots-audience">
            <label>Preview as</label>
            <div class="ae-palette-slots-audience-toggle" role="tablist">
              <button
                type="button"
                role="tab"
                :class="{ active: activeAudience === 'player' }"
                :aria-selected="activeAudience === 'player'"
                @click="activeAudience = 'player'"
              >Player</button>
              <button
                type="button"
                role="tab"
                :class="{ active: activeAudience === 'coach' }"
                :aria-selected="activeAudience === 'coach'"
                @click="activeAudience = 'coach'"
              >Coach</button>
            </div>
          </div>
          <div
            v-for="field in PALETTE_PREVIEW_FIELDS"
            :key="`palette-slot-${field.id}`"
            class="ae-palette-slots-row"
          >
            <label>{{ field.label }}</label>
            <select
              :value="paletteEntryValueFor(field)"
              @change="setPaletteEntryValue(field, $event.target.value)"
            >
              <option
                v-for="opt in paletteEntryOptionsFor(field)"
                :key="opt.value"
                :value="opt.value"
              >{{ opt.label }}</option>
            </select>
          </div>
        </aside>
      </div>

      <!-- Bottom row: variant strip on Players/Coaches, palette editor on
           the Palettes tab. Same span — both consume the full screen width
           below the top row. -->
      <AdminPaletteEditor v-if="paletteTabActive" class="ae-strip" />
      <AdminVariantStrip
        v-else
        :key="`strip-${stripRefreshKey}-${activeAudience}`"
        :active-layer-id="activeLayerId"
        :layers="audienceLayers"
        :config="config"
        :audience="activeAudience"
        :pending-variant="pendingVariant"
        class="ae-strip"
        @toggle-tier="handleToggleTier"
        @enter-edit="enterEdit"
        @create-variant="openNewVariantModal"
        @select-layer="selectLayer"
      />

      <!-- Floating premades panel — docks to the right edge of the viewport
           when toggled open via the View All button. Internal scroll keeps
           the page height stable no matter how many premades are saved. -->
      <aside
        v-if="premadesPanelOpen && premades.length && !paletteTabActive"
        class="ae-premades-panel"
        role="dialog"
        aria-label="Premade headshots"
      >
        <header class="ae-premades-panel-header">
          <div class="ae-premades-panel-title">
            <Camera :size="13" />
            <span>Premades ({{ premades.length }})</span>
          </div>
          <button
            class="ae-premades-panel-close"
            type="button"
            aria-label="Close premades panel"
            @click="premadesPanelOpen = false"
          >
            <X :size="14" />
          </button>
        </header>
        <div class="ae-premades-panel-grid">
          <div
            v-for="p in premades"
            :key="p.name"
            class="ae-premade-card"
          >
            <HeadshotPreview :svg-string="p.svgContent" :size="96" />
            <span class="ae-premade-card-name">{{ p.name }}</span>
            <button
              class="ae-premade-card-delete"
              type="button"
              :disabled="deletingPremade === p.name"
              aria-label="Delete premade"
              @click="deletePremade(p.name)"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
      </aside>
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
            autocapitalize="none"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            @input="onNewVariantNameInput"
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

    <!-- Per-piece color picker — opened from the per-piece popover inside the
         catalog backdrop sidebar. Writes to catalogBackdrop.pieceColors. -->
    <PieceColorPicker
      :show="pickerOpen"
      :piece-label="pickerPiece?.label || ''"
      :config="effectiveConfig"
      :initial-value="pickerInitial"
      @close="onPickerClose"
      @confirm="onPickerConfirm"
    />

    <!-- Teleported piece-color popover — lives at <body> root so its
         position: fixed render doesn't inflate the sidebar's scrollHeight.
         Single instance regardless of how many layers have swatches; the
         active layer is whichever one opened it. -->
    <Teleport to="body">
      <div
        v-if="activePopoverLayer"
        class="ae-color-popover ae-pieces-popover"
        :style="{ top: popoverPos.top + 'px', left: popoverPos.left + 'px' }"
      >
        <header class="ae-pieces-popover-header">{{ activePopoverLayer.label }} Pieces</header>
        <div v-if="piecesForLayer(activePopoverLayer).length === 0" class="ae-pieces-empty">
          No pieces in this variant.
        </div>
        <div
          v-for="piece in piecesForLayer(activePopoverLayer)"
          :key="piece.id"
          class="ae-piece-row"
        >
          <button
            type="button"
            class="ae-piece-row-main"
            :title="`Set color for ${piece.label}`"
            @click="openPiecePicker(activePopoverLayer, piece)"
          >
            <span
              class="ae-color-swatch ae-piece-swatch"
              :style="{ background: pieceColorFor(activePopoverLayer, piece) }"
            />
            <span class="ae-piece-label">{{ piece.label }}</span>
          </button>
          <button
            v-if="hasPieceOverride(activePopoverLayer, piece)"
            type="button"
            class="ae-piece-reset"
            title="Reset to default"
            @click="clearPieceColor(activePopoverLayer, piece)"
          >
            ↺
          </button>
        </div>
      </div>
    </Teleport>
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

/* Audience tabs — pill-style segmented control above the catalog body. */
.ae-audience-tabs {
  display: inline-flex;
  /* In-header placement — anchor right, vertically centered inside the
     header's grid row. No flex-start alignment hijacking the cell. */
  justify-self: end;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 2px;
}

.ae-audience-tab {
  padding: 5px 14px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.ae-audience-tab:hover {
  color: var(--color-text-primary);
}

.ae-audience-tab.active {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  color: white;
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
  display: flex;
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

/* Icon-only action sitting at the right edge of the backdrop header.
   `margin-left: auto` pushes it past the title text. Small click target
   tightly sized to the icon since it's adjacent to other header chrome. */
.ae-backdrop-header-action {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.ae-backdrop-header-action:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
  border-color: rgba(255, 255, 255, 0.18);
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

/* Inline swatch + variant select. Two-column grid so the select width
   stays identical across rows whether or not a swatch is present —
   column 1 reserves the 20px swatch slot even when empty, column 2
   always holds the select. Without this, rows with a swatch would
   produce narrower selects than rows without, making the column ragged. */
.ae-backdrop-controls {
  display: grid;
  grid-template-columns: 20px 1fr;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ae-backdrop-controls select {
  grid-column: 2;
  min-width: 0;
}

.ae-color-anchor {
  position: relative;
  grid-column: 1;
  line-height: 0;
}

.ae-color-swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease;
}

.ae-color-swatch:hover {
  transform: scale(1.08);
  border-color: rgba(168, 85, 247, 0.6);
}

/* Popover lives at <body> via <Teleport>, positioned by viewport coords
   captured from the swatch's bounding rect on open. `position: fixed`
   anchors to viewport instead of inheriting the sidebar's scroll context
   (which would inflate the sidebar's scrollHeight). */
.ae-color-popover {
  position: fixed;
  z-index: 60;
  padding: 6px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
}

.ae-pieces-popover {
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 280px;
  overflow-y: auto;
}

.ae-pieces-popover-header {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  padding: 4px 6px 6px;
  border-bottom: 1px solid var(--glass-border);
  margin-bottom: 4px;
}

.ae-pieces-empty {
  padding: 8px 6px;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
  font-style: italic;
}

.ae-piece-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ae-piece-row-main {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  font-size: 0.76rem;
  transition: background 0.12s ease;
}

.ae-piece-row-main:hover {
  background: rgba(255, 255, 255, 0.06);
}

.ae-piece-swatch {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.ae-piece-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ae-piece-reset {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  padding: 0;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.ae-piece-reset:hover {
  color: var(--color-text-primary);
  border-color: rgba(168, 85, 247, 0.5);
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

/* Palette-slot floating panel — sibling of .ae-center on the Palettes
   tab. Mirrors the .ae-backdrop-sidebar's glass-surface look so the top
   row reads as backdrop ↔ preview ↔ palette-slot columns. Width is
   compact (220px) since the row content is just label + native select. */
.ae-palette-slots {
  width: 220px;
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

.ae-palette-slots-header {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.ae-palette-slots-hint {
  margin: 0 0 4px;
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

/* Audience picker — pill toggle scoped to the Palettes tab so flipping
   between player and coach previews doesn't require leaving Palettes. */
.ae-palette-slots-audience {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--glass-border);
}

.ae-palette-slots-audience > label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.ae-palette-slots-audience-toggle {
  display: inline-flex;
  align-items: stretch;
  padding: 2px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
}

.ae-palette-slots-audience-toggle button {
  flex: 1;
  padding: 6px 10px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  border-radius: var(--radius-full);
  transition: background 0.15s ease, color 0.15s ease;
}

.ae-palette-slots-audience-toggle button:hover {
  color: var(--color-text-primary);
}

.ae-palette-slots-audience-toggle button.active {
  background: rgba(168, 85, 247, 0.28);
  color: var(--color-text-primary);
}

.ae-palette-slots-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ae-palette-slots-row label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.ae-palette-slots-row select {
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-size: 0.8rem;
  cursor: pointer;
}

[data-theme="light"] .ae-palette-slots-row select {
  background: rgba(0, 0, 0, 0.04);
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

/* Premade controls — bottom-right corner of the preview wrap. Stacks the
   Create + info row above an optional "View All" toggle button. */
.ae-premade-controls {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  z-index: 4;
}

.ae-premade-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ae-premade-view-all {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-full);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.ae-premade-view-all:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(168, 85, 247, 0.5);
}

.ae-premade-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border: none;
  color: white;
  border-radius: var(--radius-full);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.35);
  transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease;
}

.ae-premade-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.45);
}

.ae-premade-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}

.ae-premade-info {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-radius: 50%;
  cursor: help;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.ae-premade-info:hover,
.ae-premade-info:focus-visible {
  color: var(--color-text-primary);
  border-color: rgba(168, 85, 247, 0.5);
  outline: none;
}

/* CSS-only tooltip surfaced from data-tooltip — appears above the (i) button
   on hover/focus. Width-capped + wrapping so the explanatory text reads
   cleanly without escaping the preview wrap. */
.ae-premade-info::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 240px;
  padding: 8px 10px;
  background: rgba(15, 15, 20, 0.96);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 0.72rem;
  font-weight: 400;
  line-height: 1.4;
  text-align: left;
  white-space: normal;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 5;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}

.ae-premade-info:hover::after,
.ae-premade-info:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}

/* Floating premades panel — fixed to the right edge of the viewport so its
   internal overflow handles arbitrary card counts without ever changing
   the catalog page's layout. Hidden by default; toggled via View All. */
.ae-premades-panel {
  position: fixed;
  top: 80px;
  right: 16px;
  bottom: 16px;
  width: 280px;
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  z-index: 40;
}

.ae-premades-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--glass-border);
}

.ae-premades-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
}

.ae-premades-panel-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-radius: 50%;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.ae-premades-panel-close:hover {
  color: var(--color-text-primary);
  border-color: rgba(168, 85, 247, 0.5);
}

.ae-premades-panel-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.ae-premade-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  /* Hard cap mirrors the variant cell pattern: thumb + name + small padding.
     Stops oversized inline SVGs from stretching the card vertically. */
  max-height: 140px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  transition: transform 0.12s ease, border-color 0.12s ease;
}

.ae-premade-card:hover {
  transform: translateY(-1px);
  border-color: rgba(168, 85, 247, 0.5);
}

/* Force the HeadshotPreview inside the card into a fixed 96×96 box, same
   trick AdminVariantStrip uses on .avs-thumb — the inner SVG renders to
   100% of this clamp, regardless of its native viewBox. */
.ae-premade-card :deep(.headshot-preview) {
  width: 96px;
  height: 96px;
  overflow: hidden;
  border-radius: var(--radius-md);
  flex: 0 0 auto;
}

.ae-premade-card :deep(.headshot-preview svg) {
  width: 100%;
  height: 100%;
  display: block;
}

/* Use the same checkerboard pattern as the main preview for visual consistency. */
.ae-premade-card :deep(.headshot-preview) {
  background-color: var(--glass-bg);
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%);
  background-size: 8px 8px;
  background-position: 0 0, 4px 4px;
  border-radius: var(--radius-md);
}

[data-theme="light"] .ae-premade-card :deep(.headshot-preview) {
  background-image:
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%),
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%);
}

.ae-premade-card-name {
  font-size: 0.6rem;
  font-family: ui-monospace, monospace;
  color: var(--color-text-secondary);
  letter-spacing: 0.02em;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ae-premade-card-delete {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 15, 20, 0.7);
  border: 1px solid var(--glass-border);
  color: #f87171;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.ae-premade-card:hover .ae-premade-card-delete,
.ae-premade-card-delete:focus-visible {
  opacity: 1;
}

.ae-premade-card-delete:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.2);
}

.ae-premade-card-delete:disabled {
  cursor: progress;
  opacity: 0.5;
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
