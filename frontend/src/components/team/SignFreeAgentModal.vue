<script setup>
import { computed, ref, watch } from 'vue'
import { User, Calendar, DollarSign, AlertTriangle, Check, X, Users, Briefcase } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import { StatBadge, LoadingSpinner } from '@/components/ui'

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
  },
  // 'instant' = legacy fixed 2yr/$8M sign-now flow
  // 'offer'   = offseason FA window: submit a pending offer that competes
  mode: {
    type: String,
    default: 'instant',
    validator: (v) => ['instant', 'offer'].includes(v),
  },
})

const emit = defineEmits(['close', 'confirm', 'withdraw'])

// ---------------------------------------------------------------------------
// Instant mode (Phase 1 / regular season + post-draft) — fixed terms
// ---------------------------------------------------------------------------
const FIXED_YEARS = 2
const FIXED_SALARY = 8_000_000

// ---------------------------------------------------------------------------
// Offer mode (offseason FA window) — negotiable terms
// ---------------------------------------------------------------------------
const SALARY_BANDS = [
  { rating: 90, salary: 40_000_000 },
  { rating: 85, salary: 30_000_000 },
  { rating: 80, salary: 20_000_000 },
  { rating: 75, salary: 10_000_000 },
  { rating: 70, salary: 5_000_000 },
  { rating: 65, salary: 3_000_000 },
]

function expectedSalaryFor(rating) {
  for (const band of SALARY_BANDS) {
    if (rating >= band.rating) return band.salary
  }
  return 2_000_000
}

const expectedSalary = computed(() => expectedSalaryFor(props.player?.overallRating ?? 70))

// ±25% range, $250K step
const salaryMin = computed(() => Math.max(1_000_000, Math.floor(expectedSalary.value * 0.75 / 250_000) * 250_000))
const salaryMax = computed(() => Math.ceil(expectedSalary.value * 1.25 / 250_000) * 250_000)

const offerYears = ref(2)
const offerSalary = ref(expectedSalary.value)

const userExistingOffer = computed(() => props.player?.userOffer || null)
const competingOfferCount = computed(() => {
  const total = props.player?.pendingOfferCount ?? 0
  return Math.max(0, total - (userExistingOffer.value ? 1 : 0))
})

watch(() => props.show, (open) => {
  if (!open || !props.player) return
  if (props.mode === 'offer') {
    if (userExistingOffer.value) {
      offerYears.value = userExistingOffer.value.years
      offerSalary.value = userExistingOffer.value.salary
    } else {
      offerYears.value = 2
      offerSalary.value = expectedSalary.value
    }
  }
}, { immediate: true })

const isUpdate = computed(() => props.mode === 'offer' && !!userExistingOffer.value)

// ---------------------------------------------------------------------------
// Cap / roster validation
// ---------------------------------------------------------------------------
const proposedSalary = computed(() => {
  if (props.mode === 'offer') return offerSalary.value
  return FIXED_SALARY
})

const exceedsCap = computed(() => proposedSalary.value > props.capSpace)
const rosterFull = computed(() => props.rosterCount >= 15)

// In offer mode, roster fullness isn't a hard block (the slot is checked at
// resolution time, after potential cuts and other expirings). We still warn.
const canConfirm = computed(() => {
  if (props.mode === 'offer') return !exceedsCap.value
  return !exceedsCap.value && !rosterFull.value
})

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
function getPositionColor(position) {
  const colors = { PG: '#3B82F6', SG: '#10B981', SF: '#F59E0B', PF: '#EF4444', C: '#8B5CF6' }
  return colors[position] || '#6B7280'
}

function formatSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1_000_000) return `$${(salary / 1_000_000).toFixed(1)}M`
  return `$${(salary / 1000).toFixed(0)}K`
}

function handleClose() {
  if (props.loading) return
  emit('close')
}

function handleConfirm() {
  if (props.mode === 'offer') {
    emit('confirm', {
      playerId: props.player.id,
      years: offerYears.value,
      salary: offerSalary.value,
      mode: 'offer',
    })
    return
  }
  emit('confirm', {
    playerId: props.player.id,
    years: FIXED_YEARS,
    salary: FIXED_SALARY,
    mode: 'instant',
  })
}

function handleWithdraw() {
  emit('withdraw', { playerId: props.player.id })
}

