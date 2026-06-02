// =============================================================================
// headshotComposer.js — JS port of generate_headshots.py
// =============================================================================
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

export const VARIANTS = {
  hairStyle:        ['short', 'fade', 'wavy', 'side_part', 'curly', 'buzz', 'afro'],
  jawWidth:         [0, 1, 2],
  browThickness:    [1, 2],
  browAngle:        ['flat', 'up', 'down'],
  eyeShape:         ['round', 'almond'],
  noseShape:        ['narrow', 'medium', 'broad'],
  mouthFullness:    ['thin', 'full'],
  headbandStyle:    ['none', 'white', 'black'],
}

// ---------------------------------------------------------------------------
// Layer registry — used by the editor sidebar/bottom-nav
// ---------------------------------------------------------------------------
// Each layer declares what's editable. The editor renders a layer button per
// entry; clicking opens the contextual menu sourced from the layer's
// styleVariants/colorPalette. Add a new layer = add an entry here + add a
// build_* function above + stamp metadata in generate_headshots.py.

export const LAYERS = [
  { id: 'hair',     label: 'Hair',     styleKey: 'hairStyle',     styleVariants: VARIANTS.hairStyle,     colorKey: 'hair',         colorPalette: HAIR_COLORS },
  { id: 'face',     label: 'Face',     styleKey: 'jawWidth',      styleVariants: VARIANTS.jawWidth,      colorKey: 'skin',         colorPalette: SKIN_TONES },
  { id: 'eyes',     label: 'Eyes',     styleKey: 'eyeShape',      styleVariants: VARIANTS.eyeShape,      colorKey: 'eye',          colorPalette: EYE_COLORS },
  { id: 'eyebrows', label: 'Brows',    styleKey: 'browThickness', styleVariants: VARIANTS.browThickness, colorKey: 'eyebrowColor', colorPalette: HAIR_COLORS },
  { id: 'nose',     label: 'Nose',     styleKey: 'noseShape',     styleVariants: VARIANTS.noseShape },
  { id: 'mouth',    label: 'Mouth',    styleKey: 'mouthFullness', styleVariants: VARIANTS.mouthFullness, colorKey: 'lip',          colorPalette: LIP_COLORS },
  { id: 'stubble',  label: 'Stubble',  toggleKey: 'hasStubble' },
  { id: 'headband', label: 'Headband', styleKey: 'headband',      styleVariants: VARIANTS.headbandStyle },
  { id: 'neck',     label: 'Neck' },  // no edits — derives from face skin
]

// ---------------------------------------------------------------------------
// Build helpers — direct port of the Python rect()/layer_open() pattern
// ---------------------------------------------------------------------------

