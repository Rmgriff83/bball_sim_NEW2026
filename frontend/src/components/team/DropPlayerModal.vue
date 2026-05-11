<script setup>
import { computed } from 'vue'
import { DollarSign, AlertTriangle, UserMinus, X } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import { StatBadge, LoadingSpinner } from '@/components/ui'
import { getMotivationLabel, calculateRetentionScore } from '@/engine/ai/MotivationService'

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

// Top motivations (compact — 3 bars, read-only)
const topMotivations = computed(() => {
  if (!props.player?.motivations) return []
  return Object.entries(props.player.motivations)
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
})

const isContractYear = computed(() => {
  return (props.player?.contractYearsRemaining ?? 2) <= 1
})

const retentionPct = computed(() => {
  if (!props.player?.motivations) return null
  return calculateRetentionScore(props.player, {})
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

function getRetentionColor(pct) {
  if (pct >= 70) return '#22c55e'
  if (pct >= 40) return '#f59e0b'
  return '#ef4444'
}

function formatSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1000000) {
    return `$${Math.round(salary / 1000000)}M`
  }
  return `$${Math.round(salary / 1000)}K`
}

function handleClose() {
  if (props.loading) return
  emit('close')
}

function handleConfirm() {
  emit('confirm', {
    playerId: props.player.id
  })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="handleClose">
        <div class="modal-container">
          <header class="modal-header">
            <h2 class="modal-title">Drop Player</h2>
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

              <!-- Motivations (compact, top 3) -->
              <div v-if="topMotivations.length > 0" class="motivations-card">
                <h4 class="card-title">Key Motivations</h4>
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
                <div v-if="isContractYear && retentionPct !== null" class="retention-note">
                  <span class="retention-label">Re-sign likelihood:</span>
                  <span class="retention-pct" :style="{ color: getRetentionColor(retentionPct) }">{{ retentionPct }}%</span>
                </div>
              </div>

              <!-- Contract Details -->
              <div class="contract-details">
                <h4 class="card-title">Contract Being Terminated</h4>
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
            </div>
          </main>

          <footer class="modal-footer">
            <button class="btn-cancel" :disabled="loading" @click="handleClose">
              Cancel
            </button>
            <button class="btn-danger" :disabled="loading" @click="handleConfirm">
              <UserMinus :size="16" class="btn-icon" />
              Drop Player
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

.drop-content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* Card Title */
.card-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
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

/* Motivations Card */
.motivations-card {
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

.retention-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.retention-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.retention-pct {
  font-size: 0.85rem;
  font-weight: 700;
}

/* Contract Details */
.contract-details {
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
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

.contract-row:last-child { border-bottom: none; }

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

.contract-value.savings { color: var(--color-success); }

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

.impact-info strong { font-weight: 700; }

/* Footer (global standard: direct button children, flex:1, uppercase 0.85rem 600) */
.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-cancel,
.btn-danger {
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

.btn-danger {
  background: var(--color-error, #ef4444);
  border: none;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-cancel:disabled,
.btn-danger:disabled {
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
