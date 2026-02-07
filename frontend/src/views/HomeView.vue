<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton } from '@/components/ui'

const router = useRouter()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Hero Section -->
    <main class="flex-1 flex items-center justify-center p-4">
      <div class="text-center max-w-3xl mx-auto">
        <!-- Logo/Title -->
        <h1 class="text-6xl md:text-7xl text-gradient mb-4">
          BBALL SIM
        </h1>
        <p class="text-xl text-secondary mb-8">
          The ultimate basketball franchise management simulation
        </p>

        <!-- CTA Buttons -->
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
          <template v-if="isAuthenticated">
            <BaseButton
              variant="primary"
              size="lg"
              @click="router.push('/dashboard')"
            >
              Go to Dashboard
            </BaseButton>
          </template>
          <template v-else>
            <BaseButton
              variant="primary"
              size="lg"
              @click="router.push('/register')"
            >
              Start Playing
            </BaseButton>
            <BaseButton
              variant="secondary"
              size="lg"
              @click="router.push('/login')"
            >
              Sign In
            </BaseButton>
          </template>
        </div>

        <!-- Features -->
        <div class="grid md:grid-cols-3 gap-6 mt-16">
          <GlassCard padding="lg">
            <div class="text-4xl mb-4">🏀</div>
            <h3 class="h4 mb-2">Deep Simulation</h3>
            <p class="text-secondary text-sm">
              Possession-by-possession gameplay with realistic player ratings and badge synergies
            </p>
          </GlassCard>

          <GlassCard padding="lg">
            <div class="text-4xl mb-4">📊</div>
            <h3 class="h4 mb-2">Franchise Mode</h3>
            <p class="text-secondary text-sm">
              Manage rosters, finances, and guide your team through multiple seasons
            </p>
          </GlassCard>

          <GlassCard padding="lg">
            <div class="text-4xl mb-4">🏆</div>
            <h3 class="h4 mb-2">Build a Dynasty</h3>
            <p class="text-secondary text-sm">
              Draft prospects, make trades, and chase championships
            </p>
          </GlassCard>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="p-4 text-center text-tertiary text-sm">
      <p>Basketball Simulator &copy; 2024</p>
    </footer>
  </div>
</template>
