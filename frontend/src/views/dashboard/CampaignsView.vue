<script setup>
import { ref, computed, onMounted, watch, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useAuthStore } from '@/stores/auth'
import { useAudioStore } from '@/stores/audio'
import { useWalkthroughStore } from '@/stores/walkthrough'
import { GlassCard, BaseButton, LoadingSpinner } from '@/components/ui'
import HasPlayedBeforeModal from '@/components/walkthrough/HasPlayedBeforeModal.vue'
import HeadshotEditorPromoModal from '@/components/store/HeadshotEditorPromoModal.vue'
import { shouldShowPromo, markPromoShown } from '@/services/promoGate'
import { Plus, X, LayoutDashboard, User, LogOut, Calendar, ChevronRight, AlertCircle, Trash2, Trophy, Star, Medal } from 'lucide-vue-next'
import { gmLevelLabel, gmLevelColor } from '@/engine/data/gmLevels'
import CoachAvatar from '@/components/common/CoachAvatar.vue'
import TeamPicker from '@/components/team/TeamPicker.vue'
import OwnerQuickInfo from '@/components/team/OwnerQuickInfo.vue'
import { findCoachForTeam } from '@/engine/data/coaches'
import { coachBadges } from '@/engine/data/coachBadges'

const router = useRouter()
const route = useRoute()
const campaignStore = useCampaignStore()
const authStore = useAuthStore()
const audio = useAudioStore()
const walkthroughStore = useWalkthroughStore()

// After a new campaign is created we ask "have you played before?" — the answer
// gates the onboarding walkthroughs — then navigate into the campaign.
const showPlayedBeforeModal = ref(false)
const pendingNavigation = ref(null)

// Team-rename is bundled into the headshot_editor IAP so it's gated by the
// same feature flag as the headshot customize tools. Locked users see the
// input disabled with an upgrade prompt below it.
const canRenameTeam = computed(() => authStore.hasFeature('headshot_editor'))

// The user's career GM Level (profile-global) — surfaced in the create modal so
// they know which Strong/Elite franchises they can sign with before picking.
const gmLevelBadge = computed(() => ({
  label: gmLevelLabel(authStore.gmLevel),
  color: gmLevelColor(authStore.gmLevel),
  // Dark text reads better on the lighter gold/platinum/silver tiers.
  text: authStore.gmLevel >= 2 ? '#15171c' : '#ffffff',
}))

function handlePlayedBeforeAnswer(playedBefore) {
  walkthroughStore.setHasPlayedBefore(playedBefore)
  showPlayedBeforeModal.value = false
  const target = pendingNavigation.value
  pendingNavigation.value = null
  if (target) router.push(target)
}

function openCampaign(id) {
  // Campaign cards are divs (not buttons), so the global click listener won't
  // tap them — play the generic tap explicitly.
  audio.navigate()
  router.push(`/campaign/${id}`)
}

const showCreateModal = ref(false)
const newCampaignName = ref('')
const selectedTeam = ref(null)
const customTeamName = ref('')
const selectedDraftMode = ref('standard')
const creating = ref(false)
const createError = ref(null)

const MAX_CAMPAIGNS = 4
const confirmDeleteId = ref(null)
const deleting = ref(false)

const draftModes = [
  { value: 'standard', label: 'Standard', description: 'Teams come with pre-built rosters' },
  { value: 'fantasy', label: 'Fantasy Draft', description: 'Draft all players from scratch' },
]

const difficulties = [
  { value: 'rookie', label: 'Rookie', description: 'Easier gameplay, higher success rates' },
  { value: 'pro', label: 'Pro', description: 'Balanced experience (Recommended)' },
  { value: 'all_star', label: 'All-Star', description: 'Challenging gameplay' },
  { value: 'hall_of_fame', label: 'Hall of Fame', description: 'Expert difficulty' },
]

