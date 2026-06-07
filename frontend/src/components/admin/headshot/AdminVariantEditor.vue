<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { ArrowLeft, Save, AlertTriangle, Undo2, Trash2, ZoomIn, ZoomOut, Maximize, Focus, Edit3, Layers, X, Image as ImageIcon, Eye, EyeOff, Pipette, Crosshair, Move } from 'lucide-vue-next'

import api from '@/composables/useApi'
import { useToastStore } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { useAudioStore } from '@/stores/audio'
import {
  parseVariantPieces, serializeVariantPieces,
  defaultLabelForToken, generatePieceId,
} from '@/services/svgPieces'
import { snapTo90, pieceBoundingBox, subtractRect } from '@/services/pixelDraw'
import {
  getVariantSource, resolvePieceColor, listAllVariants, LAYERS, getCurrentVariantKey,
  updateLayerVariantContent, removeLayerVariantContent, renameLayerVariantContent,
} from '@/services/headshotComposer'
import { loadRecentColors, pushRecentColor } from '@/services/recentColors'

import AdminToolsPanel from './AdminToolsPanel.vue'
import AdminPiecesPanel from './AdminPiecesPanel.vue'
import AdminPixelCanvas from './AdminPixelCanvas.vue'
import AdminColorPicker from './AdminColorPicker.vue'
import BaseModal from '@/components/ui/BaseModal.vue'

const props = defineProps({
  // Which variant we're editing
  layerId: { type: String, required: true },
  variantName: { type: String, required: true },
  // 'generic' or 'paid' — folder the save endpoint targets
  tier: { type: String, default: 'paid' },
  // Backdrop config so the canvas can render the rest of the head behind us
  config: { type: Object, required: true },
  // When true, this is a brand-new variant (no file on disk yet) — starts empty
  isNew: { type: Boolean, default: false },
  // Audience tab the admin entered from. On the FIRST save of a brand-new
  // variant we write this into the manifest so the asset only shows up in
  // the tab it was authored in. No manual toggle UI — the tab IS the tag.
  audience: { type: String, default: 'player' },
})

const emit = defineEmits(['exit', 'renamed', 'saved'])

const toastStore = useToastStore()
const authStore = useAuthStore()
const audioStore = useAudioStore()

// ----- state -----
const pieces = ref([])
const activePieceId = ref(null)
const selectedPieceIds = ref([])
const activeTool = ref('select')
// Brush size for pencil + eraser. 1 = single pixel (default); up to 5 fills
// an N×N square footprint centered on the cursor.
const brushSize = ref(1)
// Which shape variant the Rect tool draws. Persists per-session so picking
// circle once keeps drawing circles until the admin swaps it back.
const shapeType = ref('rect')
// Editor-only per-piece opacity overlay. Keyed by piece id; missing entries
// default to 1.0 (fully opaque). Pure visual aid for comparing pieces while
// editing — never serialized to the saved SVG.
const pieceOpacities = ref({})

// Zoom — discrete preset levels so + / - feel snappy. Click math in the
// canvas uses getBoundingClientRect so any zoom level auto-maps correctly.
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const zoom = ref(1)
const zoomPercent = computed(() => Math.round(zoom.value * 100))
function zoomIn() {
  const idx = ZOOM_LEVELS.indexOf(zoom.value)
  if (idx < ZOOM_LEVELS.length - 1) zoom.value = ZOOM_LEVELS[idx + 1]
}
function zoomOut() {
  const idx = ZOOM_LEVELS.indexOf(zoom.value)
  if (idx > 0) zoom.value = ZOOM_LEVELS[idx - 1]
}
function resetZoom() { zoom.value = 1 }

// Isolate-layer toggle — when on, the canvas hides every layer in the
// composed headshot except the one being edited. Editor-only viewing aid
// (never persisted); makes it easier to author pieces without the rest of
// the head competing visually. Defaults off so the admin still sees context.
const isolateLayer = ref(false)

// Backdrop variant overrides — lets the admin swap the variants of OTHER
// (non-edited) layers in the canvas backdrop so they can see how the
// in-progress edit looks paired with different surrounding choices (e.g.
// fix a hair variant that gaps over a wide jaw vs a narrow one). Keyed by
// the config field name (hairStyle, jawWidth, hasStubble, ...).
const backdropOverrides = ref({})

// Merge overrides into the parent's config. The canvas + everything else
// downstream renders against this. Doesn't mutate the prop.
const effectiveConfig = computed(() => ({
  ...props.config,
  ...backdropOverrides.value,
}))

// Overall backdrop dimmer — fades every layer except the one being edited
// so the admin can focus on their in-progress work without losing context.
// 1.0 = backdrop at full opacity; 0 = backdrop fully hidden (similar to
// isolate-layer but smooth instead of binary).
const backdropOpacity = ref(1)

// Percent-bridge for the slider's v-model. Stores 0-100 integer while the
// underlying ref stays as 0-1 for the composer.
const backdropOpacityPercent = computed({
  get: () => Math.round(backdropOpacity.value * 100),
  set: (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return
    backdropOpacity.value = Math.max(0, Math.min(1, n / 100))
  },
})

// Layers eligible for backdrop swapping — everything except the one being
// edited. Eyebrows + face previously got special-cased out because they're
// multi-axis / integer-keyed in the user-facing config, but the composer
// now accepts `browVariantOverride` / `faceVariantOverride` for the admin
// backdrop path so both can join the picker like everything else.
const backdropLayers = computed(() =>
  LAYERS.filter(l =>
    l.id !== props.layerId
    && (l.styleKey || l.toggleKey)
  )
)

