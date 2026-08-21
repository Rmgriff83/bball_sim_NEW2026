<script setup>
import { computed, onMounted, ref, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useGameStore } from '@/stores/game'
import { useAuthStore } from '@/stores/auth'
import { useEngineStore } from '@/stores/engine'
import { useSyncStore } from '@/stores/sync'
import { usePlayoffStore } from '@/stores/playoff'
import { useTeamStore } from '@/stores/team'
import { useToastStore } from '@/stores/toast'
import { BottomNav } from '@/components/ui'
import SimPauseModal from '@/components/calendar/SimPauseModal.vue'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { ArrowLeft, Play, User, FolderOpen, LogOut, ShoppingBag, Globe } from 'lucide-vue-next'
import { useCommunityLink } from '@/composables/useCommunityLink'
import { t, dateLocale } from '@wl-i18n/i18n.js'

const route = useRoute()
const router = useRouter()
const campaignStore = useCampaignStore()
const gameStore = useGameStore()
const authStore = useAuthStore()
const engineStore = useEngineStore()
const syncStore = useSyncStore()
const playoffStore = usePlayoffStore()
const teamStore = useTeamStore()
const toastStore = useToastStore()
const { hasCommunity, openCommunity } = useCommunityLink()

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const team = computed(() => campaign.value?.team)

const scoutingPoints = computed(() => {
  return campaign.value?.settings?.scoutingPoints ?? 0
})

// Player training "claim ready" indicator. Drives a small dot on the GM
// View nav link so the user knows a reward is waiting without having to
// open the modal. Re-evaluates every 30s via the _trainingClockTick ref
// below — keeps the predicate live without a hard refresh.
const _trainingClockTick = ref(Date.now())
let _trainingClockHandle = null
const trainingReadyForClaim = computed(() => {
  void _trainingClockTick.value
  const t = teamStore.coach?.activeTraining
  if (!t?.endsAt) return false
  return new Date(t.endsAt).getTime() <= Date.now()
})
onMounted(() => {
  if (_trainingClockHandle == null) {
    _trainingClockHandle = setInterval(() => { _trainingClockTick.value = Date.now() }, 30 * 1000)
  }
})
onUnmounted(() => {
  if (_trainingClockHandle != null) {
    clearInterval(_trainingClockHandle)
    _trainingClockHandle = null
  }
})

// Scouting stays available through the postseason and the entire offseason —
// including the free-agency window AND the draft phase itself, since that's
// exactly when prospects matter and the user wants to spend scout points right
// before drafting. It's only hidden once THIS offseason's rookie draft is
// completed, reopening when the next regular season starts. Mirrors BottomNav.
const hideScout = computed(() => {
  const c = campaign.value
  const gameYear = c?.gameYear ?? 1
  return c?.[`rookieDraftCompleted_${gameYear}`] === true
})

// No games are playable during the offseason — hide the Play nav link there.
const isOffseason = computed(() => {
  const c = campaign.value
  const phase = c?.settings?.season_phase ?? c?.settings?.seasonPhase ?? c?.phase ?? 'regular_season'
  return phase === 'offseason' || phase === 'offseason_free_agency' || phase === 'offseason_draft'
})

// Some child routes (the headshot editor) provide their own bottom nav, so
// the main one needs to step aside. Driven by route meta so adding more such
// routes later is one-line.
const hideBottomNav = computed(() =>
  route.matched.some(r => r.meta?.hideBottomNav)
)

// Parse a date string (YYYY-MM-DD or datetime) into a local Date, avoiding UTC shift
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('T')[0].split(' ')[0].split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Current in-game date for mobile header — uses campaign current_date
const formattedCurrentDate = computed(() => {
  const dateStr = campaign.value?.current_date
  if (!dateStr) return null
  const date = parseLocalDate(dateStr)
  return {
    weekday: date.toLocaleDateString(dateLocale(), { weekday: 'short' }),
    month: date.toLocaleDateString(dateLocale(), { month: 'short' }),
    day: date.getDate(),
    year: date.getFullYear()
  }
})

