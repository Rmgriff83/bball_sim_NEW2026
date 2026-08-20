<script setup>
import { ref, computed, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { resolvePieceColor } from '@/services/headshotComposer'

const props = defineProps({
  show: { type: Boolean, default: false },
  // Whose color we're editing (for header text).
  pieceLabel: { type: String, default: '' },
  // Active headshot config — resolves palette tokens to live hex values
  // for the swatch grid.
  config: { type: Object, required: true },
  // Pre-fill: hex like '#abc123' OR palette token like 'hair.base'.
  initialValue: { type: String, default: '' },
})

const emit = defineEmits(['close', 'confirm'])

// All palette slots the composer knows about, grouped for visual scanning.
const PALETTE_GROUPS = [
  { label: 'Skin', tokens: [
    ['skin.base', 'Base'], ['skin.hi', 'Highlight'],
    ['skin.sh', 'Shadow'], ['skin.deep', 'Deep'],
  ] },
  { label: 'Hair', tokens: [
    ['hair.base', 'Base'], ['hair.hi', 'Highlight'], ['hair.sh', 'Shadow'],
  ] },
  { label: 'Brow', tokens: [
    ['brow.base', 'Base'], ['brow.hi', 'Highlight'], ['brow.sh', 'Shadow'],
  ] },
  { label: 'Eye', tokens: [
    ['eye.iris', 'Iris'], ['eye.pupil', 'Pupil'],
  ] },
  { label: 'Lip', tokens: [
    ['lip', 'Lip'],
  ] },
]

const mode = ref('palette')
const selectedToken = ref('')
const literalHex = ref('#ffffff')
// Custom-tab opacity, 0..1. Confirmed values get packed into 8-digit hex
// (#RRGGBBAA) so they round-trip through the existing pieceColors string
// override format with no schema changes.
const literalOpacity = ref(1)
const literalOpacityPct = computed({
  get: () => Math.round(literalOpacity.value * 100),
  set: (v) => {
    const n = Math.max(0, Math.min(100, Number(v) || 0))
    literalOpacity.value = n / 100
  },
})

// Hex validation: 3 or 6 hex digits, optionally prefixed with '#'. Mirrors
// the AdminColorPicker's tolerant input handling.
function _isValidHex(v) {
  return /^#?[0-9a-fA-F]{6}$/.test(v) || /^#?[0-9a-fA-F]{3}$/.test(v)
}

watch(() => props.show, (visible) => {
  if (!visible) return
  const v = String(props.initialValue || '').trim()
  literalOpacity.value = 1
  if (v.startsWith('#')) {
    mode.value = 'custom'
    selectedToken.value = ''
    // 8-digit hex pre-fills the slider; 6-digit defaults to opaque.
    if (v.length === 9) {
      const a = parseInt(v.slice(7, 9), 16)
      if (Number.isFinite(a)) literalOpacity.value = a / 255
      literalHex.value = v.slice(0, 7)
    } else {
      literalHex.value = v
    }
  } else if (v) {
    mode.value = 'palette'
    selectedToken.value = v
    literalHex.value = '#ffffff'
  } else {
    mode.value = 'palette'
    selectedToken.value = ''
    literalHex.value = '#ffffff'
  }
})

function tokenHex(token) {
  return resolvePieceColor({ colorMode: 'token', colorToken: token }, props.config) || '#000'
}

function confirm() {
  if (mode.value === 'palette') {
    if (!selectedToken.value) return
    emit('confirm', selectedToken.value)
  } else {
    if (!_isValidHex(literalHex.value)) return
    let v = literalHex.value.startsWith('#') ? literalHex.value : `#${literalHex.value}`
    // Pack opacity into an 8-digit hex when < 1. The composer's
    // _resolvePieceFills splits the alpha back off for fill emission.
    if (literalOpacity.value < 1) {
      const aa = Math.round(literalOpacity.value * 255).toString(16).padStart(2, '0')
      v = `${v}${aa}`
    }
    emit('confirm', v)
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="pcp-backdrop" @click.self="emit('close')">
      <div class="pcp-modal">
        <header class="pcp-header">
          <div class="pcp-title">
            <h3>{{ $t('Color') }}</h3>
            <p v-if="pieceLabel" class="pcp-piece-label">{{ $tDynamic(pieceLabel) }}</p>
          </div>
          <button class="pcp-close" @click="emit('close')"><X :size="16" /></button>
        </header>

        <div class="pcp-tabs">
          <button
            type="button"
            class="pcp-tab"
            :class="{ active: mode === 'palette' }"
            @click="mode = 'palette'"
          >{{ $t('Palette') }}</button>
          <button
            type="button"
            class="pcp-tab"
            :class="{ active: mode === 'custom' }"
            @click="mode = 'custom'"
          >{{ $t('Custom') }}</button>
        </div>

        <div v-if="mode === 'palette'" class="pcp-tab-body">
          <p class="pcp-hint">
            {{ $t('Palette colors auto-follow the rest of your headshot — change your skin or hair color later and this piece updates too.') }}
          </p>
          <div v-for="group in PALETTE_GROUPS" :key="group.label" class="pcp-group">
            <div class="pcp-group-label">{{ $tDynamic(group.label) }}</div>
            <div class="pcp-swatch-row">
              <button
                v-for="[token, label] in group.tokens"
                :key="token"
                type="button"
                class="pcp-swatch"
                :class="{ active: selectedToken === token }"
                :style="{ background: tokenHex(token) }"
                :title="`${$tDynamic(group.label)} ${$tDynamic(label)}`"
                @click="selectedToken = token"
              />
            </div>
          </div>
        </div>

        <div v-else class="pcp-tab-body">
          <p class="pcp-hint">
            {{ $t("A custom color stays locked to whatever hex you pick — it won't follow your palette choices.") }}
          </p>
          <div class="pcp-custom-row">
            <input v-model="literalHex" type="color" class="pcp-color-input" />
            <input
              v-model="literalHex"
              type="text"
              class="pcp-hex-input"
              maxlength="7"
              :placeholder="'#ffaa00'"
            />
          </div>
          <div class="pcp-opacity-row">
            <label>{{ $t('Opacity') }} <span class="pcp-opacity-readout">{{ literalOpacityPct }}%</span></label>
            <input
              v-model.number="literalOpacityPct"
              type="range"
              min="0"
              max="100"
              step="1"
              class="pcp-opacity-slider"
            />
          </div>
        </div>

        <footer class="pcp-footer">
          <button class="pcp-btn ghost" @click="emit('close')">{{ $t('Cancel') }}</button>
          <button class="pcp-btn primary" @click="confirm">{{ $t('Apply') }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pcp-backdrop {
  position: fixed; inset: 0;
  background: rgba(10, 8, 16, 0.65);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  z-index: 60;
}

.pcp-modal {
  width: 340px;
  max-height: 80vh;
  display: flex; flex-direction: column;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  overflow: hidden;
}

.pcp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--glass-border);
}

.pcp-title h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.pcp-piece-label {
  margin: 2px 0 0;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
}

.pcp-close {
  background: transparent; border: none; padding: 4px;
  color: var(--color-text-secondary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}

.pcp-tabs {
  display: flex;
  border-bottom: 1px solid var(--glass-border);
}

.pcp-tab {
  flex: 1;
  padding: 10px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.pcp-tab.active {
  color: var(--color-text-primary);
  border-bottom-color: rgba(168, 85, 247, 0.85);
}

.pcp-tab-body {
  padding: 14px 16px;
  overflow-y: auto;
}

.pcp-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  margin: 0 0 12px;
  line-height: 1.4;
}

.pcp-group {
  margin-bottom: 12px;
}

.pcp-group-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  margin-bottom: 6px;
}

.pcp-swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pcp-swatch {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 2px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  padding: 0;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.pcp-swatch:hover {
  transform: scale(1.06);
}

.pcp-swatch.active {
  border-color: #a855f7;
  box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.3);
}

.pcp-custom-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pcp-opacity-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.pcp-opacity-row label {
  flex: 0 0 auto;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.pcp-opacity-readout {
  font-family: ui-monospace, monospace;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
}

.pcp-opacity-slider {
  flex: 1;
  cursor: pointer;
}

.pcp-color-input {
  width: 44px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.pcp-hex-input {
  flex: 1;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-family: ui-monospace, monospace;
}

.pcp-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--glass-border);
}

.pcp-btn {
  padding: 8px 16px;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  background: transparent;
  color: var(--color-text-primary);
}

.pcp-btn.ghost:hover {
  background: rgba(255, 255, 255, 0.05);
}

.pcp-btn.primary {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border-color: transparent;
  color: white;
}
</style>