// --- Team-preview helpers (facilities tier + set coach) -------------------
// Facilities live on the static TEAMS data and are copied verbatim into the
// campaign, so previewing them here matches exactly what the campaign gets.
const FACILITY_KEYS = ['training', 'medical', 'scouting', 'analytics']
const FACILITY_SHORT = { training: 'TRN', medical: 'MED', scouting: 'SCT', analytics: 'ANL' }
const COACH_ATTR_ORDER = ['offensiveIQ', 'defensiveIQ', 'playerDevelopment', 'strictness', 'gameManagement']
const COACH_ATTR_ABBR = { offensiveIQ: 'OFF', defensiveIQ: 'DEF', playerDevelopment: 'DEV', strictness: 'STR', gameManagement: 'MGT' }
const COACH_BADGE_TIER_COLORS = { bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700', hof: '#9333EA' }

// The team's set coach (deterministic identity + authored overall/attributes/badges).
function coachFor(team) {
  return team ? findCoachForTeam(team.abbreviation) : null
}
const selectedCoach = computed(() => coachFor(selectedTeam.value))
function coachBadgeName(id) {
  return coachBadges.find(b => b.id === id)?.name ?? id
}
function coachBadgeDesc(badge) {
  const def = coachBadges.find(b => b.id === badge.id)
  return def ? `${def.name} — ${def.description} (${(badge.level || 'bronze').toUpperCase()})` : badge.id
}
function getAttrColor(value) {
  if (value >= 90) return 'var(--color-success)'
  if (value >= 80) return '#22D3EE'
  if (value >= 70) return 'var(--color-primary)'
  if (value >= 60) return 'var(--color-warning)'
  return 'var(--color-error)'
}

onMounted(async () => {
  await campaignStore.fetchCampaigns()
  await campaignStore.fetchAvailableTeams()

  // Auto-open the create modal when arriving from the dashboard's
  // "New Campaign" card (e.g. /campaigns?new=1). Strip the query after so a
  // refresh or back/forward doesn't keep reopening it.
  if (route.query.new === '1') {
    openCreateModal()
    router.replace({ path: route.path, query: { ...route.query, new: undefined } })
  } else {
    maybeShowHeadshotPromo()
  }
})

// Weekly Headshot Editor upsell. Non-invasive by construction: never shown to
// owners, never to brand-new users (no campaigns yet), never over the
// create-flow or onboarding modals, and at most once per 7 days per user
// (stamped at SHOW time, so any dismissal counts as this week's showing).
const showHeadshotPromo = ref(false)

function maybeShowHeadshotPromo() {
  if (authStore.hasFeature('headshot_editor')) return
  if (!campaignStore.campaigns.length) return
  if (showCreateModal.value || showPlayedBeforeModal.value) return
  const uid = authStore.user?.id
  if (!shouldShowPromo(uid, 'headshotEditor')) return
  markPromoShown(uid, 'headshotEditor')
  showHeadshotPromo.value = true
}

function goToStorePurchase() {
  showHeadshotPromo.value = false
  router.push({ name: 'store', query: { buy: 'headshot_editor_unlock' } })
}

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}

function openCreateModal() {
  if (campaignStore.campaigns.length >= MAX_CAMPAIGNS) {
    createError.value = `Maximum of ${MAX_CAMPAIGNS} campaigns reached. Delete an existing campaign to create a new one.`
    return
  }
  createError.value = null
  showCreateModal.value = true
  newCampaignName.value = ''
  selectedTeam.value = null
  customTeamName.value = ''
  selectedDraftMode.value = 'standard'
  document.body.style.overflow = 'hidden'
}

function requestDelete(campaignId, event) {
  event.stopPropagation()
  // stopPropagation prevents the global click-sound listener from firing,
  // so re-add the generic tap explicitly.
  audio.navigate()
  confirmDeleteId.value = campaignId
}

function cancelDelete(event) {
  if (event) event.stopPropagation()
  audio.navigate()
  confirmDeleteId.value = null
}

