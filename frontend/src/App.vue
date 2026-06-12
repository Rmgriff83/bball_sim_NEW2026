<script setup>
import { onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useBreakingNewsStore } from '@/stores/breakingNews'
import { useWalkthroughStore } from '@/stores/walkthrough'
import { ToastContainer, MinimalToast } from '@/components/ui'
import BreakingNewsModal from '@/components/game/BreakingNewsModal.vue'
import WalkthroughOverlay from '@/components/walkthrough/WalkthroughOverlay.vue'

const authStore = useAuthStore()
const breakingNewsStore = useBreakingNewsStore()
const walkthroughStore = useWalkthroughStore()

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
  />
  <WalkthroughOverlay />
</template>
