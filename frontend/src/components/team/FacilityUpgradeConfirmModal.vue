<script setup>
import { computed, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { X, Building2, Coins, AlertTriangle, Plus } from 'lucide-vue-next'

const router = useRouter()

const props = defineProps({
  show: { type: Boolean, default: false },
  facilityName: { type: String, default: 'Facility' },
  nextLevel: { type: Number, default: 1 },
  cost: { type: Number, default: 0 },
  userTokens: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'confirm'])

const cannotAfford = computed(() => props.userTokens < props.cost)
const confirmDisabled = computed(() => props.loading || cannotAfford.value)

function close() {
  if (props.loading) return
  emit('close')
}
function confirm() {
  if (confirmDisabled.value) return
  emit('confirm')
}
function goToStore() {
  emit('close')
  router.push('/store')
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
            <h2 class="modal-title">Upgrade {{ facilityName }}</h2>
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
            <div class="facility-icon-wrap">
              <Building2 :size="32" class="facility-icon" />
            </div>

            <p class="facility-blurb">
              Spend <strong>{{ cost.toLocaleString() }} tokens</strong> to upgrade
              <strong>{{ facilityName }}</strong> to <strong>Level {{ nextLevel }}</strong>?
            </p>

            <div class="facility-stats">
              <div class="facility-stat">
                <span class="stat-label">
                  <Coins :size="13" />
                  Cost
                </span>
                <span class="stat-value cost">{{ cost.toLocaleString() }} tokens</span>
              </div>
              <div class="facility-stat">
                <span class="stat-label">
                  <Coins :size="13" />
                  Your Balance
                </span>
                <div class="balance-cell">
                  <span class="stat-value" :class="{ negative: cannotAfford }">
                    {{ userTokens.toLocaleString() }} tokens
                  </span>
                  <button
                    type="button"
                    class="buy-tokens-btn"
                    title="Buy more tokens in the Store"
                    @click="goToStore"
                  >
                    <Plus :size="14" />
                    <span>Buy</span>
                  </button>
                </div>
              </div>
            </div>

            <div v-if="cannotAfford" class="facility-warn">
              <AlertTriangle :size="14" />
              <span>Not enough tokens to upgrade this facility.</span>
            </div>
          </main>

          <footer class="modal-footer">
            <button class="btn-cancel" :disabled="loading" @click="close">
              Cancel
            </button>
            <button
              class="btn-confirm"
              :disabled="confirmDisabled"
              @click="confirm"
            >
              <span v-if="loading" class="btn-spinner"></span>
              <Coins v-else :size="14" />
              <span>{{ loading ? 'Upgrading…' : 'Confirm Upgrade' }}</span>
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

.facility-icon-wrap {
  align-self: center;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 196, 0, 0.14);
  color: #ffd45a;
}

.facility-icon {
  color: inherit;
}

.facility-blurb {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
  text-align: center;
}

.facility-blurb strong {
  color: var(--color-text-primary);
  font-weight: 700;
}

.facility-stats {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.facility-stat {
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

.stat-value.cost {
  color: #ffd45a;
}

.stat-value.negative {
  color: #ef4444;
}

.balance-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.buy-tokens-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.buy-tokens-btn:hover {
  background: var(--color-bg-hover, rgba(255, 255, 255, 0.06));
  border-color: var(--color-primary);
}

.facility-warn {
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
  animation: facility-spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes facility-spin {
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
  animation: facility-scale-in 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active .modal-container {
  animation: facility-scale-out 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes facility-scale-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes facility-scale-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.95); }
}

@media (max-width: 480px) {
  .modal-container {
    max-height: 85vh;
  }
}
</style>
