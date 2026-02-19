<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { X, ChevronDown, ChevronUp, Play, FastForward, Calendar } from 'lucide-vue-next'
import { LoadingSpinner } from '@/components/ui'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  preview: {
    type: Object,
    default: null
  },
  loading: {
    type: Boolean,
    default: false
  },
  simulating: {
    type: Boolean,
    default: false
  },
  userTeam: {
    type: Object,
    default: null
  },
  backgroundProgress: {
    type: Object,
    default: null
  },
  gameInProgress: {
    type: Boolean,
    default: false
  },
  simSeasonMode: {
    type: Boolean,
    default: false
  },
  remainingSeasonGames: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'confirm', 'simToEnd', 'simSeason'])

// Track which date sections are expanded
const expandedDates = ref({})

// Parse a YYYY-MM-DD string as local date (avoids UTC shift)
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('T')[0].split(' ')[0].split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Format date for display
function formatDate(dateStr) {
  if (!dateStr) return ''
  const date = parseLocalDate(dateStr)
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// Short format for date headers in game list
function formatShortDate(dateStr) {
  if (!dateStr) return ''
  const date = parseLocalDate(dateStr)
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function toggleDateSection(date) {
  expandedDates.value[date] = !expandedDates.value[date]
}

function close() {
  if (!props.simulating) {
    emit('close')
  }
}

function confirm() {
  emit('confirm')
}

function simToEnd() {
  emit('simToEnd')
}

function simSeason() {
  emit('simSeason')
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
    // Reset expanded states
    expandedDates.value = {}
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeydown)
})

// Computed values from preview data
const nextGame = computed(() => props.preview?.nextUserGame)
const hasNextGame = computed(() => !!props.preview?.nextUserGame)
const isGameToday = computed(() => props.preview?.isGameToday)
const daysToSimulate = computed(() => props.preview?.daysToSimulate || 0)
const totalGames = computed(() => props.preview?.totalGamesToSimulate || 0)
const gamesByDate = computed(() => props.preview?.gamesByDate || {})

// Determine user team and opponent
const userTeamData = computed(() => {
  if (!nextGame.value || !props.userTeam) return null
  return nextGame.value.isHome ? nextGame.value.homeTeam : nextGame.value.awayTeam
})

