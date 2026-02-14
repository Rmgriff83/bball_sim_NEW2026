<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { StatBadge } from '@/components/ui'
import { User, Trophy, Award, Medal, Star, Users, X, AlertTriangle, Zap } from 'lucide-vue-next'
import { useBadgeSynergies } from '@/composables/useBadgeSynergies'

const { getActivatedBadges, isPlayerInDynamicDuo } = useBadgeSynergies()

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  player: {
    type: Object,
    default: null
  },
  // Show growth tab for user's own players (with evolution data)
  showGrowth: {
    type: Boolean,
    default: false
  },
  // Evolution data for growth tab
  recentEvolution: {
    type: Array,
    default: () => []
  },
  allTimeEvolution: {
    type: Array,
    default: () => []
  },
  // Player news for history tab
  playerNews: {
    type: Array,
    default: () => []
  },
  showHistory: {
    type: Boolean,
    default: true
  },
  // For nested modals (like in LeagueView)
  backButton: {
    type: Object,
    default: null // { label: 'Back to Team', handler: Function }
  },
  // Whether user can upgrade attributes (only for user's own team players)
  canUpgrade: {
    type: Boolean,
    default: false
  },
  // Lineup players for badge synergy highlighting
  lineupPlayers: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close', 'upgrade-attribute'])

const activeTab = ref('stats')

// Evolution display state
const showAllRecentEvolution = ref(false)
const showAllTimeEvolution = ref(false)
const showAllTimeExpanded = ref(false)

// Reset tab when modal opens
watch(() => props.show, (newVal) => {
  if (newVal) {
    activeTab.value = 'stats'
    showAllRecentEvolution.value = false
    showAllTimeEvolution.value = false
    showAllTimeExpanded.value = false
  }
})

function close() {
  emit('close')
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    close()
  }
}

watch(() => props.show, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeydown)
})

// Normalize player data (handles both camelCase and snake_case)
const normalizedPlayer = computed(() => {
  if (!props.player) return null
  const p = props.player
  return {
    id: p.id || p.player_id,
    name: p.name || `${p.firstName || p.first_name} ${p.lastName || p.last_name}`,
    position: p.position,
    secondaryPosition: p.secondaryPosition || p.secondary_position,
    jerseyNumber: p.jerseyNumber || p.jersey_number || '00',
    overallRating: p.overallRating || p.overall_rating,
    potentialRating: p.potentialRating || p.potential_rating,
    height: p.height || p.heightFormatted || "6'6\"",
    weight: formatWeight(p.weight || p.weightLbs || p.weight_lbs),
    age: p.age,
    isInjured: p.is_injured || p.isInjured,
    attributes: p.attributes,
    badges: p.badges || [],
    seasonStats: p.season_stats || p.stats || null,
    contract: p.contract || (p.contractSalary ? {
      salary: p.contractSalary || p.contract_salary,
      years_remaining: p.contractYearsRemaining || p.contract_years_remaining
    } : null),
    // Awards
    championships: p.championships || 0,
    finals_mvp_awards: p.finals_mvp_awards || p.finalsMvpAwards || 0,
    conference_finals_mvp_awards: p.conference_finals_mvp_awards || p.conferenceFinalsMvpAwards || 0,
    mvp_awards: p.mvp_awards || p.mvpAwards || 0,
    all_star_selections: p.all_star_selections || p.allStarSelections || 0,
    // Fatigue
    fatigue: p.fatigue ?? 0,
    // Upgrade points
    upgrade_points: p.upgrade_points ?? p.upgradePoints ?? 0,
    // Recent performances
    recentPerformances: p.recent_performances || p.recentPerformances || []
  }
})

// Badge synergy activation data
const activatedBadgeData = computed(() => {
  if (!normalizedPlayer.value || !props.lineupPlayers.length) {
    return { activatedIds: new Set(), synergyDetails: new Map() }
  }
  return getActivatedBadges(normalizedPlayer.value, props.lineupPlayers)
})

function isBadgeActivated(badgeId) {
  return activatedBadgeData.value.activatedIds.has(badgeId)
}

function getBadgeSynergyTooltip(badge) {
  const details = activatedBadgeData.value.synergyDetails.get(badge.id)
  if (!details?.length) return ''
  return details.map(d => `⚡ ${d.synergyName} (w/ ${d.partnerName})`).join('\n')
}

// Check if player has upgrade points available (for showing upgrade buttons)
const hasUpgradePoints = computed(() =>
  props.canUpgrade && (normalizedPlayer.value?.upgrade_points ?? 0) > 0
)

// Current upgrade points count
const upgradePoints = computed(() =>
  normalizedPlayer.value?.upgrade_points ?? 0
)

// Handle upgrade button click
function handleUpgrade(category, attrKey) {
  emit('upgrade-attribute', {
    playerId: props.player.id,
    category,
    attribute: attrKey
  })
}

// Fatigue helpers
const fatiguePercent = computed(() => normalizedPlayer.value?.fatigue ?? 0)
const isOverFatigued = computed(() => fatiguePercent.value >= 70)

function getFatigueColor(fatigue) {
  if (fatigue >= 70) return 'var(--color-error)'
  if (fatigue >= 50) return 'var(--color-warning)'
  return 'var(--color-success)'
}

// Dynamic Duo detection
const duoPartnerName = computed(() => {
  if (!normalizedPlayer.value || !props.lineupPlayers?.length) return null
  return isPlayerInDynamicDuo(normalizedPlayer.value, props.lineupPlayers)
})

const hasAwards = computed(() => {
  if (!normalizedPlayer.value) return false
  const p = normalizedPlayer.value
  return p.championships > 0 || p.finals_mvp_awards > 0 ||
         p.conference_finals_mvp_awards > 0 || p.mvp_awards > 0 ||
         p.all_star_selections > 0
})

