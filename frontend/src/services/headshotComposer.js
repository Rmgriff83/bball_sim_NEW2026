// =============================================================================
// headshotComposer.js — JS port of generate_headshots.py
// =============================================================================
import { reactive, ref } from 'vue'

// The Python script is the source-of-truth for the bundled SVG library. This
// module mirrors it function-for-function so the editor can:
//   1) compose() a fresh SVG from a config object (live preview as the user
//      tweaks layers in the editor)
//   2) parse() an existing SVG back into a config (so the editor opens with
//      the player's current look as the starting point — see the editor's
//      "start-from-current" UX requirement)
//
// MUST stay in sync with generate_headshots.py. If you change a build_* shape
// or palette over there, mirror it here AND have the user regenerate the
// bundled library so the parser keeps matching.
// =============================================================================

// ---------------------------------------------------------------------------
// Palettes — keyed by name (mirror of Python's SKIN_TONES / HAIR_COLORS etc.)
// ---------------------------------------------------------------------------

export const SKIN_TONES = {
  dark:   { base: '#6e4326', hi: '#85553a', sh: '#5a3620', deep: '#472a18' },
  brown:  { base: '#8a5a3c', hi: '#9c6647', sh: '#7a4e33', deep: '#5e3a23' },
  olive:  { base: '#b88457', hi: '#c89668', sh: '#a5734a', deep: '#8a5c38' },
  tan:    { base: '#cda07a', hi: '#dcb591', sh: '#b88863', deep: '#9c7350' },
  fair:   { base: '#e8c1a0', hi: '#f2d2b6', sh: '#d2a380', deep: '#c99a76' },
  pale:   { base: '#f0d2bc', hi: '#f8e2d2', sh: '#dcb8a0', deep: '#c9a488' },
}

export const HAIR_COLORS = {
  black:        { base: '#2a2018', hi: '#3a2e22', sh: '#1c140e' },
  dark_brown:   { base: '#3a2817', hi: '#4a3320', sh: '#2b1d12' },
  brown:        { base: '#5a3d22', hi: '#6e4d2e', sh: '#46301a' },
  light_brown:  { base: '#7a5634', hi: '#917046', sh: '#634428' },
  blonde:       { base: '#c79a44', hi: '#e6c878', sh: '#a87e30' },
  dirty_blonde: { base: '#9c7c44', hi: '#c0a060', sh: '#806434' },
  auburn:       { base: '#6e3a22', hi: '#8a4d30', sh: '#562c18' },
  red:          { base: '#9c4a26', hi: '#bd6038', sh: '#7c3818' },
  gray:         { base: '#8a8a8a', hi: '#a8a8a8', sh: '#6e6e6e' },
}

export const EYE_COLORS = {
  dark_brown: { iris: '#3a2414', pupil: '#160d06' },
  brown:      { iris: '#5a3a26', pupil: '#1c1208' },
  hazel:      { iris: '#7a6030', pupil: '#2a1e0e' },
  blue:       { iris: '#4a7fb0', pupil: '#16263a' },
  green:      { iris: '#5a8a5a', pupil: '#1e2e1e' },
  gray:       { iris: '#8a98a0', pupil: '#2a3236' },
}

export const LIP_COLORS = {
  warm:  '#8a4a3c',
  rose:  '#a05a4a',
  blush: '#b5715e',
  deep:  '#7a4438',
  clay:  '#9c5848',
}

export const HEADBAND_STYLES = {
  none:  null,
  white: { main: '#f4f4f4', edge: '#cfcfcf' },
  black: { main: '#222222', edge: '#000000' },
}

export const ETHNICITY_PROFILES = {
  black:  { skins: ['dark', 'brown'],           hairs: ['black', 'dark_brown'] },
  latino: { skins: ['olive', 'tan', 'brown'],   hairs: ['black', 'dark_brown', 'brown'] },
  white:  { skins: ['fair', 'pale', 'tan'],     hairs: ['blonde', 'dirty_blonde', 'brown', 'light_brown', 'auburn', 'red', 'black'] },
  asian:  { skins: ['tan', 'olive', 'fair'],    hairs: ['black', 'dark_brown'] },
  mixed:  { skins: ['brown', 'olive', 'tan'],   hairs: ['black', 'dark_brown', 'brown', 'dirty_blonde'] },
}

