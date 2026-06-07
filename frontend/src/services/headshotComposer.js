// =============================================================================
// headshotComposer.js — JS port of generate_headshots.py
// =============================================================================
import { reactive, ref } from 'vue'
import { defaultLabelForToken, generatePieceId } from '@/services/svgPieces'

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
// Each layer variant lives in its own standalone SVG file. Audience and tier
// are encoded ENTIRELY by folder location — there's no sidecar manifest.
// The four folders form the 2×2 axis:
//
//   headshot-layers/                  ← player + generic (default — campaign pool)
//   headshot-layers-upgraded/         ← player + upgraded (IAP-gated for users)
//   headshot-layers-coaches/          ← coach  + generic
//   headshot-layers-coaches-upgraded/ ← coach  + upgraded
//
// Admin actions (saveVariant / setTier / deleteVariant / rename) all take an
// audience parameter to route to the correct folder pair. The Python
// generator scans only the player+generic folder, so upgraded and coach
// variants never end up in the bundled procedural pool.
//
// Files use `{{token}}` placeholders (e.g. `{{skin.base}}`, `{{hair.sh}}`)
// in place of hex colors. The composer fills them in from the active
// config's palettes at compose time.
//
// To regenerate the layer files from the original Python build_* code, run
//   cd frontend/src/assets && python3 extract_layers.py

const PLAYER_GENERIC_FILES = import.meta.glob(
  '@/assets/headshot-layers/**/*.svg',
  { eager: true, query: '?raw', import: 'default' },
)
const PLAYER_UPGRADED_FILES = import.meta.glob(
  '@/assets/headshot-layers-upgraded/**/*.svg',
  { eager: true, query: '?raw', import: 'default' },
)
const COACH_GENERIC_FILES = import.meta.glob(
  '@/assets/headshot-layers-coaches/**/*.svg',
  { eager: true, query: '?raw', import: 'default' },
)
const COACH_UPGRADED_FILES = import.meta.glob(
  '@/assets/headshot-layers-coaches-upgraded/**/*.svg',
  { eager: true, query: '?raw', import: 'default' },
)

// Per-audience content maps. Each holds "<layer>/<variant>" → raw SVG content.
// Two parallel maps mean a variant named `hair/test` can exist independently
// in both audiences with different bytes.
const LAYER_CONTENT = {
  player: (() => {
    const map = {}
    for (const [path, content] of Object.entries(PLAYER_GENERIC_FILES)) {
      const m = path.match(/headshot-layers\/([^/]+)\/([^/]+)\.svg$/)
      if (m) map[`${m[1]}/${m[2]}`] = content
    }
    for (const [path, content] of Object.entries(PLAYER_UPGRADED_FILES)) {
      const m = path.match(/headshot-layers-upgraded\/([^/]+)\/([^/]+)\.svg$/)
      if (m) map[`${m[1]}/${m[2]}`] = content
    }
    return map
  })(),
  coach: (() => {
    const map = {}
    for (const [path, content] of Object.entries(COACH_GENERIC_FILES)) {
      const m = path.match(/headshot-layers-coaches\/([^/]+)\/([^/]+)\.svg$/)
      if (m) map[`${m[1]}/${m[2]}`] = content
    }
    for (const [path, content] of Object.entries(COACH_UPGRADED_FILES)) {
      const m = path.match(/headshot-layers-coaches-upgraded\/([^/]+)\/([^/]+)\.svg$/)
      if (m) map[`${m[1]}/${m[2]}`] = content
    }
    return map
  })(),
}

function _contentMapFor(audience) {
  return LAYER_CONTENT[audience === 'coach' ? 'coach' : 'player']
}

// Derive string-keyed variant lists by UNION across audiences. VARIANTS arrays
// gather every distinct variant name from every folder so normalizeConfig
// accepts cross-audience values without rejecting them. Audience-specific
// filtering happens later at the picker level via listAllVariantsForAudience.
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
    const seen = new Set(target)
    const prefix = `${layerId}/`
    for (const audience of ['player', 'coach']) {
      for (const key of Object.keys(LAYER_CONTENT[audience])) {
        if (!key.startsWith(prefix)) continue
        const configKey = _filenameToConfigKey(key.slice(prefix.length))
        if (!seen.has(configKey)) {
          target.push(configKey)
          seen.add(configKey)
        }
      }
    }
  }
}
_deriveStringVariants()