const mobileMenuOpen = ref(false)
const isMobile = ref(window.innerWidth < 1024)
const mobileMenuRef = ref(null)
const mobileMenuBtnRef = ref(null)

function handleResize() {
  isMobile.value = window.innerWidth < 1024
}

function handleClickOutside(e) {
  if (
    mobileMenuRef.value && !mobileMenuRef.value.contains(e.target) &&
    mobileMenuBtnRef.value && !mobileMenuBtnRef.value.contains(e.target)
  ) {
    closeMobileMenu()
  }
}

function handleScroll() {
  if (mobileMenuOpen.value) {
    closeMobileMenu()
  }
}

watch(mobileMenuOpen, (open) => {
  if (open) {
    document.addEventListener('click', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
  } else {
    document.removeEventListener('click', handleClickOutside)
    window.removeEventListener('scroll', handleScroll, true)
  }
})

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  if (!campaign.value || campaign.value.id !== campaignId.value) {
    await campaignStore.fetchCampaign(campaignId.value)
  }

  // Redirect to the Custom Roster editor if setup is incomplete. Takes
  // precedence over the fantasy-draft redirect so a custom+fantasy campaign
  // authors its rosters/pool first, then proceeds to the draft on finalize.
  // Legacy saves lack `customRoster` (falsy) → no redirect. The headshot-editor
  // child routes are exempt so the roster editor can hand off to them mid-setup
  // (they return the user straight back to /roster-setup).
  const headshotRoutes = ['headshot-editor', 'coach-headshot-editor', 'personnel-headshot-editor']
  const inHeadshotEditor = headshotRoutes.includes(route.name)
  if (!inHeadshotEditor
      && (campaign.value?.customRoster ?? campaign.value?.custom_roster)
      && !(campaign.value?.rosterSetupCompleted ?? campaign.value?.roster_setup_completed)) {
    router.replace(`/campaign/${campaignId.value}/roster-setup`)
    return
  }

  // Redirect to draft room if fantasy draft is incomplete
  if (campaign.value?.draft_mode === 'fantasy' && !campaign.value?.draft_completed) {
    router.replace(`/campaign/${campaignId.value}/draft`)
    return
  }

  // Initialize the simulation engine for this campaign
  await engineStore.initialize(campaignId.value)

  // Start cloud sync triggers and push if dirty (e.g. just created).
  // Cooldown-guarded: repeated campaign mounts (especially while offline)
  // must not each fire a full push attempt — the just-created initial push
  // is already handled by createCampaign's own syncNow.
  syncStore.setActiveCampaign(campaignId.value)
  syncStore.startAutoSync()
  if (syncStore.hasPendingChanges) {
    syncStore.requestSync()
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('scroll', handleScroll, true)
  engineStore.teardown()

  // Stop sync timer and push any pending changes on route leave
  syncStore.stopAutoSync()
  syncStore.syncOnRouteLeave()
})

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}

// ---------------------------------------------------------------------------
// Sim Pause Modal handlers
// ---------------------------------------------------------------------------
// SimPauseModal is mounted at the campaign-layout level (here) so it surfaces
// during simulateToGame regardless of which child route the user is on. The
// all_star variant of the modal now renders both All-Star and Rising Stars
// rosters internally via a tab switch — no secondary AllStarModal mount.

async function handleSimPauseContinue() {
  // If this pause was the All-Star break, persist the "viewed" flag so the
  // home view's post-sim All-Star check doesn't re-pop the modal next time
  // the user lands there. Mirrors what the old secondary-modal close handler
  // used to do.
  if (gameStore.pauseState?.reason === 'all_star') {
    try {
      const camp = campaignStore.currentCampaign
      const year = camp?.currentSeasonYear ?? camp?.game_year ?? 2025
      const seasonData = await SeasonRepository.get(campaignId.value, year)
      if (seasonData) {
        seasonData.allStarViewed = true
        await SeasonRepository.save(seasonData)
      }
    } catch (err) {
      console.error('Failed to mark All-Star as viewed:', err)
    }
  }
  try {
    await gameStore.resumeSimulation()
  } catch (err) {
    console.error('Failed to resume sim:', err)
    toastStore.showError(t('Failed to resume simulation'))
  }
}

