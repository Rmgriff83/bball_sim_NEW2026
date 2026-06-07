<script setup>
import { ref, computed, watch } from 'vue'
import { X } from 'lucide-vue-next'
import {
  SKIN_TONES, HAIR_COLORS, EYE_COLORS, LIP_COLORS,
  resolvePieceColor,
} from '@/services/headshotComposer'

const props = defineProps({
  show: { type: Boolean, default: false },
  // Pre-fill for editing an existing piece's color.
  initialMode: { type: String, default: 'token' },  // 'token' | 'literal'
  initialToken: { type: String, default: '' },
  initialHex: { type: String, default: '#ffffff' },
  initialLabel: { type: String, default: '' },
  // 0..1, null = fully opaque (the default). Pre-fills the opacity slider.
  initialOpacity: { type: Number, default: null },
  // The active preview config — used to resolve palette tokens to their
  // live hex values for the swatch backgrounds. Without this the swatches
  // would render the static brown-keyed seed hex from TOKEN_SWATCHES and
  // diverge from what the rendered headshot actually shows after Apply,
  // making the Palette tab feel like it isn't doing anything when the
  // resolved color happens to match the piece's existing color.
  config: { type: Object, default: null },
  // The layer being edited (eye, hair, mouth, etc.). Used to suggest a
  // sensible default palette slot when the admin opts to bind a Custom
  // hex to a token via the "Bind to palette token" checkbox below.
  layerId: { type: String, default: '' },
  // MRU list from the editor's recentColors ref. Each entry:
  //   { mode: 'token', token, hex, label } OR
  //   { mode: 'literal', hex, label }
  // The Custom tab surfaces literal entries as quick swatches.
  recents: { type: Array, default: () => [] },
})

// Resolve a palette token to its current effective hex under the active
// config. Falls back to the swatch's static seed hex when no config is
// passed (defensive — keeps standalone usage of the picker valid).
function liveHexForSwatch(swatch) {
  if (!props.config) return swatch.hex
  const resolved = resolvePieceColor(
    { colorMode: 'token', colorToken: swatch.token },
    props.config,
  )
  return resolved || swatch.hex
}

// Flat list of every palette slot, used to populate the "Bind to palette
// token" dropdown when admin picks a Custom hex but wants the variant to
// follow the player's palette at generation time. Same set the Palette
// tab surfaces — kept independent so it's easy to extend either side.
const BIND_OPTIONS = [
  { token: 'skin.base', label: 'Skin Base' },
  { token: 'skin.hi',   label: 'Skin Highlight' },
  { token: 'skin.sh',   label: 'Skin Shadow' },
  { token: 'skin.deep', label: 'Skin Deep' },
  { token: 'hair.base', label: 'Hair Base' },
  { token: 'hair.hi',   label: 'Hair Highlight' },
  { token: 'hair.sh',   label: 'Hair Shadow' },
  { token: 'brow.base', label: 'Brow Base' },
  { token: 'brow.hi',   label: 'Brow Highlight' },
  { token: 'brow.sh',   label: 'Brow Shadow' },
  { token: 'eye.iris',  label: 'Eye Iris' },
  { token: 'eye.pupil', label: 'Eye Pupil' },
  { token: 'lip',       label: 'Lip' },
]

// Sensible default palette slot per layer so the dropdown opens on the
// most likely choice for that layer's primary piece. The admin can still
// pick a different slot from the full list above (e.g. eye.pupil instead
// of eye.iris for a pupil piece).
const LAYER_DEFAULT_BIND_TOKEN = {
  eye:      'eye.iris',
  hair:     'hair.base',
  eyebrows: 'brow.base',
  mouth:    'lip',
  face:     'skin.base',
  neck:     'skin.deep',
  nose:     'skin.base',
  stubble:  'hair.sh',
}

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
// Opacity 0..1 — shared between both tabs (admin can tint either a palette
// token or a custom hex). 1 = fully opaque (default + back-compat).
const opacity = ref(1)

