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
    :class="{ selected, compact, [ratingClass]: true }"
    @click="emit('click', player)"
  >
    <!-- Compact View -->
    <template v-if="compact">
      <div class="flex items-center gap-3 p-3">
        <StatBadge :value="player.overall_rating" size="sm" />
        <div class="flex-1 min-w-0">
          <p class="font-medium truncate">{{ player.name }}</p>
          <div class="flex items-center gap-2 text-xs text-secondary">
            <span
              class="position-badge"
              :style="{ backgroundColor: positionColor }"
            >
              {{ player.position }}
            </span>
            <span v-if="player.contract">{{ formatSalary(player.contract.salary) }}</span>
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
        </div>
        <div class="player-info">
          <h3 class="player-name">{{ player.name }}</h3>
          <div class="player-meta">
            <span
              class="position-badge"
              :style="{ backgroundColor: positionColor }"
            >
              {{ player.position }}
            </span>
            <span class="jersey-number">#{{ player.jersey_number || '00' }}</span>
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

        <!-- Key Attributes -->
        <div v-if="showDetails && player.attributes" class="attributes-grid">
          <div class="attr-item">
            <span class="attr-label">SPD</span>
            <span class="attr-value">{{ player.attributes.speed || '-' }}</span>
          </div>
          <div class="attr-item">
            <span class="attr-label">3PT</span>
            <span class="attr-value">{{ player.attributes.three_point || '-' }}</span>
          </div>
          <div class="attr-item">
            <span class="attr-label">DNK</span>
            <span class="attr-value">{{ player.attributes.dunk || '-' }}</span>
          </div>
          <div class="attr-item">
            <span class="attr-label">DEF</span>
            <span class="attr-value">{{ player.attributes.perimeter_defense || '-' }}</span>
          </div>
        </div>

        <!-- Badges -->
        <div v-if="topBadges.length > 0" class="badges-row">
          <div
            v-for="badge in topBadges"
            :key="badge.id"
            class="badge-item"
            :title="`${badge.name} (${badge.level})`"
          >
            <span
              class="badge-dot"
              :style="{ backgroundColor: getBadgeLevelColor(badge.level) }"
            />
            <span class="badge-name">{{ badge.name }}</span>
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
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s ease;
}

.player-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
}

.player-card.selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}

.player-card.elite .card-header {
  background: linear-gradient(135deg, rgba(147, 51, 234, 0.2), rgba(236, 72, 153, 0.2));
}

.player-card.star .card-header {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(147, 51, 234, 0.2));
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
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

.attributes-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.attr-item {
  text-align: center;
  padding: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.attr-label {
  display: block;
  font-size: 0.75rem;
  color: var(--color-secondary);
  margin-bottom: 2px;
}

.attr-value {
  font-weight: 600;
  font-size: 1rem;
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
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
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
  background: rgba(0, 0, 0, 0.2);
}

.view-btn,
.select-btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.view-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
}

.view-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.select-btn {
  background: var(--color-primary);
  border: none;
  color: white;
}

.select-btn:hover {
  filter: brightness(1.1);
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
</style>