function handleSimPausePause() {
  gameStore.cancelSimulation()
}

async function handleSimPauseCpuLineup() {
  try {
    const [{ selectBestLineup }, { generateRoleAwareTargetMinutes }] = await Promise.all([
      import('@/engine/ai/AILineupService'),
      import('@/engine/simulation/SubstitutionEngine'),
    ])
    const roster = teamStore.roster
    if (!roster || roster.length < 5) {
      toastStore.showError(t('Roster too small to set lineup'))
      gameStore.cancelSimulation()
      return
    }
    // selectBestLineup returns an array of 5 player IDs (PG..C order), or
    // entries may be null if a position can't be filled.
    const newLineup = selectBestLineup(roster)
    if (!Array.isArray(newLineup) || newLineup.length !== 5) {
      toastStore.showError(t('CPU could not pick a lineup'))
      gameStore.cancelSimulation()
      return
    }
    await teamStore.updateLineup(campaignId.value, newLineup, [])

    // Distribute 240 minutes per the team's substitution strategy.
    const strategy = teamStore.team?.coaching_scheme?.substitution || 'staggered'
    const newStarterIds = newLineup.filter(id => id !== null)
    const newMinutes = generateRoleAwareTargetMinutes(roster, newStarterIds, strategy)
    await teamStore.updateTargetMinutes(campaignId.value, newMinutes)
    toastStore.showSuccess(t('Lineup updated by CPU'))
  } catch (err) {
    console.error('CPU lineup pick failed:', err)
    toastStore.showError(t('Failed to set CPU lineup'))
  }
  // Resume the sim regardless of CPU result — user already chose to keep going.
  try {
    await gameStore.resumeSimulation()
  } catch (err) {
    console.error('Failed to resume sim after CPU lineup:', err)
  }
}

function handleSimPauseGoToLineup() {
  // Send the user to the GM tab to fix the lineup; cancel the run so they can
  // re-launch Sim to This Game whenever they're ready.
  gameStore.cancelSimulation()
  router.push(`/campaign/${campaignId.value}/team`)
}

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function closeMobileMenu() {
  mobileMenuOpen.value = false
}
</script>