const totalContractValue = computed(() => proposedSalary.value * (props.mode === 'offer' ? offerYears.value : FIXED_YEARS))
const modalTitle = computed(() => props.mode === 'offer' ? (isUpdate.value ? 'Update Offer' : 'Make Offer') : 'Sign Free Agent')
const confirmLabel = computed(() => props.mode === 'offer' ? (isUpdate.value ? 'Update Offer' : 'Submit Offer') : 'Sign Player')
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="handleClose">
        <div class="modal-container">
          <header class="modal-header">
            <h2 class="modal-title">{{ modalTitle }}</h2>
            <button
              v-if="!loading"
              class="btn-close"
              aria-label="Close"
              @click="handleClose"
            >
              <X :size="20" />
            </button>
          </header>

          <main class="modal-content">
    <div v-if="loading" class="loading-state">
      <LoadingSpinner size="lg" />
      <p>{{ mode === 'offer' ? 'Submitting offer...' : 'Processing signing...' }}</p>
    </div>

    <div v-else-if="player" class="sign-content">
      <!-- Player Info -->
      <div class="player-card">
        <div class="player-avatar">
          <PlayerAvatar :player="player" :size="32" />
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

      <!-- Offer mode: market context -->
      <div v-if="mode === 'offer'" class="market-context">
        <Briefcase :size="16" />
        <span v-if="competingOfferCount === 0">No other teams have made offers yet.</span>
        <span v-else-if="competingOfferCount === 1">1 other team has made an offer.</span>
        <span v-else>{{ competingOfferCount }} other teams have made offers.</span>
      </div>

      <!-- Offer mode: salary + years controls -->
      <div v-if="mode === 'offer'" class="offer-controls">
        <h4>Your Offer</h4>

        <div class="control-row">
          <div class="control-label">
            <DollarSign :size="16" />
            <span>Annual Salary</span>
          </div>
          <div class="control-value">{{ formatSalary(offerSalary) }}</div>
        </div>
        <input
          v-model.number="offerSalary"
          type="range"
          :min="salaryMin"
          :max="salaryMax"
          :step="250000"
          class="salary-slider"
        />
        <div class="slider-labels">
          <span>{{ formatSalary(salaryMin) }}</span>
          <span class="expected">Market: {{ formatSalary(expectedSalary) }}</span>
          <span>{{ formatSalary(salaryMax) }}</span>
        </div>

        <div class="control-row years-row">
          <div class="control-label">
            <Calendar :size="16" />
            <span>Contract Length</span>
          </div>
          <div class="years-options">
            <button
              v-for="y in [1, 2, 3, 4, 5]"
              :key="y"
              class="year-btn"
              :class="{ active: offerYears === y }"
              type="button"
              @click="offerYears = y"
            >
              {{ y }}
            </button>
          </div>
        </div>

        <div class="offer-total">
          <span class="total-label">Total Value:</span>
          <span class="total-value">{{ formatSalary(totalContractValue) }}</span>
        </div>
      </div>

      <!-- Instant mode: fixed offer summary -->
      <div v-else class="contract-offer">
        <h4>Contract Offer</h4>
        <p class="offer-note">Standard free agent contract</p>

        <div class="offer-details">
          <div class="offer-row">
            <div class="offer-icon"><DollarSign :size="18" /></div>
            <div class="offer-info">
              <span class="offer-label">Annual Salary</span>
              <span class="offer-value">{{ formatSalary(FIXED_SALARY) }}</span>
            </div>
          </div>
          <div class="offer-row">
            <div class="offer-icon"><Calendar :size="18" /></div>
            <div class="offer-info">
              <span class="offer-label">Contract Length</span>
              <span class="offer-value">{{ FIXED_YEARS }} years</span>
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
        <span>You don't have enough cap space (need {{ formatSalary(proposedSalary) }})</span>
      </div>
      <div v-else-if="mode === 'instant' && rosterFull" class="warning-box">
        <AlertTriangle :size="18" />
        <span>Your roster is full. Release a player to make room.</span>
      </div>
    </div>
          </main>

          <footer class="modal-footer">
            <button class="btn-cancel" :disabled="loading" @click="handleClose">
              Cancel
            </button>
            <button v-if="isUpdate" class="btn-withdraw" :disabled="loading" @click="handleWithdraw">
              <X :size="16" />
              Withdraw
            </button>
            <button class="btn-confirm" :disabled="loading || !canConfirm" @click="handleConfirm">
              {{ confirmLabel }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Modal scaffolding (matches SimulateConfirmModal global standard) */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.modal-container {
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
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

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

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

.player-details { flex: 1; }

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

.position-badge.secondary { opacity: 0.7; }

.player-age {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

/* Attributes */
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

/* Market context (offer mode) */
.market-context {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  background: rgba(168, 85, 247, 0.08);
  border: 1px solid rgba(168, 85, 247, 0.25);
  border-radius: 8px;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

/* Offer controls */
.offer-controls {
  padding: 1rem;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
}

.offer-controls h4 {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-primary);
  margin-bottom: 0.75rem;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.4rem;
}

.control-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.control-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.salary-slider {
  width: 100%;
  margin: 0.25rem 0 0.4rem;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  margin-bottom: 0.75rem;
}

.slider-labels .expected {
  color: var(--color-text-secondary);
  font-weight: 600;
}

.years-row { margin-top: 0.5rem; }

.years-options {
  display: flex;
  gap: 0.4rem;
}

.year-btn {
  width: 34px;
  height: 30px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.year-btn:hover {
  border-color: rgba(255, 255, 255, 0.3);
  color: var(--color-text-primary);
}

.year-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

/* Contract Offer (instant mode) */
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

.status-item.warning { background: rgba(239, 68, 68, 0.08); }

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

/* Warning */
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

/* Footer (global standard: direct button children, flex:1, uppercase 0.85rem 600) */
.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-cancel,
.btn-confirm,
.btn-withdraw {
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

.btn-withdraw {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: var(--color-error);
}

.btn-withdraw:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.12);
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
.btn-confirm:disabled,
.btn-withdraw:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-icon {
  fill: currentColor;
}

/* Modal transition */
.modal-enter-active { transition: opacity 0.3s cubic-bezier(0, 0, 0.2, 1); }
.modal-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 1, 1); }
.modal-enter-from, .modal-leave-to { opacity: 0; }

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes scaleOut {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.96); }
}

.modal-enter-active .modal-container { animation: scaleIn 0.3s cubic-bezier(0, 0, 0.2, 1); }
.modal-leave-active .modal-container { animation: scaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards; }
</style>
