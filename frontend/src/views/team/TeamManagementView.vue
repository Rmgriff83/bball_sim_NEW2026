<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTeamStore } from '@/stores/team'
import { useCampaignStore } from '@/stores/campaign'
import { usePositionValidation } from '@/composables/usePositionValidation'
import { GlassCard, BaseButton, BaseModal, LoadingSpinner, StatBadge } from '@/components/ui'
import PlayerCard from '@/components/team/PlayerCard.vue'

const route = useRoute()
const teamStore = useTeamStore()
const campaignStore = useCampaignStore()

const loading = ref(true)
const activeTab = ref('roster')
const selectedPlayer = ref(null)
const showPlayerModal = ref(false)
const showLineupEditor = ref(false)
const editingLineup = ref({ PG: null, SG: null, SF: null, PF: null, C: null })
const savingLineup = ref(false)

// Position validation
const { POSITIONS, canPlayPosition } = usePositionValidation()

const campaignId = computed(() => route.params.id)
const team = computed(() => teamStore.team)
const roster = computed(() => teamStore.roster)
const coach = computed(() => teamStore.coach)

// Group roster by position
const rosterByPosition = computed(() => {
  const positions = { PG: [], SG: [], SF: [], PF: [], C: [] }
  roster.value.forEach(player => {
    if (positions[player.position]) {
      positions[player.position].push(player)
    }
  })
  return positions
})

// Eligible players per position for lineup editing (filtered by position eligibility)
const eligiblePlayersForPosition = computed(() => {
  const result = {}
  const selectedIds = Object.values(editingLineup.value).filter(Boolean)

  POSITIONS.forEach(pos => {
    // Get players who can play this position and aren't selected elsewhere
    result[pos] = roster.value.filter(p => {
      const canPlay = canPlayPosition(p, pos)
      // Allow if this player is selected for THIS position or not selected at all
      const isSelectedHere = editingLineup.value[pos] === p.id
      const isSelectedElsewhere = selectedIds.includes(p.id) && !isSelectedHere
      return canPlay && !isSelectedElsewhere
    })
  })

  return result
})

// Current starters (first 5 in roster order)
const starters = computed(() => roster.value.slice(0, 5))
const bench = computed(() => roster.value.slice(5))

// Team stats
const teamStats = computed(() => {
  if (roster.value.length === 0) return null

  const avgOverall = Math.round(
    roster.value.reduce((sum, p) => sum + p.overall_rating, 0) / roster.value.length
  )

  const totalSalary = roster.value.reduce((sum, p) => sum + (p.contract?.salary || 0), 0)

  // Calculate average attributes
  const avgAttrs = {}
  const attrKeys = ['speed', 'three_point', 'mid_range', 'close_shot', 'dunk',
                    'pass_accuracy', 'ball_handle', 'perimeter_defense', 'interior_defense', 'rebounding']

  attrKeys.forEach(key => {
    const values = roster.value.map(p => p.attributes?.[key] || 0).filter(v => v > 0)
    avgAttrs[key] = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
  })

  return {
    avgOverall,
    totalSalary,
    avgAttrs,
    rosterSize: roster.value.length
  }
})

onMounted(async () => {
  try {
    await teamStore.fetchTeam(campaignId.value)
  } catch (err) {
    console.error('Failed to load team:', err)
  } finally {
    loading.value = false
  }
})

function openPlayerModal(player) {
  selectedPlayer.value = player
  showPlayerModal.value = true
}

function closePlayerModal() {
  showPlayerModal.value = false
  selectedPlayer.value = null
}

function openLineupEditor() {
  // Initialize with best player for each position from current roster
  const newLineup = { PG: null, SG: null, SF: null, PF: null, C: null }
  const usedIds = []

  // Try to assign current starters to their natural positions first
  POSITIONS.forEach((pos, index) => {
    const currentStarter = starters.value[index]
    if (currentStarter && canPlayPosition(currentStarter, pos) && !usedIds.includes(currentStarter.id)) {
      newLineup[pos] = currentStarter.id
      usedIds.push(currentStarter.id)
    }
  })

  // Fill remaining positions with best available players
  POSITIONS.forEach(pos => {
    if (newLineup[pos] === null) {
      const eligible = roster.value.find(p =>
        canPlayPosition(p, pos) && !usedIds.includes(p.id)
      )
      if (eligible) {
        newLineup[pos] = eligible.id
        usedIds.push(eligible.id)
      }
    }
  })

  editingLineup.value = newLineup
  showLineupEditor.value = true
}

