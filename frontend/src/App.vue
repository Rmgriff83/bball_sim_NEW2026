<script setup>
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useBreakingNewsStore } from '@/stores/breakingNews'
import { ToastContainer, MinimalToast } from '@/components/ui'
import BreakingNewsModal from '@/components/game/BreakingNewsModal.vue'

const authStore = useAuthStore()
const breakingNewsStore = useBreakingNewsStore()

onMounted(() => {
  // Initialize theme from localStorage or system preference
  const savedTheme = localStorage.getItem('theme')
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme)
  } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.documentElement.setAttribute('data-theme', 'light')
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
</template>
