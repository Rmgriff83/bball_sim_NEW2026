<script setup>
import { computed, ref } from 'vue'
import { RotateCcw, Palette, ChevronDown } from 'lucide-vue-next'
import {
  composeSvg, LAYERS,
  getCurrentVariantKey, getVariantSource, resolvePieceColor,
  listAllVariantsForAudience, listJawIndicesForAudience, layerContentVersion,
  SKIN_TONES, HAIR_COLORS, EYE_COLORS, LIP_COLORS,
} from '@/services/headshotComposer'
import { parseVariantPieces } from '@/services/svgPieces'
import PieceColorPicker from './PieceColorPicker.vue'

// Synthetic layer id for the palette-swap mode. Not in LAYERS (it isn't a
// renderable layer — it just bulk-edits the skin/hair/eye/lip config fields
// that the palette tokens resolve through). The layer pill row treats it
// as a special tile and the body switches to a swatch-grid view when active.
const PALETTE_LAYER_ID = 'palette'

// Pretty labels for the palette config keys. Falls back to a title-cased
// version of the underscore-separated key for anything not listed here so
// new palette additions don't have to touch this map.
const PALETTE_VALUE_LABELS = {
  dark_brown:   'Dark Brown',
  light_brown:  'Light Brown',
  dirty_blonde: 'Dirty Blonde',
}
function _formatPaletteLabel(key) {
  if (PALETTE_VALUE_LABELS[key]) return PALETTE_VALUE_LABELS[key]
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// What the palette pill renders. Each row covers one config field (skin,
// hair, eye, lip) and surfaces every entry in its palette map as a swatch.
// `swatchHex` is the visible chip color for each option; `configKey` is
// the field on `config` we write when the user clicks. Order matters
// visually — skin first, then hair (which drives brow), then eye, then lip.
const PALETTE_ROWS = [
  {
    label: 'Skin',
    configKey: 'skin',
    options: Object.entries(SKIN_TONES).map(([key, p]) => ({
      key, label: _formatPaletteLabel(key), swatchHex: p.base,
    })),
  },
  {
    label: 'Hair',
    configKey: 'hair',
    options: Object.entries(HAIR_COLORS).map(([key, p]) => ({
      key, label: _formatPaletteLabel(key), swatchHex: p.base,
    })),
  },
  {
    label: 'Eye',
    configKey: 'eye',
    options: Object.entries(EYE_COLORS).map(([key, p]) => ({
      key, label: _formatPaletteLabel(key), swatchHex: p.iris,
    })),
  },
  {
    label: 'Lip',
    configKey: 'lip',
    options: Object.entries(LIP_COLORS).map(([key, hex]) => ({
      key, label: _formatPaletteLabel(key), swatchHex: hex,
    })),
  },
]

const props = defineProps({
  layerId: { type: String, default: null },
  config: { type: Object, required: true },
  inSheet: { type: Boolean, default: false },
  // When true, drop the fixed-position floating layout and render inline
  // as a regular column. The caller is responsible for placing this
  // component inside a flex/grid container that sizes it.
  embedded: { type: Boolean, default: false },
  // Layer list for the in-header pill picker. When non-empty the picker
  // shows pills along the top of this same box and the standalone
  // bottom-nav can be dropped.
  layers: { type: Array, default: () => [] },
  // Which audience this picker is editing. Filters the styleVariants grid
  // to only show variants tagged for that audience. Defaults to 'player'
  // so existing callers (player customize screen) keep their behavior.
  audience: { type: String, default: 'player' },
})

const emit = defineEmits(['update:config', 'close', 'select-layer'])

function selectLayer(id) {
  if (id !== props.layerId) emit('select-layer', id)
}

const layer = computed(() => LAYERS.find(l => l.id === props.layerId) ?? null)

// True when the pill row's special "Palette" tile is selected — drives the
// body to show palette swatches instead of layer style/piece controls.
const isPaletteMode = computed(() => props.layerId === PALETTE_LAYER_ID)

// Which user-facing layers each palette field repaints. When the user
// swaps a palette here we also clear any per-piece overrides on those
// layers — literal-hex overrides (the kind the Custom tab of
// PieceColorPicker writes) would otherwise win over the new palette
// token in _resolvePieceFills and the preview would look frozen.
//
// Audited against the actual token usage in every variant file:
//   skin.* → face, neck, nose
//   hair.* → hair, stubble (stubble uses hair.sh)
//   brow.* → eyebrows (brow.* defaults to hair.* via normalizeConfig,
//            so a hair swap should also clear eyebrows)
//   eye.*  → eyes
//   lip    → mouth
const PALETTE_TO_BOUND_LAYERS = {
  skin: ['face', 'neck', 'nose'],
  hair: ['hair', 'eyebrows', 'stubble'],
  eye:  ['eyes'],
  lip:  ['mouth'],
}

function setPaletteValue(configKey, value) {
  if (props.config?.[configKey] === value) return
  const next = { ...props.config, [configKey]: value }
  // Brows track hair by default — `normalizeConfig`'s
  //   eyebrowColor: config.eyebrowColor in HAIR_COLORS ? config.eyebrowColor : hair
  // only falls back to hair when eyebrowColor isn't a valid key, but on
  // an existing player it almost always IS a valid key (seeded at save
  // time), so without this explicit follow-through a Hair swap leaves
  // brows stuck on the previous color. Picking Hair also re-points
  // eyebrowColor so the brow palette tokens (brow.base/hi/sh) resolve
  // through the new hair entry on the next composeSvg pass. Per-piece
  // brow overrides are still cleared via PALETTE_TO_BOUND_LAYERS below,
  // so any custom-tinted brow piece reverts to following the palette too.
  if (configKey === 'hair') {
    next.eyebrowColor = value
  }
  const boundLayers = PALETTE_TO_BOUND_LAYERS[configKey] || []
  if (boundLayers.length > 0 && next.pieceColors) {
    const cleared = { ...next.pieceColors }
    let mutated = false
    for (const layerId of boundLayers) {
      if (cleared[layerId]) {
        delete cleared[layerId]
        mutated = true
      }
    }
    if (mutated) {
      if (Object.keys(cleared).length > 0) {
        next.pieceColors = cleared
      } else {
        delete next.pieceColors
      }
    }
  }
  emit('update:config', next)
}

// Style variants for the current layer (e.g. hair styles, jaw widths),
// filtered by the active audience.
//   - STRING-keyed layers (hair, eyes, etc.): intersect with
//     listAllVariantsForAudience (filenames use hyphens; config keys use
//     underscores — translate at the boundary).
//   - face (integer-keyed via jawWidth → JAW_NAMES[audience]): only show
//     indices that have a file in this audience's folders.
//   - eyebrows: file-based picker too. The audience folder may contain
//     admin-authored custom variants ("custom-arch") whose names don't
//     match the canonical thickness-angle composition; showing every file
//     ensures they're selectable. Picking writes to browVariantOverride
//     (composeSvg's eyebrows path honors that field).
const styleVariants = computed(() => {
  void layerContentVersion.value
  const all = layer.value?.styleVariants ?? null
  if (!all) return null
  if (props.layerId === 'face') {
    return listJawIndicesForAudience(props.audience)
  }
  if (props.layerId === 'eyebrows') {
    return listAllVariantsForAudience('eyebrows', props.audience)
  }
  if (all.some(v => typeof v === 'number')) return all
  const allowed = new Set(listAllVariantsForAudience(props.layerId, props.audience))
  // 'none' is a virtual variant (no file on disk) used by headband/stubble
  // to mean "hide this layer". Without this carve-out the disk-backed filter
  // would strip it from the picker even though composeSvg fully supports it
  // — leaving users with no way to remove a headband once one is on.
  return all.filter(v => v === 'none' || allowed.has(String(v).replace(/_/g, '-')))
})

// Color palette swatches — only shown for layers that declare their own
// colorPalette. Derived-color layers (stubble, nose, neck) intentionally
// What field in config does this layer's style toggle control?
const styleConfigKey = computed(() => layer.value?.styleKey ?? null)
const currentStyleValue = computed(() => {
  // Eyebrows pick a filename (browVariantOverride) instead of a thickness
  // integer — falls back to the composed canonical thickness-angle filename
  // when no override is set, so the active variant is always reflected.
  if (props.layerId === 'eyebrows') {
    return props.config.browVariantOverride
      || getCurrentVariantKey('eyebrows', props.config, props.audience)
  }
  if (!styleConfigKey.value) return null
  return props.config[styleConfigKey.value]
})

function setStyle(variant) {
  // Eyebrows: write to browVariantOverride so custom filenames (admin-
  // authored variants that don't match thickness-angle) work.
  if (props.layerId === 'eyebrows') {
    emit('update:config', { ...props.config, browVariantOverride: variant })
    return
  }
  if (!styleConfigKey.value) return
  // Face: composeSvg/configFromSvg round-trip a `data-file` attribute into
  // `faceVariantOverride`, which then beats the integer jawWidth picker on
  // every subsequent render. Clear the override when the user picks a new
  // jaw so their selection actually takes effect.
  if (props.layerId === 'face') {
    const next = { ...props.config, [styleConfigKey.value]: variant }
    delete next.faceVariantOverride
    emit('update:config', next)
    return
  }
  emit('update:config', { ...props.config, [styleConfigKey.value]: variant })
}

// Thumbnail for a style variant — compose the full headshot with just this
// layer's style overridden. Memoized via computed map.
function thumbnailFor(variant) {
  if (props.layerId === 'eyebrows') {
    return composeSvg({ ...props.config, browVariantOverride: variant }, null, props.audience)
  }
  if (!styleConfigKey.value) return ''
  // Face thumbnails: strip faceVariantOverride from the preview config too,
  // otherwise every thumb composes the same locked face regardless of which
  // jawWidth integer we're previewing.
  if (props.layerId === 'face') {
    const previewConfig = { ...props.config, [styleConfigKey.value]: variant }
    delete previewConfig.faceVariantOverride
    return composeSvg(previewConfig, null, props.audience)
  }
  return composeSvg({ ...props.config, [styleConfigKey.value]: variant }, null, props.audience)
}

function labelForVariant(variant) {
  if (typeof variant === 'number') return String(variant)
  return String(variant).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ----- Phase 3: per-piece color overrides -----
// Parse the active variant's source SVG to expose its admin-defined pieces
// (each with a `label`). The user picks colors for individual pieces via
// the swatch UI below; the composer applies them per-piece independently
// of palette tokens.
const layerPieces = computed(() => {
  if (!props.layerId) return []
  const variantKey = getCurrentVariantKey(props.layerId, props.config, props.audience)
  if (!variantKey) return []
  const source = getVariantSource(props.layerId, variantKey, props.audience)
  if (!source) return []
  // Stable order = SVG document order. Skip pieces without a usable label
  // so we don't dump cryptic ids into the UI.
  return parseVariantPieces(source).filter(p => p.label)
})

// Resolved hex shown in each piece's swatch — user override if present
// (which can be either a hex string or a palette token name), otherwise
// the admin-set token/literal color resolved through the active config's
// palette.
function pieceColorFor(piece) {
  const override = props.config?.pieceColors?.[props.layerId]?.[piece.label]
  if (override) {
    if (typeof override === 'string' && override.startsWith('#')) return override
    // Palette token override — resolve to current palette hex.
    return resolvePieceColor(
      { colorMode: 'token', colorToken: override },
      props.config,
    ) || '#999999'
  }
  return resolvePieceColor(piece, props.config) || '#999999'
}

function hasOverride(piece) {
  return Boolean(props.config?.pieceColors?.[props.layerId]?.[piece.label])
}

// `value` is either a hex string ('#abc123') or a palette token name
// ('hair.base'). The composer handles both at render time.
function setPieceColor(piece, value) {
  const layerId = props.layerId
  const prev = props.config?.pieceColors || {}
  const layerMap = { ...(prev[layerId] || {}), [piece.label]: value }
  emit('update:config', {
    ...props.config,
    pieceColors: { ...prev, [layerId]: layerMap },
  })
}

// ----- piece color picker modal state -----
const pickerOpen = ref(false)
const pickerPiece = ref(null)

// Piece-colors dropdown collapsed state. Closed by default so the section
// doesn't push the rest of the picker around — once the user expands it,
// the list anchors absolute against the .ctx-pieces-toggle button so it
// floats over the variant body instead of growing it.
const piecesOpen = ref(false)
function togglePieces() {
  piecesOpen.value = !piecesOpen.value
}
const pickerInitial = computed(() => {
  if (!pickerPiece.value) return ''
  const override = props.config?.pieceColors?.[props.layerId]?.[pickerPiece.value.label]
  if (override) return override
  // Fall back to the piece's authored color so reopening shows the current
  // state, not an empty picker.
  if (pickerPiece.value.colorMode === 'token' && pickerPiece.value.colorToken) {
    return pickerPiece.value.colorToken
  }
  if (pickerPiece.value.colorMode === 'literal' && pickerPiece.value.colorHex) {
    return pickerPiece.value.colorHex
  }
  return ''
})

function openPieceColorPicker(piece) {
  pickerPiece.value = piece
  pickerOpen.value = true
}

function onPickerConfirm(value) {
  if (pickerPiece.value) setPieceColor(pickerPiece.value, value)
  pickerOpen.value = false
  pickerPiece.value = null
}

function onPickerClose() {
  pickerOpen.value = false
  pickerPiece.value = null
}

function clearPieceColor(piece) {
  const layerId = props.layerId
  const prev = props.config?.pieceColors || {}
  const layerMap = { ...(prev[layerId] || {}) }
  delete layerMap[piece.label]
  const nextAll = { ...prev }
  if (Object.keys(layerMap).length === 0) {
    delete nextAll[layerId]
  } else {
    nextAll[layerId] = layerMap
  }
  emit('update:config', { ...props.config, pieceColors: nextAll })
}
</script>

<template>
  <div
    v-if="layer || isPaletteMode"
    class="context-menu"
    :class="{ sheet: inSheet, embedded }"
    data-tour="editor-context-menu"
  >
    <header class="ctx-header">
      <!-- Pill picker at the top of the combined box, mirroring the admin
           variant strip's layout. Hidden when no `layers` prop is passed
           so the bottom-nav-only callers keep their old single-section
           header. -->
      <!-- Wrapper exists so mobile can show a fade-to-bg overlay on the
           right edge of the (now-horizontally-scrolling) pill row,
           hinting that more pills exist if you scroll. Desktop is
           wrap-friendly so the wrapper is just a transparent passthrough. -->
      <div
        v-if="layers.length > 0"
        class="ctx-pills-wrap"
        data-tour="editor-layer-pills"
      >
        <nav class="ctx-pills">
          <button
            v-for="l in layers"
            :key="l.id"
            type="button"
            class="ctx-pill"
            :class="{ active: l.id === layerId }"
            @click="selectLayer(l.id)"
          >
            {{ l.label }}
          </button>
          <!-- Synthetic Palette pill — switches the body to the swatch-grid
               view that bulk-edits the skin/hair/eye/lip config fields.
               Visually distinct (icon + accent border) so users notice it
               sits outside the layer list. -->
          <button
            type="button"
            class="ctx-pill ctx-pill-palette"
            :class="{ active: isPaletteMode }"
            title="Swap the whole palette"
            @click="selectLayer('palette')"
          >
            <Palette :size="12" />
            <span>Palette</span>
          </button>
        </nav>
      </div>
    </header>

    <!-- Style variants grid -->
    <section v-if="!isPaletteMode && styleVariants" class="ctx-section">
      <h4>Style</h4>
      <div class="style-grid">
        <button
          v-for="variant in styleVariants"
          :key="variant"
          type="button"
          class="style-cell"
          :class="{ active: currentStyleValue === variant }"
          :title="labelForVariant(variant)"
          @click="setStyle(variant)"
        >
          <div class="style-thumb" v-html="thumbnailFor(variant)" />
          <span class="style-label">{{ labelForVariant(variant) }}</span>
        </button>
      </div>
    </section>


    <!-- Per-piece colors — collapsed by default. The dropdown panel
         absolute-positions over the section below so opening it doesn't
         resize the menu or push the variant grid around. Tapping outside
         closes it via the .ctx-pieces-backdrop scrim. -->
    <section v-if="!isPaletteMode && layerPieces.length > 0" class="ctx-section ctx-pieces-section">
      <button
        type="button"
        class="ctx-pieces-toggle"
        :class="{ open: piecesOpen }"
        :aria-expanded="piecesOpen"
        @click="togglePieces"
      >
        <span>Piece Colors</span>
        <span class="ctx-pieces-toggle-meta">
          <span class="ctx-pieces-count">{{ layerPieces.length }}</span>
          <ChevronDown :size="14" class="ctx-pieces-chev" />
        </span>
      </button>

      <!-- Click-outside scrim. Behind the dropdown but in front of the
           surrounding body so a tap anywhere outside the dropdown closes
           it without firing the underlying control. -->
      <div
        v-if="piecesOpen"
        class="ctx-pieces-backdrop"
        @click="piecesOpen = false"
      />

      <div v-if="piecesOpen" class="ctx-pieces-dropdown" role="menu">
        <div class="piece-list">
          <div v-for="piece in layerPieces" :key="piece.id" class="piece-row">
            <button
              type="button"
              class="piece-swatch-btn"
              :title="`Set color for ${piece.label}`"
              @click="openPieceColorPicker(piece)"
            >
              <span class="piece-swatch" :style="{ background: pieceColorFor(piece) }" />
              <span class="piece-label">{{ piece.label }}</span>
            </button>
            <button
              v-if="hasOverride(piece)"
              type="button"
              class="piece-reset"
              title="Reset to default color"
              @click="clearPieceColor(piece)"
            >
              <RotateCcw :size="12" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- No edits for derived-only layers (none currently — neck now has
         its own style variants too, but kept defensively in case a future
         layer ends up purely derived). -->
    <p
      v-if="!isPaletteMode && !styleVariants && layerPieces.length === 0"
      class="derived-note"
    >
      This layer follows the Face skin tone. Change it from the Face layer.
    </p>

    <!-- Palette swap grid. Each row is a config field (skin/hair/eye/lip);
         each swatch writes that field. The headshot preview is computed
         from config and recomposes automatically, and any open
         PieceColorPicker's swatches re-resolve through the same config
         object — so users see palette + piece swatches update in lockstep
         the moment a swatch here is clicked. -->
    <section v-if="isPaletteMode" class="ctx-section">
      <p class="palette-hint">
        Pick a palette slot to recolor everything bound to it — the headshot,
        every layer's pieces, and any color picker you have open all update
        together.
      </p>
      <div v-for="row in PALETTE_ROWS" :key="row.configKey" class="palette-row">
        <div class="palette-row-label">{{ row.label }}</div>
        <div class="palette-swatch-row">
          <button
            v-for="opt in row.options"
            :key="opt.key"
            type="button"
            class="palette-swatch"
            :class="{ active: config?.[row.configKey] === opt.key }"
            :style="{ background: opt.swatchHex }"
            :title="opt.label"
            :aria-label="`${row.label} ${opt.label}`"
            @click="setPaletteValue(row.configKey, opt.key)"
          />
        </div>
      </div>
    </section>

    <PieceColorPicker
      :show="pickerOpen"
      :piece-label="pickerPiece?.label || ''"
      :config="config"
      :initial-value="pickerInitial"
      @close="onPickerClose"
      @confirm="onPickerConfirm"
    />
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  top: 50%;
  right: 140px;
  transform: translateY(-50%);
  width: 340px;
  max-height: 80vh;
  overflow-y: auto;
  /* Padding lives on the header + body sections so the header's bottom
     divider runs edge-to-edge (matches the admin variant strip). */
  padding: 0;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  backdrop-filter: saturate(180%) blur(20px);
  z-index: 41;
  display: flex;
  flex-direction: column;
}

/* Embedded variant — caller is providing layout via flex/grid, so we drop
   the floating anchors and become a regular block child. Keeps the visual
   chrome (glass bg, rounded border) so it still reads as a side panel. */
.context-menu.embedded {
  position: static;
  top: auto;
  right: auto;
  transform: none;
  max-height: 100%;
  z-index: auto;
  flex-shrink: 0;
}

.context-menu.sheet {
  top: auto;
  right: 0;
  left: 50%;
  bottom: calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 12px);
  transform: translateX(-50%);
  width: calc(100% - 24px);
  max-width: 720px;
  margin: 0;
  max-height: 60vh;
}

