<script setup>
import { ref, computed, watch } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import BaseModal from '@/components/ui/BaseModal.vue'
import { PALETTE_SCHEMAS } from '@/services/headshotComposer'

/**
 * Modal for editing one palette entry's slot colors (or creating a new
 * entry). The entry shape is driven by PALETTE_SCHEMAS for the active
 * palette type:
 *   - skin: 4 slots (base/hi/sh/deep)
 *   - hair: 3 slots (base/hi/sh)
 *   - eye:  2 slots (iris/pupil)
 *   - lip:  flat hex (no slot object)
 *   - headband: 2 slots (main/edge), plus a 'none' sentinel that's not
 *               edited here
 *
 * On save the parent receives the entry key + entry value via `@save`.
 * Delete fires `@delete` with the key. The actual palettes.json PUT
 * happens upstream so this modal stays a thin form.
 */
const props = defineProps({
  show: { type: Boolean, default: false },
  // Active palette type ('skin' | 'hair' | 'eye' | 'lip' | 'headband').
  paletteKey: { type: String, required: true },
  // When editing: the entry's existing key (e.g. 'blue'). Null/empty when
  // creating a fresh entry.
  entryKey: { type: String, default: '' },
  // The current entry value, shape depends on schema (object of slots OR
  // a flat hex string for lip). Null when creating fresh.
  entryValue: { type: [Object, String, null], default: null },
  // All existing keys in this palette — used to validate the name input
  // against collisions when creating new.
  existingKeys: { type: Array, default: () => [] },
  // Whether this modal is in create-new mode (shows the key input).
  isNew: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'save', 'delete'])

const schema = computed(() => PALETTE_SCHEMAS[props.paletteKey] || null)

// Local form state — seeded from props on each open so abandoning the
// modal doesn't leak edits into the next session.
const keyInput = ref('')
const keyError = ref('')
// Slot hexes for object-shaped palettes (skin/hair/eye/headband). Keyed
// by the slot name from the schema.
const slotHexes = ref({})
// The single hex for flat-shape palettes (lip).
const flatHex = ref('#ffffff')

// `_hex6OrFallback` mirrors the safeguards in AdminColorPicker — the
// native color input only accepts 6-digit values, so legacy 8-digit
// (alpha-packed) entries get truncated to 6 here. Palette slots don't
// carry opacity in this v1, so the alpha drop is fine.
function _hex6(input, fallback = '#888888') {
  const s = String(input || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7)
  return fallback
}

function _seedSlots() {
  const sch = schema.value
  if (!sch) return
  if (sch.slots === null) {
    // Flat-hex palette (lip).
    flatHex.value = _hex6(props.entryValue, '#888888')
    slotHexes.value = {}
    return
  }
  const next = {}
  for (const slot of sch.slots) {
    next[slot] = _hex6(props.entryValue?.[slot])
  }
  slotHexes.value = next
}

watch(() => props.show, (visible) => {
  if (!visible) return
  keyInput.value = props.entryKey || ''
  keyError.value = ''
  _seedSlots()
})

function _validateKey() {
  if (!props.isNew) return true
  const k = keyInput.value.trim()
  if (!k) {
    keyError.value = 'Name is required'
    return false
  }
  if (!/^[a-z0-9_]+$/.test(k)) {
    keyError.value = 'lowercase letters, numbers, underscores only'
    return false
  }
  if (props.existingKeys.includes(k)) {
    keyError.value = `"${k}" already exists in this palette`
    return false
  }
  keyError.value = ''
  return true
}

function onKeyInput() {
  // Auto-lowercase so iOS / Mac autocaps doesn't trip validation.
  const lowered = keyInput.value.toLowerCase()
  if (lowered !== keyInput.value) keyInput.value = lowered
  keyError.value = ''
}