// ---------------------------------------------------------------------------
// Variant lists — what's editable per layer
// ---------------------------------------------------------------------------
// String-keyed lists (hairStyle, eyeShape, noseShape, mouthFullness,
// headbandStyle) are derived from the headshot-layers/ folder scan further
// below so newly-created variants in the admin editor flow through to the
// user-facing variant picker automatically.
//
// Integer-keyed lists (jawWidth, browThickness) stay hardcoded — the
// geometry is parameterized in extract_layers.py with fixed indices, and
// the editor's preview-swap logic relies on the integer↔name mapping
// (JAW_NAMES, BROW_THICK_NAMES).
//
// browAngle is hardcoded because it's a sub-axis of eyebrows — the file
// names combine thickness+angle (e.g. thick-up.svg) so the angle list
// can't be derived layer-by-layer from filenames.

export const VARIANTS = {
  jawWidth:         [0, 1, 2],
  browThickness:    [1, 2],
  browAngle:        ['flat', 'up', 'down'],
  // String-keyed variants populated by _deriveStringVariants() after
  // LAYER_CONTENT is built. Defaults below are baseline fallbacks if a
  // layer ever has zero variants on disk (defensive).
  hairStyle:        [],
  eyeShape:         [],
  noseShape:        [],
  mouthFullness:    [],
  headbandStyle:    ['none'],  // 'none' is virtual (no file), kept so the editor can offer "no headband"
  neckStyle:        [],         // populated from disk like the other string-keyed layers
  stubbleStyle:     ['none'],   // 'none' is virtual (no file) — represents "no stubble" in the picker
}

// ---------------------------------------------------------------------------
// Layer registry — used by the editor sidebar/bottom-nav
// ---------------------------------------------------------------------------
// Each layer declares what's editable. The editor renders a layer button per
// entry; clicking opens the contextual menu sourced from the layer's
// styleVariants/colorPalette. Add a new layer = add an entry here + add a
// build_* function above + stamp metadata in generate_headshots.py.

// Layer order mirrors stacking top→bottom (first entry = top of the z-order
// in composeSvg). The admin layer panel renders this list as-is, so the
// admin sees the same vertical ordering they see in the composed headshot:
// headband on top, then hair, then face-level features beneath.
export const LAYERS = [
  { id: 'headband', label: 'Headband', styleKey: 'headband',      styleVariants: VARIANTS.headbandStyle },
  { id: 'hair',     label: 'Hair',     styleKey: 'hairStyle',     styleVariants: VARIANTS.hairStyle,     colorKey: 'hair',         colorPalette: HAIR_COLORS },
  { id: 'neck',     label: 'Neck',     styleKey: 'neckStyle',      styleVariants: VARIANTS.neckStyle },
  { id: 'mouth',    label: 'Mouth',    styleKey: 'mouthFullness', styleVariants: VARIANTS.mouthFullness, colorKey: 'lip',          colorPalette: LIP_COLORS },
  { id: 'nose',     label: 'Nose',     styleKey: 'noseShape',     styleVariants: VARIANTS.noseShape },
  { id: 'eyes',     label: 'Eyes',     styleKey: 'eyeShape',      styleVariants: VARIANTS.eyeShape,      colorKey: 'eye',          colorPalette: EYE_COLORS },
  { id: 'eyebrows', label: 'Brows',    styleKey: 'browThickness', styleVariants: VARIANTS.browThickness, colorKey: 'eyebrowColor', colorPalette: HAIR_COLORS },
  { id: 'stubble',  label: 'Stubble',  styleKey: 'stubbleStyle', styleVariants: VARIANTS.stubbleStyle },
  { id: 'face',     label: 'Face',     styleKey: 'jawWidth',      styleVariants: VARIANTS.jawWidth,      colorKey: 'skin',         colorPalette: SKIN_TONES },
]

// ---------------------------------------------------------------------------
// Layer SVG library — loaded at build time by Vite
// ---------------------------------------------------------------------------
// Each layer variant lives in its own standalone SVG file in one of two
// parallel folders:
//
//   headshot-layers/             ← generic tier (default — campaign pool + editor)
//   headshot-layers-upgraded/    ← upgraded tier (editor only, IAP-gated for users)
//
// The folder location IS the tier — there's no manifest. Admins toggle the
// tier of a variant by moving its file between folders (via the admin editor
// route + AdminHeadshotController). The Python generator scans only the
// generic folder, so upgraded variants never end up in the bundled
// procedural pool.
//
// Files use `{{token}}` placeholders (e.g. `{{skin.base}}`, `{{hair.sh}}`)
// in place of hex colors. The composer fills them in from the active
// config's palettes at compose time.
//
// To regenerate the layer files from the original Python build_* code, run
//   cd frontend/src/assets && python3 extract_layers.py
const GENERIC_FILES = import.meta.glob('@/assets/headshot-layers/**/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const UPGRADED_FILES = import.meta.glob('@/assets/headshot-layers-upgraded/**/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})

