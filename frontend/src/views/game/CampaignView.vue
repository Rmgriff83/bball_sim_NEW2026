<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const campaignStore = useCampaignStore()
const authStore = useAuthStore()

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const team = computed(() => campaign.value?.team)

const mobileMenuOpen = ref(false)

onMounted(async () => {
  if (!campaign.value || campaign.value.id !== campaignId.value) {
    await campaignStore.fetchCampaign(campaignId.value)
  }
})

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function closeMobileMenu() {
  mobileMenuOpen.value = false
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Campaign Header -->
    <header class="campaign-header">
      <div class="header-content">
        <!-- Left: Logo & Team -->
        <div class="header-left">
          <router-link to="/campaigns" class="logo-link">
            <span class="logo-text">BBALL SIM</span>
          </router-link>
          <div v-if="team" class="team-badge">
            <div
              class="team-icon"
              :style="{ backgroundColor: team.primary_color || '#7c3aed' }"
            >
              {{ team.abbreviation }}
            </div>
            <span class="team-name">{{ team.name }}</span>
          </div>
        </div>

        <!-- Center: Navigation -->
        <nav class="desktop-nav">
          <router-link
            :to="`/campaign/${campaignId}`"
            class="nav-link"
            :class="{ active: route.name === 'campaign-home' }"
          >
            Home
          </router-link>
          <router-link
            :to="`/campaign/${campaignId}/team`"
            class="nav-link"
            :class="{ active: route.name === 'team-management' }"
          >
            Roster
          </router-link>
          <router-link
            :to="`/campaign/${campaignId}/league`"
            class="nav-link"
            :class="{ active: route.name === 'league' }"
          >
            League
          </router-link>
        </nav>

        <!-- Right: User Actions -->
        <div class="header-right">
          <router-link to="/campaigns" class="nav-link-secondary">
            All Campaigns
          </router-link>
          <button class="logout-btn" @click="handleLogout">
            Sign Out
          </button>
        </div>

        <!-- Mobile Menu Button -->
        <button class="mobile-menu-btn" @click="toggleMobileMenu">
          <span class="menu-icon" :class="{ open: mobileMenuOpen }">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>
      </div>

      <!-- Mobile Navigation -->
      <div class="mobile-nav" :class="{ open: mobileMenuOpen }">
        <router-link
          :to="`/campaign/${campaignId}`"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          Home
        </router-link>
        <router-link
          :to="`/campaign/${campaignId}/team`"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          Roster
        </router-link>
        <router-link
          :to="`/campaign/${campaignId}/league`"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          League
        </router-link>
        <hr class="mobile-divider" />
        <router-link
          to="/campaigns"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          All Campaigns
        </router-link>
        <button class="mobile-nav-link logout" @click="handleLogout">
          Sign Out
        </button>
      </div>
    </header>

    <!-- Main Content -->
    <main class="campaign-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.campaign-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(15, 15, 20, 0.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 20px;
}

.logo-link {
  text-decoration: none;
}

.logo-text {
  font-size: 1.25rem;
  font-weight: 800;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.team-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.team-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
}

.team-name {
  font-weight: 600;
  font-size: 0.9rem;
}

.desktop-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-link {
  padding: 8px 16px;
  border-radius: 8px;
  color: var(--color-secondary);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.nav-link:hover {
  color: white;
  background: rgba(255, 255, 255, 0.05);
}

.nav-link.active {
  color: white;
  background: var(--color-primary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.nav-link-secondary {
  color: var(--color-secondary);
  text-decoration: none;
  font-size: 0.875rem;
  transition: color 0.2s ease;
}

.nav-link-secondary:hover {
  color: white;
}

.logout-btn {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--color-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.logout-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.mobile-menu-btn {
  display: none;
  padding: 8px;
  background: none;
  border: none;
  cursor: pointer;
}

.menu-icon {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 24px;
}

.menu-icon span {
  display: block;
  height: 2px;
  background: white;
  border-radius: 1px;
  transition: all 0.3s ease;
}

.menu-icon.open span:nth-child(1) {
  transform: translateY(7px) rotate(45deg);
}

.menu-icon.open span:nth-child(2) {
  opacity: 0;
}

.menu-icon.open span:nth-child(3) {
  transform: translateY(-7px) rotate(-45deg);
}

.mobile-nav {
  display: none;
  flex-direction: column;
  padding: 0 24px 24px;
  gap: 4px;
}

.mobile-nav.open {
  display: flex;
}

.mobile-nav-link {
  display: block;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  color: var(--color-secondary);
  text-decoration: none;
  font-weight: 500;
  transition: all 0.2s ease;
  border: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.mobile-nav-link:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.mobile-nav-link.logout {
  color: var(--color-error);
}

.mobile-divider {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 8px 0;
}

.campaign-main {
  max-width: 1400px;
  margin: 0 auto;
}

@media (max-width: 768px) {
  .header-content {
    padding: 12px 16px;
  }

  .desktop-nav,
  .header-right {
    display: none;
  }

  .mobile-menu-btn {
    display: block;
  }

  .team-badge {
    display: none;
  }
}
</style>
