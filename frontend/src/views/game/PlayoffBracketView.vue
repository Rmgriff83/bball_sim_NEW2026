<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayoffStore } from '@/stores/playoff'
import { useGameStore } from '@/stores/game'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { useLeagueStore } from '@/stores/league'
import { useToastStore } from '@/stores/toast'
import { useBreakingNewsStore } from '@/stores/breakingNews'
import { BreakingNewsService } from '@/engine/season/BreakingNewsService'
import { LoadingSpinner } from '@/components/ui'
import PlayoffBracket from '@/components/playoffs/PlayoffBracket.vue'
import GameDayModal from '@/components/calendar/GameDayModal.vue'
import SeriesResultModal from '@/components/playoffs/SeriesResultModal.vue'
import { Trophy, X, Play, FastForward, AlertTriangle } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const playoffStore = usePlayoffStore()
const gameStore = useGameStore()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()
const leagueStore = useLeagueStore()
const toastStore = useToastStore()
const breakingNewsStore = useBreakingNewsStore()

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const team = computed(() => campaign.value?.team)

const loading = ref(false)

// Series detail modal state
const selectedSeries = ref(null)
const showSeriesDetail = ref(false)

// Game day modal state
const selectedGame = ref(null)
const showGameModal = ref(false)

// Series modal state
const simulating = ref(false)
const showWarning = ref(false)
const warningMessage = ref('')
const warningHint = ref('')

// Check if user's next game is in the selected series
const nextGameInSeries = computed(() => {
  if (!selectedSeries.value?.games?.length) return null
  const nextGame = gameStore.nextUserGame
  if (!nextGame) return null
  return selectedSeries.value.games.includes(nextGame.id) ? nextGame : null
})

// Is the next game in this series in progress?
const isGameInProgress = computed(() => {
  return nextGameInSeries.value?.is_in_progress || false
})

// Is this a user series?
const isUserSeries = computed(() => {
  if (!selectedSeries.value || !team.value) return false
  return selectedSeries.value.team1?.teamId == team.value.id ||
         selectedSeries.value.team2?.teamId == team.value.id
})

// Validate roster before game actions
function validateRoster() {
  const starters = teamStore.starterPlayers || []
  const injuredStarters = starters.filter(p => p && (p.is_injured || p.isInjured))
  if (injuredStarters.length > 0) {
    const names = injuredStarters.map(p => p.name || `${p.first_name} ${p.last_name}`).join(', ')
    warningMessage.value = `You have injured ${injuredStarters.length === 1 ? 'starter' : 'starters'}: ${names}`
    warningHint.value = 'Go to the Team tab to adjust your lineup before playing.'
    showWarning.value = true
    return false
  }
  const totalMins = teamStore.totalTargetMinutes
  if (totalMins !== 200) {
    warningMessage.value = `Your rotation minutes total ${totalMins} — they must equal exactly 200.`
    warningHint.value = 'Go to the Team tab to adjust your player minutes.'
    showWarning.value = true
    return false
  }
  return true
}

function goToTeamTab() {
  showWarning.value = false
  router.push(`/campaign/${campaignId.value}/team?tab=team`)
  closeSeriesDetail()
}

// Parse date string to local Date
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('T')[0].split(' ')[0].split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Map series game IDs to full game objects from the game store
// Map series game IDs to full game objects, excluding cancelled games
const seriesGames = computed(() => {
  if (!selectedSeries.value?.games?.length) return []
  const gameIds = selectedSeries.value.games
  return gameIds
    .map(id => gameStore.games.find(g => g.id === id))
    .filter(g => g && !g.is_cancelled)
})

// Round label for series detail header
const roundLabel = computed(() => {
  if (!selectedSeries.value) return ''
  switch (selectedSeries.value.round) {
    case 1: return 'First Round'
    case 2: return 'Semifinals'
    case 3: return 'Conference Finals'
    case 4: return 'NBA Finals'
    default: return `Round ${selectedSeries.value.round}`
  }
})