function rect(x, y, w, h, fill) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`
}

function layerOpen(parts, layerId, attrs = {}) {
  let attrStr = ''
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue
    attrStr += ` data-${k.replace(/_/g, '-')}="${v}"`
  }
  parts.push(`<g data-layer="${layerId}"${attrStr}>`)
}

function layerClose(parts) {
  parts.push('</g>')
}

// ---------------------------------------------------------------------------
// Layer builders (ports of build_* in generate_headshots.py)
// ---------------------------------------------------------------------------

function buildFace(parts, skin, jawWidth, skinName) {
  const { base: b, hi, sh } = skin
  const inset = { 0: 1, 1: 0, 2: 0 }[jawWidth]
  const lowX = 17 + inset
  const lowW = 30 - 2 * inset
  const chinX = 20 + inset + (jawWidth === 0 ? 1 : 0)
  const chinW = lowW - 2 * (chinX - lowX)

  layerOpen(parts, 'face', { skin: skinName, jaw: jawWidth })
  parts.push(rect(17, 15, 30, 20, b))
  parts.push(rect(15, 18, 2, 13, b))
  parts.push(rect(47, 18, 2, 13, b))
  parts.push(rect(lowX, 35, lowW, 7, b))
  parts.push(rect(chinX, 42, Math.max(chinW, 12), 3, sh))
  parts.push(rect(17, 15, 30, 2, hi))
  parts.push(rect(19, 17, 4, 2, hi))
  parts.push(rect(41, 17, 4, 2, hi))
  parts.push(rect(15, 20, 2, 8, sh))
  parts.push(rect(47, 20, 2, 8, sh))
  parts.push(rect(17, 33, 4, 4, sh))
  parts.push(rect(43, 33, 4, 4, sh))
  parts.push(rect(19, 29, 4, 3, hi))
  parts.push(rect(41, 29, 4, 3, hi))
  layerClose(parts)
}

function buildStubble(parts, skin, hasStubble) {
  layerOpen(parts, 'stubble', { enabled: hasStubble ? 'true' : 'false' })
  if (hasStubble) {
    parts.push(rect(18, 38, 28, 2, skin.sh))
    parts.push(rect(22, 40, 20, 2, skin.deep))
  }
  layerClose(parts)
}

function buildHair(parts, hair, style, hairName) {
  const { base: b, hi, sh } = hair
  layerOpen(parts, 'hair', { style, color: hairName })
  if (style === 'short') {
    parts.push(rect(18, 7, 28, 3, b))
    parts.push(rect(16, 10, 32, 3, hi))
    parts.push(rect(15, 13, 34, 2, b))
    parts.push(rect(14, 15, 36, 1, sh))
    parts.push(rect(14, 16, 2, 4, b))
    parts.push(rect(48, 16, 2, 4, b))
  } else if (style === 'fade') {
    parts.push(rect(19, 8, 26, 3, b))
    parts.push(rect(17, 11, 30, 3, hi))
    parts.push(rect(16, 14, 32, 2, b))
    parts.push(rect(15, 16, 2, 3, sh))
    parts.push(rect(47, 16, 2, 3, sh))
  } else if (style === 'wavy') {
    parts.push(rect(19, 5, 26, 3, b))
    parts.push(rect(16, 8, 32, 3, hi))
    parts.push(rect(15, 11, 34, 3, b))
    parts.push(rect(14, 14, 36, 3, hi))
    parts.push(rect(21, 4, 22, 1, hi))
    parts.push(rect(22, 6, 3, 2, hi))
    parts.push(rect(30, 5, 3, 2, hi))
    parts.push(rect(38, 6, 3, 2, hi))
    parts.push(rect(14, 17, 2, 6, b))
    parts.push(rect(48, 17, 2, 6, b))
  } else if (style === 'side_part') {
    parts.push(rect(18, 6, 28, 3, b))
    parts.push(rect(16, 9, 32, 3, hi))
    parts.push(rect(15, 12, 34, 3, b))
    parts.push(rect(14, 15, 36, 2, sh))
    parts.push(rect(20, 5, 24, 1, hi))
    parts.push(rect(26, 6, 3, 6, hi))
    parts.push(rect(20, 6, 26, 1, hi))
    parts.push(rect(14, 17, 2, 5, b))
    parts.push(rect(48, 17, 2, 5, b))
  } else if (style === 'curly') {
    for (let cx = 16; cx < 46; cx += 4) {
      parts.push(rect(cx, 5, 4, 4, (Math.floor(cx / 4) % 2) ? b : hi))
    }
    parts.push(rect(15, 9, 34, 4, b))
    parts.push(rect(14, 13, 36, 3, hi))
    parts.push(rect(14, 16, 2, 5, b))
    parts.push(rect(48, 16, 2, 5, b))
  } else if (style === 'buzz') {
    parts.push(rect(17, 10, 30, 3, b))
    parts.push(rect(16, 12, 32, 2, hi))
    parts.push(rect(15, 13, 34, 2, sh))
  } else { // afro / tall
    parts.push(rect(16, 3, 32, 5, b))
    parts.push(rect(14, 6, 36, 4, hi))
    parts.push(rect(13, 9, 38, 4, b))
    parts.push(rect(13, 13, 38, 3, hi))
    parts.push(rect(13, 16, 3, 6, b))
    parts.push(rect(48, 16, 3, 6, b))
  }
  layerClose(parts)
}

function buildEyebrows(parts, brow, thickness, angle, browColorName) {
  // `brow` is the HAIR_COLORS palette entry chosen for the eyebrow itself
  // (defaults to the head's hair palette, but the user can override via the
  // eyebrows layer's color picker). The flat-angle softening rects use the
  // same palette's hi shade so the eyebrow is internally consistent.
  const color = brow.base !== '#2a2018' ? brow.sh : '#1c140e'
  const w = thickness === 1 ? 8 : 9
  const [lx, rx] = thickness === 1 ? [20, 36] : [19, 36]
  layerOpen(parts, 'eyebrows', { thickness, angle, color: browColorName })
  parts.push(rect(lx, 21, w, thickness, color))
  parts.push(rect(rx, 21, w, thickness, color))
  if (angle === 'up') {
    parts.push(rect(lx, 20, 3, 1, color))
    parts.push(rect(rx + w - 3, 20, 3, 1, color))
  } else if (angle === 'down') {
    parts.push(rect(lx + w - 3, 20, 3, 1, color))
    parts.push(rect(rx, 20, 3, 1, color))
  } else {
    parts.push(rect(lx, 20, 3, 1, brow.hi))
    parts.push(rect(rx + w - 3, 20, 3, 1, brow.hi))
  }
  layerClose(parts)
}

function buildEyes(parts, skin, eye, shape, eyeName) {
  const { iris, pupil } = eye
  const sh = skin.sh
  layerOpen(parts, 'eyes', { shape, color: eyeName })
  const eh = shape === 'round' ? 4 : 3
  const ey = shape === 'round' ? 24 : 25
  parts.push(rect(20, ey, 8, eh, '#ffffff'))
  parts.push(rect(36, ey, 8, eh, '#ffffff'))
  parts.push(rect(23, ey, 3, eh, iris))
  parts.push(rect(38, ey, 3, eh, iris))
  parts.push(rect(24, ey, 2, 2, pupil))
  parts.push(rect(39, ey, 2, 2, pupil))
  parts.push(rect(24, ey, 1, 1, '#ffffff'))
  parts.push(rect(39, ey, 1, 1, '#ffffff'))
  if (shape === 'almond') {
    parts.push(rect(20, 24, 8, 1, skin.deep))
    parts.push(rect(36, 24, 8, 1, skin.deep))
  }
  parts.push(rect(20, ey + eh, 8, 1, sh))
  parts.push(rect(36, ey + eh, 8, 1, sh))
  layerClose(parts)
}

function buildNose(parts, skin, shape) {
  const { base: b, hi, sh, deep } = skin
  layerOpen(parts, 'nose', { shape })
  if (shape === 'narrow') {
    parts.push(rect(31, 27, 2, 7, sh))
    parts.push(rect(30, 33, 4, 1, deep))
    parts.push(rect(33, 28, 1, 5, hi))
    parts.push(rect(29, 34, 2, 1, deep))
    parts.push(rect(33, 34, 2, 1, deep))
  } else if (shape === 'broad') {
    parts.push(rect(30, 28, 4, 6, sh))
    parts.push(rect(29, 33, 6, 2, deep))
    parts.push(rect(33, 29, 1, 4, hi))
    parts.push(rect(28, 34, 2, 1, deep))
    parts.push(rect(34, 34, 2, 1, deep))
    parts.push(rect(31, 33, 2, 2, b))
  } else { // medium
    parts.push(rect(31, 27, 2, 6, sh))
    parts.push(rect(30, 32, 4, 2, deep))
    parts.push(rect(33, 28, 1, 4, hi))
    parts.push(rect(29, 33, 2, 1, deep))
    parts.push(rect(33, 33, 2, 1, deep))
  }
  layerClose(parts)
}

function buildMouth(parts, skin, lip, fullness, lipName) {
  const hi = skin.hi
  layerOpen(parts, 'mouth', { fullness, color: lipName })
  if (fullness === 'full') {
    parts.push(rect(27, 38, 10, 1, '#8a4a3c'))
    parts.push(rect(28, 39, 8, 2, lip))
    parts.push(rect(29, 37, 6, 1, hi))
  } else {
    parts.push(rect(27, 37, 10, 1, '#5e3a23'))
    parts.push(rect(28, 38, 8, 1, lip))
    parts.push(rect(29, 36, 6, 1, hi))
  }
  parts.push(rect(27, 40, 10, 2, skin.sh))
  layerClose(parts)
}

function buildNeck(parts, skin) {
  layerOpen(parts, 'neck', {})
  parts.push(rect(24, 45, 16, 3, skin.sh))
  parts.push(rect(24, 45, 16, 1, skin.deep))
  parts.push(rect(26, 45, 12, 1, skin.deep))
  layerClose(parts)
}

function buildHeadband(parts, headbandKey) {
  const style = headbandKey || 'none'
  layerOpen(parts, 'headband', { style })
  const palette = HEADBAND_STYLES[style]
  if (palette) {
    parts.push(rect(14, 13, 36, 4, palette.main))
    parts.push(rect(14, 13, 36, 1, palette.edge))
    parts.push(rect(14, 16, 36, 1, palette.edge))
    parts.push(rect(14, 13, 2, 4, palette.edge))
    parts.push(rect(48, 13, 2, 4, palette.edge))
  }
  layerClose(parts)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate + fill missing fields in a config so composeSvg always succeeds
 * even if parseSvgConfig returned partials from a legacy SVG.
 */
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
    hairStyle:    VARIANTS.hairStyle.includes(config.hairStyle) ? config.hairStyle : 'short',
    browThickness: [1, 2].includes(Number(config.browThickness)) ? Number(config.browThickness) : 1,
    browAngle:    VARIANTS.browAngle.includes(config.browAngle) ? config.browAngle : 'flat',
    eyeShape:     VARIANTS.eyeShape.includes(config.eyeShape) ? config.eyeShape : 'round',
    noseShape:    VARIANTS.noseShape.includes(config.noseShape) ? config.noseShape : 'medium',
    mouthFullness: VARIANTS.mouthFullness.includes(config.mouthFullness) ? config.mouthFullness : 'thin',
    hasStubble:   !!config.hasStubble,
    headband:     VARIANTS.headbandStyle.includes(config.headband) ? config.headband : 'none',
  }
}

/**
 * Compose an SVG string from a config object. Layer draw order matches the
 * Python script so the visual output is identical.
 */
export function composeSvg(config) {
  const c = normalizeConfig(config)
  const skin = SKIN_TONES[c.skin]
  const hair = HAIR_COLORS[c.hair]
  const eye = EYE_COLORS[c.eye]
  const lip = LIP_COLORS[c.lip]

  const parts = [
    '<svg width="500" height="500" viewBox="70 -30 500 500" xmlns="http://www.w3.org/2000/svg">',
    '<g shape-rendering="crispEdges">',
    '<g transform="scale(10)">',
  ]

  const brow = HAIR_COLORS[c.eyebrowColor] || hair
  buildHair(parts, hair, c.hairStyle, c.hair)
  buildFace(parts, skin, c.jawWidth, c.skin)
  buildStubble(parts, skin, c.hasStubble)
  buildHeadband(parts, c.headband === 'none' ? null : c.headband)
  buildEyebrows(parts, brow, c.browThickness, c.browAngle, c.eyebrowColor)
  buildEyes(parts, skin, eye, c.eyeShape, c.eye)
  buildNose(parts, skin, c.noseShape)
  buildMouth(parts, skin, lip, c.mouthFullness, c.lip)
  buildNeck(parts, skin)

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
        config.hasStubble = attrs.enabled === 'true'
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
      // 'neck' has no editable params
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
