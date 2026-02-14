<script setup>
import { ref, computed, watch } from 'vue'
import { User, Calendar, DollarSign, AlertTriangle, Check, X } from 'lucide-vue-next'
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
  loading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'confirm'])

const selectedYears = ref(2)

// Reset years when modal opens with new player
watch(() => props.show, (isOpen) => {
  if (isOpen) {
    selectedYears.value = 2
  }
})

const yearOptions = [1, 2, 3, 4, 5]

// Calculate total contract value
const totalContractValue = computed(() => {
  if (!props.player) return 0
  return props.player.contractSalary * selectedYears.value
})

// Check if signing would exceed cap space
const exceedsCap = computed(() => {
  // For re-signing, we're keeping the same salary so it doesn't increase payroll
  return false
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
    years: selectedYears.value,
    salary: props.player.contractSalary
  })
}
</script>

<template>
  <BaseModal
    :show="show"
    title="Re-sign Player"
    size="md"
    :closable="!loading"
    @close="handleClose"
  >
    <div v-if="loading" class="loading-state">
      <LoadingSpinner size="lg" />
      <p>Processing contract extension...</p>
    </div>

    <div v-else-if="player" class="resign-content">
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
            <StatBadge :value="player.overallRating" size="sm" />
            <span class="player-age">{{ player.age }} yrs</span>
          </div>
        </div>
      </div>

      <!-- Current Contract -->
      <div class="current-contract">
        <h4>Current Contract</h4>
        <div class="contract-info">
          <div class="contract-item">
            <DollarSign :size="16" />
            <span>{{ formatSalary(player.contractSalary) }} / year</span>
          </div>
          <div class="contract-item expiring">
            <AlertTriangle :size="16" />
            <span>Contract expires after this season</span>
          </div>
        </div>
      </div>

      <!-- Extension Options -->
      <div class="extension-options">
        <h4>New Contract Length</h4>
        <p class="hint">Select the number of years for the new contract (at the same annual salary)</p>

        <div class="years-selector">
          <button
            v-for="year in yearOptions"
            :key="year"
            class="year-option"
            :class="{ selected: selectedYears === year }"
            @click="selectedYears = year"
          >
            {{ year }} {{ year === 1 ? 'Year' : 'Years' }}
          </button>
        </div>
      </div>

      <!-- Contract Summary -->
      <div class="contract-summary">
        <div class="summary-row">
          <span class="summary-label">Annual Salary:</span>
          <span class="summary-value">{{ formatSalary(player.contractSalary) }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Contract Length:</span>
          <span class="summary-value">{{ selectedYears }} {{ selectedYears === 1 ? 'year' : 'years' }}</span>
        </div>
        <div class="summary-row total">
          <span class="summary-label">Total Value:</span>
          <span class="summary-value">{{ formatSalary(totalContractValue) }}</span>
        </div>
      </div>

      <!-- Warning (if any) -->
      <div v-if="exceedsCap" class="cap-warning">
        <AlertTriangle :size="18" />
        <span>This signing would exceed your salary cap!</span>
      </div>
    </div>

    <template #footer>
      <div class="modal-footer-buttons">
        <button class="btn-cancel" :disabled="loading" @click="handleClose">
          Cancel
        </button>
        <button class="btn-confirm" :disabled="loading || exceedsCap" @click="handleConfirm">
          <Check :size="16" />
          Re-sign Player
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

.resign-content {
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
}

.position-badge {
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  color: white;
}

.player-age {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

/* Current Contract */
.current-contract {
  padding: 1rem;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
}

.current-contract h4 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-warning);
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.contract-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.contract-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.contract-item.expiring {
  color: var(--color-warning);
}

/* Extension Options */
.extension-options h4 {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.extension-options .hint {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}

.years-selector {
  display: flex;
  gap: 0.5rem;
}

.year-option {
  flex: 1;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: var(--color-text-secondary);
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.year-option:hover {
  border-color: var(--color-primary);
  color: var(--color-text-primary);
}

.year-option.selected {
  background: rgba(59, 130, 246, 0.15);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

/* Contract Summary */
.contract-summary {
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.summary-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.summary-row:last-child {
  border-bottom: none;
}

.summary-row.total {
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  border-bottom: none;
}

.summary-label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.summary-value {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.summary-row.total .summary-value {
  font-size: 1rem;
  color: var(--color-success);
}

/* Cap Warning */
.cap-warning {
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