async function confirmDelete(event) {
  if (event) event.stopPropagation()
  if (!confirmDeleteId.value) return

  // Destructive action — play the cancel/negative SFX. The audio store's
  // cancel() also suppresses the global click-sound for this event.
  audio.cancel()

  deleting.value = true
  try {
    await campaignStore.deleteCampaign(confirmDeleteId.value)
    createError.value = null // Clear any "max campaigns" error
  } catch (err) {
    console.error('Failed to delete campaign:', err)
  } finally {
    confirmDeleteId.value = null
    deleting.value = false
  }
}

function closeCreateModal() {
  showCreateModal.value = false
  document.body.style.overflow = ''
}

function handleKeydown(e) {
  if (e.key === 'Escape' && showCreateModal.value) {
    closeCreateModal()
  }
}

watch(showCreateModal, (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeydown)
})

async function createCampaign() {
  if (!selectedTeam.value) {
    createError.value = 'Please select a team'
    return
  }

  creating.value = true
  createError.value = null
  audio.suppressClickSound() // affirmation on success instead of the generic tap

  try {
    // Belt-and-suspenders gate: drop any custom team name if the user
    // doesn't have the headshot_editor IAP. The input is disabled in the
    // template, but a stale value (e.g. typed before the flag was checked
    // or restored from form state) would otherwise sneak through.
    const renamedTeam = canRenameTeam.value ? customTeamName.value.trim() : ''
    const effectiveTeamName = renamedTeam || selectedTeam.value.name
    const campaignName = newCampaignName.value.trim() || `${effectiveTeamName} Dynasty`
    const payload = {
      name: campaignName,
      team_abbreviation: selectedTeam.value.abbreviation,
      // Difficulty is locked at All-Star for all new campaigns. The picker
      // was removed from the create modal so users can't stack tokens on a
      // Rookie campaign to spend elsewhere; the engine's per-difficulty
      // development/regression curves only kick in from this single setting.
      difficulty: 'all_star',
    }
    if (renamedTeam) {
      payload.custom_team_name = renamedTeam
    }
    if (selectedDraftMode.value === 'fantasy') {
      payload.draft_mode = 'fantasy'
    }

    const campaign = await campaignStore.createCampaign(payload)

    audio.affirm()
    closeCreateModal()
    // Defer navigation until the user answers "have you played before?".
    pendingNavigation.value = selectedDraftMode.value === 'fantasy'
      ? `/campaign/${campaign.id}/draft`
      : `/campaign/${campaign.id}`
    showPlayedBeforeModal.value = true
  } catch (err) {
    createError.value = err.message || 'Failed to create campaign'
  } finally {
    creating.value = false
  }
}