// Title-case a filename for display (e.g. "side-part" → "Side Part").
function _titleCase(s) {
  return String(s || '').split(/[-_]/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function variantOptionsFor(layer) {
  if (layer.toggleKey) {
    return [
      { value: true, label: 'On' },
      { value: false, label: 'Off' },
    ]
  }
  let opts
  // Face + eyebrows are special: integer-keyed (face) / multi-axis
  // (eyebrows) in the user-facing config, but the composer's `*Override`
  // fields accept the raw filename so the picker just lists them as-is.
  if (layer.id === 'face' || layer.id === 'eyebrows') {
    opts = listAllVariants(layer.id, props.audience).map(v => ({ value: v, label: _titleCase(v) }))
  } else {
    // String-keyed layers — filenames are hyphenated; config keys are
    // underscored (configKeyFor reversed).
    opts = listAllVariants(layer.id, props.audience).map(v => ({
      value: v.replace(/-/g, '_'),
      label: _titleCase(v),
    }))
  }
  // Universal "hide this layer" option — the composer's _renderLayer
  // treats variantKey === 'none' as a no-op (empty wrapper, nothing drawn).
  // Skip if the list already includes 'none' (headband/stubble ship with it).
  if (!opts.some(o => o.value === 'none')) {
    opts.push({ value: 'none', label: 'None' })
  }
  return opts
}

function backdropFieldKey(layer) {
  // Face + eyebrows route through their own override fields so the
  // user-facing config keys (jawWidth integer, browThickness/browAngle
  // pair) stay untouched.
  if (layer.id === 'face')     return 'faceVariantOverride'
  if (layer.id === 'eyebrows') return 'browVariantOverride'
  return layer.styleKey || layer.toggleKey
}

function backdropValueFor(layer) {
  if (layer.id === 'face' || layer.id === 'eyebrows') {
    // Show the override if set, otherwise the file the canonical user-
    // facing fields currently resolve to — so the picker reads as the
    // same variant the canvas is actually rendering.
    return effectiveConfig.value[backdropFieldKey(layer)]
      || getCurrentVariantKey(layer.id, effectiveConfig.value, props.audience)
  }
  return effectiveConfig.value[backdropFieldKey(layer)]
}

function setBackdropValue(layer, value) {
  const key = backdropFieldKey(layer)
  backdropOverrides.value = { ...backdropOverrides.value, [key]: value }
}

const backdropMenuOpen = ref(false)
function toggleBackdropMenu() { backdropMenuOpen.value = !backdropMenuOpen.value }
function closeBackdropMenu() { backdropMenuOpen.value = false }

// ----- reference image overlay -----
// Temporary tracing image. The dataURL + controls are persisted to
// sessionStorage keyed by (layerId, variantName) so a Vite reload after
// save doesn't wipe the admin's tracing setup. Storage is cleared when
// the admin explicitly hits Remove (clearReference) or when the browser
// tab closes — never written to disk, the variant SVG, or the backend.
const refImage = ref(null)      // { dataUrl, naturalWidth, naturalHeight } | null
const refVisible = ref(true)
const refOpacity = ref(0.5)     // 0..1
const refScale = ref(1)         // multiplied on top of object-fit:contain
const refOffsetX = ref(0)       // px in display-space
const refOffsetY = ref(0)
const refPanelOpen = ref(false)
const refFileInputRef = ref(null)

function openReferencePanel() { refPanelOpen.value = true }
function closeReferencePanel() { refPanelOpen.value = false }

// --- sessionStorage persistence ---
// Per-variant key so each variant remembers its own reference setup. We
// can't include this in the SVG (it's just a tracing aid) and don't want
// it on disk, so sessionStorage (tab-scoped) hits the sweet spot.
const REF_STORAGE_PREFIX = 'headshot.ref'
function _refStorageKey() {
  return `${REF_STORAGE_PREFIX}.${props.layerId}.${props.variantName}`
}

function _persistReferenceNow() {
  try {
    if (!refImage.value) {
      sessionStorage.removeItem(_refStorageKey())
      return
    }
    sessionStorage.setItem(_refStorageKey(), JSON.stringify({
      dataUrl: refImage.value.dataUrl,
      naturalWidth: refImage.value.naturalWidth,
      naturalHeight: refImage.value.naturalHeight,
      visible: refVisible.value,
      opacity: refOpacity.value,
      scale: refScale.value,
      offsetX: refOffsetX.value,
      offsetY: refOffsetY.value,
    }))
  } catch (err) {
    // QuotaExceededError, sessionStorage disabled in private browsing,
    // etc. — degrade gracefully: in-memory ref still works, just won't
    // survive a reload.
    console.warn('[AdminVariantEditor] reference persist failed', err)
  }
}

// Debounce so dragging the image (60fps offset updates) doesn't write a
// multi-megabyte dataURL string to sessionStorage on every frame.
let _persistTimeout = null
function _scheduleReferencePersist() {
  if (_persistTimeout) clearTimeout(_persistTimeout)
  _persistTimeout = setTimeout(() => {
    _persistTimeout = null
    _persistReferenceNow()
  }, 300)
}

function _restoreReference() {
  try {
    const raw = sessionStorage.getItem(_refStorageKey())
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data?.dataUrl) return
    refImage.value = {
      dataUrl: data.dataUrl,
      naturalWidth: data.naturalWidth || 0,
      naturalHeight: data.naturalHeight || 0,
    }
    refVisible.value = data.visible !== false
    refOpacity.value = typeof data.opacity === 'number' ? data.opacity : 0.5
    refScale.value = typeof data.scale === 'number' ? data.scale : 1
    refOffsetX.value = typeof data.offsetX === 'number' ? data.offsetX : 0
    refOffsetY.value = typeof data.offsetY === 'number' ? data.offsetY : 0
  } catch (err) {
    console.warn('[AdminVariantEditor] reference restore failed', err)
  }
}

// Restore once at editor mount. Watcher re-persists on every change after
// that, debounced. Mount hook lives at the very bottom of the script,
// but state restore is an opt-in "before anything else" step so it runs
// here right after the persistence helpers are defined.
onMounted(_restoreReference)

watch(
  [refImage, refVisible, refOpacity, refScale, refOffsetX, refOffsetY],
  _scheduleReferencePersist,
  { deep: true },
)

function triggerReferenceUpload() {
  refFileInputRef.value?.click()
}

const REF_MAX_BYTES = 5 * 1024 * 1024  // 5 MB cap — comfortable headroom for high-res concept art

function handleReferenceFile(event) {
  const file = event.target?.files?.[0]
  // Reset the input so picking the same file again still triggers a change.
  if (event.target) event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toastStore.showError('Reference must be an image (PNG, JPG, WebP).')
    return
  }
  if (file.size > REF_MAX_BYTES) {
    toastStore.showError('Reference image too large (max 5 MB).')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result
    const img = new Image()
    img.onload = () => {
      refImage.value = {
        dataUrl,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      }
      // Fresh upload — reset transform so a stale scale/offset from a
      // previous image doesn't carry over.
      refScale.value = 1
      refOffsetX.value = 0
      refOffsetY.value = 0
      refVisible.value = true
      refPanelOpen.value = true
    }
    img.onerror = () => toastStore.showError('Could not load reference image.')
    img.src = dataUrl
  }
  reader.onerror = () => toastStore.showError('Could not read file.')
  reader.readAsDataURL(file)
}

function clearReference() {
  refImage.value = null
  refScale.value = 1
  refOffsetX.value = 0
  refOffsetY.value = 0
  refVisible.value = true
  refOpacity.value = 0.5
  // Drop the persisted entry immediately so a refresh doesn't re-hydrate
  // the image the admin just removed. Cancel any pending debounced write
  // to avoid races where the deferred persist would re-introduce it.
  if (_persistTimeout) { clearTimeout(_persistTimeout); _persistTimeout = null }
  try { sessionStorage.removeItem(_refStorageKey()) } catch { /* ignore */ }
}

function centerReference() {
  refOffsetX.value = 0
  refOffsetY.value = 0
}

function toggleReferenceVisible() {
  refVisible.value = !refVisible.value
}

// Move-reference toggle: remembers whichever tool was active when the admin
// switched to ref-move so a second click restores it. Avoids stranding the
// admin on the ref-move tool after they're done positioning the image.
const previousToolBeforeRefMove = ref(null)
function toggleReferenceMove() {
  if (activeTool.value === 'ref-move') {
    activeTool.value = previousToolBeforeRefMove.value || 'select'
    previousToolBeforeRefMove.value = null
  } else {
    previousToolBeforeRefMove.value = activeTool.value
    activeTool.value = 'ref-move'
  }
}

// Canvas emits drag deltas in display-space pixels when ref-move tool is
// active. We normalize by the current zoom so the stored offset stays in
// canvas-grid units (= display px at zoom 1) and the image stays anchored
// to the same canvas coordinate at every zoom level.
function handleReferenceTranslate({ dx, dy }) {
  const z = zoom.value || 1
  refOffsetX.value += dx / z
  refOffsetY.value += dy / z
}

// ----- eyedropper -----
// Pre-fill hex for the AdminColorPicker — set by the eyedropper handler,
// consumed (and cleared) by the color-picker initial computed.
const pendingEyedropHex = ref(null)

async function pickColorFromReference() {
  if (typeof window === 'undefined' || typeof window.EyeDropper !== 'function') {
    toastStore.showError('Eyedropper requires a Chromium-based browser.')
    return
  }
  try {
    const eyeDropper = new window.EyeDropper()
    const { sRGBHex } = await eyeDropper.open()
    if (!sRGBHex) return
    // Target the active piece if there is one; otherwise create a new piece.
    pendingEyedropHex.value = sRGBHex
    colorPickerTarget.value = activePieceId.value || 'new'
    colorPickerOpen.value = true
  } catch {
    // User cancelled the eyedropper — no-op
  }
}
const isDirty = ref(false)
const saving = ref(false)
const showExitConfirm = ref(false)
const showDeleteConfirm = ref(false)
const deleting = ref(false)

// Color picker modal state
const colorPickerOpen = ref(false)
const colorPickerTarget = ref(null)  // 'new' | pieceId

// Per-admin MRU stack of colors. Loaded once on mount, updated on every
// successful color-picker confirm. The recents dropdown re-applies an entry
// through the same handlers as the color-picker confirm, so picking from
// recents = picking from the modal in terms of state mutation.
const recentColors = ref([])
onMounted(() => {
  recentColors.value = loadRecentColors(authStore.user?.id)
})

// Single-step undo. We snapshot a deep-clone of `pieces` right before each
// mutation. Drag-style actions (paint, erase, translate) fire many events
// per drag; we collapse those into one snapshot by only re-snapshotting when
// the action TYPE changes. So a full pencil drag = one undo step (restores
// pre-drag state), and a rotate-then-pencil = two distinct snapshots.
const undoSnapshot = ref(null)   // JSON-serialized pieces array, or null
const lastActionType = ref(null)

function snapshot(actionType) {
  if (lastActionType.value !== actionType) {
    undoSnapshot.value = JSON.stringify(pieces.value)
  }
  lastActionType.value = actionType
}

function undo() {
  if (!undoSnapshot.value) return
  pieces.value = JSON.parse(undoSnapshot.value)
  undoSnapshot.value = null
  lastActionType.value = null
}

// Pointer release on the canvas closes the current drag's undo group. The
// snapshot() helper collapses consecutive same-action calls into one undo
// step (so a single pencil drag with many paint events = one undo); without
// this reset, separate drags of the same tool also collapse because
// `lastActionType` never gets cleared between them — undo would then wipe
// every stroke since the very first one. Resetting on stroke-end means each
// drag becomes its own undo step.
function handleStrokeEnd() {
  lastActionType.value = null
}

// ----- init -----
// ----- editor working-state persistence -----
// Vite triggers a full page reload after every save (raw + eager glob
// imports can't HMR), which used to wipe the admin's whole working setup:
// tool selection, zoom, isolate, backdrop variants, piece opacities, the
// active piece, multi-selection, etc. We snapshot the lot to localStorage
// keyed by (user, layer, variant) and re-hydrate on mount so iteration
// across multiple saves feels seamless. Variant pieces themselves are
// NEVER persisted here — they're loaded from disk like before.
const EDITOR_STATE_PREFIX = 'headshot.editor'
function _editorStorageKey() {
  const userId = authStore.user?.id ?? 'anon'
  return `${EDITOR_STATE_PREFIX}.${userId}.${props.layerId}.${props.variantName}`
}

