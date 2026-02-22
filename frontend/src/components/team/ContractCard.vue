<script setup>
import { computed } from 'vue'
import { User, AlertTriangle, RefreshCw, UserMinus } from 'lucide-vue-next'
import { StatBadge } from '@/components/ui'

const props = defineProps({
  player: {
    type: Object,
    required: true
  },
  showStats: {
    type: Boolean,
    default: false
  },
  showAttributes: {
    type: Boolean,
    default: false
  },
  showActions: {
    type: Boolean,
    default: true
  },
  isFreeAgent: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['resign', 'drop', 'sign', 'info'])

const isExpiringContract = computed(() => {
  return props.player.contractYearsRemaining === 1
})

function getPositionColor(position) {
  const colors = {
    PG: '#3B82F6',
    SG: '#10B981',
    SF: '#F59E0B',
    PF: '#EF4444',
    C: '#8B5CF6',
  }
  return colors[position] || '#6B7280'
}

function formatSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1000000) {
    return `$${Math.round(salary / 1000000)}M`
  }
  return `$${Math.round(salary / 1000)}K`
}

function formatContractYears(years) {
  if (!years || years <= 0) return 'FA'
  if (years === 1) return '1 yr'
  return `${years} yrs`
}

function roundStat(value) {
  if (value === null || value === undefined) return '0'
  return Math.round(value)
}

function roundStatDecimal(value) {
  if (value === null || value === undefined) return '0.0'
  return value.toFixed(1)
}

// Calculate contract bar width (max 5 years)
const contractBarWidth = computed(() => {
  const years = props.player.contractYearsRemaining || 0
  return Math.min(years / 5, 1) * 100
})

function handleResign() {
  emit('resign', props.player)
}

function handleDrop() {
  emit('drop', props.player)
}

function handleSign() {
  emit('sign', props.player)
}

function handleInfo() {
  emit('info', props.player)
}
</script>

<template>
  <div
    class="contract-card"
    :class="{ expiring: isExpiringContract && !isFreeAgent }"
    @click="handleInfo"
  >
    <div class="card-content">
      <!-- Left Column: Avatar + Buttons -->
      <div class="left-column">
        <div class="player-avatar">
          <User :size="28" />
          <div v-if="isExpiringContract && !isFreeAgent" class="expiring-indicator" title="Expiring contract">
            <AlertTriangle :size="12" />
          </div>
        </div>

        <!-- Action Buttons for Team Players -->
        <div v-if="showActions && !isFreeAgent" class="action-buttons">
          <button
            v-if="isExpiringContract"
            class="action-btn resign-btn"
            @click.stop="handleResign"
            title="Re-sign player"
          >
            <RefreshCw :size="14" />
            <span>Re-sign</span>
          </button>
          <button
            class="action-btn drop-btn"
            @click.stop="handleDrop"
            title="Drop player"
          >
            <UserMinus :size="14" />
            <span>Drop</span>
          </button>
        </div>

        <!-- Sign Button for Free Agents -->
        <div v-if="showActions && isFreeAgent" class="action-buttons">
          <button
            class="action-btn sign-btn"
            @click.stop="handleSign"
            title="Sign player"
          >
            <User :size="14" />
            <span>Sign</span>
          </button>
        </div>
      </div>

      <!-- Player Info -->
      <div class="player-info">
        <div class="player-header">
          <span class="player-name">{{ player.firstName }} {{ player.lastName }}</span>
          <div class="player-badges">
            <span
              class="position-badge"
              :style="{ backgroundColor: getPositionColor(player.position) }"
            >
              {{ player.position }}
            </span>
            <span
              v-if="player.secondaryPosition"
              class="position-badge secondary"
              :style="{ backgroundColor: getPositionColor(player.secondaryPosition) }"
            >
              {{ player.secondaryPosition }}
            </span>
          </div>
        </div>

        <div class="player-meta">
          <StatBadge :value="player.overallRating" size="xs" />
          <span class="player-age">{{ player.age }} yrs</span>
          <span v-if="player.potentialRating && player.potentialRating > player.overallRating" class="player-potential">
            ({{ player.potentialRating }} pot)
          </span>
        </div>

        <!-- Contract Details (for team players) -->
        <div v-if="!isFreeAgent" class="contract-details">
          <div class="contract-main">
            <span class="contract-salary">{{ formatSalary(player.contractSalary) }}</span>
            <span class="contract-divider">/</span>
            <span class="contract-years">{{ formatContractYears(player.contractYearsRemaining) }}</span>
          </div>

          <!-- Contract Bar Visualization -->
          <div class="contract-bar-container">
            <div
              class="contract-bar"
              :style="{ width: contractBarWidth + '%' }"
              :class="{ expiring: isExpiringContract }"
            ></div>
          </div>
        </div>

        <!-- Stats Grid (if showing season stats) -->
        <div v-if="showStats && player.stats" class="stats-grid">
          <div class="stat-item">
            <span class="stat-value">{{ roundStatDecimal(player.stats.ppg) }}</span>
            <span class="stat-label">PPG</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ roundStatDecimal(player.stats.rpg) }}</span>
            <span class="stat-label">RPG</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ roundStatDecimal(player.stats.apg) }}</span>
            <span class="stat-label">APG</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ roundStat(player.stats.fgPct) }}%</span>
            <span class="stat-label">FG%</span>
          </div>
        </div>

        <!-- Attributes Grid (for free agents) -->
        <div v-if="showAttributes" class="attributes-grid">
          <div class="attr-item">
            <span class="attr-value">{{ roundStat(player.shooting) || '—' }}</span>
            <span class="attr-label">SHT</span>
          </div>
          <div class="attr-item">
            <span class="attr-value">{{ roundStat(player.playmaking) || '—' }}</span>
            <span class="attr-label">PLY</span>
          </div>
          <div class="attr-item">
            <span class="attr-value">{{ roundStat(player.defense) || '—' }}</span>
            <span class="attr-label">DEF</span>
          </div>
          <div class="attr-item">
            <span class="attr-value">{{ roundStat(player.athleticism) || '—' }}</span>
            <span class="attr-label">ATH</span>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.contract-card {
  background: rgba(30, 35, 45, 0.95);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

.contract-card:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(30, 35, 45, 1);
}