function formatDate(dateString) {
  if (!dateString) return 'Never'
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function getDifficultyLabel(value) {
  return difficulties.find(d => d.value === value)?.label || value
}
</script>

<template>
  <div class="campaigns-page">
    <!-- Header -->
    <header class="campaigns-header">
      <div class="header-container">
        <router-link to="/dashboard" class="app-logo">BBALL SIM</router-link>
        <nav class="header-nav">
          <router-link to="/dashboard" class="nav-link">
            <LayoutDashboard :size="18" />
            <span>Dashboard</span>
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
    <main class="campaigns-main">
      <div class="campaigns-container">
        <!-- Page Header -->
        <div class="page-header">
          <div>
            <h1 class="page-title">Your Campaigns</h1>
            <p class="page-subtitle">Manage your basketball franchises</p>
          </div>
          <BaseButton variant="primary" class="btn-cosmic" @click="openCreateModal">
            <Plus :size="18" />
            New Campaign
          </BaseButton>
        </div>

        <!-- Loading State -->
        <div v-if="campaignStore.loading" class="loading-state">
          <LoadingSpinner size="lg" />
        </div>

        <!-- Empty State -->
        <div v-else-if="campaignStore.campaigns.length === 0" class="empty-state">
          <GlassCard padding="xl" class="empty-card" :hoverable="false">
            <div class="empty-content">
              <div class="empty-icon-wrapper">
                <Plus :size="32" />
              </div>
              <h3 class="empty-title">No Campaigns Yet</h3>
              <p class="empty-description">Start your first franchise and build a dynasty!</p>
              <BaseButton variant="primary" @click="openCreateModal">
                Create Your First Campaign
              </BaseButton>
            </div>
          </GlassCard>
        </div>

        <!-- Campaign limit error -->
        <div v-if="createError && !showCreateModal" class="limit-error">
          <AlertCircle :size="16" />
          <span>{{ createError }}</span>
        </div>

        <!-- Campaigns Grid -->
        <div v-if="!campaignStore.loading && campaignStore.campaigns.length > 0" class="campaigns-grid">
          <GlassCard
            v-for="campaign in campaignStore.campaigns"
            :key="campaign.id"
            padding="lg"
            class="campaign-card"
            @click="openCampaign(campaign.id)"
          >
            <div class="campaign-header">
              <div class="campaign-info">
                <h3 class="campaign-name">{{ campaign.team?.name || campaign.name }}</h3>
                <div class="campaign-team-row">
                  <p class="campaign-team">Overall Record</p>
                  <span
                    v-if="campaign.team?.allTimeRecord"
                    class="campaign-team-record"
                    :title="`Overall record: ${campaign.team.allTimeRecord.wins}-${campaign.team.allTimeRecord.losses}`"
                  >
                    {{ campaign.team.allTimeRecord.wins }}-{{ campaign.team.allTimeRecord.losses }}
                  </span>
                </div>
              </div>
              <div class="campaign-header-actions">
                <button
                  class="delete-btn"
                  @click="requestDelete(campaign.id, $event)"
                  title="Delete campaign"
                >
                  <Trash2 :size="16" />
                </button>
                <div
                  class="team-badge"
                  :style="{ backgroundColor: campaign.team?.primary_color || '#7c3aed' }"
                >
                  {{ campaign.team?.abbreviation }}
                </div>
              </div>
            </div>

            <!-- Delete confirmation inline -->
            <div v-if="confirmDeleteId === campaign.id" class="delete-confirm" @click.stop>
              <p class="delete-confirm-text">Delete this campaign? This cannot be undone.</p>
              <div class="delete-confirm-actions">
                <button class="delete-confirm-cancel" @click="cancelDelete($event)">Cancel</button>
                <button class="delete-confirm-yes" :disabled="deleting" @click="confirmDelete($event)">
                  {{ deleting ? 'Deleting...' : 'Delete' }}
                </button>
              </div>
            </div>

            <template v-else>
              <div class="campaign-meta">
                <span class="meta-item">
                  <Calendar :size="14" />
                  Year {{ campaign.gameYear ?? campaign.game_year ?? 1 }}
                </span>
                <span class="meta-divider">·</span>
                <span class="meta-item difficulty">{{ getDifficultyLabel(campaign.difficulty) }}</span>
                <template v-if="(campaign.team?.franchise_history?.championships ?? 0) > 0">
                  <span class="meta-divider">·</span>
                  <span
                    class="meta-item meta-trophy"
                    :title="`${campaign.team.franchise_history.championships} championship${campaign.team.franchise_history.championships === 1 ? '' : 's'}`"
                  >
                    <Trophy :size="14" />
                    {{ campaign.team.franchise_history.championships }}
                  </span>
                </template>
              </div>

              <div class="campaign-footer">
                <span class="last-played">
                  Last played: {{ formatDate(campaign.last_played_at) }}
                </span>
                <div class="continue-btn">
                  Continue
                  <ChevronRight :size="16" />
                </div>
              </div>
            </template>
          </GlassCard>
        </div>
      </div>
    </main>

    <!-- Create Campaign Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showCreateModal"
          class="modal-overlay"
          @click.self="closeCreateModal"
        >
          <div class="modal-container">
            <!-- Header -->
            <header class="modal-header">
              <h2 class="modal-title">Sign a 4-Year GM Contract</h2>
              <button class="modal-close" @click="closeCreateModal" aria-label="Close">
                <X :size="20" />
              </button>
            </header>

            <!-- Content -->
            <main class="modal-content">
              <!-- Error Message -->
              <div v-if="createError" class="modal-error">
                <AlertCircle :size="16" />
                <span>{{ createError }}</span>
              </div>

              <!-- Difficulty Selection — removed. All new campaigns are
                   locked to All-Star (see payload below). The `difficulties`
                   array is kept around for `getDifficultyLabel` so existing
                   campaigns saved at other difficulties still render the
                   right label on the campaign list. -->

              <!-- Draft Mode Selection -->
              <div class="form-group">
                <label class="form-label">Draft Mode</label>
                <div class="difficulty-grid">
                  <button
                    v-for="mode in draftModes"
                    :key="mode.value"
                    type="button"
                    class="difficulty-option"
                    :class="{ selected: selectedDraftMode === mode.value }"
                    @click="selectedDraftMode = mode.value"
                  >
                    <span class="difficulty-name">{{ mode.label }}</span>
                    <span class="difficulty-desc">{{ mode.description }}</span>
                  </button>
                </div>
              </div>

              <!-- GM Level (career, profile-global) -->
              <div class="form-group gm-level-group">
                <span class="gm-level-label">Your GM Level</span>
                <span
                  class="gm-level-badge"
                  :style="{ backgroundColor: gmLevelBadge.color, color: gmLevelBadge.text }"
                  :title="`Your GM career level: ${gmLevelBadge.label}`"
                >
                  <Medal :size="14" />
                  {{ gmLevelBadge.label }}
                </span>
              </div>

              <!-- Team Selection -->
              <div class="form-group">
                <label class="form-label">Choose the team to sign with (4-year contract)</label>
                <TeamPicker
                  v-model="selectedTeam"
                  :teams="campaignStore.availableTeams"
                  :gm-level="authStore.gmLevel"
                />
              </div>

              <!-- Rename Your Team (optional) — gated by the headshot_editor
                   IAP. Hidden entirely when the user doesn't own the unlock;
                   createCampaign still strips any custom name from the
                   payload defensively. -->
              <div v-if="selectedTeam && canRenameTeam" class="form-group">
                <label class="form-label">Rename your team (optional)</label>
                <input
                  v-model="customTeamName"
                  type="text"
                  class="form-input"
                  :placeholder="selectedTeam.name"
                  maxlength="40"
                />
              </div>
            </main>

            <!-- Selected Team Preview — pinned full-width banner at the bottom
                 of the modal-content area (above the action footer) so the
                 user's current selection stays visible as they scroll the
                 team list. Lives outside .modal-content so the scrolling
                 content doesn't ride underneath it. -->
            <div v-if="selectedTeam" class="selected-team-preview">
              <button
                type="button"
                class="preview-deselect"
                aria-label="Clear team selection"
                @click="selectedTeam = null"
              >
                <X :size="16" />
              </button>
              <div class="preview-top">
                <div
                  class="preview-badge"
                  :style="{ backgroundColor: selectedTeam.primary_color }"
                >
                  {{ selectedTeam.abbreviation }}
                </div>
                <div class="preview-info">
                  <h4 class="preview-name">{{ customTeamName.trim() || selectedTeam.name }}</h4>
                  <p class="preview-meta">{{ selectedTeam.division }} Division</p>
                  <OwnerQuickInfo :team-abbreviation="selectedTeam.abbreviation" />
                </div>

                <!-- Facilities stars — to the right of the team name on desktop,
                     wrapping underneath on mobile. -->
                <div class="pd-facilities">
                  <span v-for="key in FACILITY_KEYS" :key="key" class="pd-fac">
                    <span class="pd-fac-label">{{ FACILITY_SHORT[key] }}</span>
                    <span class="facility-stars mini">
                      <span
                        v-for="i in 5"
                        :key="i"
                        class="star"
                        :class="{ filled: i <= (selectedTeam.facilities?.[key] ?? 0) }"
                      >&#9733;</span>
                    </span>
                  </span>
                </div>
              </div>

              <!-- Set head coach — deterministic; previews what the campaign
                   will generate. -->
              <div v-if="selectedCoach" class="preview-detail">
                <div class="pd-coach">
                  <CoachAvatar :coach="selectedCoach" :size="34" />
                  <div class="pd-coach-info">
                    <span class="pd-coach-top">
                      <span class="pd-coach-name">{{ selectedCoach.firstName }} {{ selectedCoach.lastName }}</span>
                      <span v-if="selectedCoach.overall != null" class="pd-coach-ovr">OVR {{ selectedCoach.overall }}</span>
                    </span>
                    <span v-if="selectedCoach.badges?.length" class="pd-badges">
                      <span
                        v-for="badge in selectedCoach.badges"
                        :key="badge.id"
                        class="pd-badge"
                        :title="coachBadgeDesc(badge)"
                      >
                        <Star
                          :size="10"
                          :style="{ color: COACH_BADGE_TIER_COLORS[badge.level] || 'var(--color-text-secondary)' }"
                          :fill="COACH_BADGE_TIER_COLORS[badge.level] || 'transparent'"
                        />
                        {{ coachBadgeName(badge.id) }}
                      </span>
                    </span>
                    <span v-if="selectedCoach.attributes" class="pd-attrs">
                      <span v-for="key in COACH_ATTR_ORDER" :key="key" class="pd-attr">
                        {{ COACH_ATTR_ABBR[key] }}<b :style="{ color: getAttrColor(selectedCoach.attributes[key]) }">{{ selectedCoach.attributes[key] }}</b>
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <footer class="modal-footer">
              <button class="btn-cancel" @click="closeCreateModal">
                Cancel
              </button>
              <button
                class="btn-create"
                :disabled="!selectedTeam || creating"
                @click="createCampaign"
              >
                <LoadingSpinner v-if="creating" size="sm" />
                <template v-else>Sign 4-Year Contract</template>
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Onboarding gate: shown after a new campaign is created -->
    <HasPlayedBeforeModal
      :show="showPlayedBeforeModal"
      @answered="handlePlayedBeforeAnswer"
    />

    <!-- Weekly Headshot Editor upsell (non-owners only) -->
    <HeadshotEditorPromoModal
      :show="showHeadshotPromo"
      @close="showHeadshotPromo = false"
      @unlock="goToStorePurchase"
    />
  </div>
</template>

<style scoped>
.campaigns-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.campaigns-header {
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

.logout-btn:hover {
  color: #EF4444;
}

/* Main Content */
.campaigns-main {
  flex: 1;
  padding: 2rem 1.5rem;
}

.campaigns-container {
  max-width: 1200px;
  margin: 0 auto;
}

/* Page Header */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2rem;
}

.page-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.page-subtitle {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

/* Loading State */
.loading-state {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 4rem;
}

/* Empty State */
.empty-state {
  max-width: 500px;
  margin: 0 auto;
}

.empty-card {
  text-align: center;
}

.empty-content {
  padding: 1rem 0;
}

.empty-icon-wrapper {
  width: 64px;
  height: 64px;
  margin: 0 auto 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gradient-cosmic);
  border-radius: var(--radius-xl);
  color: #1a1520;
}

.empty-title {
  font-size: 1.25rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin-bottom: 0.5rem;
}

.empty-description {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin-bottom: 1.5rem;
}

/* Campaigns Grid */
.campaigns-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.25rem;
}