// Layer content map: variant key → raw SVG file content. Built once at module
// init from the merged file globs; doesn't change at runtime (the underlying
// files require a Vite reload to swap their globbed contents).
const LAYER_CONTENT = (() => {
  const map = {}
  for (const [path, content] of Object.entries(GENERIC_FILES)) {
    const m = path.match(/headshot-layers\/([^/]+)\/([^/]+)\.svg$/)
    if (m) map[`${m[1]}/${m[2]}`] = content
  }
  for (const [path, content] of Object.entries(UPGRADED_FILES)) {
    const m = path.match(/headshot-layers-upgraded\/([^/]+)\/([^/]+)\.svg$/)
    if (m) map[`${m[1]}/${m[2]}`] = content
  }
  return map
})()

// Derive string-keyed variant lists from the on-disk layer files. Filenames
// use hyphens (e.g. side-part.svg) but composer config keys use underscores
// (e.g. side_part), so we reverse the convention while scanning.
//
// Layers tracked here are EXACTLY the ones where a variant name = a config
// value. Eyebrows are intentionally NOT included because their files combine
// two axes (thickness + angle, e.g. thick-up.svg).
const STRING_KEYED_LAYERS = {
  hair:     'hairStyle',
  eyes:     'eyeShape',
  nose:     'noseShape',
  mouth:    'mouthFullness',
  headband: 'headbandStyle',
  neck:     'neckStyle',
  stubble:  'stubbleStyle',
}
function _filenameToConfigKey(filename) {
  return filename.replace(/-/g, '_')
}
function _deriveStringVariants() {
  for (const [layerId, variantsKey] of Object.entries(STRING_KEYED_LAYERS)) {
    // CRITICAL: mutate the existing VARIANTS[variantsKey] array IN PLACE
    // rather than reassigning. LAYERS captured `styleVariants: VARIANTS.hairStyle`
    // as a reference at module init; reassigning would leave LAYERS pointing
    // at the original empty array and the user-facing variant picker would
    // render zero options.
    const target = VARIANTS[variantsKey] || []
    const seen = new Set(target)  // hardcoded defaults already in target (e.g. headband 'none')
    const prefix = `${layerId}/`
    for (const key of Object.keys(LAYER_CONTENT)) {
      if (!key.startsWith(prefix)) continue
      const configKey = _filenameToConfigKey(key.slice(prefix.length))
      if (!seen.has(configKey)) {
        target.push(configKey)
        seen.add(configKey)
      }
    }
  }
}
_deriveStringVariants()

// Reactive tier state: variant key → 'generic' | 'paid'. Separate from the
// content map so the admin UI can flip a variant's tier optimistically (after
// the backend file-move succeeds) and the badge re-renders without remounting
// the strip. Upgraded wins ties at init (defensive).
const layerTiers = reactive({})
for (const path of Object.keys(GENERIC_FILES)) {
  const m = path.match(/headshot-layers\/([^/]+)\/([^/]+)\.svg$/)
  if (m) layerTiers[`${m[1]}/${m[2]}`] = 'generic'
}
for (const path of Object.keys(UPGRADED_FILES)) {
  const m = path.match(/headshot-layers-upgraded\/([^/]+)\/([^/]+)\.svg$/)
  if (m) layerTiers[`${m[1]}/${m[2]}`] = 'paid'
}

const JAW_NAMES = { 0: 'narrow', 1: 'medium', 2: 'wide' }
const BROW_THICK_NAMES = { 1: 'thin', 2: 'thick' }

/**
 * Reactive lookup of a variant's tier ('generic' | 'paid'), or null if no
 * file exists. Used by the admin editor's variant strip to render Free/Paid
 * state. Reactive because the reactive store is mutated by setLayerTier()
 * on toggle.
 */
export function getLayerTier(layerId, variantKey) {
  return layerTiers[`${layerId}/${variantKey}`] ?? null
}

/**
 * Optimistically update a variant's tier in the in-memory store. Called by
 * the admin editor after the backend successfully moves the file between
 * folders. The actual on-disk source-of-truth swap is what persists; this
 * just keeps the UI snappy until the next Vite reload.
 */
