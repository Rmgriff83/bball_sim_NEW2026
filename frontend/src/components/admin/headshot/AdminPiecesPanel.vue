<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { Eye, EyeOff, Trash2, Plus, GripVertical, Pencil, ListChecks, Check, X } from 'lucide-vue-next'
import { resolvePieceColor } from '@/services/headshotComposer'

const props = defineProps({
  pieces: { type: Array, required: true },
  activeId: { type: String, default: null },
  // The current committed multi-selection (drives "apply to all" behavior).
  // We seed the checkbox state from this when entering multi-select mode so
  // the user can refine an existing selection rather than start from scratch.
  selectedIds: { type: Array, default: () => [] },
  // Editor-only opacity overlay. Keyed by piece id; missing entries = 1.
  opacities: { type: Object, default: () => ({}) },
  // Editor's backdrop config — needed to resolve token-bound pieces through
  // the active palette (e.g. `hair.base` → `#3a2a1a`) for the row swatches.
  // Without it, every token piece would render as the same placeholder hex.
  config: { type: Object, required: true },
})

const emit = defineEmits([
  'activate',
  'toggle-visible',
  'set-opacity', // payload: { pieceId, opacity: 0..1 }  (editor-only, never saved)
  'reorder',     // payload: { fromIndex, toIndex }
  'delete',      // payload: pieceId
  'add',         // no payload — parent opens color picker then appends
  'edit-color',  // payload: pieceId
  'rename',      // payload: { pieceId, label }
  'select-multi', // payload: { ids: [pieceId, ...] }  commit from multi-select mode
  'deselect-all', // no payload — clear the committed multi-selection
])

// ----- multi-select mode -----
// When `multiSelectMode` is true the grip column is replaced with checkboxes
// and row clicks toggle the checkbox rather than activating the piece. The
// floating Select button at the bottom-right commits the selection back to
// the editor's `selectedPieceIds` and exits the mode.
const multiSelectMode = ref(false)
const checkedIds = ref(new Set())

function enterMultiSelect() {
  multiSelectMode.value = true
  // Seed from the current committed selection so users can refine, not
  // start over each time.
  checkedIds.value = new Set(props.selectedIds || [])
}

function exitMultiSelect() {
  multiSelectMode.value = false
  checkedIds.value = new Set()
}

function toggleCheck(piece) {
  const s = new Set(checkedIds.value)
  if (s.has(piece.id)) s.delete(piece.id)
  else s.add(piece.id)
  checkedIds.value = s
}

function isChecked(piece) {
  return checkedIds.value.has(piece.id)
}

const checkedCount = computed(() => checkedIds.value.size)

function confirmMultiSelect() {
  emit('select-multi', { ids: [...checkedIds.value] })
  exitMultiSelect()
}

// Pieces can be deleted while in multi-select mode — drop the corresponding
// check so the count doesn't lie.
watch(() => props.pieces.map(p => p.id).join(','), () => {
  const alive = new Set(props.pieces.map(p => p.id))
  const filtered = new Set()
  for (const id of checkedIds.value) {
    if (alive.has(id)) filtered.add(id)
  }
  if (filtered.size !== checkedIds.value.size) checkedIds.value = filtered
})

function opacityFor(piece) {
  return props.opacities?.[piece.id] ?? 1
}
function opacityPercent(piece) {
  return Math.round(opacityFor(piece) * 100)
}

// Number-input handler: parse, clamp to 0..100, convert to 0..1, emit.
// Invalid input (NaN / blank) defaults back to 100% so the input doesn't
// silently set the piece to 0% on a typo.
function onOpacityChange(piece, event) {
  const raw = event.target.value
  const num = Number(raw)
  const pct = Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : 100
  // Snap the displayed value back if we clamped — otherwise the input shows
  // an out-of-range number while state has the clamped one.
  if (pct !== num) event.target.value = String(pct)
  emit('set-opacity', { pieceId: piece.id, opacity: pct / 100 })
}

// Inline label editing — click label → input → Enter/blur commits, Esc cancels.
// Works regardless of whether the piece is palette-bound or has a custom hex
// (label is decoupled from color mode after Phase 2's data-color-label split).
const editingLabelId = ref(null)
const labelBuffer = ref('')
const labelInputs = ref({})

