<script setup>
import { computed } from 'vue'
import { User, Calendar, DollarSign, AlertTriangle, Check, X, Users } from 'lucide-vue-next'
import { BaseModal, BaseButton, StatBadge, LoadingSpinner } from '@/components/ui'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  player: {
    type: Object,
    default: null
  },
  capSpace: {
    type: Number,
    default: 0
  },
  rosterCount: {
    type: Number,
    default: 0
  },
  loading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'confirm'])

// Phase 1: Fixed contract terms
const CONTRACT_YEARS = 2
const CONTRACT_SALARY = 8000000 // $8M

const totalContractValue = CONTRACT_YEARS * CONTRACT_SALARY

// Check if signing would exceed cap space
const exceedsCap = computed(() => {
  return CONTRACT_SALARY > props.capSpace
})

// Check if roster is full
const rosterFull = computed(() => {
  return props.rosterCount >= 15
})

const canSign = computed(() => {
  return !exceedsCap.value && !rosterFull.value
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
    return `$${(salary / 1000000).toFixed(1)}M`
  }
  return `$${(salary / 1000).toFixed(0)}K`
}

function handleClose() {
  emit('close')
}

function handleConfirm() {
  emit('confirm', {
    playerId: props.player.id,
    years: CONTRACT_YEARS,
    salary: CONTRACT_SALARY
  })
}
</script>

<template>
  <BaseModal
    :show="show"
    title="Sign Free Agent"
    size="md"
    :closable="!loading"
    @close="handleClose"
  >
    <div v-if="loading" class="loading-state">
      <LoadingSpinner size="lg" />
      <p>Processing signing...</p>
    </div>

    <div v-else-if="player" class="sign-content">
      <!-- Player Info -->
      <div class="player-card">
        <div class="player-avatar">
          <User :size="32" />
        </div>
        <div class="player-details">
          <h3 class="player-name">{{ player.firstName }} {{ player.lastName }}</h3>
          <div class="player-meta">
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
            <StatBadge :value="player.overallRating" size="sm" />
            <span class="player-age">{{ player.age }} yrs</span>
          </div>
        </div>
      </div>

      <!-- Player Attributes -->
      <div class="attributes-section">
        <h4>Player Attributes</h4>
        <div class="attributes-grid">
          <div class="attr-item">
            <span class="attr-label">Shooting</span>
            <span class="attr-value">{{ player.shooting || '—' }}</span>
          </div>
          <div class="attr-item">
            <span class="attr-label">Playmaking</span>
            <span class="attr-value">{{ player.playmaking || '—' }}</span>
          </div>
          <div class="attr-item">
            <span class="attr-label">Defense</span>
            <span class="attr-value">{{ player.defense || '—' }}</span>
          </div>
          <div class="attr-item">
            <span class="attr-label">Athleticism</span>
            <span class="attr-value">{{ player.athleticism || '—' }}</span>
          </div>
          <div class="attr-item">
            <span class="attr-label">Rebounding</span>
            <span class="attr-value">{{ player.rebounding || '—' }}</span>
          </div>
          <div class="attr-item">
            <span class="attr-label">IQ</span>
            <span class="attr-value">{{ player.basketballIQ || '—' }}</span>
          </div>
        </div>
      </div>

      <!-- Contract Offer (Fixed for Phase 1) -->
      <div class="contract-offer">
        <h4>Contract Offer</h4>
        <p class="offer-note">Standard free agent contract</p>

        <div class="offer-details">
          <div class="offer-row">
            <div class="offer-icon">
              <DollarSign :size="18" />
            </div>
            <div class="offer-info">
              <span class="offer-label">Annual Salary</span>
              <span class="offer-value">{{ formatSalary(CONTRACT_SALARY) }}</span>
            </div>
          </div>
          <div class="offer-row">
            <div class="offer-icon">
              <Calendar :size="18" />
            </div>
            <div class="offer-info">
              <span class="offer-label">Contract Length</span>
              <span class="offer-value">{{ CONTRACT_YEARS }} years</span>
            </div>
          </div>
        </div>

        <div class="offer-total">
          <span class="total-label">Total Value:</span>
          <span class="total-value">{{ formatSalary(totalContractValue) }}</span>
        </div>
      </div>

      <!-- Team Status -->
      <div class="team-status">
        <div class="status-item" :class="{ warning: exceedsCap }">
          <DollarSign :size="16" />
          <span>Cap Space: {{ formatSalary(capSpace) }}</span>
          <span v-if="exceedsCap" class="status-badge error">Insufficient</span>
          <span v-else class="status-badge success">OK</span>
        </div>
        <div class="status-item" :class="{ warning: rosterFull }">
          <Users :size="16" />
          <span>Roster: {{ rosterCount }}/15</span>
          <span v-if="rosterFull" class="status-badge error">Full</span>
          <span v-else class="status-badge success">OK</span>
        </div>
      </div>

      <!-- Warnings -->
      <div v-if="exceedsCap" class="warning-box">
        <AlertTriangle :size="18" />
        <span>You don't have enough cap space for this signing (need {{ formatSalary(CONTRACT_SALARY) }})</span>
      </div>
      <div v-else-if="rosterFull" class="warning-box">
        <AlertTriangle :size="18" />
        <span>Your roster is full. Release a player to make room.</span>
      </div>
    </div>

    <template #footer>
      <div class="modal-footer-buttons">
        <button class="btn-cancel" :disabled="loading" @click="handleClose">
          Cancel
        </button>
        <button class="btn-confirm" :disabled="loading || !canSign" @click="handleConfirm">
          <Check :size="16" />
          Sign Player
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  gap: 1rem;
  color: var(--color-text-secondary);
}

.sign-content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* Player Card */
.player-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.player-avatar {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  color: var(--color-text-secondary);
}

.player-details {
  flex: 1;
}

.player-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.player-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.position-badge {
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  color: white;
}

.position-badge.secondary {
  opacity: 0.7;
}

.player-age {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

/* Attributes Section */
.attributes-section h4 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.attributes-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.attr-item {
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  text-align: center;
}

.attr-label {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 0.25rem;
}

.attr-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Contract Offer */
.contract-offer {
  padding: 1rem;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
}

.contract-offer h4 {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-primary);
  margin-bottom: 0.25rem;
}

.offer-note {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}

.offer-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.offer-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.offer-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: var(--color-primary);
}

.offer-info {
  display: flex;
  flex-direction: column;
}

.offer-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.offer-value {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.offer-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(59, 130, 246, 0.2);
}

.total-label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.total-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-success);
}

/* Team Status */
.team-status {
  display: flex;
  gap: 1rem;
}

.status-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.status-item.warning {
  background: rgba(239, 68, 68, 0.08);
}

.status-badge {
  margin-left: auto;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
}

.status-badge.success {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-success);
}

.status-badge.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-error);
}

/* Warning Box */
.warning-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: var(--color-error);
  font-size: 0.85rem;
  font-weight: 500;
}

/* Footer Buttons */
.modal-footer-buttons {
  display: flex;
  gap: 12px;
}

.btn-cancel,
.btn-confirm {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.btn-cancel:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

.btn-confirm {
  background: var(--color-primary);
  border: none;
  color: white;
}

.btn-confirm:hover:not(:disabled) {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.btn-cancel:disabled,
.btn-confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