function _persistEditorStateNow() {
  try {
    const payload = {
      activeTool: activeTool.value,
      brushSize: brushSize.value,
      shapeType: shapeType.value,
      zoom: zoom.value,
      isolateLayer: isolateLayer.value,
      backdropOpacity: backdropOpacity.value,
      activePieceId: activePieceId.value,
      selectedPieceIds: [...selectedPieceIds.value],
      pieceOpacities: { ...pieceOpacities.value },
      backdropOverrides: { ...backdropOverrides.value },
      refPanelOpen: refPanelOpen.value,
      backdropMenuOpen: backdropMenuOpen.value,
    }
    localStorage.setItem(_editorStorageKey(), JSON.stringify(payload))
  } catch (err) {
    // Quota exceeded / disabled storage — degrade gracefully.
    console.warn('[AdminVariantEditor] editor state persist failed', err)
  }
}

let _editorPersistTimeout = null
function _scheduleEditorPersist() {
  if (_editorPersistTimeout) clearTimeout(_editorPersistTimeout)
  _editorPersistTimeout = setTimeout(() => {
    _editorPersistTimeout = null
    _persistEditorStateNow()
  }, 300)
}

// Restore happens AFTER the pieces array is populated so selection IDs can
// be validated against actual pieces. Anything referencing a missing piece
// is dropped silently to keep the restore safe.
function _restoreEditorState() {
  try {
    const raw = localStorage.getItem(_editorStorageKey())
    if (!raw) return
    const data = JSON.parse(raw)
    const validIds = new Set(pieces.value.map(p => p.id))

    if (typeof data.activeTool === 'string') activeTool.value = data.activeTool
    if (typeof data.brushSize === 'number') brushSize.value = data.brushSize
    if (typeof data.shapeType === 'string') shapeType.value = data.shapeType
    if (typeof data.zoom === 'number' && ZOOM_LEVELS.includes(data.zoom)) {
      zoom.value = data.zoom
    }
    if (typeof data.isolateLayer === 'boolean') isolateLayer.value = data.isolateLayer
    if (typeof data.backdropOpacity === 'number') {
      backdropOpacity.value = Math.max(0, Math.min(1, data.backdropOpacity))
    }

    if (data.activePieceId && validIds.has(data.activePieceId)) {
      activePieceId.value = data.activePieceId
    }
    if (Array.isArray(data.selectedPieceIds)) {
      selectedPieceIds.value = data.selectedPieceIds.filter(id => validIds.has(id))
    }
    if (data.pieceOpacities && typeof data.pieceOpacities === 'object') {
      const next = {}
      for (const [id, val] of Object.entries(data.pieceOpacities)) {
        if (validIds.has(id) && typeof val === 'number') next[id] = val
      }
      pieceOpacities.value = next
    }
    if (data.backdropOverrides && typeof data.backdropOverrides === 'object') {
      backdropOverrides.value = { ...data.backdropOverrides }
    }
    if (typeof data.refPanelOpen === 'boolean') refPanelOpen.value = data.refPanelOpen
    if (typeof data.backdropMenuOpen === 'boolean') backdropMenuOpen.value = data.backdropMenuOpen
  } catch (err) {
    console.warn('[AdminVariantEditor] editor state restore failed', err)
  }
}

// Watch every persisted field. Single debounced flush coalesces bursts
// (e.g. a multi-piece selection that updates several refs at once).
watch(
  [
    activeTool, brushSize, shapeType,
    zoom, isolateLayer, backdropOpacity,
    activePieceId, selectedPieceIds,
    pieceOpacities, backdropOverrides,
    refPanelOpen, backdropMenuOpen,
  ],
  _scheduleEditorPersist,
  { deep: true },
)

async function _loadVariantSource(layerId, variantName) {
  // Fast path: in-memory LAYER_CONTENT (the Vite-bundled glob plus any
  // in-session updates from save/delete/rename).
  const cached = getVariantSource(layerId, variantName, props.audience)
  if (cached) return cached
  // Fallback: fetch the raw file from disk via the admin GET endpoint.
  // This catches variants that exist on disk but aren't in the bundled
  // glob — most importantly NEW variants the admin just saved, since the
  // post-save Vite reload rebuilds LAYER_CONTENT from a glob result that
  // doesn't include freshly-created files. Also patches LAYER_CONTENT so
  // subsequent reads stay on the fast path.
  try {
    const { data } = await api.get('/api/admin/headshot-layers/variant', {
      params: { layer: layerId, variant: variantName, audience: props.audience },
    })
    const fresh = data?.content || ''
    if (fresh) {
      updateLayerVariantContent(layerId, variantName, fresh, props.audience)
      return fresh
    }
  } catch (err) {
    // 503 (no FRONTEND_ASSETS_PATH) or 404 (variant truly doesn't exist
    // yet — could happen for a brand-new variant the admin hasn't saved).
    console.warn('[AdminVariantEditor] variant fetch fallback failed', err)
  }
  return ''
}

// True while onMounted is still seeding pieces from the variant source.
// The deep watcher below would otherwise see the initial assignment as a
// real edit and flip isDirty before the user has touched anything — that
// false-positive was making the Unsaved Changes confirm pop on exit
// straight from a clean open.
let initializing = true

onMounted(async () => {
  if (props.isNew) {
    pieces.value = []
  } else {
    const source = await _loadVariantSource(props.layerId, props.variantName)
    pieces.value = source ? parseVariantPieces(source).map(p => ({ ...p, visible: true })) : []
  }
  if (pieces.value.length > 0) {
    activePieceId.value = pieces.value[0].id
  }
  // Apply the per-user/per-variant working-state snapshot AFTER pieces
  // are loaded so selection IDs can be validated against the real pieces.
  _restoreEditorState()
  // Drain any queued post-flush watchers from the seed assignments above
  // before lifting the initializing guard, so they can't fire after the
  // gate opens and re-dirty the editor.
  await nextTick()
  isDirty.value = false
  initializing = false
})

// Mark dirty when pieces change after init. Watch deeply so any mutation
// (paint, color, transform, etc.) flips the flag. Guarded against the
// seed-load fires via `initializing`.
watch(pieces, () => {
  if (initializing) return
  isDirty.value = true
}, { deep: true })

// ----- canvas event handlers -----
//
// IMPORTANT: the canvas dispatches pixels and rects in WORLD (canvas grid)
// coordinates — i.e. where the cursor is on screen. But a piece's `rects`
// array stores PIECE-LOCAL coordinates: the rendered position is
// `transform.x + rect.x`, `transform.y + rect.y`. For pieces that have been
// moved (translate tool, or the duplicate offset), world ≠ local. Every
// rect-data handler must convert world → local using the piece's transform
// before doing geometry, otherwise:
//   - pencil paints at the wrong piece-local spot (visually offset by
//     transform when rendered)
//   - eraser/cut compares world-space cells against local-space rects and
//     "misses" everywhere except where the piece's transform happens to be
//     (0, 0) — the symptom that looks like "the eraser doesn't work on
//     duplicated/moved pieces."
//
// Rotation is supported for 90° increments. For free-form rotation,
// untransforming the cursor point produces a non-axis-aligned local point;
// subtractRect/pushRect work on axis-aligned rects so non-zero rotations
// won't produce ideal results, but the Rotate tool snaps to 90° anyway.

function _worldToLocal(piece, x, y) {
  const t = piece?.transform || { x: 0, y: 0, rotation: 0 }
  const dx = x - (t.x || 0)
  const dy = y - (t.y || 0)
  const rot = ((t.rotation || 0) % 360 + 360) % 360
  if (rot === 0) return { x: dx, y: dy }
  // 90° / 180° / 270° — rotate (dx, dy) by -rot around the piece's local
  // bbox center, exact same math as pixelDraw.js's hidden _untransformPoint.
  const bbox = pieceBoundingBox(piece) || { x: 0, y: 0, w: 0, h: 0 }
  const cx = bbox.x + bbox.w / 2
  const cy = bbox.y + bbox.h / 2
  const rad = -rot * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const tx = dx - cx
  const ty = dy - cy
  return {
    x: Math.round(cx + tx * cos - ty * sin),
    y: Math.round(cy + tx * sin + ty * cos),
  }
}

