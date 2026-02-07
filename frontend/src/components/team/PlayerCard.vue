<script setup>
import { computed } from 'vue'
import { StatBadge, Badge } from '@/components/ui'

const props = defineProps({
  player: {
    type: Object,
    required: true
  },
  showDetails: {
    type: Boolean,
    default: false
  },
  selected: {
    type: Boolean,
    default: false
  },
  compact: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click', 'select'])

const positionColors = {
  PG: '#3B82F6',
  SG: '#10B981',
  SF: '#F59E0B',
  PF: '#EF4444',
  C: '#8B5CF6'
}

const positionColor = computed(() => positionColors[props.player.position] || '#6B7280')

const isInjured = computed(() => props.player.is_injured || props.player.isInjured)

const ratingClass = computed(() => {
  const rating = props.player.overall_rating
  if (rating >= 90) return 'elite'
  if (rating >= 80) return 'star'
  if (rating >= 70) return 'starter'
  if (rating >= 60) return 'rotation'
  return 'bench'
})

const topBadges = computed(() => {
  const badges = props.player.badges || []
  // Sort by level (HOF > Gold > Silver > Bronze) and take top 3
  const levelOrder = { hof: 0, gold: 1, silver: 2, bronze: 3 }
  return [...badges]
    .sort((a, b) => (levelOrder[a.level] || 4) - (levelOrder[b.level] || 4))
    .slice(0, 3)
})

function formatBadgeName(badgeId) {
  if (!badgeId) return ''
  return badgeId
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatSalary(salary) {
  if (!salary) return '-'
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
</script>

<template>
  <div
    class="player-card"
    :class="{ selected, compact, injured: isInjured, [ratingClass]: true }"
    @click="emit('click', player)"
  >
    <!-- Compact View -->
    <template v-if="compact">
      <div class="flex items-center gap-3 p-3">
        <div class="rating-wrapper">
          <StatBadge :value="player.overall_rating" size="sm" />
          <span v-if="isInjured" class="injury-badge-sm" title="Injured">INJ</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-medium truncate" :class="{ 'text-injured': isInjured }">{{ player.name }}</p>
          <div class="flex items-center gap-2 text-xs text-secondary">
            <span
              class="position-badge"
              :style="{ backgroundColor: positionColor }"
            >
              {{ player.position }}<template v-if="player.secondary_position">/{{ player.secondary_position }}</template>
            </span>
            <span v-if="isInjured" class="injury-label">Injured</span>
            <span v-else-if="player.contract">{{ formatSalary(player.contract.salary) }}</span>
          </div>
        </div>
        <button
          v-if="showDetails"
          class="select-btn"
          :class="{ active: selected }"
          @click.stop="emit('select', player)"
        >
          {{ selected ? 'Selected' : 'Select' }}
        </button>
      </div>
    </template>

    <!-- Full View -->
    <template v-else>
      <div class="card-header">
        <div class="rating-container">
          <StatBadge :value="player.overall_rating" size="lg" />
          <span v-if="isInjured" class="injury-badge" title="Injured">INJ</span>
        </div>
        <div class="player-info">
          <h3 class="player-name" :class="{ 'text-injured': isInjured }">{{ player.name }}</h3>
          <div class="player-meta">
            <span
              class="position-badge"
              :style="{ backgroundColor: positionColor }"
            >
              {{ player.position }}<template v-if="player.secondary_position">/{{ player.secondary_position }}</template>
            </span>
            <span class="jersey-number">#{{ player.jersey_number || '00' }}</span>
            <span v-if="isInjured" class="injury-tag">Injured</span>
          </div>
        </div>
      </div>

      <div class="card-body">
        <!-- Physical -->
        <div class="physical-info">
          <span>{{ player.height || "6'6\"" }}</span>
          <span class="divider">|</span>
          <span>{{ player.weight || '210' }} lbs</span>
          <span class="divider">|</span>
          <span>Age {{ player.age || 25 }}</span>
        </div>

        <!-- Season Stats -->
        <div v-if="player.season_stats" class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">PPG</span>
            <span class="stat-value">{{ player.season_stats.ppg }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">RPG</span>
            <span class="stat-value">{{ player.season_stats.rpg }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">APG</span>
            <span class="stat-value">{{ player.season_stats.apg }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">GP</span>
            <span class="stat-value">{{ player.season_stats.games_played }}</span>
          </div>
        </div>
        <!-- No stats yet -->
        <div v-else class="no-stats">
          <span class="text-secondary text-sm">No stats yet</span>
        </div>

        <!-- Badges -->
        <div v-if="topBadges.length > 0" class="badges-row">
          <div
            v-for="badge in topBadges"
            :key="badge.id"
            class="badge-item"
            :title="`${formatBadgeName(badge.id)} (${badge.level})`"
          >
            <span
              class="badge-dot"
              :style="{ backgroundColor: getBadgeLevelColor(badge.level) }"
            />
            <span class="badge-name">{{ formatBadgeName(badge.id) }}</span>
          </div>
        </div>

        <!-- Contract -->
        <div v-if="player.contract" class="contract-info">
          <span class="contract-salary">{{ formatSalary(player.contract.salary) }}/yr</span>
          <span class="contract-years">{{ player.contract.years_remaining }} yr{{ player.contract.years_remaining !== 1 ? 's' : '' }}</span>
        </div>
      </div>

      <div v-if="showDetails" class="card-footer">
        <button
          class="view-btn"
          @click.stop="emit('click', player)"
        >
          View Details
        </button>
        <button
          class="select-btn"
          :class="{ active: selected }"
          @click.stop="emit('select', player)"
        >
          {{ selected ? 'Selected' : 'Select' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.player-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  transition: all 0.2s ease;
}

.player-card:hover {
  background: var(--glass-bg-light);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.player-card.selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}

.player-card.elite .card-header {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(232, 90, 79, 0.15));
}

.player-card.star .card-header {
  background: linear-gradient(135deg, rgba(232, 90, 79, 0.15), rgba(244, 162, 89, 0.15));
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--color-bg-tertiary);
}

.rating-container {
  flex-shrink: 0;
}

.player-info {
  flex: 1;
  min-width: 0;
}

.player-name {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.position-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
}

.jersey-number {
  color: var(--color-secondary);
  font-size: 0.875rem;
}

.card-body {
  padding: 16px;
}

.physical-info {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-secondary);
  font-size: 0.875rem;
  margin-bottom: 12px;
}

.divider {
  color: rgba(255, 255, 255, 0.2);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.stat-item {
  text-align: center;
  padding: 8px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-lg);
}

.stat-label {
  display: block;
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-value {
  font-weight: 600;
  font-size: 1rem;
  font-family: var(--font-mono);
  color: var(--color-primary);
}

.no-stats {
  padding: 12px;
  text-align: center;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
  margin-bottom: 12px;
}

.badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.badge-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
}

.badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.badge-name {
  color: var(--color-secondary);
}

.contract-info {
  display: flex;
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.contract-salary {
  font-weight: 600;
  color: var(--color-success);
}

.contract-years {
  color: var(--color-secondary);
}

.card-footer {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--glass-border);
}

.view-btn,
.select-btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-default);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.view-btn {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.view-btn:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-tertiary);
}

.select-btn {
  background: var(--color-primary);
  border: none;
  color: white;
}

.select-btn:hover {
  background: var(--color-primary-dark);
}

.select-btn.active {
  background: var(--color-success);
}

/* Compact styles */
.player-card.compact {
  cursor: pointer;
}

.player-card.compact .select-btn {
  flex: none;
  padding: 4px 12px;
  font-size: 0.75rem;
}

/* Injury styles */
.player-card.injured {
  opacity: 0.75;
  border-color: var(--color-error);
}

.player-card.injured .card-header {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05)) !important;
}

.rating-wrapper {
  position: relative;
  flex-shrink: 0;
}

.rating-container {
  position: relative;
}

.injury-badge,
.injury-badge-sm {
  position: absolute;
  background: var(--color-error);
  color: white;
  font-weight: 700;
  border-radius: 4px;
  text-transform: uppercase;
}

.injury-badge {
  bottom: -4px;
  right: -4px;
  padding: 2px 4px;
  font-size: 0.6rem;
}

.injury-badge-sm {
  bottom: -2px;
  right: -2px;
  padding: 1px 3px;
  font-size: 0.5rem;
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

.injury-label {
  color: var(--color-error);
  font-weight: 600;
}

.text-injured {
  color: var(--color-error) !important;
  text-decoration: line-through;
  text-decoration-color: rgba(239, 68, 68, 0.5);
}

/* Light mode overrides */
[data-theme="light"] .player-card:hover {
  border-color: rgba(0, 0, 0, 0.15);
}

[data-theme="light"] .contract-info {
  border-top-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .empty-slot {
  color: rgba(0, 0, 0, 0.3);
}
</style>
