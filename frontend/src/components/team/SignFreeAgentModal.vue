<script setup>
import { computed, ref, watch } from 'vue'
import { User, Calendar, DollarSign, AlertTriangle, Check, X, Users, Briefcase, Heart } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import { StatBadge, LoadingSpinner } from '@/components/ui'
import { useFreeAgentInterest } from '@/composables/useFreeAgentInterest'
import { playerMarketValue } from '@/engine/ai/ResignValuationService'
import { veteranMinSalary } from '@/engine/data/salaryScale'

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
// Both modes negotiate salary + years, anchored on the player's real MARKET
// VALUE (production-aware, capped at the league max, floored at the vet min).
//   • instant (regular season)  → signs immediately if the player accepts
//   • offer   (offseason window) → submits a pending bid resolved at FA close
// ---------------------------------------------------------------------------
const SIGN_THRESHOLD = 30 // interest score below which the player won't sign

const expectedSalary = computed(() =>
  props.player ? playerMarketValue(props.player, props.player.stats ?? null) : 0
)
const minSalary = computed(() => (props.player ? veteranMinSalary(props.player) : 1_300_000))

// Slider reaches down to the veteran minimum (so the user can deliberately offer
// a minimum deal) and up to ~25% over market. $250K step.
const salaryMin = computed(() => Math.floor(minSalary.value / 250_000) * 250_000)
const salaryMax = computed(() =>
  Math.max(salaryMin.value + 250_000, Math.ceil((expectedSalary.value * 1.25) / 250_000) * 250_000)
)

const offerYears = ref(2)
const offerSalary = ref(0)

const userExistingOffer = computed(() => props.player?.userOffer || null)
const competingOfferCount = computed(() => {
  const total = props.player?.pendingOfferCount ?? 0
  return Math.max(0, total - (userExistingOffer.value ? 1 : 0))
})

watch(() => props.show, (open) => {
  if (!open || !props.player) return
  if (props.mode === 'offer' && userExistingOffer.value) {
    offerYears.value = userExistingOffer.value.years
    offerSalary.value = userExistingOffer.value.salary
  } else {
    offerYears.value = 2
    offerSalary.value = expectedSalary.value
  }
}, { immediate: true })

const isUpdate = computed(() => props.mode === 'offer' && !!userExistingOffer.value)

// ---------------------------------------------------------------------------
// Cap / roster validation
// ---------------------------------------------------------------------------
const proposedSalary = computed(() => offerSalary.value)

const exceedsCap = computed(() => proposedSalary.value > props.capSpace)
const rosterFull = computed(() => props.rosterCount >= 15)

// A minimum-salary contract is always allowed, even over the cap (the NBA
// minimum exception). Anything above the minimum needs real cap space.
const isMinimumDeal = computed(() => offerSalary.value <= minSalary.value)
const capBlocked = computed(() => exceedsCap.value && !isMinimumDeal.value)