<template>
  <div class="campaign-layout">
    <!-- Campaign Header - Minimal on mobile, full on desktop -->
    <header class="campaign-header" :class="{ 'mobile-minimal': isMobile }">
      <div class="header-content">
        <!-- Left: Back + Team Badge (Back hidden on mobile) -->
        <div class="header-left">
          <router-link v-if="!isMobile" to="/campaigns" class="back-link">
            <ArrowLeft :size="20" />
          </router-link>
          <div v-if="team && !isMobile" class="team-badge">
            <div class="team-icon" :style="{ backgroundColor: team.primary_color || '#E85A4F' }">
              {{ team.abbreviation }}
            </div>
          </div>
        </div>

        <!-- Center: Navigation (Desktop only) -->
        <nav v-if="!isMobile" class="desktop-nav" data-tour="home-top-nav">
          <router-link
            :to="`/campaign/${campaignId}`"
            class="nav-link"
            :class="{ active: route.name === 'campaign-home' }"
          >
            {{ $t('Home') }}
          </router-link>
          <router-link
            :to="`/campaign/${campaignId}/team`"
            class="nav-link nav-link-gm"
            :class="{ active: route.name === 'team-management' }"
            data-tour="nav-gm-view"
          >
            {{ $t('GM View') }}
            <span v-if="trainingReadyForClaim" class="train-ready-dot" :title="$t('Player training ready to claim')"></span>
          </router-link>
          <router-link
            :to="`/campaign/${campaignId}/league`"
            class="nav-link"
            :class="{ active: route.name === 'league' }"
          >
            {{ $t('League') }}
          </router-link>
          <router-link
            v-if="playoffStore.isInPlayoffs"
            :to="`/campaign/${campaignId}/playoffs`"
            class="nav-link"
            :class="{ active: route.name === 'playoffs' }"
          >
            {{ $t('Playoffs') }}
          </router-link>
          <router-link
            v-if="!hideScout"
            :to="`/campaign/${campaignId}/scouting`"
            class="nav-link nav-link-scout"
            :class="{ active: route.name === 'scouting' }"
            data-tour="nav-scout"
          >
            {{ $t('Scout') }}
            <span v-if="scoutingPoints > 0" class="scout-pts-badge">{{ scoutingPoints }}</span>
          </router-link>
          <router-link
            v-if="!isOffseason"
            :to="`/campaign/${campaignId}/play`"
            class="nav-link nav-link-play"
            :class="{ active: route.name === 'game' || route.name === 'play' }"
            data-tour="nav-play"
          >
            <Play :size="16" fill="currentColor" />
            {{ $t('Play') }}
          </router-link>
        </nav>

        <!-- Right: User Actions (Desktop) -->
        <div v-if="!isMobile" class="header-right">
          <button v-if="hasCommunity" class="header-icon-btn" :title="$t('Community Rosters')" @click="openCommunity()">
            <Globe :size="16" />
          </button>
          <router-link to="/store" class="header-icon-btn" :title="$t('Store')">
            <ShoppingBag :size="16" />
          </router-link>
          <router-link to="/profile" class="header-icon-btn" :title="$t('Profile')">
            <User :size="16" />
          </router-link>
          <button class="header-icon-btn" @click="handleLogout" :title="$t('Sign Out')">
            <LogOut :size="16" />
          </button>
        </div>

        <!-- Mobile: Date + Menu Button. Hidden on routes that opt out of the
             bottom nav (the headshot editor is full-screen on mobile and its
             own header carries the back/save controls) so the campaign chrome
             doesn't compete with the editor's UI. -->
        <div v-if="isMobile && !hideBottomNav" class="mobile-header-right">
          <div v-if="formattedCurrentDate" class="current-date-mobile" data-tour="home-date-mobile">
            <span class="date-day">{{ formattedCurrentDate.day }}</span>
            <div class="date-details">
              <span class="date-month">{{ formattedCurrentDate.month }}</span>
              <span class="date-weekday">{{ formattedCurrentDate.weekday }}</span>
            </div>
          </div>
          <button ref="mobileMenuBtnRef" class="mobile-menu-btn" @click="toggleMobileMenu">
            <span class="menu-icon" :class="{ open: mobileMenuOpen }">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </button>
        </div>
      </div>

      <!-- Mobile Navigation Slide-in -->
      <div v-if="isMobile" ref="mobileMenuRef" class="mobile-nav" :class="{ open: mobileMenuOpen }">
        <button
          v-if="hasCommunity"
          class="mobile-nav-link"
          @click="closeMobileMenu(); openCommunity()"
        >
          <Globe :size="14" />
          {{ $t('Community') }}
        </button>
        <router-link
          to="/store"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          <ShoppingBag :size="14" />
          {{ $t('Store') }}
        </router-link>
        <router-link
          to="/profile"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          <User :size="14" />
          {{ $t('Profile') }}
        </router-link>
        <router-link
          to="/campaigns"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          <FolderOpen :size="14" />
          {{ $t('Campaigns') }}
        </router-link>
        <button class="mobile-nav-link logout" @click="handleLogout">
          <LogOut :size="14" />
          {{ $t('Sign Out') }}
        </button>
      </div>
    </header>

    <!-- Main Content -->
    <main class="campaign-main">
      <router-view />
    </main>

    <!-- Bottom Nav - Mobile/Tablet only -->
    <BottomNav v-if="isMobile && !hideBottomNav" :campaign-id="campaignId" />

    <!-- Sim Pause Modal — global across all campaign sub-routes. Shown whenever
         simulateToGame halts (All-Star, user injury). The trade-deadline
         variant is handled by BreakingNewsModal in App.vue instead (single
         modal carrying the news article AND the Pause/Continue buttons),
         so we explicitly skip this modal for that reason. -->
    <SimPauseModal
      :show="gameStore.simulationPaused && gameStore.pauseState?.reason !== 'trade_deadline'"
      :reason="gameStore.pauseState?.reason || ''"
      :payload="gameStore.pauseState?.payload || {}"
      @continue="handleSimPauseContinue"
      @pause="handleSimPausePause"
      @close="handleSimPausePause"
      @cpu-set-lineup="handleSimPauseCpuLineup"
      @go-to-lineup="handleSimPauseGoToLineup"
    />
  </div>
