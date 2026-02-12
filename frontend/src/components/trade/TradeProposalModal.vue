<script setup>
import { computed } from 'vue'
import { useTradeStore } from '@/stores/trade'
import { X, ArrowLeftRight, Check, XCircle } from 'lucide-vue-next'

const props = defineProps({
  show: Boolean,
  proposal: Object,
})

const emit = defineEmits(['close', 'accept', 'reject'])

const tradeStore = useTradeStore()

const teamName = computed(() => {
  if (!props.proposal?.proposing_team) return ''
  const t = props.proposal.proposing_team
  return `${t.city} ${t.name}`
})

const teamColor = computed(() => props.proposal?.proposing_team?.primary_color || '#E85A4F')

function formatSalary(salary) {
  return tradeStore.formatSalary(salary)
}

function getPlayerAge(player) {
  const age = player?.age
  if (age === null || age === undefined) return '?'
  return Math.abs(Math.round(age))
}

function handleClose() {
  emit('close')
}

function handleAccept() {
  emit('accept', props.proposal)
}

function handleReject() {
  emit('reject', props.proposal)
}

function handleKeydown(e) {
  if (e.key === 'Escape') handleClose()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show && proposal" class="modal-overlay" @click.self="handleClose" @keydown="handleKeydown">
        <div class="modal-container">
          <!-- Header -->
          <div class="modal-header">
            <div class="header-left">
              <div class="team-badge" :style="{ backgroundColor: teamColor }">
                {{ proposal.proposing_team?.abbreviation }}
              </div>
              <div class="header-text">
                <h2 class="modal-title">Trade Proposal</h2>
                <p class="modal-subtitle">{{ teamName }} want to make a deal</p>
              </div>
            </div>
            <button class="close-btn" @click="handleClose">
              <X :size="20" />
            </button>
          </div>

          <!-- Content -->
          <div class="modal-content">
            <!-- Trade Columns -->
            <div class="trade-columns">
              <!-- They Offer -->
              <div class="trade-column">
                <h3 class="column-header offer">They Offer</h3>
                <div class="assets-list">
                  <div
                    v-for="(asset, i) in proposal.ai_gives"
                    :key="'give-' + i"
                    class="asset-card"
                  >
                    <template v-if="asset.type === 'player' && asset.player">
                      <div class="player-info-row">
                        <div class="player-details">
                          <span class="player-name">{{ asset.player.firstName }} {{ asset.player.lastName }}</span>
                          <span class="player-meta">{{ asset.player.position }} | Age {{ getPlayerAge(asset.player) }}</span>
                        </div>
                        <div class="player-rating-badge">{{ asset.player.overallRating }}</div>
                      </div>
                      <div class="player-contract">
                        {{ formatSalary(asset.player.contractSalary) }} | {{ asset.player.contractYearsRemaining ?? 1 }}yr
                      </div>
                    </template>
                    <template v-else-if="asset.type === 'pick' && asset.pick">
                      <div class="pick-info">
                        <span class="pick-label">Draft Pick</span>
                        <span class="pick-detail">{{ asset.pick.year }} Rd {{ asset.pick.round }}</span>
                      </div>
                    </template>
                  </div>
                </div>
              </div>

              <!-- Swap Icon -->
              <div class="swap-divider">
                <ArrowLeftRight :size="20" />
              </div>

              <!-- They Want -->
              <div class="trade-column">
                <h3 class="column-header want">They Want</h3>
                <div class="assets-list">
                  <div
                    v-for="(asset, i) in proposal.ai_receives"
                    :key="'receive-' + i"
                    class="asset-card"
                  >
                    <template v-if="asset.type === 'player' && asset.player">
                      <div class="player-info-row">
                        <div class="player-details">
                          <span class="player-name">{{ asset.player.firstName }} {{ asset.player.lastName }}</span>
                          <span class="player-meta">{{ asset.player.position }} | Age {{ getPlayerAge(asset.player) }}</span>
                        </div>
                        <div class="player-rating-badge">{{ asset.player.overallRating }}</div>
                      </div>
                      <div class="player-contract">
                        {{ formatSalary(asset.player.contractSalary) }} | {{ asset.player.contractYearsRemaining ?? 1 }}yr
                      </div>
                    </template>
                    <template v-else-if="asset.type === 'pick' && asset.pick">
                      <div class="pick-info">
                        <span class="pick-label">Draft Pick</span>
                        <span class="pick-detail">{{ asset.pick.year }} Rd {{ asset.pick.round }}</span>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>

            <!-- Reason -->
            <div v-if="proposal.reason" class="proposal-reason">
              <p>"{{ proposal.reason }}"</p>
            </div>

            <!-- Expires -->
            <div class="proposal-expires">
              Expires: {{ proposal.expires_at }}
            </div>
          </div>

          <!-- Footer -->
          <div class="modal-footer">
            <button class="btn-reject" @click="handleReject">
              <XCircle :size="16" />
              Reject
            </button>
            <button class="btn-accept" @click="handleAccept">
              <Check :size="16" />
              Accept Trade
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.modal-container {
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: scaleIn 0.2s ease-out;
}

@keyframes scaleIn {
  from {
    transform: scale(0.95);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* Header */
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
  gap: 12px;
}

.team-badge {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.header-text {
  display: flex;
  flex-direction: column;
}

.modal-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.modal-subtitle {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin: 2px 0 0 0;
}

.close-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

/* Content */
.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.trade-columns {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.trade-column {
  flex: 1;
  min-width: 0;
}

.column-header {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin: 0 0 10px 0;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  text-align: center;
}

.column-header.offer {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.column-header.want {
  background: rgba(232, 90, 79, 0.15);
  color: var(--color-primary);
}

.swap-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 40px;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.assets-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.asset-card {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 10px 12px;
}

.player-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.player-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.player-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-meta {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
}

.player-rating-badge {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(232, 90, 79, 0.15);
  border-radius: var(--radius-md);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--color-primary);
  flex-shrink: 0;
}

.player-contract {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  margin-top: 4px;
}

.pick-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pick-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.pick-detail {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
}

/* Reason */
.proposal-reason {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-lg);
  border-left: 3px solid var(--color-primary);
}

.proposal-reason p {
  font-size: 0.85rem;
  font-style: italic;
  color: var(--color-text-secondary);
  margin: 0;
  line-height: 1.5;
}

.proposal-expires {
  margin-top: 12px;
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  text-align: center;
}

/* Footer */
.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-reject,
.btn-accept {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-reject {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
}

.btn-reject:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.btn-accept {
  background: #22c55e;
  border: none;
  color: white;
}

.btn-accept:hover {
  background: #16a34a;
  transform: translateY(-1px);
}

/* Transitions */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
