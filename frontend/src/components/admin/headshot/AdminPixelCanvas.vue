<script setup>
import { ref, computed } from 'vue'
import { composeSvg } from '@/services/headshotComposer'
import { serializeVariantPieces } from '@/services/svgPieces'
import {
  bresenhamLine, pointInRect, pieceCanvasBoundingBox, pieceBoundingBox,
  piecesUnderMarquee, topPieceAt, clampToGrid, brushFootprint,
  rasterizeEllipse, snapTo90,
} from '@/services/pixelDraw'

const props = defineProps({
  // The layer being edited (e.g. 'hair')
  layerId: { type: String, required: true },
  // Audience the variant belongs to — drives which folder the backdrop
  // layers load from when composing the preview behind the editable layer.
  audience: { type: String, default: 'player' },
  // In-memory pieces array (live edits)
  pieces: { type: Array, required: true },
  // Backdrop config — the rest of the head renders behind the editable layer
  // so the admin can see what they're drawing in context.
  config: { type: Object, required: true },
  // UI state
  activePieceId: { type: String, default: null },
  selectedPieceIds: { type: Array, default: () => [] },
  activeTool: { type: String, default: 'select' },  // select | pencil | eraser | rect
  // Brush size for pencil + eraser (1-N square footprint, cursor centered).
  brushSize: { type: Number, default: 1 },
  // Editor-only opacity overlay per piece: { pieceId: 0..1 }. Injected into
  // the preview SVG as a <style> block so the underlying piece data stays
  // untouched (this never reaches the saved file).
  pieceOpacities: { type: Object, default: () => ({}) },
  // Pixel size of the canvas viewport. The composed SVG renders at this
  // size; we scale internally so clicks map cleanly to the 64-grid.
  size: { type: Number, default: 500 },
  // Editor zoom factor (1.0 = base). The actual rendered canvas size is
  // `size * zoom`. Click math uses getBoundingClientRect so any zoom level
  // maps to the 64-grid correctly without further math.
  zoom: { type: Number, default: 1 },
  // When true, the canvas hides every `[data-layer]` in the composed SVG
  // except the one currently being edited. Editor-only viewing aid; never
  // affects the saved variant.
  isolateLayer: { type: Boolean, default: false },
  // 0..1 — multiplier applied to every layer EXCEPT the one being edited.
  // 1 = no dimming (default). 0 effectively hides the backdrop like the
  // isolate toggle. Editor-only — never persisted to the saved SVG.
  backdropOpacity: { type: Number, default: 1 },
  // Which shape variant the Rect tool draws — 'rect' adds a single rect
  // element to the active piece(s); 'circle' rasterizes pixels inside the
  // inscribed ellipse and pushes them through the same paint pipeline.
  shapeType: { type: String, default: 'rect' },
  // Reference image overlay state. Image renders between the checkerboard
  // background and the SVG content so it acts like a tracing layer. All
  // values are owned by the editor; the canvas just displays + emits drag
  // deltas for the ref-move tool.
  referenceImage:   { type: Object,  default: null },
  referenceVisible: { type: Boolean, default: true },
  referenceOpacity: { type: Number,  default: 1 },
  referenceScale:   { type: Number,  default: 1 },
  referenceOffsetX: { type: Number,  default: 0 },
  referenceOffsetY: { type: Number,  default: 0 },
})

const scaledSize = computed(() => props.size * props.zoom)

const emit = defineEmits([
  'paint',           // { pieceId, pixels: [{x,y}] }   pencil
  'erase',           // { pieceId, pixels: [{x,y},...] } eraser (brush footprint)
  'add-rect',        // { pieceId, rect: {x,y,w,h} }   rect tool commit
  'cut-region',      // { pieceId, rect: {x,y,w,h} }   cut tool commit
  'scale-update',    // { pieceId, rects: [...] }      scale drag — full new rects on each move
  'rotate-update',   // { pieceId, rotation }          rotate drag — already snapped to 90°
  'select-pieces',   // { ids: [pieceId], additive: bool }
  'translate',       // { pieceIds, dx, dy }           move drag
  'reference-translate', // { dx, dy }                 ref-move drag in display-space px
])

// Render the full headshot via the composer, with the active layer
// overridden by the in-memory pieces serialization. That way the backdrop
// (other layers) updates live as the admin edits.
const overrideSvg = computed(() => {
  // Use only visible pieces for rendering; invisible pieces show as hidden
  // in the canvas but still appear in the panel list.
  const visiblePieces = props.pieces.filter(p => p.visible !== false)
  if (visiblePieces.length === 0) return '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"></svg>'
  return serializeVariantPieces(visiblePieces)
})

const composedSvg = computed(() => {
  const base = composeSvg(props.config, { [props.layerId]: overrideSvg.value }, props.audience)
  return _injectOpacityStyles(base)
})

