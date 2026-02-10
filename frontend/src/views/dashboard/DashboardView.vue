<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton } from '@/components/ui'
import { Gamepad2, Plus, User, LogOut, LayoutDashboard, Trophy } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const user = computed(() => authStore.user)

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="dashboard-page">
    <!-- Header -->
    <header class="dashboard-header">
      <div class="header-container">
        <router-link to="/" class="app-logo">BBALL SIM</router-link>

        <nav class="header-nav">
          <router-link to="/campaigns" class="nav-link">
            <LayoutDashboard :size="18" />
            <span>Campaigns</span>
          </router-link>
          <router-link to="/profile" class="nav-link">
            <User :size="18" />
            <span>Profile</span>
          </router-link>
          <button @click="handleLogout" class="nav-link logout-btn">
            <LogOut :size="18" />
            <span>Sign Out</span>
          </button>
        </nav>
      </div>
    </header>

    <!-- Main Content -->
    <main class="dashboard-main">
      <div class="dashboard-container">
        <!-- Welcome Section -->
        <div class="welcome-section">
          <h1 class="welcome-title">Welcome back, {{ user?.username }}!</h1>
          <p class="welcome-subtitle">Ready to build your dynasty?</p>
        </div>

        <!-- Quick Actions -->
        <section class="actions-section">
          <h2 class="section-title">Quick Actions</h2>
          <div class="actions-grid">
            <GlassCard padding="lg" class="action-card" @click="router.push('/campaigns')">
              <div class="action-icon continue">
                <Gamepad2 :size="24" />
              </div>
              <div class="action-content">
                <h3 class="action-title">Continue Playing</h3>
                <p class="action-description">Pick up where you left off</p>
              </div>
            </GlassCard>

            <GlassCard padding="lg" class="action-card" @click="router.push('/campaigns')">
              <div class="action-icon new">
                <Plus :size="24" />
              </div>
              <div class="action-content">
                <h3 class="action-title">New Campaign</h3>
                <p class="action-description">Start a new franchise</p>
              </div>
            </GlassCard>

            <GlassCard padding="lg" class="action-card" @click="router.push('/profile')">
              <div class="action-icon profile">
                <Trophy :size="24" />
              </div>
              <div class="action-content">
                <h3 class="action-title">Achievements</h3>
                <p class="action-description">View your stats & trophies</p>
              </div>
            </GlassCard>
          </div>
        </section>

        <!-- Recent Activity -->
        <section class="activity-section">
          <h2 class="section-title">Recent Activity</h2>
          <GlassCard padding="lg" :hoverable="false" class="activity-card">
            <div class="empty-activity">
              <Gamepad2 :size="40" class="empty-icon" />
              <p class="empty-text">No recent activity yet</p>
              <p class="empty-subtext">Start a campaign to begin your journey!</p>
              <BaseButton variant="primary" size="sm" @click="router.push('/campaigns')">
                Get Started
              </BaseButton>
            </div>
          </GlassCard>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.dashboard-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.dashboard-header {
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
  position: sticky;
  top: 0;
  z-index: 40;
  backdrop-filter: blur(12px);
}

.header-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.app-logo {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  background: linear-gradient(135deg, var(--color-primary), var(--color-tertiary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.header-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  border-radius: var(--radius-lg);
  transition: all 0.2s ease;
  background: transparent;
  border: none;
  cursor: pointer;
}

.nav-link:hover {
  color: var(--color-text-primary);
  background: var(--glass-bg);
}

.nav-link.router-link-active {
  color: var(--color-primary);
}

.logout-btn:hover {
  color: #EF4444;
}

/* Main Content */
.dashboard-main {
  flex: 1;
  padding: 2rem 1.5rem;
}

.dashboard-container {
  max-width: 1200px;
  margin: 0 auto;
}

/* Welcome Section */
.welcome-section {
  margin-bottom: 2.5rem;
}

.welcome-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  margin-bottom: 0.5rem;
}

.welcome-subtitle {
  font-size: 1rem;
  color: var(--color-text-secondary);
}

/* Sections */
.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
}

/* Actions */
.actions-section {
  margin-bottom: 2.5rem;
}

.actions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
}

.action-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.action-card:hover {
  transform: translateY(-2px);
}

.action-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xl);
  flex-shrink: 0;
}

.action-icon.continue {
  background: linear-gradient(135deg, var(--color-primary), var(--color-tertiary));
  color: white;
}

.action-icon.new {
  background: linear-gradient(135deg, #10B981, #059669);
  color: white;
}

.action-icon.profile {
  background: var(--gradient-cosmic);
  color: #1a1520;
}

.action-content {
  flex: 1;
}

.action-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.action-description {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

/* Activity Section */
.activity-section {
  margin-bottom: 2rem;
}

.activity-card {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-activity {
  text-align: center;
}

.empty-icon {
  color: var(--color-text-tertiary);
  margin-bottom: 1rem;
}

.empty-text {
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.empty-subtext {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin-bottom: 1.25rem;
}

/* Responsive */
@media (max-width: 768px) {
  .nav-link span {
    display: none;
  }

  .nav-link {
    padding: 0.5rem;
  }

  .welcome-title {
    font-size: 1.5rem;
  }

  .actions-grid {
    grid-template-columns: 1fr;
  }
}
</style>
