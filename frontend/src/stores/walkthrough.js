import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import { WALKTHROUGHS } from '@/walkthroughs/registry'

// Onboarding walkthrough state. Persists per-user in localStorage (no database).
//
// Gate: at new-campaign creation we ask "Have you played before?". NEW players
// (answer "No") get walkthroughs enabled; experienced players ("Yes") get them
// disabled. Every walkthrough is still individually skippable.
//
// Keys (scoped by user id so a shared device keeps users separate):
//   walkthrough.<userId>.hasPlayedBefore   "true" | "false"
//   walkthrough.<userId>.enabled           "true" | "false"   (enabled === !hasPlayedBefore)
//   walkthrough.<userId>.<walkthroughKey>.done  "true"

const PREFIX = 'walkthrough'

// localStorage access is wrapped: private mode / quota / disabled storage must
// never throw into gameplay code. Mirrors the defensive intent of stores/audio.js.
function lsGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function lsRemove(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export const useWalkthroughStore = defineStore('walkthrough', () => {
  // userId scopes every key. Until set we use 'anon' so nothing leaks across users.
  const userId = ref('anon')

  const hasPlayedBefore = ref(null) // null = not answered yet
  const enabled = ref(false)

  // Active run.
  const activeKey = ref(null)
  const stepIndex = ref(0)

  // Channel the overlay uses to ask a mounted view to switch its internal tab.
  // Views opt in via useWalkthroughTab(); shape: { view, tab } or null.
  const requestedTab = ref(null)

  // Channel for one-shot side-effects a step needs the view to perform (e.g.
  // open/close a contextual menu). A fresh object is assigned each call so the
  // view's watcher fires even when the same action repeats.
  const requestedAction = ref(null)

  // Cache of per-walkthrough done flags so getters stay reactive after markDone.
  const doneCache = reactive({})

  function keyFor(suffix) {
    return `${PREFIX}.${userId.value}.${suffix}`
  }

  function hydrate() {
    const answer = lsGet(keyFor('hasPlayedBefore'))
    hasPlayedBefore.value = answer === null ? null : answer === 'true'
    const en = lsGet(keyFor('enabled'))
    enabled.value = en === 'true'
    // Reset the done cache; flags are read lazily via isDone().
    for (const k of Object.keys(doneCache)) delete doneCache[k]
  }

  // Called once auth resolves (and again if the user changes). Re-scopes keys.
  function setUserId(id) {
    const next = id ? String(id) : 'anon'
    if (next === userId.value) return
    userId.value = next
    // Abort any in-flight run when the user changes.
    activeKey.value = null
    stepIndex.value = 0
    requestedTab.value = null
    requestedAction.value = null
    hydrate()
  }

  function setHasPlayedBefore(value) {
    const played = !!value
    hasPlayedBefore.value = played
    enabled.value = !played // new players (haven't played) get the tours
    lsSet(keyFor('hasPlayedBefore'), String(played))
    lsSet(keyFor('enabled'), String(enabled.value))
    // The gate is answered once per new campaign and is authoritative: re-arm
    // every tour so a fresh campaign starts the walkthroughs over, even if the
    // user completed them on a previous campaign.
    resetProgress()
  }

  // Clear every walkthrough's done-flag (and the live cache) so the tours can
  // run again. Iterates the known walkthrough keys from the registry.
  function resetProgress() {
    for (const key of Object.keys(WALKTHROUGHS)) {
      lsRemove(keyFor(`${key}.done`))
      doneCache[key] = false
    }
  }

  function isDone(key) {
    if (key in doneCache) return doneCache[key]
    const done = lsGet(keyFor(`${key}.done`)) === 'true'
    doneCache[key] = done
    return done
  }

  function markDone(key) {
    doneCache[key] = true
    lsSet(keyFor(`${key}.done`), 'true')
  }

  // The single entry point views call (e.g. onMounted). Safe no-op unless the
  // tour is enabled, not already running, and not previously completed/skipped.
  function maybeStart(key) {
    if (!enabled.value) return
    if (activeKey.value) return
    if (!WALKTHROUGHS[key]) return
    if (isDone(key)) return
    activeKey.value = key
    stepIndex.value = 0
  }

  // Same as maybeStart but bypasses the global `enabled` flag AND the per-key
  // `isDone` flag. Used for opt-in feature tours (e.g. the headshot editor
  // first-visit walkthrough) that should run even for experienced players who
  // have turned off the campaign tours.
  function forceStart(key) {
    if (activeKey.value) return
    if (!WALKTHROUGHS[key]) return
    activeKey.value = key
    stepIndex.value = 0
  }

  const isRunning = computed(() => !!activeKey.value)
  const currentSteps = computed(() => (activeKey.value ? WALKTHROUGHS[activeKey.value] || [] : []))
  const totalSteps = computed(() => currentSteps.value.length)
  const currentStep = computed(() => currentSteps.value[stepIndex.value] || null)
  const isFirstStep = computed(() => stepIndex.value <= 0)
  const isLastStep = computed(() => stepIndex.value >= totalSteps.value - 1)

  function next() {
    if (!activeKey.value) return
    if (stepIndex.value >= totalSteps.value - 1) {
      finish()
      return
    }
    stepIndex.value += 1
  }

  function back() {
    if (!activeKey.value) return
    if (stepIndex.value > 0) stepIndex.value -= 1
  }

  // Completing or skipping both mark the walkthrough done so it never re-pops.
  function finish() {
    const finishedKey = activeKey.value
    if (finishedKey) markDone(finishedKey)
    activeKey.value = null
    stepIndex.value = 0
    requestedTab.value = null
    requestedAction.value = null
    // Tours often scroll to spotlight mid/lower elements; on exit, return the
    // user to the top of the current view. For tours that run inside the
    // player-details modal the page itself isn't scrolled — the modal's
    // .modal-content is — so scrolling window leaves the modal stranded mid-
    // content. Detect modal tours and reset the modal's scroll instead.
    if (typeof window === 'undefined') return
    const isModalTour = typeof finishedKey === 'string' && finishedKey.startsWith('playerDetail')
    if (isModalTour) {
      const modalContent = document.querySelector('.modal-content')
      if (modalContent) {
        modalContent.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function skip() {
    finish()
  }

  function requestTab(view, tab) {
    requestedTab.value = { view, tab }
  }

  function requestAction(view, action) {
    requestedAction.value = { view, action }
  }

  // Initial hydrate for the default 'anon' scope; setUserId re-runs it.
  hydrate()

  return {
    userId,
    hasPlayedBefore,
    enabled,
    activeKey,
    stepIndex,
    requestedTab,
    requestedAction,
    isRunning,
    currentSteps,
    currentStep,
    totalSteps,
    isFirstStep,
    isLastStep,
    setUserId,
    setHasPlayedBefore,
    resetProgress,
    isDone,
    markDone,
    maybeStart,
    forceStart,
    next,
    back,
    finish,
    skip,
    requestTab,
    requestAction,
  }
})