const hasNews = computed(() => props.playerNews && props.playerNews.length > 0)

// Helper functions
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

function getAttrColor(value) {
  if (value >= 90) return 'var(--color-success)'
  if (value >= 80) return '#22D3EE'
  if (value >= 70) return 'var(--color-primary)'
  if (value >= 60) return 'var(--color-warning)'
  return 'var(--color-error)'
}

// Game log helpers
const reversedPerformances = computed(() => {
  const perfs = normalizedPlayer.value?.recentPerformances || []
  return [...perfs].reverse()
})

function formatGameDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatBadgeName(badge) {
  if (!badge) return ''
  if (typeof badge === 'object' && badge.name) {
    return badge.name
  }
  const id = typeof badge === 'object' ? badge.id : badge
  if (!id) return ''
  return id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function formatAttrName(attrKey) {
  if (!attrKey) return ''
  return attrKey
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim()
}

function roundAttr(value) {
  if (value === null || value === undefined) return 0
  return Math.round(value)
}

function formatWeight(weight) {
  if (!weight) return '210'
  const w = parseInt(weight)
  if (w > 400) return Math.round(w / 10)
  return w
}

function formatSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1000000) {
    return `$${(salary / 1000000).toFixed(1)}M`
  }
  return `$${(salary / 1000).toFixed(0)}K`
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

function getStat(key) {
  const stats = normalizedPlayer.value?.seasonStats
  if (!stats) return 0
  // Handle both camelCase and snake_case
  return stats[key] || stats[key.replace(/_/g, '')] || 0
}

function formatStat(value, decimals = 1) {
  if (value === null || value === undefined) return '0'
  const num = parseFloat(value)
  return isNaN(num) ? '0' : num.toFixed(decimals)
}

