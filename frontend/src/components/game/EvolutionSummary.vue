<script setup>
import { computed } from 'vue'
import { TrendingUp, TrendingDown, AlertTriangle, Flame, Snowflake, Heart, Activity, Loader2 } from 'lucide-vue-next'

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
  }
})

const teamEvolution = computed(() => {
  if (!props.evolution) return null
  return props.evolution[props.teamKey] || null
})

const hasAnyData = computed(() => {
  if (!teamEvolution.value) return false
  const te = teamEvolution.value
  return (
    te.injuries?.length > 0 ||
    te.development?.length > 0 ||
    te.regression?.length > 0 ||
    te.hot_streaks?.length > 0 ||
    te.cold_streaks?.length > 0 ||
    te.fatigue_warnings?.length > 0 ||
    te.morale_changes?.length > 0
  )
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

    <!-- Injuries -->
    <div v-if="teamEvolution.injuries?.length" class="evolution-section injuries">
      <div
        v-for="injury in teamEvolution.injuries"
        :key="injury.player_id"
        class="evolution-item injury"
      >
        <AlertTriangle :size="14" :style="{ color: getSeverityColor(injury.severity) }" />
        <span class="player-name">{{ injury.name }}</span>
        <span class="injury-info">
          {{ injury.injury_type }} ({{ injury.games_out }} games)
        </span>
      </div>
    </div>

    <!-- Development -->
    <div v-if="teamEvolution.development?.length" class="evolution-section development">
      <div
        v-for="dev in teamEvolution.development"
        :key="dev.player_id"
        class="evolution-item positive"
      >
        <TrendingUp :size="14" />
        <span class="player-name">{{ dev.name }}</span>
        <span class="stat-badges">
          <span
            v-for="attr in dev.attributes_improved"
            :key="attr"
            class="attr-badge positive"
          >
            +{{ formatAttribute(attr) }}
          </span>
        </span>
      </div>
    </div>

    <!-- Regression -->
    <div v-if="teamEvolution.regression?.length" class="evolution-section regression">
      <div
        v-for="reg in teamEvolution.regression"
        :key="reg.player_id"
        class="evolution-item negative"
      >
        <TrendingDown :size="14" />
        <span class="player-name">{{ reg.name }}</span>
        <span class="stat-badges">
          <span
            v-for="attr in reg.attributes_declined"
            :key="attr"
            class="attr-badge negative"
          >
            -{{ formatAttribute(attr) }}
          </span>
        </span>
      </div>
    </div>

    <!-- Hot Streaks -->
    <div v-if="teamEvolution.hot_streaks?.length" class="evolution-section streaks">
      <div
        v-for="streak in teamEvolution.hot_streaks"
        :key="streak.player_id"
        class="evolution-item hot"
      >
        <Flame :size="14" />
        <span class="player-name">{{ streak.name }}</span>
        <span class="streak-info">{{ streak.games }} game hot streak!</span>
      </div>
    </div>

    <!-- Cold Streaks -->
    <div v-if="teamEvolution.cold_streaks?.length" class="evolution-section streaks">
      <div
        v-for="streak in teamEvolution.cold_streaks"
        :key="streak.player_id"
        class="evolution-item cold"
      >
        <Snowflake :size="14" />
        <span class="player-name">{{ streak.name }}</span>
        <span class="streak-info">{{ streak.games }} game cold streak</span>
      </div>
    </div>

    <!-- Fatigue Warnings -->
    <div v-if="teamEvolution.fatigue_warnings?.length" class="evolution-section fatigue">
      <div
        v-for="warn in teamEvolution.fatigue_warnings"
        :key="warn.player_id"
        class="evolution-item warning"
      >
        <Activity :size="14" />
        <span class="player-name">{{ warn.name }}</span>
        <span class="fatigue-info">Fatigue: {{ warn.fatigue }}%</span>
      </div>
    </div>

    <!-- Morale Changes -->
    <div v-if="teamEvolution.morale_changes?.length" class="evolution-section morale">
      <div
        v-for="morale in teamEvolution.morale_changes"
        :key="morale.player_id"
        class="evolution-item"
        :class="morale.change > 0 ? 'positive' : 'negative'"
      >
        <Heart :size="14" />
        <span class="player-name">{{ morale.name }}</span>
        <span class="morale-info">
          Morale {{ morale.change > 0 ? '+' : '' }}{{ morale.change }}
        </span>
      </div>
    </div>
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

.evolution-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.evolution-section:last-child {
  margin-bottom: 0;
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

/* Light mode */
[data-theme="light"] .evolution-item {
  background: rgba(0, 0, 0, 0.03);
}
</style>