.ctx-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--glass-border);
}

/* Desktop: wrap is fine — pills flow to multiple rows when they overflow
   the picker column. Mobile (sheet mode) gets overridden below to a
   single horizontally-scrollable row with a fade overlay. */
.ctx-pills-wrap {
  position: relative;
}

.ctx-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* Sheet (mobile) — single scrollable row. Hide native scrollbars across
   engines so the visual cue lives entirely in the fade overlay. */
.context-menu.sheet .ctx-pills {
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  /* The fade overlay sits 24px wide on the right edge — reserve a touch
     of trailing padding so the last pill isn't fully under the fade
     when scrolled to the end. */
  padding-right: 4px;
}

.context-menu.sheet .ctx-pills::-webkit-scrollbar {
  display: none;
}

.context-menu.sheet .ctx-pill {
  flex: 0 0 auto;
}

/* Right-edge fade — hints at scrollable content beyond the visible row.
   Sits inside .ctx-pills-wrap (which is relative) so it stays glued to
   the right edge regardless of scroll position. The gradient lands on
   the header's background color so it looks like the row dissolves into
   the panel surface rather than a hard cut. */
.context-menu.sheet .ctx-pills-wrap::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 24px;
  pointer-events: none;
  background: linear-gradient(to right, transparent, var(--glass-bg));
  border-top-right-radius: var(--radius-2xl);
  border-bottom-right-radius: 0;
}

