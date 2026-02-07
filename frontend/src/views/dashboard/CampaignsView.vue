<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useAuthStore } from '@/stores/auth'
import { GlassCard, BaseButton, BaseModal, LoadingSpinner } from '@/components/ui'

const router = useRouter()
const campaignStore = useCampaignStore()
const authStore = useAuthStore()

const showCreateModal = ref(false)
const newCampaignName = ref('')
const selectedTeam = ref(null)
const selectedDifficulty = ref('pro')
const creating = ref(false)
const createError = ref(null)

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
  createError.value = null
}

function closeCreateModal() {
  showCreateModal.value = false
}

async function createCampaign() {
  if (!newCampaignName.value.trim() || !selectedTeam.value) {
    createError.value = 'Please enter a name and select a team'
    return
  }

  creating.value = true
  createError.value = null

  try {
    const campaign = await campaignStore.createCampaign({
      name: newCampaignName.value.trim(),
      team_abbreviation: selectedTeam.value.abbreviation,
      difficulty: selectedDifficulty.value,
    })

    closeCreateModal()
    router.push(`/campaign/${campaign.id}`)
  } catch (err) {
    createError.value = err.response?.data?.message || 'Failed to create campaign'
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

// Group teams by conference and division
function getTeamsByConference(conference) {
  return campaignStore.availableTeams.filter(t => t.conference === conference)
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Header -->
    <header class="app-header">
      <div class="container flex items-center justify-between py-4">
        <router-link to="/dashboard" class="app-logo">BBALL SIM</router-link>
        <nav class="flex items-center gap-4">
          <router-link to="/dashboard" class="nav-link">Dashboard</router-link>
          <router-link to="/profile" class="nav-link">Profile</router-link>
          <button @click="handleLogout" class="btn btn-ghost btn-sm">
            Sign Out
          </button>
        </nav>
      </div>
    </header>

    <!-- Main Content -->
    <main class="container p-8">
      <div class="flex items-center justify-between mb-8">
        <h1 class="h2 text-gradient">Your Campaigns</h1>
        <BaseButton variant="primary" @click="openCreateModal">
          + New Campaign
        </BaseButton>
      </div>

      <!-- Loading State -->
      <div v-if="campaignStore.loading" class="flex justify-center items-center py-12 opacity-60">
        <LoadingSpinner size="md" />
      </div>

      <!-- Empty State -->
      <div v-else-if="campaignStore.campaigns.length === 0">
        <GlassCard padding="lg" class="text-center" :hoverable="false">
          <div class="text-6xl mb-4">🏀</div>
          <h3 class="h4 mb-2">No Campaigns Yet</h3>
          <p class="text-secondary mb-6">Start your first franchise and build a dynasty!</p>
          <BaseButton variant="primary" @click="openCreateModal">Create Campaign</BaseButton>
        </GlassCard>
      </div>

      <!-- Campaigns Grid -->
      <div v-else class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <GlassCard
          v-for="campaign in campaignStore.campaigns"
          :key="campaign.id"
          padding="lg"
          class="cursor-pointer"
          @click="router.push(`/campaign/${campaign.id}`)"
        >
          <div class="flex items-start justify-between mb-3">
            <div>
              <h3 class="h4 mb-1">{{ campaign.name }}</h3>
              <p class="text-secondary text-sm">{{ campaign.team?.name }}</p>
            </div>
            <div
              class="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
              :style="{ backgroundColor: campaign.team?.primary_color || '#7c3aed' }"
            >
              {{ campaign.team?.abbreviation }}
            </div>
          </div>

          <div class="flex items-center gap-4 text-sm text-secondary mb-4">
            <span>Year {{ campaign.game_year }}</span>
            <span>{{ campaign.difficulty }}</span>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-xs text-tertiary">
              Last played: {{ formatDate(campaign.last_played_at) }}
            </span>
            <BaseButton variant="secondary" size="sm">
              Continue
            </BaseButton>
          </div>
        </GlassCard>
      </div>
    </main>

    <!-- Create Campaign Modal -->
    <BaseModal :show="showCreateModal" @close="closeCreateModal" title="Create New Campaign" size="lg">
      <div class="space-y-6">
        <!-- Campaign Name -->
        <div>
          <label class="block text-sm font-medium mb-2">Campaign Name</label>
          <input
            v-model="newCampaignName"
            type="text"
            class="input w-full"
            placeholder="My Dynasty"
            maxlength="100"
          />
        </div>

        <!-- Difficulty Selection -->
        <div>
          <label class="block text-sm font-medium mb-2">Difficulty</label>
          <div class="grid grid-cols-2 gap-3">
            <button
              v-for="diff in difficulties"
              :key="diff.value"
              type="button"
              class="glass-card p-3 text-left transition-all"
              :class="{ 'border-primary glow-primary': selectedDifficulty === diff.value }"
              @click="selectedDifficulty = diff.value"
            >
              <div class="font-semibold">{{ diff.label }}</div>
              <div class="text-xs text-secondary">{{ diff.description }}</div>
            </button>
          </div>
        </div>

        <!-- Team Selection -->
        <div>
          <label class="block text-sm font-medium mb-2">Select Your Team</label>

          <!-- Eastern Conference -->
          <div class="mb-4">
            <h4 class="text-xs uppercase tracking-wider text-secondary mb-2">Eastern Conference</h4>
            <div class="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <button
                v-for="team in getTeamsByConference('east')"
                :key="team.abbreviation"
                type="button"
                class="glass-card p-2 text-center transition-all"
                :class="{ 'border-primary glow-primary': selectedTeam?.abbreviation === team.abbreviation }"
                @click="selectedTeam = team"
              >
                <div
                  class="w-8 h-8 rounded-lg mx-auto mb-1 flex items-center justify-center text-white text-xs font-bold"
                  :style="{ backgroundColor: team.primary_color }"
                >
                  {{ team.abbreviation }}
                </div>
                <div class="text-xs truncate">{{ team.city }}</div>
              </button>
            </div>
          </div>

          <!-- Western Conference -->
          <div>
            <h4 class="text-xs uppercase tracking-wider text-secondary mb-2">Western Conference</h4>
            <div class="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <button
                v-for="team in getTeamsByConference('west')"
                :key="team.abbreviation"
                type="button"
                class="glass-card p-2 text-center transition-all"
                :class="{ 'border-primary glow-primary': selectedTeam?.abbreviation === team.abbreviation }"
                @click="selectedTeam = team"
              >
                <div
                  class="w-8 h-8 rounded-lg mx-auto mb-1 flex items-center justify-center text-white text-xs font-bold"
                  :style="{ backgroundColor: team.primary_color }"
                >
                  {{ team.abbreviation }}
                </div>
                <div class="text-xs truncate">{{ team.city }}</div>
              </button>
            </div>
          </div>
        </div>

        <!-- Selected Team Info -->
        <div v-if="selectedTeam" class="glass-card p-4">
          <div class="flex items-center gap-4">
            <div
              class="w-16 h-16 rounded-xl flex items-center justify-center text-white text-xl font-bold"
              :style="{ backgroundColor: selectedTeam.primary_color }"
            >
              {{ selectedTeam.abbreviation }}
            </div>
            <div>
              <h4 class="h4">{{ selectedTeam.name }}</h4>
              <p class="text-secondary">{{ selectedTeam.city }} - {{ selectedTeam.division }}</p>
            </div>
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="createError" class="text-error text-sm">
          {{ createError }}
        </div>

        <!-- Actions -->
        <div class="flex gap-3 justify-end">
          <BaseButton variant="secondary" @click="closeCreateModal">
            Cancel
          </BaseButton>
          <BaseButton
            variant="primary"
            :loading="creating"
            :disabled="!newCampaignName.trim() || !selectedTeam"
            @click="createCampaign"
          >
            Create Campaign
          </BaseButton>
        </div>
      </div>
    </BaseModal>
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

.border-primary {
  border-color: var(--color-primary) !important;
}

/* Glow effect for selected items */
.glow-primary {
  box-shadow: 0 0 0 2px rgba(232, 90, 79, 0.2);
}

/* Campaign card hover effect */
.glass-card:hover .team-badge {
  transform: scale(1.05);
}

.team-badge {
  transition: transform var(--duration-normal) var(--ease-default);
}
</style>