function startRename(piece, event) {
  // .stop so the row's @click (which activates the piece) doesn't also
  // fire when the user only meant to open the rename input. We also disable
  // the row's draggable attr while editing (below) so dragstart doesn't
  // hijack typing.
  event?.stopPropagation?.()
  editingLabelId.value = piece.id
  labelBuffer.value = piece.label || ''
  nextTick(() => {
    const input = labelInputs.value[piece.id]
    if (input) { input.focus(); input.select() }
  })
}

function commitRename(piece) {
  if (editingLabelId.value !== piece.id) return
  const trimmed = labelBuffer.value.trim()
  editingLabelId.value = null
  if (!trimmed || trimmed === piece.label) return
  emit('rename', { pieceId: piece.id, label: trimmed })
}

function cancelRename() {
  editingLabelId.value = null
  labelBuffer.value = ''
}

// HTML5 drag-and-drop reorder. Tracking via the dragged piece's index so we
// don't need extra deps. Drop target is whichever row the cursor is over;
// we emit a normalized fromIndex/toIndex pair on drop.
const draggingIndex = ref(null)
const dropTargetIndex = ref(null)

function onDragStart(idx, event) {
  draggingIndex.value = idx
  // Suppress default ghost — the row itself is what the user sees move.
  event.dataTransfer.effectAllowed = 'move'
  // Required for drop to fire in some browsers.
  event.dataTransfer.setData('text/plain', String(idx))
}

function onDragOver(idx, event) {
  if (draggingIndex.value === null || draggingIndex.value === idx) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropTargetIndex.value = idx
}

function onDrop(idx) {
  if (draggingIndex.value === null || draggingIndex.value === idx) {
    draggingIndex.value = null
    dropTargetIndex.value = null
    return
  }
  emit('reorder', { fromIndex: draggingIndex.value, toIndex: idx })
  draggingIndex.value = null
  dropTargetIndex.value = null
}

function onDragEnd() {
  draggingIndex.value = null
  dropTargetIndex.value = null
}

function colorSwatch(piece) {
  // Resolve through the composer so token-bound pieces show their actual
  // palette hex (e.g. hair.base under the active hair color), not a fixed
  // placeholder. Falls back to a neutral gray when nothing is set yet.
  return resolvePieceColor(piece, props.config) || '#6b7280'
}
</script>

