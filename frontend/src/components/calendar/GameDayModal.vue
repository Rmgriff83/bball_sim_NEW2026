<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { useLeagueStore } from '@/stores/league'
import { useToastStore } from '@/stores/toast'
import { LoadingSpinner } from '@/components/ui'
import BoxScore from '@/components/game/BoxScore.vue'
import { X, Play, FastForward, Eye, Lock } from 'lucide-vue-next'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  game: {
    type: Object,
    default: null
  },
  userTeam: {
    type: Object,
    default: null
  },
  isNextGame: {
    type: Boolean,
    default: false
  },
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const emit = defineEmits(['close', 'simulated'])
const router = useRouter()
const gameStore = useGameStore()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()
const leagueStore = useLeagueStore()
const toastStore = useToastStore()

const loadingBoxScore = ref(false)
const fullGameData = ref(null)
const activeBoxScoreTab = ref('home')
const simulating = ref(false)

// Determine if user is home or away
const isUserHome = computed(() => {
  if (!props.game || !props.userTeam) return true
  return props.game.home_team?.id === props.userTeam.id
})

// Get teams
const homeTeam = computed(() => props.game?.home_team)
const awayTeam = computed(() => props.game?.away_team)

// Get team records from standings (match by abbreviation)
const homeTeamRecord = computed(() => {
  if (!homeTeam.value?.abbreviation) return null
  const allStandings = [
    ...(leagueStore.standings?.east || []),
    ...(leagueStore.standings?.west || [])
  ]
  const standing = allStandings.find(s => s.team?.abbreviation === homeTeam.value.abbreviation)
  if (standing) {
    return `${standing.wins}-${standing.losses}`
  }
  return null
})

const awayTeamRecord = computed(() => {
  if (!awayTeam.value?.abbreviation) return null
  const allStandings = [
    ...(leagueStore.standings?.east || []),
    ...(leagueStore.standings?.west || [])
  ]
  const standing = allStandings.find(s => s.team?.abbreviation === awayTeam.value.abbreviation)
  if (standing) {
    return `${standing.wins}-${standing.losses}`
  }
  return null
})

// Check if game is in progress
const isGameInProgress = computed(() => {
  return props.game?.is_in_progress || false
})

// Get current scores for in-progress game
const inProgressScores = computed(() => {
  if (!isGameInProgress.value || !props.game) return null
  return {
    homeScore: props.game.home_score ?? 0,
    awayScore: props.game.away_score ?? 0,
    quarter: props.game.current_quarter ?? gameStore.currentSimQuarter ?? 1
  }
})

// Get game result for user
const userResult = computed(() => {
  if (!props.game?.is_complete || !props.userTeam) return null
  const isHome = props.game.home_team?.id === props.userTeam.id
  const userScore = isHome ? props.game.home_score : props.game.away_score
  const oppScore = isHome ? props.game.away_score : props.game.home_score
  return {
    won: userScore > oppScore,
    userScore,
    oppScore
  }
})

// Format game date
const formattedDate = computed(() => {
  if (!props.game?.game_date) return ''
  const date = new Date(props.game.game_date + 'T12:00:00') // Add time to avoid timezone issues
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
})

// Game status text and class
const gameStatus = computed(() => {
  if (props.game?.is_complete) {
    return { text: 'Final', class: 'complete' }
  }
  if (isGameInProgress.value) {
    return { text: 'In Progress', class: 'live' }
  }
  if (props.isNextGame) {
    return { text: 'Next Game', class: 'next' }
  }
  return { text: 'Upcoming', class: 'upcoming' }
})

// Fetch full game data for box score
async function loadBoxScore() {
  if (!props.game?.is_complete || !props.game?.id) return

  loadingBoxScore.value = true
  try {
    const gameData = await gameStore.fetchGame(props.campaignId, props.game.id)
    fullGameData.value = gameData
    // Set active tab to user's team
    activeBoxScoreTab.value = isUserHome.value ? 'home' : 'away'
  } catch (err) {
    console.error('Failed to load box score:', err)
  } finally {
    loadingBoxScore.value = false
  }
}

