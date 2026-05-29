<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronRight, ChevronLeft } from 'lucide-vue-next'
import { useWalkthroughStore } from '@/stores/walkthrough'

// The single global walkthrough engine. Mounted once in App.vue. Renders a
// full-screen dim layer, a spotlight "cutout" over the current target element
// (via a giant box-shadow), and a positioned tooltip with the step copy and
// Back / Next / Skip controls. Handles route + tab switching, async target
// resolution, scroll-into-view, and resize/scroll repositioning.

const store = useWalkthroughStore()
const route = useRoute()
const router = useRouter()

// rect of the spotlight hole (null = centered, no spotlight)
const spotlightRect = ref(null)
const tooltipStyle = ref({})
const centerMode = ref(false)

// The currently spotlighted element(s), kept so resize/scroll can reposition
// without re-resolving the whole step. A step may target more than one element,
// in which case the spotlight covers their union bounding box.
let activeEls = []
// Increments on every step change so stale async resolutions abort.
let resolveToken = 0

// A step's `action.leave` to fire when we move off it (in any direction), e.g.
// closing a menu its `action.enter` opened. Set on enter, fired on next runStep
// and on teardown.
let pendingLeave = null

const step = computed(() => store.currentStep)
const counter = computed(() => `${store.stepIndex + 1} of ${store.totalSteps}`)
const nextLabel = computed(() => (store.isLastStep ? 'Done' : 'Next'))
// An interactive step is advanced by the user clicking the highlighted element
// (not the Next button) — used to hand off to a deeper tour.
const isInteractiveStep = computed(() => !!step.value?.interactive && !centerMode.value)

const SPOTLIGHT_PAD = 6
const TOOLTIP_GAP = 12
const VIEWPORT_MARGIN = 16

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Resolve a [data-tour] target, polling until it exists with a non-zero rect.
// If the element is present in the DOM but CSS-hidden (e.g. display:none at this
// breakpoint), give up quickly rather than burning the full timeout — that lets
// the caller skip steps whose target only exists on another viewport.
function waitForElement(selector, timeout) {
  return new Promise((resolve) => {
    const start = performance.now()
    function check() {
      const el = document.querySelector(selector)
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 || r.height > 0) {
          resolve(el)
          return
        }
        // No box. After a short grace (covers transient render/transition), if
        // it's genuinely not laid out (display:none → no offsetParent and no
        // client rects), treat it as absent at this breakpoint.
        if (performance.now() - start > 400 && el.offsetParent === null && el.getClientRects().length === 0) {
          resolve(null)
          return
        }
      }
      if (performance.now() - start > timeout) {
        resolve(null)
        return
      }
      requestAnimationFrame(check)
    }
    check()
  })
}

function isLaidOut(el) {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 || r.height > 0
}

// Resolve a step's target(s).
// Fast path: if any target is already on-screen, use it immediately — no wait.
// (Covers the common case where the page is already rendered, and lets
// breakpoint alternatives like the desktop/mobile date go straight to whichever
// is visible.) Otherwise wait for async render (after a route/tab switch),
// resolving as soon as one appears (+ a short grace to catch a second).
function resolveTargets(targets) {
  const visibleNow = targets
    .map((sel) => document.querySelector(`[data-tour="${sel}"]`))
    .filter(isLaidOut)
  if (visibleNow.length > 0) return Promise.resolve(visibleNow)

  return new Promise((resolve) => {
    const found = []
    let settled = 0
    let grace = null
    const finish = () => {
      if (grace) clearTimeout(grace)
      resolve(found)
    }
    targets.forEach((sel) => {
      waitForElement(`[data-tour="${sel}"]`, 3000).then((el) => {
        settled++
        if (el) found.push(el)
        if (settled === targets.length) {
          finish()
        } else if (el && !grace) {
          // First hit while others are still pending — give them a brief moment.
          grace = setTimeout(finish, 150)
        }
      })
    })
  })
}

function setCentered() {
  activeEls = []
  spotlightRect.value = null
  centerMode.value = true
  tooltipStyle.value = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
}