</template>

<style scoped>
.campaign-layout {
  min-height: 100vh;
  overflow-x: clip;
}

.campaign-header {
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
  position: relative;
}

/* Nebula effect for header */
.campaign-header::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.05) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

[data-theme="light"] .campaign-header::before {
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.08) 0%, transparent 40%);
}

.campaign-header.mobile-minimal {
  background: transparent;
  border-bottom: none;
}

.campaign-header.mobile-minimal::before {
  display: none;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  max-width: 1400px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: var(--color-text-secondary);
  background: var(--color-bg-tertiary);
  transition: all 0.2s ease;
}

.back-link:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.team-badge {
  display: flex;
  align-items: center;
  gap: 10px;
}

.team-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: white;
}

.team-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.desktop-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  color: var(--color-text-secondary);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.nav-link:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-tertiary);
}

.nav-link.active {
  color: white;
  background: var(--color-primary);
}

.nav-link-scout {
  position: relative;
}

.nav-link-gm {
  position: relative;
}

/* "Training ready" dot — small accent on the GM View nav link when the
   user's active player-training session has completed. Mirrors the
   scout-pts-badge positioning but as a single green pulse dot since
   there's only ever one active training at a time. */
.train-ready-dot {
  display: inline-block;
  margin-left: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.25);
  vertical-align: middle;
}

.scout-pts-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--gradient-cosmic);
  color: black;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

.nav-link-scout.active .scout-pts-badge {
  background: rgba(255, 255, 255, 0.25);
  color: white;
}

.nav-link-play {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-primary);
  font-weight: 600;
}

.nav-link-play:hover {
  background: transparent;
  color: var(--color-primary);
}

.nav-link-play.active {
  background: transparent;
  color: var(--color-primary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  color: var(--color-text-secondary);
  text-decoration: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.header-icon-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.mobile-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.current-date-mobile {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.current-date-mobile .date-day {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  line-height: 1;
  color: var(--color-primary);
}

.current-date-mobile .date-details {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.current-date-mobile .date-month {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  line-height: 1.2;
}

.current-date-mobile .date-weekday {
  font-size: 0.6rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  line-height: 1.2;
}

.mobile-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: var(--color-bg-tertiary);
  border: none;
  border-radius: 10px;
  cursor: pointer;
}

.menu-icon {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 18px;
}

.menu-icon span {
  display: block;
  height: 2px;
  background: var(--color-text-primary);
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
  position: absolute;
  top: 100%;
  right: 0;
  width: max-content;
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 2px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: 0 0 0 8px;
  z-index: 50;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-8px);
  transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease;
  pointer-events: none;
}

.mobile-nav.open {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
  pointer-events: auto;
}

@media (max-width: 400px) {
  .mobile-nav {
    width: 33%;
  }
}

.mobile-nav-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 8px;
  background: transparent;
  border-radius: 6px;
  color: var(--color-text-secondary);
  text-decoration: none;
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.15s ease;
  border: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.mobile-nav-link svg {
  min-width:14px;
}

.mobile-nav-link:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.mobile-nav-link.logout {
  color: var(--color-error);
}

.campaign-main {
  max-width: 1400px;
  margin: -40px auto 0;
}

@media (min-width: 1024px) {
  .campaign-main {
    margin-top: 0;
  }

  .campaign-header {
    position: sticky;
    top: 0;
    z-index: 40;
  }
}

@media (max-width: 1023px) {
  .header-content {
    padding: 12px 16px;
  }
}
</style>
