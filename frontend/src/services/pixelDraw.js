// =============================================================================
// pixelDraw.js — pure pixel-math helpers for the admin variant editor
// =============================================================================
// No Vue dependencies — easy to unit-test, easy to reuse from any tool
// handler in AdminPixelCanvas.vue.
//
// Coordinate convention: integer (x, y) on the 64×64 grid. Rects are
// { x, y, w, h } with positive w/h. The grid origin is top-left.
// =============================================================================

/**
 * Rasterize a filled ellipse inscribed in the given bbox into 1×1 grid cells.
 * Used by the shape tool's circle variant: the admin drags a bbox, we fill
 * the inscribed ellipse with pixels (no native <ellipse> element since the
 * piece data model only stores rects). Test by pixel center against the
 * standard ellipse equation (dx/rx)² + (dy/ry)² ≤ 1.
 */
export function rasterizeEllipse(bbox) {
  if (!bbox || bbox.w <= 0 || bbox.h <= 0) return []
  const cx = bbox.x + bbox.w / 2
  const cy = bbox.y + bbox.h / 2
  const rx = bbox.w / 2
  const ry = bbox.h / 2
  const pixels = []
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const ndx = (px - cx) / rx
      const ndy = (py - cy) / ry
      if (ndx * ndx + ndy * ndy <= 1) pixels.push({ x, y })
    }
  }
  return pixels
}

/**
 * Bresenham line rasterization. Returns the list of grid cells the line from
 * (x0, y0) to (x1, y1) passes through, in order. Used by the pencil tool to
 * fill gaps between consecutive cursor positions during a drag, so a fast
 * stroke doesn't leave dotted gaps.
 */
export function bresenhamLine(x0, y0, x1, y1) {
  const points = []
  let x = Math.round(x0)
  let y = Math.round(y0)
  const tx = Math.round(x1)
  const ty = Math.round(y1)
  const dx = Math.abs(tx - x)
  const dy = -Math.abs(ty - y)
  const sx = x < tx ? 1 : -1
  const sy = y < ty ? 1 : -1
  let err = dx + dy
  // Cap iterations to avoid an infinite loop on pathological input.
  let safety = 4096
  while (safety-- > 0) {
    points.push({ x, y })
    if (x === tx && y === ty) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
  return points
}

/**
 * Hit-test whether (x, y) falls within a rect's bounding box. Inclusive on
 * the top-left edge, exclusive on the bottom-right (standard pixel semantics).
 */
export function pointInRect(x, y, rect) {
  if (!rect) return false
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
}

/**
 * Compute the bounding box of a piece's rects in piece-local coordinates
 * (before transform is applied). Returns null if the piece has no rects.
 */
export function pieceBoundingBox(piece) {
  if (!piece?.rects || piece.rects.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of piece.rects) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.w > maxX) maxX = r.x + r.w
    if (r.y + r.h > maxY) maxY = r.y + r.h
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Same as pieceBoundingBox but in canvas (post-transform) coordinates.
 * For translate-only transforms this is just bbox + translation. Rotation
 * is restricted to 90° increments so we can swap w/h cleanly without
 * losing axis alignment.
 */
export function pieceCanvasBoundingBox(piece) {
  const local = pieceBoundingBox(piece)
  if (!local) return null
  const t = piece.transform || { x: 0, y: 0, rotation: 0 }
  const rotated = _rotateBox(local, t.rotation || 0)
  return {
    x: rotated.x + (t.x || 0),
    y: rotated.y + (t.y || 0),
    w: rotated.w,
    h: rotated.h,
  }
}

function _rotateBox(box, rotation) {
  // Rotate the bbox around its own center in 90° steps. The center stays
  // put; for 90/270 the width and height swap.
  const norm = ((rotation % 360) + 360) % 360
  if (norm === 0 || norm === 180) return { ...box }
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const newW = box.h
  const newH = box.w
  return {
    x: cx - newW / 2,
    y: cy - newH / 2,
    w: newW,
    h: newH,
  }
}

/**
 * Return all pieces whose canvas bounding box intersects the marquee rect.
 * Used by the Select tool for rubber-band selection.
 */
export function piecesUnderMarquee(pieces, marquee) {
  if (!marquee) return []
  const m = _normalizeRect(marquee)
  const hits = []
  for (const piece of pieces) {
    const bbox = pieceCanvasBoundingBox(piece)
    if (!bbox || bbox.w === 0 || bbox.h === 0) continue
    if (_rectsIntersect(m, bbox)) hits.push(piece)
  }
  return hits
}

/**
 * Hit-test the topmost piece at (x, y). Iterates pieces in reverse since
 * later array entries render on top. Used by Select tool single-click.
 * Considers a piece "hit" if any of its rects contains the point after
 * the piece's transform is applied.
 */
export function topPieceAt(pieces, x, y) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]
    if (!piece || !piece.visible) continue
    const t = piece.transform || { x: 0, y: 0, rotation: 0 }
    // Transform world (x, y) into piece-local coords.
    const local = _untransformPoint(x, y, piece, t)
    for (const r of piece.rects) {
      if (pointInRect(local.x, local.y, r)) return piece
    }
  }
  return null
}

