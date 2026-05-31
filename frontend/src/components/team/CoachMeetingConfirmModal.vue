<script setup>
import { computed, watch, onUnmounted } from 'vue'
import { X, MessagesSquare, Heart, Coins, AlertTriangle } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  // 'spend' = use one of the coach's per-season actions
  // 'buy'   = out of actions, purchase one extra with tokens
  mode: { type: String, default: 'spend' },
  playerName: { type: String, default: 'Player' },
  actionsRemaining: { type: Number, default: 0 },
  actionBudget: { type: Number, default: 0 },
  extraActionCost: { type: Number, default: 0 },
  userTokens: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'confirm'])

const isBuyMode = computed(() => props.mode === 'buy')
const cannotAfford = computed(() => isBuyMode.value && props.userTokens < props.extraActionCost)
const confirmDisabled = computed(() => props.loading || cannotAfford.value)

function close() {
  if (props.loading) return
  emit('close')
}
function confirm() {
  if (confirmDisabled.value) return
  emit('confirm')
}

function handleKeydown(e) {
  if (e.key === 'Escape') close()
}
watch(() => props.show, (open) => {
  if (open) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', handleKeydown)
  }
})
onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <header class="modal-header">
            <h2 class="modal-title">{{ isBuyMode ? 'Buy Extra Meeting' : 'Coach Meeting' }}</h2>
            <button
              v-if="!loading"
              class="btn-close"
              aria-label="Close"
              @click="close"
            >
              <X :size="20" />
            </button>
          </header>

          <main class="modal-content">
            <div class="meeting-icon-wrap" :class="{ 'is-buy': isBuyMode }">
              <MessagesSquare v-if="!isBuyMode" :size="32" class="meeting-icon" />
              <Coins v-else :size="32" class="meeting-icon" />
            </div>

            <p class="meeting-blurb">
              <template v-if="isBuyMode">
                You're out of coach meetings for this season. Buy one more for
                <strong>{{ extraActionCost }} tokens</strong> to hold a meeting
                with <strong>{{ playerName }}</strong>?
              </template>
              <template v-else>
                Hold a coach meeting with <strong>{{ playerName }}</strong>?
                This boosts their morale by 30 points (clamped at 100).
              </template>
            </p>

            <!-- Budget / cost summary block -->
            <div class="meeting-stats">
              <div class="meeting-stat">
                <span class="stat-label">
                  <Heart :size="13" />
                  Morale Boost
                </span>
                <span class="stat-value boost">+30</span>
              </div>
              <div v-if="!isBuyMode" class="meeting-stat">
                <span class="stat-label">
                  <MessagesSquare :size="13" />
                  Actions Used
                </span>
                <span class="stat-value">
                  1 of {{ actionsRemaining }} remaining
                </span>
              </div>
              <template v-else>
                <div class="meeting-stat">
                  <span class="stat-label">
                    <Coins :size="13" />
                    Cost
                  </span>
                  <span class="stat-value cost">{{ extraActionCost }} tokens</span>
                </div>
                <div class="meeting-stat">
                  <span class="stat-label">
                    <Coins :size="13" />
                    Your Balance
                  </span>
                  <span class="stat-value" :class="{ negative: cannotAfford }">
                    {{ userTokens }} tokens
                  </span>
                </div>
              </template>
            </div>

            <div v-if="cannotAfford" class="meeting-warn">
              <AlertTriangle :size="14" />
              <span>Not enough tokens to purchase an extra meeting.</span>
            </div>
          </main>

          <footer class="modal-footer">
            <button class="btn-cancel" :disabled="loading" @click="close">
              Cancel
            </button>
            <button
              class="btn-confirm"
              :class="{ 'is-buy': isBuyMode }"
              :disabled="confirmDisabled"
              @click="confirm"
            >
              <span v-if="loading" class="btn-spinner"></span>
              <template v-else>
                <Coins v-if="isBuyMode" :size="14" />
                <MessagesSquare v-else :size="14" />
              </template>
              <span>{{ loading ? 'Working…' : (isBuyMode ? 'Buy & Hold Meeting' : 'Hold Meeting') }}</span>
            </button>
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
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.modal-container {
  width: 100%;
  max-width: 440px;
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
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.meeting-icon-wrap {
  align-self: center;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(168, 85, 247, 0.14);
  color: #c084fc;
}

.meeting-icon-wrap.is-buy {
  background: rgba(255, 196, 0, 0.14);
  color: #ffd45a;
}

.meeting-icon {
  color: inherit;
}

.meeting-blurb {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
  text-align: center;
}

.meeting-blurb strong {
  color: var(--color-text-primary);
  font-weight: 700;
}

.meeting-stats {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.meeting-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.82rem;
}

.stat-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.7rem;
  font-weight: 600;
}

.stat-value {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--color-text-primary);
  font-weight: 600;
}

.stat-value.boost {
  color: #22c55e;
}

.stat-value.cost {
  color: #ffd45a;
}

.stat-value.negative {
  color: #ef4444;
}

.meeting-warn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-lg);
  color: #ef4444;
  font-size: 0.8rem;
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
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

.btn-confirm.is-buy {
  background: #f59e0b;
}

.btn-confirm:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.btn-cancel:disabled,
.btn-confirm:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  filter: none;
}

.btn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: meeting-spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes meeting-spin {
  to { transform: rotate(360deg); }
}

.modal-enter-active {
  transition: opacity 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-container {
  animation: meeting-scale-in 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active .modal-container {
  animation: meeting-scale-out 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes meeting-scale-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes meeting-scale-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.95); }
}

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
