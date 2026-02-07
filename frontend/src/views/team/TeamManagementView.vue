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
const playerModalTab = ref('stats')
const showLineupEditor = ref(false)
const editingLineup = ref({ PG: null, SG: null, SF: null, PF: null, C: null })
const savingLineup = ref(false)

// Coach settings state
const schemesFetched = ref(false)
const updatingScheme = ref(false)
const selectedScheme = ref(null)

// Position validation
const { POSITIONS, canPlayPosition } = usePositionValidation()

const campaignId = computed(() => route.params.id)
const team = computed(() => teamStore.team)
const roster = computed(() => teamStore.roster)
const sortedRoster = computed(() =>
  [...(teamStore.roster || [])].sort((a, b) => b.overall_rating - a.overall_rating)
)
const coach = computed(() => teamStore.coach)

// Group roster by position (sorted by overall within each position)
const rosterByPosition = computed(() => {
  const positions = { PG: [], SG: [], SF: [], PF: [], C: [] }
  roster.value.forEach(player => {
    if (positions[player.position]) {
      positions[player.position].push(player)
    }
  })
  // Sort each position group by overall rating
  Object.keys(positions).forEach(pos => {
    positions[pos].sort((a, b) => b.overall_rating - a.overall_rating)
  })
  return positions
})