<template>
  <aside class="app-panel">
    <header class="app-header">
      <span>Pieces</span>
      <div class="app-header-right">
        <!-- Multi-select toggle: turns into an X (cancel) once active.
             Active state mirrors the toolbar's purple highlight so users
             see at a glance that the panel is in "selection-building" mode. -->
        <button
          type="button"
          class="app-multi-toggle"
          :class="{ active: multiSelectMode }"
          :title="multiSelectMode ? 'Cancel multi-select' : 'Select multiple pieces'"
          @click="multiSelectMode ? exitMultiSelect() : enterMultiSelect()"
        >
          <component :is="multiSelectMode ? X : ListChecks" :size="12" />
        </button>
        <span class="app-count">{{ pieces.length }}</span>
      </div>
    </header>

    <div class="app-list">
      <!-- Pieces render top-of-list = top of visual stack. The SVG document
           order goes the other way (later in document = on top), so the
           list display is reversed for visual intuition. -->
      <div
        v-for="(piece, idx) in [...pieces].reverse()"
        :key="piece.id"
        class="app-row"
        :class="{
          active: piece.id === activeId && !multiSelectMode,
          // Every piece in the committed multi-selection gets the lighter
          // selected highlight (except the active one, which keeps its
          // stronger 'active' treatment so the drawing-tool target stays
          // distinguishable from the rest of the group).
          selected: !multiSelectMode && selectedIds.includes(piece.id) && piece.id !== activeId,
          checked: multiSelectMode && isChecked(piece),
          dragging: draggingIndex === pieces.length - 1 - idx,
          'drop-target': dropTargetIndex === pieces.length - 1 - idx,
          editing: editingLabelId === piece.id,
          multi: multiSelectMode,
        }"
        :draggable="editingLabelId !== piece.id && !multiSelectMode"
        @click="multiSelectMode ? toggleCheck(piece) : emit('activate', piece.id)"
        @dragstart="onDragStart(pieces.length - 1 - idx, $event)"
        @dragover="onDragOver(pieces.length - 1 - idx, $event)"
        @drop="onDrop(pieces.length - 1 - idx)"
        @dragend="onDragEnd"
      >
        <!-- Grip ↔ checkbox swap. Both occupy the same slot so column widths
             don't shift when toggling modes. -->
        <span v-if="!multiSelectMode" class="app-grip"><GripVertical :size="12" /></span>
        <span v-else class="app-check" :class="{ on: isChecked(piece) }">
          <Check v-if="isChecked(piece)" :size="10" />
        </span>
        <button
          type="button"
          class="app-eye"
          :class="{ off: !piece.visible }"
          :title="piece.visible ? 'Hide' : 'Show'"
          @click.stop="emit('toggle-visible', piece.id)"
        >
          <component :is="piece.visible ? Eye : EyeOff" :size="12" />
        </button>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          class="app-opacity"
          :class="{ dimmed: opacityFor(piece) < 1 }"
          :value="opacityPercent(piece)"
          :title="`Opacity ${opacityPercent(piece)}% — type 0-100 (editor preview only)`"
          @click.stop
          @mousedown.stop
          @keydown.stop
          @change="onOpacityChange(piece, $event)"
        />
        <button
          type="button"
          class="app-swatch"
          :style="{ background: colorSwatch(piece) }"
          :title="`Color: ${piece.label}`"
          @click.stop="emit('edit-color', piece.id)"
        />
        <input
          v-if="editingLabelId === piece.id"
          :ref="(el) => (labelInputs[piece.id] = el)"
          v-model="labelBuffer"
          class="app-label-input"
          maxlength="40"
          @click.stop
          @mousedown.stop
          @keydown.enter.prevent="commitRename(piece)"
          @keydown.escape.prevent="cancelRename"
          @blur="commitRename(piece)"
        />
        <span
          v-else
          class="app-label"
          :title="piece.label || 'Unnamed'"
        >{{ piece.label || 'Unnamed' }}</span>
        <button
          v-if="editingLabelId !== piece.id"
          type="button"
          class="app-edit"
          title="Rename piece"
          @click.stop="startRename(piece, $event)"
        >
          <Pencil :size="12" />
        </button>
        <button
          type="button"
          class="app-trash"
          title="Delete piece"
          @click.stop="emit('delete', piece.id)"
        >
          <Trash2 :size="12" />
        </button>
      </div>

      <div v-if="pieces.length === 0" class="app-empty">No pieces yet — add one to start drawing.</div>
    </div>

    <footer class="app-footer">
      <button class="app-add" @click="emit('add')">
        <Plus :size="14" /> <span>New Piece</span>
      </button>
    </footer>

    <!-- Floating commit button — only renders while building a multi-selection
         AND at least one row is checked. Sits above the footer so it doesn't
         overlap "New Piece". -->
    <button
      v-if="multiSelectMode && checkedCount > 0"
      type="button"
      class="app-multi-confirm"
      @click="confirmMultiSelect"
    >
      <Check :size="14" /> <span>Select ({{ checkedCount }})</span>
    </button>

    <!-- Symmetric counterpart: when not building a selection but a committed
         multi-selection (>1) is active, offer a one-click clear. Same slot as
         the confirm button — they're mutually exclusive states. -->
    <button
      v-if="!multiSelectMode && selectedIds.length > 1"
      type="button"
      class="app-multi-confirm deselect"
      title="Clear the multi-selection"
      @click="emit('deselect-all')"
    >
      <X :size="14" /> <span>Deselect ({{ selectedIds.length }})</span>
    </button>
  </aside>
</template>

<style scoped>
.app-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  min-width: 240px;
  max-width: 280px;
}

.app-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.app-multi-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.app-multi-toggle:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.app-multi-toggle.active {
  background: rgba(168, 85, 247, 0.22);
  border-color: rgba(168, 85, 247, 0.6);
  color: var(--color-text-primary);
}

