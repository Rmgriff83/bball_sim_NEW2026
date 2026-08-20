<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import CourtDiagram from './CourtDiagram.vue'
import { buildPlayGraph } from '@/engine/util/buildPlayKeyframes'

const props = defineProps({
  play: { type: Object, default: null },
})

// Timing (seconds).
const SPEED = 1.0          // playback multiplier for action movement
const DECIDE_HOLD = 1.0    // pause at a read, showing the options
const END_HOLD = 0.9       // hold on the final shot before looping
const RIM = { x: 0.5, y: 0.9 }

const graph = computed(() => (props.play ? buildPlayGraph(props.play) : null))

// Reactive render state (×100 SVG coords).
const dots = ref([])           // [{ role, label, x, y }]
const ball = ref({ x: 50, y: 20 })
const decideLines = ref([])    // [{ x1,y1,x2,y2, primary }]

// --- Walker state (plain, non-reactive) ---
let positions = {}             // role -> {x,y} (0-1, live)
let ballRole = null
let ballPos = { x: 0.5, y: 0.2 }
let phase = 'idle'             // 'move' | 'decide' | 'endhold'
let phaseStart = 0
let phaseDur = 0
let current = null             // current action node
let moveStartPos = {}
let moveEndPos = {}
let moveStartBall = { x: 0.5, y: 0.2 }
let moveEndBall = { x: 0.5, y: 0.2 }

let rafId = null
let observer = null
const rootEl = ref(null)
const visible = ref(true)

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
const lerp = (a, b, f) => a + (b - a) * f
const clone = (o) => {
  const out = {}
  for (const k in o) out[k] = { x: o[k].x, y: o[k].y }
  return out
}

function posOfRole(role) {
  const r = role === 'dynamic' ? ballRole : role
  return positions[r] || ballPos
}

function applyMovementTo(target, action) {
  if (!action?.movement) return
  for (const [r, p] of Object.entries(action.movement)) {
    const role = r === 'dynamic' ? ballRole : r
    if (target[role]) target[role] = { x: p.x, y: p.y }
  }
}

// Where the ball ends up if `action` executes (against a positions snapshot).
function ballDestForAction(action, snap) {
  const actorRole = action.actor === 'dynamic' ? ballRole : action.actor
  if (action.type === 'pass' || action.type === 'handoff') {
    const rcv = action.receiver === 'dynamic' ? ballRole : action.receiver
    return snap[rcv] ? { ...snap[rcv] } : { ...(snap[actorRole] || ballPos) }
  }
  if (action.type === 'shot') return { ...RIM }
  return snap[actorRole] ? { ...snap[actorRole] } : { ...ballPos }
}

function beginMove(action) {
  current = action
  decideLines.value = []
  moveStartPos = clone(positions)
  moveStartBall = { ...ballPos }
  // Compute committed end snapshot.
  const endPos = clone(positions)
  applyMovementTo(endPos, action)
  moveEndPos = endPos
  moveEndBall = ballDestForAction(action, endPos)
  phase = 'move'
  phaseStart = performance.now()
  phaseDur = Math.max(250, (action.duration || 1) * 1000 * SPEED)
}

function onMoveComplete() {
  // Commit positions + ball.
  positions = clone(moveEndPos)
  ballPos = { ...moveEndBall }
  if (current.type === 'pass' || current.type === 'handoff') {
    ballRole = current.receiver === 'dynamic' ? ballRole : current.receiver
  } else if (current.type !== 'shot') {
    ballRole = current.actor === 'dynamic' ? ballRole : current.actor
  }

  if (current.isShot) return beginEndHold()
  if (current.isDecision) return beginDecide(current)
  if (current.branches.length === 1) {
    const nx = graph.value.actions[current.branches[0].next]
    if (nx) return beginMove(nx)
  }
  beginEndHold()
}

function beginDecide(action) {
  phase = 'decide'
  phaseStart = performance.now()
  phaseDur = DECIDE_HOLD * 1000
  // Build dotted-line options from the ball to each read's destination.
  let maxProb = -1
  for (const b of action.branches) maxProb = Math.max(maxProb, b.prob ?? 0)
  decideLines.value = action.branches.map((b) => {
    const nx = graph.value.actions[b.next]
    const target = nx ? ballDestForAction(nx, positions) : { ...ballPos }
    return {
      x1: ballPos.x * 100,
      y1: ballPos.y * 100,
      x2: target.x * 100,
      y2: target.y * 100,
      primary: (b.prob ?? 0) >= maxProb,
    }
  })
}

function onDecideComplete() {
  const branches = current.branches
  const total = branches.reduce((s, b) => s + (b.prob ?? 0), 0)
  let r = Math.random() * (total || 1)
  let chosen = branches[0]
  for (const b of branches) {
    r -= b.prob ?? 0
    if (r <= 0) { chosen = b; break }
  }
  decideLines.value = []
  const nx = graph.value.actions[chosen.next]
  if (nx) beginMove(nx)
  else beginEndHold()
}

