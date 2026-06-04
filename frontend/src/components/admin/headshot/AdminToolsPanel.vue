<script setup>
import { computed, ref, onBeforeUnmount } from 'vue'
import { MousePointer, Pencil, Minus, Square, Circle, Scissors, Move3d, Hand, RotateCw, Copy, FlipHorizontal2, FlipVertical2, ChevronDown } from 'lucide-vue-next'
import ColorSwatchPicker from './ColorSwatchPicker.vue'

const props = defineProps({
  activeTool: { type: String, default: 'select' },
  // Brush size for pencil/eraser. Editor owns the value; we only ever
  // reflect + emit changes to it.
  brushSize: { type: Number, default: 1 },
  // Which shape the Rect tool draws — 'rect' or 'circle'. The button
  // shows the active shape's icon and exposes the others via a caret menu.
  shapeType: { type: String, default: 'rect' },
  // Resolved hex of the active piece's color (null when no piece selected).
  // Driven by the editor; the swatch just displays it.
  currentColorHex: { type: String, default: null },
  // Per-user MRU stack of recent colors. Owned by the editor (loaded from
  // localStorage on mount, pushed to on color confirms).
  recentColors: { type: Array, default: () => [] },
  // True when no piece is selected — disables the swatch interactions.
  noPieceActive: { type: Boolean, default: false },
  // Phase 1 mode: tools are decorative placeholders, none functional.
  // Phase 2 in the variant editor: all tools live.
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:active-tool',
  'update:brush-size',
  'update:shape-type',
  'duplicate',
  'flip-horizontal',
  'flip-vertical',
  'open-color',
  'apply-recent-color',
])

const BRUSH_SIZES = [1, 2, 3, 4, 5]

// Color + size sections render contextually — only when the active tool
// can actually act on them. Hides the swatch/size column entirely (rather
// than greying out) so the panel stays focused on what's usable.
//   - Color: applied by piece-fill tools (pencil + rect). Cut/Remove are
//     subtractive and don't read color. Select/Pan/Scale don't draw.
//   - Size: brush footprint for pencil + eraser only.
// Shape tool covers both rect and circle via the shapeType sub-mode; both
// fill with the active piece's color, so the swatch belongs on either.
const showSwatch = computed(() =>
  !props.disabled && (props.activeTool === 'pencil' || props.activeTool === 'rect')
)
const showSize = computed(() =>
  !props.disabled && (props.activeTool === 'pencil' || props.activeTool === 'eraser')
)

const swatchDisabled = computed(() => props.disabled || props.noPieceActive)

// Shape options for the Rect tool's caret dropdown. The active shape's
// icon stands in for the Rect button itself, so the toolbar always shows
// which shape will be drawn at a glance.
const SHAPES = [
  { id: 'rect',   label: 'Rectangle', icon: Square },
  { id: 'circle', label: 'Circle',    icon: Circle },
]

const activeShape = computed(
  () => SHAPES.find(s => s.id === props.shapeType) ?? SHAPES[0]
)

// Mode tools (exclusive — one active at a time). The Rect entry uses the
// currently-selected shape's icon; the caret next to it opens a picker.
const MODES = computed(() => [
  { id: 'select', label: 'Select', icon: MousePointer },
  { id: 'pan',    label: 'Pan (drag to scroll when zoomed)', icon: Hand },
  { id: 'pencil', label: 'Pencil', icon: Pencil },
  // Tool id stays 'eraser' (canvas dispatch + cursor map key) — only the
  // user-facing label and icon change to the cleaner "Remove" semantic.
  { id: 'eraser', label: 'Remove', icon: Minus },
  { id: 'rect',   label: activeShape.value.label, icon: activeShape.value.icon },
  { id: 'cut',    label: 'Cut',    icon: Scissors },
  { id: 'scale',  label: 'Scale',  icon: Move3d },
  { id: 'rotate', label: 'Rotate (drag handle above selection)', icon: RotateCw },
])

// Shape dropdown state. The menu is teleported to <body> so it can escape
// the panel's overflow-hidden + the list's overflow-y-auto clipping (both
// would cut the menu off when it flew out to the right). Positioning is
// `fixed` with viewport coords derived from the caret's bounding rect —
// keeps it visually anchored to the tool itself.
const shapeMenuOpen = ref(false)
const shapeCaretWrapRef = ref(null)   // in-panel: holds the caret button
const shapeCaretRef = ref(null)       // the caret button itself
const shapeMenuElRef = ref(null)      // teleported menu element
const shapeMenuPos = ref({ top: 0, left: 0 })