function handlePaint({ pieceId, pixels }) {
  // Broadcast across the multi-selection — same pixel goes into each
  // selected piece. Each piece dedupes independently against its own
  // existing 1x1 rects so dragging back over already-painted cells doesn't
  // accumulate redundant rects per piece.
  const targets = _targetsFor(pieceId)
  snapshot('paint')
  for (const piece of pieces.value) {
    if (!targets.includes(piece.id)) continue
    const existing = new Set(
      piece.rects.filter(r => r.w === 1 && r.h === 1).map(r => `${r.x},${r.y}`)
    )
    for (const px of pixels) {
      const local = _worldToLocal(piece, px.x, px.y)
      const key = `${local.x},${local.y}`
      if (existing.has(key)) continue
      piece.rects.push({ x: local.x, y: local.y, w: 1, h: 1 })
      existing.add(key)
    }
  }
}

function handleErase({ pieceId, pixels }) {
  // Per-pixel subtractive eraser. Each footprint cell becomes a 1×1 erase
  // rect; subtractRect carves it out of every overlapping piece rect (a
  // larger rect that overlaps becomes 1-4 smaller strips, fully-covered
  // rects drop out, non-overlapping rects pass through). This mirrors the
  // pencil's pixel-level semantics — clicking inside a big rect removes
  // ONE block, not the entire rect.
  //
  // Broadcasts across the multi-selection same as the old behavior.
  if (!pixels || pixels.length === 0) return
  const targets = _targetsFor(pieceId)
  snapshot('erase')
  for (const piece of pieces.value) {
    if (!targets.includes(piece.id)) continue
    let next = piece.rects
    for (const px of pixels) {
      const local = _worldToLocal(piece, px.x, px.y)
      const eraseRect = { x: local.x, y: local.y, w: 1, h: 1 }
      next = next.flatMap(r => subtractRect(r, eraseRect))
    }
    piece.rects = next
  }
}

function handleAddRect({ pieceId, rect }) {
  const targets = _targetsFor(pieceId)
  snapshot('add-rect')
  for (const piece of pieces.value) {
    if (!targets.includes(piece.id)) continue
    // Push a fresh copy per piece so subsequent edits to one piece's rect
    // don't accidentally mutate another piece's via shared reference.
    // World → piece-local for the rect's anchor; w/h are size-invariant
    // under translation (and survive 90° rotation since we round to int).
    const local = _worldToLocal(piece, rect.x, rect.y)
    piece.rects.push({ x: local.x, y: local.y, w: rect.w, h: rect.h })
  }
}

// Cut tool: slice every rect in each target piece against the marquee.
// Rects partly inside become up to 4 strips (subtractRect handles the
// geometry); rects fully inside drop out entirely; rects with no overlap
// pass through. Pure rect math — no per-pixel work even for big pieces.
// Broadcasts across a multi-selection so the admin can slice through stacked
// face/eye layers in one stroke.
function handleCutRegion({ pieceId, rect }) {
  const targets = _targetsFor(pieceId)
  snapshot('cut')
  for (const piece of pieces.value) {
    if (!targets.includes(piece.id)) continue
    // World → piece-local for the cut rect's anchor (same reason as
    // handleAddRect). w/h are translation-invariant.
    const local = _worldToLocal(piece, rect.x, rect.y)
    const localRect = { x: local.x, y: local.y, w: rect.w, h: rect.h }
    piece.rects = piece.rects.flatMap(r => subtractRect(r, localRect))
  }
}

function handleSelect({ ids }) {
  // Selection is not a piece-data mutation — no snapshot.
  selectedPieceIds.value = ids
  if (ids.length === 1) {
    activePieceId.value = ids[0]
  }
}

function handleTranslate({ pieceIds, dx, dy }) {
  snapshot('translate')
  for (const piece of pieces.value) {
    if (!pieceIds.includes(piece.id)) continue
    piece.transform = piece.transform || { x: 0, y: 0, rotation: 0 }
    piece.transform.x += dx
    piece.transform.y += dy
  }
}

// ----- pieces panel handlers -----
function activatePiece(id) {
  activePieceId.value = id
  if (!selectedPieceIds.value.includes(id)) {
    selectedPieceIds.value = [id]
  }
}

// Returns the set of piece ids a panel-row action should hit: just the
// clicked id by default, or every selected id when the clicked piece is
// part of a multi-selection (>1). Lets a single eye/opacity/color/trash
// click on any row in the committed selection broadcast to all of them.
function _targetsFor(id) {
  if (selectedPieceIds.value.length > 1 && selectedPieceIds.value.includes(id)) {
    return selectedPieceIds.value
  }
  return [id]
}

function togglePieceVisible(id) {
  // Visibility is a viewing aid — doesn't change the saved SVG, so we
  // intentionally don't snapshot it. The undo button stays focused on
  // changes that would actually persist.
  const targets = _targetsFor(id)
  // Standardize all targets to the OPPOSITE of the clicked piece's current
  // state. Toggling each independently would leave them out of sync after
  // one click on a mixed-visibility batch.
  const clicked = pieces.value.find(p => p.id === id)
  if (!clicked) return
  const next = !clicked.visible
  for (const piece of pieces.value) {
    if (targets.includes(piece.id)) piece.visible = next
  }
}

// Set the editor-only opacity overlay for a piece (value already 0..1 from
// the input, clamped on the panel side). Like visibility, this is a viewing
// aid and never persists to the saved SVG, so no snapshot/undo entry.
function setPieceOpacity({ pieceId, opacity }) {
  const targets = _targetsFor(pieceId)
  const next = { ...pieceOpacities.value }
  for (const id of targets) next[id] = opacity
  pieceOpacities.value = next
}

function reorderPieces({ fromIndex, toIndex }) {
  if (fromIndex === toIndex) return
  snapshot('reorder')
  const [moved] = pieces.value.splice(fromIndex, 1)
  pieces.value.splice(toIndex, 0, moved)
}

function deletePiece(id) {
  const targets = new Set(_targetsFor(id))
  if (targets.size === 0) return
  snapshot('delete')
  pieces.value = pieces.value.filter(p => !targets.has(p.id))
  if (targets.has(activePieceId.value)) {
    activePieceId.value = pieces.value[0]?.id ?? null
  }
  selectedPieceIds.value = selectedPieceIds.value.filter(x => !targets.has(x))
}

// Commit a multi-selection built in the pieces panel's checkbox mode. The
// active piece resets to the first checked piece so canvas tools have a
// sensible target (drawing tools mutate the ACTIVE piece, not the whole
// selection).
function selectMultiplePieces({ ids }) {
  selectedPieceIds.value = [...ids]
  if (ids.length > 0 && !ids.includes(activePieceId.value)) {
    activePieceId.value = ids[0]
  }
}

// Drop the committed multi-selection. We keep `activePieceId` pointing at
// whatever it was so drawing tools still have a target — only the selection
// outline / broadcast scope is cleared.
function deselectAllPieces() {
  selectedPieceIds.value = activePieceId.value ? [activePieceId.value] : []
}

function renamePiece({ pieceId, label }) {
  const piece = pieces.value.find(p => p.id === pieceId)
  if (!piece || !label || piece.label === label) return
  // Tag the snapshot with the piece id so consecutive renames of the SAME
  // piece collapse into one undo step (the input fires blur+enter which
  // could otherwise stack), while renaming a different piece next snapshots
  // fresh.
  snapshot(`rename:${pieceId}`)
  piece.label = label
}

function requestAddPiece() {
  colorPickerTarget.value = 'new'
  colorPickerOpen.value = true
}

function requestEditColor(pieceId) {
  colorPickerTarget.value = pieceId
  colorPickerOpen.value = true
}

const colorPickerInitial = computed(() => {
  // Eyedropper short-circuit: when set, open in Custom mode with the
  // picked hex pre-filled, regardless of the target piece's existing color.
  if (pendingEyedropHex.value) {
    return { mode: 'literal', token: '', hex: pendingEyedropHex.value, label: '', opacity: null }
  }
  if (colorPickerTarget.value === 'new' || !colorPickerTarget.value) {
    return { mode: 'token', token: '', hex: '#a855f7', label: '', opacity: null }
  }
  const piece = pieces.value.find(p => p.id === colorPickerTarget.value)
  if (!piece) return { mode: 'token', token: '', hex: '#a855f7', label: '', opacity: null }
  return {
    mode: piece.colorMode,
    token: piece.colorToken || '',
    hex: piece.colorHex || '#a855f7',
    label: piece.label || '',
    opacity: piece.colorOpacity ?? null,
  }
})

function handleColorConfirm(result) {
  if (colorPickerTarget.value === 'new') {
    snapshot('add-piece')
    const existingIds = pieces.value.map(p => p.id)
    const id = generatePieceId(result.label || result.colorToken || 'piece', existingIds)
    const newPiece = {
      id,
      label: result.label || defaultLabelForToken(result.colorToken) || 'Piece',
      colorMode: result.colorMode,
      colorToken: result.colorToken,
      colorHex: result.colorHex,
      colorOpacity: result.colorOpacity ?? null,
      transform: { x: 0, y: 0, rotation: 0 },
      rects: [],
      visible: true,
    }
    pieces.value.push(newPiece)
    activePieceId.value = newPiece.id
    selectedPieceIds.value = [newPiece.id]
  } else {
    // Broadcast to the multi-selection when the edited piece is part of it.
    // Tag snapshot with the *target list* so two consecutive color edits on
    // different selections still collapse correctly per-batch.
    const targets = _targetsFor(colorPickerTarget.value)
    snapshot(`color:${targets.join(',')}`)
    for (const piece of pieces.value) {
      if (!targets.includes(piece.id)) continue
      piece.colorMode = result.colorMode
      piece.colorToken = result.colorToken
      piece.colorHex = result.colorHex
      piece.colorOpacity = result.colorOpacity ?? null
      if (result.label) piece.label = result.label
    }
  }
  _recordRecent(result)
  colorPickerOpen.value = false
  colorPickerTarget.value = null
  pendingEyedropHex.value = null
}