// Eligible players per position for lineup editing (filtered by position eligibility and injury status)
const eligiblePlayersForPosition = computed(() => {
  const result = {}
  const selectedIds = Object.values(editingLineup.value).filter(Boolean)

  POSITIONS.forEach(pos => {
    // Get players who can play this position, aren't injured, and aren't selected elsewhere
    result[pos] = roster.value.filter(p => {
      const canPlay = canPlayPosition(p, pos)
      const isHealthy = !p.is_injured && !p.isInjured
      // Allow if this player is selected for THIS position or not selected at all
      const isSelectedHere = editingLineup.value[pos] === p.id
      const isSelectedElsewhere = selectedIds.includes(p.id) && !isSelectedHere
      return canPlay && isHealthy && !isSelectedElsewhere
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

// Watch for tab change to fetch coaching schemes
watch(activeTab, async (newTab) => {
  if (newTab === 'coach' && !schemesFetched.value) {
    try {
      await teamStore.fetchCoachingSchemes(campaignId.value)
      selectedScheme.value = team.value?.coaching_scheme || 'balanced'
      schemesFetched.value = true
    } catch (err) {
      console.error('Failed to fetch coaching schemes:', err)
    }
  }
})

async function updateCoachingScheme(scheme) {
  if (updatingScheme.value) return
  updatingScheme.value = true
  try {
    await teamStore.updateCoachingScheme(campaignId.value, scheme)
    selectedScheme.value = scheme
  } catch (err) {
    console.error('Failed to update scheme:', err)
  } finally {
    updatingScheme.value = false
  }
}

function openPlayerModal(player) {
  selectedPlayer.value = player
  playerModalTab.value = 'stats'
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

  // Helper to check if player is healthy
  const isHealthy = (p) => !p.is_injured && !p.isInjured

  // Try to assign current starters to their natural positions first (if healthy)
  POSITIONS.forEach((pos, index) => {
    const currentStarter = starters.value[index]
    if (currentStarter && canPlayPosition(currentStarter, pos) && isHealthy(currentStarter) && !usedIds.includes(currentStarter.id)) {
      newLineup[pos] = currentStarter.id
      usedIds.push(currentStarter.id)
    }
  })

  // Fill remaining positions with best available healthy players
  POSITIONS.forEach(pos => {
    if (newLineup[pos] === null) {
      const eligible = roster.value.find(p =>
        canPlayPosition(p, pos) && isHealthy(p) && !usedIds.includes(p.id)
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

function formatBadgeName(badgeId) {
  if (!badgeId) return ''
  // Convert snake_case to Title Case
  return badgeId
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatAttrName(attrKey) {
  if (!attrKey) return ''
  // Convert camelCase to Title Case with spaces
  return attrKey
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim()
}

function formatWeight(weight) {
  if (!weight) return '210'
  // Handle malformed weight data (e.g., 1950 instead of 195)
  const w = parseInt(weight)
  if (w > 400) return Math.round(w / 10)
  return w
}

function getEffectivenessClass(value) {
  if (value >= 70) return 'high'
  if (value >= 50) return 'medium'
  return 'low'
}

// Mock player news - in production this would come from backend
const playerNews = computed(() => {
  if (!selectedPlayer.value) return []
  // TODO: Fetch actual news from backend
  return []
})
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
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'coach' }"
          @click="activeTab = 'coach'"
        >
          Coach Settings
        </button>
      </div>

      <!-- Full Roster View -->
      <div v-if="activeTab === 'roster'" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <PlayerCard
          v-for="player in sortedRoster"
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

      <!-- Coach Settings View -->
      <div v-else-if="activeTab === 'coach'" class="space-y-6">
        <!-- Coach Info Card -->
        <GlassCard v-if="coach" padding="lg" :hoverable="false">
          <h3 class="h4 mb-4">Head Coach</h3>
          <div class="coach-header">
            <div class="coach-avatar">
              {{ coach.name?.charAt(0) || 'C' }}
            </div>
            <div class="coach-info">
              <p class="coach-name">{{ coach.name }}</p>
              <div class="coach-rating">
                <StatBadge :value="coach.overall_rating" size="sm" />
                <span class="rating-label">Overall Rating</span>
              </div>
            </div>
          </div>

          <!-- Career Stats -->
          <div v-if="coach.career_stats" class="career-stats-section mt-4">
            <h4 class="section-title">Career Record</h4>
            <div class="career-stats-grid">
              <div class="career-stat-box">
                <span class="career-stat-value">{{ coach.career_stats.wins }}-{{ coach.career_stats.losses }}</span>
                <span class="career-stat-label">Regular Season</span>
                <span class="career-stat-pct">{{ coach.career_stats.win_pct }}%</span>
              </div>
              <div class="career-stat-box">
                <span class="career-stat-value">{{ coach.career_stats.playoff_wins }}-{{ coach.career_stats.playoff_losses }}</span>
                <span class="career-stat-label">Playoffs</span>
                <span class="career-stat-pct">{{ coach.career_stats.playoff_win_pct }}%</span>
              </div>
              <div class="career-stat-box highlight">
                <span class="career-stat-value">{{ coach.career_stats.championships }}</span>
                <span class="career-stat-label">Championships</span>
              </div>
              <div class="career-stat-box">
                <span class="career-stat-value">{{ coach.career_stats.seasons_coached }}</span>
                <span class="career-stat-label">Seasons</span>
              </div>
            </div>

            <!-- Awards row -->
            <div v-if="coach.career_stats.conference_titles > 0 || coach.career_stats.coach_of_year_awards > 0" class="awards-row mt-3">
              <span v-if="coach.career_stats.conference_titles > 0" class="award-badge">
                {{ coach.career_stats.conference_titles }}x Conference Champion
              </span>
              <span v-if="coach.career_stats.coach_of_year_awards > 0" class="award-badge gold">
                {{ coach.career_stats.coach_of_year_awards }}x Coach of the Year
              </span>
            </div>
          </div>

          <!-- Coach Attributes -->
          <div v-if="coach.attributes" class="coach-attributes mt-4">
            <h4 class="section-title">Coaching Skills</h4>
            <div class="attr-grid">
              <div v-for="(value, key) in coach.attributes" :key="key" class="coach-attr-item">
                <span class="attr-label">{{ formatAttrName(key) }}</span>
                <div class="attr-bar-mini">
                  <div class="attr-fill" :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }" />
                </div>
                <span class="attr-val" :style="{ color: getAttrColor(value) }">{{ value }}</span>
              </div>
            </div>
          </div>
        </GlassCard>

        <!-- Coaching Scheme Selection -->
        <GlassCard padding="lg" :hoverable="false">
          <div class="flex items-center justify-between mb-4">
            <h3 class="h4">Offensive Scheme</h3>
            <div v-if="teamStore.recommendedScheme" class="recommended-badge">
              Recommended: {{ teamStore.coachingSchemes[teamStore.recommendedScheme]?.name }}
            </div>
          </div>

          <p class="text-secondary text-sm mb-6">
            Choose an offensive scheme that fits your roster's strengths. This affects play selection and tempo during games.
          </p>

          <div v-if="teamStore.loading && !schemesFetched" class="flex justify-center py-8">
            <LoadingSpinner size="md" />
          </div>

          <div v-else class="schemes-grid">
            <div
              v-for="(scheme, schemeId) in teamStore.coachingSchemes"
              :key="schemeId"
              class="scheme-card"
              :class="{
                active: (selectedScheme || team?.coaching_scheme) === schemeId,
                recommended: teamStore.recommendedScheme === schemeId
              }"
              @click="updateCoachingScheme(schemeId)"
            >
              <div class="scheme-header">
                <span class="scheme-name">{{ scheme.name }}</span>
                <span v-if="teamStore.recommendedScheme === schemeId" class="rec-tag">Best Fit</span>
              </div>

              <p class="scheme-desc">{{ scheme.description }}</p>

              <div class="scheme-details">
                <div class="scheme-pace">
                  <span class="detail-label">Pace</span>
                  <span class="detail-value" :class="scheme.pace">{{ scheme.pace?.replace('_', ' ') }}</span>
                </div>
                <div class="scheme-effectiveness">
                  <span class="detail-label">Fit</span>
                  <span class="detail-value" :class="getEffectivenessClass(scheme.effectiveness)">
                    {{ scheme.effectiveness }}%
                  </span>
                </div>
              </div>

              <div class="scheme-traits">
                <div class="trait-section">
                  <span class="trait-label">Strengths</span>
                  <div class="trait-tags">
                    <span v-for="str in scheme.strengths" :key="str" class="trait-tag positive">{{ str }}</span>
                  </div>
                </div>
                <div class="trait-section">
                  <span class="trait-label">Weaknesses</span>
                  <div class="trait-tags">
                    <span v-for="weak in scheme.weaknesses" :key="weak" class="trait-tag negative">{{ weak }}</span>
                  </div>
                </div>
              </div>

              <div v-if="updatingScheme && (selectedScheme || team?.coaching_scheme) === schemeId" class="scheme-loading">
                <LoadingSpinner size="sm" />
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </template>

    <!-- Player Detail Modal -->
    <BaseModal
      :show="showPlayerModal"
      @close="closePlayerModal"
      :title="selectedPlayer?.name || 'Player Details'"
      size="lg"
    >
      <div v-if="selectedPlayer" class="player-modal-content">
        <!-- Player Header -->
        <div class="player-modal-header" :class="{ 'injured-header': selectedPlayer.is_injured || selectedPlayer.isInjured }">
          <div class="flex items-center gap-4">
            <div class="rating-with-injury">
              <StatBadge :value="selectedPlayer.overall_rating" size="lg" />
              <span v-if="selectedPlayer.is_injured || selectedPlayer.isInjured" class="injury-badge-modal">INJ</span>
            </div>
            <div>
              <h2 class="h3" :class="{ 'injured-name': selectedPlayer.is_injured || selectedPlayer.isInjured }">{{ selectedPlayer.name }}</h2>
              <div class="flex items-center gap-2">
                <span
                  class="position-badge"
                  :style="{ backgroundColor: getPositionColor(selectedPlayer.position) }"
                >
                  {{ selectedPlayer.position }}
                </span>
                <span v-if="selectedPlayer.secondary_position" class="position-badge secondary">
                  {{ selectedPlayer.secondary_position }}
                </span>
                <span v-if="selectedPlayer.is_injured || selectedPlayer.isInjured" class="injury-tag">Injured</span>
                <span v-else class="text-secondary">#{{ selectedPlayer.jersey_number || '00' }}</span>
              </div>
            </div>
          </div>
          <div class="player-bio">
            <span>{{ selectedPlayer.height || "6'6\"" }}</span>
            <span class="divider">|</span>
            <span>{{ formatWeight(selectedPlayer.weight) }} lbs</span>
            <span class="divider">|</span>
            <span>Age {{ selectedPlayer.age || 25 }}</span>
          </div>
        </div>

        <!-- Badges -->
        <div v-if="selectedPlayer.badges?.length > 0" class="badges-section">
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
              <span class="badge-name">{{ formatBadgeName(badge.id) }}</span>
            </div>
          </div>
        </div>

        <!-- Tab Navigation -->
        <div class="modal-tabs">
          <button
            class="modal-tab"
            :class="{ active: playerModalTab === 'stats' }"
            @click="playerModalTab = 'stats'"
          >
            Season Stats
          </button>
          <button
            class="modal-tab"
            :class="{ active: playerModalTab === 'attributes' }"
            @click="playerModalTab = 'attributes'"
          >
            Attributes
          </button>
          <button
            class="modal-tab"
            :class="{ active: playerModalTab === 'news' }"
            @click="playerModalTab = 'news'"
          >
            News
          </button>
        </div>

        <!-- Tab Content -->
        <div class="modal-tab-content">
          <!-- Stats Tab -->
          <div v-if="playerModalTab === 'stats'" class="tab-panel">
            <template v-if="selectedPlayer.season_stats">
              <!-- Scoring Stats -->
              <div class="stats-section">
                <h4 class="stats-section-title">Scoring</h4>
                <div class="stats-grid">
                  <div class="stat-cell">
                    <span class="stat-label">PPG</span>
                    <span class="stat-value highlight">{{ selectedPlayer.season_stats.ppg }}</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">FG%</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.fg_pct }}%</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">3P%</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.three_pct }}%</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">FT%</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.ft_pct }}%</span>
                  </div>
                </div>
              </div>

              <!-- Playmaking Stats -->
              <div class="stats-section">
                <h4 class="stats-section-title">Playmaking</h4>
                <div class="stats-grid">
                  <div class="stat-cell">
                    <span class="stat-label">APG</span>
                    <span class="stat-value highlight">{{ selectedPlayer.season_stats.apg }}</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">RPG</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.rpg }}</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">MPG</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.mpg }}</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">GP</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.games_played }}</span>
                  </div>
                </div>
              </div>

              <!-- Defense Stats -->
              <div class="stats-section">
                <h4 class="stats-section-title">Defense</h4>
                <div class="stats-grid">
                  <div class="stat-cell">
                    <span class="stat-label">SPG</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.spg }}</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">BPG</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.bpg }}</span>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="empty-state">
              <p>No stats available yet.</p>
              <p class="text-sm text-secondary">Play some games to see this player's stats.</p>
            </div>
          </div>

          <!-- Attributes Tab -->
          <div v-if="playerModalTab === 'attributes'" class="tab-panel">
            <!-- Offensive Attributes -->
            <div v-if="selectedPlayer.attributes?.offense" class="attr-section">
              <h4 class="attr-section-title">Offense</h4>
              <div class="attributes-grid">
                <div v-for="(value, key) in selectedPlayer.attributes.offense" :key="key" class="attr-row">
                  <span class="attr-name">{{ formatAttrName(key) }}</span>
                  <div class="attr-bar-container">
                    <div
                      class="attr-bar"
                      :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                    />
                  </div>
                  <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ value }}</span>
                </div>
              </div>
            </div>

            <!-- Defensive Attributes -->
            <div v-if="selectedPlayer.attributes?.defense" class="attr-section">
              <h4 class="attr-section-title">Defense</h4>
              <div class="attributes-grid">
                <div v-for="(value, key) in selectedPlayer.attributes.defense" :key="key" class="attr-row">
                  <span class="attr-name">{{ formatAttrName(key) }}</span>
                  <div class="attr-bar-container">
                    <div
                      class="attr-bar"
                      :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                    />
                  </div>
                  <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ value }}</span>
                </div>
              </div>
            </div>

            <!-- Physical Attributes -->
            <div v-if="selectedPlayer.attributes?.physical" class="attr-section">
              <h4 class="attr-section-title">Physical</h4>
              <div class="attributes-grid">
                <div v-for="(value, key) in selectedPlayer.attributes.physical" :key="key" class="attr-row">
                  <span class="attr-name">{{ formatAttrName(key) }}</span>
                  <div class="attr-bar-container">
                    <div
                      class="attr-bar"
                      :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                    />
                  </div>
                  <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ value }}</span>
                </div>
              </div>
            </div>

            <!-- Mental Attributes -->
            <div v-if="selectedPlayer.attributes?.mental" class="attr-section">
              <h4 class="attr-section-title">Mental</h4>
              <div class="attributes-grid">
                <div v-for="(value, key) in selectedPlayer.attributes.mental" :key="key" class="attr-row">
                  <span class="attr-name">{{ formatAttrName(key) }}</span>
                  <div class="attr-bar-container">
                    <div
                      class="attr-bar"
                      :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                    />
                  </div>
                  <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ value }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- News Tab -->
          <div v-if="playerModalTab === 'news'" class="tab-panel">
            <div v-if="playerNews.length > 0" class="news-list">
              <div v-for="news in playerNews" :key="news.id" class="news-item">
                <p class="news-headline">{{ news.headline }}</p>
                <p class="news-date">{{ news.date }}</p>
              </div>
            </div>
            <div v-else class="empty-state">
              <p>No news available for this player.</p>
              <p class="text-sm text-secondary">News will appear as the season progresses.</p>
            </div>
          </div>
        </div>

        <!-- Contract Footer -->
        <div v-if="selectedPlayer.contract" class="contract-footer">
          <div class="contract-item">
            <span class="contract-label">Salary</span>
            <span class="contract-value text-success">{{ formatSalary(selectedPlayer.contract.salary) }}/yr</span>
          </div>
          <div class="contract-item">
            <span class="contract-label">Years Remaining</span>
            <span class="contract-value">{{ selectedPlayer.contract.years_remaining }}</span>
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
          <span class="injured-note">Injured players are not available for selection.</span>
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

