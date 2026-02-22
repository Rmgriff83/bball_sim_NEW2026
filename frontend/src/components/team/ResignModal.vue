<script setup>
import { ref, computed, watch } from 'vue'
import { User, DollarSign, AlertTriangle, Check, X } from 'lucide-vue-next'
import { BaseModal, BaseButton, StatBadge, LoadingSpinner } from '@/components/ui'
import { calculateRetentionScore, getMotivationLabel, getArchetypeLabel } from '@/engine/ai/MotivationService'
import { calculateExpectedSalary } from '@/engine/ai/AITradeService'

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
  },
  teamContext: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'confirm'])

const selectedYears = ref(2)
const offeredSalary = ref(0)
const negotiationResult = ref(null) // null | 'success' | 'declined'

// Reset state when modal opens with new player
watch(() => props.show, (isOpen) => {
  if (isOpen && props.player) {
    selectedYears.value = 2
    offeredSalary.value = props.player.contractSalary ?? 0
    negotiationResult.value = null
  }
})

const yearOptions = [1, 2, 3, 4, 5]

const baseSalary = computed(() => props.player?.contractSalary ?? 0)
const maxOffer = computed(() => Math.round(baseSalary.value * 1.25))
const salaryStep = computed(() => {
  if (baseSalary.value >= 10_000_000) return 500_000
  if (baseSalary.value >= 1_000_000) return 100_000
  return 50_000
})

const expectedSalaryValue = computed(() => {
  if (!props.player) return 0
  const rating = props.player.overallRating ?? props.player.overall_rating ?? 75
  return calculateExpectedSalary(null, rating)
})

// Total contract value
const totalContractValue = computed(() => offeredSalary.value * selectedYears.value)

// Salary premium display
const salaryPremium = computed(() => offeredSalary.value - baseSalary.value)

// Has motivations?
const hasMotivations = computed(() => !!props.player?.motivations)

// Top motivations (sorted by weight, top 4)
const topMotivations = computed(() => {
  if (!props.player?.motivations) return []
  return Object.entries(props.player.motivations)
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
})

// Dynamic retention % that recalculates as salary slider moves
const retentionPct = computed(() => {
  if (!props.player?.motivations) return 65 // Default if no motivations
  const context = {
    ...(props.teamContext || {}),
    contractSalary: baseSalary.value,
    expectedSalary: expectedSalaryValue.value,
  }
  return calculateRetentionScore(props.player, context, offeredSalary.value)
})

const retentionColor = computed(() => {
  if (retentionPct.value >= 70) return '#22c55e'
  if (retentionPct.value >= 40) return '#f59e0b'
  return '#ef4444'
})

const retentionLabel = computed(() => {
  if (retentionPct.value >= 70) return 'Likely to Accept'
  if (retentionPct.value >= 40) return 'Uncertain'
  return 'Unlikely to Accept'
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

function getMotivationBarColor(weight) {
  if (weight >= 0.7) return '#f87171'
  if (weight >= 0.4) return '#fbbf24'
  return '#6b7280'
}

function formatSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1000000) {
    return `$${(salary / 1000000).toFixed(1)}M`
  }
  return `$${(salary / 1000).toFixed(0)}K`
}

function handleClose() {
  negotiationResult.value = null
  emit('close')
}

function handleResign() {
  // Roll against retention percentage for success/fail
  const roll = Math.random() * 100
  if (roll < retentionPct.value) {
    negotiationResult.value = 'success'
    // Auto-confirm after brief delay to show success state
    setTimeout(() => {
      emit('confirm', {
        playerId: props.player.id,
        years: selectedYears.value,
        salary: offeredSalary.value
      })
      negotiationResult.value = null
    }, 1200)
  } else {
    negotiationResult.value = 'declined'
  }
}