// Convert a color-picker result into an MRU entry and persist. The hex stored
// is whichever the picker resolved — for token entries it's a display
// snapshot; the token field stays authoritative when the entry is re-applied.
function _recordRecent(result) {
  const hex = result.colorMode === 'token'
    ? resolvePieceColor({ colorMode: 'token', colorToken: result.colorToken }, props.config)
    : result.colorHex
  if (!hex) return
  recentColors.value = pushRecentColor(authStore.user?.id, {
    mode: result.colorMode,
    token: result.colorToken || undefined,
    hex,
    label: result.label || (result.colorToken ? defaultLabelForToken(result.colorToken) : null) || null,
  })
}

// ----- header swatch -----

const activePiece = computed(() => pieces.value.find(p => p.id === activePieceId.value) ?? null)
const currentColorHex = computed(() => resolvePieceColor(activePiece.value, props.config))

function openColorForCurrent() {
  if (!activePieceId.value) {
    toastStore.showError('Select a piece first.')
    return
  }
  requestEditColor(activePieceId.value)
}

function applyRecentColor(entry) {
  if (!activePieceId.value) {
    toastStore.showError('Select a piece first.')
    return
  }
  const targets = _targetsFor(activePieceId.value)
  snapshot(`color:${targets.join(',')}`)
  for (const piece of pieces.value) {
    if (!targets.includes(piece.id)) continue
    if (entry.mode === 'token') {
      piece.colorMode = 'token'
      piece.colorToken = entry.token
      piece.colorHex = null
      if (entry.label) piece.label = entry.label
    } else {
      piece.colorMode = 'literal'
      piece.colorToken = null
      piece.colorHex = entry.hex
      if (entry.label) piece.label = entry.label
    }
  }
  // Move this entry back to the front of the recents stack so repeated
  // re-applies stay at the top.
  recentColors.value = pushRecentColor(authStore.user?.id, entry)
}

// ----- duplicate selection -----
// Clone the current selection into the same variant as fresh pieces. The
// new pieces inherit the source's color + rect data verbatim and get new
// ids; selection moves to them so the admin can immediately drag the
// clones off the originals with the Select tool.
function _clonePiece(piece, existingIds) {
  const id = generatePieceId(piece.label || piece.colorToken || 'piece', existingIds)
  existingIds.push(id)
  // Nudge the clone a couple pixels off the source's transform so it
  // doesn't sit perfectly on top of the original. Same-color pieces stacked
  // pixel-for-pixel were producing a confusing "the eraser doesn't work"
  // symptom — every erased pixel on the top piece was just revealing the
  // identical pixel underneath. The 2-pixel offset matches the convention
  // Figma/Photoshop use for duplicates: visible as a separate object,
  // trivial to drag back into precise alignment if that's what the admin
  // wanted. Clamped so the offset can't push the entire piece off the
  // 64-grid in either axis.
  const DUP_OFFSET = 2
  const src = piece.transform || { x: 0, y: 0, rotation: 0 }
  const bbox = pieceBoundingBox(piece) || { x: 0, y: 0, w: 0, h: 0 }
  const maxDx = Math.max(0, 63 - ((src.x || 0) + bbox.x + bbox.w - 1))
  const maxDy = Math.max(0, 63 - ((src.y || 0) + bbox.y + bbox.h - 1))
  return {
    id,
    label: piece.label,
    colorMode: piece.colorMode,
    colorToken: piece.colorToken,
    colorHex: piece.colorHex,
    transform: {
      x: (src.x || 0) + Math.min(DUP_OFFSET, maxDx),
      y: (src.y || 0) + Math.min(DUP_OFFSET, maxDy),
      rotation: src.rotation || 0,
    },
    rects: (piece.rects || []).map(r => ({ ...r })),
    visible: true,
  }
}

function duplicateSelection() {
  // Effective source: explicit multi-select, or the active piece when
  // nothing's checked.
  const ids = selectedPieceIds.value.length > 0
    ? selectedPieceIds.value
    : (activePieceId.value ? [activePieceId.value] : [])
  const sourcePieces = pieces.value.filter(p => ids.includes(p.id))
  if (sourcePieces.length === 0) {
    toastStore.showError('Select pieces to duplicate first.')
    return
  }
  snapshot('duplicate')
  const existingIds = pieces.value.map(p => p.id)
  const cloned = sourcePieces.map(p => _clonePiece(p, existingIds))
  pieces.value.push(...cloned)
  selectedPieceIds.value = cloned.map(p => p.id)
  activePieceId.value = cloned[0]?.id ?? activePieceId.value
}

// ----- flip selection -----
// Mirror the selected pieces' rects about the centerline of the selection's
// combined bbox. Operates on rects directly (transform.x/y are left alone)
// so the flip is a pure pixel-level mirror — same convention as scale.
function _flipSelection(axis) {
  const ids = selectedPieceIds.value.length > 0
    ? selectedPieceIds.value
    : (activePieceId.value ? [activePieceId.value] : [])
  const targetPieces = pieces.value.filter(p => ids.includes(p.id))
  if (targetPieces.length === 0) {
    toastStore.showError('Select pieces to flip first.')
    return
  }
  // Combined bbox of all selected pieces' raw rects.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of targetPieces) {
    for (const r of p.rects) {
      if (r.x < minX) minX = r.x
      if (r.y < minY) minY = r.y
      if (r.x + r.w > maxX) maxX = r.x + r.w
      if (r.y + r.h > maxY) maxY = r.y + r.h
    }
  }
  if (!isFinite(minX)) return  // no rects at all
  snapshot(`flip:${axis}`)
  for (const piece of pieces.value) {
    if (!ids.includes(piece.id)) continue
    piece.rects = piece.rects.map(r => axis === 'h'
      // Horizontal: reflect x across bbox vertical center. New x = (minX + maxX) - (r.x + r.w).
      ? { x: minX + maxX - (r.x + r.w), y: r.y, w: r.w, h: r.h }
      // Vertical: reflect y across bbox horizontal center.
      : { x: r.x, y: minY + maxY - (r.y + r.h), w: r.w, h: r.h }
    )
  }
}

function flipSelectionHorizontal() { _flipSelection('h') }
function flipSelectionVertical()   { _flipSelection('v') }

// ----- toolbar actions -----

// Interactive rotate (drag a handle above the active piece). The canvas
// emits one event per snapped 90° transition during the drag; we just
// assign + snapshot. Snapshot type-grouping ('rotate') collapses a whole
// drag into one undo step.
function handleRotateUpdate({ pieceId, rotation }) {
  const piece = pieces.value.find(p => p.id === pieceId)
  if (!piece) return
  snapshot('rotate')
  piece.transform = piece.transform || { x: 0, y: 0, rotation: 0 }
  // Store the raw float angle so free rotation persists exactly. The canvas
  // already snapped to 90° if the admin was holding Shift; otherwise this
  // is whatever continuous angle they dragged to.
  piece.transform.rotation = rotation
}

// Interactive scale (drag a corner handle on the active piece). The canvas
// emits one event per pointermove with the recomputed rects array; we just
// assign + snapshot. Snapshot type-grouping (`scale`) collapses a whole
// drag into one undo step.
function handleScaleUpdate({ pieceId, rects }) {
  const piece = pieces.value.find(p => p.id === pieceId)
  if (!piece) return
  snapshot('scale')
  piece.rects = rects
}