.stat-box-sm {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.stat-box-sm .stat-label {
  font-size: 0.65rem;
  margin-bottom: 2px;
}

.stat-box-sm .stat-value {
  font-size: 1rem;
}

.position-badge.secondary {
  background: rgba(255, 255, 255, 0.2) !important;
  opacity: 0.8;
}

/* Player Modal Styles */
.player-modal-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.player-modal-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.player-bio {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-secondary);
  font-size: 0.875rem;
}

.player-bio .divider {
  color: rgba(255, 255, 255, 0.2);
}

.badges-section {
  padding: 16px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

/* Modal Tabs */
.modal-tabs {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.05);
  padding: 4px;
  border-radius: 10px;
}

.modal-tab {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-tab:hover {
  color: white;
  background: rgba(255, 255, 255, 0.05);
}

.modal-tab.active {
  background: var(--color-primary);
  color: white;
}

.modal-tab-content {
  min-height: 300px;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Stats Sections */
.stats-section {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 16px;
}

.stats-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.stat-cell .stat-label {
  font-size: 0.65rem;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.stat-cell .stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: white;
}

.stat-cell .stat-value.highlight {
  color: var(--color-primary);
}

/* Attribute Sections */
.attr-section {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 16px;
}

.attr-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

/* News List */
.news-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.news-item {
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  border-left: 3px solid var(--color-primary);
}

.news-headline {
  font-weight: 500;
  margin-bottom: 4px;
}

.news-date {
  font-size: 0.75rem;
  color: var(--color-secondary);
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  color: var(--color-secondary);
}

.empty-state p:first-child {
  font-size: 1rem;
  margin-bottom: 8px;
}

/* Contract Footer */
.contract-footer {
  display: flex;
  gap: 24px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  margin-top: auto;
}

.contract-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.contract-label {
  font-size: 0.75rem;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.contract-value {
  font-size: 1.1rem;
  font-weight: 600;
}

/* Injury styles */
.injured-header {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05)) !important;
  border-radius: 10px;
  padding: 16px;
  margin: -8px -8px 0 -8px;
}

.rating-with-injury {
  position: relative;
}

.injury-badge-modal {
  position: absolute;
  bottom: -4px;
  right: -4px;
  padding: 2px 5px;
  background: var(--color-error);
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  border-radius: 4px;
  text-transform: uppercase;
}

.injured-name {
  color: var(--color-error) !important;
  text-decoration: line-through;
  text-decoration-color: rgba(239, 68, 68, 0.5);
}

.injury-tag {
  padding: 2px 6px;
  background: var(--color-error);
  color: white;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
}

.injured-note {
  display: block;
  margin-top: 4px;
  color: var(--color-error);
  font-size: 0.8rem;
}

/* Coach Settings Styles */
.coach-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.coach-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
}

