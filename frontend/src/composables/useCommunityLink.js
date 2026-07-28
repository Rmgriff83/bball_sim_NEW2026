// Shared "open the community roster board" affordance. The board lives on the
// WEB build only: web users navigate in-SPA; native users get a one-time
// login-handoff URL opened in the system browser (mirrors the roster editor's
// openCommunity flow). Gated by the custom_roster (Roster Editor) unlock.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { useAuthStore } from '@/stores/auth'
import api from '@/composables/useApi'

export function useCommunityLink() {
  const router = useRouter()
  const authStore = useAuthStore()

  const hasCommunity = computed(() => authStore.hasFeature('custom_roster'))

  async function openCommunity(campaignId = null) {
    const returnTo = campaignId
      ? `/community?campaign=${encodeURIComponent(campaignId)}`
      : '/community'
    if (!Capacitor.isNativePlatform()) {
      router.push(returnTo)
      return
    }
    try {
      const res = await api.post('/api/auth/handoff', { return_to: returnTo })
      window.open(res.data.url, '_system')
    } catch { /* handoff mint failed — non-fatal, user can retry */ }
  }

  return { hasCommunity, openCommunity }
}
