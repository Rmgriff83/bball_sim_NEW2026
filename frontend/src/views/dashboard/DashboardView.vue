<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCampaignStore } from '@/stores/campaign'
import { GlassCard, BaseButton } from '@/components/ui'
import { Gamepad2, Plus, User, LogOut, LayoutDashboard, Trophy, ShoppingBag, Crown, CalendarCheck, Globe } from 'lucide-vue-next'
import { useCommunityLink } from '@/composables/useCommunityLink'
import { backfillCampaignAchievements } from '@/engine/campaign/CampaignManager'
import { t } from '@wl-i18n/i18n.js'

const router = useRouter()
const authStore = useAuthStore()
// One-shot fresh-account flag (stamped at registration/social first sign-in):
// consumed synchronously before first render so the greeting never flips.
const isFirstVisit = authStore.consumeFreshAccountFlag()
const { hasCommunity, openCommunity } = useCommunityLink()
const campaignStore = useCampaignStore()
const user = computed(() => authStore.user)

// Aggregated achievement feed across every campaign the user has. Empty
// until campaigns are fetched on mount. Sorted newest-first by the
// achievement's stamped date; capped at 20 so a long-running dynasty
// doesn't push the rest of the page off-screen.
const recentActivity = computed(() => {
  const all = []
  for (const c of (campaignStore.campaigns || [])) {
    if (!Array.isArray(c.achievements)) continue
    for (const ach of c.achievements) {
      all.push({ ...ach, campaignId: c.id, campaignName: c.name })
    }
  }
  all.sort((a, b) => _earnedMs(b) - _earnedMs(a))
  return all.slice(0, 20)
})

// Real-time the achievement was earned. Prefers createdAt (real wall-clock,
// stamped at creation); falls back to the in-game `date` for legacy/backfilled
// entries created before createdAt existed.
function _earnedMs(ach) {
  const t = Date.parse(ach?.createdAt ?? '')
  if (Number.isFinite(t)) return t
  const d = Date.parse(ach?.date ?? '')
  return Number.isFinite(d) ? d : 0
}

const ACHIEVEMENT_ICONS = {
  championship: Trophy,
  conference_championship: Crown,
  playoff_berth: CalendarCheck,
}
function iconFor(type) {
  return ACHIEVEMENT_ICONS[type] || Trophy
}

// Relative-date helper for the feed. Falls back to the raw YYYY-MM-DD if
// the parse fails (shouldn't, but defensive — the stamp is engine-side).
function formatRelative(dateStr) {
  if (!dateStr) return ''
  const ts = Date.parse(dateStr)
  if (!Number.isFinite(ts)) return dateStr
  const elapsedMs = Date.now() - ts
  const day = 86400000
  if (elapsedMs < day) return t('Today')
  if (elapsedMs < 2 * day) return t('Yesterday')
  if (elapsedMs < 7 * day) return t('{n} days ago', { n: Math.floor(elapsedMs / day) })
  if (elapsedMs < 30 * day) return t('{n} weeks ago', { n: Math.floor(elapsedMs / (7 * day)) })
  if (elapsedMs < 365 * day) return t('{n} months ago', { n: Math.floor(elapsedMs / (30 * day)) })
  return t('{n} years ago', { n: Math.floor(elapsedMs / (365 * day)) })
}

function openCampaign(campaignId) {
  router.push(`/campaign/${campaignId}`)
}

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}

onMounted(async () => {
  // Fetch campaigns so the Recent Activity feed populates without forcing
  // a /campaigns trip first.
  try {
    await campaignStore.fetchCampaigns()
  } catch (err) {
    console.warn('[Dashboard] fetchCampaigns failed', err)
    return
  }
  // Backfill achievements for legacy campaigns (idempotent — gated by
  // `campaign.settings.achievementsBackfilled`). Fire-and-forget; the
  // feed re-derives reactively when each campaign saves.
  for (const c of campaignStore.campaigns || []) {
    backfillCampaignAchievements(c.id).then(() => {
      // Re-fetch the touched campaign so the recentActivity computed
      // picks up the newly-derived entries. Cheaper than refetching all.
      return campaignStore.fetchCampaigns()
    }).catch(err => {
      console.warn('[Dashboard] backfill failed for campaign', c.id, err)
    })
  }
})
</script>