// Refs declared on elements inside a <template v-for> get assigned as an
// ARRAY of matching DOM nodes (even when v-if narrows the loop down to a
// single match). Unwrap to the first element before any DOM measurement.
function _unwrapRef(r) {
  return Array.isArray(r) ? (r[0] || null) : r
}

function _positionShapeMenu() {
  const el = _unwrapRef(shapeCaretRef.value)
  if (!el || typeof el.getBoundingClientRect !== 'function') return
  const rect = el.getBoundingClientRect()
  shapeMenuPos.value = { top: rect.top, left: rect.right + 8 }
}

function toggleShapeMenu(event) {
  event?.stopPropagation?.()
  if (props.disabled) return
  shapeMenuOpen.value = !shapeMenuOpen.value
  if (shapeMenuOpen.value) {
    _positionShapeMenu()
    setTimeout(() => document.addEventListener('mousedown', _onDocClick), 0)
  }
}

function _onDocClick(event) {
  // Outside-click closes — but both the caret wrap (in panel) and the
  // teleported menu (now in <body>) are valid "inside" regions. The wrap
  // ref lives inside a v-for so it comes back as an array; unwrap before
  // calling .contains().
  const wrap = _unwrapRef(shapeCaretWrapRef.value)
  const menu = shapeMenuElRef.value
  const inWrap = wrap?.contains?.(event.target)
  const inMenu = menu?.contains?.(event.target)
  if (inWrap || inMenu) return
  shapeMenuOpen.value = false
  document.removeEventListener('mousedown', _onDocClick)
}

onBeforeUnmount(() => document.removeEventListener('mousedown', _onDocClick))

function pickShape(shapeId) {
  emit('update:shape-type', shapeId)
  // Activate the Rect tool too — picking a shape implies the admin wants
  // to start drawing with it, not just configure a tool they aren't using.
  if (props.activeTool !== 'rect') emit('update:active-tool', 'rect')
  shapeMenuOpen.value = false
  document.removeEventListener('mousedown', _onDocClick)
}

// ----- size dropdown state -----
// Same teleport-to-body + fixed-positioning pattern the shape menu uses.
// Caret lives under the Pencil tool; brush size applies to pencil + eraser
// so opening it while eraser is active still works.
const sizeMenuOpen = ref(false)
const sizeCaretWrapRef = ref(null)
const sizeCaretRef = ref(null)
const sizeMenuElRef = ref(null)
const sizeMenuPos = ref({ top: 0, left: 0 })

function _positionSizeMenu() {
  const el = _unwrapRef(sizeCaretRef.value)
  if (!el || typeof el.getBoundingClientRect !== 'function') return
  const rect = el.getBoundingClientRect()
  sizeMenuPos.value = { top: rect.top, left: rect.right + 8 }
}

function toggleSizeMenu(event) {
  event?.stopPropagation?.()
  if (props.disabled) return
  sizeMenuOpen.value = !sizeMenuOpen.value
  if (sizeMenuOpen.value) {
    _positionSizeMenu()
    setTimeout(() => document.addEventListener('mousedown', _onSizeDocClick), 0)
  }
}

function _onSizeDocClick(event) {
  const wrap = _unwrapRef(sizeCaretWrapRef.value)
  const menu = sizeMenuElRef.value
  const inWrap = wrap?.contains?.(event.target)
  const inMenu = menu?.contains?.(event.target)
  if (inWrap || inMenu) return
  sizeMenuOpen.value = false
  document.removeEventListener('mousedown', _onSizeDocClick)
}

onBeforeUnmount(() => document.removeEventListener('mousedown', _onSizeDocClick))

function pickSizeFromMenu(size) {
  emit('update:brush-size', size)
  sizeMenuOpen.value = false
  document.removeEventListener('mousedown', _onSizeDocClick)
}

function sizeCaretTooltip() {
  return props.disabled ? 'Brush size — enter variant editor to use' : 'Brush size'
}

// ----- tooltip system -----
// Tooltips used to be CSS pseudo-elements (::after on the trigger) keyed
// by `data-tooltip` attrs. They got clipped by the panel's overflow chain
// the same way the dropdowns did. Vue-rendered + teleported to <body> so
// they escape the clip region while still anchoring to the trigger.
const hoveredTooltip = ref(null)  // { text, top, left }

function showTooltip(event, text) {
  if (!text) return
  const rect = event.currentTarget.getBoundingClientRect()
  hoveredTooltip.value = {
    text,
    top: rect.top + rect.height / 2,
    left: rect.right + 10,
  }
}

function hideTooltip() {
  hoveredTooltip.value = null
}