// Inject a <style> block right after <svg ...> that targets `[data-piece="X"]`
// for any piece with opacity < 1, plus an optional rule that hides every
// other layer when isolate mode is on. CSS attribute selectors work natively
// in SVG and let us dim/hide individual pieces and layers without touching
// the data — the saved SVG never sees these styles.
function _injectOpacityStyles(svg) {
  const opacities = props.pieceOpacities || {}
  const rules = []
  for (const [id, value] of Object.entries(opacities)) {
    if (value < 1) {
      const safeId = String(id).replace(/"/g, '')
      rules.push(`[data-piece="${safeId}"] { opacity: ${value}; }`)
    }
  }
  if (props.isolateLayer) {
    const safeLayer = String(props.layerId).replace(/"/g, '')
    // `display: none` on the layer groups collapses them entirely so the
    // backdrop disappears, leaving only the active layer visible against
    // the canvas's checkerboard.
    rules.push(`[data-layer]:not([data-layer="${safeLayer}"]) { display: none; }`)
  } else {
    // Always emit the backdrop-opacity rule — even at 1.0. This guarantees
    // the CSS cascade reflects the current value and a previous opacity: 0
    // can't somehow stick around (which was happening in practice when the
    // admin dialed back from 0% — the rule never updated to a higher value).
    const safeLayer = String(props.layerId).replace(/"/g, '')
    const op = Math.max(0, Math.min(1, props.backdropOpacity))
    rules.push(`[data-layer]:not([data-layer="${safeLayer}"]) { opacity: ${op}; }`)
  }
  if (rules.length === 0) return svg
  const styleTag = `<style>${rules.join('')}</style>`
  return svg.replace(/(<svg[^>]*>)/, `$1${styleTag}`)
}

// SVG element ref for coordinate math
const svgWrap = ref(null)

// Drag state
const isDragging = ref(false)
const dragStart = ref(null)        // { x, y } in grid coords
const dragLast = ref(null)         // for pencil interpolation
const previewRect = ref(null)      // for rect tool preview overlay
const marqueeRect = ref(null)      // for select tool marquee
const moveDelta = ref(null)        // { dx, dy } accumulator during move drag

// Scale drag state — captured at handle-pointerdown so each move recomputes
// new rects from the ORIGINAL state rather than accumulating rounding error.
const scaleDrag = ref(null)

// Rotate drag state — when the Rotate tool is active and a single piece is
// selected, the floating handle above the piece becomes draggable. The drag
// computes a target rotation from the angle between the piece's center and
// the cursor, snaps to the nearest 90°, and emits a rotate-update. Origin
// offset between cursor angle and the piece's current rotation is captured
// at drag start so the piece doesn't snap to "match cursor" on first move.
const rotateDrag = ref(null)
// shape: { pieceId, centerX, centerY, anchorOffset, originalRotation }

// Pan drag state — when the Pan tool is active, click-drag scrolls the
// canvas inside its scroll-container parent (only meaningful when zoomed in,
// otherwise nothing scrolls). Stored in *client* coords (not grid) because
// we're driving DOM scroll offsets, not pixel-art edits.
const panDrag = ref(null)
// shape: { startX, startY, startScrollLeft, startScrollTop, container }

// Reference-image drag state — when the ref-move tool is active, click-drag
// translates the reference image in display-space pixels. Owner is the
// editor; the canvas just emits incremental deltas.
const refMoveDrag = ref(null)
// shape: { lastX, lastY }
// shape: {
//   handle: 'tl' | 'tr' | 'bl' | 'br',
//   pieceId,
//   originalRects: [{ x, y, w, h }],
//   anchor: { x, y }   // opposite corner of the dragged handle, in grid coords
// }

// The composed output uses viewBox "70 -30 500 500" with an inner scale(10),
// so a pixel at inner (x, y) renders at SVG coord (x*10, y*10). Mapping from
// client coords → inner-grid coords:
function clientToGrid(event) {
  const el = svgWrap.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const px = event.clientX - rect.left
  const py = event.clientY - rect.top
  // viewBox = "70 -30 500 500" rendered at `size x size`
  const svgX = (px / rect.width) * 500 + 70
  const svgY = (py / rect.height) * 500 - 30
  return {
    x: Math.floor(svgX / 10),
    y: Math.floor(svgY / 10),
  }
}

function gridToCanvasPercent(x, y) {
  // For overlay positioning (selection bbox, marquee). Returns CSS
  // percentages within the canvas wrap.
  const svgX = x * 10
  const svgY = y * 10
  const left = ((svgX - 70) / 500) * 100
  const top = ((svgY - (-30)) / 500) * 100
  return { left, top }
}

function activePiece() {
  return props.pieces.find(p => p.id === props.activePieceId) ?? null
}

function onPointerDown(event) {
  if (event.button !== 0) return

  // Pan tool: short-circuit before any grid math. Scrolling is purely a DOM
  // concern, so we don't touch isDragging / dragStart (those are for pixel
  // tools and would interfere with the pointermove dispatch).
  if (props.activeTool === 'pan') {
    _panStart(event)
    return
  }
  // Ref-move tool: also bypasses grid math. Each pointermove emits a
  // display-space delta that the editor accumulates into refOffsetX/Y.
  if (props.activeTool === 'ref-move') {
    _refMoveStart(event)
    return
  }

  const grid = clientToGrid(event)
  if (!grid) return
  isDragging.value = true
  dragStart.value = grid
  dragLast.value = grid
  // Capture pointer so drag continues if cursor leaves the canvas
  event.target.setPointerCapture?.(event.pointerId)

  switch (props.activeTool) {
    case 'pencil':
      _paintAt(grid)
      break
    case 'eraser':
      _eraseAt(grid)
      break
    case 'rect':
    case 'cut':
      previewRect.value = { x: grid.x, y: grid.y, w: 1, h: 1 }
      break
    case 'select':
      _selectStart(grid, event)
      break
    case 'scale':
      // Scale starts via the handle's own @pointerdown (which calls
      // _scaleStart and stops propagation). Clicking elsewhere with the
      // scale tool active is a no-op so the admin can still click off the
      // handles without misfiring.
      break
    default: break
  }
}

function onPointerMove(event) {
  // Pan drag — pure DOM scroll, no grid math.
  if (panDrag.value) {
    _panMove(event)
    return
  }
  // Ref-move drag — emit display-space delta to the editor.
  if (refMoveDrag.value) {
    _refMoveMove(event)
    return
  }
  // Rotate drag — its own handle owns the pointerdown, runs in parallel
  // with the regular tool drag state.
  if (rotateDrag.value) {
    _rotateMove(event)
    return
  }
  // Scale drag runs in parallel — its own state, not gated on isDragging
  // since the handle itself owns the down event.
  if (scaleDrag.value) {
    const grid = clientToGrid(event)
    if (grid) _scaleMove(grid)
    return
  }
  if (!isDragging.value) return
  const grid = clientToGrid(event)
  if (!grid) return

  switch (props.activeTool) {
    case 'pencil': {
      // Bresenham fill between last and current grid pos for smooth strokes.
      const line = bresenhamLine(dragLast.value.x, dragLast.value.y, grid.x, grid.y)
      // Skip the first cell — it was already painted on the previous step.
      _paintMany(line.slice(1))
      dragLast.value = grid
      break
    }
    case 'eraser': {
      const line = bresenhamLine(dragLast.value.x, dragLast.value.y, grid.x, grid.y)
      // Skip the first cell — already erased on the previous step.
      _eraseMany(line.slice(1))
      dragLast.value = grid
      break
    }
    case 'rect':
    case 'cut': {
      const x = Math.min(dragStart.value.x, grid.x)
      const y = Math.min(dragStart.value.y, grid.y)
      const w = Math.abs(grid.x - dragStart.value.x) + 1
      const h = Math.abs(grid.y - dragStart.value.y) + 1
      previewRect.value = { x, y, w, h }
      break
    }
    case 'select': {
      _selectMove(grid)
      break
    }
    default: break
  }
}

function onPointerUp() {
  if (panDrag.value) {
    panDrag.value = null
    return
  }
  if (refMoveDrag.value) {
    refMoveDrag.value = null
    return
  }
  if (rotateDrag.value) {
    rotateDrag.value = null
    return
  }
  if (scaleDrag.value) {
    scaleDrag.value = null
    return
  }
  if (!isDragging.value) return
  isDragging.value = false

  if (props.activeTool === 'rect' && previewRect.value && props.activePieceId) {
    if (props.shapeType === 'circle') {
      // Rasterize the inscribed ellipse into 1×1 pixels and route through
      // the paint pipeline so the multi-selection broadcast + dedupe used
      // by pencil applies automatically.
      const pixels = rasterizeEllipse(previewRect.value)
      if (pixels.length > 0) emit('paint', { pieceId: props.activePieceId, pixels })
    } else {
      emit('add-rect', { pieceId: props.activePieceId, rect: previewRect.value })
    }
    previewRect.value = null
  }
  if (props.activeTool === 'cut' && previewRect.value && props.activePieceId) {
    emit('cut-region', { pieceId: props.activePieceId, rect: previewRect.value })
    previewRect.value = null
  }
  if (props.activeTool === 'select') {
    _selectEnd()
  }
  dragStart.value = null
  dragLast.value = null
  moveDelta.value = null
  marqueeRect.value = null
}

// --- pencil/eraser ---

function _paintAt(grid) {
  if (!props.activePieceId) return
  const cells = brushFootprint(clampToGrid(grid.x), clampToGrid(grid.y), props.brushSize)
  if (cells.length === 0) return
  emit('paint', { pieceId: props.activePieceId, pixels: cells })
}

function _paintMany(grids) {
  if (!props.activePieceId || grids.length === 0) return
  // Expand each interpolated cursor cell into its brush footprint, then
  // dedupe so a moderately-sized brush doesn't emit thousands of overlapping
  // pixels per drag step. The downstream handler dedupes again against
  // existing piece rects, but pre-filtering here keeps the event payload lean.
  const seen = new Set()
  const pixels = []
  for (const g of grids) {
    const cells = brushFootprint(clampToGrid(g.x), clampToGrid(g.y), props.brushSize)
    for (const c of cells) {
      const key = `${c.x},${c.y}`
      if (seen.has(key)) continue
      seen.add(key)
      pixels.push(c)
    }
  }
  if (pixels.length === 0) return
  emit('paint', { pieceId: props.activePieceId, pixels })
}

function _eraseAt(grid) {
  if (!props.activePieceId) return
  const cells = brushFootprint(clampToGrid(grid.x), clampToGrid(grid.y), props.brushSize)
  if (cells.length === 0) return
  emit('erase', { pieceId: props.activePieceId, pixels: cells })
}

function _eraseMany(grids) {
  if (!props.activePieceId || grids.length === 0) return
  // Mirror _paintMany: expand each interpolated cursor cell into its brush
  // footprint, dedupe, emit once per stroke step. Without this a fast drag
  // would fire one event per cell × brush footprint and blow past the
  // editor's snapshot/undo budget.
  const seen = new Set()
  const pixels = []
  for (const g of grids) {
    const cells = brushFootprint(clampToGrid(g.x), clampToGrid(g.y), props.brushSize)
    for (const c of cells) {
      const key = `${c.x},${c.y}`
      if (seen.has(key)) continue
      seen.add(key)
      pixels.push(c)
    }
  }
  if (pixels.length === 0) return
  emit('erase', { pieceId: props.activePieceId, pixels })
}

// --- select / move ---

function _selectStart(grid, event) {
  const hit = topPieceAt(props.pieces, grid.x, grid.y)
  if (hit) {
    // If clicked piece is already selected, prepare for move drag. Otherwise
    // (re)select it. Shift adds to selection.
    if (event.shiftKey) {
      const ids = [...props.selectedPieceIds]
      const idx = ids.indexOf(hit.id)
      if (idx >= 0) ids.splice(idx, 1)
      else ids.push(hit.id)
      emit('select-pieces', { ids, additive: true })
    } else if (!props.selectedPieceIds.includes(hit.id)) {
      emit('select-pieces', { ids: [hit.id], additive: false })
    }
    moveDelta.value = { dx: 0, dy: 0 }
  } else {
    // Empty space → start marquee
    if (!event.shiftKey) emit('select-pieces', { ids: [], additive: false })
    marqueeRect.value = { x: grid.x, y: grid.y, w: 0, h: 0 }
  }
}

function _selectMove(grid) {
  if (moveDelta.value && props.selectedPieceIds.length > 0) {
    const dx = grid.x - dragStart.value.x
    const dy = grid.y - dragStart.value.y
    const stepDx = dx - moveDelta.value.dx
    const stepDy = dy - moveDelta.value.dy
    if (stepDx !== 0 || stepDy !== 0) {
      emit('translate', { pieceIds: [...props.selectedPieceIds], dx: stepDx, dy: stepDy })
      moveDelta.value = { dx, dy }
    }
  } else if (marqueeRect.value) {
    marqueeRect.value = {
      x: dragStart.value.x,
      y: dragStart.value.y,
      w: grid.x - dragStart.value.x,
      h: grid.y - dragStart.value.y,
    }
  }
}

function _selectEnd() {
  if (marqueeRect.value) {
    const hits = piecesUnderMarquee(props.pieces, marqueeRect.value)
    emit('select-pieces', { ids: hits.map(p => p.id), additive: false })
  }
}

// --- pan tool: drag-to-scroll ---

// Walk up from the canvas wrap looking for the nearest ancestor whose
// computed overflow allows scrolling. The editor wraps us in
// `.ave-canvas-scroll`, but resolving by computed style keeps us decoupled
// from that specific class.
function _findScrollableAncestor(el) {
  let n = el?.parentElement
  while (n) {
    const overflow = getComputedStyle(n).overflow + getComputedStyle(n).overflowX + getComputedStyle(n).overflowY
    if (/auto|scroll/.test(overflow)) return n
    n = n.parentElement
  }
  return null
}

function _panStart(event) {
  const container = _findScrollableAncestor(svgWrap.value)
  if (!container) return
  panDrag.value = {
    startX: event.clientX,
    startY: event.clientY,
    startScrollLeft: container.scrollLeft,
    startScrollTop: container.scrollTop,
    container,
  }
  event.target.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function _panMove(event) {
  const pd = panDrag.value
  if (!pd) return
  // Inverse drag: moving the cursor right pulls the canvas right, which
  // means the viewport scrolls *left*. Standard "grab" panning convention.
  const dx = event.clientX - pd.startX
  const dy = event.clientY - pd.startY
  pd.container.scrollLeft = pd.startScrollLeft - dx
  pd.container.scrollTop = pd.startScrollTop - dy
}

// --- ref-move tool: drag the reference image around ---

function _refMoveStart(event) {
  if (!props.referenceImage) return
  refMoveDrag.value = { lastX: event.clientX, lastY: event.clientY }
  event.target.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

// Direct pointerdown on the reference image. Only does anything when the
// ref-move tool is active; otherwise the click falls through to whatever
// the active tool wants (we let it bubble naturally by not stopping the
// event). When ref-move IS active, this fires before the parent canvas
// wrap's @pointerdown, captures the pointer, and starts the drag without
// depending on event-bubbling through pointer-events:none layers.
function onReferencePointerDown(event) {
  if (event.button !== 0) return
  if (props.activeTool !== 'ref-move') return
  _refMoveStart(event)
}

function _refMoveMove(event) {
  const rd = refMoveDrag.value
  if (!rd) return
  const dx = event.clientX - rd.lastX
  const dy = event.clientY - rd.lastY
  rd.lastX = event.clientX
  rd.lastY = event.clientY
  // Direct 1:1 mapping in display-space — admin drags, image follows. We
  // emit incremental deltas so the editor can clamp/limit if needed later
  // (currently it just accumulates).
  if (dx !== 0 || dy !== 0) emit('reference-translate', { dx, dy })
}

// --- rotate tool: handle drag ---

// Continuous (non-floored) client→grid conversion. Floored version snaps to
// integer pixel cells which is fine for pixel placement but produces jumpy
// rotation angles, so the rotate tool needs the raw float coords.
function _clientToGridFloat(event) {
  const el = svgWrap.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const px = event.clientX - rect.left
  const py = event.clientY - rect.top
  return {
    x: ((px / rect.width) * 500 + 70) / 10,
    y: ((py / rect.height) * 500 - 30) / 10,
  }
}

function _rotateStart(event) {
  event.stopPropagation()
  event.preventDefault()
  if (props.selectedPieceIds.length !== 1) return
  const piece = props.pieces.find(p => p.id === props.selectedPieceIds[0])
  if (!piece) return
  const bbox = pieceCanvasBoundingBox(piece)
  if (!bbox || bbox.w === 0 || bbox.h === 0) return
  const cursor = _clientToGridFloat(event)
  if (!cursor) return
  const centerX = bbox.x + bbox.w / 2
  const centerY = bbox.y + bbox.h / 2
  // Angle of the cursor relative to the piece's center, in degrees.
  const cursorAngle = Math.atan2(cursor.y - centerY, cursor.x - centerX) * 180 / Math.PI
  rotateDrag.value = {
    pieceId: piece.id,
    centerX,
    centerY,
    // Offset between cursor angle and piece's current rotation. Keeps the
    // piece from snapping to "match cursor" at drag start — instead the
    // piece's rotation tracks the change in cursor angle from this baseline.
    anchorOffset: cursorAngle - (piece.transform?.rotation || 0),
    originalRotation: piece.transform?.rotation || 0,
  }
  event.target.setPointerCapture?.(event.pointerId)
}

function _rotateMove(event) {
  const rd = rotateDrag.value
  if (!rd) return
  const cursor = _clientToGridFloat(event)
  if (!cursor) return
  const cursorAngle = Math.atan2(cursor.y - rd.centerY, cursor.x - rd.centerX) * 180 / Math.PI
  const raw = cursorAngle - rd.anchorOffset
  // Free rotation by default; Shift snaps to crisp 90° for pixel-art
  // alignment when the admin wants it.
  const target = event.shiftKey ? snapTo90(raw) : raw
  emit('rotate-update', { pieceId: rd.pieceId, rotation: target })
}

// Position the rotate handle above the selected piece's bbox (3 grid units
// above the top-center). Mirrors the scaleHandles pattern.
const rotateHandle = computed(() => {
  if (props.activeTool !== 'rotate') return null
  if (props.selectedPieceIds.length !== 1) return null
  const piece = props.pieces.find(p => p.id === props.selectedPieceIds[0])
  if (!piece) return null
  const bbox = pieceCanvasBoundingBox(piece)
  if (!bbox || bbox.w === 0 || bbox.h === 0) return null
  const cx = bbox.x + bbox.w / 2
  const cy = bbox.y - 3
  const top = gridToCanvasPercent(cx, cy)
  // Anchor (visual line) connects the handle to the bbox top-center.
  const anchor = gridToCanvasPercent(cx, bbox.y)
  return {
    style: { left: top.left + '%', top: top.top + '%' },
    anchorStyle: {
      left: anchor.left + '%',
      top: anchor.top + '%',
      height: `calc(${top.top}% - ${anchor.top}%)`,
    },
  }
})

// --- scale tool: corner-handle drag ---

// Union bbox across one or more pieces' raw rect lists. Used both for the
// handle positions and for the scale-math anchor so single- and multi-
// selection scale behave identically.
function _combinedRectBbox(pieces) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pieces) {
    for (const r of p.rects) {
      if (r.x < minX) minX = r.x
      if (r.y < minY) minY = r.y
      if (r.x + r.w > maxX) maxX = r.x + r.w
      if (r.y + r.h > maxY) maxY = r.y + r.h
    }
  }
  if (!isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function _scaleStart(handle, event) {
  event.stopPropagation()
  event.preventDefault()
  // Scale supports 1..N selected pieces. With multiple, every piece scales
  // proportionally about the SAME combined-bbox anchor so they keep their
  // relative positions.
  const selected = props.pieces.filter(p => props.selectedPieceIds.includes(p.id))
  if (selected.length === 0) return
  const bbox = _combinedRectBbox(selected)
  if (!bbox || bbox.w === 0 || bbox.h === 0) return
  // Anchor = opposite corner of the combined bbox. Drag top-left → anchor
  // at bottom-right, etc. Anchor stays fixed during the drag; the dragged
  // corner follows the cursor.
  const anchor = {
    x: handle.includes('l') ? bbox.x + bbox.w : bbox.x,
    y: handle.includes('t') ? bbox.y + bbox.h : bbox.y,
  }
  scaleDrag.value = {
    handle,
    // Snapshot every target's ORIGINAL rects so each pointer-move frame can
    // recompute from them rather than accumulating rounding error against
    // the running result.
    targets: selected.map(p => ({
      pieceId: p.id,
      originalRects: p.rects.map(r => ({ ...r })),
    })),
    originalBbox: bbox,
    anchor,
  }
  // Capture pointer events on the handle so the drag continues even when
  // the cursor leaves the small handle hitbox.
  event.target.setPointerCapture?.(event.pointerId)
}

function _scaleMove(grid) {
  const sd = scaleDrag.value
  if (!sd) return
  // New bbox dimensions = distance from anchor to current cursor. Minimum 1px
  // so the piece doesn't collapse to zero when dragged past the anchor.
  const newW = Math.max(1, Math.abs(grid.x - sd.anchor.x))
  const newH = Math.max(1, Math.abs(grid.y - sd.anchor.y))
  const scaleX = newW / sd.originalBbox.w
  const scaleY = newH / sd.originalBbox.h
  // Apply the same scale factor to every target's original rects. Emitting
  // one update per piece per frame keeps the editor's per-piece snapshot
  // logic identical to the single-piece path; the shared `scale` snapshot
  // tag collapses the whole drag into one undo step.
  for (const target of sd.targets) {
    const newRects = target.originalRects.map(r => ({
      x: Math.round(sd.anchor.x + (r.x - sd.anchor.x) * scaleX),
      y: Math.round(sd.anchor.y + (r.y - sd.anchor.y) * scaleY),
      w: Math.max(1, Math.round(r.w * scaleX)),
      h: Math.max(1, Math.round(r.h * scaleY)),
    }))
    emit('scale-update', { pieceId: target.pieceId, rects: newRects })
  }
}

// --- corner handles overlay positioning ---

const scaleHandles = computed(() => {
  // Render handles whenever the Scale tool is active AND at least one piece
  // is selected. Multi-selection scales relative to the combined bbox so the
  // group keeps its internal arrangement during the drag.
  if (props.activeTool !== 'scale') return []
  if (props.selectedPieceIds.length === 0) return []
  const selected = props.pieces.filter(p => props.selectedPieceIds.includes(p.id))
  if (selected.length === 0) return []
  const bbox = _combinedRectBbox(selected)
  if (!bbox || bbox.w === 0 || bbox.h === 0) return []
  const corners = [
    { id: 'tl', x: bbox.x,             y: bbox.y,             cursor: 'nwse-resize' },
    { id: 'tr', x: bbox.x + bbox.w,    y: bbox.y,             cursor: 'nesw-resize' },
    { id: 'bl', x: bbox.x,             y: bbox.y + bbox.h,    cursor: 'nesw-resize' },
    { id: 'br', x: bbox.x + bbox.w,    y: bbox.y + bbox.h,    cursor: 'nwse-resize' },
  ]
  return corners.map(c => {
    const pos = gridToCanvasPercent(c.x, c.y)
    return {
      id: c.id,
      cursor: c.cursor,
      style: { left: pos.left + '%', top: pos.top + '%' },
    }
  })
})

// --- overlay rendering ---

const selectedBboxes = computed(() => {
  return props.pieces
    .filter(p => props.selectedPieceIds.includes(p.id))
    .map(p => {
      const bbox = pieceCanvasBoundingBox(p)
      if (!bbox) return null
      const tl = gridToCanvasPercent(bbox.x, bbox.y)
      const br = gridToCanvasPercent(bbox.x + bbox.w, bbox.y + bbox.h)
      return {
        id: p.id,
        left: tl.left + '%',
        top: tl.top + '%',
        width: (br.left - tl.left) + '%',
        height: (br.top - tl.top) + '%',
      }
    })
    .filter(Boolean)
})

const marqueeStyle = computed(() => {
  if (!marqueeRect.value) return null
  const r = marqueeRect.value
  const x = Math.min(r.x, r.x + r.w)
  const y = Math.min(r.y, r.y + r.h)
  const w = Math.abs(r.w)
  const h = Math.abs(r.h)
  const tl = gridToCanvasPercent(x, y)
  const br = gridToCanvasPercent(x + w, y + h)
  return {
    left: tl.left + '%',
    top: tl.top + '%',
    width: (br.left - tl.left) + '%',
    height: (br.top - tl.top) + '%',
  }
})

const previewRectStyle = computed(() => {
  if (!previewRect.value) return null
  const r = previewRect.value
  const tl = gridToCanvasPercent(r.x, r.y)
  const br = gridToCanvasPercent(r.x + r.w, r.y + r.h)
  return {
    left: tl.left + '%',
    top: tl.top + '%',
    width: (br.left - tl.left) + '%',
    height: (br.top - tl.top) + '%',
  }
})

// Custom cursors — inline two-tone SVGs (white outer outline + black inner
// stroke) so the tool icon is visible on both light and dark backgrounds.
// Hotspot is tuned per tool so clicks register where the tool's "action
// point" visually sits (e.g. pencil tip, scissors blade).
function _cursor(svgInner, hotX, hotY) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'>${svgInner}</svg>`
  const encoded = encodeURIComponent(svg)
  return `url("data:image/svg+xml,${encoded}") ${hotX} ${hotY}, crosshair`
}

// Path-only icons get rendered twice: thick white stroke (outline) then
// thinner black stroke (icon). Two-tone visibility on any background.
function _twoTone(d) {
  return (
    `<path d='${d}' stroke='white' stroke-width='4'/>` +
    `<path d='${d}' stroke='black' stroke-width='2'/>`
  )
}

// lucide-vue-next paths (24x24 viewBox). Pulled inline so the cursor is
// self-contained and Vite-bundled, no extra HTTP request.
const PENCIL_D = 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'
// Remove tool — lucide `Minus` icon (single horizontal stroke).
const ERASER_D = 'M5 12h14'
// Square (Rect tool) — using individual path commands so two-tone works.
const RECT_INNER =
  `<rect x='3' y='3' width='18' height='18' rx='2' stroke='white' stroke-width='4' fill='none'/>` +
  `<rect x='3' y='3' width='18' height='18' rx='2' stroke='black' stroke-width='2' fill='none'/>`
// Circle variant of the Shape tool — same hotspot at the bbox's top-left
// corner so the drag-out behavior matches the rect cursor.
const CIRCLE_INNER =
  `<circle cx='12' cy='12' r='9' stroke='white' stroke-width='4' fill='none'/>` +
  `<circle cx='12' cy='12' r='9' stroke='black' stroke-width='2' fill='none'/>`
// Scissors — multiple sub-paths.
const SCISSORS_INNER =
  `<g stroke='white' stroke-width='4' fill='none'>` +
    `<circle cx='6' cy='6' r='3'/>` +
    `<path d='M8.12 8.12 12 12'/>` +
    `<path d='M20 4 8.12 15.88'/>` +
    `<circle cx='6' cy='18' r='3'/>` +
    `<path d='M14.8 14.8 20 20'/>` +
  `</g>` +
  `<g stroke='black' stroke-width='2' fill='none'>` +
    `<circle cx='6' cy='6' r='3'/>` +
    `<path d='M8.12 8.12 12 12'/>` +
    `<path d='M20 4 8.12 15.88'/>` +
    `<circle cx='6' cy='18' r='3'/>` +
    `<path d='M14.8 14.8 20 20'/>` +
  `</g>`

const CURSORS = {
  // Pencil: tip is bottom-left of the icon, hotspot at (3, 21).
  pencil: _cursor(_twoTone(PENCIL_D), 3, 21),
  // Eraser: center hotspot keeps the brush footprint visually obvious.
  eraser: _cursor(_twoTone(ERASER_D), 12, 12),
  // Rect/Circle (Shape tool variants): hotspot at the bbox's top-left so
  // the drag-from-corner motion matches what the user is targeting.
  rect:   _cursor(RECT_INNER, 3, 3),
  circle: _cursor(CIRCLE_INNER, 3, 3),
  cut:    _cursor(SCISSORS_INNER, 12, 12),
}

const cursorStyle = computed(() => {
  // Pan tool: native grab/grabbing cursors. Universally recognized — no
  // need for the two-tone SVG cursor treatment the pixel tools use.
  if (props.activeTool === 'pan') {
    return { cursor: panDrag.value ? 'grabbing' : 'grab' }
  }
  // Ref-move tool: same grab/grabbing cursors so the affordance is obvious.
  if (props.activeTool === 'ref-move') {
    return { cursor: refMoveDrag.value ? 'grabbing' : 'grab' }
  }
  // Shape tool's `rect` umbrella mode swaps cursor based on the active
  // shape variant so the cursor matches what's about to be drawn.
  if (props.activeTool === 'rect' && props.shapeType === 'circle') {
    return { cursor: CURSORS.circle }
  }
  const cur = CURSORS[props.activeTool]
  return cur ? { cursor: cur } : {}
})
</script>

<template>
  <div
    ref="svgWrap"
    class="pixel-canvas"
    :style="{ width: scaledSize + 'px', height: scaledSize + 'px', ...cursorStyle }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- Reference image overlay — temporary tracing layer above the
         checkerboard background, below every SVG / selection / preview.
         Pointer-events are off by default so pixel tools still hit the
         SVG; the ref-move tool flips them back on and the image itself
         becomes the drag target (its own pointerdown wins over the parent
         and guarantees the drag starts even when the canvas wrap's
         pointer dispatch doesn't fire for some reason). -->
    <img
      v-if="referenceImage && referenceVisible"
      class="pc-reference"
      :class="{ draggable: activeTool === 'ref-move' }"
      :src="referenceImage.dataUrl"
      :style="{
        opacity: referenceOpacity,
        /* offsetX/Y are stored in canvas-grid units (= display px at zoom 1).
           Multiplying by `zoom` keeps the image anchored to the same canvas
           coordinate at every zoom level, so an eye drawn against the
           reference at zoom 3 still lines up with the same feature when the
           admin zooms back to 1. */
        transform: `translate(${referenceOffsetX * zoom}px, ${referenceOffsetY * zoom}px) scale(${referenceScale})`,
      }"
      draggable="false"
      alt=""
      @pointerdown.stop="onReferencePointerDown"
    />

    <!-- The full headshot, with the active layer's content overridden by
         our editable pieces serialization. v-html for cheap reactivity. -->
    <div class="pc-svg" v-html="composedSvg" />

    <!-- Selection bboxes -->
    <div
      v-for="bbox in selectedBboxes"
      :key="bbox.id"
      class="pc-selection"
      :style="bbox"
    />

    <!-- Marquee while dragging select tool -->
    <div v-if="marqueeStyle" class="pc-marquee" :style="marqueeStyle" />

    <!-- Preview rect while drawing with rect / cut tool. Cut renders in
         red to signal destructive intent; rect stays amber (fill). The
         `circle` modifier swaps the outline to a circle when the shape
         tool's circle variant is active. -->
    <div
      v-if="previewRectStyle"
      class="pc-preview-rect"
      :class="{
        cut: activeTool === 'cut',
        circle: activeTool === 'rect' && shapeType === 'circle',
      }"
      :style="previewRectStyle"
    />

    <!-- Scale tool: corner drag handles on the selected piece's bbox -->
    <div
      v-for="handle in scaleHandles"
      :key="handle.id"
      class="pc-scale-handle"
      :style="{ ...handle.style, cursor: handle.cursor }"
      @pointerdown="_scaleStart(handle.id, $event)"
    />

    <!-- Rotate tool: single handle above the selected piece's bbox, drag
         to rotate (snaps to nearest 90°). Anchor line connects the handle
         to the top of the bbox for visual clarity. -->
    <template v-if="rotateHandle">
      <div class="pc-rotate-anchor" :style="rotateHandle.anchorStyle" />
      <div
        class="pc-rotate-handle"
        :style="rotateHandle.style"
        @pointerdown="_rotateStart"
      />
    </template>
  </div>
</template>

<style scoped>
.pixel-canvas {
  position: relative;
  /* Prevent the parent flex scroll-container from shrinking our explicit
     width down to fit. Without this, zooming in only makes the canvas
     taller (cross-axis) while flex-shrink collapses the main-axis width. */
  flex-shrink: 0;
  /* Photoshop-style transparency checker — shows through wherever the
     composed headshot SVG has no pixels. Two diagonal linear-gradients at
     offset positions produce the classic 2-tone checker. 16px cells are
     fine-grained enough to read as "transparent" without competing with
     the pixel art's own visible grid.
     Dark theme: white-on-dark-glass. Light theme override below. */
  background-color: var(--glass-bg);
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  user-select: none;
  touch-action: none;
}

/* Light theme: same checker pattern but with dark squares on the light glass
   background, otherwise the white squares would vanish into the light canvas. */
[data-theme="light"] .pixel-canvas {
  background-image:
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%),
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%);
}

.pc-svg {
  width: 100%;
  height: 100%;
  pointer-events: none;
  position: relative;
  z-index: 1;
}

/* Reference tracing image — sits over the checkerboard, under everything
   else. `object-fit: contain` does the fit-to-canvas baseline so any
   aspect ratio renders without distortion; the admin's scale slider
   multiplies on top of that via the transform style. Pointer-events: none
   by default keeps the pixel tools (and pan/scale) hit-testing the canvas
   underneath. The `.draggable` modifier (active when the ref-move tool is
   selected) flips pointer events back on and shows the grab cursor so the
   image becomes a direct drag target. */
.pc-reference {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  z-index: 0;
  transform-origin: center center;
  user-select: none;
}

.pc-reference.draggable {
  pointer-events: auto;
  cursor: grab;
}

.pc-reference.draggable:active {
  cursor: grabbing;
}

.pc-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

/* All three drag/selection overlays need to render ABOVE .pc-svg
   (z-index: 1). Without an explicit z-index they default to `auto`,
   which sorts beneath any positioned sibling with a positive z-index
   in the same stacking context — so the marquee/preview-rect outline
   was getting painted under the composed headshot's pixels even
   though it was emitted later in the DOM. 2 puts the outlines above
   the headshot but still below the scale/rotate handles at z-index 5. */
.pc-selection {
  position: absolute;
  border: 1.5px dashed #a855f7;
  pointer-events: none;
  background: rgba(168, 85, 247, 0.08);
  z-index: 2;
}

.pc-marquee {
  position: absolute;
  border: 1.5px dashed #60a5fa;
  background: rgba(96, 165, 250, 0.1);
  pointer-events: none;
  z-index: 2;
}

.pc-preview-rect {
  position: absolute;
  border: 1.5px dashed #fbbf24;
  background: rgba(251, 191, 36, 0.15);
  pointer-events: none;
  z-index: 2;
}

.pc-preview-rect.cut {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.15);
}

/* Circle variant of the shape tool — same outline rules, just an inscribed
   ellipse via border-radius. The pixel rasterization still operates on the
   bbox, so this matches the actual shape that gets committed. */
.pc-preview-rect.circle {
  border-radius: 50%;
}

.pc-scale-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #a855f7;
  border: 2px solid white;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  z-index: 5;
  pointer-events: auto;
  touch-action: none;
}

.pc-scale-handle:hover {
  background: #c084fc;
}

/* Rotate tool handle — single floating dot above the piece's bbox. The
   anchor line connects it visually so the admin knows it's a rotation
   axis, not a free-floating control. */
.pc-rotate-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  background: #a855f7;
  border: 2px solid white;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  z-index: 5;
  cursor: grab;
  pointer-events: auto;
  touch-action: none;
}

.pc-rotate-handle:hover {
  background: #c084fc;
}

.pc-rotate-handle:active {
  cursor: grabbing;
}

.pc-rotate-anchor {
  position: absolute;
  width: 1.5px;
  background: rgba(168, 85, 247, 0.6);
  transform: translateX(-50%);
  z-index: 4;
  pointer-events: none;
}

</style>