// Navigation actions
function playGame() {
  if (!props.isNextGame && !isGameInProgress.value) return
  router.push(`/campaign/${props.campaignId}/game/${props.game.id}`)
  close()
}

function viewFullGame() {
  if (!props.game?.id) return
  router.push(`/campaign/${props.campaignId}/game/${props.game.id}`)
  close()
}

// Simulate through this game
async function simulateToGame() {
  if (!props.isNextGame || simulating.value) return

  simulating.value = true
  const loadingToastId = toastStore.showLoading('Simulating games...')

  try {
    const response = await gameStore.simulateToNextGame(props.campaignId)

    // Remove loading toast
    toastStore.removeMinimalToast(loadingToastId)

    // Show toast for user's game result
    if (response.userGameResult) {
      toastStore.showGameResult({
        homeTeam: response.userGameResult.home_team?.abbreviation || response.userGameResult.home_team?.name || 'HOME',
        awayTeam: response.userGameResult.away_team?.abbreviation || response.userGameResult.away_team?.name || 'AWAY',
        homeScore: response.userGameResult.home_score,
        awayScore: response.userGameResult.away_score,
        gameId: response.userGameResult.game_id,
        campaignId: props.campaignId,
        isUserHome: response.userGameResult.is_user_home
      })
    }

    // Refresh data
    await Promise.all([
      campaignStore.fetchCampaign(props.campaignId),
      teamStore.fetchTeam(props.campaignId, { force: true }),
      leagueStore.fetchStandings(props.campaignId, { force: true }),
      gameStore.fetchGames(props.campaignId, { force: true })
    ])

    // Emit event so parent can update
    emit('simulated')

    // Close modal
    close()
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Simulation failed. Please try again.')
    console.error('Failed to simulate:', err)
  } finally {
    simulating.value = false
  }
}

async function simToEndOfGame() {
  if (simulating.value) return

  simulating.value = true
  const loadingToastId = toastStore.showLoading('Simming to end...')

  try {
    const response = await gameStore.simToEnd(props.campaignId, props.game.id)

    toastStore.removeMinimalToast(loadingToastId)

    if (response.result) {
      toastStore.showGameResult({
        homeTeam: props.game.home_team?.abbreviation || props.game.home_team?.name || 'HOME',
        awayTeam: props.game.away_team?.abbreviation || props.game.away_team?.name || 'AWAY',
        homeScore: response.result.home_score,
        awayScore: response.result.away_score,
        gameId: props.game.id,
        campaignId: props.campaignId,
        isUserHome: props.game.is_user_home
      })
    }

    await Promise.all([
      campaignStore.fetchCampaign(props.campaignId),
      teamStore.fetchTeam(props.campaignId, { force: true }),
      leagueStore.fetchStandings(props.campaignId, { force: true }),
      gameStore.fetchGames(props.campaignId, { force: true })
    ])

    emit('simulated')
    close()
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Sim to end failed. Please try again.')
    console.error('Failed to sim to end:', err)
  } finally {
    simulating.value = false
  }
}

function close() {
  emit('close')
}

// Handle escape key
function handleKeydown(e) {
  if (e.key === 'Escape') {
    close()
  }
}