function beginEndHold() {
  phase = 'endhold'
  phaseStart = performance.now()
  phaseDur = END_HOLD * 1000
}

function resetLoop() {
  const g = graph.value
  if (!g || !g.firstActionId) { phase = 'idle'; return }
  positions = clone(g.formation)
  const first = g.actions[g.firstActionId]
  ballRole = first.actor === 'dynamic' ? g.roles[0] : first.actor
  ballPos = positions[ballRole] ? { ...positions[ballRole] } : { x: 0.5, y: 0.2 }
  renderStatic()
  beginMove(first)
}

function renderStatic() {
  const g = graph.value
  if (!g) return
  dots.value = g.roles.map((role) => ({
    role,
    label: g.roleLabels[role] || '',
    x: positions[role].x * 100,
    y: positions[role].y * 100,
  }))
  ball.value = { x: ballPos.x * 100, y: ballPos.y * 100 }
}

function renderInterpolated(f) {
  const g = graph.value
  if (!g) return
  const e = easeInOutQuad(f)
  dots.value = g.roles.map((role) => {
    const p0 = moveStartPos[role] || moveEndPos[role]
    const p1 = moveEndPos[role] || p0
    return { role, label: g.roleLabels[role] || '', x: lerp(p0.x, p1.x, e) * 100, y: lerp(p0.y, p1.y, e) * 100 }
  })
  ball.value = { x: lerp(moveStartBall.x, moveEndBall.x, e) * 100, y: lerp(moveStartBall.y, moveEndBall.y, e) * 100 }
}

function tick(now) {
  if (phase === 'idle') { rafId = requestAnimationFrame(tick); return }
  const f = Math.max(0, Math.min(1, (now - phaseStart) / phaseDur))
  if (phase === 'move') {
    renderInterpolated(f)
    if (f >= 1) onMoveComplete()
  } else if (phase === 'decide') {
    renderStatic() // hold; lines already set
    if (f >= 1) onDecideComplete()
  } else if (phase === 'endhold') {
    renderStatic()
    if (f >= 1) resetLoop()
  }
  rafId = requestAnimationFrame(tick)
}

function start() {
  stop()
  resetLoop()
  rafId = requestAnimationFrame(tick)
}
function stop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
}

watch(
  () => props.play?.id,
  () => { if (visible.value) start(); else resetLoop() }
)

onMounted(() => {
  resetLoop()
  if ('IntersectionObserver' in window && rootEl.value) {
    observer = new IntersectionObserver(
      (entries) => {
        visible.value = entries[0]?.isIntersecting ?? true
        if (visible.value) start()
        else stop()
      },
      { threshold: 0.1 }
    )
    observer.observe(rootEl.value)
  } else {
    start()
  }
})

onBeforeUnmount(() => {
  stop()
  if (observer) observer.disconnect()
})
</script>

<template>
  <div ref="rootEl" class="play-preview">
    <div v-if="!play" class="play-preview-empty">{{ $t('Select a play to preview') }}</div>
    <CourtDiagram v-else>
      <!-- Read options (dotted lines) shown while the offense decides -->
      <line
        v-for="(l, i) in decideLines"
        :key="'opt' + i"
        :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
        class="read-line"
        :class="{ primary: l.primary }"
      />
      <circle
        v-for="(l, i) in decideLines"
        :key="'optdot' + i"
        :cx="l.x2" :cy="l.y2" r="2"
        class="read-target"
        :class="{ primary: l.primary }"
      />
      <!-- Player dots -->
      <g v-for="d in dots" :key="d.role">
        <circle :cx="d.x" :cy="d.y" r="3.2" class="player-dot" />
        <text :x="d.x" :y="d.y + 1.1" class="player-label" text-anchor="middle">{{ d.label }}</text>
      </g>
      <!-- Ball -->
      <circle :cx="ball.x" :cy="ball.y" r="1.8" class="ball-dot" />
    </CourtDiagram>
    <p v-if="play" class="play-preview-name">{{ $tDynamic(play.name) }}</p>
  </div>
</template>

<style scoped>
.play-preview {
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
}

.play-preview-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.player-dot {
  fill: var(--color-primary, #e85a4f);
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 0.5;
}

.player-label {
  fill: #fff;
  font-size: 2.6px;
  font-weight: 700;
  pointer-events: none;
}

.ball-dot {
  fill: #ff8c1a;
  stroke: rgba(0, 0, 0, 0.4);
  stroke-width: 0.4;
}

.read-line {
  stroke: rgba(255, 255, 255, 0.45);
  stroke-width: 0.7;
  stroke-dasharray: 2 2;
}
.read-line.primary {
  stroke: #ffd24a;
  stroke-width: 1;
}
.read-target {
  fill: rgba(255, 255, 255, 0.5);
}
.read-target.primary {
  fill: #ffd24a;
}

.play-preview-name {
  margin-top: 0.4rem;
  text-align: center;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
</style>