function closeLineupEditor() {
  showLineupEditor.value = false
  editingLineup.value = { PG: null, SG: null, SF: null, PF: null, C: null }
}

// Count how many positions are filled
const filledPositions = computed(() => {
  return Object.values(editingLineup.value).filter(Boolean).length
})

async function saveLineup() {
  if (filledPositions.value !== 5) {
    alert('Please select a player for each position')
    return
  }

  // Convert object to array in position order for API
  const lineupArray = POSITIONS.map(pos => editingLineup.value[pos])

  savingLineup.value = true
  try {
    await teamStore.updateLineup(campaignId.value, lineupArray)
    await teamStore.fetchTeam(campaignId.value)
    closeLineupEditor()
  } catch (err) {
    console.error('Failed to save lineup:', err)
    alert('Failed to save lineup')
  } finally {
    savingLineup.value = false
  }
}

function formatSalary(salary) {
  if (!salary) return '-'
  if (salary >= 1000000) {
    return `$${(salary / 1000000).toFixed(1)}M`
  }
  return `$${(salary / 1000).toFixed(0)}K`
}

function getPositionColor(position) {
  const colors = {
    PG: '#3B82F6',
    SG: '#10B981',
    SF: '#F59E0B',
    PF: '#EF4444',
    C: '#8B5CF6'
  }
  return colors[position] || '#6B7280'
}

function getBadgeLevelColor(level) {
  const colors = {
    bronze: '#CD7F32',
    silver: '#C0C0C0',
    gold: '#FFD700',
    hof: '#9B59B6'
  }
  return colors[level] || '#6B7280'
}

function getAttrColor(value) {
  if (value >= 90) return 'var(--color-success)'
  if (value >= 80) return '#22D3EE'
  if (value >= 70) return 'var(--color-primary)'
  if (value >= 60) return 'var(--color-warning)'
  return 'var(--color-error)'
}
</script>

