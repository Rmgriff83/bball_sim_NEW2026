<script setup>
import { computed, watch, onUnmounted } from 'vue'
import { X, AlertTriangle, Users, Briefcase, FastForward, CheckCircle2 } from 'lucide-vue-next'
import { LoadingSpinner } from '@/components/ui'

const props = defineProps({
  show: { type: Boolean, default: false },
  rosterCount: { type: Number, default: 0 },
  rosterMinimum: { type: Number, default: 12 },
  hasCoach: { type: Boolean, default: false },
  simming: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'sim'])

const rosterShort = computed(() => props.rosterCount < props.rosterMinimum)
const needsCoach = computed(() => !props.hasCoach)
const playersNeeded = computed(() => Math.max(0, props.rosterMinimum - props.rosterCount))

function close() {
  if (props.simming) return
  emit('close')
}
function sim() {
  if (props.simming) return
  emit('sim')
}
function onKeydown(e) {
  if (e.key === 'Escape') close()
}
watch(() => props.show, (open) => {
  if (open) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeydown)
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', onKeydown)
  }
})
onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <header class="modal-header">
            <h2 class="modal-title">Not Ready to Start</h2>
            <button
              v-if="!simming"
              class="btn-close"
              aria-label="Close"
              @click="close"
            >
              <X :size="20" />
            </button>
          </header>

          <main class="modal-content">
            <div class="blocker-icon-wrap">
              <AlertTriangle :size="32" class="blocker-icon" />
            </div>

            <p class="blocker-blurb">
              You can't start the new season yet. The league needs a few things squared away first:
            </p>

            <ul class="blocker-list">
              <li class="blocker-row" :class="{ resolved: hasCoach }">
                <component
                  :is="hasCoach ? CheckCircle2 : Briefcase"
                  :size="18"
                  class="blocker-row-icon"
                />
                <div class="blocker-row-text">
                  <div class="blocker-row-title">Head Coach</div>
                  <div class="blocker-row-detail">
                    <template v-if="hasCoach">Signed.</template>
                    <template v-else>No head coach signed. Hire one from the Personnel tab.</template>
                  </div>
                </div>
              </li>
              <li class="blocker-row" :class="{ resolved: !rosterShort }">
                <component
                  :is="!rosterShort ? CheckCircle2 : Users"
                  :size="18"
                  class="blocker-row-icon"
                />
                <div class="blocker-row-text">
                  <div class="blocker-row-title">Roster</div>
                  <div class="blocker-row-detail">
                    <template v-if="!rosterShort">
                      {{ rosterCount }} players rostered.
                    </template>
                    <template v-else>
                      {{ rosterCount }} / {{ rosterMinimum }} players rostered — sign at least
                      {{ playersNeeded }} more from the Free Agents tab.
                    </template>
                  </div>
                </div>
              </li>
            </ul>

            <p class="blocker-sim-blurb">
              Or let the front office handle it — the AI will hire the best available free coach and sign free agents to fill your roster.
            </p>
          </main>

          <footer class="modal-footer">
            <button
              class="btn-cancel"
              :disabled="simming"
              @click="close"
            >
              Fix It Myself
            </button>
            <button
              class="btn-confirm"
              :disabled="simming"
              @click="sim"
            >
              <LoadingSpinner v-if="simming" size="sm" />
              <FastForward v-else :size="16" class="btn-icon" />
              {{ simming ? 'Setting Up…' : 'Let AI Finish Setup' }}
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
  max-width: 480px;
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

.blocker-icon-wrap {
  align-self: center;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(245, 158, 11, 0.12);
}

.blocker-icon {
  color: #f59e0b;
}

.blocker-blurb {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
  text-align: center;
}

.blocker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.blocker-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 10px;
}

.blocker-row.resolved {
  background: rgba(34, 197, 94, 0.06);
  border-color: rgba(34, 197, 94, 0.25);
}

.blocker-row-icon {
  color: #f59e0b;
  flex-shrink: 0;
  margin-top: 1px;
}

.blocker-row.resolved .blocker-row-icon {
  color: var(--color-success);
}

.blocker-row-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.blocker-row-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.blocker-row-detail {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.blocker-sim-blurb {
  margin: 4px 0 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--color-text-tertiary);
  text-align: center;
  font-style: italic;
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
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.btn-cancel:disabled,
.btn-confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-icon {
  fill: currentColor;
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
  animation: blocker-scale-in 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active .modal-container {
  animation: blocker-scale-out 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes blocker-scale-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes blocker-scale-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.95); }
}
</style>