// Per-audience reactive tier state. Variant key → 'generic' | 'paid'.
// Admin setLayerTier mutates the active audience's map after the backend
// confirms a folder move; consumers reactively re-render Free/Paid badges.
const layerTiers = {
  player: reactive({}),
  coach: reactive({}),
}
for (const path of Object.keys(PLAYER_GENERIC_FILES)) {
  const m = path.match(/headshot-layers\/([^/]+)\/([^/]+)\.svg$/)
  if (m) layerTiers.player[`${m[1]}/${m[2]}`] = 'generic'
}
for (const path of Object.keys(PLAYER_UPGRADED_FILES)) {
  const m = path.match(/headshot-layers-upgraded\/([^/]+)\/([^/]+)\.svg$/)
  if (m) layerTiers.player[`${m[1]}/${m[2]}`] = 'paid'
}
for (const path of Object.keys(COACH_GENERIC_FILES)) {
  const m = path.match(/headshot-layers-coaches\/([^/]+)\/([^/]+)\.svg$/)
  if (m) layerTiers.coach[`${m[1]}/${m[2]}`] = 'generic'
}
for (const path of Object.keys(COACH_UPGRADED_FILES)) {
  const m = path.match(/headshot-layers-coaches-upgraded\/([^/]+)\/([^/]+)\.svg$/)
  if (m) layerTiers.coach[`${m[1]}/${m[2]}`] = 'paid'
}

// Face variants are integer-keyed in config (jawWidth 0..N). Per-audience
// because the coach catalog can author a totally different face roster.
// Indices are stable per audience (Free first, then Paid, alphabetical
// within each group) so saved data keeps resolving to the same file.
const _FACE_FALLBACK = ['narrow', 'medium', 'wide']
function _buildJawNamesFor(audience) {
  const content = _contentMapFor(audience)
  const tierMap = layerTiers[audience]
  const prefix = 'face/'
  const free = []
  const paid = []
  for (const key of Object.keys(content)) {
    if (!key.startsWith(prefix)) continue
    const name = key.slice(prefix.length)
    if (tierMap[key] === 'paid') paid.push(name)
    else free.push(name)
  }
  free.sort()
  paid.sort()
  const list = (free.length + paid.length) > 0 ? [...free, ...paid]
    : (audience === 'player' ? _FACE_FALLBACK : [])
  const map = {}
  list.forEach((name, i) => { map[i] = name })
  return map
}
const JAW_NAMES = {
  player: _buildJawNamesFor('player'),
  coach: _buildJawNamesFor('coach'),
}

// Sync VARIANTS.jawWidth (which LAYERS captures by reference for the user-
// facing face style picker) to the UNION of indices across audiences so
// normalizeConfig accepts values from either side. The actual file lookup
// at render time goes through audience-specific JAW_NAMES[audience].
VARIANTS.jawWidth.length = 0
const _allJawIndices = new Set([
  ...Object.keys(JAW_NAMES.player).map(Number),
  ...Object.keys(JAW_NAMES.coach).map(Number),
])
for (const i of [..._allJawIndices].sort((a, b) => a - b)) VARIANTS.jawWidth.push(i)
if (VARIANTS.jawWidth.length === 0) VARIANTS.jawWidth.push(0, 1, 2)

const BROW_THICK_NAMES = { 1: 'thin', 2: 'thick' }

/**
 * Reactive lookup of a variant's tier ('generic' | 'paid'), or null if no
 * file exists in the given audience's folders. The admin editor's variant
 * strip uses this to render Free/Paid badges per audience tab.
 */
export function getLayerTier(layerId, variantKey, audience = 'player') {
  return layerTiers[audience]?.[`${layerId}/${variantKey}`] ?? null
}

/**
 * Optimistically update a variant's tier in the in-memory store for the
 * given audience. Called by the admin editor after the backend successfully
 * moves the file between folders.
 */
export function setLayerTier(layerId, variantKey, tier, audience = 'player') {
  if (tier !== 'generic' && tier !== 'paid') return
  if (!layerTiers[audience]) return
  layerTiers[audience][`${layerId}/${variantKey}`] = tier
}

/**
 * List every variant key found on disk for a layer + audience pair, across
 * BOTH tiers within that audience. Sorted alphabetically.
 */