/* Checkbox indicator replacing the grip column when in multi-select mode.
   Mirrors the grip's width so the rest of the row stays put. */
.app-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1.5px solid var(--glass-border);
  border-radius: 3px;
  color: white;
  flex-shrink: 0;
}

.app-check.on {
  background: #a855f7;
  border-color: #a855f7;
}

.app-row.checked {
  background: rgba(168, 85, 247, 0.14);
}

.app-row.multi {
  cursor: pointer;
}

.app-multi-confirm {
  position: absolute;
  bottom: 56px;  /* clears the New Piece footer */
  right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #a855f7;
  border: none;
  color: white;
  border-radius: var(--radius-full);
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35), 0 0 0 2px rgba(168, 85, 247, 0.2);
  z-index: 20;
  transition: transform 0.12s ease, background 0.15s ease;
}

.app-multi-confirm:hover {
  background: #9333ea;
  transform: translateY(-1px);
}

/* Deselect variant — same shape, neutral/dim color so it doesn't compete
   visually with the purple "Select" action. */
.app-multi-confirm.deselect {
  background: rgba(40, 40, 50, 0.92);
  color: var(--color-text-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--glass-border);
}

.app-multi-confirm.deselect:hover {
  background: rgba(60, 60, 70, 0.95);
}

[data-theme="light"] .app-multi-confirm.deselect {
  background: rgba(255, 255, 255, 0.95);
  color: var(--color-text-primary);
}

[data-theme="light"] .app-multi-confirm.deselect:hover {
  background: rgba(240, 240, 240, 0.95);
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid var(--glass-border);
}

.app-count {
  font-size: 0.7rem;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  padding: 2px 8px;
}

.app-list {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.app-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: background 0.15s ease;
  user-select: none;
}

.app-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.app-row.active {
  background: rgba(168, 85, 247, 0.18);
  /* Slight left accent so the drawing-tool target piece is still obvious
     even when the rest of a multi-selection shares the lighter purple. */
  box-shadow: inset 3px 0 0 rgba(168, 85, 247, 0.9);
}

.app-row.selected {
  background: rgba(168, 85, 247, 0.1);
}

.app-row.dragging {
  opacity: 0.4;
}

.app-row.drop-target {
  outline: 2px dashed rgba(168, 85, 247, 0.6);
  outline-offset: -2px;
}

.app-grip {
  color: var(--color-text-tertiary);
  display: flex;
  cursor: grab;
}

.app-eye,
.app-edit,
.app-trash {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s ease, background 0.15s ease;
}

.app-eye:hover,
.app-edit:hover,
.app-trash:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.app-opacity {
  width: 36px;
  height: 18px;
  padding: 0 2px;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-tertiary);
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: center;
  font-family: inherit;
  outline: none;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  /* Strip native number-input spinner arrows — they crowd the small input
     and the editor doesn't need step-by-step nudging. */
  appearance: textfield;
  -moz-appearance: textfield;
}

.app-opacity::-webkit-inner-spin-button,
.app-opacity::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.app-opacity:hover,
.app-opacity:focus {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  border-color: rgba(168, 85, 247, 0.5);
}

.app-opacity.dimmed {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.4);
}

.app-eye.off {
  opacity: 0.5;
}

.app-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
  padding: 0;
}

.app-label {
  flex: 1;
  font-size: 0.8rem;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 4px;
}

.app-label-input {
  flex: 1;
  min-width: 0;
  font-size: 0.8rem;
  font-family: inherit;
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(168, 85, 247, 0.5);
  border-radius: 4px;
  padding: 1px 4px;
  outline: none;
}

.app-label-input:focus {
  border-color: rgba(168, 85, 247, 0.9);
}

.app-row.editing {
  cursor: default;
}

.app-empty {
  padding: 16px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  text-align: center;
}

.app-footer {
  padding: 8px;
  border-top: 1px solid var(--glass-border);
}

.app-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  padding: 8px;
  background: rgba(168, 85, 247, 0.15);
  border: 1px dashed rgba(168, 85, 247, 0.4);
  color: var(--color-text-primary);
  border-radius: var(--radius-lg);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.app-add:hover {
  background: rgba(168, 85, 247, 0.25);
}
</style>