// Format a game date for display
function formatGameDate(dateStr) {
  if (!dateStr) return ''
  const date = parseLocalDate(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Get game status display
function getGameStatus(game) {
  if (!game) return { label: '—', type: 'tbd' }
  if (game.is_complete) {
    const score = `${game.home_score}-${game.away_score}`
    if (game.is_user_game && team.value) {
      const isHome = game.home_team?.id === team.value.id
      const userScore = isHome ? game.home_score : game.away_score
      const oppScore = isHome ? game.away_score : game.home_score
      const result = userScore > oppScore ? 'W' : 'L'
      return { label: `${result}  ${score}`, type: 'complete', result }
    }
    return { label: score, type: 'complete' }
  }
  if (game.is_in_progress) {
    return { label: 'LIVE', type: 'live' }
  }
  // Check if this is the next game to play
  const nextGame = gameStore.nextUserGame
  if (nextGame && nextGame.id === game.id) {
    return { label: 'NEXT', type: 'next' }
  }
  return { label: '—', type: 'upcoming' }
}

// Check if a game row involves the user's team
function isUserGame(game) {
  return game?.is_user_game || false
}

// Check if user lost a completed game
function didUserLose(game) {
  if (!game?.is_complete || !game?.is_user_game || !team.value) return false
  const isHome = game.home_team?.id === team.value.id
  const userScore = isHome ? game.home_score : game.away_score
  const oppScore = isHome ? game.away_score : game.home_score
  return userScore < oppScore
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([
      playoffStore.fetchBracket(campaignId.value),
      gameStore.fetchGames(campaignId.value),
      teamStore.fetchTeam(campaignId.value),
    ])
  } catch (err) {
    console.error('Failed to load playoff data:', err)
  } finally {
    loading.value = false
  }
})

function handleSelectSeries(series) {
  if (!series || series.status === 'pending') return
  selectedSeries.value = series
  showSeriesDetail.value = true
}

function closeSeriesDetail() {
  if (simulating.value) return
  showSeriesDetail.value = false
  selectedSeries.value = null
  showWarning.value = false
}

// Play the next game in this series
function playGame() {
  if (!nextGameInSeries.value) return
  if (!isGameInProgress.value && !validateRoster()) return
  router.push(`/campaign/${campaignId.value}/game/${nextGameInSeries.value.id}`)
  closeSeriesDetail()
}

// Simulate the next game in this series
async function simulateGame() {
  if (!nextGameInSeries.value || simulating.value) return
  if (!validateRoster()) return

  simulating.value = true
  showSeriesDetail.value = false
  selectedSeries.value = null
  const loadingToastId = toastStore.showLoading('Simulating games...')

  try {
    const response = await gameStore.simulateToNextGame(campaignId.value)

    toastStore.removeMinimalToast(loadingToastId)

    if (response.userGameResult) {
      toastStore.showGameResult({
        homeTeam: response.userGameResult.home_team?.abbreviation || 'HOME',
        awayTeam: response.userGameResult.away_team?.abbreviation || 'AWAY',
        homeScore: response.userGameResult.home_score,
        awayScore: response.userGameResult.away_score,
        gameId: response.userGameResult.game_id,
        campaignId: campaignId.value,
        isUserHome: response.userGameResult.is_user_home
      })
    }

    if (response.upgrade_points_awarded?.length) {
      response.upgrade_points_awarded.forEach((award, i) => {
        setTimeout(() => {
          toastStore.showSuccess(
            `${award.name} earned ${award.points_earned} upgrade point${award.points_earned > 1 ? 's' : ''}! (${award.total_points} total)`,
            5000
          )
        }, i * 600)
      })
    }

    // Show series result modal if series completed
    playoffStore.handlePlayoffUpdate(response.userGameResult?.playoffUpdate)

    // Refresh all data
    await Promise.all([
      playoffStore.fetchBracket(campaignId.value),
      gameStore.fetchGames(campaignId.value, { force: true }),
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
      leagueStore.fetchStandings(campaignId.value, { force: true })
    ])
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Simulation failed. Please try again.')
    console.error('Failed to simulate:', err)
  } finally {
    simulating.value = false
  }
}