/* Pill styling mirrors the admin variant strip's `.avs-layer-pill` so
   the two editors feel like the same product. */
.ctx-pill {
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

.ctx-pill:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.ctx-pill.active {
  background: rgba(168, 85, 247, 0.22);
  border-color: rgba(168, 85, 247, 0.55);
  color: var(--color-text-primary);
}

/* Palette pill — sits at the end of the layer row but visually accents so
   users can spot it as the "swap everything" affordance. Icon + label
   share a tight gap. */
.ctx-pill-palette {
  gap: 5px;
  border-color: rgba(168, 85, 247, 0.45);
  color: var(--color-text-primary);
  background: rgba(168, 85, 247, 0.10);
}

.ctx-pill-palette:hover {
  background: rgba(168, 85, 247, 0.18);
  border-color: rgba(168, 85, 247, 0.6);
}

.ctx-pill-palette.active {
  background: rgba(168, 85, 247, 0.32);
  border-color: rgba(168, 85, 247, 0.75);
}

.palette-hint {
  margin: 0 0 12px;
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--color-text-tertiary);
}

.palette-row {
  margin-bottom: 12px;
}

.palette-row:last-child {
  margin-bottom: 0;
}

.palette-row-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  margin-bottom: 6px;
}

.palette-swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.palette-swatch {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 2px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  padding: 0;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.palette-swatch:hover {
  transform: scale(1.06);
}

.palette-swatch.active {
  border-color: #a855f7;
  box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.3);
}