function confirm() {
  if (!_validateKey()) return
  const k = props.isNew ? keyInput.value.trim() : props.entryKey
  const sch = schema.value
  let value
  if (!sch || sch.slots === null) {
    value = flatHex.value
  } else {
    value = {}
    for (const slot of sch.slots) value[slot] = slotHexes.value[slot] || '#888888'
  }
  emit('save', { key: k, value })
}

function requestDelete() {
  emit('delete', { key: props.entryKey })
}

const modalTitle = computed(() => {
  const verb = props.isNew ? 'New' : 'Edit'
  const type = props.paletteKey?.charAt(0).toUpperCase() + props.paletteKey?.slice(1)
  return `${verb} ${type} Entry`
})
</script>

<template>
  <BaseModal :show="show" :title="modalTitle" size="sm" @close="emit('close')">
    <div class="pe-body">
      <!-- Key (name) input — only shown when creating a fresh entry. -->
      <div v-if="isNew" class="pe-field">
        <label>Name <span class="req">*</span></label>
        <input
          v-model="keyInput"
          type="text"
          class="pe-input"
          placeholder="e.g. violet"
          maxlength="32"
          autocapitalize="none"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          @input="onKeyInput"
          @keydown.enter.prevent="confirm"
        />
        <div v-if="keyError" class="pe-error">{{ keyError }}</div>
        <div v-else class="pe-hint">lowercase letters, numbers, underscores</div>
      </div>

      <!-- Per-slot color pickers for object-shaped palettes -->
      <template v-if="schema && schema.slots">
        <div
          v-for="(slot, i) in schema.slots"
          :key="slot"
          class="pe-field pe-slot-field"
        >
          <label>{{ schema.slotLabels[i] }}</label>
          <input v-model="slotHexes[slot]" type="color" class="pe-color-input" />
          <input
            v-model="slotHexes[slot]"
            type="text"
            class="pe-hex-input"
            maxlength="7"
            placeholder="#abcdef"
          />
        </div>
      </template>

      <!-- Flat-hex palette (lip) — single color picker. -->
      <div v-else class="pe-field pe-slot-field">
        <label>Color</label>
        <input v-model="flatHex" type="color" class="pe-color-input" />
        <input
          v-model="flatHex"
          type="text"
          class="pe-hex-input"
          maxlength="7"
          placeholder="#abcdef"
        />
      </div>
    </div>

    <template #footer>
      <div class="pe-footer">
        <!-- Delete only on existing entries. Confirmation is handled by the
             parent so the modal can stay simple. -->
        <button
          v-if="!isNew"
          type="button"
          class="pe-btn danger"
          @click="requestDelete"
        >
          <Trash2 :size="14" />
          <span>Delete</span>
        </button>
        <div class="pe-footer-spacer" />
        <button type="button" class="pe-btn ghost" @click="emit('close')">Cancel</button>
        <button type="button" class="pe-btn primary" @click="confirm">
          {{ isNew ? 'Create' : 'Save' }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.pe-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pe-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pe-field label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.pe-field .req {
  color: #f87171;
}

.pe-slot-field {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.pe-slot-field label {
  flex: 0 0 90px;
}

.pe-color-input {
  width: 44px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.pe-hex-input {
  flex: 1;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-family: ui-monospace, monospace;
}

.pe-input {
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.pe-input:focus {
  outline: none;
  border-color: rgba(168, 85, 247, 0.6);
}

.pe-error {
  font-size: 0.72rem;
  color: #f87171;
}

.pe-hint {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
}

.pe-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--glass-border);
}

.pe-footer-spacer {
  flex: 1;
}

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
  transition: filter 0.15s ease, opacity 0.15s ease;
}

.pe-btn.ghost:hover {
  background: rgba(255, 255, 255, 0.05);
}

.pe-btn.primary {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border-color: transparent;
  color: white;
}

.pe-btn.danger {
  border-color: rgba(248, 113, 113, 0.6);
  color: #f87171;
}

.pe-btn.danger:hover {
  background: rgba(248, 113, 113, 0.12);
}
</style>