// Watch for show changes to load data and manage listeners
watch(() => props.show, async (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)

    // Load standings if not available (for team records)
    if (!leagueStore.standings?.length) {
      leagueStore.fetchStandings(props.campaignId)
    }

    // Load box score if completed game
    if (props.game?.is_complete) {
      loadBoxScore()
    } else {
      fullGameData.value = null
    }
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', handleKeydown)
    fullGameData.value = null
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
        v-if="show && game"
        class="modal-overlay"
        @click.self="close"
      >
        <div class="modal-container">
          <!-- Header -->
          <header class="modal-header">
            <div class="header-content">
              <span class="game-date">{{ formattedDate }}</span>
              <span class="game-status" :class="gameStatus.class">
                {{ gameStatus.text }}
              </span>
              <span v-if="isGameInProgress && inProgressScores" class="live-quarter">
                Q{{ inProgressScores.quarter }}
              </span>
            </div>
            <button class="close-btn" @click="close">
              <X :size="20" />
            </button>
          </header>

          <!-- Matchup Card -->
          <div class="matchup-card card-cosmic" :class="{ 'in-progress': isGameInProgress }">
            <div class="matchup-content">
              <!-- Away Team -->
              <div class="team-side away">
                <div
                  class="team-badge"
                  :style="{ backgroundColor: awayTeam?.primary_color || '#3B82F6' }"
                >
                  {{ awayTeam?.abbreviation || 'AWY' }}
                </div>
                <span class="team-name">{{ awayTeam?.city || 'Away' }}</span>
                <span class="team-nickname">{{ awayTeam?.name || 'Team' }}</span>
                <span v-if="awayTeamRecord" class="team-record">{{ awayTeamRecord }}</span>
                <span v-if="game.is_complete || isGameInProgress" class="team-score">
                  {{ game.away_score ?? 0 }}
                </span>
              </div>

              <!-- VS / Score -->
              <div class="matchup-center">
                <template v-if="game.is_complete">
                  <span
                    class="result-badge"
                    :class="{ won: userResult?.won, lost: !userResult?.won }"
                  >
                    {{ userResult?.won ? 'WIN' : 'LOSS' }}
                  </span>
                </template>
                <template v-else-if="isGameInProgress">
                  <span class="vs-text live">LIVE</span>
                </template>
                <template v-else>
                  <span class="vs-text">VS</span>
                </template>
              </div>

              <!-- Home Team -->
              <div class="team-side home">
                <div
                  class="team-badge"
                  :style="{ backgroundColor: homeTeam?.primary_color || '#EF4444' }"
                >
                  {{ homeTeam?.abbreviation || 'HME' }}
                </div>
                <span class="team-name">{{ homeTeam?.city || 'Home' }}</span>
                <span class="team-nickname">{{ homeTeam?.name || 'Team' }}</span>
                <span v-if="homeTeamRecord" class="team-record">{{ homeTeamRecord }}</span>
                <span v-if="game.is_complete || isGameInProgress" class="team-score">
                  {{ game.home_score ?? 0 }}
                </span>
              </div>
            </div>
          </div>

          <!-- Box Score (Completed Games) -->
          <div v-if="game.is_complete" class="box-score-section">
            <div v-if="loadingBoxScore" class="loading-box-score">
              <LoadingSpinner size="md" />
              <span>Loading stats...</span>
            </div>
            <template v-else-if="fullGameData?.box_score">
              <BoxScore
                :box-score="fullGameData.box_score"
                :home-team="homeTeam"
                :away-team="awayTeam"
                :active-tab="activeBoxScoreTab"
                @update:active-tab="activeBoxScoreTab = $event"
              />
            </template>
          </div>

          <!-- Upcoming Game Info -->
          <div v-else-if="!isGameInProgress" class="upcoming-section">
            <p v-if="!isNextGame" class="order-notice">
              <Lock :size="16" />
              Games must be played in order. This is not your next scheduled game.
            </p>
          </div>

          <!-- Actions -->
          <footer class="modal-footer">
            <template v-if="game.is_complete">
              <button class="btn btn-primary" @click="viewFullGame">
                <Eye :size="18" />
                View Full Game
              </button>
            </template>
            <template v-else-if="isGameInProgress">
              <button class="btn btn-primary btn-continue" @click="playGame">
                <Play :size="18" />
                Continue Game
              </button>
              <button class="btn btn-secondary" @click="simToEndOfGame" :disabled="simulating">
                <LoadingSpinner v-if="simulating" size="sm" />
                <FastForward v-else :size="18" />
                {{ simulating ? 'Simming...' : 'Sim to End' }}
              </button>
            </template>
            <template v-else>
              <button
                class="btn btn-primary"
                :disabled="!isNextGame"
                :title="!isNextGame ? 'You must play games in order' : 'Play this game'"
                @click="playGame"
              >
                <Play :size="18" />
                Play Game
              </button>
              <button
                class="btn btn-secondary"
                :disabled="!isNextGame || simulating"
                :title="!isNextGame ? 'You must play games in order' : 'Simulate this game'"
                @click="simulateToGame"
              >
                <LoadingSpinner v-if="simulating" size="sm" />
                <FastForward v-else :size="18" />
                {{ simulating ? 'Simulating...' : 'Simulate Game' }}
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
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(8px);
}

