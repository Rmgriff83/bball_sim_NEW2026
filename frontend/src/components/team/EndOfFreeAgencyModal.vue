<script setup>
import { computed, ref, watch } from 'vue'
import { X, CheckCircle2, XCircle, Briefcase, AlertTriangle } from 'lucide-vue-next'

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  results: {
    type: Object,
    default: null,
  },
  finalizing: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'confirm-choices'])

const accepted = computed(() => props.results?.accepted || [])
const declined = computed(() => props.results?.declined || [])
const pendingChoice = computed(() => props.results?.pendingChoice || null)
const pendingOffers = computed(() => pendingChoice.value?.offers ?? [])
const capSpace = computed(() => pendingChoice.value?.capSpace ?? 0)

const hasAnyOutcome = computed(() =>
  accepted.value.length + declined.value.length + pendingOffers.value.length > 0
)

const selectedIds = ref(new Set())

// Reset selection whenever a new pendingChoice block lands in the modal.
watch(pendingOffers, (offers) => {
  selectedIds.value = new Set()
  if (!offers || offers.length === 0) return
  // Greedy default: pre-select the highest-rated player first, then keep
  // adding by rating until the next one would push us over the cap. Saves
  // the user a click when the choice is obvious.
  const byRating = [...offers].sort(
    (a, b) => (b.overallRating ?? 0) - (a.overallRating ?? 0)
  )
  let running = 0
  const next = new Set()
  for (const o of byRating) {
    if (running + (o.salary ?? 0) <= capSpace.value) {
      next.add(String(o.playerId))
      running += o.salary ?? 0
    }
  }
  selectedIds.value = next
})

function toggleSelected(playerId) {
  const id = String(playerId)
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

const selectedTotal = computed(() => {
  let sum = 0
  for (const o of pendingOffers.value) {
    if (selectedIds.value.has(String(o.playerId))) sum += o.salary ?? 0
  }
  return sum
})

const remainingAfterChoice = computed(() => capSpace.value - selectedTotal.value)
const overCap = computed(() => selectedTotal.value > capSpace.value)
const confirmDisabled = computed(() => overCap.value || props.finalizing)

function formatSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1_000_000) return `$${(salary / 1_000_000).toFixed(1)}M`
  return `$${(salary / 1000).toFixed(0)}K`
}

function totalValue(years, salary) {
  return formatSalary((years || 0) * (salary || 0))
}

function confirmChoices() {
  if (confirmDisabled.value) return
  emit('confirm-choices', Array.from(selectedIds.value))
}

