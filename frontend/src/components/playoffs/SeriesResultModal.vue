<script setup>
import { computed, watch, onUnmounted } from 'vue'
import { X, Trophy, ShieldX, FastForward } from 'lucide-vue-next'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  seriesResult: {
    type: Object,
    default: null
  },
  userTeamId: {
    type: [Number, String],
    default: null
  },
  simulating: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'simNextSeries', 'simRemainingPlayoffs'])

const series = computed(() => props.seriesResult?.series ?? null)
const winner = computed(() => props.seriesResult?.winner ?? null)
const round = computed(() => props.seriesResult?.round ?? 0)

const userWon = computed(() => {
  if (!winner.value || !props.userTeamId) return false
  return winner.value.teamId == props.userTeamId
})

const roundLabel = computed(() => {
  switch (round.value) {
    case 1: return 'First Round'
    case 2: return 'Semifinals'
    case 3: return 'Conference Finals'
    case 4: return 'NBA Finals'
    default: return 'Playoffs'
  }
})

const userTeam = computed(() => {
  if (!series.value || !props.userTeamId) return null
  if (series.value.team1?.teamId == props.userTeamId) return series.value.team1
  if (series.value.team2?.teamId == props.userTeamId) return series.value.team2
  return null
})

const opponentTeam = computed(() => {
  if (!series.value || !props.userTeamId) return null
  if (series.value.team1?.teamId == props.userTeamId) return series.value.team2
  if (series.value.team2?.teamId == props.userTeamId) return series.value.team1
  return null
})

const userWins = computed(() => {
  if (!series.value || !props.userTeamId) return 0
  return series.value.team1?.teamId == props.userTeamId
    ? series.value.team1Wins
    : series.value.team2Wins
})

const opponentWins = computed(() => {
  if (!series.value || !props.userTeamId) return 0
  return series.value.team1?.teamId == props.userTeamId
    ? series.value.team2Wins
    : series.value.team1Wins
})

const mvp = computed(() => props.seriesResult?.seriesMVP ?? series.value?.seriesMVP ?? null)

function close() {
  if (!props.simulating) {
    emit('close')
  }
}

function handleKeydown(e) {
  if (e.key === 'Escape' && !props.simulating) {
    close()
  }
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
        v-if="show && seriesResult"
        class="modal-overlay"
        @click.self="close"
      >
        <div class="modal-container">
          <!-- Header -->
          <header class="modal-header">
            <h2 class="modal-title">{{ roundLabel }}</h2>
            <button
              v-if="!simulating"
              class="btn-close"
              @click="close"
              aria-label="Close"
            >
              <X :size="20" />
            </button>
          </header>

          <!-- Content -->
          <main class="modal-content">
            <!-- Result Icon -->
            <div class="result-icon-wrap" :class="userWon ? 'win' : 'loss'">
              <Trophy v-if="userWon" :size="40" class="result-icon" />
              <ShieldX v-else :size="40" class="result-icon" />
            </div>

            <!-- Result Title -->
            <h3 class="result-title">{{ userWon ? 'Series Won!' : 'Eliminated' }}</h3>
            <p class="result-subtitle">{{ roundLabel }} · Best of 7</p>

            <!-- Series Score -->
            <div class="series-final-score">
              <div class="score-team" :class="{ 'is-winner': userWon }">
                <div
                  class="score-badge"
                  :style="{ backgroundColor: userTeam?.primaryColor || '#666' }"
                >
                  {{ userTeam?.abbreviation }}
                </div>
                <span class="score-name">{{ userTeam?.name }}</span>
              </div>
              <div class="score-display">
                <span class="score-value" :class="{ leading: userWins > opponentWins }">{{ userWins }}</span>
                <span class="score-dash">-</span>
                <span class="score-value" :class="{ leading: opponentWins > userWins }">{{ opponentWins }}</span>
              </div>
              <div class="score-team" :class="{ 'is-winner': !userWon }">
                <div
                  class="score-badge"
                  :style="{ backgroundColor: opponentTeam?.primaryColor || '#666' }"
                >
                  {{ opponentTeam?.abbreviation }}
                </div>
                <span class="score-name">{{ opponentTeam?.name }}</span>
              </div>
            </div>

            <!-- Series MVP -->
            <div v-if="mvp" class="series-mvp">
              <span class="mvp-label">Series MVP</span>
              <span class="mvp-name">{{ mvp.name || `${mvp.first_name} ${mvp.last_name}` }}</span>
              <span v-if="mvp.ppg" class="mvp-stats">
                {{ mvp.ppg }} PTS · {{ mvp.rpg }} REB · {{ mvp.apg }} AST
              </span>
            </div>

            <!-- Message -->
            <p v-if="userWon" class="result-message">
              Congratulations! You advance to the next round.
            </p>
            <p v-else class="result-message">
              Your playoff run is over. Sim the remaining playoffs and prepare for next season.
            </p>
          </main>

          <!-- Footer -->
          <footer class="modal-footer">
            <button
              class="btn-cancel"
              :disabled="simulating"
              @click="close"
            >
              Close
            </button>
            <button
              v-if="userWon"
              class="btn-confirm"
              :disabled="simulating"
              @click="emit('simNextSeries')"
            >
              <FastForward :size="16" class="btn-icon" />
              Sim to Next Series
            </button>
            <button
              v-else
              class="btn-confirm"
              :disabled="simulating"
              @click="emit('simRemainingPlayoffs')"
            >
              <FastForward :size="16" class="btn-icon" />
              Sim Playoffs
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

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
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
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

/* Result Icon */
.result-icon-wrap {
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.result-icon-wrap.win {
  background: rgba(34, 197, 94, 0.15);
}

.result-icon-wrap.win .result-icon {
  color: var(--color-success, #22c55e);
}

.result-icon-wrap.loss {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.result-icon-wrap.loss .result-icon {
  color: var(--color-primary);
}

.result-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.result-subtitle {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

/* Series Score */
.series-final-score {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 16px 20px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  width: 100%;
  margin-top: 4px;
}

.score-team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.score-badge {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: white;
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.score-team.is-winner .score-badge {
  border-color: var(--color-success);
  box-shadow: 0 0 10px rgba(34, 197, 94, 0.2);
}

.score-name {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.score-display {
  display: flex;
  align-items: center;
  gap: 6px;
}

.score-value {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2.25rem;
  color: var(--color-text-secondary);
  line-height: 1;
}

.score-value.leading {
  color: var(--color-text-primary);
}

.score-dash {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.75rem;
  color: var(--color-text-tertiary);
  line-height: 1;
}

/* Series MVP */
.series-mvp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 20px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  width: 100%;
}

.mvp-label {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-tertiary);
}

.mvp-name {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.mvp-stats {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

.result-message {
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
  margin: 4px 0 0;
  line-height: 1.5;
}

/* Footer */
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

/* Modal Transition */
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
  animation: scaleIn 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active .modal-container {
  animation: scaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes scaleOut {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.95); }
}
</style>
