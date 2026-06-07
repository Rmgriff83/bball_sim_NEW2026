<script setup>
import { ref, computed, onMounted } from 'vue'
import { Plus, AlertTriangle } from 'lucide-vue-next'
import api from '@/composables/useApi'
import {
  PALETTE_SCHEMAS,
  applyPalettesPatch,
} from '@/services/headshotComposer'
import { useToastStore } from '@/stores/toast'
import BaseModal from '@/components/ui/BaseModal.vue'
import AdminPaletteEntryEditor from './AdminPaletteEntryEditor.vue'

/**
 * Admin Palette Editor — backs the Palettes tab in HeadshotAdminEditorView.
 *
 * Layout mirrors the variant strip (.avs-* classes via local copies so we
 * don't have to depend on AdminVariantStrip's internals):
 *   - Layer-pill row at the top, one pill per palette type
 *   - Grid of editable cells below, one per palette entry under the active
 *     type. Each cell shows the entry name plus small swatches per slot.
 *   - "+ New Color" tile at the end opens the entry editor in new mode.
 *
 * Persistence: fetch /api/admin/palettes on mount, hold the working blob
 * locally, PUT the whole document on every save. `applyPalettesPatch()`
 * hot-swaps composeSvg's in-memory palette constants so the admin's own
 * preview reflects edits immediately (no reload).
 */

const toastStore = useToastStore()

// Working copy of the full palettes blob — every cell + the modal reads
// from this so an in-flight server fetch can't fight with admin edits.
const palettes = ref(null)
const loading = ref(true)
const saving = ref(false)
const fetchError = ref('')

const activePaletteKey = ref('skin')

const PALETTE_ORDER = ['skin', 'hair', 'eye', 'lip', 'headband']

// Editor modal state
const editorOpen = ref(false)
const editorIsNew = ref(false)
const editorEntryKey = ref('')
const editorEntryValue = ref(null)

// Delete-confirm modal state. We surface a confirm so the admin can't
// nuke an entry by misclicking — normalizeConfig falls back gracefully
// for missing keys, but the action is still destructive across all
// campaigns retroactively.
const confirmDeleteOpen = ref(false)
const confirmDeleteKey = ref('')

const activeSchema = computed(() => PALETTE_SCHEMAS[activePaletteKey.value] || null)

const activeEntries = computed(() => {
  if (!palettes.value) return []
  const bucket = palettes.value[activePaletteKey.value]
  if (!bucket || typeof bucket !== 'object') return []
  return Object.entries(bucket).map(([key, value]) => ({ key, value }))
})

const existingKeysForActive = computed(() =>
  activeEntries.value.map(e => e.key),
)