// Display text per element — disabled state appends a hint so the admin
// knows where the tool lives. Mirrors the previous `data-tooltip` strings.
function modeTooltip(mode) {
  return props.disabled ? `${mode.label} — enter variant editor to use` : mode.label
}
function actionTooltip(action) {
  return props.disabled ? `${action.label} — enter variant editor to use` : action.label
}
function shapeCaretTooltip() {
  return props.disabled ? 'Pick shape — enter variant editor to use' : 'Pick shape'
}

// Actions (one-shot). Color picking is handled by the swatch+caret below.
// Scale is interactive via the Scale tool mode + corner drag handles, not
// a one-shot button.
const ACTIONS = [
  { id: 'flip-h',     label: 'Flip horizontal',  icon: FlipHorizontal2, emit: 'flip-horizontal' },
  { id: 'flip-v',     label: 'Flip vertical',    icon: FlipVertical2,   emit: 'flip-vertical' },
  { id: 'duplicate',  label: 'Duplicate selection', icon: Copy,         emit: 'duplicate' },
]

function selectMode(id) {
  if (props.disabled) return
  emit('update:active-tool', id)
}

function fireAction(action) {
  if (props.disabled) return
  emit(action.emit)
}

</script>

<template>
  <aside class="admin-tools-panel">
    <header class="atp-header">Tools</header>
    <div class="atp-list">
      <template v-for="mode in MODES" :key="mode.id">
        <button
          type="button"
          class="atp-tool"
          :class="{ active: activeTool === mode.id && !disabled }"
          :disabled="disabled"
          @click="selectMode(mode.id)"
          @mouseenter="(e) => showTooltip(e, modeTooltip(mode))"
          @mouseleave="hideTooltip"
        >
          <component :is="mode.icon" :size="16" />
        </button>
        <!-- Caret + shape-picker dropdown attached to the Rect tool. The
             caret is a thin button directly under the rect button; tapping
             it pops out a small menu with each shape option. The menu is
             teleported to <body> so the panel's overflow doesn't clip it. -->
        <div v-if="mode.id === 'rect'" ref="shapeCaretWrapRef" class="atp-shape-wrap">
          <button
            ref="shapeCaretRef"
            type="button"
            class="atp-shape-caret"
            :class="{ open: shapeMenuOpen }"
            :disabled="disabled"
            @click="toggleShapeMenu"
            @mouseenter="(e) => showTooltip(e, shapeCaretTooltip())"
            @mouseleave="hideTooltip"
          >
            <ChevronDown :size="10" />
          </button>
        </div>
        <!-- Caret + size-picker dropdown attached to the Pencil tool.
             Shows the active brush size as the caret's label so it's
             readable at a glance, and opens a teleported menu with the
             other size options. Renders only when pencil OR eraser is
             active (both consume `brushSize`). -->
        <div v-if="mode.id === 'pencil' && showSize" ref="sizeCaretWrapRef" class="atp-shape-wrap">
          <button
            ref="sizeCaretRef"
            type="button"
            class="atp-shape-caret atp-size-caret"
            :class="{ open: sizeMenuOpen }"
            :disabled="disabled"
            @click="toggleSizeMenu"
            @mouseenter="(e) => showTooltip(e, sizeCaretTooltip())"
            @mouseleave="hideTooltip"
          >
            <span class="atp-size-current">{{ brushSize }}</span>
            <ChevronDown :size="10" />
          </button>
        </div>
      </template>
      <div class="atp-divider" />
      <button
        v-for="action in ACTIONS"
        :key="action.id"
        type="button"
        class="atp-tool"
        :disabled="disabled"
        @click="fireAction(action)"
        @mouseenter="(e) => showTooltip(e, actionTooltip(action))"
        @mouseleave="hideTooltip"
      >
        <component :is="action.icon" :size="16" />
      </button>

      <template v-if="showSwatch">
        <div class="atp-divider" />
        <div class="atp-swatch-wrap">
          <ColorSwatchPicker
            :current-hex="currentColorHex"
            :recents="recentColors"
            :disabled="swatchDisabled"
            @open-picker="emit('open-color')"
            @apply-recent="(entry) => emit('apply-recent-color', entry)"
          />
        </div>
      </template>

    </div>
    <footer v-if="disabled" class="atp-footer">Phase 2</footer>
  </aside>

  <!-- Teleported tooltip — single floating element that follows whichever
       trigger is being hovered. Lives in <body> so the panel's overflow
       chain can't clip it (the CSS-pseudo-element version did). -->
  <Teleport to="body">
    <div
      v-if="hoveredTooltip"
      class="atp-tooltip"
      :style="{ top: hoveredTooltip.top + 'px', left: hoveredTooltip.left + 'px' }"
    >
      {{ hoveredTooltip.text }}
    </div>
  </Teleport>

  <!-- Teleported size-picker menu — mirrors the shape-picker pattern.
       Lists brush sizes 1-5; active size gets the purple highlight. -->
  <Teleport to="body">
    <div
      v-if="sizeMenuOpen"
      ref="sizeMenuElRef"
      class="atp-shape-menu"
      :style="{ top: sizeMenuPos.top + 'px', left: sizeMenuPos.left + 'px' }"
    >
      <button
        v-for="size in BRUSH_SIZES"
        :key="`size-opt-${size}`"
        type="button"
        class="atp-shape-option"
        :class="{ active: brushSize === size }"
        @click="pickSizeFromMenu(size)"
      >
        <span class="atp-size-dot" :style="{ width: (4 + size * 2) + 'px', height: (4 + size * 2) + 'px' }"></span>
        <span>Size {{ size }}</span>
      </button>
    </div>
  </Teleport>

  <!-- Teleported shape-picker menu — rendered at the body level so the
       tools panel's overflow chain can't clip it. Positioned via fixed
       coordinates anchored to the caret's bounding rect. -->
  <Teleport to="body">
    <div
      v-if="shapeMenuOpen"
      ref="shapeMenuElRef"
      class="atp-shape-menu"
      :style="{ top: shapeMenuPos.top + 'px', left: shapeMenuPos.left + 'px' }"
    >
      <button
        v-for="shape in SHAPES"
        :key="shape.id"
        type="button"
        class="atp-shape-option"
        :class="{ active: shape.id === shapeType }"
        @click="pickShape(shape.id)"
      >
        <component :is="shape.icon" :size="14" />
        <span>{{ shape.label }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.admin-tools-panel {
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  min-width: 56px;
}

.atp-header {
  padding: 10px 8px;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid var(--glass-border);
  text-align: center;
}

.atp-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  flex: 1;
  /* Scroll on the y-axis when the panel is too short for all tools/size
     buttons (small viewports, or pencil active with both swatch + sizes). */
  overflow-y: auto;
  min-height: 0;
}