export function setLayerTier(layerId, variantKey, tier) {
  if (tier !== 'generic' && tier !== 'paid') return
  layerTiers[`${layerId}/${variantKey}`] = tier
}

/**
 * List every variant key found on disk for a given layer, across BOTH
 * tiers. Sorted alphabetically. Used by the admin editor's variant strip
 * so newly-dropped files show up without code changes.
 */
export function listAllVariants(layerId) {
  const prefix = `${layerId}/`
  return Object.keys(LAYER_CONTENT)
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length))
    .sort()
}

/**
 * Read the raw SVG source for a variant. Returns null if the file isn't
 * present in either tier folder. Used by the admin variant editor to seed
 * its in-memory pieces array (via parseVariantPieces in svgPieces.js).
 */
export function getVariantSource(layerId, variantKey) {
  return LAYER_CONTENT[`${layerId}/${variantKey}`] ?? null
}

/**
 * Map a layer + config back to its variant filename (hyphenated, as used
 * in LAYER_CONTENT keys). Mirrors the filename derivation inside composeSvg
 * so callers (e.g. the user-facing LayerContextMenu's piece picker) can
 * load the active variant's source SVG and parse its pieces.
 *
 * Returns null for layers without an editable variant (neck) or when the
 * layer is in an off state (stubble disabled, headband 'none').
 */
export function getCurrentVariantKey(layerId, config) {
  const c = normalizeConfig(config)
  switch (layerId) {
    case 'hair':     return c.hairStyle.replace(/_/g, '-')
    case 'face':     return c.faceVariantOverride || JAW_NAMES[c.jawWidth]
    case 'eyebrows': return c.browVariantOverride || `${BROW_THICK_NAMES[c.browThickness]}-${c.browAngle}`
    case 'eyes':     return c.eyeShape
    case 'nose':     return c.noseShape
    case 'mouth':    return c.mouthFullness
    case 'stubble':  return c.stubbleStyle === 'none' ? null : c.stubbleStyle
    case 'headband': return c.headband === 'none' ? null : c.headband
    case 'neck':     return c.neckStyle
    default:         return null
  }
}

/**
 * In-memory patches to the variant library used by the admin editor's
 * save/delete/rename flows. The Vite-glob LAYER_CONTENT is built once at
 * module init; without these patches the variant strip's thumbnails would
 * keep rendering the pre-save SVG until the next full reload. These keep
 * the in-memory map consistent with what's on disk so re-mounting catalog
 * views shows fresh content immediately.
 *
 * `layerContentVersion` is a reactive counter that bumps on every patch.
 * LAYER_CONTENT itself is a plain object — Vue can't track mutations to it,
 * so consumers (like the variant strip's thumbnailFor) read this counter
 * during render to opt into reactivity. Without it, the strip would render
 * once with whatever LAYER_CONTENT had at mount time and never update.
 */
export const layerContentVersion = ref(0)

export function updateLayerVariantContent(layerId, variantKey, content) {
  LAYER_CONTENT[`${layerId}/${variantKey}`] = content
  layerContentVersion.value++
}

export function removeLayerVariantContent(layerId, variantKey) {
  delete LAYER_CONTENT[`${layerId}/${variantKey}`]
  layerContentVersion.value++
}

export function renameLayerVariantContent(layerId, oldKey, newKey) {
  const k = `${layerId}/${oldKey}`
  if (LAYER_CONTENT[k] === undefined) return
  LAYER_CONTENT[`${layerId}/${newKey}`] = LAYER_CONTENT[k]
  delete LAYER_CONTENT[k]
  layerContentVersion.value++
}

/**
 * Resolve a piece's effective hex color under the given config. Token-bound
 * pieces look up the relevant palette slot; literal pieces just return their
 * stored hex. Returns null when the piece has no color set yet.
 */
export function resolvePieceColor(piece, config) {
  if (!piece) return null
  if (piece.colorMode === 'literal') return piece.colorHex || null
  if (piece.colorMode === 'token' && piece.colorToken) {
    const tokens = _buildTokens(normalizeConfig(config))
    return tokens[piece.colorToken] || null
  }
  return null
}

function _extractInnerLines(svgString) {
  // Pull everything between <svg ...> and </svg>, then normalize whitespace
  // line-by-line. Result is one rect per line with no leading indentation,
  // matching the format the legacy inline composer produced.
  const m = svgString.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i)
  const inner = m ? m[1] : svgString
  return inner
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
}

