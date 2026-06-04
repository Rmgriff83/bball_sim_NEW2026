<script setup>
import { ref, computed, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { SKIN_TONES, HAIR_COLORS, EYE_COLORS, LIP_COLORS } from '@/services/headshotComposer'

const props = defineProps({
  show: { type: Boolean, default: false },
  // Pre-fill for editing an existing piece's color.
  initialMode: { type: String, default: 'token' },  // 'token' | 'literal'
  initialToken: { type: String, default: '' },
  initialHex: { type: String, default: '#ffffff' },
  initialLabel: { type: String, default: '' },
})

const emit = defineEmits(['close', 'confirm'])

// Each entry: { token, label, hex, palette }. palette name is for visual grouping.
const TOKEN_SWATCHES = [
  ...Object.entries(SKIN_TONES).flatMap(([key, p]) => [
    { token: 'skin.base', label: 'Skin Base',     hex: p.base, palette: 'Skin', when: key === 'brown' },
    { token: 'skin.hi',   label: 'Skin Highlight', hex: p.hi,   palette: 'Skin', when: key === 'brown' },
    { token: 'skin.sh',   label: 'Skin Shadow',    hex: p.sh,   palette: 'Skin', when: key === 'brown' },
    { token: 'skin.deep', label: 'Skin Deep',      hex: p.deep, palette: 'Skin', when: key === 'brown' },
  ]).filter(s => s.when),
  ...Object.entries(HAIR_COLORS).flatMap(([key, p]) => [
    { token: 'hair.base', label: 'Hair Base',     hex: p.base, palette: 'Hair', when: key === 'brown' },
    { token: 'hair.hi',   label: 'Hair Highlight', hex: p.hi,   palette: 'Hair', when: key === 'brown' },
    { token: 'hair.sh',   label: 'Hair Shadow',    hex: p.sh,   palette: 'Hair', when: key === 'brown' },
  ]).filter(s => s.when),
  ...Object.entries(HAIR_COLORS).flatMap(([key, p]) => [
    { token: 'brow.base', label: 'Brow Base',     hex: p.base, palette: 'Brow', when: key === 'brown' },
    { token: 'brow.hi',   label: 'Brow Highlight', hex: p.hi,   palette: 'Brow', when: key === 'brown' },
    { token: 'brow.sh',   label: 'Brow Shadow',    hex: p.sh,   palette: 'Brow', when: key === 'brown' },
  ]).filter(s => s.when),
  ...Object.entries(EYE_COLORS).flatMap(([key, p]) => [
    { token: 'eye.iris',  label: 'Eye Iris',  hex: p.iris,  palette: 'Eye', when: key === 'brown' },
    { token: 'eye.pupil', label: 'Eye Pupil', hex: p.pupil, palette: 'Eye', when: key === 'brown' },
  ]).filter(s => s.when),
  ...Object.entries(LIP_COLORS).flatMap(([key, hex]) => [
    { token: 'lip', label: 'Lip', hex, palette: 'Lip', when: key === 'warm' },
  ]).filter(s => s.when),
]

const groupedSwatches = computed(() => {
  const groups = {}
  for (const swatch of TOKEN_SWATCHES) {
    if (!groups[swatch.palette]) groups[swatch.palette] = []
    groups[swatch.palette].push(swatch)
  }
  return Object.entries(groups).map(([palette, swatches]) => ({ palette, swatches }))
})

const mode = ref(props.initialMode)
const selectedToken = ref(props.initialToken)
const literalHex = ref(props.initialHex)
const literalLabel = ref(props.initialLabel)
const labelTouched = ref(false)
const labelError = ref('')

// Reset internal state every time the modal opens with fresh props.
watch(() => props.show, (visible) => {
  if (visible) {
    mode.value = props.initialMode || (props.initialToken ? 'token' : 'literal')
    selectedToken.value = props.initialToken
    literalHex.value = props.initialHex || '#ffffff'
    literalLabel.value = props.initialLabel
    labelTouched.value = false
    labelError.value = ''
  }
})

function pickToken(token) {
  selectedToken.value = token
}

// Default label hint when in Palette mode — derived from the currently
// selected swatch so the placeholder reflects what the field would default
// to if the admin leaves it blank.
const activeSwatchLabel = computed(() => {
  if (!selectedToken.value) return ''
  return TOKEN_SWATCHES.find(s => s.token === selectedToken.value)?.label ?? ''
})

const labelPlaceholder = computed(() =>
  mode.value === 'token'
    ? (activeSwatchLabel.value || 'e.g. Hair Base')
    : 'e.g. Hair Glow'
)

function onLabelBlur() {
  labelTouched.value = true
  validateLabel()
}

function validateLabel() {
  // Custom (literal) mode REQUIRES an explicit label — the piece has no
  // palette token to derive a default from. Palette (token) mode falls
  // back to the swatch's built-in name if the field is left blank.
  const trimmed = literalLabel.value.trim()
  if (mode.value === 'literal' && !trimmed) {
    labelError.value = 'Label is required'
    return false
  }
  labelError.value = ''
  return true
}

function confirm() {
  if (mode.value === 'token') {
    if (!selectedToken.value) return
    const swatch = TOKEN_SWATCHES.find(s => s.token === selectedToken.value)
    const typed = literalLabel.value.trim()
    emit('confirm', {
      colorMode: 'token',
      colorToken: selectedToken.value,
      colorHex: null,
      // Admin's typed label wins; otherwise fall back to the swatch's
      // built-in name (e.g. "Hair Base"), then the raw token as last resort.
      label: typed || swatch?.label || selectedToken.value,
    })
  } else {
    if (!validateLabel()) {
      labelTouched.value = true
      return
    }
    emit('confirm', {
      colorMode: 'literal',
      colorToken: null,
      colorHex: literalHex.value,
      label: literalLabel.value.trim(),
    })
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="acp-backdrop" @click.self="emit('close')">
      <div class="acp-modal">
        <header class="acp-header">
          <h3>Piece Color</h3>
          <button class="acp-close" @click="emit('close')"><X :size="16" /></button>
        </header>

        <div class="acp-tabs">
          <button class="acp-tab" :class="{ active: mode === 'token' }" @click="mode = 'token'">Palette</button>
          <button class="acp-tab" :class="{ active: mode === 'literal' }" @click="mode = 'literal'">Custom</button>
        </div>

        <div v-if="mode === 'token'" class="acp-tab-body">
          <p class="acp-hint">
            Palette colors auto-flex when users pick their skin/hair/eye/lip
            tones in their headshot editor.
          </p>
          <div v-for="group in groupedSwatches" :key="group.palette" class="acp-group">
            <div class="acp-group-label">{{ group.palette }}</div>
            <div class="acp-swatch-row">
              <button
                v-for="swatch in group.swatches"
                :key="swatch.token"
                type="button"
                class="acp-swatch"
                :class="{ active: selectedToken === swatch.token }"
                :style="{ background: swatch.hex }"
                :title="`${swatch.label} (${swatch.token})`"
                @click="pickToken(swatch.token)"
              />
            </div>
          </div>
        </div>

        <div v-else class="acp-tab-body">
          <p class="acp-hint">
            A custom color is locked to the hex you pick. Users can override
            it per-piece in their editor (via the label below).
          </p>
          <div class="acp-field">
            <label>Color</label>
            <input v-model="literalHex" type="color" class="acp-color-input" />
            <input v-model="literalHex" type="text" class="acp-hex-input" maxlength="7" />
          </div>
        </div>

        <!-- Shared label field — visible regardless of which tab is active so
             the admin can name a piece in either mode. Required in Custom
             mode (no swatch fallback); optional in Palette mode (falls back
             to the selected swatch's built-in label). -->
        <div class="acp-shared-fields">
          <div class="acp-field">
            <label>
              Label
              <span class="req">*</span>
            </label>
            <input
              v-model="literalLabel"
              type="text"
              class="acp-text-input"
              :placeholder="labelPlaceholder"
              maxlength="40"
              @blur="onLabelBlur"
            />
            <div v-if="labelError && labelTouched" class="acp-error">{{ labelError }}</div>
          </div>
        </div>

        <footer class="acp-footer">
          <button class="acp-btn ghost" @click="emit('close')">Cancel</button>
          <button class="acp-btn primary" @click="confirm">Confirm</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.acp-backdrop {
  position: fixed; inset: 0;
  background: rgba(10, 8, 16, 0.65);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  z-index: 60;
}

.acp-modal {
  width: 360px;
  max-height: 80vh;
  display: flex; flex-direction: column;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  overflow: hidden;
}

.acp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--glass-border);
}

.acp-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.acp-close {
  background: transparent; border: none; padding: 4px;
  color: var(--color-text-secondary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}

.acp-tabs {
  display: flex;
  border-bottom: 1px solid var(--glass-border);
}

.acp-tab {
  flex: 1;
  padding: 10px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.acp-tab.active {
  color: var(--color-text-primary);
  border-bottom-color: rgba(168, 85, 247, 0.8);
}

.acp-tab-body {
  padding: 14px 16px;
  overflow-y: auto;
}

/* Shared field area (label) — visible under either tab body, separated by
   a subtle divider so it reads as "applies to the current piece" rather
   than belonging to one tab in particular. */
.acp-shared-fields {
  padding: 12px 16px;
  border-top: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.02);
}

.acp-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  margin: 0 0 12px;
  line-height: 1.5;
}

.acp-group {
  margin-bottom: 12px;
}

.acp-group-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  margin-bottom: 6px;
}

.acp-swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.acp-swatch {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 2px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  padding: 0;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.acp-swatch:hover {
  transform: scale(1.05);
}

.acp-swatch.active {
  border-color: #a855f7;
  box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.3);
}

.acp-field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.acp-field label {
  flex: 0 0 60px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.acp-field label .req {
  color: #f87171;
}

.acp-color-input {
  width: 36px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.acp-hex-input,
.acp-text-input {
  flex: 1;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-family: inherit;
}

.acp-hex-input {
  font-family: ui-monospace, monospace;
}

.acp-error {
  flex-basis: 100%;
  font-size: 0.7rem;
  color: #f87171;
  margin-left: 68px;
}

.acp-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--glass-border);
}

.acp-btn {
  padding: 8px 16px;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  background: transparent;
  color: var(--color-text-primary);
}

.acp-btn.ghost:hover {
  background: rgba(255, 255, 255, 0.05);
}

.acp-btn.primary {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border-color: transparent;
  color: white;
}
</style>