// Compute the tooltip top/left for a placement relative to a target rect,
// flipping to the opposite side on overflow and clamping into the viewport.
function placeTooltip(r, placement, tw, th) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let place = placement || 'bottom'

  // Flip if the preferred side doesn't fit.
  if (place === 'bottom' && r.bottom + TOOLTIP_GAP + th > vh - VIEWPORT_MARGIN) place = 'top'
  else if (place === 'top' && r.top - TOOLTIP_GAP - th < VIEWPORT_MARGIN) place = 'bottom'
  else if (place === 'right' && r.right + TOOLTIP_GAP + tw > vw - VIEWPORT_MARGIN) place = 'left'
  else if (place === 'left' && r.left - TOOLTIP_GAP - tw < VIEWPORT_MARGIN) place = 'right'

  let top
  let left
  switch (place) {
    case 'top':
      top = r.top - th - TOOLTIP_GAP
      left = r.left + r.width / 2 - tw / 2
      break
    case 'left':
      top = r.top + r.height / 2 - th / 2
      left = r.left - tw - TOOLTIP_GAP
      break
    case 'right':
      top = r.top + r.height / 2 - th / 2
      left = r.right + TOOLTIP_GAP
      break
    case 'bottom':
    default:
      top = r.bottom + TOOLTIP_GAP
      left = r.left + r.width / 2 - tw / 2
      break
  }

  top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - th - VIEWPORT_MARGIN))
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - tw - VIEWPORT_MARGIN))
  return { top: `${top}px`, left: `${left}px` }
}

// Bounding box that encloses every element (viewport coords). For a single
// element this is just its rect; for several, the union covers them all.
function unionRect(els) {
  let top = Infinity
  let left = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const el of els) {
    const r = el.getBoundingClientRect()
    top = Math.min(top, r.top)
    left = Math.min(left, r.left)
    right = Math.max(right, r.right)
    bottom = Math.max(bottom, r.bottom)
  }
  return { top, left, right, bottom, width: right - left, height: bottom - top }
}

async function positionToTargets(els, placement) {
  const r = unionRect(els)
  spotlightRect.value = {
    top: r.top - SPOTLIGHT_PAD,
    left: r.left - SPOTLIGHT_PAD,
    width: r.width + SPOTLIGHT_PAD * 2,
    height: r.height + SPOTLIGHT_PAD * 2,
  }
  centerMode.value = false
  // Measure the rendered tooltip, then place it relative to the union box.
  await nextTick()
  const tip = tooltipRef.value
  const tw = tip ? tip.offsetWidth : 320
  const th = tip ? tip.offsetHeight : 160
  tooltipStyle.value = placeTooltip(r, placement, tw, th)
}

const tooltipRef = ref(null)

