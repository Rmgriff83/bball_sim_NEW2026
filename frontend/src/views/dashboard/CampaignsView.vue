<script setup>
import { ref, onMounted, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton, LoadingSpinner } from '@/components/ui'
import { Plus, X, LayoutDashboard, User, LogOut, Calendar, ChevronRight, AlertCircle } from 'lucide-vue-next'

const router = useRouter()
const campaignStore = useCampaignStore()
const authStore = useAuthStore()

const showCreateModal = ref(false)
const newCampaignName = ref('')
const selectedTeam = ref(null)
const selectedDifficulty = ref('pro')
const selectedDraftMode = ref('standard')
const creating = ref(false)
const createError = ref(null)

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

onMounted(async () => {
  await campaignStore.fetchCampaigns()
  await campaignStore.fetchAvailableTeams()
})

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}

function openCreateModal() {
  showCreateModal.value = true
  newCampaignName.value = ''
  selectedTeam.value = null
  selectedDifficulty.value = 'pro'
  selectedDraftMode.value = 'standard'
  createError.value = null
  document.body.style.overflow = 'hidden'
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

  try {
    const campaignName = newCampaignName.value.trim() || `${selectedTeam.value.name} Dynasty`
    const payload = {
      name: campaignName,
      team_abbreviation: selectedTeam.value.abbreviation,
      difficulty: selectedDifficulty.value,
    }
    if (selectedDraftMode.value === 'fantasy') {
      payload.draft_mode = 'fantasy'
    }

    const campaign = await campaignStore.createCampaign(payload)

    closeCreateModal()
    if (selectedDraftMode.value === 'fantasy') {
      router.push(`/campaign/${campaign.id}/draft`)
    } else {
      router.push(`/campaign/${campaign.id}`)
    }
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

function getTeamsByConference(conference) {
  return campaignStore.availableTeams.filter(t => t.conference === conference)
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

        <!-- Campaigns Grid -->
        <div v-else class="campaigns-grid">
          <GlassCard
            v-for="campaign in campaignStore.campaigns"
            :key="campaign.id"
            padding="lg"
            class="campaign-card"
            @click="router.push(`/campaign/${campaign.id}`)"
          >
            <div class="campaign-header">
              <div class="campaign-info">
                <h3 class="campaign-name">{{ campaign.name }}</h3>
                <p class="campaign-team">{{ campaign.team?.city }} {{ campaign.team?.name }}</p>
              </div>
              <div
                class="team-badge"
                :style="{ backgroundColor: campaign.team?.primary_color || '#7c3aed' }"
              >
                {{ campaign.team?.abbreviation }}
              </div>
            </div>

            <div class="campaign-meta">
              <span class="meta-item">
                <Calendar :size="14" />
                Year {{ campaign.game_year }}
              </span>
              <span class="meta-divider">·</span>
              <span class="meta-item difficulty">{{ getDifficultyLabel(campaign.difficulty) }}</span>
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
              <h2 class="modal-title">Create New Campaign</h2>
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

              <!-- Difficulty Selection -->
              <div class="form-group">
                <label class="form-label">Difficulty</label>
                <div class="difficulty-grid">
                  <button
                    v-for="diff in difficulties"
                    :key="diff.value"
                    type="button"
                    class="difficulty-option"
                    :class="{ selected: selectedDifficulty === diff.value }"
                    @click="selectedDifficulty = diff.value"
                  >
                    <span class="difficulty-name">{{ diff.label }}</span>
                    <span class="difficulty-desc">{{ diff.description }}</span>
                  </button>
                </div>
              </div>

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

              <!-- Team Selection -->
              <div class="form-group">
                <label class="form-label">Select Your Team</label>

                <!-- Eastern Conference -->
                <div class="conference-section">
                  <h4 class="conference-title">Eastern Conference</h4>
                  <div class="teams-grid">
                    <button
                      v-for="team in getTeamsByConference('east')"
                      :key="team.abbreviation"
                      type="button"
                      class="team-option"
                      :class="{ selected: selectedTeam?.abbreviation === team.abbreviation }"
                      @click="selectedTeam = team"
                    >
                      <div
                        class="team-option-badge"
                        :style="{ backgroundColor: team.primary_color }"
                      >
                        {{ team.abbreviation }}
                      </div>
                      <span class="team-option-city">{{ team.city }}</span>
                    </button>
                  </div>
                </div>

                <!-- Western Conference -->
                <div class="conference-section">
                  <h4 class="conference-title">Western Conference</h4>
                  <div class="teams-grid">
                    <button
                      v-for="team in getTeamsByConference('west')"
                      :key="team.abbreviation"
                      type="button"
                      class="team-option"
                      :class="{ selected: selectedTeam?.abbreviation === team.abbreviation }"
                      @click="selectedTeam = team"
                    >
                      <div
                        class="team-option-badge"
                        :style="{ backgroundColor: team.primary_color }"
                      >
                        {{ team.abbreviation }}
                      </div>
                      <span class="team-option-city">{{ team.city }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Selected Team Preview -->
              <div v-if="selectedTeam" class="selected-team-preview">
                <div
                  class="preview-badge"
                  :style="{ backgroundColor: selectedTeam.primary_color }"
                >
                  {{ selectedTeam.abbreviation }}
                </div>
                <div class="preview-info">
                  <h4 class="preview-name">{{ selectedTeam.city }} {{ selectedTeam.name }}</h4>
                  <p class="preview-meta">{{ selectedTeam.division }} Division</p>
                </div>
              </div>
            </main>

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
                <template v-else>Create Campaign</template>
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>
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

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
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

/* Selected Team Preview */
.selected-team-preview {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
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
  flex: 1;
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
    max-height: 100%;
    border-radius: 0;
  }

  .modal-overlay {
    padding: 0;
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