[data-theme="light"] .palette-swatch {
  border-color: rgba(0, 0, 0, 0.12);
}

/* Padding lives on each non-header section so the header's edge-to-edge
   bottom border lines up flush with the rounded corners. Works for both
   right-sidebar and sheet modes. */
.context-menu > :not(.ctx-header) {
  padding-left: 16px;
  padding-right: 16px;
}

.context-menu > :first-child + * {
  padding-top: 12px;
}

.context-menu > :last-child {
  padding-bottom: 16px;
}

.ctx-section {
  margin-top: 12px;
}

.ctx-section h4 {
  margin: 0 0 8px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

/* Sheet (mobile) — collapse the variant grid to a single horizontally-
   scrollable row so the body keeps a flat layout that doesn't outgrow
   the sheet's 60vh cap and force the picker to scroll past the preview.
   Mirrors the ctx-pills mobile treatment above — same scrollbar hide
   so the visual cue lives in horizontal momentum instead of a chrome
   bar. */
.context-menu.sheet .style-grid {
  display: flex;
  grid-template-columns: none;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding-bottom: 4px;
}

.context-menu.sheet .style-grid::-webkit-scrollbar {
  display: none;
}

.context-menu.sheet .style-cell {
  flex: 0 0 auto;
  /* Match the desktop column width so cells stay readable while
     scrolling — without this they'd shrink to fit-content and the
     thumbnails would feel cramped. */
  width: 88px;
}

.style-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.style-cell:hover {
  background: rgba(255, 255, 255, 0.07);
}

.style-cell.active {
  border-color: rgba(168, 85, 247, 0.6);
  background: rgba(168, 85, 247, 0.14);
}

.style-thumb {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.15);
}