async function runStep() {
  const token = ++resolveToken
  const s = store.currentStep
  if (!s) return

  // 0. Fire the previous step's leave action (e.g. close a menu) before moving.
  if (pendingLeave) {
    store.requestAction(pendingLeave.view, pendingLeave.action)
    pendingLeave = null
    await nextTick()
    if (token !== resolveToken) return
  }

  // 1. Be on the right route.
  if (s.route && route.name !== s.route) {
    try {
      await router.push({ name: s.route, params: { id: route.params.id } })
    } catch {
      /* navigation aborted/duplicate — ignore */
    }
    if (token !== resolveToken) return
  }

  // 2. Ask the mounted view to switch to the right internal tab.
  if (s.tab) {
    store.requestTab(s.tab.view, s.tab.tab)
    await nextTick()
    if (token !== resolveToken) return
  }

  // 2b. Run this step's enter action (side-effect in the view), and remember
  //     its leave action to undo when we move off the step.
  if (s.action) {
    if (s.action.enter) {
      store.requestAction(s.action.view, s.action.enter)
      await nextTick()
      // Give any open/close transition a beat to render before measuring.
      await wait(220)
      if (token !== resolveToken) return
    }
    pendingLeave = s.action.leave ? { view: s.action.view, action: s.action.leave } : null
  }

  // 3. Centered card (intro/outro or no target).
  const targets = Array.isArray(s.target) ? s.target : (s.target ? [s.target] : [])
  if (targets.length === 0 || s.placement === 'center') {
    setCentered()
    return
  }

  // 4. Resolve target(s) and position over their union. Fall back to centered
  // if none resolve.
  const els = await resolveTargets(targets)
  if (token !== resolveToken) return
  if (els.length === 0) {
    // Target(s) not found — show the tip as a centered card (no spotlight)
    // rather than skipping, so a missing/mistargeted element is visible and
    // obvious to fix. The warning helps catch it in dev.
    console.warn(`[walkthrough] target not found, showing centered: ${JSON.stringify(s.target)}`)
    setCentered()
    return
  }

  // Scroll the first target into view if it's off-screen, then settle.
  const r0 = els[0].getBoundingClientRect()
  if (r0.top < VIEWPORT_MARGIN || r0.bottom > window.innerHeight - VIEWPORT_MARGIN) {
    els[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    await wait(380)
    if (token !== resolveToken) return
  }

  activeEls = els
  await positionToTargets(els, s.placement)
}

// While a tour is active, block user-initiated scrolling so the highlighted
// element can't be scrolled out of view. We can't just lock body overflow —
// that would also break the tour's own scrollIntoView for below-the-fold steps
// — so we cancel wheel/touch/scroll-key events instead. Programmatic scrolling
// (scrollIntoView) is unaffected, and scrolling inside the tooltip still works.
function blockScroll(e) {
  if (!store.isRunning) return
  if (tooltipRef.value && tooltipRef.value.contains(e.target)) return
  e.preventDefault()
}

const SCROLL_KEYS = new Set([
  'PageUp', 'PageDown', 'End', 'Home', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar',
])
function blockScrollKeys(e) {
  if (!store.isRunning) return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (tooltipRef.value && tooltipRef.value.contains(t)) return
  if (SCROLL_KEYS.has(e.key)) e.preventDefault()
}

// On an interactive step the dim layer lets clicks through (pointer-events:none)
// so the user can tap the highlighted element. This capture-phase listener
// enforces that only the highlighted element (or the tooltip) is clickable:
// a click on the target advances the tour and is allowed to proceed (so the
// element's own handler — e.g. opening a modal — still fires); clicks anywhere
// else are cancelled so the user can't wander off mid-handoff.
function handleInteractiveClick(e) {
  if (!isInteractiveStep.value) return
  if (tooltipRef.value && tooltipRef.value.contains(e.target)) return
  const onTarget = activeEls.some((el) => el === e.target || el.contains(e.target))
  if (onTarget) {
    // Advance (finishing this tour) before the element's handler runs, so a
    // deeper tour it triggers isn't blocked by this one still being active.
    store.next()
    return
  }
  e.preventDefault()
  e.stopPropagation()
}

// Reposition (no re-resolve) on resize/scroll while a target is active.
let rafId = null
function reposition() {
  if (!store.isRunning) return
  if (centerMode.value || activeEls.length === 0) return
  if (!activeEls.every((el) => el.isConnected)) return
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    positionToTargets(activeEls, store.currentStep?.placement)
  })
}

watch(
  () => [store.activeKey, store.stepIndex],
  ([key]) => {
    if (key) {
      runStep()
    } else {
      // Run ended — fire any pending leave action (e.g. close an opened menu),
      // then tear down visuals.
      resolveToken++
      if (pendingLeave) {
        store.requestAction(pendingLeave.view, pendingLeave.action)
        pendingLeave = null
      }
      activeEls = []
      spotlightRect.value = null
      centerMode.value = false
    }
  }
)

onMounted(() => {
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, { capture: true, passive: true })
  // passive: false so preventDefault can cancel the scroll.
  window.addEventListener('wheel', blockScroll, { passive: false })
  window.addEventListener('touchmove', blockScroll, { passive: false })
  window.addEventListener('keydown', blockScrollKeys)
  document.addEventListener('click', handleInteractiveClick, { capture: true })
})

