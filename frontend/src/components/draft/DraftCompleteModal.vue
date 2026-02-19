<script setup>
import { computed, watch, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'
import { LoadingSpinner } from '@/components/ui'

const props = defineProps({
  show: { type: Boolean, default: false },
  userRoster: { type: Array, default: () => [] },
  finalizing: { type: Boolean, default: false },
  draftMode: { type: String, default: 'fantasy' },
})

const isRookieMode = computed(() => props.draftMode === 'rookie')

const emit = defineEmits(['continue', 'close'])

const positions = ['PG', 'SG', 'SF', 'PF', 'C']

const rosterByPosition = computed(() => {
  const grouped = {}
  positions.forEach(p => grouped[p] = [])
  for (const pick of props.userRoster) {
    const pos = pick.position
    if (grouped[pos]) grouped[pos].push(pick)
    else grouped['SF'].push(pick)
  }
  return grouped
})

const averageOverall = computed(() => {
  if (!props.userRoster.length) return 0
  const sum = props.userRoster.reduce((acc, p) => acc + (p.overallRating || 0), 0)
  return Math.round(sum / props.userRoster.length)
})

function close() {
  if (!props.finalizing) {
    emit('close')
  }
}

function handleKeydown(e) {
  if (e.key === 'Escape') close()
}

watch(() => props.show, (isOpen) => {
  if (isOpen) {
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
      <div
        v-if="show"
        class="modal-overlay"
        @click.self="close"
      >
        <div class="modal-container">
          <!-- Header -->
          <header class="modal-header">
            <h2 class="modal-title">{{ isRookieMode ? 'Rookie Draft Complete' : 'Draft Complete' }}</h2>
            <button class="modal-close" @click="close" aria-label="Close">
              <X :size="20" />
            </button>
          </header>

          <!-- Content -->
          <main class="modal-content">
            <div class="team-avg">
              <span class="avg-label">TEAM AVERAGE</span>
              <span class="avg-value">{{ averageOverall }}</span>
              <span class="avg-ovr">OVR</span>
            </div>

            <div class="roster-grid">
              <div
                v-for="pos in positions"
                :key="pos"
                class="pos-section"
              >
                <div class="pos-label">{{ pos }}</div>
                <div
                  v-for="player in rosterByPosition[pos]"
                  :key="player.playerId"
                  class="player-row"
                >
                  <span class="player-name">{{ player.playerName }}</span>
                  <span class="player-ovr">{{ player.overallRating }}</span>
                </div>
                <div v-if="rosterByPosition[pos].length === 0" class="empty-slot">
                  Empty
                </div>
              </div>
            </div>
          </main>

          <!-- Footer -->
          <footer class="modal-footer">
            <button class="btn-cancel" @click="close" :disabled="finalizing">
              Close
            </button>
            <button class="btn-continue" @click="emit('continue')" :disabled="finalizing">
              <LoadingSpinner v-if="finalizing" size="sm" />
              <template v-else>{{ isRookieMode ? 'Return to Offseason' : 'Continue to Campaign' }}</template>
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
  max-width: 500px;
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

.modal-close {
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

.modal-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.team-avg {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 20px;
  padding: 12px 16px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--glass-border);
}

.avg-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
}

.avg-value {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  line-height: 1;
  color: var(--color-primary);
}

.avg-ovr {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.roster-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pos-section {
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.pos-section:last-child {
  border-bottom: none;
}

.pos-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.player-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.player-name {
  font-size: 0.85rem;
  color: var(--color-text-primary);
}

.player-ovr {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-primary);
}

.empty-slot {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  font-style: italic;
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-cancel,
.btn-continue {
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
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.btn-cancel:hover {
  background: var(--color-bg-tertiary);
}

.btn-continue {
  background: var(--color-primary);
  border: none;
  color: white;
}

.btn-continue:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-continue:disabled,
.btn-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Modal Transitions */
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
  animation: modalScaleIn 0.3s cubic-bezier(0, 0, 0.2, 1);
}

@keyframes modalScaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
</style>