export function listAllVariantsForAudience(layerId, audience = 'player') {
  const content = _contentMapFor(audience)
  const prefix = `${layerId}/`
  return Object.keys(content)
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length))
    .sort()
}

/**
 * Legacy alias — kept so the existing player-only call sites keep working
 * without a behavior change. Defaults to the player audience.
 */
export function listAllVariants(layerId, audience = 'player') {
  return listAllVariantsForAudience(layerId, audience)
}

/**
 * Read the raw SVG source for a variant in the given audience's folders.
 * Returns null if not present. Used by the admin variant editor to seed its
 * in-memory pieces array, and by HeadshotEditorView's coach load path.
 */
export function getVariantSource(layerId, variantKey, audience = 'player') {
  return _contentMapFor(audience)[`${layerId}/${variantKey}`] ?? null
}

/**
 * Expose the per-audience face index → filename map so consumers (admin
 * backdrop picker, LayerContextMenu's face style grid) can resolve indices
 * to files for the active audience.
 */
export function getJawName(index, audience = 'player') {
  return JAW_NAMES[audience]?.[index] ?? null
}

export function listJawIndicesForAudience(audience = 'player') {
  return Object.keys(JAW_NAMES[audience] || {}).map(Number).sort((a, b) => a - b)
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
export function getCurrentVariantKey(layerId, config, audience = 'player') {
  const c = normalizeConfig(config)
  switch (layerId) {
    case 'hair':     return c.hairStyle.replace(/_/g, '-')
    case 'face':     return c.faceVariantOverride || getJawName(c.jawWidth, audience)
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

/**
 * Register that a variant EXISTS in the catalog for the given audience
 * without setting / overwriting its content. Used by the admin editor's
 * S3 manifest hydration on mount: the backend tells us a variant lives
 * in S3, we make the name appear in listAllVariantsForAudience so the
 * picker renders a thumb, and the strip's per-variant fetch then pulls
 * the actual bytes on demand. If the variant already has bundled content,
 * this only updates the tier (so a manifest tier change overrides what
 * was bundled at build time).
 */
export function registerLayerVariant(layerId, variantKey, tier, audience = 'player') {
  const map = _contentMapFor(audience)
  const key = `${layerId}/${variantKey}`
  if (map[key] === undefined) {
    // Empty string is a "name registered, content not loaded" sentinel.
    // The strip overrides per-thumb via its fetchedContent map, and the
    // editor's open path falls back to /variant when getVariantSource
    // returns falsy — so empty here is safe.
    map[key] = ''
  }
  if (tier === 'generic' || tier === 'paid') {
    layerTiers[audience][key] = tier
  }
  layerContentVersion.value++
}

export function updateLayerVariantContent(layerId, variantKey, content, audience = 'player') {
  const map = _contentMapFor(audience)
  map[`${layerId}/${variantKey}`] = content
  // Mirror the tier so subsequent getLayerTier(...) reads the right side.
  // We can't tell the tier from content alone — caller is responsible for
  // calling setLayerTier separately if it matters. Default new in-memory
  // entries land in 'generic' if they don't already have an entry.
  if (layerTiers[audience][`${layerId}/${variantKey}`] == null) {
    layerTiers[audience][`${layerId}/${variantKey}`] = 'generic'
  }
  layerContentVersion.value++
}

export function removeLayerVariantContent(layerId, variantKey, audience = 'player') {
  delete _contentMapFor(audience)[`${layerId}/${variantKey}`]
  delete layerTiers[audience][`${layerId}/${variantKey}`]
  layerContentVersion.value++
}

export function renameLayerVariantContent(layerId, oldKey, newKey, audience = 'player') {
  const map = _contentMapFor(audience)
  const k = `${layerId}/${oldKey}`
  if (map[k] === undefined) return
  map[`${layerId}/${newKey}`] = map[k]
  delete map[k]
  const tierMap = layerTiers[audience]
  if (tierMap[k] != null) {
    tierMap[`${layerId}/${newKey}`] = tierMap[k]
    delete tierMap[k]
  }
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
/**
 * Parse a piece-color string (override OR data-color/data-color-token value)
 * into a `{ base, alpha }` pair. The base is the raw value (hex starting
 * with '#' OR a token name); alpha is null when no opacity is packed in.
 *
 * Supported forms:
 *   - "#RRGGBB"       → { base: "#RRGGBB",   alpha: null }
 *   - "#RRGGBBAA"     → { base: "#RRGGBB",   alpha: 0..1 }   (split out)
 *   - "hair.base"     → { base: "hair.base", alpha: null }
 *   - "hair.base@0.5" → { base: "hair.base", alpha: 0.5 }
 */
function _parseColorWithAlpha(input) {
  if (input == null) return { base: null, alpha: null }
  const s = String(input).trim()
  if (s.startsWith('#')) {
    if (s.length === 9) {
      const hexA = s.slice(7, 9)
      const a = parseInt(hexA, 16)
      if (Number.isFinite(a)) return { base: s.slice(0, 7), alpha: a / 255 }
    }
    return { base: s, alpha: null }
  }
  const at = s.indexOf('@')
  if (at >= 0) {
    const a = parseFloat(s.slice(at + 1))
    if (Number.isFinite(a)) {
      return { base: s.slice(0, at), alpha: Math.max(0, Math.min(1, a)) }
    }
  }
  return { base: s, alpha: null }
}

function _alphaToHex2(alpha) {
  const a = Math.max(0, Math.min(1, alpha))
  return Math.round(a * 255).toString(16).padStart(2, '0')
}

/**
 * Apply an alpha (0..1, or null=opaque) to a 6-digit hex, returning an
 * 8-digit hex when alpha < 1. Idempotent for null/1.0.
 */
function _hexWithAlpha(hex6, alpha) {
  if (alpha == null || alpha >= 1) return hex6
  return `${hex6}${_alphaToHex2(alpha)}`
}

/**
 * Legacy variant SVGs (the procedural baseline files written by the
 * Python generator and a handful of hand-authored brow/eye/headband/nose/
 * neck variants) carry color on bare rects via fill="{{token}}" or
 * fill="#HEX" — no <g data-piece> wrappers, so the new-format piece-fill
 * resolver below can't see them. That means user piece-color overrides
 * applied through LayerContextMenu silently no-op for those variants
 * because the override path keys on data-color-label.
 *
 * To unify the two formats at compose time, scan for rects with explicit
 * fills and synthesize a <g data-piece data-color-token|data-color
 * data-color-label> wrapper per unique fill, then strip the fill off the
 * underlying rect so the group's injected fill cascades down via SVG
 * attribute inheritance. The rest of the compose pipeline (_applyTokens,
 * _resolvePieceFills) then treats legacy and new variants identically —
 * picker overrides work, palette resolution works, opacity works.
 *
 * No-op for content that already declares <g data-piece> wrappers.
 */
function _wrapLegacyRectsAsPieces(inner) {
  if (/<g\b[^>]*\bdata-piece=/.test(inner)) return inner

  const rectRegex = /<rect\s+([^/>]*)\/?>/g
  const byFill = new Map() // fill → array of <rect.../> (stripped of fill attr)
  const fillOrder = []     // first-encounter order — preserves z-order across the group emit
  let m
  while ((m = rectRegex.exec(inner)) !== null) {
    const attrs = m[1]
    const fillMatch = attrs.match(/\bfill="([^"]+)"/)
    // If a rect has no fill at all there's nothing the user can override;
    // pass it through untouched (rare in legacy content but defensive).
    if (!fillMatch) continue
    const fill = fillMatch[1]
    const stripped = attrs.replace(/\s*\bfill="[^"]*"/, '')
    if (!byFill.has(fill)) {
      byFill.set(fill, [])
      fillOrder.push(fill)
    }
    byFill.get(fill).push(`<rect ${stripped.trim()}/>`)
  }

  // No fillable rects? Leave inner alone (could be an empty layer, a comment-
  // only file, or already-stripped content).
  if (fillOrder.length === 0) return inner

  const usedIds = []
  let literalCounter = 1
  const parts = []
  for (const fill of fillOrder) {
    const tokenMatch = fill.match(/^\{\{\s*([^}]+)\s*\}\}$/)
    const isToken = !!tokenMatch
    const colorToken = isToken ? tokenMatch[1].trim() : null
    const labelSeed = isToken
      ? defaultLabelForToken(colorToken)
      : `Color ${literalCounter++}`
    const id = generatePieceId(labelSeed, usedIds)
    usedIds.push(id)
    const attrs = [`data-piece="${id}"`]
    if (isToken) attrs.push(`data-color-token="${colorToken}"`)
    else attrs.push(`data-color="${fill}"`)
    attrs.push(`data-color-label="${labelSeed}"`)
    parts.push(`<g ${attrs.join(' ')}>${byFill.get(fill).join('')}</g>`)
  }
  return parts.join('\n')
}

function _resolvePieceFills(text, tokens, layerOverrides = null) {
  return text.replace(/<g\b([^>]*?)data-piece="[^"]*"([^>]*?)>/g, (match, before, after) => {
    const attrs = before + after
    if (/\sfill="[^"]*"/.test(attrs)) return match  // explicit fill present, skip

    // Sidecar opacity from the variant file's `data-color-opacity="0.5"` —
    // baseline alpha that applies when neither the override nor a packed
    // form supplies one. Admin variant editor writes this when authoring.
    const opacityAttrMatch = attrs.match(/data-color-opacity="([^"]+)"/)
    const baselineAlpha = opacityAttrMatch ? parseFloat(opacityAttrMatch[1]) : null

    // 1) User override by label — checked first so it wins over the admin's
    //    original token/literal choice. The override value is either:
    //      - a hex string ("#ffaa00", or "#ffaa00cc" with packed alpha), OR
    //      - a palette token name ("hair.base", or "hair.base@0.5" with alpha).
    if (layerOverrides) {
      const labelMatch = attrs.match(/data-color-label="([^"]+)"/)
      if (labelMatch) {
        const override = layerOverrides[labelMatch[1].trim()]
        if (override) {
          const { base, alpha } = _parseColorWithAlpha(override)
          const effectiveAlpha = alpha != null ? alpha : baselineAlpha
          const baseHex = base?.startsWith('#') ? base : (tokens[String(base).trim()] || base)
          const fill = baseHex?.startsWith('#')
            ? _hexWithAlpha(baseHex, effectiveAlpha)
            : baseHex
          if (fill) return match.replace(/>$/, ` fill="${fill}">`)
        }
      }
    }
    // 2) Palette-token piece (admin-authored). Supports packed alpha too,
    //    e.g. data-color-token="hair.base@0.5", with sidecar data-color-opacity
    //    as a fallback baseline.
    const tokenMatch = attrs.match(/data-color-token="([^"]+)"/)
    if (tokenMatch) {
      const { base, alpha } = _parseColorWithAlpha(tokenMatch[1])
      const effectiveAlpha = alpha != null ? alpha : baselineAlpha
      const hex = tokens[String(base).trim()]
      if (hex) return match.replace(/>$/, ` fill="${_hexWithAlpha(hex, effectiveAlpha)}">`)
      return match
    }
    // 3) Literal hex piece (admin-authored). Already supports 8-digit hex
    //    natively in SVG; we still split-and-recombine so the sidecar
    //    data-color-opacity can override an opaque hex.
    const litMatch = attrs.match(/data-color="([^"]+)"/)
    if (litMatch) {
      const { base, alpha } = _parseColorWithAlpha(litMatch[1])
      const effectiveAlpha = alpha != null ? alpha : baselineAlpha
      const fill = base?.startsWith('#') ? _hexWithAlpha(base, effectiveAlpha) : litMatch[1]
      return match.replace(/>$/, ` fill="${fill}">`)
    }
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
function _renderLayer(layerId, variantKey, tokens, metaAttrs = {}, overrideContent = null, pieceOverrides = null, audience = 'player') {
  const attrStr = _buildAttrString(layerId, metaAttrs)
  // 'none' is a virtual variant that hides the layer entirely — already
  // used by stubble/headband as their "off" value, and surfaced via the
  // admin backdrop picker as a generic "hide this layer" option.
  if (variantKey === 'none') variantKey = null
  if (!variantKey && !overrideContent) {
    return `<g${attrStr}>\n</g>`
  }
  const content = overrideContent ?? _contentMapFor(audience)[`${layerId}/${variantKey}`]
  if (!content) {
    console.warn(`[headshotComposer] missing layer file: ${audience}/${layerId}/${variantKey}.svg`)
    return `<g${attrStr}>\n</g>`
  }
  // Three-pass resolution:
  //   0) wrap legacy `fill="{{token}}"` / `fill="#HEX"` rects in synthetic
  //      <g data-piece> groups so user piece-color overrides apply uniformly
  //      across legacy and new-format variants (no-op for new format),
  //   1) rect-level {{tokens}} for any residual placeholders (defensive — the
  //      wrap pass strips rect fills, so this typically has nothing left to
  //      substitute on legacy content),
  //   2) group-level fill injection for <g data-piece> wrappers with optional
  //      user piece-color overrides applied first.
  let inner = _wrapLegacyRectsAsPieces(_extractInnerLines(content))
  inner = _applyTokens(inner, tokens)
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
    // jawWidth is the integer key into JAW_NAMES, which is now built from
    // whatever face variants are on disk — so the valid range can extend
    // beyond [0, 1, 2] when the admin adds more face variants.
    // jawWidth validates against the UNION of player+coach indices so
    // cross-audience configs (e.g. a coach premade opening in the editor)
    // don't get clobbered. composeSvg resolves the actual file by audience.
    jawWidth:     Number.isInteger(Number(config.jawWidth)) && VARIANTS.jawWidth.includes(Number(config.jawWidth))
      ? Number(config.jawWidth) : (VARIANTS.jawWidth[0] ?? 0),
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
    // Per-piece color overrides parsed back out of saved SVGs by
    // parseSvgConfig. Pass through unchanged — composeSvg's _resolvePieceFills
    // wins over the data-color / data-color-token defaults using this map.
    // Without this pass-through, picking a premade with admin-customized
    // hair colors loses the overrides on re-compose.
    pieceColors: (config.pieceColors && typeof config.pieceColors === 'object')
      ? config.pieceColors : undefined,
  }
}

