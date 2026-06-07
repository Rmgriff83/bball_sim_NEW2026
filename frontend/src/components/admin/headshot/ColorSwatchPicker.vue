<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

const props = defineProps({
  // Resolved hex color for the active piece. Null/empty = nothing selected.
  currentHex: { type: String, default: null },
  // Recently-used color entries: { mode, token?, hex, label? }. Parent owns
  // the storage (per-user localStorage) and passes the list in.
  recents: { type: Array, default: () => [] },
  // Disables both the swatch button and the dropdown. Used when no piece is
  // active so neither click does anything meaningful.
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits([
  'open-picker',   // user clicked the swatch
  'apply-recent',  // user picked a recent — payload: the entry
])

const dropdownOpen = ref(false)
const rootEl = ref(null)
const caretEl = ref(null)
const dropdownEl = ref(null)
// `fixed` position computed from the caret's bounding rect so the dropdown
// stays visually anchored to the swatch even after we Teleport it out to
// <body> to escape the tools-panel overflow chain.
const dropdownPos = ref({ top: 0, left: 0 })

function _positionDropdown() {
  const el = caretEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  dropdownPos.value = { top: rect.top, left: rect.right + 8 }
}

function toggleDropdown() {
  if (props.disabled) return
  dropdownOpen.value = !dropdownOpen.value
  if (dropdownOpen.value) _positionDropdown()
}

function openPicker() {
  if (props.disabled) return
  dropdownOpen.value = false
  emit('open-picker')
}

function pickRecent(entry) {
  dropdownOpen.value = false
  emit('apply-recent', entry)
}

// Outside-click closes — both the in-panel swatch root AND the teleported
// dropdown count as "inside" since the dropdown lives in <body> now.
function onDocumentClick(event) {
  if (!dropdownOpen.value) return
  const inRoot = rootEl.value?.contains(event.target)
  const inDropdown = dropdownEl.value?.contains(event.target)
  if (inRoot || inDropdown) return
  dropdownOpen.value = false
}

function onEscape(event) {
  if (event.key === 'Escape' && dropdownOpen.value) dropdownOpen.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentClick)
  document.addEventListener('keydown', onEscape)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentClick)
  document.removeEventListener('keydown', onEscape)
})

const swatchTitle = computed(() => {
  if (props.disabled) return 'Select a piece to change its color'
  return 'Click to open color picker'
})

function entryKey(entry, idx) {
  return entry.mode === 'token'
    ? `t:${entry.token}:${idx}`
    : `l:${entry.hex}:${entry.label || ''}:${idx}`
}

function entryTitle(entry) {
  const base = entry.label || (entry.mode === 'token' ? entry.token : entry.hex)
  return entry.mode === 'token' ? `${base} (palette)` : base
}
</script>

<template>
  <div ref="rootEl" class="csp" :class="{ disabled }">
    <button
      type="button"
      class="csp-swatch"
      :style="{ background: currentHex || 'transparent' }"
      :class="{ empty: !currentHex }"
      :title="swatchTitle"
      :disabled="disabled"
      @click="openPicker"
    >
      <span v-if="!currentHex" class="csp-empty-mark">—</span>
    </button>
    <button
      ref="caretEl"
      type="button"
      class="csp-caret"
      :class="{ open: dropdownOpen }"
      :disabled="disabled || recents.length === 0"
      :title="recents.length === 0 ? 'No recent colors yet' : 'Recent colors'"
      @click="toggleDropdown"
    >
      <ChevronDown :size="12" />
    </button>
  </div>

  <!-- Teleported recent-colors dropdown — same rationale as the shape menu:
       lives in <body> so the tools-panel overflow can't clip it, with fixed
       coords from the caret's bounding rect. -->
  <Teleport to="body">
    <div
      v-if="dropdownOpen && recents.length > 0"
      ref="dropdownEl"
      class="csp-dropdown"
      :style="{ top: dropdownPos.top + 'px', left: dropdownPos.left + 'px' }"
    >
      <div class="csp-dropdown-header">Recent</div>
      <button
        v-for="(entry, idx) in recents"
        :key="entryKey(entry, idx)"
        type="button"
        class="csp-recent"
        :title="entryTitle(entry)"
        @click="pickRecent(entry)"
      >
        <span class="csp-recent-swatch" :style="{ background: entry.hex }" />
        <span class="csp-recent-label">{{ entry.label || (entry.mode === 'token' ? entry.token : entry.hex) }}</span>
        <span v-if="entry.mode === 'token'" class="csp-recent-tag">P</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.csp {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 40px;
}

.csp.disabled {
  opacity: 0.5;
}

.csp-swatch {
  width: 40px;
  height: 40px;
  border: 1px solid var(--glass-border);
  border-bottom: none;
  border-top-left-radius: var(--radius-lg);
  border-top-right-radius: var(--radius-lg);
  cursor: pointer;
  padding: 0;
  position: relative;
  background-image:
    linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255,255,255,0.05) 25%, transparent 25%);
  background-size: 8px 8px;
  background-position: 0 0, 4px 4px;
  transition: filter 0.15s ease;
}

.csp-swatch:hover:not(:disabled) {
  filter: brightness(1.1);
}

.csp-swatch.empty {
  background: rgba(255, 255, 255, 0.06);
}

.csp-empty-mark {
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
}

.csp-caret {
  width: 40px;
  height: 18px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-bottom-left-radius: var(--radius-lg);
  border-bottom-right-radius: var(--radius-lg);
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.csp-caret:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

.csp-caret.open {
  background: rgba(168, 85, 247, 0.2);
  color: var(--color-text-primary);
}

.csp-caret:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* Teleported to <body> — fixed positioning with JS-set top/left keeps it
   anchored to the swatch's caret outside the tools panel's overflow chain. */
.csp-dropdown {
  position: fixed;
  min-width: 200px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  padding: 6px;
  z-index: 1000;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.csp-dropdown-header {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  padding: 4px 8px;
}

.csp-recent {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  color: var(--color-text-primary);
  font-size: 0.8rem;
  text-align: left;
  transition: background 0.15s ease;
}

.csp-recent:hover {
  background: rgba(255, 255, 255, 0.06);
}

.csp-recent-swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}

.csp-recent-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csp-recent-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  background: rgba(168, 85, 247, 0.25);
  color: #c4b5fd;
  border-radius: 4px;
  font-size: 0.6rem;
  font-weight: 700;
}
</style>
