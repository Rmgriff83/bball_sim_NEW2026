<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton } from '@/components/ui'

const router = useRouter()
const authStore = useAuthStore()
const user = computed(() => authStore.user)

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Header -->
    <header class="app-header">
      <div class="container flex items-center justify-between py-4">
        <router-link to="/" class="app-logo">BBALL SIM</router-link>

        <nav class="flex items-center gap-4">
          <router-link to="/campaigns" class="nav-link">Campaigns</router-link>
          <router-link to="/profile" class="nav-link">Profile</router-link>
          <button @click="handleLogout" class="btn btn-ghost btn-sm">
            Sign Out
          </button>
        </nav>
      </div>
    </header>

    <!-- Main Content -->
    <main class="container p-8">
      <div class="mb-8">
        <h1 class="h2 text-gradient mb-2">Welcome back, {{ user?.username }}!</h1>
        <p class="text-secondary">Ready to build your dynasty?</p>
      </div>

      <!-- Quick Actions -->
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <GlassCard padding="lg" class="cursor-pointer" @click="router.push('/campaigns')">
          <div class="text-3xl mb-4">🎮</div>
          <h3 class="h4 mb-2">Continue Playing</h3>
          <p class="text-secondary text-sm">Pick up where you left off</p>
        </GlassCard>

        <GlassCard padding="lg" class="cursor-pointer" @click="router.push('/campaigns')">
          <div class="text-3xl mb-4">🆕</div>
          <h3 class="h4 mb-2">New Campaign</h3>
          <p class="text-secondary text-sm">Start a new franchise</p>
        </GlassCard>

        <GlassCard padding="lg" class="cursor-pointer" @click="router.push('/profile')">
          <div class="text-3xl mb-4">👤</div>
          <h3 class="h4 mb-2">Profile</h3>
          <p class="text-secondary text-sm">View stats & achievements</p>
        </GlassCard>
      </div>

      <!-- Recent Activity Placeholder -->
      <GlassCard padding="lg" :hoverable="false">
        <h3 class="h4 mb-4">Recent Activity</h3>
        <p class="text-secondary">No recent activity yet. Start a campaign to begin!</p>
      </GlassCard>
    </main>
  </div>
</template>

<style scoped>
/* Header styles */
.app-header {
  background: var(--glass-bg);
  border-bottom: 1px solid var(--glass-border);
  position: sticky;
  top: 0;
  z-index: 40;
  backdrop-filter: blur(12px);
}

.app-logo {
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 700;
  font-style: italic;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.nav-link {
  color: var(--color-text-secondary);
  font-weight: 500;
  transition: color var(--duration-fast) var(--ease-default);
}

.nav-link:hover {
  color: var(--color-primary);
}
</style>