// Keyboard handler for series modal
function handleSeriesKeydown(e) {
  if (e.key === 'Escape' && !simulating.value) {
    closeSeriesDetail()
  }
}

// Watch for series modal open/close to manage body overflow
watch(showSeriesDetail, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleSeriesKeydown)
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', handleSeriesKeydown)
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleSeriesKeydown)
})

function handleGameClick(game) {
  if (!game) return
  selectedGame.value = game
  showGameModal.value = true
}

function closeGameModal() {
  showGameModal.value = false
  selectedGame.value = null
}

async function handleSimulated() {
  closeGameModal()
  // Refresh bracket and games after simulation
  await Promise.all([
    playoffStore.fetchBracket(campaignId.value),
    gameStore.fetchGames(campaignId.value, { force: true }),
  ])
  // If series detail is open, refresh it
  if (selectedSeries.value) {
    const updatedSeries = findSeriesById(selectedSeries.value.seriesId)
    if (updatedSeries) {
      selectedSeries.value = updatedSeries
    }
  }
}

// Series Result Modal handlers
const seriesResultSimulating = ref(false)

function closeSeriesResult() {
  playoffStore.closeSeriesResultModal()
}

async function handleSimNextSeries() {
  seriesResultSimulating.value = true
  playoffStore.closeSeriesResultModal()
  const loadingToastId = toastStore.showLoading('Simulating playoff games...')

  try {
    // Sim remaining AI games in the current round
    await gameStore.simulateToNextPlayoffRound(campaignId.value)

    toastStore.removeMinimalToast(loadingToastId)

    // Refresh all data
    await Promise.all([
      playoffStore.fetchBracket(campaignId.value),
      gameStore.fetchGames(campaignId.value, { force: true }),
      campaignStore.fetchCampaign(campaignId.value, true),
    ])
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Simulation failed. Please try again.')
    console.error('Failed to sim to next series:', err)
  } finally {
    seriesResultSimulating.value = false
  }
}

async function handleSimRemainingPlayoffs() {
  seriesResultSimulating.value = true
  playoffStore.closeSeriesResultModal()
  const loadingToastId = toastStore.showLoading('Simulating remaining playoffs...')

  try {
    // Sim all remaining AI playoff games internally (single in-memory loop)
    await gameStore.simulateToNextPlayoffRound(campaignId.value, { simAll: true })

    toastStore.removeMinimalToast(loadingToastId)

    // Refresh all data
    await Promise.all([
      playoffStore.fetchBracket(campaignId.value),
      gameStore.fetchGames(campaignId.value, { force: true }),
      campaignStore.fetchCampaign(campaignId.value, true),
    ])

    // Announce the champion via breaking news
    if (playoffStore.champion) {
      const champion = playoffStore.champion
      const year = campaignStore.currentCampaign?.season?.year || campaignStore.currentCampaign?.game_year || new Date().getFullYear()
      breakingNewsStore.enqueue(
        BreakingNewsService.winningFinals({
          teamName: `${champion.city} ${champion.name}`,
          year,
          date: campaignStore.currentCampaign?.settings?.currentDate || new Date().toISOString().split('T')[0],
        }),
        campaignId.value
      )
    }
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Simulation failed. Please try again.')
    console.error('Failed to sim remaining playoffs:', err)
  } finally {
    seriesResultSimulating.value = false
  }
}

// Find a series by ID in the current bracket
function findSeriesById(seriesId) {
  if (!playoffStore.bracket) return null
  for (const conf of ['east', 'west']) {
    const confData = playoffStore.bracket[conf]
    if (!confData) continue
    for (const series of (confData.round1 || [])) {
      if (series?.seriesId === seriesId) return series
    }
    for (const series of (confData.round2 || [])) {
      if (series?.seriesId === seriesId) return series
    }
    if (confData.confFinals?.seriesId === seriesId) return confData.confFinals
  }
  if (playoffStore.bracket.finals?.seriesId === seriesId) return playoffStore.bracket.finals
  return null
}
</script>