.modal-container {
  width: 100%;
  max-width: 700px;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  animation: scaleIn 0.2s ease-out;
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
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

.header-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.game-date {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.game-status {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 8px;
  border-radius: var(--radius-md);
}

.game-status.complete {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-secondary);
}

.game-status.next {
  background: rgba(34, 197, 94, 0.15);
  color: var(--color-success);
  border: 1px solid var(--color-success);
}

.game-status.upcoming {
  background: var(--color-bg-tertiary);
  color: var(--color-text-tertiary);
}

.game-status.live {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.4);
  animation: pulse-live 2s ease-in-out infinite;
}

@keyframes pulse-live {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.live-quarter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(34, 197, 94, 0.4);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 700;
  color: #22c55e;
  letter-spacing: 0.05em;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: transparent;
  border: none;
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

/* Matchup Card */
.matchup-card {
  margin: 20px;
  padding: 24px;
}

.matchup-card.in-progress {
  border: 2px solid rgba(34, 197, 94, 0.4);
  box-shadow: 0 0 20px rgba(34, 197, 94, 0.15);
}

.matchup-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  position: relative;
  z-index: 1;
}

.team-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.team-badge {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 700;
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.team-name {
  font-size: 0.7rem;
  color: rgba(0, 0, 0, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.team-nickname {
  font-size: 1rem;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.9);
}

.team-record {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.5);
}

.team-score {
  font-family: var(--font-display);
  font-size: 2.5rem;
  color: rgba(0, 0, 0, 0.9);
  line-height: 1;
  margin-top: 4px;
}

.matchup-center {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
}

.vs-text {
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.5);
  text-transform: uppercase;
}

.vs-text.live {
  color: #22c55e;
  font-weight: 700;
  animation: pulse-live 2s ease-in-out infinite;
}

.result-badge {
  font-size: 0.875rem;
  font-weight: 400;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.result-badge.won {
  background: var(--color-success);
  color: white;
}

.result-badge.lost {
  background: var(--color-error);
  color: white;
}

/* Box Score Section */
.box-score-section {
  padding: 0 20px 20px;
}

.loading-box-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

/* Upcoming Section */
.upcoming-section {
  padding: 0 20px 20px;
}

.order-notice {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--radius-lg);
  color: var(--color-warning);
  font-size: 0.875rem;
  margin: 0;
}

/* Footer */
.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.modal-footer .btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
  border: none;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-dark);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary.btn-continue {
  background: #22c55e;
  animation: pulse-continue 2s ease-in-out infinite;
}

.btn-primary.btn-continue:hover {
  background: #16a34a;
}

@keyframes pulse-continue {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
}

.btn-secondary {
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  border: 1px solid var(--glass-border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

/* Mobile adjustments */
@media (max-width: 480px) {
  .modal-container {
    max-height: 95vh;
  }

  .matchup-card {
    margin: 12px;
    padding: 16px;
  }

  .team-badge {
    width: 48px;
    height: 48px;
    font-size: 0.75rem;
  }

  .team-score {
    font-size: 2rem;
  }

  .team-nickname {
    font-size: 0.875rem;
  }

  .modal-footer {
    flex-direction: column;
  }

  .modal-footer .btn {
    width: 100%;
  }
}
</style>