// Evolution helpers
function formatCategoryName(category) {
  if (!category) return ''
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function getEvolutionColor(change) {
  if (change > 0) return 'var(--color-success)'
  if (change < 0) return 'var(--color-error)'
  return 'var(--color-text-secondary)'
}

function formatChange(change) {
  if (change > 0) return `+${change.toFixed(1)}`
  return change.toFixed(1)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="show"
        class="modal-overlay"
        @click.self="close"
      >
        <div v-if="normalizedPlayer" class="modal-container">
          <!-- Modal Header -->
          <header class="modal-header">
            <div class="modal-header-left">
              <button
                v-if="backButton"
                class="back-button"
                @click="backButton.handler"
              >
                &larr; {{ backButton.label }}
              </button>
              <h2 class="modal-title">Player Details</h2>
            </div>
            <button class="btn-close" @click="close" aria-label="Close">
              <X :size="20" />
            </button>
          </header>

          <!-- Modal Content (Scrollable) -->
          <main class="modal-content">
            <!-- Player Header Card -->
            <div class="player-modal-header" :class="{ 'injured-header': normalizedPlayer.isInjured }">
              <div class="header-top-row">
                <div class="modal-player-avatar">
                  <User class="avatar-icon" :size="44" />
                </div>
                <div class="player-name-section">
                  <div class="name-rating-row">
                    <h2 class="player-name-title" :class="{ 'injured-name': normalizedPlayer.isInjured }">
                      {{ normalizedPlayer.name }}
                    </h2>
                    <div class="rating-with-injury">
                      <StatBadge :value="normalizedPlayer.overallRating" size="lg" />
                      <span v-if="normalizedPlayer.isInjured" class="injury-badge-modal">INJ</span>
                    </div>
                  </div>
                  <div class="position-vitals-row">
                    <div class="position-badges">
                      <span
                        class="position-badge"
                        :style="{ backgroundColor: getPositionColor(normalizedPlayer.position) }"
                      >
                        {{ normalizedPlayer.position }}
                      </span>
                      <span
                        v-if="normalizedPlayer.secondaryPosition"
                        class="position-badge secondary"
                        :style="{ backgroundColor: getPositionColor(normalizedPlayer.secondaryPosition) }"
                      >
                        {{ normalizedPlayer.secondaryPosition }}
                      </span>
                      <span v-if="normalizedPlayer.isInjured" class="injury-tag">Injured</span>
                      <span v-else class="jersey-number">#{{ normalizedPlayer.jerseyNumber }}</span>
                    </div>
                    <div class="player-vitals">
                      <span>{{ normalizedPlayer.height }}</span>
                      <span class="divider">|</span>
                      <span>{{ normalizedPlayer.weight }} lbs</span>
                      <span class="divider">|</span>
                      <span>{{ normalizedPlayer.age || 25 }} years old</span>
                    </div>
                  </div>
                </div>
              </div>
              <!-- Fatigue Meter -->
              <div class="fatigue-meter-container">
                <div class="fatigue-meter-label">
                  <span>Fatigue</span>
                  <span class="fatigue-value">{{ fatiguePercent }}%</span>
                </div>
                <div class="fatigue-meter-bar">
                  <div
                    class="fatigue-meter-fill"
                    :style="{
                      width: fatiguePercent + '%',
                      backgroundColor: getFatigueColor(fatiguePercent)
                    }"
                  ></div>
                </div>
                <div v-if="isOverFatigued" class="fatigue-warning" title="Attributes affected by fatigue">
                  <AlertTriangle :size="14" />
                </div>
              </div>
            </div>

            <div v-if="duoPartnerName" class="dynamic-duo-badge">
              <Users :size="14" />
              <span>Dynamic Duo w/ {{ duoPartnerName }}</span>
            </div>

            <!-- Badges Preview -->
            <div v-if="normalizedPlayer.badges?.length > 0" class="badges-preview">
              <div class="badges-grid-preview">
                <div
                  v-for="badge in normalizedPlayer.badges.slice(0, 6)"
                  :key="badge.id"
                  class="badge-chip"
                  :class="{ 'synergy-active': isBadgeActivated(badge.id) }"
                  :style="{ borderColor: isBadgeActivated(badge.id) ? '#00E5FF' : getBadgeLevelColor(badge.level) }"
                  :title="getBadgeSynergyTooltip(badge)"
                >
                  <Zap v-if="isBadgeActivated(badge.id)" :size="10" class="synergy-icon" />
                  <span class="badge-level-icon" :style="{ color: getBadgeLevelColor(badge.level) }">
                    {{ badge.level === 'hof' ? 'HOF' : badge.level.charAt(0).toUpperCase() }}
                  </span>
                  <span class="badge-name-preview">{{ formatBadgeName(badge) }}</span>
                </div>
                <span v-if="normalizedPlayer.badges.length > 6" class="more-badges">
                  +{{ normalizedPlayer.badges.length - 6 }} more
                </span>
              </div>
            </div>

            <!-- Tab Navigation -->
            <div class="modal-tabs">
              <button
                class="tab-btn"
                :class="{ active: activeTab === 'stats' }"
                @click="activeTab = 'stats'"
              >
                Stats
              </button>
              <button
                class="tab-btn"
                :class="{ active: activeTab === 'attributes' }"
                @click="activeTab = 'attributes'"
              >
                Attributes
              </button>
              <button
                class="tab-btn"
                :class="{ active: activeTab === 'badges' }"
                @click="activeTab = 'badges'"
              >
                Badges
              </button>
              <button
                v-if="showGrowth"
                class="tab-btn"
                :class="{ active: activeTab === 'growth' }"
                @click="activeTab = 'growth'"
              >
                Growth
              </button>
              <button
                v-if="showHistory"
                class="tab-btn"
                :class="{ active: activeTab === 'history' }"
                @click="activeTab = 'history'"
              >
                History
              </button>
            </div>

            <!-- Tab Content -->
            <div class="modal-tab-content">
              <!-- Stats Tab -->
              <div v-if="activeTab === 'stats'" class="tab-panel">
                <template v-if="normalizedPlayer.seasonStats">
                  <div class="stats-grid-modal">
                    <div class="stat-cell">
                      <span class="stat-label">PPG</span>
                      <span class="stat-value highlight">{{ formatStat(getStat('ppg')) }}</span>
                    </div>
                    <div class="stat-cell">
                      <span class="stat-label">RPG</span>
                      <span class="stat-value">{{ formatStat(getStat('rpg')) }}</span>
                    </div>
                    <div class="stat-cell">
                      <span class="stat-label">APG</span>
                      <span class="stat-value">{{ formatStat(getStat('apg')) }}</span>
                    </div>
                    <div class="stat-cell">
                      <span class="stat-label">SPG</span>
                      <span class="stat-value">{{ formatStat(getStat('spg')) }}</span>
                    </div>
                    <div class="stat-cell">
                      <span class="stat-label">BPG</span>
                      <span class="stat-value">{{ formatStat(getStat('bpg')) }}</span>
                    </div>
                    <div class="stat-cell">
                      <span class="stat-label">FG%</span>
                      <span class="stat-value">{{ formatStat(getStat('fg_pct') || getStat('fgPct'), 0) }}%</span>
                    </div>
                    <div class="stat-cell">
                      <span class="stat-label">3P%</span>
                      <span class="stat-value">{{ formatStat(getStat('three_pct') || getStat('threePct'), 0) }}%</span>
                    </div>
                    <div class="stat-cell">
                      <span class="stat-label">FT%</span>
                      <span class="stat-value">{{ formatStat(getStat('ft_pct') || getStat('ftPct'), 0) }}%</span>
                    </div>
                    <div class="stat-cell">
                      <span class="stat-label">MPG</span>
                      <span class="stat-value">{{ formatStat(getStat('mpg'), 0) }}</span>
                    </div>
                    <div class="stat-cell">
                      <span class="stat-label">GP</span>
                      <span class="stat-value">{{ getStat('games_played') || getStat('gamesPlayed') || 0 }}</span>
                    </div>
                  </div>
                  <!-- Recent Games (Game Log) -->
                  <div v-if="reversedPerformances.length > 0" class="recent-performances-section">
                    <h4 class="recent-performances-title">Recent Games</h4>
                    <div class="game-log-table-wrap">
                      <table class="game-log-table">
                        <thead>
                          <tr>
                            <th>Date</th><th>OPP</th><th>Result</th>
                            <th>MIN</th><th>PTS</th><th>REB</th><th>AST</th>
                            <th>STL</th><th>BLK</th><th>TO</th>
                            <th>FG</th><th>3P</th><th>FT</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(game, i) in reversedPerformances" :key="i">
                            <td class="game-log-date">{{ typeof game === 'object' ? formatGameDate(game.date) : '—' }}</td>
                            <td class="game-log-opp">{{ typeof game === 'object' ? game.opponent : '—' }}</td>
                            <td :class="typeof game === 'object' && game.won ? 'game-log-win' : 'game-log-loss'">
                              {{ typeof game === 'object' ? (game.won ? 'W' : 'L') : '—' }}
                            </td>
                            <td>{{ typeof game === 'object' ? game.min : '—' }}</td>
                            <td class="game-log-pts">{{ typeof game === 'object' ? game.pts : Math.round(game) }}</td>
                            <td>{{ typeof game === 'object' ? game.reb : '—' }}</td>
                            <td>{{ typeof game === 'object' ? game.ast : '—' }}</td>
                            <td>{{ typeof game === 'object' ? game.stl : '—' }}</td>
                            <td>{{ typeof game === 'object' ? game.blk : '—' }}</td>
                            <td>{{ typeof game === 'object' ? game.to : '—' }}</td>
                            <td>{{ typeof game === 'object' ? `${game.fgm}-${game.fga}` : '—' }}</td>
                            <td>{{ typeof game === 'object' ? `${game.tpm}-${game.tpa}` : '—' }}</td>
                            <td>{{ typeof game === 'object' ? `${game.ftm}-${game.fta}` : '—' }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </template>
                <div v-else class="empty-state-modal">
                  <p>No stats available yet.</p>
                  <p class="text-sm text-secondary">Play some games to see this player's stats.</p>
                </div>
              </div>

              <!-- Attributes Tab -->
              <div v-if="activeTab === 'attributes'" class="tab-panel">
                <!-- Upgrade Points Banner - always show when canUpgrade is true -->
                <div v-if="canUpgrade" class="upgrade-points-banner" :class="{ 'no-points': upgradePoints === 0 }">
                  <div class="points-badge">
                    <span class="points-value" :class="{ 'zero': upgradePoints === 0 }">{{ upgradePoints }}</span>
                    <span class="points-label">Upgrade Points</span>
                  </div>
                  <p class="upgrade-hint">
                    {{ upgradePoints > 0 ? 'Tap + to upgrade an attribute' : 'Earn points through weekly performance' }}
                  </p>
                </div>

                <!-- Offensive Attributes -->
                <div v-if="normalizedPlayer.attributes?.offense" class="attr-section">
                  <h4 class="attr-section-title">Offense</h4>
                  <div class="attributes-grid">
                    <div v-for="(value, key) in normalizedPlayer.attributes.offense" :key="key" class="attr-row" :class="{ 'has-upgrade': hasUpgradePoints }">
                      <span class="attr-name">{{ formatAttrName(key) }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                        />
                      </div>
                      <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ roundAttr(value) }}</span>
                      <button
                        v-if="hasUpgradePoints"
                        class="upgrade-btn"
                        :disabled="value >= (normalizedPlayer.potentialRating ?? 99)"
                        :title="value >= (normalizedPlayer.potentialRating ?? 99) ? 'At potential cap' : 'Upgrade (+1)'"
                        @click.stop="handleUpgrade('offense', key)"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Defensive Attributes -->
                <div v-if="normalizedPlayer.attributes?.defense" class="attr-section">
                  <h4 class="attr-section-title">Defense</h4>
                  <div class="attributes-grid">
                    <div v-for="(value, key) in normalizedPlayer.attributes.defense" :key="key" class="attr-row" :class="{ 'has-upgrade': hasUpgradePoints }">
                      <span class="attr-name">{{ formatAttrName(key) }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                        />
                      </div>
                      <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ roundAttr(value) }}</span>
                      <button
                        v-if="hasUpgradePoints"
                        class="upgrade-btn"
                        :disabled="value >= (normalizedPlayer.potentialRating ?? 99)"
                        :title="value >= (normalizedPlayer.potentialRating ?? 99) ? 'At potential cap' : 'Upgrade (+1)'"
                        @click.stop="handleUpgrade('defense', key)"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Physical Attributes -->
                <div v-if="normalizedPlayer.attributes?.physical" class="attr-section">
                  <h4 class="attr-section-title">Physical</h4>
                  <div class="attributes-grid">
                    <div v-for="(value, key) in normalizedPlayer.attributes.physical" :key="key" class="attr-row" :class="{ 'has-upgrade': hasUpgradePoints }">
                      <span class="attr-name">{{ formatAttrName(key) }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                        />
                      </div>
                      <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ roundAttr(value) }}</span>
                      <button
                        v-if="hasUpgradePoints"
                        class="upgrade-btn"
                        :disabled="value >= (normalizedPlayer.potentialRating ?? 99)"
                        :title="value >= (normalizedPlayer.potentialRating ?? 99) ? 'At potential cap' : 'Upgrade (+1)'"
                        @click.stop="handleUpgrade('physical', key)"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Mental Attributes (Cannot be upgraded) -->
                <div v-if="normalizedPlayer.attributes?.mental" class="attr-section">
                  <h4 class="attr-section-title">
                    Mental
                    <span v-if="canUpgrade" class="no-upgrade-hint">(Cannot be upgraded)</span>
                  </h4>
                  <div class="attributes-grid">
                    <div v-for="(value, key) in normalizedPlayer.attributes.mental" :key="key" class="attr-row">
                      <span class="attr-name">{{ formatAttrName(key) }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                        />
                      </div>
                      <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ roundAttr(value) }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="!normalizedPlayer.attributes" class="empty-state-modal">
                  <p>No attributes available.</p>
                </div>
              </div>

              <!-- Badges Tab -->
              <div v-if="activeTab === 'badges'" class="tab-panel">
                <div v-if="normalizedPlayer.badges?.length > 0" class="badges-tab-content">
                  <!-- HOF Badges -->
                  <div v-if="normalizedPlayer.badges.filter(b => b.level === 'hof').length > 0" class="badge-level-section">
                    <h4 class="badge-level-title hof">Hall of Fame</h4>
                    <div class="badges-grid-modal">
                      <div
                        v-for="badge in normalizedPlayer.badges.filter(b => b.level === 'hof')"
                        :key="badge.id"
                        class="badge-card-modal hof"
                        :class="{ 'synergy-active': isBadgeActivated(badge.id) }"
                        :title="getBadgeSynergyTooltip(badge)"
                      >
                        <Zap v-if="isBadgeActivated(badge.id)" :size="12" class="synergy-icon" />
                        <span class="badge-icon">HOF</span>
                        <span class="badge-name-modal">{{ formatBadgeName(badge) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Gold Badges -->
                  <div v-if="normalizedPlayer.badges.filter(b => b.level === 'gold').length > 0" class="badge-level-section">
                    <h4 class="badge-level-title gold">Gold</h4>
                    <div class="badges-grid-modal">
                      <div
                        v-for="badge in normalizedPlayer.badges.filter(b => b.level === 'gold')"
                        :key="badge.id"
                        class="badge-card-modal gold"
                        :class="{ 'synergy-active': isBadgeActivated(badge.id) }"
                        :title="getBadgeSynergyTooltip(badge)"
                      >
                        <Zap v-if="isBadgeActivated(badge.id)" :size="12" class="synergy-icon" />
                        <span class="badge-icon">G</span>
                        <span class="badge-name-modal">{{ formatBadgeName(badge) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Silver Badges -->
                  <div v-if="normalizedPlayer.badges.filter(b => b.level === 'silver').length > 0" class="badge-level-section">
                    <h4 class="badge-level-title silver">Silver</h4>
                    <div class="badges-grid-modal">
                      <div
                        v-for="badge in normalizedPlayer.badges.filter(b => b.level === 'silver')"
                        :key="badge.id"
                        class="badge-card-modal silver"
                        :class="{ 'synergy-active': isBadgeActivated(badge.id) }"
                        :title="getBadgeSynergyTooltip(badge)"
                      >
                        <Zap v-if="isBadgeActivated(badge.id)" :size="12" class="synergy-icon" />
                        <span class="badge-icon">S</span>
                        <span class="badge-name-modal">{{ formatBadgeName(badge) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Bronze Badges -->
                  <div v-if="normalizedPlayer.badges.filter(b => b.level === 'bronze').length > 0" class="badge-level-section">
                    <h4 class="badge-level-title bronze">Bronze</h4>
                    <div class="badges-grid-modal">
                      <div
                        v-for="badge in normalizedPlayer.badges.filter(b => b.level === 'bronze')"
                        :key="badge.id"
                        class="badge-card-modal bronze"
                        :class="{ 'synergy-active': isBadgeActivated(badge.id) }"
                        :title="getBadgeSynergyTooltip(badge)"
                      >
                        <Zap v-if="isBadgeActivated(badge.id)" :size="12" class="synergy-icon" />
                        <span class="badge-icon">B</span>
                        <span class="badge-name-modal">{{ formatBadgeName(badge) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="empty-state-modal">
                  <p>No badges earned yet.</p>
                  <p class="text-sm text-secondary">Badges are earned through gameplay performance.</p>
                </div>
              </div>

              <!-- Growth Tab (Season Evolution) -->
              <div v-if="activeTab === 'growth' && showGrowth" class="tab-panel">
                <div class="evolution-section">
                  <!-- Recent Evolution (Last 7 Days) -->
                  <div class="evolution-subsection">
                    <h5 class="evolution-subtitle">Recent (Last 7 Days)</h5>
                    <div v-if="recentEvolution.length > 0" class="evolution-list">
                      <div
                        v-for="(item, index) in (showAllRecentEvolution ? recentEvolution : recentEvolution.slice(0, 10))"
                        :key="`recent-${item.category}-${item.attribute}`"
                        class="evolution-item"
                      >
                        <span class="evolution-category">{{ formatCategoryName(item.category) }}</span>
                        <span class="evolution-attr">{{ formatAttrName(item.attribute) }}</span>
                        <span class="evolution-change" :style="{ color: getEvolutionColor(item.totalChange) }">
                          {{ formatChange(item.totalChange) }}
                        </span>
                      </div>
                      <button
                        v-if="recentEvolution.length > 10"
                        class="evolution-toggle"
                        @click="showAllRecentEvolution = !showAllRecentEvolution"
                      >
                        {{ showAllRecentEvolution ? 'Show Less' : `Show All (${recentEvolution.length})` }}
                      </button>
                    </div>
                    <div v-else class="evolution-empty">
                      No recent development activity
                    </div>
                  </div>

                  <!-- All-Time Evolution -->
                  <div class="evolution-subsection">
                    <button
                      class="evolution-alltime-header"
                      @click="showAllTimeExpanded = !showAllTimeExpanded"
                    >
                      <h5 class="evolution-subtitle">All-Time Evolution</h5>
                      <span class="evolution-toggle-icon">{{ showAllTimeExpanded ? '▼' : '▶' }}</span>
                    </button>
                    <div v-if="showAllTimeExpanded" class="evolution-list">
                      <template v-if="allTimeEvolution.length > 0">
                        <div
                          v-for="(item, index) in (showAllTimeEvolution ? allTimeEvolution : allTimeEvolution.slice(0, 10))"
                          :key="`alltime-${item.category}-${item.attribute}`"
                          class="evolution-item"
                        >
                          <span class="evolution-category">{{ formatCategoryName(item.category) }}</span>
                          <span class="evolution-attr">{{ formatAttrName(item.attribute) }}</span>
                          <span class="evolution-change" :style="{ color: getEvolutionColor(item.totalChange) }">
                            {{ formatChange(item.totalChange) }}
                          </span>
                          <span class="evolution-count">({{ item.count }}x)</span>
                        </div>
                        <button
                          v-if="allTimeEvolution.length > 10"
                          class="evolution-toggle"
                          @click="showAllTimeEvolution = !showAllTimeEvolution"
                        >
                          {{ showAllTimeEvolution ? 'Show Less' : `Show All (${allTimeEvolution.length})` }}
                        </button>
                      </template>
                      <div v-else class="evolution-empty">
                        No development history available
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- History Tab (Awards + News) -->
              <div v-if="activeTab === 'history' && showHistory" class="tab-panel">
                <!-- Awards Section -->
                <div class="history-section">
                  <h4 class="history-section-title">Awards</h4>
                  <div v-if="hasAwards" class="awards-grid">
                    <!-- Championships -->
                    <div v-if="normalizedPlayer.championships > 0" class="award-card gold">
                      <Trophy :size="32" />
                      <span class="award-count">{{ normalizedPlayer.championships }}x</span>
                      <span class="award-label">NBA Champion</span>
                    </div>

                    <!-- Finals MVP -->
                    <div v-if="normalizedPlayer.finals_mvp_awards > 0" class="award-card gold">
                      <Award :size="32" />
                      <span class="award-count">{{ normalizedPlayer.finals_mvp_awards }}x</span>
                      <span class="award-label">Finals MVP</span>
                    </div>

                    <!-- Conference Finals MVP -->
                    <div v-if="normalizedPlayer.conference_finals_mvp_awards > 0" class="award-card silver">
                      <Medal :size="32" />
                      <span class="award-count">{{ normalizedPlayer.conference_finals_mvp_awards }}x</span>
                      <span class="award-label">Conf Finals MVP</span>
                    </div>

                    <!-- League MVP -->
                    <div v-if="normalizedPlayer.mvp_awards > 0" class="award-card gold">
                      <Star :size="32" />
                      <span class="award-count">{{ normalizedPlayer.mvp_awards }}x</span>
                      <span class="award-label">League MVP</span>
                    </div>

                    <!-- All-Star -->
                    <div v-if="normalizedPlayer.all_star_selections > 0" class="award-card">
                      <Users :size="32" />
                      <span class="award-count">{{ normalizedPlayer.all_star_selections }}x</span>
                      <span class="award-label">All-Star</span>
                    </div>
                  </div>
                  <div v-else class="empty-state-inline">
                    <p>No awards yet</p>
                  </div>
                </div>

                <!-- News Section -->
                <div class="history-section">
                  <h4 class="history-section-title">News</h4>
                  <div v-if="playerNews.length > 0" class="news-list">
                    <div v-for="news in playerNews" :key="news.id" class="news-item">
                      <p class="news-headline">{{ news.headline }}</p>
                      <p class="news-date">{{ news.date }}</p>
                    </div>
                  </div>
                  <div v-else class="empty-state-inline">
                    <p>No news available</p>
                  </div>
                </div>
              </div>
            </div>
          </main>

          <!-- Footer -->
          <footer class="modal-footer">
            <div v-if="normalizedPlayer.contract" class="contract-info">
              <div class="contract-item">
                <span class="contract-label">Salary</span>
                <span class="contract-value text-success">{{ formatSalary(normalizedPlayer.contract.salary) }}/yr</span>
              </div>
              <div class="contract-item">
                <span class="contract-label">Years Remaining</span>
                <span class="contract-value">{{ normalizedPlayer.contract.years_remaining }}</span>
              </div>
            </div>
            <button class="btn-close-footer" @click="close">
              Close
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Modal Overlay & Container */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.modal-container {
  position: relative;
  width: 100%;
  max-width: 42rem;
  max-height: 90vh;
  background: var(--glass-bg-elevated, rgba(30, 35, 45, 0.98));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-lg);
  animation: scaleIn var(--duration-normal) var(--ease-out);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Modal Header */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.modal-header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.btn-close {
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

.btn-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

/* Modal Content (Scrollable) */
.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
}

.modal-content::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Opera */
}

/* Modal Footer */
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.contract-info {
  display: flex;
  gap: 2rem;
}

.btn-close-footer {
  padding: 10px 24px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-left: auto;
}

.btn-close-footer:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

/* Close Button (legacy, keeping for back-button support) */
.modal-close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 50%;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: var(--color-text-primary);
}

.back-button {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
}

.back-button:hover {
  text-decoration: underline;
}

/* Player Header */
.player-modal-header {
  padding: 1rem;
  background: var(--color-bg-tertiary);
  border-radius: 12px;
}

.player-modal-header.injured-header {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05));
}

.header-top-row {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.modal-player-avatar {
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.player-name-section {
  flex: 1;
  min-width: 0;
}

.name-rating-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.player-name-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
}

.rating-with-injury {
  position: relative;
  flex-shrink: 0;
}

.injury-badge-modal {
  position: absolute;
  bottom: -4px;
  right: -4px;
  padding: 2px 4px;
  background: var(--color-error);
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  border-radius: 4px;
}

.injured-name {
  color: var(--color-error) !important;
  text-decoration: line-through;
  text-decoration-color: rgba(239, 68, 68, 0.5);
}

.position-vitals-row {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.position-badges {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.position-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
}

.position-badge.secondary {
  opacity: 0.7;
}

.jersey-number {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
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

.player-vitals {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.player-vitals .divider {
  color: rgba(255, 255, 255, 0.2);
}

/* Fatigue Meter */
.fatigue-meter-container {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.fatigue-meter-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  min-width: 80px;
}

.fatigue-value {
  color: var(--color-text-primary);
  font-family: var(--font-mono, monospace);
}

.fatigue-meter-bar {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.fatigue-meter-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.fatigue-warning {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-error);
  animation: pulse-warning 2s ease-in-out infinite;
}

@keyframes pulse-warning {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.dynamic-duo-badge {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem;
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 140, 0, 0.15));
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 0.35rem;
  font-size: 0.7rem;
  color: #FFD700;
  font-weight: 600;
  margin-top: 0.25rem;
}

/* Badges Preview */
.badges-preview {
  padding: 0.75rem;
  background: var(--color-bg-tertiary);
  border-radius: 10px;
}

.badges-grid-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.badge-chip {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid;
  border-radius: 6px;
  font-size: 0.75rem;
}

.badge-level-icon {
  font-weight: 700;
  font-size: 0.65rem;
}

.badge-name-preview {
  color: var(--color-text-secondary);
}

.more-badges {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

/* Modal Tabs - styled like GM view tabs */
.modal-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 12px 0;
}

.tab-btn {
  padding: 0.5rem 1rem;
  border-radius: var(--radius-lg);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 0.875rem;
}

.tab-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.tab-btn.active {
  background: var(--gradient-cosmic);
  border-color: rgba(255, 255, 255, 0.2);
  color: #1a1520;
  font-weight: 700;
}

/* Modal Tab Content */
.modal-tab-content {
  min-height: 200px;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Stats Grid */
.stats-grid-modal {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.stat-cell .stat-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  letter-spacing: 0.5px;
}

.stat-cell .stat-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.stat-cell .stat-value.highlight {
  color: var(--color-primary);
}

/* Attributes Section */
.attr-section {
  margin-bottom: 1rem;
}

.attr-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
}

.attributes-grid {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.attr-row {
  display: grid;
  grid-template-columns: 120px 1fr 40px;
  align-items: center;
  gap: 0.5rem;
}

.attr-name {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
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
  font-size: 0.8rem;
  font-weight: 600;
  text-align: right;
}

/* Upgrade attr-row with extra column for upgrade button */
.attr-row.has-upgrade {
  grid-template-columns: 120px 1fr 40px 32px;
}

/* Upgrade Points UI */
.upgrade-points-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 12px;
  margin-bottom: 16px;
}

.upgrade-points-banner.no-points {
  background: rgba(107, 114, 128, 0.1);
  border-color: rgba(107, 114, 128, 0.3);
}

.points-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.points-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-success);
}

.points-value.zero {
  color: var(--color-text-tertiary);
}

.points-label {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.upgrade-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  margin: 0;
}

.upgrade-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-success);
  color: white;
  border: none;
  border-radius: 50%;
  font-size: 1.25rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.upgrade-btn:hover:not(:disabled) {
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(34, 197, 94, 0.4);
}

.upgrade-btn:disabled {
  background: var(--color-text-tertiary);
  opacity: 0.5;
  cursor: not-allowed;
}

.no-upgrade-hint {
  font-weight: 400;
  font-size: 0.65rem;
  color: var(--color-text-tertiary);
  text-transform: none;
  margin-left: 6px;
}

/* Badges Section */
.badges-tab-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.badge-level-section {
  margin-bottom: 0.5rem;
}

.badge-level-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 0.5rem;
}

.badge-level-title.hof { color: #9B59B6; }
.badge-level-title.gold { color: #FFD700; }
.badge-level-title.silver { color: #C0C0C0; }
.badge-level-title.bronze { color: #CD7F32; }

.badges-grid-modal {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.5rem;
}

.badge-card-modal {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.badge-card-modal.hof {
  border-color: rgba(155, 89, 182, 0.3);
  background: rgba(155, 89, 182, 0.1);
}

.badge-card-modal.gold {
  border-color: rgba(255, 215, 0, 0.3);
  background: rgba(255, 215, 0, 0.1);
}

.badge-card-modal.silver {
  border-color: rgba(192, 192, 192, 0.3);
  background: rgba(192, 192, 192, 0.1);
}

.badge-card-modal.bronze {
  border-color: rgba(205, 127, 50, 0.3);
  background: rgba(205, 127, 50, 0.1);
}

.badge-icon {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 2px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.1);
}

.badge-name-modal {
  font-size: 0.8rem;
  color: var(--color-text-primary);
}

/* Badge synergy activation */
.badge-chip.synergy-active {
  background: rgba(0, 229, 255, 0.1);
  box-shadow: 0 0 6px rgba(0, 229, 255, 0.3);
}

.badge-card-modal.synergy-active {
  border-color: rgba(0, 229, 255, 0.5) !important;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.2);
}

.synergy-icon {
  color: #00E5FF;
  flex-shrink: 0;
}

/* Awards Section */
.awards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 1rem;
}

.award-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  text-align: center;
}

.award-card.gold {
  border-color: rgba(255, 215, 0, 0.3);
  background: rgba(255, 215, 0, 0.1);
  color: #FFD700;
}

.award-card.silver {
  border-color: rgba(192, 192, 192, 0.3);
  background: rgba(192, 192, 192, 0.1);
  color: #C0C0C0;
}

.award-count {
  font-size: 1.25rem;
  font-weight: 700;
}

.award-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

/* Contract Footer */

.contract-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.contract-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-tertiary);
}

.contract-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Empty State */
.empty-state-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

.empty-state-modal .empty-icon {
  margin-bottom: 1rem;
  opacity: 0.5;
}

.empty-state-inline {
  padding: 1rem;
  color: var(--color-text-tertiary);
  font-size: 0.875rem;
}

/* Evolution Section */
.evolution-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.evolution-subsection {
  margin-bottom: 0.5rem;
}

.evolution-subtitle {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin: 0 0 0.5rem 0;
}

.evolution-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.evolution-item {
  display: grid;
  grid-template-columns: 80px 1fr auto auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  font-size: 0.8rem;
}

.evolution-category {
  color: var(--color-text-tertiary);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.evolution-attr {
  color: var(--color-text-secondary);
}

.evolution-change {
  font-weight: 600;
  font-family: var(--font-mono);
}

.evolution-count {
  color: var(--color-text-tertiary);
  font-size: 0.7rem;
}

.evolution-toggle {
  margin-top: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.evolution-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

.evolution-empty {
  padding: 0.75rem;
  color: var(--color-text-tertiary);
  font-size: 0.8rem;
  text-align: center;
}

.evolution-alltime-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.evolution-alltime-header:hover {
  background: rgba(255, 255, 255, 0.06);
}

.evolution-toggle-icon {
  color: var(--color-text-tertiary);
  font-size: 0.7rem;
}

/* History Section */
.history-section {
  margin-bottom: 1.5rem;
}

.history-section:last-child {
  margin-bottom: 0;
}

.history-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

/* News List */
.news-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.news-item {
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border-left: 3px solid var(--color-primary);
}

.news-headline {
  margin: 0 0 0.25rem 0;
  color: var(--color-text-primary);
  font-size: 0.875rem;
}

.news-date {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
}

/* Modal Transition */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

/* Light mode */
[data-theme="light"] .modal-container {
  background: rgba(255, 255, 255, 0.98);
}

[data-theme="light"] .modal-close-btn {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .modal-close-btn:hover {
  background: rgba(0, 0, 0, 0.12);
}

[data-theme="light"] .player-modal-header {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .player-modal-header.injured-header {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.04));
}

[data-theme="light"] .modal-player-avatar {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .fatigue-meter-container {
  border-top-color: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .fatigue-meter-bar {
  background: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .player-vitals .divider {
  color: rgba(0, 0, 0, 0.2);
}

[data-theme="light"] .badges-preview {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .badge-chip {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .stat-cell {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .attr-bar-container {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .badge-card-modal {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .badge-card-modal.hof {
  background: rgba(155, 89, 182, 0.08);
  border-color: rgba(155, 89, 182, 0.25);
}

[data-theme="light"] .badge-card-modal.gold {
  background: rgba(255, 215, 0, 0.08);
  border-color: rgba(255, 215, 0, 0.25);
}

[data-theme="light"] .badge-card-modal.silver {
  background: rgba(192, 192, 192, 0.15);
  border-color: rgba(128, 128, 128, 0.25);
}

[data-theme="light"] .badge-card-modal.bronze {
  background: rgba(205, 127, 50, 0.08);
  border-color: rgba(205, 127, 50, 0.25);
}

[data-theme="light"] .badge-icon {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .award-card {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .award-card.gold {
  background: rgba(255, 215, 0, 0.1);
  border-color: rgba(255, 215, 0, 0.3);
}

[data-theme="light"] .award-card.silver {
  background: rgba(192, 192, 192, 0.15);
  border-color: rgba(128, 128, 128, 0.3);
}

[data-theme="light"] .modal-header {
  border-bottom-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .modal-footer {
  border-top-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .evolution-item {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .evolution-toggle {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .evolution-toggle:hover {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .evolution-alltime-header {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .evolution-alltime-header:hover {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .history-section-title {
  border-bottom-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .news-item {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .upgrade-points-banner {
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.25);
}

[data-theme="light"] .upgrade-points-banner.no-points {
  background: rgba(107, 114, 128, 0.08);
  border-color: rgba(107, 114, 128, 0.2);
}

/* Mobile Responsive Styles */
@media (max-width: 480px) {
  .modal-container {
    max-height: 95vh;
  }

  .modal-header {
    padding: 12px 16px;
  }

  .modal-title {
    font-size: 1.25rem;
  }

  .modal-content {
    padding: 16px;
  }

  .modal-footer {
    padding: 12px 16px;
  }

  .player-modal-header {
    padding: 0.75rem;
  }

  .modal-player-avatar {
    width: 56px;
    height: 56px;
  }

  .player-name-title {
    font-size: 1.1rem;
  }

  .player-vitals {
    font-size: 0.75rem;
    flex-wrap: wrap;
  }

  .modal-tabs {
    padding: 10px 0;
    gap: 0.375rem;
  }

  .tab-btn {
    padding: 0.4rem 0.75rem;
    font-size: 0.75rem;
  }

  .stats-grid-modal {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.375rem;
  }

  .stat-cell .stat-value {
    font-size: 0.9rem;
  }

  .attr-row {
    grid-template-columns: 100px 1fr 36px;
  }

  .attr-row.has-upgrade {
    grid-template-columns: 100px 1fr 36px 28px;
  }

  .attr-name {
    font-size: 0.7rem;
  }

  .attr-value {
    font-size: 0.7rem;
  }

  .modal-footer {
    flex-wrap: wrap;
    gap: 12px;
  }

  .contract-info {
    gap: 1.5rem;
  }

  .contract-label {
    font-size: 0.65rem;
  }

  .contract-value {
    font-size: 0.9rem;
  }

  .btn-close-footer {
    padding: 8px 20px;
    font-size: 0.8rem;
  }

  .badges-grid-modal {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }

  .badge-name-modal {
    font-size: 0.7rem;
  }

  .awards-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 0.75rem;
  }

  .award-card {
    padding: 0.75rem;
  }

  .upgrade-points-banner {
    padding: 10px 12px;
    flex-direction: column;
    gap: 6px;
    text-align: center;
  }

  .points-value {
    font-size: 1.25rem;
  }
}

/* Recent Games (Game Log Table) */
.recent-performances-section {
  margin-top: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-lg);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.recent-performances-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin-bottom: 10px;
}

.game-log-table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

.game-log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.7rem;
  white-space: nowrap;
  min-width: 520px;
}

.game-log-table th {
  padding: 4px 6px;
  text-align: center;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.6rem;
}

.game-log-table td {
  padding: 5px 6px;
  text-align: center;
  color: var(--color-text-secondary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.game-log-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.04);
}

.game-log-date {
  text-align: left !important;
  color: var(--color-text-tertiary) !important;
}

.game-log-opp {
  font-weight: 600;
  color: var(--color-text-primary) !important;
}

.game-log-pts {
  font-weight: 700;
  color: var(--color-text-primary) !important;
}

.game-log-win {
  color: var(--color-success) !important;
  font-weight: 700;
}

.game-log-loss {
  color: var(--color-error) !important;
  font-weight: 700;
}
</style>