.style-thumb :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.style-label {
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  text-align: center;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.ctx-toggle {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}

.ctx-toggle-track {
  display: block;
  width: 44px;
  height: 24px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  position: relative;
  transition: background 0.2s ease;
}

.ctx-toggle.on .ctx-toggle-track {
  background: rgba(168, 85, 247, 0.7);
}

.ctx-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s ease;
}

.ctx-toggle.on .ctx-toggle-thumb {
  transform: translateX(20px);
}

.derived-note {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin: 8px 0 0;
}

/* Piece-colors section becomes a collapsible dropdown — the section stays
   in normal flow as just the toggle button, and the expanded list floats
   over the surrounding body via absolute positioning so opening it never
   re-flows the variant grid above. */
.ctx-pieces-section {
  position: relative;
  padding: 8px 14px;
}

.ctx-pieces-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.ctx-pieces-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.18);
}

.ctx-pieces-toggle.open {
  background: rgba(168, 85, 247, 0.18);
  border-color: rgba(168, 85, 247, 0.55);
}

.ctx-pieces-toggle-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ctx-pieces-count {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  background: rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  padding: 1px 7px;
}

.ctx-pieces-chev {
  transition: transform 0.18s ease;
}

.ctx-pieces-toggle.open .ctx-pieces-chev {
  transform: rotate(180deg);
}