// Custom-tab "bind to palette" toggle + slot. When checked at confirm
// time, the picker emits token mode with `bindCustomToken` as the bound
// slot — the custom hex stays useful as the in-editor preview color but
// the saved variant SVG carries `data-color-token=<slot>`, so the
// generator + composer both flex it across the player's palette. Default
// off so existing flows stay literal-hex (back-compat with everything
// authored before this knob existed).
const bindCustomToPalette = ref(false)
const bindCustomToken = ref('')

// Convert literalHex's possible 8-digit form to a clean 6-digit value +
// extract the alpha into `opacity`. Keeps the <input type="color"> happy
// (it only accepts 6-digit) and centralizes opacity in one slider.
function _normalizeIncomingHex(input) {
  const s = String(input || '#ffffff').trim()
  if (s.length === 9 && s.startsWith('#')) {
    const a = parseInt(s.slice(7, 9), 16)
    if (Number.isFinite(a)) return { hex6: s.slice(0, 7), alpha: a / 255 }
  }
  return { hex6: s, alpha: null }
}

// Reset internal state every time the modal opens with fresh props.
watch(() => props.show, (visible) => {
  if (visible) {
    mode.value = props.initialMode || (props.initialToken ? 'token' : 'literal')
    selectedToken.value = props.initialToken
    const norm = _normalizeIncomingHex(props.initialHex)
    literalHex.value = norm.hex6 || '#ffffff'
    // Explicit initialOpacity wins (e.g. from a piece in token mode where
    // hex has no packed alpha); fall back to whatever was packed into a
    // legacy 8-digit hex; default to opaque.
    opacity.value = props.initialOpacity != null
      ? props.initialOpacity
      : (norm.alpha != null ? norm.alpha : 1)
    literalLabel.value = props.initialLabel
    labelTouched.value = false
    labelError.value = ''
    // Reset the Custom-tab "bind to palette" knob every time the picker
    // opens. Default OFF (preserves the original literal-hex behavior for
    // anyone who isn't paying attention to the new toggle). Seed the
    // dropdown with the layer's natural palette slot so checking the box
    // doesn't make the admin scroll the dropdown for the obvious choice.
    bindCustomToPalette.value = false
    bindCustomToken.value = LAYER_DEFAULT_BIND_TOKEN[props.layerId] || 'eye.iris'
  }
})

// Round-trip the slider as a 0..100 integer for crisp input UX. Storage
// stays at 0..1 in `opacity`.
const opacityPct = computed({
  get: () => Math.round(opacity.value * 100),
  set: (v) => {
    const n = Math.max(0, Math.min(100, Number(v) || 0))
    opacity.value = n / 100
  },
})

function _packLiteralWithAlpha() {
  const base = literalHex.value
  if (opacity.value >= 1) return base
  const aa = Math.round(opacity.value * 255).toString(16).padStart(2, '0')
  return `${base.length === 7 ? base : base.slice(0, 7)}${aa}`
}

function pickToken(token) {
  selectedToken.value = token
}

// Literal-only slice of the recents MRU for the Custom tab. Token recents
// already have homes in the Palette tab, so showing them here would just
// duplicate. Caps at 10 for tight horizontal layout.
const literalRecents = computed(() =>
  (props.recents || []).filter(r => r?.mode === 'literal' && r.hex).slice(0, 10)
)