.atp-divider {
  height: 1px;
  background: var(--glass-border);
  margin: 4px 4px;
}

.atp-tool {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  color: var(--color-text-secondary);
  border-radius: var(--radius-lg);
  padding: 0;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

/* Floating tooltip — teleported to <body>, positioned via JS-driven fixed
   coordinates so the panel's overflow chain never clips it. */
.atp-tooltip {
  position: fixed;
  transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.92);
  color: white;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 500;
  white-space: nowrap;
  z-index: 1000;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

[data-theme="light"] .atp-tooltip {
  background: rgba(20, 20, 28, 0.96);
}

.atp-tool:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.atp-tool.active {
  background: rgba(168, 85, 247, 0.18);
  border-color: rgba(168, 85, 247, 0.5);
  color: var(--color-text-primary);
}

.atp-tool:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.atp-swatch-wrap {
  display: flex;
  justify-content: center;
  padding: 2px 0;
}

/* Shape picker — the caret sits directly under the Rect tool (matches the
   panel's vertical strip layout) and the dropdown flies out to the right. */
.atp-shape-wrap {
  position: relative;
  display: flex;
  justify-content: center;
}

.atp-shape-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 14px;
  margin-top: -2px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  color: var(--color-text-tertiary);
  border-radius: 6px;
  padding: 0;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.atp-shape-caret:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.atp-shape-caret.open {
  background: rgba(168, 85, 247, 0.18);
  border-color: rgba(168, 85, 247, 0.5);
  color: var(--color-text-primary);
}

.atp-shape-caret:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

/* Teleported to <body> — `fixed` lets the menu live above every other
   layout context so the panel's overflow can't clip it, while the JS-set
   top/left keeps it visually anchored to the caret. */
.atp-shape-menu {
  position: fixed;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  background: rgba(20, 20, 28, 0.98);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 4px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  z-index: 1000;
}

[data-theme="light"] .atp-shape-menu {
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.atp-shape-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}

.atp-shape-option:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.atp-shape-option.active {
  background: rgba(168, 85, 247, 0.18);
  color: var(--color-text-primary);
}

/* Size variant of the caret — wider so the active size number fits next
   to the dropdown chevron. */
.atp-size-caret {
  width: 40px;
  padding: 0 4px;
  gap: 2px;
}

.atp-size-current {
  font-size: 0.65rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
}

/* Visual size indicator inside each menu option — a dot scaled with the
   brush size so the choices read at a glance, not just a number. */
.atp-size-dot {
  display: inline-block;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}


.atp-footer {
  padding: 6px 8px;
  font-size: 0.55rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  text-align: center;
  border-top: 1px solid var(--glass-border);
}
</style>
