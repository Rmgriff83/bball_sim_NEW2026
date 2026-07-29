// Shared "open the community roster board" affordance. The board lives on the
// WEB build only: web users navigate in-SPA; native users get a one-time
// login-handoff URL opened in the system browser. Gated by the custom_roster
// (Roster Editor) unlock.
//
// Native opening uses @capacitor/browser (a native call) — NOT window.open:
// WKWebView refuses window.open once the user-gesture context expires across
// the awaited handoff mint, which silently no-op'd on iOS and led users to
// re-tap into the mint endpoint's 6/min throttle.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import api from '@/composables/useApi'

export function useCommunityLink() {
  const router = useRouter()
  const authStore = useAuthStore()

  const hasCommunity = computed(() => authStore.hasFeature('custom_roster'))
  const opening = ref(false)

  async function openCommunity(campaignId = null) {
    const returnTo = campaignId
      ? `/community?campaign=${encodeURIComponent(campaignId)}`
      : '/community'
    if (!Capacitor.isNativePlatform()) {
      router.push(returnTo)
      return
    }
    if (opening.value) return // rapid taps must not stack throttled mints
    opening.value = true
    const toast = useToastStore()
    try {
      const res = await api.post('/api/auth/handoff', { return_to: returnTo }, { skipErrorToast: true })
      await Browser.open({ url: res.data.url })
    } catch (err) {
      if (err?.response?.status === 429) {
        toast.showError('Easy — try again in a minute.')
      } else {
        toast.showError("Couldn't open the community board — please try again.")
      }
    } finally {
      opening.value = false
    }
  }

  return { hasCommunity, openCommunity, opening }
}