/**
 * Compose an SVG string from a config object. Layer draw order matches the
 * Python script so the visual output is identical.
 *
 * `overrides` is an optional map of `layerId → SVG content string` used by
 * the admin variant editor to render its in-memory pieces in place of the
 * on-disk variant for that layer. Other layers still load normally from
 * the audience's content map, which is why the backdrop shows the rest of
 * the head while the admin edits just one layer.
 *
 * `audience` selects which folder set we read variant files from. Defaults
 * to 'player' so legacy callers keep working. The coach editor and the
 * admin Coaches tab pass 'coach' explicitly.
 */
export function composeSvg(config, overrides = null, audience = 'player') {
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
  // no override is set (the user-facing default path). The mapping is
  // per-audience so coach configs resolve to coach face files.
  const faceFile = c.faceVariantOverride || getJawName(c.jawWidth, audience)
  // Eyebrow file: admin backdrop can pin to any on-disk filename; otherwise
  // fall back to the canonical thickness × angle composition.
  const browFile = c.browVariantOverride || `${BROW_THICK_NAMES[c.browThickness]}-${c.browAngle}`

  // Stacking order: later push = painted on top (SVG document order). The
  // top-of-stack pair is hair (second-to-last) then headband (last) so a
  // headband always wraps over hair, and hair wraps over every face-level
  // feature (bangs/fringes overlap forehead, brows, neck/shoulders).
  // Stamp `data-file` so parseSvgConfig can recover the exact filename used
  // (matters for admin-authored custom variants whose names don't map to
  // the canonical integer-keyed JAW_NAMES path). Without it, a premade
  // built off a custom face would round-trip back to the default jawWidth
  // file in the user editor.
  // Filename-vs-config-key boundary: config fields use underscores
  // (`wide_grin`) for legibility but variant SVGs live on disk with
  // hyphens (`wide-grin.svg`). Old single-token variants like `thin` /
  // `wide` never tripped this — hyphenated names from admin-authored
  // variants did, leaving `LAYER_CONTENT['mouth/wide_grin']` undefined
  // even when `mouth/wide-grin.svg` was on S3. `_fileKey` normalizes
  // every string-keyed variant lookup so any new multi-word variant
  // works uniformly. `null` (off-state for stubble/headband) and
  // `'none'` (which `_renderLayer` collapses to an empty wrapper)
  // pass through unchanged.
  const _fileKey = (v) => (v == null || v === 'none' ? v : String(v).replace(/_/g, '-'))

  parts.push(_renderLayer('face', faceFile, tokens, { skin: c.skin, jaw: c.jawWidth, file: faceFile }, ov('face'), po('face'), audience))
  parts.push(_renderLayer(
    'stubble',
    _fileKey(c.stubbleStyle === 'none' ? null : c.stubbleStyle),
    tokens,
    {
      style: c.stubbleStyle,
      // Legacy attr kept for old consumers (analytics, downstream parsers)
      // that still branch on the boolean form.
      enabled: c.stubbleStyle !== 'none' ? 'true' : 'false',
    },
    ov('stubble'), po('stubble'), audience,
  ))
  // `data-file` records the exact eyebrow filename — needed so admin-
  // authored variants whose names don't match the canonical thickness-angle
  // pattern (e.g. "custom-arch") round-trip through saved SVGs and premades.
  parts.push(_renderLayer('eyebrows', browFile, tokens, {
    thickness: c.browThickness,
    angle: c.browAngle,
    color: c.eyebrowColor,
    file: browFile,
  }, ov('eyebrows'), po('eyebrows'), audience))
  parts.push(_renderLayer('eyes', _fileKey(c.eyeShape), tokens, { shape: c.eyeShape, color: c.eye }, ov('eyes'), po('eyes'), audience))
  parts.push(_renderLayer('nose', _fileKey(c.noseShape), tokens, { shape: c.noseShape }, ov('nose'), po('nose'), audience))
  parts.push(_renderLayer('mouth', _fileKey(c.mouthFullness), tokens, { fullness: c.mouthFullness, color: c.lip }, ov('mouth'), po('mouth'), audience))
  parts.push(_renderLayer('neck', _fileKey(c.neckStyle), tokens, { style: c.neckStyle }, ov('neck'), po('neck'), audience))
  parts.push(_renderLayer('hair', hairFile, tokens, { style: c.hairStyle, color: c.hair }, ov('hair'), po('hair'), audience))
  parts.push(_renderLayer(
    'headband',
    _fileKey(c.headband === 'none' ? null : c.headband),
    tokens,
    { style: c.headband },
    ov('headband'), po('headband'), audience,
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
        // Recover the exact face filename if composeSvg stamped one (admin-
        // authored variant whose name doesn't map to the canonical
        // integer-keyed JAW_NAMES path).
        if (attrs.file) config.faceVariantOverride = attrs.file
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
        // Recover the exact brow filename — admin-authored custom eyebrow
        // variants whose names don't match the canonical thickness-angle
        // pattern would otherwise revert to the composed default on load.
        if (attrs.file) config.browVariantOverride = attrs.file
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

  // Per-piece color overrides. composeSvg writes `fill="#HEX"` onto each
  // `<g data-piece ... data-color-label="LABEL">` based on the active
  // `pieceColors` map (or the authored data-color / data-color-token
  // fallbacks). To make admin-created premades round-trip — so a user
  // picking one sees the admin's exact per-piece colors instead of the
  // authored defaults — we re-extract those fills here, grouped by their
  // enclosing data-layer wrapper.
  //
  // Strategy: walk all layer-wrapper start positions, then for each layer
  // scan the document slice between its start and the next layer's start
  // for `<g data-piece ... fill="HEX" ... data-color-label="LABEL">`.
  // Layer groups don't nest (the renderer emits them flat as siblings),
  // so position-bounded slicing is safe.
  const layerSpans = []
  const layerSpanRegex = /<g\s+data-layer=["'](\w+)["'][^>]*>/g
  let lm
  while ((lm = layerSpanRegex.exec(svgString)) !== null) {
    layerSpans.push({
      layerId: lm[1],
      bodyStart: lm.index + lm[0].length,
      tagStart: lm.index,
    })
  }
  if (layerSpans.length > 0) {
    const pieceColors = {}
    for (let i = 0; i < layerSpans.length; i++) {
      const { layerId, bodyStart } = layerSpans[i]
      const bodyEnd = i + 1 < layerSpans.length
        ? layerSpans[i + 1].tagStart
        : svgString.length
      const body = svgString.slice(bodyStart, bodyEnd)
      const pieceRegex = /<g\b([^>]*\sdata-piece=["'][^"']*["'][^>]*)>/g
      let pm
      while ((pm = pieceRegex.exec(body)) !== null) {
        const attrs = pm[1]
        const labelMatch = attrs.match(/data-color-label=["']([^"']+)["']/)
        const fillMatch = attrs.match(/\sfill=["']([^"']+)["']/)
        if (!labelMatch || !fillMatch) continue
        if (!pieceColors[layerId]) pieceColors[layerId] = {}
        pieceColors[layerId][labelMatch[1]] = fillMatch[1]
      }
    }
    if (Object.keys(pieceColors).length > 0) {
      config.pieceColors = pieceColors
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