onUnmounted(() => {
  window.removeEventListener('resize', reposition)
  window.removeEventListener('scroll', reposition, { capture: true })
  window.removeEventListener('wheel', blockScroll)
  window.removeEventListener('touchmove', blockScroll)
  window.removeEventListener('keydown', blockScrollKeys)
  document.removeEventListener('click', handleInteractiveClick, { capture: true })
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="store.isRunning && step"
      class="wt-layer"
      :class="{ 'wt-dim': centerMode, 'wt-interactive': isInteractiveStep }"
    >
      <!-- Spotlight cutout (box-shadow dims everything around the hole) -->
      <div
        v-if="spotlightRect"
        class="wt-spotlight"
        :style="{
          top: spotlightRect.top + 'px',
          left: spotlightRect.left + 'px',
          width: spotlightRect.width + 'px',
          height: spotlightRect.height + 'px',
        }"
      />

      <!-- Tooltip / instruction box -->
      <div ref="tooltipRef" class="wt-tooltip" :style="tooltipStyle">
        <div class="wt-tooltip-counter">{{ counter }}</div>
        <h3 class="wt-tooltip-title">{{ step.title }}</h3>
        <p class="wt-tooltip-body">{{ step.body }}</p>
        <!-- Optional "learn more" link. Opens in a new tab so the tour isn't
             interrupted (navigating in-place would unmount the current view). -->
        <a
          v-if="step.link"
          class="wt-tooltip-link"
          :href="step.link.to"
          target="_blank"
          rel="noopener"
        >
          {{ step.link.label }}
        </a>
        <div class="wt-tooltip-footer">
          <button class="wt-skip" @click="store.skip()">Skip walkthrough</button>
          <div class="wt-nav">
            <button v-if="!store.isFirstStep" class="wt-btn wt-btn-ghost" @click="store.back()">
              <ChevronLeft :size="16" />
              Back
            </button>
            <!-- Interactive step: the user taps the highlighted element to go on. -->
            <span v-if="isInteractiveStep" class="wt-tap-hint">Tap the highlighted card →</span>
            <button v-else class="wt-btn wt-btn-primary" @click="store.next()">
              {{ nextLabel }}
              <ChevronRight v-if="!store.isLastStep" :size="16" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wt-layer {
  position: fixed;
  inset: 0;
  z-index: 90;
  /* Blocks interaction with the underlying UI; the tour drives navigation. */
  pointer-events: auto;
}

/* Centered (no-spotlight) steps dim the whole screen here. */
.wt-dim {
  background: rgba(10, 8, 14, 0.72);
}

/* Interactive steps let clicks reach the page so the user can tap the
   highlighted element; a document-level handler restricts which clicks count.
   The tooltip re-enables pointer events on itself below. */
.wt-interactive {
  pointer-events: none;
}

.wt-spotlight {
  position: fixed;
  border-radius: 10px;
  box-shadow: 0 0 0 9999px rgba(10, 8, 14, 0.72);
  outline: 2px solid var(--color-primary);
  outline-offset: 0;
  pointer-events: none;
  transition:
    top var(--duration-normal) var(--ease-out),
    left var(--duration-normal) var(--ease-out),
    width var(--duration-normal) var(--ease-out),
    height var(--duration-normal) var(--ease-out);
}

.wt-tooltip {
  position: fixed;
  width: min(340px, calc(100vw - 32px));
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  padding: 16px 18px;
  pointer-events: auto;
  animation: wtTooltipIn var(--duration-normal) var(--ease-out);
}

@keyframes wtTooltipIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Centered card keeps its centering transform; skip the slide-in offset. */
.wt-tooltip[style*='translate'] {
  animation-name: wtTooltipFade;
}

@keyframes wtTooltipFade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.wt-tooltip-counter {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-primary);
  margin-bottom: 6px;
}

.wt-tooltip-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.35rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  margin: 0 0 6px;
}

.wt-tooltip-body {
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
  margin: 0 0 14px;
}

.wt-tooltip-link {
  display: inline-block;
  margin: -6px 0 14px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-primary);
  text-decoration: none;
}

.wt-tooltip-link:hover {
  text-decoration: underline;
}

.wt-tooltip-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wt-skip {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: color 0.2s ease;
}

.wt-skip:hover {
  color: var(--color-text-secondary);
  text-decoration: underline;
}

.wt-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wt-tap-hint {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-primary);
}

.wt-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 14px;
  border-radius: var(--radius-lg);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.wt-btn-ghost {
  background: transparent;
  border-color: var(--glass-border);
  color: var(--color-text-primary);
}

.wt-btn-ghost:hover {
  background: var(--color-bg-tertiary);
}

.wt-btn-primary {
  background: var(--color-primary);
  color: #fff;
}

.wt-btn-primary:hover {
  background: var(--color-primary-dark);
}

@media (prefers-reduced-motion: reduce) {
  .wt-spotlight {
    transition: none;
  }
  .wt-tooltip {
    animation: none;
  }
}
</style>