.campaign-card {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.campaign-card:hover {
  transform: translateY(-2px);
}

.campaign-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.campaign-info {
  flex: 1;
  min-width: 0;
}

.campaign-name {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.campaign-team {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin: 0;
}

/* Team name + all-time record on one line. Record sits flush-right of the
   name and reads as a quick at-a-glance "how's this franchise doing
   historically" stat. Hidden entirely on legacy campaigns whose teams
   have no `franchise_history` yet — see template v-if. */
.campaign-team-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.campaign-team-record {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  padding: 1px 6px;
  border-radius: var(--radius-md);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  white-space: nowrap;
}

.team-badge {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.campaign-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.meta-divider {
  color: var(--color-text-tertiary);
}

.meta-item.difficulty {
  text-transform: capitalize;
}

/* Trophy chip — only renders when the franchise has at least one title.
   Slightly elevated background + gold accent so it draws the eye in the
   meta row without overwhelming the difficulty chip. */
.meta-item.meta-trophy {
  color: #facc15;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.meta-item.meta-trophy :deep(svg) {
  color: #facc15;
}

.campaign-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 1rem;
  border-top: 1px solid var(--glass-border);
}

.last-played {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

.continue-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-primary);
}

/* Campaign limit error banner */
.limit-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1.25rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-lg);
  color: #EF4444;
  font-size: 0.875rem;
}