<template>
  <div class="p-6">
    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-12">
      <LoadingSpinner size="lg" />
    </div>

    <template v-else-if="team">
      <!-- Header -->
      <div class="flex items-start justify-between mb-8">
        <div class="flex items-center gap-4">
          <div
            class="w-16 h-16 rounded-xl flex items-center justify-center text-white text-xl font-bold"
            :style="{ backgroundColor: team.primary_color || '#7c3aed' }"
          >
            {{ team.abbreviation }}
          </div>
          <div>
            <h1 class="h2 text-gradient">{{ team.name }}</h1>
            <p class="text-secondary">{{ team.city }} - {{ team.conference?.toUpperCase() }} Conference</p>
          </div>
        </div>

        <BaseButton variant="primary" @click="openLineupEditor">
          Edit Lineup
        </BaseButton>
      </div>

      <!-- Team Stats Overview -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <GlassCard padding="md" :hoverable="false">
          <p class="text-secondary text-sm mb-1">Roster Size</p>
          <p class="h3">{{ teamStats?.rosterSize || 0 }}</p>
        </GlassCard>
        <GlassCard padding="md" :hoverable="false">
          <p class="text-secondary text-sm mb-1">Avg Overall</p>
          <p class="h3">{{ teamStats?.avgOverall || '-' }}</p>
        </GlassCard>
        <GlassCard padding="md" :hoverable="false">
          <p class="text-secondary text-sm mb-1">Total Salary</p>
          <p class="h3">{{ formatSalary(teamStats?.totalSalary) }}</p>
        </GlassCard>
        <GlassCard padding="md" :hoverable="false">
          <p class="text-secondary text-sm mb-1">Avg 3PT</p>
          <p class="h3">{{ teamStats?.avgAttrs?.three_point || '-' }}</p>
        </GlassCard>
        <GlassCard padding="md" :hoverable="false">
          <p class="text-secondary text-sm mb-1">Avg Defense</p>
          <p class="h3">{{ teamStats?.avgAttrs?.perimeter_defense || '-' }}</p>
        </GlassCard>
      </div>

      <!-- Tab Navigation -->
      <div class="flex gap-2 mb-6">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'roster' }"
          @click="activeTab = 'roster'"
        >
          Full Roster
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'starters' }"
          @click="activeTab = 'starters'"
        >
          Starting Lineup
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'position' }"
          @click="activeTab = 'position'"
        >
          By Position
        </button>
      </div>

      <!-- Full Roster View -->
      <div v-if="activeTab === 'roster'" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <PlayerCard
          v-for="player in roster"
          :key="player.id"
          :player="player"
          :show-details="true"
          @click="openPlayerModal"
        />
      </div>

      <!-- Starting Lineup View -->
      <div v-else-if="activeTab === 'starters'" class="space-y-6">
        <GlassCard padding="lg" :hoverable="false">
          <h3 class="h4 mb-4">Starting Five</h3>
          <div class="grid md:grid-cols-5 gap-4">
            <div
              v-for="(player, index) in starters"
              :key="player.id"
              class="starter-card"
              @click="openPlayerModal(player)"
            >
              <div class="starter-position">
                {{ ['PG', 'SG', 'SF', 'PF', 'C'][index] }}
              </div>
              <StatBadge :value="player.overall_rating" size="lg" />
              <p class="starter-name">{{ player.name }}</p>
              <p class="starter-pos">{{ player.position }}</p>
            </div>
          </div>
        </GlassCard>

        <GlassCard padding="lg" :hoverable="false">
          <h3 class="h4 mb-4">Bench</h3>
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <PlayerCard
              v-for="player in bench"
              :key="player.id"
              :player="player"
              compact
              @click="openPlayerModal"
            />
          </div>
        </GlassCard>
      </div>

      <!-- By Position View -->
      <div v-else-if="activeTab === 'position'" class="space-y-6">
        <GlassCard
          v-for="(players, position) in rosterByPosition"
          :key="position"
          padding="lg"
          :hoverable="false"
        >
          <div class="flex items-center gap-3 mb-4">
            <span
              class="position-badge-lg"
              :style="{ backgroundColor: getPositionColor(position) }"
            >
              {{ position }}
            </span>
            <h3 class="h4">
              {{ { PG: 'Point Guards', SG: 'Shooting Guards', SF: 'Small Forwards', PF: 'Power Forwards', C: 'Centers' }[position] }}
            </h3>
            <span class="text-secondary">({{ players.length }})</span>
          </div>
          <div v-if="players.length === 0" class="text-secondary">
            No players at this position
          </div>
          <div v-else class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <PlayerCard
              v-for="player in players"
              :key="player.id"
              :player="player"
              compact
              @click="openPlayerModal"
            />
          </div>
        </GlassCard>
      </div>

      <!-- Coach Info -->
      <GlassCard v-if="coach" padding="lg" :hoverable="false" class="mt-6">
        <h3 class="h4 mb-4">Head Coach</h3>
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-white text-xl font-bold">
            {{ coach.name?.charAt(0) || 'C' }}
          </div>
          <div>
            <p class="font-semibold text-lg">{{ coach.name }}</p>
            <p class="text-secondary">
              {{ coach.offensive_scheme }} Offense | {{ coach.defensive_scheme }} Defense
            </p>
          </div>
        </div>
      </GlassCard>
    </template>

    <!-- Player Detail Modal -->
    <BaseModal
      :show="showPlayerModal"
      @close="closePlayerModal"
      :title="selectedPlayer?.name || 'Player Details'"
      size="lg"
    >
      <div v-if="selectedPlayer" class="space-y-6">
        <!-- Player Header -->
        <div class="flex items-center gap-4">
          <StatBadge :value="selectedPlayer.overall_rating" size="lg" />
          <div>
            <h2 class="h3">{{ selectedPlayer.name }}</h2>
            <div class="flex items-center gap-2">
              <span
                class="position-badge"
                :style="{ backgroundColor: getPositionColor(selectedPlayer.position) }"
              >
                {{ selectedPlayer.position }}
              </span>
              <span class="text-secondary">#{{ selectedPlayer.jersey_number || '00' }}</span>
            </div>
          </div>
        </div>

        <!-- Physical -->
        <div class="grid grid-cols-3 gap-4">
          <div class="stat-box">
            <span class="stat-label">Height</span>
            <span class="stat-value">{{ selectedPlayer.height || "6'6\"" }}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Weight</span>
            <span class="stat-value">{{ selectedPlayer.weight || '210' }} lbs</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Age</span>
            <span class="stat-value">{{ selectedPlayer.age || 25 }}</span>
          </div>
        </div>

        <!-- Attributes -->
        <div>
          <h4 class="font-semibold mb-3">Attributes</h4>
          <div class="attributes-grid">
            <div v-for="(value, key) in selectedPlayer.attributes" :key="key" class="attr-row">
              <span class="attr-name">{{ key.replace(/_/g, ' ') }}</span>
              <div class="attr-bar-container">
                <div
                  class="attr-bar"
                  :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                />
              </div>
              <span class="attr-value">{{ value }}</span>
            </div>
          </div>
        </div>

        <!-- Badges -->
        <div v-if="selectedPlayer.badges?.length > 0">
          <h4 class="font-semibold mb-3">Badges</h4>
          <div class="badges-grid">
            <div
              v-for="badge in selectedPlayer.badges"
              :key="badge.id"
              class="badge-card"
              :style="{ borderColor: getBadgeLevelColor(badge.level) }"
            >
              <span
                class="badge-level"
                :style="{ backgroundColor: getBadgeLevelColor(badge.level) }"
              >
                {{ badge.level?.toUpperCase() }}
              </span>
              <span class="badge-name">{{ badge.name }}</span>
            </div>
          </div>
        </div>

        <!-- Contract -->
        <div v-if="selectedPlayer.contract">
          <h4 class="font-semibold mb-3">Contract</h4>
          <div class="grid grid-cols-2 gap-4">
            <div class="stat-box">
              <span class="stat-label">Salary</span>
              <span class="stat-value text-success">{{ formatSalary(selectedPlayer.contract.salary) }}/yr</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">Years Remaining</span>
              <span class="stat-value">{{ selectedPlayer.contract.years_remaining }}</span>
            </div>
          </div>
        </div>
      </div>
    </BaseModal>

    <!-- Lineup Editor Modal -->
    <BaseModal
      :show="showLineupEditor"
      @close="closeLineupEditor"
      title="Edit Starting Lineup"
      size="lg"
    >
      <div class="space-y-6">
        <p class="text-secondary">
          Select a player for each position. Players can only be assigned to positions matching their primary or secondary position.
        </p>

        <!-- Position-based Selection -->
        <div class="lineup-position-grid">
          <div
            v-for="position in POSITIONS"
            :key="position"
            class="lineup-position-row"
          >
            <label class="position-label">{{ position }}</label>
            <select
              v-model="editingLineup[position]"
              class="position-select"
            >
              <option :value="null">Select {{ position }}...</option>
              <option
                v-for="player in eligiblePlayersForPosition[position]"
                :key="player.id"
                :value="player.id"
              >
                {{ player.name }} ({{ player.overall_rating }})
                <template v-if="player.position !== position"> - {{ player.position }}</template>
              </option>
            </select>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-3 justify-end">
          <BaseButton variant="secondary" @click="closeLineupEditor">
            Cancel
          </BaseButton>
          <BaseButton
            variant="primary"
            :loading="savingLineup"
            :disabled="filledPositions !== 5"
            @click="saveLineup"
          >
            Save Lineup
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
.tab-btn {
  padding: 8px 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--color-secondary);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.tab-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.starter-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.starter-card:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-2px);
}

.starter-position {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.starter-name {
  font-weight: 600;
  text-align: center;
}

.starter-pos {
  font-size: 0.875rem;
  color: var(--color-secondary);
}

.position-badge-lg {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
}

.position-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
}

.stat-box {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--color-secondary);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 1.1rem;
  font-weight: 600;
}

.attributes-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.attr-row {
  display: grid;
  grid-template-columns: 120px 1fr 40px;
  align-items: center;
  gap: 12px;
}

.attr-name {
  font-size: 0.875rem;
  color: var(--color-secondary);
  text-transform: capitalize;
}

.attr-bar-container {
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.attr-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.attr-value {
  font-weight: 600;
  text-align: right;
}

.badges-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid;
  border-radius: 6px;
}

.badge-level {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.65rem;
  font-weight: 700;
  color: white;
}

.badge-name {
  font-size: 0.875rem;
}

/* Lineup Position Grid */
.lineup-position-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lineup-position-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.position-label {
  width: 40px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
}

.position-select {
  flex: 1;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.position-select:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
}

.position-select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.position-select option {
  background: #1a1a2e;
  color: white;
}

.text-success {
  color: var(--color-success);
}
</style>