const opponentTeamData = computed(() => {
  if (!nextGame.value || !props.userTeam) return null
  return nextGame.value.isHome ? nextGame.value.awayTeam : nextGame.value.homeTeam
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
            <h2 class="modal-title">{{ simSeasonMode ? 'Sim Season' : 'Simulate' }}</h2>
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
            <!-- Simulating Overlay -->
            <div v-if="simulating" class="simulating-overlay">
              <LoadingSpinner size="lg" />
              <p class="simulating-text">
                {{ simSeasonMode ? 'Simulating remaining season...' : (backgroundProgress ? 'Simulating league games...' : 'Simulating your game...') }}
              </p>
              <span v-if="!backgroundProgress" class="simulating-sub">AI games will process in the background</span>
              <template v-if="backgroundProgress">
                <span class="simulating-sub">
                  {{ backgroundProgress.completed }}/{{ backgroundProgress.total }} games complete
                </span>
                <div class="simulating-progress-bar">
                  <div
                    class="simulating-progress-fill"
                    :style="{
                      width: backgroundProgress.total > 0
                        ? `${(backgroundProgress.completed / backgroundProgress.total) * 100}%`
                        : '0%'
                    }"
                  ></div>
                </div>
              </template>
            </div>

            <!-- Sim Season Mode -->
            <div v-else-if="simSeasonMode" class="sim-season-content">
              <div class="sim-season-icon-wrap">
                <FastForward :size="40" class="sim-season-icon" />
              </div>
              <h3 class="sim-season-title">Sim Rest of Season</h3>
              <div class="summary-stats">
                <div class="stat-item">
                  <span class="stat-value">{{ remainingSeasonGames?.totalGames || 0 }}</span>
                  <span class="stat-label">Total Games</span>
                </div>
                <div class="stat-divider"></div>
                <div class="stat-item">
                  <span class="stat-value">{{ remainingSeasonGames?.userGames || 0 }}</span>
                  <span class="stat-label">Your Games</span>
                </div>
                <div class="stat-divider"></div>
                <div class="stat-item">
                  <span class="stat-value">{{ remainingSeasonGames?.aiGames || 0 }}</span>
                  <span class="stat-label">AI Games</span>
                </div>
              </div>
              <p class="sim-season-warning">
                This will simulate all remaining regular season games including yours. This cannot be undone.
              </p>
            </div>

            <!-- Loading State -->
            <div v-else-if="loading" class="loading-state">
              <LoadingSpinner size="md" />
              <p>Loading preview...</p>
            </div>

            <!-- No Games State -->
            <div v-else-if="!hasNextGame" class="no-games-state">
              <Calendar :size="48" class="no-games-icon" />
              <p>No upcoming games found</p>
              <span class="no-games-sub">The season may be complete.</span>
            </div>

            <!-- Preview Content -->
            <template v-else>
              <!-- Next Game Matchup - Cosmic Card -->
              <div class="matchup-card card-cosmic">
                <span class="game-date">{{ formatDate(nextGame.gameDate) }}</span>
                <div class="matchup">
                  <!-- User Team -->
                  <div class="matchup-team">
                    <div
                      class="team-badge"
                      :style="{ backgroundColor: userTeamData?.color || '#E85A4F' }"
                    >
                      {{ userTeamData?.abbreviation }}
                    </div>
                    <span class="team-name">{{ userTeamData?.name }}</span>
                    <span class="team-label your-team">YOUR TEAM</span>
                  </div>

                  <div class="vs-divider">
                    <span>VS</span>
                  </div>

                  <!-- Opponent Team -->
                  <div class="matchup-team">
                    <div
                      class="team-badge"
                      :style="{ backgroundColor: opponentTeamData?.color || '#666' }"
                    >
                      {{ opponentTeamData?.abbreviation }}
                    </div>
                    <span class="team-name">{{ opponentTeamData?.name }}</span>
                    <span class="team-label">{{ nextGame.isHome ? 'AWAY' : 'HOME' }}</span>
                  </div>
                </div>
              </div>

              <!-- Summary Stats -->
              <div class="summary-stats">
                <div class="stat-item">
                  <span class="stat-value">{{ daysToSimulate }}</span>
                  <span class="stat-label">{{ daysToSimulate === 1 ? 'Day' : 'Days' }}</span>
                </div>
                <div class="stat-divider"></div>
                <div class="stat-item">
                  <span class="stat-value">{{ totalGames }}</span>
                  <span class="stat-label">AI {{ totalGames === 1 ? 'Game' : 'Games' }}</span>
                </div>
              </div>

              <p v-if="isGameToday" class="summary-text today-text">
                Your next game is today! No other games need to be simulated.
              </p>
              <p v-else-if="totalGames > 0" class="summary-text">
                will be simulated before your game
              </p>
              <p v-else class="summary-text">
                No games to simulate - your next game is ready!
              </p>

              <!-- Games by Date List -->
              <div v-if="totalGames > 0" class="games-list-section">
                <h4 class="games-list-header">GAMES TO SIMULATE</h4>
                <div class="games-by-date">
                  <div
                    v-for="(games, date) in gamesByDate"
                    :key="date"
                    class="date-group"
                  >
                    <button
                      class="date-header"
                      @click="toggleDateSection(date)"
                    >
                      <span class="date-text">{{ formatShortDate(date) }}</span>
                      <span class="games-count">{{ games.length }} {{ games.length === 1 ? 'game' : 'games' }}</span>
                      <ChevronDown v-if="!expandedDates[date]" :size="18" class="chevron-icon" />
                      <ChevronUp v-else :size="18" class="chevron-icon" />
                    </button>
                    <Transition name="expand">
                      <div v-if="expandedDates[date]" class="date-games">
                        <div
                          v-for="game in games"
                          :key="game.id"
                          class="game-row"
                        >
                          <span
                            class="game-team away"
                            :style="{ '--team-color': game.awayTeam.color }"
                          >
                            {{ game.awayTeam.abbreviation }}
                          </span>
                          <span class="at-symbol">@</span>
                          <span
                            class="game-team home"
                            :style="{ '--team-color': game.homeTeam.color }"
                          >
                            {{ game.homeTeam.abbreviation }}
                          </span>
                        </div>
                      </div>
                    </Transition>
                  </div>
                </div>
              </div>
            </template>
          </main>

          <!-- Footer -->
          <footer v-if="hasNextGame || simSeasonMode || !loading" class="modal-footer">
            <template v-if="simSeasonMode">
              <button
                class="btn-cancel"
                :disabled="simulating"
                @click="close"
              >
                Cancel
              </button>
              <button
                class="btn-confirm"
                :disabled="simulating"
                @click="simSeason"
              >
                <span v-if="simulating" class="btn-loading"></span>
                <FastForward v-else :size="16" class="btn-icon" />
                {{ simulating ? 'Simulating...' : 'Sim Season' }}
              </button>
            </template>
            <template v-else-if="!hasNextGame">
              <button
                class="btn-cancel"
                @click="close"
              >
                Close
              </button>
            </template>
            <template v-else>
              <button
                class="btn-cancel"
                :disabled="simulating"
                @click="close"
              >
                Cancel
              </button>
              <button
                v-if="gameInProgress"
                class="btn-sim-to-end"
                :disabled="simulating"
                @click="simToEnd"
              >
                <span v-if="simulating" class="btn-loading"></span>
                <FastForward v-else :size="16" class="btn-icon" />
                {{ simulating ? 'Simulating...' : 'Sim to End' }}
              </button>
              <button
                class="btn-confirm"
                :disabled="simulating"
                @click="confirm"
              >
                <span v-if="simulating" class="btn-loading"></span>
                <Play v-else :size="16" class="btn-icon" />
                {{ simulating ? 'Simulating...' : 'Simulate & Play' }}
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
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
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

/* Simulating Overlay */
.simulating-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 60px 20px;
  text-align: center;
}