.coach-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.coach-name {
  font-size: 1.25rem;
  font-weight: 600;
}

.coach-rating {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rating-label {
  font-size: 0.875rem;
  color: var(--color-secondary);
}

/* Career Stats Section */
.career-stats-section {
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.career-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.career-stat-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  text-align: center;
}

.career-stat-box.highlight {
  background: rgba(124, 58, 237, 0.15);
  border: 1px solid rgba(124, 58, 237, 0.3);
}

.career-stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
}

.career-stat-label {
  font-size: 0.7rem;
  color: var(--color-secondary);
  text-transform: uppercase;
  margin-top: 4px;
}

.career-stat-pct {
  font-size: 0.875rem;
  color: var(--color-success);
  font-weight: 500;
  margin-top: 2px;
}

.awards-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.award-badge {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  font-size: 0.75rem;
  color: var(--color-secondary);
}

.award-badge.gold {
  background: rgba(255, 215, 0, 0.15);
  border-color: rgba(255, 215, 0, 0.3);
  color: #FFD700;
}

.coach-attributes {
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.attr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.coach-attr-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.coach-attr-item .attr-label {
  width: 100px;
  font-size: 0.8rem;
  color: var(--color-secondary);
  text-transform: capitalize;
}

.attr-bar-mini {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.attr-fill {
  height: 100%;
  border-radius: 3px;
}

.coach-attr-item .attr-val {
  width: 30px;
  text-align: right;
  font-weight: 600;
  font-size: 0.875rem;
}

.recommended-badge {
  padding: 6px 12px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 6px;
  color: var(--color-success);
  font-size: 0.75rem;
  font-weight: 500;
}

.schemes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.scheme-card {
  position: relative;
  padding: 20px;
  background: rgba(255, 255, 255, 0.03);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.scheme-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.2);
}

.scheme-card.active {
  background: rgba(124, 58, 237, 0.1);
  border-color: var(--color-primary);
}

.scheme-card.recommended:not(.active) {
  border-color: rgba(16, 185, 129, 0.4);
}

.scheme-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.scheme-name {
  font-size: 1.1rem;
  font-weight: 600;
}

.rec-tag {
  padding: 2px 8px;
  background: var(--color-success);
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  color: white;
}

.scheme-desc {
  font-size: 0.875rem;
  color: var(--color-secondary);
  margin-bottom: 16px;
  line-height: 1.4;
}

.scheme-details {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.scheme-pace,
.scheme-effectiveness {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 0.7rem;
  color: var(--color-secondary);
  text-transform: uppercase;
}

.detail-value {
  font-weight: 600;
  text-transform: capitalize;
}

.detail-value.very_fast,
.detail-value.fast {
  color: var(--color-warning);
}

.detail-value.medium {
  color: var(--color-tertiary);
}

.detail-value.slow {
  color: var(--color-secondary);
}

.detail-value.high {
  color: var(--color-success);
}

.detail-value.low {
  color: var(--color-error);
}

.scheme-traits {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trait-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trait-label {
  font-size: 0.7rem;
  color: var(--color-secondary);
  text-transform: uppercase;
}

.trait-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.trait-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  text-transform: capitalize;
}

.trait-tag.positive {
  background: rgba(16, 185, 129, 0.15);
  color: var(--color-success);
}

.trait-tag.negative {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-error);
}

.scheme-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 12px;
}

/* Responsive adjustments */
@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .attr-row {
    grid-template-columns: 100px 1fr 35px;
    gap: 8px;
  }

  .contract-footer {
    flex-direction: column;
    gap: 12px;
  }

  .schemes-grid {
    grid-template-columns: 1fr;
  }

  .attr-grid {
    grid-template-columns: 1fr;
  }

  .career-stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
