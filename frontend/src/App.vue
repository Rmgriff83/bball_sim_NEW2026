<script setup>
import { onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useBreakingNewsStore } from '@/stores/breakingNews'
import { useGameStore } from '@/stores/game'
import { useToastStore } from '@/stores/toast'
import { useWalkthroughStore } from '@/stores/walkthrough'
import { ToastContainer, MinimalToast } from '@/components/ui'
import BreakingNewsModal from '@/components/game/BreakingNewsModal.vue'
import WalkthroughOverlay from '@/components/walkthrough/WalkthroughOverlay.vue'

const authStore = useAuthStore()
const breakingNewsStore = useBreakingNewsStore()
const gameStore = useGameStore()
const toastStore = useToastStore()
const walkthroughStore = useWalkthroughStore()

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
    toastStore.showError('Failed to resume simulation')
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
</template>
