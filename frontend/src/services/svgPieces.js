// =============================================================================
// svgPieces.js — variant SVG ↔ piece array transformations
// =============================================================================
// The admin variant editor works with an in-memory "pieces" array:
//   { id, label, colorMode, colorToken?, colorHex?, transform, rects, visible }
//
// On disk, a variant SVG can be in one of two shapes:
//   (a) NEW format: explicit <g data-piece data-color-token | data-color
//       data-color-label transform> wrappers around rects
//   (b) LEGACY format: flat rects with fill="{{token}}" or fill="HEX" and no
//       grouping (every shipped layer file is currently legacy)
//
// parseVariantPieces handles both — legacy files are auto-migrated into
// pieces by grouping rects with the same fill into one piece.
// serializeVariantPieces always writes the NEW format.
// =============================================================================

const VIEWBOX_HEADER = '<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">'

/**
 * Convert a token like 'hair.base' to a human label like 'Hair Base'.
 * Used by legacy migration to seed sensible default labels.
 */
export function defaultLabelForToken(token) {
  if (!token) return 'Color'
  return token
    .split('.')
    .map(part => part.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    .join(' ')
}

/**
 * Slugify an arbitrary string into a piece id ('Hair Glow' → 'hair-glow').
 * If the result collides with an existing id, appends '-2', '-3', ...
 */
export function generatePieceId(seed, existingIds = []) {
  const base = String(seed || 'piece')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'piece'
  if (!existingIds.includes(base)) return base
  let n = 2
  while (existingIds.includes(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * Parse a variant SVG into a Piece[]. Handles both the NEW <g data-piece>
 * format and the LEGACY flat-rect format (auto-grouping by fill).
 */
export function parseVariantPieces(svgString) {
  if (!svgString || typeof svgString !== 'string') return []

  // Strip the <svg> wrapper (we just want the inner content).
  const innerMatch = svgString.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i)
  const inner = innerMatch ? innerMatch[1] : svgString

  // Try NEW format first — find <g data-piece="..." ...>...</g> groups.
  const newPieces = _parseNewFormatPieces(inner)
  if (newPieces.length > 0) return newPieces

  // Fall back to LEGACY migration: group bare rects by fill.
  return _migrateLegacyRects(inner)
}

function _parseNewFormatPieces(inner) {
  const pieces = []
  // Match <g ...data-piece="..."...>...</g> with non-greedy body. Allow
  // attributes in any order. SVG never legally nests <g> inside another
  // piece's <g>, so a non-greedy match to the next </g> is safe here.
  const groupRegex = /<g\s+([^>]*?data-piece="[^"]+"[^>]*)>([\s\S]*?)<\/g>/g
  let match
  while ((match = groupRegex.exec(inner)) !== null) {
    const attrs = _parseAttrs(match[1])
    const body = match[2]
    if (!attrs['data-piece']) continue

    const rects = _parseRects(body)

    pieces.push({
      id: attrs['data-piece'],
      label: attrs['data-color-label'] || defaultLabelForToken(attrs['data-color-token']) || 'Piece',
      colorMode: attrs['data-color-token'] ? 'token' : 'literal',
      colorToken: attrs['data-color-token'] || null,
      colorHex: attrs['data-color'] || null,
      // Optional sidecar opacity (0..1). Null = fully opaque (back-compat
      // with every piece authored before opacity support landed).
      colorOpacity: attrs['data-color-opacity'] != null
        ? _parseAlphaAttr(attrs['data-color-opacity'])
        : null,
      transform: _parseTransform(attrs['transform']),
      rects,
      visible: true,
    })
  }
  return pieces
}

function _parseAlphaAttr(v) {
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1, n))
}

function _migrateLegacyRects(inner) {
  const rectRegex = /<rect\s+([^/>]*)\/?>/g
  const byFill = new Map() // fill → rect[]
  const fillOrder = []      // preserve first-encounter order for stacking
  let match
  while ((match = rectRegex.exec(inner)) !== null) {
    const attrs = _parseAttrs(match[1])
    const fill = attrs.fill || '#000000'
    if (!byFill.has(fill)) {
      byFill.set(fill, [])
      fillOrder.push(fill)
    }
    byFill.get(fill).push({
      x: Number(attrs.x) || 0,
      y: Number(attrs.y) || 0,
      w: Number(attrs.width) || 1,
      h: Number(attrs.height) || 1,
    })
  }

  const pieces = []
  const usedIds = []
  let literalCounter = 1
  for (const fill of fillOrder) {
    const tokenMatch = fill.match(/^\{\{\s*([^}]+)\s*\}\}$/)
    const colorMode = tokenMatch ? 'token' : 'literal'
    const colorToken = tokenMatch ? tokenMatch[1].trim() : null
    const colorHex = tokenMatch ? null : fill
    const labelSeed = tokenMatch
      ? defaultLabelForToken(colorToken)
      : `Color ${literalCounter++}`
    const id = generatePieceId(labelSeed, usedIds)
    usedIds.push(id)
    pieces.push({
      id,
      label: labelSeed,
      colorMode,
      colorToken,
      colorHex,
      transform: { x: 0, y: 0, rotation: 0 },
      rects: byFill.get(fill),
      visible: true,
    })
  }
  return pieces
}