/* Campaign header actions */
.campaign-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 0.2s ease;
  opacity: 0.5;
}

.delete-btn:hover {
  color: #EF4444;
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

/* Delete confirmation */
.delete-confirm {
  padding: 0.75rem;
  margin-top: 0.5rem;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-lg);
}

.delete-confirm-text {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
}

.delete-confirm-actions {
  display: flex;
  gap: 0.5rem;
}

.delete-confirm-cancel,
.delete-confirm-yes {
  flex: 1;
  padding: 6px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
}

.delete-confirm-cancel {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.delete-confirm-cancel:hover {
  background: var(--color-bg-tertiary);
}

.delete-confirm-yes {
  background: #EF4444;
  border: none;
  color: white;
}

.delete-confirm-yes:hover:not(:disabled) {
  background: #DC2626;
}

.delete-confirm-yes:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Safe-area-aware padding so the modal can never render under the notch /
     home indicator on iPhone. Matches BaseModal's gutter behavior. */
  padding-top: max(16px, var(--safe-area-inset-top, env(safe-area-inset-top)));
  padding-right: max(16px, var(--safe-area-inset-right, env(safe-area-inset-right)));
  padding-bottom: max(16px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom)));
  padding-left: max(16px, var(--safe-area-inset-left, env(safe-area-inset-left)));
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.modal-container {
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.modal-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1.25rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-lg);
  color: #EF4444;
  font-size: 0.875rem;
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