function _prettyKey(key) {
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function selectPalette(key) {
  activePaletteKey.value = key
}

function openEditExisting(entry) {
  // 'none' on headband is the no-op sentinel — composeSvg + LayerContextMenu
  // both branch on it by name, so disallow editing or deleting it from the
  // grid. The schema's `allowsNone` flag tags this.
  if (activeSchema.value?.allowsNone && entry.key === 'none') return
  editorIsNew.value = false
  editorEntryKey.value = entry.key
  editorEntryValue.value = entry.value
  editorOpen.value = true
}

function openNewEntry() {
  editorIsNew.value = true
  editorEntryKey.value = ''
  editorEntryValue.value = null
  editorOpen.value = true
}

async function loadPalettes() {
  loading.value = true
  fetchError.value = ''
  try {
    const { data } = await api.get('/api/admin/palettes')
    palettes.value = data?.palettes || {}
    applyPalettesPatch(palettes.value)
  } catch (err) {
    const status = err?.response?.status
    if (status === 404) {
      fetchError.value =
        'palettes.json not in the bucket yet — run "npm run sync:headshots:upload" once to seed it from the bundled copy.'
    } else if (status === 503) {
      fetchError.value = 'ASSETS_AWS_BUCKET is not configured on the backend.'
    } else {
      fetchError.value = 'Failed to load palettes. Check the network tab + server logs.'
    }
  } finally {
    loading.value = false
  }
}

async function savePalettes(next) {
  saving.value = true
  try {
    const { data } = await api.put('/api/admin/palettes', { palettes: next })
    palettes.value = data?.palettes || next
    applyPalettesPatch(palettes.value)
    toastStore.showSuccess('Palettes saved.')
    return true
  } catch (err) {
    console.error('[AdminPaletteEditor] save failed', err)
    toastStore.showError('Could not save palettes.')
    return false
  } finally {
    saving.value = false
  }
}

/**
 * Merge an entry (edit or create) into the working blob, then PUT.
 *
 * For SKIN and HAIR — the two palettes referenced by ETHNICITY_PROFILES —
 * a freshly-added key gets auto-pushed into every ethnicity bucket so it
 * shows up in random player generation right away (user-locked decision
 * from the planning step).
 */
async function onEntrySave({ key, value }) {
  if (!palettes.value) return
  const next = JSON.parse(JSON.stringify(palettes.value))
  const paletteKey = activePaletteKey.value
  next[paletteKey] = next[paletteKey] || {}
  const isNewEntry = !(key in next[paletteKey])
  next[paletteKey][key] = value

  // Auto-include in ethnicity profiles for skin/hair.
  if (isNewEntry) {
    const sch = PALETTE_SCHEMAS[paletteKey]
    if (sch?.inEthnicity && next.ethnicity_profiles) {
      for (const profileKey of Object.keys(next.ethnicity_profiles)) {
        const profile = next.ethnicity_profiles[profileKey]
        if (!profile) continue
        const bucket = profile[sch.inEthnicity]
        if (Array.isArray(bucket) && !bucket.includes(key)) {
          bucket.push(key)
        }
      }
    }
  }

  const ok = await savePalettes(next)
  if (ok) editorOpen.value = false
}

function onEntryDeleteRequest({ key }) {
  // Bubble out of the entry editor into the confirm modal — admin sees
  // a clear "are you sure" before the irreversible PUT.
  editorOpen.value = false
  confirmDeleteKey.value = key
  confirmDeleteOpen.value = true
}

async function confirmDelete() {
  if (!palettes.value || !confirmDeleteKey.value) return
  const next = JSON.parse(JSON.stringify(palettes.value))
  const paletteKey = activePaletteKey.value
  if (next[paletteKey]) delete next[paletteKey][confirmDeleteKey.value]

  // Also strip from any ethnicity profiles that referenced it, otherwise
  // normalizeConfig's first-element fallback would still try to roll the
  // dead key occasionally.
  const sch = PALETTE_SCHEMAS[paletteKey]
  if (sch?.inEthnicity && next.ethnicity_profiles) {
    for (const profileKey of Object.keys(next.ethnicity_profiles)) {
      const profile = next.ethnicity_profiles[profileKey]
      if (!profile) continue
      const bucket = profile[sch.inEthnicity]
      if (Array.isArray(bucket)) {
        profile[sch.inEthnicity] = bucket.filter(k => k !== confirmDeleteKey.value)
      }
    }
  }

  const ok = await savePalettes(next)
  if (ok) {
    confirmDeleteOpen.value = false
    confirmDeleteKey.value = ''
  }
}

/**
 * Render one slot's swatch hex from an entry's value. Handles both shapes:
 *   - object entries: pull the named slot's hex
 *   - flat-hex entries (lip): the value IS the hex
 *   - null (headband 'none'): tiny X marker hex
 */
function swatchHexFor(entryValue, slot) {
  if (entryValue == null) return null
  if (typeof entryValue === 'string') return entryValue
  if (typeof entryValue === 'object' && slot) return entryValue[slot] || '#888'
  return '#888'
}

onMounted(loadPalettes)
</script>

<template>
  <section class="ape-strip">
    <header class="ape-header">
      <div class="ape-title-block">
        <h2 class="ape-title">Palette Editor</h2>
        <p class="ape-description">
          Pick a palette, then a color to edit its hex slots. New entries
          auto-join every ethnicity profile so they appear in player
          generation immediately. Edits are retroactive across all campaigns.
        </p>
      </div>
      <div class="ape-controls-row">
        <nav class="ape-pills">
          <button
            v-for="p in PALETTE_ORDER"
            :key="p"
            type="button"
            class="ape-pill"
            :class="{ active: p === activePaletteKey }"
            @click="selectPalette(p)"
          >
            {{ _prettyKey(p) }}
          </button>
        </nav>
        <span v-if="!loading && !fetchError" class="ape-count">
          {{ activeEntries.length }}
        </span>
      </div>
    </header>

    <!-- Loading / error states -->
    <div v-if="loading" class="ape-empty">Loading palettes…</div>
    <div v-else-if="fetchError" class="ape-error-banner">
      <AlertTriangle :size="16" />
      <div>
        <div>{{ fetchError }}</div>
        <button type="button" class="ape-retry" @click="loadPalettes">Retry</button>
      </div>
    </div>

    <!-- Entry grid — same layout shape as .avs-grid in AdminVariantStrip. -->
    <div v-else class="ape-grid">
      <div
        v-for="entry in activeEntries"
        :key="entry.key"
        class="ape-cell editable"
        :class="{ disabled: activeSchema?.allowsNone && entry.key === 'none' }"
        :title="activeSchema?.allowsNone && entry.key === 'none'
          ? `Built-in 'none' sentinel — not editable`
          : `Click to edit ${_prettyKey(entry.key)}`"
        @click="openEditExisting(entry)"
      >
        <div class="ape-swatch-stack">
          <!-- Multi-slot palette: one chip per slot, shown horizontally. -->
          <div v-if="activeSchema?.slots" class="ape-swatch-row">
            <span
              v-for="slot in activeSchema.slots"
              :key="slot"
              class="ape-swatch-chip"
              :style="{ background: swatchHexFor(entry.value, slot) || 'transparent' }"
            />
          </div>
          <!-- Flat-hex palette (lip): one big chip. -->
          <div v-else class="ape-swatch-big" :style="{ background: swatchHexFor(entry.value) || 'transparent' }" />
        </div>
        <div class="ape-meta">
          <span class="ape-name">{{ _prettyKey(entry.key) }}</span>
        </div>
      </div>

      <!-- "+ New Color" tile -->
      <button
        type="button"
        class="ape-cell ape-new"
        :disabled="saving"
        title="Add a new color to this palette"
        @click="openNewEntry"
      >
        <div class="ape-new-icon"><Plus :size="28" /></div>
        <span class="ape-new-label">New Color</span>
      </button>
    </div>

    <!-- Entry editor modal -->
    <AdminPaletteEntryEditor
      :show="editorOpen"
      :palette-key="activePaletteKey"
      :entry-key="editorEntryKey"
      :entry-value="editorEntryValue"
      :existing-keys="existingKeysForActive"
      :is-new="editorIsNew"
      @close="editorOpen = false"
      @save="onEntrySave"
      @delete="onEntryDeleteRequest"
    />

    <!-- Delete confirmation -->
    <BaseModal
      :show="confirmDeleteOpen"
      title="Delete palette entry"
      size="xs"
      @close="confirmDeleteOpen = false"
    >
      <div class="ape-confirm-body">
        <div class="warn-icon"><AlertTriangle :size="28" /></div>
        <p>
          Delete <strong>{{ _prettyKey(confirmDeleteKey) }}</strong> from
          the {{ _prettyKey(activePaletteKey) }} palette? Players currently
          using this color will fall back to their ethnicity's default.
        </p>
      </div>
      <template #footer>
        <div class="ape-confirm-actions">
          <button class="pe-btn ghost" @click="confirmDeleteOpen = false">Cancel</button>
          <button class="pe-btn danger" :disabled="saving" @click="confirmDelete">
            {{ saving ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </template>
    </BaseModal>
  </section>
</template>

<style scoped>
.ape-strip {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.ape-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--glass-border);
}

.ape-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ape-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.01em;
}

.ape-description {
  margin: 0;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.ape-controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ape-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
  margin-right: 8px;
}

.ape-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.ape-pill:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.ape-pill.active {
  background: rgba(168, 85, 247, 0.22);
  border-color: rgba(168, 85, 247, 0.55);
  color: var(--color-text-primary);
}

.ape-count {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  background: rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  padding: 2px 8px;
}

.ape-empty,
.ape-error-banner {
  padding: 18px 14px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-align: center;
}

.ape-error-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  text-align: left;
  color: #f87171;
}

