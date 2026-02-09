<script setup>
import { computed } from 'vue'
import { User, DollarSign, AlertTriangle, UserMinus, X } from 'lucide-vue-next'
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
  loading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'confirm'])

// Calculate remaining contract value
const remainingContractValue = computed(() => {
  if (!props.player) return 0
  return props.player.contractSalary * props.player.contractYearsRemaining
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

function handleClose() {
  emit('close')
}

function handleConfirm() {
  emit('confirm', {
    playerId: props.player.id
  })
}
</script>

<template>
  <BaseModal
    :show="show"
    title="Drop Player"
    size="md"
    :closable="!loading"
    @close="handleClose"
  >
    <div v-if="loading" class="loading-state">
      <LoadingSpinner size="lg" />
      <p>Releasing player...</p>
    </div>

    <div v-else-if="player" class="drop-content">
      <!-- Warning Banner -->
      <div class="warning-banner">
        <AlertTriangle :size="24" />
        <div class="warning-text">
          <strong>Are you sure you want to drop this player?</strong>
          <p>This action cannot be undone. The player will become a free agent.</p>
        </div>
      </div>

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

      <!-- Contract Details -->
      <div class="contract-details">
        <h4>Contract Being Terminated</h4>
        <div class="contract-info">
          <div class="contract-row">
            <span class="contract-label">Annual Salary:</span>
            <span class="contract-value">{{ formatSalary(player.contractSalary) }}</span>
          </div>
          <div class="contract-row">
            <span class="contract-label">Years Remaining:</span>
            <span class="contract-value">{{ player.contractYearsRemaining }} {{ player.contractYearsRemaining === 1 ? 'year' : 'years' }}</span>
          </div>
          <div class="contract-row total">
            <span class="contract-label">Remaining Value:</span>
            <span class="contract-value savings">{{ formatSalary(remainingContractValue) }}</span>
          </div>
        </div>
      </div>

      <!-- Cap Space Impact -->
      <div class="impact-info">
        <DollarSign :size="18" />
        <span>Dropping this player will free up <strong>{{ formatSalary(player.contractSalary) }}</strong> in annual cap space.</span>
      </div>

      <!-- Actions -->
      <div class="modal-actions">
        <BaseButton variant="ghost" @click="handleClose">
          <X :size="18" />
          Cancel
        </BaseButton>
        <BaseButton
          variant="danger"
          @click="handleConfirm"
        >
          <UserMinus :size="18" />
          Drop Player
        </BaseButton>
      </div>
    </div>
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

.drop-content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* Warning Banner */
.warning-banner {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: var(--color-error);
}

.warning-banner svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.warning-text strong {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.95rem;
}

.warning-text p {
  font-size: 0.85rem;
  opacity: 0.9;
  margin: 0;
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

/* Contract Details */
.contract-details {
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.contract-details h4 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.contract-info {
  display: flex;
  flex-direction: column;
}

.contract-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.contract-row:last-child {
  border-bottom: none;
}

.contract-row.total {
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  border-bottom: none;
}

.contract-label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.contract-value {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.contract-value.savings {
  color: var(--color-success);
}

/* Impact Info */
.impact-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 8px;
  color: var(--color-success);
  font-size: 0.85rem;
}

.impact-info strong {
  font-weight: 700;
}

/* Modal Actions */
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin-top: 0.5rem;
}
</style>