function _untransformPoint(x, y, piece, t) {
  // Inverse of: translate(t.x, t.y) rotate(deg) around bbox center.
  const dx = x - (t.x || 0)
  const dy = y - (t.y || 0)
  const rot = ((t.rotation || 0) % 360 + 360) % 360
  if (rot === 0) return { x: dx, y: dy }
  const bbox = pieceBoundingBox(piece) || { x: 0, y: 0, w: 0, h: 0 }
  const cx = bbox.x + bbox.w / 2
  const cy = bbox.y + bbox.h / 2
  // Rotate (dx, dy) by -rot around (cx, cy).
  const rad = -rot * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const tx = dx - cx
  const ty = dy - cy
  return {
    x: cx + tx * cos - ty * sin,
    y: cy + tx * sin + ty * cos,
  }
}

function _normalizeRect(r) {
  // Accept rects with negative w/h (drag from bottom-right to top-left).
  const x = Math.min(r.x, r.x + r.w)
  const y = Math.min(r.y, r.y + r.h)
  return { x, y, w: Math.abs(r.w), h: Math.abs(r.h) }
}

function _rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * Snap an angle to the nearest 90° increment in the range [0, 360).
 * Used by the Rotate tool to enforce pixel-grid friendly rotations.
 */
export function snapTo90(deg) {
  const norm = ((deg % 360) + 360) % 360
  return Math.round(norm / 90) % 4 * 90
}

/**
 * Clamp a coordinate to the 64×64 grid (0–63 inclusive). Tools call this
 * before recording a pixel so out-of-bounds drag-strokes can't break things.
 */
export function clampToGrid(coord) {
  if (coord < 0) return 0
  if (coord > 63) return 63
  return Math.floor(coord)
}

/**
 * Subtract rect `b` from rect `a`, returning the 0-4 rectangles that make up
 * the parts of `a` not covered by `b`. Used by the Cut tool to slice
 * existing rects on the marquee boundary instead of just deleting any rect
 * that overlaps the marquee at all.
 *
 * - No overlap         → returns [{...a}]
 * - `b` covers all of `a` → returns []
 * - Partial overlap    → returns up to 4 strips (top, bottom, left, right)
 */
export function subtractRect(a, b) {
  if (!a) return []
  if (!b) return [{ ...a }]
  const ax2 = a.x + a.w
  const ay2 = a.y + a.h
  const bx2 = b.x + b.w
  const by2 = b.y + b.h
  if (b.x >= ax2 || b.y >= ay2 || bx2 <= a.x || by2 <= a.y) return [{ ...a }]

  const out = []
  // Top strip
  if (b.y > a.y) out.push({ x: a.x, y: a.y, w: a.w, h: b.y - a.y })
  // Bottom strip
  if (by2 < ay2) out.push({ x: a.x, y: by2, w: a.w, h: ay2 - by2 })
  // Middle row: left + right strips
  const midTop = Math.max(a.y, b.y)
  const midBottom = Math.min(ay2, by2)
  const midH = midBottom - midTop
  if (midH > 0) {
    if (b.x > a.x) out.push({ x: a.x, y: midTop, w: b.x - a.x, h: midH })
    if (bx2 < ax2) out.push({ x: bx2, y: midTop, w: ax2 - bx2, h: midH })
  }
  return out
}

/**
 * Expand a single cursor cell into an N×N brush footprint, with the cursor
 * roughly centered. Used by pencil + eraser when the admin picks a larger
 * brush size. Even sizes lean half a cell toward bottom-right (unavoidable
 * for non-divisible centering); odd sizes are perfectly centered.
 *
 * Out-of-grid cells are filtered out so the brush near the edges just
 * paints the in-bounds portion rather than clamping pixels onto the border.
 */
export function brushFootprint(centerX, centerY, size) {
  const s = Math.max(1, Math.min(64, Math.floor(size) || 1))
  if (s === 1) {
    return (centerX < 0 || centerX > 63 || centerY < 0 || centerY > 63) ? [] : [{ x: centerX, y: centerY }]
  }
  const offset = Math.floor((s - 1) / 2)
  const cells = []
  for (let dy = 0; dy < s; dy++) {
    for (let dx = 0; dx < s; dx++) {
      const x = centerX + dx - offset
      const y = centerY + dy - offset
      if (x < 0 || x > 63 || y < 0 || y > 63) continue
      cells.push({ x, y })
    }
  }
  return cells
}