.ape-retry {
  margin-top: 8px;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: 0.72rem;
  cursor: pointer;
}

.ape-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 10px;
  padding: 10px;
  overflow-y: auto;
}

.ape-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
}

.ape-cell.editable {
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.ape-cell.editable:hover {
  background: rgba(168, 85, 247, 0.1);
  border-color: rgba(168, 85, 247, 0.4);
}

.ape-cell.disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.ape-cell.disabled:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: transparent;
}

.ape-swatch-stack {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background-color: var(--glass-bg);
  /* Photoshop-style transparency checkerboard so any null/empty cell still
     reads as "transparent" rather than blending into the panel surface. */
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%);
  background-size: 12px 12px;
  background-position: 0 0, 6px 6px;
}

[data-theme="light"] .ape-swatch-stack {
  background-image:
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%),
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%);
}

.ape-swatch-row {
  display: flex;
  gap: 2px;
  padding: 4px;
}

.ape-swatch-chip {
  width: 14px;
  height: 56px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.18);
}

.ape-swatch-big {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.18);
}

.ape-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
}

.ape-name {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  text-align: center;
  word-break: break-word;
}

.ape-new {
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed var(--glass-border);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-family: inherit;
  padding: 18px 8px;
  justify-content: center;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.ape-new:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: rgba(168, 85, 247, 0.5);
  background: rgba(168, 85, 247, 0.08);
}

.ape-new:disabled {
  opacity: 0.4;
  cursor: wait;
}

.ape-new-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 1px dashed currentColor;
}

.ape-new-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ape-confirm-body {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
}

.ape-confirm-body .warn-icon {
  color: #fbbf24;
  flex-shrink: 0;
}

.ape-confirm-body p {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.ape-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--glass-border);
}

/* Re-use AdminPaletteEntryEditor's footer button styling for the confirm
   modal so the two adjacent dialogs visually rhyme. */
.pe-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  background: transparent;
  color: var(--color-text-primary);
}

.pe-btn.ghost:hover {
  background: rgba(255, 255, 255, 0.05);
}

.pe-btn.danger {
  border-color: rgba(248, 113, 113, 0.6);
  color: #f87171;
}

.pe-btn.danger:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.12);
}

.pe-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}
</style>
