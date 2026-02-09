<script setup>
import { computed, ref } from 'vue'
import { TrendingUp, TrendingDown, AlertTriangle, Flame, Snowflake, Heart, Activity, Loader2, ChevronDown } from 'lucide-vue-next'

const props = defineProps({
  evolution: {
    type: Object,
    default: null
  },
  teamKey: {
    type: String,
    default: 'home' // 'home' or 'away'
  },
  teamName: {
    type: String,
    default: ''
  },
  loading: {
    type: Boolean,
    default: false
  },
  limit: {
    type: Number,
    default: 0 // 0 = no limit
  }
})

const expanded = ref(false)

const teamEvolution = computed(() => {
  if (!props.evolution) return null
  return props.evolution[props.teamKey] || null
})

// Flatten all items into a single array with type info
const allItems = computed(() => {
  if (!teamEvolution.value) return []
  const te = teamEvolution.value
  const items = []

  // Add injuries first (most important)
  te.injuries?.forEach(item => items.push({ ...item, type: 'injury' }))
  // Then development
  te.development?.forEach(item => items.push({ ...item, type: 'development' }))
  // Then regression
  te.regression?.forEach(item => items.push({ ...item, type: 'regression' }))
  // Hot streaks
  te.hot_streaks?.forEach(item => items.push({ ...item, type: 'hot_streak' }))
  // Cold streaks
  te.cold_streaks?.forEach(item => items.push({ ...item, type: 'cold_streak' }))
  // Fatigue warnings
  te.fatigue_warnings?.forEach(item => items.push({ ...item, type: 'fatigue' }))
  // Morale changes
  te.morale_changes?.forEach(item => items.push({ ...item, type: 'morale' }))

  return items
})

const displayItems = computed(() => {
  if (!props.limit || expanded.value) return allItems.value
  return allItems.value.slice(0, props.limit)
})

const hasMore = computed(() => {
  return props.limit > 0 && allItems.value.length > props.limit
})

const remainingCount = computed(() => {
  return allItems.value.length - props.limit
})

const hasAnyData = computed(() => {
  return allItems.value.length > 0
})

// Get injury severity color
function getSeverityColor(severity) {
  switch (severity) {
    case 'minor': return 'var(--color-warning)'
    case 'moderate': return 'var(--color-warning)'
    case 'severe': return 'var(--color-error)'
    case 'season_ending': return 'var(--color-error)'
    default: return 'var(--color-warning)'
  }
}

// Format attribute name for display
function formatAttribute(attr) {
  // Convert "offense.threePoint" to "3PT"
  const attrMap = {
    'offense.threePoint': '3PT',
    'offense.midRange': 'MID',
    'offense.layup': 'LAYUP',
    'offense.passAccuracy': 'PASS',
    'defense.defensiveRebound': 'DREB',
    'defense.offensiveRebound': 'OREB',
    'defense.steal': 'STL',
    'defense.block': 'BLK',
  }
  return attrMap[attr] || attr.split('.').pop().toUpperCase()
}
</script>

<template>
  <!-- Loading State -->
  <div v-if="loading" class="evolution-summary evolution-loading">
    <div class="loading-content">
      <Loader2 :size="20" class="spinner" />
      <span>Loading team updates...</span>
    </div>
  </div>

  <!-- Data State -->
  <div v-else-if="hasAnyData" class="evolution-summary">
    <h4 class="evolution-title">
      <Activity :size="14" />
      {{ teamName }} Updates
    </h4>

    <!-- Unified Items Display -->
    <div class="evolution-items">
      <div
        v-for="(item, index) in displayItems"
        :key="`${item.type}-${item.player_id}-${index}`"
        class="evolution-item"
        :class="{
          injury: item.type === 'injury',
          positive: item.type === 'development' || (item.type === 'morale' && item.change > 0),
          negative: item.type === 'regression' || (item.type === 'morale' && item.change < 0),
          hot: item.type === 'hot_streak',
          cold: item.type === 'cold_streak',
          warning: item.type === 'fatigue'
        }"
      >
        <!-- Icon based on type -->
        <AlertTriangle v-if="item.type === 'injury'" :size="14" :style="{ color: getSeverityColor(item.severity) }" />
        <TrendingUp v-else-if="item.type === 'development'" :size="14" />
        <TrendingDown v-else-if="item.type === 'regression'" :size="14" />
        <Flame v-else-if="item.type === 'hot_streak'" :size="14" />
        <Snowflake v-else-if="item.type === 'cold_streak'" :size="14" />
        <Activity v-else-if="item.type === 'fatigue'" :size="14" />
        <Heart v-else-if="item.type === 'morale'" :size="14" />

        <span class="player-name">{{ item.name }}</span>

        <!-- Content based on type -->
        <span v-if="item.type === 'injury'" class="injury-info">
          {{ item.injury_type }} ({{ item.games_out }} games)
        </span>
        <span v-else-if="item.type === 'development'" class="stat-badges">
          <span v-for="attr in item.attributes_improved" :key="attr" class="attr-badge positive">
            +{{ formatAttribute(attr) }}
          </span>
        </span>
        <span v-else-if="item.type === 'regression'" class="stat-badges">
          <span v-for="attr in item.attributes_declined" :key="attr" class="attr-badge negative">
            -{{ formatAttribute(attr) }}
          </span>
        </span>
        <span v-else-if="item.type === 'hot_streak'" class="streak-info">{{ item.games }} game hot streak!</span>
        <span v-else-if="item.type === 'cold_streak'" class="streak-info">{{ item.games }} game cold streak</span>
        <span v-else-if="item.type === 'fatigue'" class="fatigue-info">Fatigue: {{ item.fatigue }}%</span>
        <span v-else-if="item.type === 'morale'" class="morale-info">
          Morale {{ item.change > 0 ? '+' : '' }}{{ item.change }}
        </span>
      </div>
    </div>

    <!-- View More Button -->
    <button v-if="hasMore && !expanded" class="view-more-btn" @click="expanded = true">
      <span>View {{ remainingCount }} more</span>
      <ChevronDown :size="16" />
    </button>
  </div>
</template>

<style scoped>
.evolution-summary {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 12px;
  margin-top: 12px;
}

.evolution-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin: 0 0 10px 0;
}

.evolution-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.evolution-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-md);
}

.evolution-item.positive {
  color: var(--color-success);
}

.evolution-item.negative {
  color: var(--color-error);
}

.evolution-item.hot {
  color: #ff6b35;
}

.evolution-item.cold {
  color: #4fc3f7;
}

.evolution-item.warning {
  color: var(--color-warning);
}

.evolution-item.injury {
  color: var(--color-error);
}

.player-name {
  font-weight: 600;
  color: var(--color-text-primary);
  min-width: 100px;
}

.injury-info,
.streak-info,
.fatigue-info,
.morale-info {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-left: auto;
}

.stat-badges {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.attr-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.attr-badge.positive {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-success);
}

.attr-badge.negative {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-error);
}

/* Loading state */
.evolution-loading {
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-content {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* View More Button */
.view-more-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px;
  margin-top: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.view-more-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

/* Light mode */
[data-theme="light"] .evolution-item {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .view-more-btn {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .view-more-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}
</style>