.contract-card.expiring {
  border-color: rgba(245, 158, 11, 0.4);
}

.card-content {
  display: flex;
  align-items: flex-start;
  padding: 1rem;
  gap: 0.875rem;
}

/* Left Column with Avatar and Buttons */
.left-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.player-avatar {
  position: relative;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  color: var(--color-text-secondary);
}

/* Action Buttons */
.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  width: 100%;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.375rem 0.5rem;
  border: none;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.resign-btn {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-primary);
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.resign-btn:hover {
  background: rgba(59, 130, 246, 0.3);
  border-color: var(--color-primary);
}

.drop-btn {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-error);
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.drop-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: var(--color-error);
}

.sign-btn {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-success);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.sign-btn:hover {
  background: rgba(34, 197, 94, 0.3);
  border-color: var(--color-success);
}

.player-info {
  flex: 1;
  min-width: 0;
}

.player-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  flex-wrap: wrap;
}

.player-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text-primary);
}

.player-badges {
  display: flex;
  gap: 0.25rem;
}

.position-badge {
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  text-transform: uppercase;
}

.position-badge.secondary {
  opacity: 0.7;
}

.player-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.player-age {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.player-potential {
  font-size: 0.75rem;
  color: var(--color-tertiary);
}

.contract-details {
  margin-top: 0.5rem;
}

.contract-main {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.375rem;
}

.contract-salary {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-success);
}

.contract-divider {
  color: var(--color-text-tertiary);
}

.contract-years {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.contract-bar-container {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.contract-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-tertiary));
  border-radius: 2px;
  transition: width 0.3s ease;
}

.contract-bar.expiring {
  background: linear-gradient(90deg, #F59E0B, #EF4444);
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.stat-item {
  text-align: center;
}

.stat-value {
  display: block;
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--color-text-primary);
}

.stat-label {
  display: block;
  font-size: 0.65rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Attributes Grid */
.attributes-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.attr-item {
  text-align: center;
}

.attr-value {
  display: block;
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--color-text-primary);
}

.attr-label {
  display: block;
  font-size: 0.65rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Expiring Indicator on Avatar */
.expiring-indicator {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F59E0B;
  border: 2px solid rgba(30, 35, 45, 0.95);
  border-radius: 50%;
  color: white;
}

/* Light Mode Overrides */
[data-theme="light"] .contract-card {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .contract-card.expiring {
  border-color: rgba(245, 158, 11, 0.5);
}

[data-theme="light"] .player-avatar {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .contract-bar-container {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .stats-grid,
[data-theme="light"] .attributes-grid {
  border-top-color: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .expiring-indicator {
  border-color: rgba(255, 255, 255, 0.95);
}

[data-theme="light"] .resign-btn {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.25);
}

[data-theme="light"] .resign-btn:hover {
  background: rgba(59, 130, 246, 0.2);
}

[data-theme="light"] .drop-btn {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
}

[data-theme="light"] .drop-btn:hover {
  background: rgba(239, 68, 68, 0.18);
}

[data-theme="light"] .sign-btn {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.25);
}

[data-theme="light"] .sign-btn:hover {
  background: rgba(34, 197, 94, 0.2);
}

</style>