function applyRecent(entry) {
  literalHex.value = entry.hex
  // Prefill label if the recent carries one and the field hasn't been
  // hand-edited yet (a non-touched + empty label is a clean swap target).
  if (entry.label && (!literalLabel.value || !labelTouched.value)) {
    literalLabel.value = entry.label
  }
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
  // colorOpacity rides as a separate field on the piece model (svgPieces.js
  // serializes it to data-color-opacity). Null when fully opaque keeps
  // legacy pieces clean and consumers that ignore the field unaffected.
  const colorOpacity = opacity.value >= 1 ? null : opacity.value
  if (mode.value === 'token') {
    if (!selectedToken.value) return
    const swatch = TOKEN_SWATCHES.find(s => s.token === selectedToken.value)
    const typed = literalLabel.value.trim()
    emit('confirm', {
      colorMode: 'token',
      colorToken: selectedToken.value,
      colorHex: null,
      colorOpacity,
      // Admin's typed label wins; otherwise fall back to the swatch's
      // built-in name (e.g. "Hair Base"), then the raw token as last resort.
      label: typed || swatch?.label || selectedToken.value,
    })
  } else {
    if (!validateLabel()) {
      labelTouched.value = true
      return
    }
    // "Bind to palette token" flips this Custom emit into a token emit:
    // the picked hex was a preview convenience, but the saved piece
    // carries the palette slot so it flexes per player. Falls through to
    // a plain literal when the checkbox is off or no slot is chosen.
    if (bindCustomToPalette.value && bindCustomToken.value) {
      emit('confirm', {
        colorMode: 'token',
        colorToken: bindCustomToken.value,
        colorHex: null,
        colorOpacity,
        label: literalLabel.value.trim(),
      })
      return
    }
    emit('confirm', {
      colorMode: 'literal',
      colorToken: null,
      colorHex: literalHex.value,
      colorOpacity,
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
                :style="{ background: liveHexForSwatch(swatch) }"
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
          <!-- "Bind to palette token" — lets the admin pick any hex they
               want as a visual preview while still saving the piece as
               palette-bound, so generators + composers vary it per
               player's palette. The dropdown is hidden until the box is
               checked to keep the Custom tab uncluttered when not in use. -->
          <div class="acp-field acp-bind-field">
            <label
              class="acp-bind-toggle"
              title="By default the exact hex you pick is locked into the variant — every player sees the same color. Check this to save the piece as palette-bound instead: at generation time the color follows whichever palette slot you pick below, so it flexes across the league. The hex above stays as a preview while editing."
            >
              <input v-model="bindCustomToPalette" type="checkbox" />
              <span>Bind to palette token (varies per player)</span>
            </label>
            <select
              v-if="bindCustomToPalette"
              v-model="bindCustomToken"
              class="acp-bind-select"
            >
              <option v-for="opt in BIND_OPTIONS" :key="opt.token" :value="opt.token">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <!-- Recently used custom colors — quick re-pick from the editor's
               per-user MRU. Click loads the hex (and label if blank). Hidden
               when there are no literal recents to surface. -->
          <div v-if="literalRecents.length > 0" class="acp-recents">
            <div class="acp-group-label">Recents</div>
            <div class="acp-swatch-row">
              <button
                v-for="(entry, i) in literalRecents"
                :key="`${entry.hex}:${entry.label}:${i}`"
                type="button"
                class="acp-swatch"
                :class="{ active: literalHex.toLowerCase() === entry.hex.toLowerCase() }"
                :style="{ background: entry.hex }"
                :title="entry.label ? `${entry.label} (${entry.hex})` : entry.hex"
                @click="applyRecent(entry)"
              />
            </div>
          </div>
        </div>

        <!-- Shared opacity slider — applies to either tab. Storage is a
             0..1 float (colorOpacity). The slider UI uses 0..100% for
             clarity. -->
        <div class="acp-shared-fields">
          <div class="acp-field acp-opacity-field">
            <label>Opacity <span class="acp-opacity-readout">{{ opacityPct }}%</span></label>
            <input
              v-model.number="opacityPct"
              type="range"
              min="0"
              max="100"
              step="1"
              class="acp-opacity-slider"
            />
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

.acp-recents {
  margin-top: 12px;
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

.acp-opacity-field label {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* Bind-to-palette toggle row in the Custom tab. Stacks vertically so the
   dropdown can render on its own line below the checkbox when active. */
.acp-bind-field {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.acp-bind-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.acp-bind-toggle input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}

.acp-bind-select {
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  cursor: pointer;
}

[data-theme="light"] .acp-bind-select {
  background: rgba(0, 0, 0, 0.04);
}

.acp-opacity-readout {
  font-family: ui-monospace, monospace;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
}

.acp-opacity-slider {
  flex: 1;
  cursor: pointer;
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
