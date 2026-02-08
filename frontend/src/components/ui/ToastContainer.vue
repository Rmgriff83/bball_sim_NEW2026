<script setup>
import { useToastStore } from '@/stores/toast'
import { useRouter } from 'vue-router'
import { X, ExternalLink, Trophy, XCircle } from 'lucide-vue-next'

const toastStore = useToastStore()
const router = useRouter()

function goToBoxScore(toast) {
  router.push(`/campaign/${toast.campaignId}/game/${toast.gameId}`)
  toastStore.removeToast(toast.id)
}

function isWin(toast) {
  // Check if user team won based on which side they're on
  if (toast.isUserHome === true) {
    return toast.homeScore > toast.awayScore
  } else if (toast.isUserHome === false) {
    return toast.awayScore > toast.homeScore
  }
  // Fallback: assume home team perspective
  return toast.homeScore > toast.awayScore
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toastStore.toasts"
          :key="toast.id"
          class="toast"
          :class="[`toast-${toast.type}`, { 'toast-win': isWin(toast), 'toast-loss': !isWin(toast) }]"
        >
          <!-- Game Result Toast -->
          <template v-if="toast.type === 'game-result'">
            <div class="toast-content">
              <div class="game-result-header">FINAL SCORE</div>
              <div class="game-result-score">
                <div class="team-score">
                  <span class="team-name">{{ toast.homeTeam }}</span>
                  <span class="score" :class="{ winner: toast.homeScore > toast.awayScore }">
                    {{ toast.homeScore }}
                  </span>
                </div>
                <span class="score-divider">-</span>
                <div class="team-score">
                  <span class="score" :class="{ winner: toast.awayScore > toast.homeScore }">
                    {{ toast.awayScore }}
                  </span>
                  <span class="team-name">{{ toast.awayTeam }}</span>
                </div>
              </div>
              <div class="toast-footer">
                <button class="box-score-link" @click="goToBoxScore(toast)">
                  <span>View Box Score</span>
                  <ExternalLink :size="14" />
                </button>
                <!-- W/L Indicator -->
                <div class="result-indicator" :class="isWin(toast) ? 'win' : 'loss'">
                  <Trophy v-if="isWin(toast)" :size="14" class="result-icon" />
                  <XCircle v-else :size="14" class="result-icon" />
                  <span class="result-letter">{{ isWin(toast) ? 'W' : 'L' }}</span>
                </div>
              </div>
            </div>
            <button class="toast-close" @click="toastStore.removeToast(toast.id)">
              <X :size="16" />
            </button>
          </template>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 90px;
  left: 16px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 360px;
}

@media (min-width: 1024px) {
  .toast-container {
    bottom: 24px;
  }
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
}

.toast-win {
  border-left: 3px solid var(--color-success);
}

.toast-loss {
  border-left: 3px solid var(--color-error);
}

.result-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.result-indicator.win {
  background: rgba(34, 197, 94, 0.15);
  color: var(--color-success);
}

.result-indicator.loss {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-error);
}

.result-icon {
  stroke-width: 2.5;
}

.result-letter {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
}

.toast-content {
  flex: 1;
  min-width: 0;
}

.game-result-header {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}

.game-result-score {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.toast-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.team-score {
  display: flex;
  align-items: center;
  gap: 8px;
}

.team-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.score {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-secondary);
}

.score.winner {
  color: var(--color-text-primary);
}

.score-divider {
  font-size: 1rem;
  color: var(--color-text-tertiary);
}

.box-score-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.box-score-link:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

.toast-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.toast-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

/* Animations */
.toast-enter-active {
  animation: slideIn 0.3s ease-out;
}

.toast-leave-active {
  animation: slideOut 0.3s ease-in;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(-100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideOut {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(-100%);
  }
}
</style>
