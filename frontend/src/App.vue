<script setup>
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { useAuthStore } from '@/stores/auth'
import { useBreakingNewsStore } from '@/stores/breakingNews'
import { useGameStore } from '@/stores/game'
import { useTeamStore } from '@/stores/team'
import { useCampaignStore } from '@/stores/campaign'
import { useToastStore } from '@/stores/toast'
import { useWalkthroughStore } from '@/stores/walkthrough'
import { useAppUpdateStore } from '@/stores/appUpdate'
import { t } from '@wl-i18n/i18n.js'
import { ToastContainer, MinimalToast } from '@/components/ui'
import BreakingNewsModal from '@/components/game/BreakingNewsModal.vue'
import WalkthroughOverlay from '@/components/walkthrough/WalkthroughOverlay.vue'
import UpdateNagModal from '@/components/common/UpdateNagModal.vue'

const router = useRouter()
const authStore = useAuthStore()
const breakingNewsStore = useBreakingNewsStore()
const gameStore = useGameStore()
const teamStore = useTeamStore()
const campaignStore = useCampaignStore()
const toastStore = useToastStore()
const walkthroughStore = useWalkthroughStore()
const appUpdateStore = useAppUpdateStore()

// Sim-pause-flagged breaking news (e.g. the trade-deadline warning) replaces
// the old separate SimPauseModal for that reason. The user MUST resolve via
// Pause Sim or Continue Sim — both close the news and forward the choice to
// the game store. (Dismiss without choosing isn't reachable from the UI; the
// X / overlay / Escape paths route to Pause Sim instead.)
async function handleBreakingNewsContinue() {
  breakingNewsStore.dismiss()
  try {
    await gameStore.resumeSimulation()
  } catch (err) {
    console.error('Failed to resume simulation:', err)
    toastStore.showError(t('Failed to resume simulation'))
  }
}

function handleBreakingNewsPause() {
  breakingNewsStore.dismiss()
  gameStore.cancelSimulation()
}

// Scope walkthrough state to the signed-in user (keys are per-user in
// localStorage). Re-runs whenever auth resolves or the user changes.
watch(
  () => authStore.user,
  (user) => {
    walkthroughStore.setUserId(user?.id ?? user?.email ?? null)
  },
  { immediate: true }
)

onMounted(() => {
  // Initialize theme. Dark is the default — :root in _variables.css carries
  // the dark palette and [data-theme="light"] overrides it. Honor an explicit
  // user override from localStorage; ignore system color-scheme so the app
  // doesn't flip to light just because the OS prefers it.
  const savedTheme = localStorage.getItem('theme')
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme)
  }

  // Retention notifications (native only): cancel the lapse/points reminders
  // whenever the user is HERE, and (re)schedule them whenever the app goes to
  // the background. The training-ready notification is managed separately by
  // the team store at session start/claim.
  if (Capacitor.isNativePlatform()) {
    // Soft update-nag: if this build is behind the latest, prompt to update.
    // Fire-and-forget; native-only + fail-open inside the store/service.
    appUpdateStore.check()

    // Cold start = the user came back — clear the ladder. Also re-bake any
    // surviving pending notifications (e.g. the training timer) in the
    // CURRENT locale: their text was frozen at schedule time and may be in a
    // language the user has since switched away from.
    import('@/services/notifications').then(n => {
      n.cancelRetentionReminders()
      n.relocalizePendingNotifications()
    }).catch(() => {})

    // Notification taps: route straight to the campaign the notification was
    // scheduled for (extra.campaignId — see services/notifications.js).
    // Registered here in startup so Capacitor's buffered cold-start tap event
    // is delivered to it; without a campaignId the tap just opens the app.
    import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
      LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
        const campaignId = event?.notification?.extra?.campaignId
        if (!campaignId) return
        router.isReady()
          .then(() => router.push(`/campaign/${campaignId}`))
          .catch(() => {})
      })
    }).catch(() => {})

    import('@capacitor/app').then(({ App }) => {
      // Deep-link return from the web community flow. The web sends
      // bballsim://open?path=<app-relative-route> — route straight there.
      // Only app-relative paths are honored (no external redirect surface).
      App.addListener('appUrlOpen', ({ url }) => {
        try {
          const parsed = new URL(url)
          if (parsed.protocol !== 'bballsim:') return
          const path = parsed.searchParams.get('path')
          if (path && path.startsWith('/')) {
            // The community page opens in an in-app SFSafariViewController
            // (@capacitor/browser) that stays presented ON TOP of the
            // WebView — without closing it, the deep-link navigation
            // happens invisibly underneath. No-op when nothing is open.
            import('@capacitor/browser')
              .then(({ Browser }) => Browser.close())
              .catch(() => {})
            router.push(path)
          }
        } catch { /* malformed link — ignore */ }
      })

      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          import('@/services/notifications').then(n => n.cancelRetentionReminders()).catch(() => {})
          return
        }
        // Backgrounding: sum unspent attribute upgrade points across the
        // loaded roster (0 when no campaign is loaded — the lapse reminders
        // still schedule).
        let pendingPoints = 0
        try {
          for (const p of (teamStore.roster ?? [])) {
            pendingPoints +=
              (p?.offense_upgrade_points ?? p?.offenseUpgradePoints ?? 0) +
              (p?.defense_upgrade_points ?? p?.defenseUpgradePoints ?? 0)
          }
        } catch { pendingPoints = 0 }
        const campaignId = campaignStore.currentCampaign?.id ?? null
        import('@/services/notifications')
          .then(n => n.scheduleRetentionReminders({ pendingPoints, campaignId }))
          .catch(() => {})
      })
    }).catch(() => {})
  }
})
</script>

<template>
  <router-view v-slot="{ Component }">
    <transition name="fade" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
  <ToastContainer />
  <MinimalToast />
  <BreakingNewsModal
    :show="breakingNewsStore.isShowing"
    :item="breakingNewsStore.currentItem"
    @dismiss="breakingNewsStore.dismiss()"
    @continue="handleBreakingNewsContinue"
    @pause="handleBreakingNewsPause"
  />
  <WalkthroughOverlay />
  <UpdateNagModal />
</template>
