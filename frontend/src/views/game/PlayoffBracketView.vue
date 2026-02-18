<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayoffStore } from '@/stores/playoff'
import { useGameStore } from '@/stores/game'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { LoadingSpinner, BaseModal } from '@/components/ui'
import PlayoffBracket from '@/components/playoffs/PlayoffBracket.vue'
import GameDayModal from '@/components/calendar/GameDayModal.vue'
import { Trophy } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const playoffStore = usePlayoffStore()
const gameStore = useGameStore()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()

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
    return { label: `${game.home_score}-${game.away_score}`, type: 'complete' }
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

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([
      playoffStore.fetchBracket(campaignId.value),
      gameStore.fetchGames(campaignId.value),
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
  showSeriesDetail.value = false
  selectedSeries.value = null
}

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
    <!-- Header -->
    <div class="view-header">
      <Trophy :size="24" class="header-icon" />
      <h1 class="view-title">Playoffs</h1>
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
    <BaseModal
      :show="showSeriesDetail"
      :title="roundLabel"
      size="md"
      @close="closeSeriesDetail"
    >
      <div v-if="selectedSeries" class="series-detail">
        <!-- Series Score Header -->
        <div class="series-score-header">
          <div class="series-team">
            <div
              class="series-team-badge"
              :class="{ 'is-user': selectedSeries.team1?.teamId == team?.id }"
            >
              {{ selectedSeries.team1?.abbreviation }}
            </div>
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
            >
              {{ selectedSeries.team2?.abbreviation }}
            </div>
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
            <span class="game-status" :class="getGameStatus(game).type">
              {{ getGameStatus(game).label }}
            </span>
            <span v-if="game.is_complete" class="game-check">&#10003;</span>
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
      </div>

      <template #footer>
        <button class="modal-btn modal-btn-secondary" @click="closeSeriesDetail">
          Close
        </button>
      </template>
    </BaseModal>

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
  </div>
</template>

<style scoped>
.playoff-bracket-view {
  padding: 24px 16px 100px;
}

@media (min-width: 1024px) {
  .playoff-bracket-view {
    padding: 24px 24px 48px;
  }
}

.view-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.header-icon {
  color: #ffd700;
}

.view-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  font-weight: 400;
  letter-spacing: 0.05em;
  color: var(--color-text-primary);
  margin: 0;
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

/* Series Detail Modal */
.series-detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
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
  background: var(--color-bg-tertiary);
  border: 2px solid var(--glass-border);
}

.series-team-badge.is-user {
  border-color: var(--color-primary);
  box-shadow: 0 0 12px rgba(232, 90, 79, 0.3);
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

.game-arrow {
  color: var(--color-success);
  font-size: 1rem;
}

/* Modal footer button */
.modal-btn {
  flex: 1;
  padding: 12px;
  border-radius: var(--radius-md);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.modal-btn-secondary {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
}

.modal-btn-secondary:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}
</style>
