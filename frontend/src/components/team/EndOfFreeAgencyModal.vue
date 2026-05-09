<script setup>
import { computed } from 'vue'
import { X, CheckCircle2, XCircle, Briefcase } from 'lucide-vue-next'

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  results: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['close'])

const accepted = computed(() => props.results?.accepted || [])
const declined = computed(() => props.results?.declined || [])

const hasAnyOutcome = computed(() => accepted.value.length + declined.value.length > 0)

function formatSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1_000_000) return `$${(salary / 1_000_000).toFixed(1)}M`
  return `$${(salary / 1000).toFixed(0)}K`
}

function totalValue(years, salary) {
  return formatSalary((years || 0) * (salary || 0))
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
            <button class="btn-cancel" @click="close">Close</button>
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