// ----- save / exit -----
// `thenExit` controls whether a successful save also exits the editor.
//   - false → Save (stay): just persists; admin keeps editing.
//   - true  → Save & Exit: persists and returns to the catalog (the
//             original behaviour).
async function handleSave(thenExit = false) {
  if (!isDirty.value || saving.value) return
  // Save is a meaningful confirmation — affirmation on success replaces the
  // generic click tap that the global listener would otherwise play.
  audioStore.suppressClickSound()
  saving.value = true
  try {
    const svg = serializeVariantPieces(pieces.value)
    const serverTier = props.tier === 'paid' ? 'upgraded' : 'generic'
    await api.post('/api/admin/headshot-layers/save', {
      layer: props.layerId,
      variant: props.variantName,
      tier: serverTier,
      audience: props.audience,
      content: svg,
    })
    // Patch the composer's in-memory variant library so the catalog view's
    // variant strip renders the new content immediately on remount. Without
    // this it would keep showing the stale pre-save SVG until a full reload.
    // Pass audience so the patch lands in the right per-audience map.
    updateLayerVariantContent(props.layerId, props.variantName, svg, props.audience)

    audioStore.affirm()
    toastStore.showSuccess('Variant saved.')
    isDirty.value = false
    // Tell the parent a save just happened so it can force the catalog
    // view's variant strip to fully remount — guarantees the freshly-saved
    // thumb re-renders even if Vue reactivity around the composer's
    // in-memory map gets out-of-sync.
    emit('saved', { layerId: props.layerId, variantName: props.variantName })
    if (thenExit) emit('exit')
  } catch (err) {
    const status = err?.response?.status
    if (status === 503) {
      toastStore.showError('Save endpoint disabled (set FRONTEND_ASSETS_PATH in dev).')
    } else if (status === 403) {
      toastStore.showError('Not authorized.')
    } else if (status === 422) {
      toastStore.showError(err?.response?.data?.detail || 'Invalid SVG.')
    } else {
      toastStore.showError(err?.response?.data?.error || 'Save failed.')
    }
  } finally {
    saving.value = false
  }
}

function handleExitClick() {
  if (isDirty.value && !saving.value) {
    showExitConfirm.value = true
    return
  }
  emit('exit')
}

function discardAndExit() {
  showExitConfirm.value = false
  emit('exit')
}

function saveAndExit() {
  showExitConfirm.value = false
  handleSave(true)
}

// ----- rename variant -----

const showRenameModal = ref(false)
const renameBuffer = ref('')
const renameError = ref('')
const renaming = ref(false)

function requestRename() {
  renameBuffer.value = props.variantName
  renameError.value = ''
  showRenameModal.value = true
}

function _validateNewName(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'Name is required'
  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    return 'Use lowercase letters, numbers, and hyphens only'
  }
  return ''
}

async function confirmRename() {
  if (renaming.value) return
  const next = renameBuffer.value.trim()
  const err = _validateNewName(next)
  if (err) { renameError.value = err; return }
  if (next === props.variantName) {
    showRenameModal.value = false
    return
  }
  renameError.value = ''

  // New (unsaved) variants live only in memory — no disk file to rename yet.
  // Just hand the new name up to the parent and let the next Save use it.
  if (props.isNew) {
    showRenameModal.value = false
    emit('renamed', next)
    return
  }

  renaming.value = true
  try {
    await api.post('/api/admin/headshot-layers/rename', {
      layer: props.layerId,
      variant: props.variantName,
      newName: next,
      audience: props.audience,
    })
    renameLayerVariantContent(props.layerId, props.variantName, next, props.audience)
    // Move the editor working-state snapshot to the new variant name so
    // the admin's tool/zoom/selection setup carries over.
    try {
      const oldKey = _editorStorageKey()
      const snapshot = localStorage.getItem(oldKey)
      if (snapshot) {
        const userId = authStore.user?.id ?? 'anon'
        localStorage.setItem(`${EDITOR_STATE_PREFIX}.${userId}.${props.layerId}.${next}`, snapshot)
        localStorage.removeItem(oldKey)
      }
    } catch { /* ignore */ }
    toastStore.showSuccess('Variant renamed.')
    showRenameModal.value = false
    emit('renamed', next)
  } catch (err) {
    const status = err?.response?.status
    if (status === 503) {
      renameError.value = 'Rename endpoint disabled (set FRONTEND_ASSETS_PATH in dev).'
    } else if (status === 403) {
      renameError.value = 'Not authorized.'
    } else if (status === 404) {
      renameError.value = 'Variant file not found on disk.'
    } else if (status === 409) {
      renameError.value = `A variant named "${next}" already exists.`
    } else if (status === 422) {
      renameError.value = err?.response?.data?.detail || 'Invalid name.'
    } else {
      renameError.value = err?.response?.data?.error || 'Rename failed.'
    }
  } finally {
    renaming.value = false
  }
}

// ----- delete variant -----

function requestDelete() {
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  if (deleting.value) return
  deleting.value = true
  try {
    await api.post('/api/admin/headshot-layers/delete', {
      layer: props.layerId,
      variant: props.variantName,
      audience: props.audience,
    })
    removeLayerVariantContent(props.layerId, props.variantName, props.audience)
    // Discard the editor working-state snapshot — the variant doesn't exist
    // anymore so the saved tool/selection/etc. for it is meaningless.
    try { localStorage.removeItem(_editorStorageKey()) } catch { /* ignore */ }
    toastStore.showSuccess('Variant deleted.')
    showDeleteConfirm.value = false
    // Skip the unsaved-changes prompt — we just nuked the file, any unsaved
    // edits are moot.
    isDirty.value = false
    emit('exit')
  } catch (err) {
    const status = err?.response?.status
    if (status === 503) {
      toastStore.showError('Delete endpoint disabled (set FRONTEND_ASSETS_PATH in dev).')
    } else if (status === 403) {
      toastStore.showError('Not authorized.')
    } else if (status === 404) {
      toastStore.showError('Variant file not found on disk.')
    } else {
      toastStore.showError(err?.response?.data?.error || 'Delete failed.')
    }
  } finally {
    deleting.value = false
  }
}

const headerTitle = computed(() =>
  `${props.layerId} / ${props.variantName}${props.isNew ? ' (new)' : ''}`
)
</script>