function _applyTokens(text, tokens) {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const value = tokens[key.trim()]
    return value != null ? value : `{{${key}}}`
  })
}

function _buildAttrString(layerId, attrs = {}) {
  let attrStr = ` data-layer="${layerId}"`
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue
    attrStr += ` data-${k.replace(/_/g, '-')}="${v}"`
  }
  return attrStr
}

/**
 * Resolve fill on Phase 2 piece wrappers. After the token-replacement pass
 * runs, any <g data-piece ...> without an explicit fill gets one injected.
 *
 * Resolution order (first match wins):
 *   1. layerOverrides[label] — Phase 3 user-facing per-piece override,
 *      keyed by the admin's piece label. Lets users recolor individual
 *      pieces independently of the palette/token system.
 *   2. data-color-token="X"  → fill="${tokens[X]}"  (palette-bound)
 *   3. data-color="HEX"      → fill="HEX"           (literal + label)
 *
 * Children of the group inherit the fill via SVG attribute inheritance, so
 * the rects inside stay clean (no per-rect fill needed). Backwards compat
 * with legacy flat-rect variants — those rects have their own fill="{{...}}"
 * which already got replaced in the prior _applyTokens pass.
 */
function _resolvePieceFills(text, tokens, layerOverrides = null) {
  return text.replace(/<g\b([^>]*?)data-piece="[^"]*"([^>]*?)>/g, (match, before, after) => {
    const attrs = before + after
    if (/\sfill="[^"]*"/.test(attrs)) return match  // explicit fill present, skip
    // 1) User override by label — checked first so it wins over the admin's
    //    original token/literal choice.
    if (layerOverrides) {
      const labelMatch = attrs.match(/data-color-label="([^"]+)"/)
      if (labelMatch) {
        const override = layerOverrides[labelMatch[1].trim()]
        if (override) return match.replace(/>$/, ` fill="${override}">`)
      }
    }
    const tokenMatch = attrs.match(/data-color-token="([^"]+)"/)
    if (tokenMatch) {
      const hex = tokens[tokenMatch[1].trim()]
      if (hex) return match.replace(/>$/, ` fill="${hex}">`)
      return match
    }
    const litMatch = attrs.match(/data-color="([^"]+)"/)
    if (litMatch) return match.replace(/>$/, ` fill="${litMatch[1]}">`)
    return match
  })
}

/**
 * Render one layer to a metadata-wrapped <g>...</g> block. Passing variantKey
 * = null produces an empty wrapper (used for off-state layers like stubble
 * disabled or headband=none so the editor can still find and toggle them).
 *
 * An optional `overrideContent` arg lets a caller substitute the layer's
 * file content with arbitrary SVG (used by the admin variant editor to
 * render its in-memory pieces in place of the on-disk variant).
 */
function _renderLayer(layerId, variantKey, tokens, metaAttrs = {}, overrideContent = null, pieceOverrides = null) {
  const attrStr = _buildAttrString(layerId, metaAttrs)
  // 'none' is a virtual variant that hides the layer entirely — already
  // used by stubble/headband as their "off" value, and surfaced via the
  // admin backdrop picker as a generic "hide this layer" option.
  if (variantKey === 'none') variantKey = null
  if (!variantKey && !overrideContent) {
    return `<g${attrStr}>\n</g>`
  }
  const content = overrideContent ?? LAYER_CONTENT[`${layerId}/${variantKey}`]
  if (!content) {
    console.warn(`[headshotComposer] missing layer file: ${layerId}/${variantKey}.svg`)
    return `<g${attrStr}>\n</g>`
  }
  // Two-pass resolution: 1) rect-level {{tokens}} (legacy + literal hex rects),
  // 2) group-level fill injection for Phase 2 <g data-piece> wrappers (with
  // optional Phase 3 user piece-color overrides applied first).
  let inner = _applyTokens(_extractInnerLines(content), tokens)
  inner = _resolvePieceFills(inner, tokens, pieceOverrides)
  return `<g${attrStr}>\n${inner}\n</g>`
}

/**
 * Flatten the palette entries the active config resolves to into a dot-keyed
 * token map (skin.base, hair.sh, eye.iris, ...). Layer files reference these
 * by name and the renderer substitutes hex values in.
 */