function close() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <header class="modal-header">
            <div class="header-left">
              <Briefcase :size="22" class="header-icon" />
              <h2 class="modal-title">Free Agency Wrap-Up</h2>
            </div>
            <button class="btn-close" aria-label="Close" @click="close">
              <X :size="20" />
            </button>
          </header>

          <main class="modal-content">
            <div v-if="!hasAnyOutcome" class="empty-state">
              <p>You didn't make any offers this free-agency window.</p>
            </div>

            <template v-else>
              <!-- Pending choice: user won more bids than their cap can fit.
                   Surface a checklist that respects the cap meter so they
                   can pick which signings to keep. -->
              <section v-if="pendingOffers.length > 0" class="outcome-section pending-section">
                <div class="section-header">
                  <AlertTriangle :size="16" class="section-icon pending" />
                  <h3 class="section-title">Decision Required</h3>
                  <span class="section-count">{{ pendingOffers.length }}</span>
                </div>
                <p class="pending-blurb">
                  More players accepted your offers than your cap can fit. Pick which signings to lock in — anything you skip stays a free agent.
                </p>
                <div class="cap-meter" :class="{ over: overCap }">
                  <div class="cap-row">
                    <span class="cap-label">Selected payroll</span>
                    <span class="cap-value">{{ formatSalary(selectedTotal) }}</span>
                  </div>
                  <div class="cap-row">
                    <span class="cap-label">Cap space</span>
                    <span class="cap-value">{{ formatSalary(capSpace) }}</span>
                  </div>
                  <div class="cap-row cap-row-remaining">
                    <span class="cap-label">{{ overCap ? 'Over by' : 'Remaining' }}</span>
                    <span class="cap-value" :class="{ negative: overCap }">
                      {{ formatSalary(Math.abs(remainingAfterChoice)) }}
                    </span>
                  </div>
                </div>
                <ul class="outcome-list">
                  <li
                    v-for="offer in pendingOffers"
                    :key="offer.playerId"
                    class="outcome-row pending-row"
                    :class="{ 'pending-row-selected': selectedIds.has(String(offer.playerId)) }"
                  >
                    <label class="pending-label">
                      <input
                        type="checkbox"
                        :checked="selectedIds.has(String(offer.playerId))"
                        :disabled="finalizing"
                        @change="toggleSelected(offer.playerId)"
                      />
                      <div class="pending-info">
                        <div class="outcome-row-top">
                          <div class="outcome-name">{{ offer.playerName }}</div>
                          <div v-if="offer.overallRating != null" class="pending-ovr">
                            {{ offer.overallRating }} OVR
                          </div>
                        </div>
                        <div class="outcome-terms">
                          <span class="terms-salary">{{ formatSalary(offer.salary) }}</span>
                          <span class="terms-divider">·</span>
                          <span class="terms-years">{{ offer.years }} {{ offer.years === 1 ? 'yr' : 'yrs' }}</span>
                          <span class="terms-divider">·</span>
                          <span class="terms-total">{{ totalValue(offer.years, offer.salary) }} total</span>
                          <span v-if="offer.position" class="terms-divider">·</span>
                          <span v-if="offer.position" class="terms-pos">{{ offer.position }}</span>
                        </div>
                        <div class="pending-fallback">
                          <template v-if="offer.fallback?.teamAbbr">
                            If passed → signs with <strong>{{ offer.fallback.teamAbbr }}</strong>
                            ({{ formatSalary(offer.fallback.salary) }} / {{ offer.fallback.years }}yr)
                          </template>
                          <template v-else>
                            If passed → stays a free agent (no AI runner-up)
                          </template>
                        </div>
                      </div>
                    </label>
                  </li>
                </ul>
              </section>

              <section v-if="accepted.length > 0" class="outcome-section">
                <div class="section-header">
                  <CheckCircle2 :size="16" class="section-icon accepted" />
                  <h3 class="section-title">Signed With You</h3>
                  <span class="section-count">{{ accepted.length }}</span>
                </div>
                <ul class="outcome-list">
                  <li v-for="row in accepted" :key="row.playerId" class="outcome-row accepted-row">
                    <div class="outcome-name">{{ row.playerName }}</div>
                    <div class="outcome-terms">
                      <span class="terms-salary">{{ formatSalary(row.salary) }}</span>
                      <span class="terms-divider">·</span>
                      <span class="terms-years">{{ row.years }} {{ row.years === 1 ? 'yr' : 'yrs' }}</span>
                      <span class="terms-divider">·</span>
                      <span class="terms-total">{{ totalValue(row.years, row.salary) }} total</span>
                    </div>
                  </li>
                </ul>
              </section>

              <section v-if="declined.length > 0" class="outcome-section">
                <div class="section-header">
                  <XCircle :size="16" class="section-icon declined" />
                  <h3 class="section-title">Signed Elsewhere / Unsigned</h3>
                  <span class="section-count">{{ declined.length }}</span>
                </div>
                <ul class="outcome-list">
                  <li v-for="row in declined" :key="row.playerId" class="outcome-row declined-row">
                    <div class="outcome-row-top">
                      <div class="outcome-name">{{ row.playerName }}</div>
                      <div class="outcome-destination">
                        <span v-if="row.signedWith === 'unsigned'" class="dest-badge unsigned">UNSIGNED</span>
                        <span v-else class="dest-badge signed">{{ row.signedWithAbbr }}</span>
                      </div>
                    </div>
                    <div class="outcome-row-bottom">
                      <div class="offer-pair">
                        <span class="offer-label">Your offer:</span>
                        <span class="offer-value">{{ formatSalary(row.userOffer?.salary) }} / {{ row.userOffer?.years }}yr</span>
                      </div>
                      <div v-if="row.winningOffer" class="offer-pair">
                        <span class="offer-label">Winning offer:</span>
                        <span class="offer-value">{{ formatSalary(row.winningOffer.salary) }} / {{ row.winningOffer.years }}yr</span>
                      </div>
                    </div>
                    <p v-if="row.reason" class="outcome-reason">{{ row.reason }}</p>
                  </li>
                </ul>
              </section>
            </template>
          </main>

          <footer class="modal-footer">
            <button v-if="pendingOffers.length === 0" class="btn-cancel" @click="close">Close</button>
            <template v-else>
              <button class="btn-cancel" :disabled="finalizing" @click="close">Cancel</button>
              <button
                class="btn-confirm"
                :disabled="confirmDisabled"
                @click="confirmChoices"
              >
                {{ finalizing ? 'Signing…' : `Confirm ${selectedIds.size} Signing${selectedIds.size === 1 ? '' : 's'}` }}
              </button>
            </template>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
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
  max-width: 560px;
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

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  color: #c084fc;
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
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.empty-state {
  padding: 32px 16px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.outcome-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-icon.accepted { color: var(--color-success); }
.section-icon.declined { color: var(--color-error); }
.section-icon.pending { color: #fbbf24; }

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-primary);
  margin: 0;
}