<template>
  <div class="ave">
    <header class="ave-header">
      <button class="ave-btn" @click="handleExitClick">
        <ArrowLeft :size="16" /> <span>Stop Editing</span>
      </button>
      <h2 class="ave-title">{{ headerTitle }}</h2>
      <div class="ave-right-actions">
        <button
          class="ave-btn"
          :disabled="renaming"
          title="Rename this variant"
          @click="requestRename"
        >
          <Edit3 :size="16" /> <span>Rename</span>
        </button>
        <button
          v-if="!isNew"
          class="ave-btn danger"
          :disabled="deleting"
          title="Delete this variant permanently"
          @click="requestDelete"
        >
          <Trash2 :size="16" /> <span>Delete</span>
        </button>
        <button
          class="ave-btn"
          :disabled="!undoSnapshot"
          :title="undoSnapshot ? 'Undo last change' : 'Nothing to undo'"
          @click="undo"
        >
          <Undo2 :size="16" /> <span>Undo</span>
        </button>
        <button
          class="ave-btn save"
          :disabled="!isDirty || saving"
          title="Save and keep editing"
          @click="handleSave(false)"
        >
          <Save :size="16" /> <span>{{ saving ? 'Saving…' : 'Save' }}</span>
        </button>
        <button
          class="ave-btn save"
          :disabled="!isDirty || saving"
          title="Save and return to the variants catalog"
          @click="handleSave(true)"
        >
          <Save :size="16" /> <span>Save &amp; Exit</span>
        </button>
      </div>
    </header>

    <div class="ave-main">
      <AdminToolsPanel
        :active-tool="activeTool"
        :brush-size="brushSize"
        :shape-type="shapeType"
        :current-color-hex="currentColorHex"
        :recent-colors="recentColors"
        :no-piece-active="!activePieceId"
        @update:active-tool="(t) => activeTool = t"
        @update:brush-size="(s) => brushSize = s"
        @update:shape-type="(s) => shapeType = s"
        @duplicate="duplicateSelection"
        @flip-horizontal="flipSelectionHorizontal"
        @flip-vertical="flipSelectionVertical"
        @open-color="openColorForCurrent"
        @apply-recent-color="applyRecentColor"
      />

      <section class="ave-canvas-wrap">
        <div class="ave-canvas-scroll">
          <AdminPixelCanvas
            :layer-id="layerId"
            :audience="audience"
            :pieces="pieces"
            :config="effectiveConfig"
            :active-piece-id="activePieceId"
            :selected-piece-ids="selectedPieceIds"
            :active-tool="activeTool"
            :brush-size="brushSize"
            :piece-opacities="pieceOpacities"
            :size="500"
            :zoom="zoom"
            :isolate-layer="isolateLayer"
            :backdrop-opacity="backdropOpacity"
            :shape-type="shapeType"
            :reference-image="refImage"
            :reference-visible="refVisible"
            :reference-opacity="refOpacity"
            :reference-scale="refScale"
            :reference-offset-x="refOffsetX"
            :reference-offset-y="refOffsetY"
            @paint="handlePaint"
            @erase="handleErase"
            @add-rect="handleAddRect"
            @cut-region="handleCutRegion"
            @scale-update="handleScaleUpdate"
            @rotate-update="handleRotateUpdate"
            @select-pieces="handleSelect"
            @translate="handleTranslate"
            @reference-translate="handleReferenceTranslate"
            @stroke-end="handleStrokeEnd"
          />
        </div>
        <!-- Zoom controls overlay — anchored to the wrap, NOT the canvas, so
             they stay visible even when the zoomed canvas is scrolled. -->
        <div class="ave-zoom-controls">
          <button class="ave-zoom-btn" :disabled="zoom <= ZOOM_LEVELS[0]" title="Zoom out" @click="zoomOut">
            <ZoomOut :size="14" />
          </button>
          <button class="ave-zoom-btn pct" title="Reset to 100%" @click="resetZoom">
            {{ zoomPercent }}%
          </button>
          <button class="ave-zoom-btn" :disabled="zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]" title="Zoom in" @click="zoomIn">
            <ZoomIn :size="14" />
          </button>
          <button class="ave-zoom-btn" title="Fit to 100%" @click="resetZoom">
            <Maximize :size="14" />
          </button>
        </div>

        <!-- Backdrop variant picker — top-left of the canvas. Opens an
             inline panel with per-layer variant dropdowns so the admin can
             try the in-progress edit against different surrounding
             variants (e.g. fix a hair that gaps over wide jaws). -->
        <div class="ave-backdrop-controls">
          <button
            class="ave-zoom-btn"
            :class="{ active: backdropMenuOpen }"
            :title="backdropMenuOpen ? 'Close backdrop variants' : 'Swap variants of other layers'"
            @click="toggleBackdropMenu"
          >
            <Layers :size="14" />
            <span class="ave-backdrop-label">Backdrop</span>
          </button>
          <div v-if="backdropMenuOpen" class="ave-backdrop-panel">
            <header class="ave-backdrop-header">
              <span>Backdrop Variants</span>
              <button class="ave-backdrop-close" @click="closeBackdropMenu">
                <X :size="12" />
              </button>
            </header>
            <p class="ave-backdrop-hint">
              Try this edit against different choices for the surrounding
              layers. Doesn't change anything saved — view only.
            </p>

            <!-- Overall backdrop opacity. Dims every non-active layer as
                 a group so the in-progress edit pops without losing the
                 surrounding context entirely. 100% = full opacity; 0% =
                 same effect as the Isolate toggle. -->
            <div class="ave-backdrop-opacity-row">
              <label>Opacity</label>
              <input
                v-model.number="backdropOpacityPercent"
                type="range"
                min="0"
                max="100"
                step="1"
                :disabled="isolateLayer"
              />
              <span class="ave-backdrop-readout">{{ backdropOpacityPercent }}%</span>
            </div>

            <!-- Isolate overrides the opacity slider with display:none on
                 every non-active layer, so a 100% slider can look like a
                 bug ("backdrops gone but opacity is full"). Surface it
                 with a one-click toggle-off so the user can recover. -->
            <div v-if="isolateLayer" class="ave-isolate-warning">
              <strong>Isolate is on</strong>
              <span>
                The Isolate toggle (bottom-left of the canvas) is hiding
                every non-active layer. The opacity slider can't override
                it.
              </span>
              <button class="ave-isolate-fix" @click="isolateLayer = false">
                Turn off Isolate
              </button>
            </div>

            <div
              v-for="layer in backdropLayers"
              :key="layer.id"
              class="ave-backdrop-row"
            >
              <label>{{ layer.label }}</label>
              <select
                :value="backdropValueFor(layer)"
                @change="setBackdropValue(layer, variantOptionsFor(layer).find(o => String(o.value) === $event.target.value)?.value)"
              >
                <option
                  v-for="opt in variantOptionsFor(layer)"
                  :key="String(opt.value)"
                  :value="opt.value"
                >{{ opt.label }}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Reference image controls — bottom-right of the canvas. Click
             the pill to open a panel with upload + visibility + opacity +
             scale + eyedropper + remove. Reference is in-memory only;
             nothing here persists to disk. -->
        <div class="ave-reference-controls">
          <button
            class="ave-zoom-btn"
            :class="{ active: refPanelOpen || !!refImage }"
            :title="refImage ? 'Reference image — click to edit' : 'Add reference image'"
            @click="refPanelOpen ? closeReferencePanel() : openReferencePanel()"
          >
            <ImageIcon :size="14" />
            <span class="ave-backdrop-label">Reference</span>
          </button>
          <div v-if="refPanelOpen" class="ave-reference-panel">
            <header class="ave-backdrop-header">
              <span>Reference Image</span>
              <button class="ave-backdrop-close" @click="closeReferencePanel">
                <X :size="12" />
              </button>
            </header>
            <p class="ave-backdrop-hint ave-reference-note">
              Temporary — won't be saved or synced. Cleared when you exit
              the editor.
            </p>

            <input
              ref="refFileInputRef"
              type="file"
              accept="image/*"
              class="ave-reference-file-input"
              @change="handleReferenceFile"
            />

            <button
              v-if="!refImage"
              class="ave-reference-upload"
              @click="triggerReferenceUpload"
            >
              <ImageIcon :size="14" /> <span>Upload image…</span>
            </button>

            <template v-else>
              <div class="ave-reference-row">
                <button
                  class="ave-reference-icon-btn"
                  :class="{ active: refVisible }"
                  :title="refVisible ? 'Hide reference' : 'Show reference'"
                  @click="toggleReferenceVisible"
                >
                  <component :is="refVisible ? Eye : EyeOff" :size="14" />
                </button>
                <button
                  class="ave-reference-icon-btn"
                  :class="{ active: activeTool === 'ref-move' }"
                  :title="activeTool === 'ref-move' ? 'Exit move mode' : 'Click & drag the image to reposition'"
                  @click="toggleReferenceMove"
                >
                  <Move :size="14" />
                </button>
                <button
                  class="ave-reference-icon-btn"
                  title="Pick a color from the screen (eyedropper)"
                  @click="pickColorFromReference"
                >
                  <Pipette :size="14" />
                </button>
                <button
                  class="ave-reference-icon-btn"
                  title="Center the image (reset translation)"
                  @click="centerReference"
                >
                  <Crosshair :size="14" />
                </button>
                <button
                  class="ave-reference-icon-btn"
                  title="Replace image"
                  @click="triggerReferenceUpload"
                >
                  <ImageIcon :size="14" />
                </button>
                <button
                  class="ave-reference-icon-btn danger"
                  title="Remove reference image"
                  @click="clearReference"
                >
                  <Trash2 :size="14" />
                </button>
              </div>

              <div class="ave-reference-slider-row">
                <label>Opacity</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  :value="Math.round(refOpacity * 100)"
                  @input="refOpacity = Number($event.target.value) / 100"
                />
                <span class="ave-reference-readout">{{ Math.round(refOpacity * 100) }}%</span>
              </div>

              <div class="ave-reference-slider-row">
                <label>Scale</label>
                <input
                  type="range"
                  min="25"
                  max="400"
                  step="5"
                  :value="Math.round(refScale * 100)"
                  @input="refScale = Number($event.target.value) / 100"
                />
                <span class="ave-reference-readout">{{ Math.round(refScale * 100) }}%</span>
              </div>

            </template>
          </div>
        </div>

        <!-- Isolate-layer toggle — bottom-left of the canvas. Hides the rest
             of the composed headshot so the admin sees only the variant they
             are editing. Mirrors the zoom-controls pill styling. -->
        <div class="ave-isolate-controls">
          <button
            class="ave-zoom-btn"
            :class="{ active: isolateLayer }"
            :title="isolateLayer ? 'Show full headshot' : 'Hide everything except this variant'"
            @click="isolateLayer = !isolateLayer"
          >
            <Focus :size="14" />
            <span class="ave-isolate-label">{{ isolateLayer ? 'Isolated' : 'Isolate' }}</span>
          </button>
        </div>
      </section>

      <AdminPiecesPanel
        :pieces="pieces"
        :active-id="activePieceId"
        :selected-ids="selectedPieceIds"
        :opacities="pieceOpacities"
        :config="config"
        @activate="activatePiece"
        @toggle-visible="togglePieceVisible"
        @set-opacity="setPieceOpacity"
        @reorder="reorderPieces"
        @delete="deletePiece"
        @add="requestAddPiece"
        @edit-color="requestEditColor"
        @rename="renamePiece"
        @select-multi="selectMultiplePieces"
        @deselect-all="deselectAllPieces"
      />
    </div>

    <AdminColorPicker
      :show="colorPickerOpen"
      :initial-mode="colorPickerInitial.mode"
      :initial-token="colorPickerInitial.token"
      :initial-hex="colorPickerInitial.hex"
      :initial-label="colorPickerInitial.label"
      :initial-opacity="colorPickerInitial.opacity"
      :config="config"
      :recents="recentColors"
      @close="colorPickerOpen = false; colorPickerTarget = null; pendingEyedropHex = null"
      @confirm="handleColorConfirm"
    />

    <BaseModal :show="showExitConfirm" title="Unsaved Changes" size="xs" @close="showExitConfirm = false">
      <div class="exit-modal-body">
        <div class="warn-icon"><AlertTriangle :size="28" /></div>
        <p>You have unsaved changes. What would you like to do?</p>
      </div>
      <template #footer>
        <div class="exit-modal-actions">
          <button class="ave-btn" @click="showExitConfirm = false">Keep editing</button>
          <button class="ave-btn danger" @click="discardAndExit">Discard</button>
          <button class="ave-btn primary" :disabled="saving" @click="saveAndExit">
            {{ saving ? 'Saving…' : 'Save & Exit' }}
          </button>
        </div>
      </template>
    </BaseModal>

    <BaseModal :show="showRenameModal" title="Rename Variant" size="sm" @close="showRenameModal = false">
      <div class="rename-modal-body">
        <label class="rename-label">
          New name
          <input
            v-model="renameBuffer"
            type="text"
            class="rename-input"
            maxlength="40"
            placeholder="lowercase-hyphenated"
            autocapitalize="none"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            :disabled="renaming"
            @input="renameBuffer = renameBuffer.toLowerCase()"
            @keydown.enter.prevent="confirmRename"
          />
        </label>
        <p v-if="renameError" class="rename-error">{{ renameError }}</p>
        <p v-else class="rename-hint">
          Lowercase letters, numbers, and hyphens only. The file on disk will be
          renamed in place; existing campaigns continue to reference the variant
          by file path so this is safe to run mid-edit.
        </p>
      </div>
      <template #footer>
        <div class="exit-modal-actions">
          <button class="ave-btn" :disabled="renaming" @click="showRenameModal = false">
            Cancel
          </button>
          <button class="ave-btn primary" :disabled="renaming" @click="confirmRename">
            {{ renaming ? 'Renaming…' : 'Rename' }}
          </button>
        </div>
      </template>
    </BaseModal>

    <BaseModal :show="showDeleteConfirm" title="Delete Variant?" size="sm" @close="showDeleteConfirm = false">
      <div class="exit-modal-body">
        <div class="warn-icon danger"><AlertTriangle :size="28" /></div>
        <p>
          <strong>{{ layerId }} / {{ variantName }}</strong> will be permanently
          deleted from disk.
        </p>
        <p class="ave-delete-hint">
          This affects new campaigns going forward — existing players that already
          had this variant assigned will fall back to the default once the
          procedural pool regenerates.
        </p>
      </div>
      <template #footer>
        <div class="exit-modal-actions">
          <button class="ave-btn" :disabled="deleting" @click="showDeleteConfirm = false">
            Cancel
          </button>
          <button class="ave-btn danger" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? 'Deleting…' : 'Delete forever' }}
          </button>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.ave {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.ave-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
}