/* Form Elements */
.form-group {
  margin-bottom: 1.5rem;
}

.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 0.5rem;
}

/* GM Level row in the create modal — label + colored tier badge inline. */
.gm-level-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.gm-level-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-primary);
}
.gm-level-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--radius-full, 999px);
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.form-input {
  width: 100%;
  padding: 0.75rem 1rem;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  font-size: 0.9rem;
  color: var(--color-text-primary);
  transition: border-color 0.2s ease;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.form-input::placeholder {
  color: var(--color-text-tertiary);
}

/* Difficulty Grid */
.difficulty-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}

.difficulty-option {
  padding: 0.75rem;
  background: var(--color-bg-tertiary);
  border: 2px solid var(--glass-border);
  border-radius: var(--radius-lg);
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.difficulty-option:hover {
  border-color: var(--color-primary);
}

.difficulty-option.selected {
  border-color: var(--color-primary);
  background: rgba(232, 90, 79, 0.1);
}

.difficulty-name {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.difficulty-desc {
  display: block;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

/* Conference/Teams */
.conference-section {
  margin-bottom: 1.25rem;
}

.conference-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}

.teams-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
}

.team-option {
  padding: 0.5rem;
  background: var(--color-bg-tertiary);
  border: 2px solid transparent;
  border-radius: var(--radius-lg);
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.team-option:hover {
  border-color: var(--color-primary);
}

.team-option.selected {
  border-color: var(--color-primary);
  background: rgba(232, 90, 79, 0.1);
}

.team-option-badge {
  width: 32px;
  height: 32px;
  margin: 0 auto 0.35rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: 0.6rem;
  font-weight: 700;
  color: white;
}

.team-option-city {
  display: block;
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Facilities tier on each team option (and reused star style in the detail panel) */
.team-option-tier {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  margin-top: 3px;
}
.tier-stars,
.facility-stars {
  display: inline-flex;
  line-height: 1;
}
.tier-stars .star,
.facility-stars .star {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.15);
}
.facility-stars .star {
  font-size: 0.95rem;
}
.tier-stars .star.filled,
.facility-stars .star.filled {
  color: #FFC72C;
  text-shadow: 0 0 6px rgba(255, 199, 44, 0.4);
}
.tier-label {
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
  font-weight: 700;
}

/* Minimal facilities + coach detail, embedded inside the preview banner. */
.facility-stars.mini .star {
  font-size: 0.72rem;
}
.preview-detail {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--glass-border);
}
.pd-facilities {
  /* Desktop: 2-column grid (2x2) sitting to the right of the team name —
     preview-info's flex:1 pushes this block to the right edge. */
  display: grid;
  grid-template-columns: repeat(2, max-content);
  gap: 4px 14px;
}
/* Mobile: drop to a full-width row stacked under the team name. */
@media (max-width: 560px) {
  .pd-facilities {
    display: flex;
    flex-wrap: wrap;
    flex-basis: 100%;
    gap: 5px 14px;
    justify-content: flex-start;
  }
}
.pd-fac {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pd-fac-label {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--color-text-tertiary);
}
.pd-coach {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pd-coach-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pd-coach-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pd-coach-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.pd-coach-ovr {
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--color-primary);
}
.pd-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.pd-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  background: var(--color-bg-elevated, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  font-size: 0.62rem;
  color: var(--color-text-primary);
  white-space: nowrap;
}
.pd-attrs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  font-size: 0.62rem;
  color: var(--color-text-tertiary);
}
.pd-attr b {
  margin-left: 3px;
  font-weight: 700;
}