<template>
  <div class="playoff-bracket-view">
    <!-- Team Header -->
    <section class="team-header">
      <div class="team-header-row">
        <div
          class="team-logo-badge"
          :style="{ backgroundColor: team?.primary_color || '#E85A4F' }"
        >
          {{ team?.abbreviation }}
        </div>
        <div class="team-header-text">
          <p class="team-city">{{ team?.city }} · {{ team?.conference === 'east' ? 'EAST' : 'WEST' }}</p>
          <h1 class="team-name">{{ team?.name }}</h1>
        </div>
      </div>
    </section>

    <!-- Playoffs Banner -->
    <div class="playoffs-banner card-cosmic">
      <Trophy :size="18" class="banner-trophy" />
      <span class="banner-title">Playoffs</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="lg" />
      <span>Loading bracket...</span>
    </div>

    <!-- Bracket -->
    <div v-else class="bracket-container glass-card-nebula">
      <PlayoffBracket
        :bracket="playoffStore.bracket"
        :user-team-id="team?.id"
        @select-series="handleSelectSeries"
      />
    </div>

    <!-- Series Detail Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showSeriesDetail"
          class="modal-overlay"
          @click.self="closeSeriesDetail"
        >
          <div class="modal-container">
            <!-- Header -->
            <header class="modal-header">
              <h2 class="modal-title">{{ roundLabel }}</h2>
              <button
                v-if="!simulating"
                class="btn-close"
                @click="closeSeriesDetail"
                aria-label="Close"
              >
                <X :size="20" />
              </button>
            </header>

            <!-- Content -->
            <main class="modal-content" v-if="selectedSeries">
              <!-- Warning State -->
              <div v-if="showWarning" class="warning-state">
                <AlertTriangle :size="40" class="warning-icon" />
                <p class="warning-message">{{ warningMessage }}</p>
                <span class="warning-hint">{{ warningHint }}</span>
                <button class="btn-go-team" @click="goToTeamTab">Go to Team</button>
              </div>

              <template v-else>
                <!-- Series Score Header -->
                <div class="series-score-header">
                  <div class="series-team">
                    <div
                      class="series-team-badge"
                      :class="{ 'is-user': selectedSeries.team1?.teamId == team?.id }"
                      :style="{ backgroundColor: selectedSeries.team1?.primaryColor || 'var(--color-bg-tertiary)' }"
                    >
                      {{ selectedSeries.team1?.abbreviation }}
                    </div>
                    <span class="series-team-name">{{ selectedSeries.team1?.name }}</span>
                    <span v-if="selectedSeries.team1?.seed" class="series-seed">#{{ selectedSeries.team1.seed }}</span>
                  </div>
                  <div class="series-score-display">
                    <span class="series-wins" :class="{ leading: selectedSeries.team1Wins > selectedSeries.team2Wins }">{{ selectedSeries.team1Wins }}</span>
                    <span class="series-dash">-</span>
                    <span class="series-wins" :class="{ leading: selectedSeries.team2Wins > selectedSeries.team1Wins }">{{ selectedSeries.team2Wins }}</span>
                  </div>
                  <div class="series-team">
                    <div
                      class="series-team-badge"
                      :class="{ 'is-user': selectedSeries.team2?.teamId == team?.id }"
                      :style="{ backgroundColor: selectedSeries.team2?.primaryColor || 'var(--color-bg-tertiary)' }"
                    >
                      {{ selectedSeries.team2?.abbreviation }}
                    </div>
                    <span class="series-team-name">{{ selectedSeries.team2?.name }}</span>
                    <span v-if="selectedSeries.team2?.seed" class="series-seed">#{{ selectedSeries.team2.seed }}</span>
                  </div>
                </div>

                <!-- Games List -->
                <div class="series-games-list">
                  <button
                    v-for="(game, idx) in seriesGames"
                    :key="game.id"
                    class="series-game-row"
                    :class="{
                      'is-complete': game.is_complete,
                      'is-next': getGameStatus(game).type === 'next',
                      'is-live': getGameStatus(game).type === 'live',
                      'is-user-game': isUserGame(game)
                    }"
                    @click="handleGameClick(game)"
                  >
                    <span class="game-number">Game {{ idx + 1 }}</span>
                    <span class="game-date">{{ formatGameDate(game.game_date) }}</span>
                    <span class="game-status" :class="[getGameStatus(game).type, getGameStatus(game).result === 'W' ? 'win' : getGameStatus(game).result === 'L' ? 'loss' : '']">
                      {{ getGameStatus(game).label }}
                    </span>
                    <span v-if="game.is_complete && didUserLose(game)" class="game-loss">&#10005;</span>
                    <span v-else-if="game.is_complete" class="game-check">&#10003;</span>
                    <span v-else-if="getGameStatus(game).type === 'next'" class="game-arrow">&rarr;</span>
                  </button>

                  <!-- Placeholder rows for unscheduled games (up to 7) -->
                  <div
                    v-for="i in Math.max(0, 7 - seriesGames.length)"
                    :key="'placeholder-' + i"
                    class="series-game-row placeholder"
                  >
                    <span class="game-number">Game {{ seriesGames.length + i + 1 }}</span>
                    <span class="game-date">—</span>
                    <span class="game-status tbd">—</span>
                  </div>
                </div>
              </template>
            </main>

            <!-- Footer -->
            <footer class="modal-footer">
              <template v-if="isUserSeries && nextGameInSeries && !showWarning">
                <button
                  class="btn-cancel hide-narrow"
                  :disabled="simulating"
                  @click="closeSeriesDetail"
                >
                  Close
                </button>
                <button
                  class="btn-sim"
                  :disabled="simulating"
                  @click="simulateGame"
                >
                  <span v-if="simulating" class="btn-loading"></span>
                  <FastForward v-else :size="16" class="btn-icon" />
                  {{ simulating ? 'Simulating...' : 'Simulate' }}
                </button>
                <button
                  class="btn-confirm"
                  :disabled="simulating"
                  @click="playGame"
                >
                  <Play :size="16" class="btn-icon" />
                  {{ isGameInProgress ? 'Continue' : 'Play' }}
                </button>
              </template>
              <template v-else>
                <button
                  class="btn-cancel full-width"
                  @click="closeSeriesDetail"
                >
                  Close
                </button>
              </template>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Game Day Modal (reused from calendar) -->
    <GameDayModal
      :show="showGameModal"
      :game="selectedGame"
      :user-team="team"
      :is-next-game="selectedGame ? gameStore.nextUserGame?.id === selectedGame.id : false"
      :campaign-id="campaignId"
      @close="closeGameModal"
      @simulated="handleSimulated"
    />

    <!-- Series Result Modal -->
    <SeriesResultModal
      :show="playoffStore.showSeriesResultModal"
      :series-result="playoffStore.seriesResult"
      :user-team-id="team?.id"
      :simulating="seriesResultSimulating"
      @close="closeSeriesResult"
      @sim-next-series="handleSimNextSeries"
      @sim-remaining-playoffs="handleSimRemainingPlayoffs"
    />
  </div>