.simulating-text {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.simulating-sub {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.simulating-progress-bar {
  width: 80%;
  max-width: 280px;
  height: 6px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-full);
  overflow: hidden;
  margin-top: 4px;
}

.simulating-progress-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: var(--radius-full);
  transition: width 0.5s ease;
  min-width: 2%;
}

/* Sim Season Mode */
.sim-season-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  text-align: center;
}

.sim-season-icon-wrap {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.sim-season-icon {
  color: var(--color-primary);
}

.sim-season-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.sim-season-warning {
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
  margin: 4px 0 0;
  padding: 0 8px;
  line-height: 1.5;
}

/* Loading & Empty States */
.loading-state,
.no-games-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  text-align: center;
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.no-games-icon {
  color: var(--color-text-tertiary);
  margin-bottom: 16px;
}

.no-games-state p {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px 0;
}

.no-games-sub {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
}

/* Matchup Card - Cosmic Theme */
.matchup-card {
  padding: 20px;
  margin-bottom: 20px;
}

.card-cosmic {
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-xl);
  position: relative;
  overflow: hidden;
}

.card-cosmic::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 10% 20%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 30% 60%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 50% 10%, rgba(255,255,255,0.4), transparent),
    radial-gradient(1px 1px at 70% 40%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 90% 70%, rgba(255,255,255,0.4), transparent);
  pointer-events: none;
}

.game-date {
  display: block;
  text-align: center;
  font-size: 0.9rem;
  font-weight: 600;
  color: rgba(26, 21, 32, 0.8);
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}

.matchup {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  position: relative;
  z-index: 1;
}

.matchup-team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.team-badge {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 700;
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  border: 3px solid rgba(255, 255, 255, 0.3);
}

.team-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: #1a1520;
  text-align: center;
}

.team-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(26, 21, 32, 0.5);
}

.team-label.your-team {
  color: rgba(26, 21, 32, 0.8);
  background: rgba(26, 21, 32, 0.1);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.vs-divider {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 4px;
}

.vs-divider span {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.25rem;
  color: rgba(26, 21, 32, 0.4);
}

/* Summary Stats */
.summary-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  margin-bottom: 8px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-value {
  font-size: 1.75rem;
  font-weight: 700;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--color-text-primary);
}

.stat-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.stat-divider {
  width: 1px;
  height: 40px;
  background: var(--glass-border);
}

.summary-text {
  text-align: center;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin: 0 0 20px 0;
}

.today-text {
  color: var(--color-primary);
  font-weight: 500;
}

/* Games List Section */
.games-list-section {
  margin-top: 16px;
}

.games-list-header {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin: 0 0 12px 0;
}

.games-by-date {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.date-group {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.date-header {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 12px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.2s ease;
}

.date-header:hover {
  background: var(--color-bg-elevated);
}

.date-text {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.games-count {
  margin-left: auto;
  margin-right: 8px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.chevron-icon {
  color: var(--color-text-tertiary);
}

.date-games {
  padding: 0 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.game-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
}

.game-team {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-primary);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--team-color, #666) 15%, transparent);
}

.at-symbol {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
}

/* Expand transition */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 500px;
}

/* Footer */
.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-cancel,
.btn-confirm,
.btn-sim-to-end {
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

.btn-sim-to-end {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
}

.btn-sim-to-end:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.btn-cancel:disabled,
.btn-confirm:disabled,
.btn-sim-to-end:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-icon {
  fill: currentColor;
}

.btn-loading {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Modal transition */
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
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}
</style>