function _parseAttrs(blob) {
  const out = {}
  const attrRegex = /([a-zA-Z-]+)="([^"]*)"/g
  let m
  while ((m = attrRegex.exec(blob)) !== null) {
    out[m[1]] = m[2]
  }
  return out
}

function _parseRects(body) {
  const rects = []
  const rectRegex = /<rect\s+([^/>]*)\/?>/g
  let m
  while ((m = rectRegex.exec(body)) !== null) {
    const a = _parseAttrs(m[1])
    rects.push({
      x: Number(a.x) || 0,
      y: Number(a.y) || 0,
      w: Number(a.width) || 1,
      h: Number(a.height) || 1,
    })
  }
  return rects
}

function _parseTransform(transformStr) {
  const out = { x: 0, y: 0, rotation: 0 }
  if (!transformStr) return out
  const translateMatch = transformStr.match(/translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/)
  if (translateMatch) {
    out.x = Number(translateMatch[1]) || 0
    out.y = Number(translateMatch[2]) || 0
  }
  const rotateMatch = transformStr.match(/rotate\(\s*(-?\d+(?:\.\d+)?)/)
  if (rotateMatch) {
    out.rotation = Number(rotateMatch[1]) || 0
  }
  return out
}

/**
 * Serialize a Piece[] back to a standalone variant SVG string. Always emits
 * the NEW format with explicit <g data-piece> wrappers — saving converges
 * legacy variants onto the new shape.
 */
export function serializeVariantPieces(pieces) {
  const lines = [VIEWBOX_HEADER]
  for (const piece of pieces) {
    lines.push(_serializePiece(piece))
  }
  lines.push('</svg>')
  return lines.join('\n')
}

function _serializePiece(piece) {
  const attrs = [`data-piece="${_escapeAttr(piece.id)}"`]
  if (piece.colorMode === 'token' && piece.colorToken) {
    attrs.push(`data-color-token="${_escapeAttr(piece.colorToken)}"`)
  } else if (piece.colorMode === 'literal' && piece.colorHex) {
    attrs.push(`data-color="${_escapeAttr(piece.colorHex)}"`)
  }
  if (piece.label) {
    attrs.push(`data-color-label="${_escapeAttr(piece.label)}"`)
  }
  // Sidecar opacity. Skip when null or fully opaque (1) to keep variant
  // files clean and back-compat with consumers that don't know about the
  // attribute.
  if (piece.colorOpacity != null && piece.colorOpacity < 1) {
    const a = Math.max(0, Math.min(1, Number(piece.colorOpacity)))
    attrs.push(`data-color-opacity="${a.toFixed(2)}"`)
  }
  const transformStr = _serializeTransform(piece.transform, piece.rects)
  if (transformStr) attrs.push(`transform="${transformStr}"`)

  const rectLines = (piece.rects || []).map(r =>
    `    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`
  )
  if (rectLines.length === 0) {
    return `  <g ${attrs.join(' ')}></g>`
  }
  return [
    `  <g ${attrs.join(' ')}>`,
    ...rectLines,
    `  </g>`,
  ].join('\n')
}

function _serializeTransform(t, rects) {
  if (!t) return ''
  const x = Number(t.x) || 0
  const y = Number(t.y) || 0
  const rot = Number(t.rotation) || 0
  if (x === 0 && y === 0 && rot === 0) return ''
  const parts = []
  if (x !== 0 || y !== 0) parts.push(`translate(${x} ${y})`)
  if (rot !== 0) {
    // Rotate around the piece's bbox center so 90° turns stay visually centered.
    const bbox = _bboxOf(rects)
    const cx = bbox.x + bbox.w / 2
    const cy = bbox.y + bbox.h / 2
    parts.push(`rotate(${rot} ${cx} ${cy})`)
  }
  return parts.join(' ')
}

function _bboxOf(rects) {
  if (!rects || rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rects) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.w > maxX) maxX = r.x + r.w
    if (r.y + r.h > maxY) maxY = r.y + r.h
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function _escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