<template>
  <div class="dashboard-page">
    <!-- Header -->
    <header class="dashboard-header">
      <div class="header-container">
        <!-- i18n-ignore -->
        <router-link to="/" class="app-logo">BBALL SIM</router-link>

        <nav class="header-nav">
          <router-link to="/campaigns" class="nav-link">
            <LayoutDashboard :size="18" />
            <span>{{ $t('Campaigns') }}</span>
          </router-link>
          <router-link to="/store" class="nav-link">
            <ShoppingBag :size="18" />
            <span>{{ $t('Store') }}</span>
          </router-link>
          <button v-if="hasCommunity" class="nav-link" @click="openCommunity()">
            <Globe :size="18" />
            <span>{{ $t('Community') }}</span>
          </button>
          <router-link to="/profile" class="nav-link">
            <User :size="18" />
            <span>{{ $t('Profile') }}</span>
          </router-link>
          <button @click="handleLogout" class="nav-link logout-btn">
            <LogOut :size="18" />
            <span>{{ $t('Sign Out') }}</span>
          </button>
        </nav>
      </div>
    </header>

    <!-- Main Content -->
    <main class="dashboard-main">
      <div class="dashboard-container">
        <!-- Welcome Section -->
        <div class="welcome-section">
          <h1 class="welcome-title">{{ isFirstVisit ? $t('Welcome, {name}!', { name: user?.username }) : $t('Welcome back, {name}!', { name: user?.username }) }}</h1>
          <p class="welcome-subtitle">{{ isFirstVisit ? $t("Let's build your first dynasty.") : $t('Ready to build your dynasty?') }}</p>
        </div>

        <!-- Quick Actions -->
        <section class="actions-section">
          <h2 class="section-title">{{ $t('Quick Actions') }}</h2>
          <div class="actions-grid">
            <GlassCard padding="lg" class="action-card" role="button" @click="router.push('/campaigns')">
              <div class="action-icon continue">
                <Gamepad2 :size="24" />
              </div>
              <div class="action-content">
                <h3 class="action-title">{{ $t('Continue Playing') }}</h3>
                <p class="action-description">{{ $t('Pick up where you left off') }}</p>
              </div>
            </GlassCard>

            <GlassCard padding="lg" class="action-card" role="button" @click="router.push({ path: '/campaigns', query: { new: '1' } })">
              <div class="action-icon new">
                <Plus :size="24" />
              </div>
              <div class="action-content">
                <h3 class="action-title">{{ $t('New Campaign') }}</h3>
                <p class="action-description">{{ $t('Start a new franchise') }}</p>
              </div>
            </GlassCard>

            <GlassCard padding="lg" class="action-card" role="button" @click="router.push('/profile')">
              <div class="action-icon profile">
                <Trophy :size="24" />
              </div>
              <div class="action-content">
                <h3 class="action-title">{{ $t('Profile') }}</h3>
                <p class="action-description">{{ $t('Edit settings & view badge synergies') }}</p>
              </div>
            </GlassCard>
          </div>
        </section>

        <!-- Recent Activity -->
        <section class="activity-section">
          <h2 class="section-title">{{ $t('Recent Activity') }}</h2>
          <GlassCard padding="lg" :hoverable="false" class="activity-card">
            <div v-if="recentActivity.length === 0" class="empty-activity">
              <Gamepad2 :size="40" class="empty-icon" />
              <p class="empty-text">{{ $t('No recent activity yet') }}</p>
              <p class="empty-subtext">{{ $t('Start a campaign to begin your journey!') }}</p>
              <BaseButton variant="primary" size="sm" @click="router.push('/campaigns')">
                {{ $t('Get Started') }}
              </BaseButton>
            </div>
            <ul v-else class="activity-feed">
              <li
                v-for="ach in recentActivity"
                :key="ach.id"
                class="activity-item"
                :class="`activity-item--${ach.type}`"
                @click="openCampaign(ach.campaignId)"
              >
                <span class="activity-icon" :class="`activity-icon--${ach.type}`">
                  <component :is="iconFor(ach.type)" :size="18" />
                </span>
                <span class="activity-body">
                  <span class="activity-label">{{ $tDynamic(ach.label) }}</span>
                  <span class="activity-meta">{{ ach.campaignName }} · {{ ach.subtitle_tpl ? $tDynamic(ach.subtitle_tpl, ach.subtitle_params) : $tDynamic(ach.subtitle) }}</span>
                </span>
                <span class="activity-time">{{ formatRelative(ach.createdAt || ach.date) }}</span>
              </li>
            </ul>
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
  background: linear-gradient(135deg, var(--color-primary), #F4A259);
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
  background: linear-gradient(135deg, var(--color-primary), #F4A259);
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
  font-weight: 400;
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

/* When a feed exists, stretch the card so the rows have room to breathe;
   when empty the centered empty-state styling above takes over. */
.activity-card:has(.activity-feed) {
  align-items: stretch;
  justify-content: stretch;
}

.activity-feed {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.activity-item {
  display: grid;
  grid-template-columns: 36px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}

.activity-item:hover {
  background: var(--color-bg-hover, rgba(255, 255, 255, 0.06));
  border-color: var(--color-primary);
}

.activity-item:active {
  transform: translateY(1px);
}

.activity-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(124, 58, 237, 0.12);
  color: var(--color-primary);
  flex-shrink: 0;
}

.activity-icon--championship {
  background: rgba(250, 204, 21, 0.16);
  color: #facc15;
}

.activity-icon--conference_championship {
  background: rgba(168, 85, 247, 0.16);
  color: #a855f7;
}

.activity-icon--playoff_berth {
  background: rgba(56, 189, 248, 0.16);
  color: #38bdf8;
}

.activity-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.activity-label {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.activity-meta {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.activity-time {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
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
