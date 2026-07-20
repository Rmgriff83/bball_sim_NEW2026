// One-time review nag state. Shown after the season-start owner check-in once
// the user has completed a full season (gameYear >= 2) — see
// CampaignHomeView.maybeShowReviewNag. "At most once per user, ever" is the
// non-invasive contract: the shown flag is stamped the moment the modal
// appears, so even a dismissal never re-nags.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

const PREFIX = 'reviewNag'

// Defensive localStorage (private mode / quota must never throw into
// gameplay) — same idiom as stores/walkthrough.js.
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

export const useReviewNagStore = defineStore('reviewNag', () => {
  const visible = ref(false)
  const step = ref('ask') // 'ask' | 'loving' | 'feedback'

  function _key() {
    const userId = useAuthStore().user?.id ?? 'anon'
    return `${PREFIX}.${userId}.done`
  }

  function alreadyShown() {
    return lsGet(_key()) === 'true'
  }

  function markShown() {
    lsSet(_key(), 'true')
  }

  /** Show the nag if this user has never seen it. Returns whether it opened. */
  function maybeShow() {
    if (alreadyShown()) return false
    markShown() // stamp at show-time: strict at-most-once, even if dismissed
    step.value = 'ask'
    visible.value = true
    return true
  }

  function choose(nextStep) {
    step.value = nextStep
  }

  function close() {
    visible.value = false
  }

  return { visible, step, alreadyShown, maybeShow, choose, close }
})