function handleTryAgain() {
  negotiationResult.value = null
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
      <!-- Player Header Card -->
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
            <span v-if="hasMotivations" class="archetype-tag">{{ getArchetypeLabel(player) }}</span>
          </div>
        </div>
      </div>

      <!-- Motivation Bars (compact, top 4) -->
      <div v-if="hasMotivations" class="motivation-section">
        <h4 class="section-title">Key Motivations</h4>
        <div class="motivation-bars">
          <div
            v-for="m in topMotivations"
            :key="m.key"
            class="motivation-row"
          >
            <span class="motivation-label">{{ getMotivationLabel(m.key) }}</span>
            <div class="motivation-bar-track">
              <div
                class="motivation-bar-fill"
                :style="{ width: (m.weight * 100) + '%', backgroundColor: getMotivationBarColor(m.weight) }"
              />
            </div>
            <span class="motivation-value">{{ Math.round(m.weight * 100) }}</span>
          </div>
        </div>
      </div>

      <!-- Salary Offer Slider -->
      <div v-if="!negotiationResult" class="salary-slider-section">
        <h4 class="section-title">Annual Salary Offer</h4>
        <input
          type="range"
          class="salary-slider"
          :min="baseSalary"
          :max="maxOffer"
          :step="salaryStep"
          v-model.number="offeredSalary"
        />
        <div class="salary-display">
          <span class="salary-amount">{{ formatSalary(offeredSalary) }} / year</span>
          <span v-if="salaryPremium > 0" class="salary-premium">
            +{{ formatSalary(salaryPremium) }} premium
          </span>
        </div>
      </div>

      <!-- Dynamic Retention Bar -->
      <div v-if="!negotiationResult" class="retention-section">
        <div class="retention-header">
          <h4 class="section-title">Re-sign Likelihood</h4>
          <span class="retention-label" :style="{ color: retentionColor }">{{ retentionLabel }}</span>
        </div>
        <div class="retention-bar-container">
          <div
            class="retention-bar-fill"
            :style="{ width: retentionPct + '%', backgroundColor: retentionColor }"
          />
        </div>
        <span class="retention-pct" :style="{ color: retentionColor }">{{ retentionPct }}%</span>
      </div>

      <!-- Year Selector -->
      <div v-if="!negotiationResult" class="extension-options">
        <h4 class="section-title">Contract Length</h4>
        <div class="years-selector">
          <button
            v-for="year in yearOptions"
            :key="year"
            class="year-option"
            :class="{ selected: selectedYears === year }"
            @click="selectedYears = year"
          >
            {{ year }} {{ year === 1 ? 'Yr' : 'Yrs' }}
          </button>
        </div>
      </div>

      <!-- Contract Summary -->
      <div v-if="!negotiationResult" class="contract-summary">
        <div class="summary-row">
          <span class="summary-label">Annual Salary:</span>
          <span class="summary-value">{{ formatSalary(offeredSalary) }}</span>
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

      <!-- Negotiation Result -->
      <div v-if="negotiationResult === 'success'" class="result-banner success">
        <Check :size="24" />
        <div class="result-text">
          <strong>Deal Accepted!</strong>
          <p>{{ player.firstName }} {{ player.lastName }} has agreed to a {{ selectedYears }}-year, {{ formatSalary(totalContractValue) }} contract.</p>
        </div>
      </div>

      <div v-if="negotiationResult === 'declined'" class="result-banner declined">
        <X :size="24" />
        <div class="result-text">
          <strong>Offer Declined</strong>
          <p>{{ player.firstName }} {{ player.lastName }} has turned down the offer. Try adjusting the terms.</p>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="modal-footer-buttons">
        <button class="btn-cancel" :disabled="loading" @click="handleClose">
          {{ negotiationResult ? 'Close' : 'Cancel' }}
        </button>
        <button
          v-if="!negotiationResult"
          class="btn-confirm"
          :disabled="loading"
          @click="handleResign"
        >
          <Check :size="16" />
          Offer Contract
        </button>
        <button
          v-if="negotiationResult === 'declined'"
          class="btn-confirm"
          @click="handleTryAgain"
        >
          Adjust Offer
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

/* Section Title */
.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
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

.player-age {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.archetype-tag {
  font-size: 0.7rem;
  padding: 0.125rem 0.5rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-tertiary);
  font-weight: 500;
}

/* Motivation Bars */
.motivation-section {
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.motivation-bars {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.motivation-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.motivation-label {
  flex: 0 0 130px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.motivation-bar-track {
  flex: 1;
  height: 5px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.motivation-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.motivation-value {
  flex: 0 0 24px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-align: right;
}

/* Salary Slider */
.salary-slider-section {
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.salary-slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  outline: none;
  margin: 0.5rem 0;
}

.salary-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.salary-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.salary-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.25rem;
}

.salary-amount {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.salary-premium {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-success);
}

/* Retention */
.retention-section {
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.retention-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.retention-label {
  font-size: 0.75rem;
  font-weight: 600;
}

.retention-bar-container {
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.25rem;
}

.retention-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.retention-pct {
  font-size: 1.1rem;
  font-weight: 700;
}

/* Extension Options */
.extension-options {
  /* no extra padding — sits inline */
}

.years-selector {
  display: flex;
  gap: 0.5rem;
}

.year-option {
  flex: 1;
  padding: 0.625rem;
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

/* Result Banners */
.result-banner {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  border-radius: 8px;
}

.result-banner.success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: var(--color-success);
}

.result-banner.declined {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--color-error);
}

.result-banner svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.result-text strong {
  display: block;
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
}

.result-text p {
  font-size: 0.85rem;
  opacity: 0.9;
  margin: 0;
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