/* Selected Team Preview — full-width pinned banner between the scrolling
   .modal-content and the action .modal-footer. No border-radius / no
   horizontal margin so it spans edge-to-edge of the modal container. The team
   identity sits on top (.preview-top), with the minimal detail beneath it. */
.selected-team-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.85rem 20px;
  background: var(--color-bg-tertiary);
  border-top: 1px solid var(--glass-border);
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}
.preview-deselect {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  background: var(--color-bg-elevated, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--glass-border);
  border-radius: 50%;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}
.preview-deselect:hover {
  background: var(--color-bg-secondary, rgba(255, 255, 255, 0.12));
  color: var(--color-text-primary);
}
.preview-top {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  /* Leave room for the deselect X so the facilities grid doesn't slide under it. */
  padding-right: 1.5rem;
}

.preview-badge {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  font-size: 0.9rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.preview-info {
  
}

.preview-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.preview-meta {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

/* Footer Buttons */
.btn-cancel,
.btn-create {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.btn-cancel:hover {
  background: var(--color-bg-tertiary);
}

.btn-create {
  background: var(--color-primary);
  border: none;
  color: white;
}

.btn-create:hover:not(:disabled) {
  background: var(--color-primary-dark);
}

.btn-create:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Modal Transitions */
.modal-enter-active {
  transition: opacity 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-container {
  animation: modalScaleIn 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active .modal-container {
  animation: modalScaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes modalScaleIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes modalScaleOut {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}

/* Responsive */
@media (max-width: 768px) {
  .nav-link span {
    display: none;
  }

  .nav-link {
    padding: 0.5rem;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .campaigns-grid {
    grid-template-columns: 1fr;
  }

  .teams-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .difficulty-grid {
    grid-template-columns: 1fr;
  }

  .modal-container {
    max-height: 85vh;
  }
}

/* Light Mode */
[data-theme="light"] .modal-error {
  background: rgba(239, 68, 68, 0.08);
}

.btn-cosmic {
  background: var(--gradient-cosmic) !important;
  border: none !important;
  color: #000 !important;
  font-weight: 600;
}
</style>