.section-count {
  margin-left: auto;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
}

.outcome-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.outcome-row {
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.accepted-row {
  background: rgba(34, 197, 94, 0.07);
  border-color: rgba(34, 197, 94, 0.25);
}

.outcome-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.outcome-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.outcome-row-bottom {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.outcome-terms {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.terms-salary { color: var(--color-success); font-weight: 600; }
.terms-divider { color: var(--color-text-tertiary); }

.dest-badge {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
}

.dest-badge.signed {
  background: rgba(168, 85, 247, 0.18);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.3);
}

.dest-badge.unsigned {
  background: rgba(148, 163, 184, 0.15);
  color: var(--color-text-secondary);
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.offer-pair {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
}

.offer-label {
  color: var(--color-text-tertiary);
}

.offer-value {
  color: var(--color-text-primary);
  font-weight: 600;
}

.outcome-reason {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  font-style: italic;
  margin: 4px 0 0;
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-cancel {
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
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.btn-cancel:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

.btn-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

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
  background: var(--color-primary);
  border: none;
  color: white;
}

.btn-confirm:hover:not(:disabled) {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.btn-confirm:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Pending-choice block */
.pending-section {
  background: rgba(251, 191, 36, 0.05);
  border: 1px solid rgba(251, 191, 36, 0.2);
  border-radius: 12px;
  padding: 14px;
}

.pending-blurb {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.cap-meter {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

.cap-meter.over {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}

.cap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.cap-row-remaining {
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-weight: 600;
  color: var(--color-text-primary);
}

.cap-value {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

.cap-value.negative {
  color: #ef4444;
}

.pending-row {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0;
}

.pending-row-selected {
  background: rgba(251, 191, 36, 0.08);
  border-color: rgba(251, 191, 36, 0.3);
}

.pending-label {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  cursor: pointer;
  width: 100%;
}

.pending-label input[type="checkbox"] {
  margin-top: 3px;
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.pending-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.pending-ovr {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 8px;
  border-radius: 6px;
}

.terms-pos {
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  font-size: 0.7rem;
}

.pending-fallback {
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
  font-style: italic;
  margin-top: 2px;
}

.pending-fallback strong {
  color: var(--color-text-secondary);
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.02em;
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