// In offer mode, neither cap nor roster fullness is a hard block — the user
// is allowed to take swings at multiple stars even if their combined offers
// exceed cap, and the EndOfFreeAgencyModal surfaces a "Decision Required" step.
// In instant mode the signing resolves NOW, so the player must both clear the
// cap rule (minimum-only over the cap) and actually be willing to sign.
const canConfirm = computed(() => {
  if (rosterFull.value) return false
  if (props.mode === 'offer') return true
  return !capBlocked.value && (interestScore.value ?? 0) >= SIGN_THRESHOLD
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
  emit('confirm', {
    playerId: props.player.id,
    years: offerYears.value,
    salary: offerSalary.value,
    mode: props.mode,
  })
}

function handleWithdraw() {
  emit('withdraw', { playerId: props.player.id })
}

const totalContractValue = computed(() => proposedSalary.value * offerYears.value)
const modalTitle = computed(() => props.mode === 'offer' ? (isUpdate.value ? 'Update Offer' : 'Make Offer') : 'Sign Free Agent')
const confirmLabel = computed(() => props.mode === 'offer' ? (isUpdate.value ? 'Update Offer' : 'Submit Offer') : 'Sign Player')

// Live "how does the player feel about your offer right now" meter. Reactive
// to the salary/year sliders so the user can see their offer cross thresholds
// as they tweak. Uses the same scoring fn the engine runs at resolution.
const { score: scoreInterest, interestLevelForScore } = useFreeAgentInterest()
const interestScore = computed(() => {
  if (!props.player) return null
  return scoreInterest(props.player, {
    salary: offerSalary.value,
    years: offerYears.value,
  })
})
const interestLevel = computed(() =>
  interestScore.value != null ? interestLevelForScore(interestScore.value) : null
)
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
          <PlayerAvatar :player="player" :size="72" />
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

      <!-- How the player currently feels about THIS offer. Updates live as the
           user drags the salary/year controls. -->
      <div
        v-if="interestLevel"
        class="interest-meter"
        :style="{ '--interest-color': interestLevel.color }"
      >
        <div class="interest-header">
          <Heart :size="14" class="interest-icon" />
          <span class="interest-eyebrow">Player Interest</span>
          <span class="interest-label">{{ interestLevel.label }}</span>
          <span class="interest-score">{{ interestScore }}/100</span>
        </div>
        <div class="interest-bar">
          <div class="interest-bar-fill" :style="{ width: interestScore + '%' }"></div>
          <div class="interest-bar-threshold" title="Minimum needed to sign"></div>
        </div>
        <p class="interest-hint">{{ interestLevel.hint }}</p>
      </div>

      <!-- Salary + years controls (both modes) -->
      <div class="offer-controls">
        <div class="offer-controls-head">
          <h4>Your Offer</h4>
          <span v-if="isMinimumDeal" class="min-deal-badge" title="Minimum-salary contract — allowed even over the cap">
            Minimum deal · cap-exempt
          </span>
        </div>

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
              v-for="y in [1, 2, 3, 4]"
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

      <!-- Team Status -->
      <div class="team-status">
        <div class="status-item" :class="{ warning: capBlocked }">
          <DollarSign :size="16" />
          <span>Cap Space: {{ formatSalary(capSpace) }}</span>
          <span v-if="capBlocked" class="status-badge error">Insufficient</span>
          <span v-else-if="exceedsCap && isMinimumDeal" class="status-badge success">Min exempt</span>
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
      <div v-if="rosterFull" class="warning-box">
        <AlertTriangle :size="18" />
        <span>Your roster is full. Release a player to make room.</span>
      </div>
      <div v-else-if="mode === 'instant' && capBlocked" class="warning-box">
        <AlertTriangle :size="18" />
        <span>Over the cap — you can only sign minimum-salary players. Lower the offer to the minimum ({{ formatSalary(minSalary) }}) or clear cap space.</span>
      </div>
      <div v-else-if="mode === 'instant' && (interestScore ?? 0) < SIGN_THRESHOLD" class="warning-box warning-box-soft">
        <AlertTriangle :size="18" />
        <span>This player won't sign for these terms. Raise the salary or contract length to win them over.</span>
      </div>
      <div v-else-if="mode === 'instant' && exceedsCap && isMinimumDeal" class="warning-box warning-box-soft">
        <AlertTriangle :size="18" />
        <span>Minimum-salary deal — allowed even though you're over the cap.</span>
      </div>
      <div v-else-if="mode === 'offer' && exceedsCap" class="warning-box warning-box-soft">
        <AlertTriangle :size="18" />
        <span>This offer would put you over the cap. You can still submit it — if more bids than your cap can fit ultimately accept, you'll pick which signings to keep at the end of free agency.</span>
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
  width: 76px;
  height: 76px;
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

/* Player interest meter — live preview of how the player feels about the
   current offer terms. --interest-color is set inline based on the bucket. */
.interest-meter {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--interest-color) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--interest-color) 35%, transparent);
  border-radius: 8px;
}

.interest-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.interest-icon {
  color: var(--interest-color);
}

.interest-eyebrow {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.interest-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--interest-color);
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--interest-color) 18%, transparent);
}

.interest-score {
  margin-left: auto;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.72rem;
  color: var(--color-text-secondary);
}

.interest-bar {
  position: relative;
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}

.interest-bar-fill {
  height: 100%;
  background: var(--interest-color);
  transition: width 0.2s ease;
}

/* The 30 cutoff is where the engine refuses to sign — draw a tick mark so
   the user can see when they cross the "will actually consider it" line. */
.interest-bar-threshold {
  position: absolute;
  top: -2px;
  bottom: -2px;
  left: 30%;
  width: 1px;
  background: rgba(255, 255, 255, 0.4);
}

.interest-hint {
  margin: 0;
  font-size: 0.74rem;
  color: var(--color-text-secondary);
  line-height: 1.35;
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

.offer-controls-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.offer-controls-head h4 {
  margin-bottom: 0;
}

.min-deal-badge {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #22c55e;
  background: rgba(34, 197, 94, 0.14);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: var(--radius-full, 999px);
  padding: 2px 8px;
  white-space: nowrap;
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

/* Soft variant — used when the cap overage is an informational nudge
   (offer mode: user can still submit; the choice is deferred to resolution). */
.warning-box-soft {
  align-items: flex-start;
  background: rgba(251, 191, 36, 0.08);
  border-color: rgba(251, 191, 36, 0.3);
  color: var(--color-text-primary);
  line-height: 1.4;
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

/* Standardized modal heights (90vh desktop, 85vh mobile) */
.modal-container {
  min-height: 90vh;
  max-height: 90vh;
}

@media (max-width: 480px) {
  .modal-container {
    min-height: 85vh;
    max-height: 85vh;
  }
}
</style>