function _buildTokens(c) {
  const skin = SKIN_TONES[c.skin]
  const hair = HAIR_COLORS[c.hair]
  const brow = HAIR_COLORS[c.eyebrowColor] || hair
  const eye = EYE_COLORS[c.eye]
  return {
    'skin.base':  skin.base,
    'skin.hi':    skin.hi,
    'skin.sh':    skin.sh,
    'skin.deep':  skin.deep,
    'hair.base':  hair.base,
    'hair.hi':    hair.hi,
    'hair.sh':    hair.sh,
    'brow.base':  brow.base,
    'brow.hi':    brow.hi,
    'brow.sh':    brow.sh,
    'eye.iris':   eye.iris,
    'eye.pupil':  eye.pupil,
    'lip':        LIP_COLORS[c.lip],
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate + fill missing fields in a config so composeSvg always succeeds
 * even if parseSvgConfig returned partials from a legacy SVG.
 */
// `'none'` is a universal "hide this layer" sentinel — passed through here
// even when not in the layer's VARIANTS list so the admin backdrop picker's
// "None" option survives normalization. `_renderLayer` translates 'none' to
// null (empty wrapper) at compose time.
function _allowNoneOrFallback(value, validList, fallback) {
  if (value === 'none') return 'none'
  return validList.includes(value) ? value : fallback
}

function normalizeConfig(config = {}) {
  const ethnicity = config.ethnicity in ETHNICITY_PROFILES ? config.ethnicity : 'black'
  const profile = ETHNICITY_PROFILES[ethnicity]
  const hair = config.hair in HAIR_COLORS ? config.hair : profile.hairs[0]
  return {
    ethnicity,
    skin:         config.skin in SKIN_TONES ? config.skin : profile.skins[0],
    hair,
    // Eyebrow color is independent of hair color but defaults to it when
    // the SVG has no explicit eyebrow data-color (legacy SVGs and the
    // initial Python-generated bundle, where eyebrow color was always
    // derived from hair).
    eyebrowColor: config.eyebrowColor in HAIR_COLORS ? config.eyebrowColor : hair,
    eye:          config.eye in EYE_COLORS ? config.eye : 'brown',
    lip:          config.lip in LIP_COLORS ? config.lip : 'warm',
    jawWidth:     [0, 1, 2].includes(Number(config.jawWidth)) ? Number(config.jawWidth) : 1,
    hairStyle:    _allowNoneOrFallback(config.hairStyle, VARIANTS.hairStyle, 'short'),
    browThickness: [1, 2].includes(Number(config.browThickness)) ? Number(config.browThickness) : 1,
    browAngle:    VARIANTS.browAngle.includes(config.browAngle) ? config.browAngle : 'flat',
    eyeShape:     _allowNoneOrFallback(config.eyeShape, VARIANTS.eyeShape, 'round'),
    noseShape:    _allowNoneOrFallback(config.noseShape, VARIANTS.noseShape, 'medium'),
    mouthFullness: _allowNoneOrFallback(config.mouthFullness, VARIANTS.mouthFullness, 'thin'),
    // hasStubble kept for legacy data paths that still read the boolean form.
    // The authoritative field is now `stubbleStyle` ('none' = off, otherwise
    // a variant filename) — derived from legacy hasStubble when needed.
    hasStubble:   !!config.hasStubble,
    stubbleStyle: VARIANTS.stubbleStyle.includes(config.stubbleStyle)
      ? config.stubbleStyle
      : (config.hasStubble ? 'default' : 'none'),
    headband:     VARIANTS.headbandStyle.includes(config.headband) ? config.headband : 'none',
    neckStyle:    _allowNoneOrFallback(config.neckStyle, VARIANTS.neckStyle, 'default'),
    // Admin-only: lets the variant editor's backdrop picker swap the face
    // layer to an arbitrary on-disk file (including admin-created variants
    // that don't map to a jawWidth integer). User-facing configs leave this
    // null and the composer falls back to JAW_NAMES[jawWidth] as before.
    faceVariantOverride: typeof config.faceVariantOverride === 'string' && config.faceVariantOverride
      ? config.faceVariantOverride : null,
    // Same idea for eyebrows — the canonical user-facing fields are the
    // multi-axis (browThickness × browAngle) pair, but the admin backdrop
    // picker treats the whole brow filename ('thin-up', etc.) as one value
    // so admin-created brow variants can be picked without splitting them
    // back into the two axes.
    browVariantOverride: typeof config.browVariantOverride === 'string' && config.browVariantOverride
      ? config.browVariantOverride : null,
  }
}

/**
 * Compose an SVG string from a config object. Layer draw order matches the
 * Python script so the visual output is identical.
 *
 * `overrides` is an optional map of `layerId → SVG content string` used by
 * the admin variant editor to render its in-memory pieces in place of the
 * on-disk variant for that layer. Other layers still load normally from
 * LAYER_CONTENT, which is why the backdrop shows the rest of the head while
 * the admin edits just one layer.
 */
export function composeSvg(config, overrides = null) {
  const c = normalizeConfig(config)
  const tokens = _buildTokens(c)
  const ov = (id) => overrides?.[id] ?? null
  // Phase 3 per-piece user overrides — keyed by layerId → label → hex. Lets
  // users recolor admin-labeled pieces independently of the palette tokens.
  // Falls through to null when nothing's set, which makes _resolvePieceFills
  // behave exactly as before for legacy configs without this field.
  const pieceColors = (config && config.pieceColors) || null
  const po = (id) => (pieceColors && pieceColors[id]) || null

  const parts = [
    '<svg width="500" height="500" viewBox="70 -30 500 500" xmlns="http://www.w3.org/2000/svg">',
    '<g shape-rendering="crispEdges">',
    '<g transform="scale(10)">',
  ]

  // Style key → filename mapping. config uses raw values like `side_part`
  // and `1` (browThickness); the file system uses hyphenated string keys.
  const hairFile = c.hairStyle.replace(/_/g, '-')
  // Face: admin backdrop picker can override to any on-disk filename via
  // `faceVariantOverride`. Falls back to the integer jawWidth mapping when
  // no override is set (the user-facing default path).
  const faceFile = c.faceVariantOverride || JAW_NAMES[c.jawWidth]
  // Eyebrow file: admin backdrop can pin to any on-disk filename; otherwise
  // fall back to the canonical thickness × angle composition.
  const browFile = c.browVariantOverride || `${BROW_THICK_NAMES[c.browThickness]}-${c.browAngle}`

  // Stacking order: later push = painted on top (SVG document order). The
  // top-of-stack pair is hair (second-to-last) then headband (last) so a
  // headband always wraps over hair, and hair wraps over every face-level
  // feature (bangs/fringes overlap forehead, brows, neck/shoulders).
  parts.push(_renderLayer('face', faceFile, tokens, { skin: c.skin, jaw: c.jawWidth }, ov('face'), po('face')))
  parts.push(_renderLayer(
    'stubble',
    c.stubbleStyle === 'none' ? null : c.stubbleStyle,
    tokens,
    {
      style: c.stubbleStyle,
      // Legacy attr kept for old consumers (analytics, downstream parsers)
      // that still branch on the boolean form.
      enabled: c.stubbleStyle !== 'none' ? 'true' : 'false',
    },
    ov('stubble'), po('stubble')
  ))
  parts.push(_renderLayer('eyebrows', browFile, tokens, {
    thickness: c.browThickness,
    angle: c.browAngle,
    color: c.eyebrowColor,
  }, ov('eyebrows'), po('eyebrows')))
  parts.push(_renderLayer('eyes', c.eyeShape, tokens, { shape: c.eyeShape, color: c.eye }, ov('eyes'), po('eyes')))
  parts.push(_renderLayer('nose', c.noseShape, tokens, { shape: c.noseShape }, ov('nose'), po('nose')))
  parts.push(_renderLayer('mouth', c.mouthFullness, tokens, { fullness: c.mouthFullness, color: c.lip }, ov('mouth'), po('mouth')))
  parts.push(_renderLayer('neck', c.neckStyle, tokens, { style: c.neckStyle }, ov('neck'), po('neck')))
  parts.push(_renderLayer('hair', hairFile, tokens, { style: c.hairStyle, color: c.hair }, ov('hair'), po('hair')))
  parts.push(_renderLayer(
    'headband',
    c.headband === 'none' ? null : c.headband,
    tokens,
    { style: c.headband },
    ov('headband'), po('headband')
  ))

  parts.push('</g>', '</g>', '</svg>')
  return parts.join('\n')
}

/**
 * Read a config back out of a metadata-stamped SVG. Returns whatever it could
 * parse; missing fields are filled by normalizeConfig before any compose call.
 * Legacy SVGs without data-layer attributes return an empty object.
 */
export function parseSvgConfig(svgString) {
  if (!svgString || typeof svgString !== 'string') return {}
  const config = {}

  // Accept either quote style — Vite's asset pipeline rewrites attribute
  // quotes from " to ' when it inlines small SVGs as data: URLs, so the
  // string we get back from fetch(blobOrDataUrl) may use either form.
  const layerRegex = /<g\s+data-layer=["'](\w+)["']([^>]*)>/g
  let match
  while ((match = layerRegex.exec(svgString)) !== null) {
    const [, layerId, attrBlob] = match
    const attrs = {}
    const attrRegex = /data-([a-z-]+)=["']([^"']*)["']/g
    let am
    while ((am = attrRegex.exec(attrBlob)) !== null) {
      attrs[am[1]] = am[2]
    }

    switch (layerId) {
      case 'hair':
        if (attrs.style) config.hairStyle = attrs.style
        if (attrs.color) config.hair = attrs.color
        break
      case 'face':
        if (attrs.skin) config.skin = attrs.skin
        if (attrs.jaw !== undefined) config.jawWidth = Number(attrs.jaw)
        break
      case 'stubble':
        // New data-style attribute is authoritative; fall back to the
        // legacy data-enabled boolean form for SVGs saved before the
        // toggle-to-variant migration.
        if (attrs.style) {
          config.stubbleStyle = attrs.style
          config.hasStubble = attrs.style !== 'none'
        } else if (attrs.enabled !== undefined) {
          config.hasStubble = attrs.enabled === 'true'
          config.stubbleStyle = attrs.enabled === 'true' ? 'default' : 'none'
        }
        break
      case 'headband':
        if (attrs.style) config.headband = attrs.style
        break
      case 'eyebrows':
        if (attrs.thickness !== undefined) config.browThickness = Number(attrs.thickness)
        if (attrs.angle) config.browAngle = attrs.angle
        if (attrs.color) config.eyebrowColor = attrs.color
        break
      case 'eyes':
        if (attrs.shape) config.eyeShape = attrs.shape
        if (attrs.color) config.eye = attrs.color
        break
      case 'nose':
        if (attrs.shape) config.noseShape = attrs.shape
        break
      case 'mouth':
        if (attrs.fullness) config.mouthFullness = attrs.fullness
        if (attrs.color) config.lip = attrs.color
        break
      case 'neck':
        if (attrs.style) config.neckStyle = attrs.style
        break
    }
  }

  // Ethnicity isn't in the SVG (only used to seed the original randomization
  // bias). Best-effort infer from the chosen skin so re-randomize defaults
  // land in the right family.
  if (config.skin && !config.ethnicity) {
    for (const [ethnicity, profile] of Object.entries(ETHNICITY_PROFILES)) {
      if (profile.skins.includes(config.skin)) {
        config.ethnicity = ethnicity
        break
      }
    }
  }

  return config
}

/**
 * A reasonable default config. Used as the editor's starting point when
 * parseSvgConfig returns an empty object (legacy non-metadata SVG).
 */
export function defaultConfig(seed) {
  // Seed-deterministic so opening the editor on the same player twice gives
  // the same default face. Tiny LCG keyed on the string seed.
  let s = 0
  if (seed != null) {
    const str = String(seed)
    for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0
  }
  const pick = (arr) => {
    s = (s * 1103515245 + 12345) >>> 0
    return arr[s % arr.length]
  }
  const ethnicity = pick(Object.keys(ETHNICITY_PROFILES))
  const profile = ETHNICITY_PROFILES[ethnicity]
  return normalizeConfig({
    ethnicity,
    skin: pick(profile.skins),
    hair: pick(profile.hairs),
    eye: pick(Object.keys(EYE_COLORS)),
    lip: pick(Object.keys(LIP_COLORS)),
    jawWidth: pick([0, 1, 2]),
    hairStyle: pick(VARIANTS.hairStyle),
    browThickness: pick([1, 2]),
    browAngle: pick(VARIANTS.browAngle),
    eyeShape: pick(VARIANTS.eyeShape),
    noseShape: pick(VARIANTS.noseShape),
    mouthFullness: pick(VARIANTS.mouthFullness),
    hasStubble: pick([true, false]),
    headband: 'none',
  })
}

/**
 * Convenience: derive the starting editor config for a player. Tries the
 * player's existing SVG first; falls back to a seeded default keyed by
 * playerId when parsing yields nothing.
 */
export function configFromSvg(svgString, seedFallback) {
  const parsed = parseSvgConfig(svgString || '')
  if (Object.keys(parsed).length === 0) {
    return defaultConfig(seedFallback)
  }
  return normalizeConfig(parsed)
}