/* Tap-outside scrim — full-section overlay so the user can dismiss the
   dropdown by tapping anywhere outside the panel itself. Sits BEHIND the
   dropdown (z-index 1) so it doesn't eat clicks on the list rows. */
.ctx-pieces-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1;
}

.ctx-pieces-dropdown {
  position: absolute;
  top: calc(100% - 6px);
  left: 14px;
  right: 14px;
  z-index: 2;
  padding: 8px;
  background: var(--color-bg-secondary, var(--glass-bg));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  max-height: 280px;
  overflow-y: auto;
}

/* Piece-color list — one row per admin-labeled piece in the active variant.
   The swatch IS the color input (the native color picker is hidden behind a
   round swatch tile) so the row stays compact while still being clickable. */
.piece-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.piece-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.03);
}

.piece-swatch-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  cursor: pointer;
  background: transparent;
  border: none;
  padding: 0;
  color: inherit;
  text-align: left;
  font: inherit;
}

.piece-swatch-btn:hover .piece-swatch {
  border-color: rgba(168, 85, 247, 0.6);
}

.piece-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18);
  flex-shrink: 0;
  display: inline-block;
  transition: border-color 0.15s ease;
}

.piece-label {
  font-size: 0.8rem;
  color: var(--color-text-primary);
}

.piece-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-tertiary);
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: color 0.15s ease, background 0.15s ease;
}

.piece-reset:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}
</style>