.ave-right-actions {
  display: flex;
  gap: 8px;
}

.ave-title {
  margin: 0;
  text-align: center;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-transform: lowercase;
  letter-spacing: 0.02em;
}

.ave-btn {
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

.ave-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ave-btn.save:not(:disabled),
.ave-btn.primary {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border-color: transparent;
  color: white;
}

.ave-btn.danger {
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.4);
}

.ave-main {
  display: grid;
  grid-template-columns: auto 1fr auto;
  /* Bound the row to available height. Without an explicit `grid-template-rows`
     the row defaults to `auto` and sizes to its tallest child — so a zoomed-in
     canvas would push the whole editor taller. `minmax(0, 1fr)` lets the
     canvas-wrap shrink past its content height so the inner scroll container
     can actually clip. */
  grid-template-rows: minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.ave-canvas-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-width: 0;
  min-height: 0;
}

/* Inner scroll container — lets the canvas grow past the visible area when
   zoomed in without breaking the editor layout. Centers the canvas when it
   fits, scrolls when it doesn't. `safe center` falls back to start
   alignment when the canvas overflows, which keeps the left/top edges
   reachable (regular `center` strands them off-screen). */
.ave-canvas-scroll {
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  display: flex;
  align-items: safe center;
  justify-content: safe center;
}

.ave-zoom-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 1px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  padding: 2px;
  backdrop-filter: blur(8px);
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.ave-zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  padding: 0 6px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  border-radius: var(--radius-full);
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.ave-zoom-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.ave-zoom-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ave-zoom-btn.pct {
  min-width: 44px;
}

.ave-zoom-btn.active {
  background: rgba(168, 85, 247, 0.22);
  color: var(--color-text-primary);
}

.ave-isolate-controls {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  padding: 2px;
  backdrop-filter: blur(8px);
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.ave-backdrop-controls {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  z-index: 11;
}

.ave-backdrop-controls .ave-zoom-btn {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  padding: 4px 10px;
  height: 26px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(8px);
}

.ave-backdrop-label {
  margin-left: 4px;
}

.ave-backdrop-panel {
  width: 220px;
  background: rgba(20, 20, 28, 0.97);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 10px 12px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

[data-theme="light"] .ave-backdrop-panel {
  background: rgba(255, 255, 255, 0.97);
}

.ave-backdrop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  margin-bottom: 2px;
}

.ave-backdrop-close {
  background: transparent;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  padding: 2px;
}

.ave-backdrop-close:hover {
  color: var(--color-text-primary);
}

.ave-backdrop-hint {
  margin: 0 0 6px;
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.ave-backdrop-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.ave-backdrop-row select {
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

.ave-backdrop-row select:focus {
  outline: none;
  border-color: rgba(168, 85, 247, 0.6);
}

.ave-backdrop-opacity-row {
  display: grid;
  grid-template-columns: 64px 1fr 40px;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--glass-border);
}

.ave-backdrop-opacity-row input[type="range"] {
  width: 100%;
  accent-color: #a855f7;
  cursor: pointer;
}

.ave-backdrop-opacity-row input[type="range"]:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ave-backdrop-readout {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  font-weight: 600;
}

/* Isolate-active warning — shows in the backdrop panel when the user has
   the isolate toggle on. Helps explain why backdrops are gone even though
   the opacity slider reads 100%. */
.ave-isolate-warning {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(251, 191, 36, 0.12);
  border: 1px solid rgba(251, 191, 36, 0.4);
  border-radius: var(--radius-lg);
  font-size: 0.72rem;
  color: #fbbf24;
  margin-bottom: 6px;
}

.ave-isolate-warning strong {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.65rem;
}

.ave-isolate-warning span {
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.ave-isolate-fix {
  align-self: flex-start;
  padding: 4px 10px;
  background: rgba(251, 191, 36, 0.22);
  border: 1px solid rgba(251, 191, 36, 0.5);
  color: #fbbf24;
  border-radius: var(--radius-full);
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
}

.ave-isolate-fix:hover {
  background: rgba(251, 191, 36, 0.32);
}

/* Reference image controls — bottom-right corner pill + popover panel.
   Mirrors the backdrop controls' layout (top-left) but anchored opposite. */
.ave-reference-controls {
  position: absolute;
  bottom: 12px;
  right: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  z-index: 11;
}

.ave-reference-controls .ave-zoom-btn {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  padding: 4px 10px;
  height: 26px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(8px);
}

.ave-reference-panel {
  width: 260px;
  background: rgba(20, 20, 28, 0.97);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 10px 12px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

[data-theme="light"] .ave-reference-panel {
  background: rgba(255, 255, 255, 0.97);
}

.ave-reference-note {
  margin-bottom: 4px;
}

.ave-reference-file-input {
  display: none;
}

.ave-reference-upload {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(168, 85, 247, 0.18);
  border: 1px dashed rgba(168, 85, 247, 0.5);
  color: var(--color-text-primary);
  border-radius: var(--radius-lg);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.ave-reference-upload:hover {
  background: rgba(168, 85, 247, 0.28);
}

.ave-reference-row {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: space-between;
}

.ave-reference-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-lg);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.ave-reference-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.ave-reference-icon-btn.active {
  background: rgba(168, 85, 247, 0.22);
  border-color: rgba(168, 85, 247, 0.5);
  color: var(--color-text-primary);
}

.ave-reference-icon-btn.danger:hover {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}

.ave-reference-slider-row {
  display: grid;
  grid-template-columns: 56px 1fr 40px;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  color: var(--color-text-secondary);
}

.ave-reference-slider-row input[type="range"] {
  width: 100%;
  accent-color: #a855f7;
  cursor: pointer;
}

.ave-reference-readout {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  font-weight: 600;
}


.ave-isolate-label {
  margin-left: 4px;
}

.exit-modal-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 8px 0;
}

.warn-icon { color: #f59e0b; }
.warn-icon.danger { color: #ef4444; }

.ave-delete-hint {
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
  margin-top: 4px;
}

.exit-modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.rename-modal-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0;
}

.rename-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.rename-input {
  width: 100%;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
  border-radius: var(--radius-lg);
  font-family: inherit;
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.15s ease;
}

.rename-input:focus {
  border-color: rgba(168, 85, 247, 0.6);
}

.rename-error {
  font-size: 0.78rem;
  color: #f87171;
  margin: 0;
}

.rename-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  margin: 0;
  line-height: 1.4;
}

</style>