</template>

<style scoped>
.playoff-bracket-view {
  padding: 8px 16px;
  padding-bottom: 100px;
}

@media (min-width: 1024px) {
  .playoff-bracket-view {
    
  }
}

/* Team Header */
.team-header {
  margin-bottom: 16px;
}

.team-header-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.team-logo-badge {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
  border: 4px solid var(--color-bg-tertiary);
  box-shadow: var(--shadow-md);
}

.team-header-text {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.team-city {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin: 0 0 2px 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.team-name {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2.25rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* Playoffs Banner */
.playoffs-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  margin-bottom: 20px;
}

.playoffs-banner.card-cosmic {
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  position: relative;
  overflow: hidden;
}

.playoffs-banner.card-cosmic::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 10% 20%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 50% 60%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1px 1px at 80% 30%, rgba(255,255,255,0.4), transparent);
  pointer-events: none;
}

.banner-trophy {
  color: rgba(26, 21, 32, 0.6);
  position: relative;
  z-index: 1;
}

.banner-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.25rem;
  font-weight: 400;
  letter-spacing: 0.05em;
  color: #1a1520;
  position: relative;
  z-index: 1;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 300px;
  color: var(--color-text-secondary);
}

.bracket-container {
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background: rgba(15, 15, 30, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

[data-theme="light"] .bracket-container {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(0, 0, 0, 0.08);
}

/* Modal Structure */
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
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Warning State */
.warning-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 16px;
  text-align: center;
}

.warning-icon {
  color: var(--color-warning, #F59E0B);
}

.warning-message {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.warning-hint {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.btn-go-team {
  margin-top: 8px;
  padding: 8px 20px;
  border-radius: var(--radius-xl);
  background: var(--color-primary);
  border: none;
  color: white;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-go-team:hover {
  background: var(--color-primary-dark);
}

.series-score-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: var(--radius-lg);
}

[data-theme="light"] .series-score-header {
  background: rgba(0, 0, 0, 0.04);
}

.series-team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.series-team-badge {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  color: white;
  border: 2px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.series-team-badge.is-user {
  border-color: var(--color-primary);
  box-shadow: 0 0 12px rgba(232, 90, 79, 0.3);
}

.series-team-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-align: center;
}

.series-seed {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  font-weight: 600;
}

.series-score-display {
  display: flex;
  align-items: center;
  gap: 8px;
}

.series-wins {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2.5rem;
  color: var(--color-text-secondary);
  line-height: 1;
}

.series-wins.leading {
  color: var(--color-text-primary);
}

.series-dash {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  color: var(--color-text-tertiary);
  line-height: 1;
}

/* Games List */
.series-games-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.series-game-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--color-bg-tertiary);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
  width: 100%;
  text-align: left;
}

.series-game-row:hover:not(.placeholder) {
  background: var(--color-bg-elevated);
  border-color: var(--glass-border);
}

.series-game-row.placeholder {
  opacity: 0.4;
  cursor: default;
}

.series-game-row.is-next {
  border-color: var(--color-success);
  background: rgba(34, 197, 94, 0.08);
}

.series-game-row.is-live {
  border-color: var(--color-primary);
  animation: pulse-row 2s infinite;
}

@keyframes pulse-row {
  0%, 100% { border-color: var(--color-primary); }
  50% { border-color: rgba(232, 90, 79, 0.4); }
}

.series-game-row.is-complete {
  opacity: 0.8;
}

.game-number {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--color-text-primary);
  min-width: 60px;
}

.game-date {
  flex: 1;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.game-status {
  font-size: 0.8rem;
  font-weight: 600;
  min-width: 70px;
  text-align: right;
}

.game-status.complete {
  color: var(--color-text-secondary);
}

.game-status.complete.win {
  color: var(--color-success);
}

.game-status.complete.loss {
  color: var(--color-primary);
}

.game-status.next {
  color: var(--color-success);
  font-weight: 700;
}

.game-status.live {
  color: var(--color-primary);
  font-weight: 700;
}

.game-status.tbd,
.game-status.upcoming {
  color: var(--color-text-tertiary);
}

.game-check {
  color: var(--color-success);
  font-size: 0.9rem;
}

.game-loss {
  color: var(--color-primary);
  font-size: 0.9rem;
}

.game-arrow {
  color: var(--color-success);
  font-size: 1rem;
}

/* Modal Footer */
.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-cancel,
.btn-confirm,
.btn-sim {
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

.btn-cancel.full-width {
  flex: 1;
}

@media (max-width: 500px) {
  .btn-cancel.hide-narrow {
    display: none;
  }
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

.btn-sim {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
}

.btn-sim:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.btn-cancel:disabled,
.btn-confirm:disabled,
.btn-sim:disabled {
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
