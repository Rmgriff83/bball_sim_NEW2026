<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { useGameStore } from '@/stores/game'
import { useLeagueStore } from '@/stores/league'
import { useToastStore } from '@/stores/toast'
import { LoadingSpinner, BaseModal } from '@/components/ui'
import { SimulateConfirmModal } from '@/components/game'
import { Play, Search, Users, User, Newspaper, FastForward, Calendar, TrendingUp, Settings } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()
const gameStore = useGameStore()
const leagueStore = useLeagueStore()
const toastStore = useToastStore()

const showSimulateModal = ref(false)
const showLineupWarningModal = ref(false)
const pendingGameAction = ref(null) // 'simulate' or gameId for play

// Only show loading if we don't have cached campaign data
const loading = ref(!campaignStore.currentCampaign)

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const team = computed(() => campaign.value?.team)
// Use teamStore roster which includes season_stats
const roster = computed(() => teamStore.roster || [])
const news = computed(() => campaign.value?.news || [])

// Top player by overall rating
const topPlayer = computed(() => {
  if (!roster.value.length) return null
  return [...roster.value].sort((a, b) => b.overall_rating - a.overall_rating)[0]
})

// Get top player's season stats - check multiple possible data paths
const topPlayerStats = computed(() => {
  if (!topPlayer.value) {
    return { ppg: '0.0', rpg: '0.0', apg: '0.0' }
  }

  const player = topPlayer.value
  // Try different possible stat locations (snake_case and camelCase)
  const stats = player.season_stats || player.seasonStats || player.stats || player

  // Helper to format stat value (handles both numbers and pre-formatted strings)
  const formatStat = (val) => {
    if (val === null || val === undefined) return '0.0'
    if (typeof val === 'string') return val
    return Number(val).toFixed(1)
  }

  // Check multiple possible property names
  const ppg = stats.ppg ?? stats.pointsPerGame ?? stats.points_per_game ?? 0
  const rpg = stats.rpg ?? stats.reboundsPerGame ?? stats.rebounds_per_game ?? 0
  const apg = stats.apg ?? stats.assistsPerGame ?? stats.assists_per_game ?? 0

  return {
    ppg: formatStat(ppg),
    rpg: formatStat(rpg),
    apg: formatStat(apg)
  }
})

// Team's standing - use leagueStore for accurate data
const teamStanding = computed(() => {
  if (!team.value) return null
  const conference = team.value.conference
  const standings = conference === 'east'
    ? leagueStore.eastStandings
    : leagueStore.westStandings
  // Try matching by teamId or team_id
  return standings.find(s => s.teamId === team.value.id || s.team_id === team.value.id)
})

const wins = computed(() => teamStanding.value?.wins || 0)
const losses = computed(() => teamStanding.value?.losses || 0)

const teamRank = computed(() => {
  if (!team.value) return '-'
  const rank = leagueStore.getTeamRank(team.value.id, team.value.conference)
  return rank || '-'
})

const conferenceLabel = computed(() => {
  if (!team.value?.conference) return ''
  return team.value.conference === 'east' ? 'EAST' : 'WEST'
})

// Check if lineup is complete (all 5 starters filled)
const isLineupComplete = computed(() => {
  const starters = roster.value.slice(0, 5)
  return starters.length === 5 && starters.every(p => p !== null && p !== undefined)
})

// Current in-game date
const currentDate = computed(() => campaign.value?.current_date)

const formattedCurrentDate = computed(() => {
  if (!currentDate.value) return ''
  const date = new Date(currentDate.value)
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'short' }),
    month: date.toLocaleDateString('en-US', { month: 'short' }),
    day: date.getDate(),
    year: date.getFullYear()
  }
})

// Next upcoming user game
const nextGame = computed(() => gameStore.nextUserGame)

// Get opponent info for next game
const nextGameOpponent = computed(() => {
  if (!nextGame.value || !team.value) return null
  const homeTeam = nextGame.value.home_team
  const awayTeam = nextGame.value.away_team
  const isHome = homeTeam?.id === team.value.id
  const opponent = isHome ? awayTeam : homeTeam

  // Find opponent's standing for record and rank - search both conferences
  const opponentId = opponent?.id
  const opponentAbbr = opponent?.abbreviation
  const matchTeam = (standing) => {
    // Try matching by ID first
    const standingTeamId = standing.teamId ?? standing.team_id ?? standing.team?.id
    if (standingTeamId && opponentId && standingTeamId == opponentId) return true
    // Fallback to matching by abbreviation
    const standingAbbr = standing.team?.abbreviation
    if (standingAbbr && opponentAbbr && standingAbbr === opponentAbbr) return true
    return false
  }

  let opponentStanding = leagueStore.eastStandings.find(matchTeam)
  let opponentConference = 'EAST'
  let opponentRank = null

  if (opponentStanding) {
    opponentRank = leagueStore.eastStandings.indexOf(opponentStanding) + 1
  } else {
    opponentStanding = leagueStore.westStandings.find(matchTeam)
    if (opponentStanding) {
      opponentConference = 'WEST'
      opponentRank = leagueStore.westStandings.indexOf(opponentStanding) + 1
    }
  }

  return {
    name: opponent?.name || opponent?.city || 'Opponent',
    abbreviation: opponent?.abbreviation || '???',
    color: opponent?.primary_color || '#666',
    rating: opponent?.overall_rating || opponent?.rating || null,
    wins: opponentStanding?.wins ?? 0,
    losses: opponentStanding?.losses ?? 0,
    rank: opponentRank,
    conference: opponentConference,
    isHome
  }
})

// User team rating for next game display
const userTeamRating = computed(() => {
  return team.value?.overall_rating || team.value?.rating || null
})

// Format game date
function formatGameDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Format news date
function formatNewsDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

onMounted(async () => {
  // If we already have campaign data, refresh in background without blocking
  const hasCachedData = campaignStore.currentCampaign

  const fetchAll = Promise.all([
    campaignStore.fetchCampaign(campaignId.value),
    teamStore.fetchTeam(campaignId.value),
    leagueStore.fetchStandings(campaignId.value),
    gameStore.fetchGames(campaignId.value)
  ])

  if (hasCachedData) {
    // Refresh in background, don't wait
    fetchAll.catch(err => console.error('Failed to refresh campaign:', err))
  } else {
    // No cached data, wait for fetch and show loading
    try {
      await fetchAll
    } catch (err) {
      console.error('Failed to load campaign:', err)
    } finally {
      loading.value = false
    }
  }
})

function navigateToRoster() {
  router.push(`/campaign/${campaignId.value}/team`)
}

function navigateToScout() {
  router.push(`/campaign/${campaignId.value}/team`)
}

function openPlayerDetails() {
  router.push(`/campaign/${campaignId.value}/team`)
}

function navigateToGame(gameId) {
  if (!isLineupComplete.value) {
    pendingGameAction.value = gameId
    showLineupWarningModal.value = true
    return
  }
  router.push(`/campaign/${campaignId.value}/game/${gameId}`)
}

async function handleSimulateToNextGame() {
  if (!isLineupComplete.value) {
    pendingGameAction.value = 'simulate'
    showLineupWarningModal.value = true
    return
  }
  showSimulateModal.value = true
  await gameStore.fetchSimulateToNextGamePreview(campaignId.value)
}

function handleCloseLineupWarning() {
  showLineupWarningModal.value = false
  pendingGameAction.value = null
}

function goToRosterFromWarning() {
  showLineupWarningModal.value = false
  pendingGameAction.value = null
  router.push(`/campaign/${campaignId.value}/team`)
}

async function handleConfirmSimulate() {
  // Close modal immediately so user sees loading state on the button
  showSimulateModal.value = false
  gameStore.clearSimulatePreview()

  // Show loading toast
  const loadingToastId = toastStore.showLoading('Simulating games...')

  try {
    const response = await gameStore.simulateToNextGame(campaignId.value)

    // Remove loading toast
    toastStore.removeMinimalToast(loadingToastId)

    // Show toast for user's game result
    if (response.userGameResult) {
      const isUserHome = response.userGameResult.home_team?.id === team.value?.id
      toastStore.showGameResult({
        homeTeam: response.userGameResult.home_team?.abbreviation || response.userGameResult.home_team?.name || 'HOME',
        awayTeam: response.userGameResult.away_team?.abbreviation || response.userGameResult.away_team?.name || 'AWAY',
        homeScore: response.userGameResult.home_score,
        awayScore: response.userGameResult.away_score,
        gameId: response.userGameResult.game_id,
        campaignId: campaignId.value,
        isUserHome
      })
    }

    // Refresh campaign data after simulation
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value),
      teamStore.fetchTeam(campaignId.value),
      leagueStore.fetchStandings(campaignId.value),
      gameStore.fetchGames(campaignId.value)
    ])
  } catch (err) {
    // Remove loading toast and show error
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Simulation failed. Please try again.')
    console.error('Failed to simulate to next game:', err)
  }
}

function handleCloseSimulateModal() {
  showSimulateModal.value = false
  gameStore.clearSimulatePreview()
}
</script>

<template>
  <div class="campaign-home">
    <!-- Loading -->
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="md" />
    </div>

    <template v-else-if="campaign">
      <!-- Team Header - City stacked on top of Name -->
      <section class="team-header">
        <div class="team-header-row">
          <div
            class="team-logo-badge"
            :style="{ backgroundColor: team?.primary_color || '#E85A4F' }"
          >
            {{ team?.abbreviation }}
          </div>
          <div class="team-header-text">
            <p class="team-city">{{ team?.city }} · {{ conferenceLabel }}</p>
            <h1 class="team-name">{{ team?.name }}</h1>
          </div>
          <!-- Current date only visible on desktop (mobile shows in header) -->
          <div v-if="formattedCurrentDate" class="current-date">
            <span class="date-day">{{ formattedCurrentDate.day }}</span>
            <div class="date-details">
              <span class="date-month">{{ formattedCurrentDate.month }} {{ formattedCurrentDate.year }}</span>
              <span class="date-weekday">{{ formattedCurrentDate.weekday }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Record Card - Cosmic gradient -->
      <section class="record-card card-cosmic">
        <div class="record-content">
          <div class="record-left">
            <span class="record-label">Record</span>
            <span class="record-rank">#{{ teamRank }} Conf. Rank</span>
          </div>
          <div class="record-right">
            <span class="record-value">{{ wins }}-{{ losses }}</span>
          </div>
        </div>
      </section>

      <!-- Next Game Card -->
      <section v-if="nextGame" class="next-game-card glass-card-nebula">
        <div class="next-game-header">
          <div class="next-game-label-group">
            <h3 class="next-game-label">NEXT GAME</h3>
            <span class="next-game-date">{{ formatGameDate(nextGame.game_date) }}</span>
          </div>
          <span class="next-game-location">{{ nextGameOpponent?.isHome ? 'HOME' : 'AWAY' }}</span>
        </div>
        <div class="next-game-content">
          <div class="next-game-matchup">
            <div class="matchup-team user-team">
              <div
                class="team-badge-game"
                :style="{ backgroundColor: team?.primary_color || '#E85A4F' }"
              >
                <span class="badge-abbr">{{ team?.abbreviation }}</span>
                <span class="badge-record">{{ wins }}-{{ losses }}</span>
              </div>
              <div class="team-info">
                <span v-if="userTeamRating" class="team-rating">{{ userTeamRating }} OVR</span>
                <span class="team-rank">#{{ teamRank }} {{ conferenceLabel }}</span>
              </div>
            </div>
            <div class="matchup-vs">
              <span class="vs-text">VS</span>
            </div>
            <div class="matchup-team opponent-team">
              <div
                class="team-badge-game"
                :style="{ backgroundColor: nextGameOpponent?.color || '#666' }"
              >
                <span class="badge-abbr">{{ nextGameOpponent?.abbreviation }}</span>
                <span class="badge-record">{{ nextGameOpponent?.wins }}-{{ nextGameOpponent?.losses }}</span>
              </div>
              <div class="team-info">
                <span v-if="nextGameOpponent?.rating" class="team-rating">{{ nextGameOpponent.rating }} OVR</span>
                <span v-if="nextGameOpponent?.rank" class="team-rank">#{{ nextGameOpponent.rank }} {{ nextGameOpponent.conference }}</span>
              </div>
            </div>
          </div>
          <div class="next-game-buttons">
            <button class="btn-play-game" @click="navigateToGame(nextGame.id)">
              <Play class="btn-icon" :size="16" />
              PLAY GAME
            </button>
            <button
              class="btn-simulate-game"
              @click="handleSimulateToNextGame"
              :disabled="gameStore.simulating"
            >
              <FastForward v-if="!gameStore.simulating" class="btn-icon" :size="16" />
              <span v-if="gameStore.simulating" class="btn-loading"></span>
              {{ gameStore.simulating ? 'SIMULATING...' : 'SIMULATE' }}
            </button>
          </div>
        </div>
      </section>

      <!-- Quick Actions Card -->
      <section class="quick-actions-card glass-card-nebula">
        <h3 class="section-header">QUICK ACTIONS</h3>
        <div class="quick-actions-grid">
          <button class="action-box" @click="navigateToScout">
            <div class="action-icon">
              <Search :size="24" />
            </div>
            <span class="action-label">Scout</span>
          </button>
          <button class="action-box" @click="navigateToRoster">
            <div class="action-icon">
              <Users :size="24" />
            </div>
            <span class="action-label">GM View</span>
          </button>
          <button class="action-box" @click="router.push(`/campaign/${campaignId}/league`)">
            <div class="action-icon">
              <TrendingUp :size="24" />
            </div>
            <span class="action-label">Standings</span>
          </button>
          <button class="action-box" @click="router.push(`/campaign/${campaignId}/league`)">
            <div class="action-icon">
              <Calendar :size="24" />
            </div>
            <span class="action-label">Schedule</span>
          </button>
        </div>
      </section>

      <!-- Featured Player Card - Cosmic gradient -->
      <section v-if="topPlayer" class="featured-player-card card-cosmic" @click="openPlayerDetails">
        <h3 class="section-header featured-header">FEATURED PLAYER</h3>
        <div class="player-content">
          <div class="player-avatar">
            <User class="avatar-icon" :size="36" />
          </div>
          <div class="player-info">
            <h4 class="player-name">{{ topPlayer.name }}</h4>
            <p class="player-position">{{ topPlayer.position }}</p>
          </div>
          <div class="player-rating">
            <span class="rating-badge">{{ topPlayer.overall_rating }}</span>
          </div>
        </div>
        <div class="player-stats">
          <div class="stat-item">
            <span class="stat-value">{{ topPlayerStats.ppg }}</span>
            <span class="stat-label">PPG</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ topPlayerStats.rpg }}</span>
            <span class="stat-label">RPG</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ topPlayerStats.apg }}</span>
            <span class="stat-label">APG</span>
          </div>
        </div>
      </section>

      <!-- News Feed Card -->
      <section class="news-card">
        <h3 class="section-header">LATEST NEWS</h3>
        <div v-if="news.length" class="news-list">
          <div v-for="item in news.slice(0, 5)" :key="item.id" class="news-item">
            <div class="news-icon">
              <Newspaper :size="18" />
            </div>
            <div class="news-content">
              <p class="news-headline">{{ item.headline }}</p>
              <span class="news-date">{{ formatNewsDate(item.date) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="news-empty">
          <p>No news yet. Simulate some games to generate headlines!</p>
        </div>
      </section>
    </template>

    <!-- Simulate to Next Game Modal -->
    <SimulateConfirmModal
      :show="showSimulateModal"
      :preview="gameStore.simulatePreview"
      :loading="gameStore.loadingPreview"
      :simulating="gameStore.simulating"
      :user-team="team"
      @close="handleCloseSimulateModal"
      @confirm="handleConfirmSimulate"
    />

    <!-- Lineup Warning Modal -->
    <BaseModal
      :show="showLineupWarningModal"
      title="Incomplete Lineup"
      @close="handleCloseLineupWarning"
    >
      <div class="lineup-warning-content">
        <div class="warning-icon">
          <Users :size="48" />
        </div>
        <p class="warning-message">
          Your starting lineup is incomplete. You need 5 starters to play or simulate games.
        </p>
        <p class="warning-hint">
          Go to your roster to set your lineup before continuing.
        </p>
        <div class="warning-actions">
          <button class="btn-secondary" @click="handleCloseLineupWarning">Cancel</button>
          <button class="btn-primary" @click="goToRosterFromWarning">
            <Users :size="16" />
            Go to GM View
          </button>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
.campaign-home {
  padding: 8px 16px;
  padding-bottom: 100px;
  max-width: 1024px;
  margin: 0 auto;
}

.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  opacity: 1;
}

.loading-container :deep(svg) {
  width: 15vw;
  height: 15vh;
}

/* Team Header */
.team-header {
  margin-bottom: 20px;
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

/* Current Date - Hidden on mobile, shown on desktop */
.current-date {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  flex-shrink: 0;
}

@media (min-width: 1024px) {
  .current-date {
    display: flex;
  }
}

.date-day {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  line-height: 1;
  color: var(--color-primary);
}

.date-details {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.date-month {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.date-weekday {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}

/* Record Card */
.record-card {
  padding: 20px 24px;
  margin-bottom: 16px;
}

.record-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  z-index: 1;
}

.record-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.record-label {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1a1520;
}

.record-rank {
  font-size: 0.85rem;
  color: rgba(26, 21, 32, 0.7);
}

.record-right {
  text-align: right;
}

.record-value {
  font-size: 3rem;
  font-weight: 700;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: #1a1520;
  letter-spacing: -0.02em;
}

/* Quick Actions Card */
.quick-actions-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 16px;
  margin-bottom: 16px;
}

.section-header {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin: 0 0 12px 0;
}

.quick-actions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

@media (min-width: 640px) {
  .quick-actions-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.action-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-box:hover {
  background: var(--color-bg-elevated);
  border-color: var(--color-primary);
  transform: translateY(-2px);
}

.action-box:active {
  transform: translateY(0);
}

.action-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(232, 90, 79, 0.1);
  border-radius: var(--radius-lg);
  color: var(--color-primary);
}

.action-icon :deep(svg) {
  stroke-width: 1.5;
}

.action-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.action-box:hover .action-label {
  color: var(--color-text-primary);
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

/* Featured Player Card */
.featured-player-card {
  padding: 16px;
  margin-bottom: 16px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.featured-player-card:active {
  transform: scale(0.98);
}

.featured-header {
  color: rgba(26, 21, 32, 0.8);
  position: relative;
  z-index: 1;
}

.player-content {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}

.player-avatar {
  width: 60px;
  height: 60px;
  background: rgba(26, 21, 32, 0.15);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(26, 21, 32, 0.5);
  flex-shrink: 0;
}

.avatar-icon {
  width: 36px;
  height: 36px;
  stroke-width: 1.5;
}

.player-info {
  flex: 1;
  min-width: 0;
}

.player-name {
  font-size: 1.25rem;
  font-weight: 700;
  color: #1a1520;
  margin: 0;
}

.player-position {
  font-size: 0.9rem;
  color: rgba(26, 21, 32, 0.7);
  margin: 2px 0 0 0;
}

.player-rating {
  flex-shrink: 0;
}

.rating-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  height: 44px;
  padding: 0 12px;
  background: rgba(26, 21, 32, 0.85);
  border-radius: var(--radius-lg);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 1.2rem;
  font-weight: 700;
  color: white;
}

.player-stats {
  display: flex;
  gap: 24px;
  position: relative;
  z-index: 1;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: #1a1520;
}

.stat-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: rgba(26, 21, 32, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* News Card */
.news-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 16px;
  margin-bottom: 16px;
}

.news-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.news-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-lg);
  transition: background 0.2s ease;
}

.news-item:hover {
  background: var(--color-bg-elevated);
}

.news-icon {
  width: 32px;
  height: 32px;
  background: var(--color-primary);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.news-icon :deep(svg) {
  width: 18px;
  height: 18px;
  color: white;
}

.news-content {
  flex: 1;
  min-width: 0;
}

.news-headline {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-text-primary);
  margin: 0 0 4px 0;
  line-height: 1.4;
}

.news-date {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

.news-empty {
  padding: 24px 16px;
  text-align: center;
}

.news-empty p {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  margin: 0;
}

/* Glass Card with Nebula Effect */
.glass-card-nebula {
  position: relative;
  overflow: hidden;
}

.glass-card-nebula::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.05) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

/* Inverted nebula for light mode */
[data-theme="light"] .glass-card-nebula::before {
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.08) 0%, transparent 40%);
}

.glass-card-nebula > * {
  position: relative;
  z-index: 1;
}

/* Next Game Card */
.next-game-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 16px;
  margin-bottom: 16px;
}

.next-game-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.next-game-label-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.next-game-label {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  color: var(--color-text-primary);
  margin: 0;
  line-height: 1;
}

.next-game-date {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.next-game-location {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-primary);
  padding: 4px 10px;
  background: rgba(232, 90, 79, 0.15);
  border-radius: var(--radius-full);
}

.next-game-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.next-game-matchup {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.matchup-team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.team-badge-game {
  width: 124px;
  height: 124px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: white;
  box-shadow: var(--shadow-md);
  border: 3px solid var(--color-bg-tertiary);
}

.badge-abbr {
  font-size: 1.3rem;
  font-weight: 700;
  line-height: 1;
}

.badge-record {
  font-size: 0.85rem;
  font-weight: 600;
  opacity: 0.9;
  line-height: 1;
}

.team-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.team-abbr {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-transform: uppercase;
}

.team-rating {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.team-rank {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}

.matchup-vs {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.vs-text {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  color: var(--color-text-tertiary);
}

.next-game-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn-play-game {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-xl);
  color: white;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-play-game:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.btn-play-game .btn-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2.5;
  fill: currentColor;
}

.btn-simulate-game {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-primary);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-simulate-game:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--color-text-secondary);
}

.btn-simulate-game:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-simulate-game .btn-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

[data-theme="light"] .btn-simulate-game:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.03);
}

/* Cosmic card styles */
.card-cosmic {
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
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
    radial-gradient(1.5px 1.5px at 90% 70%, rgba(255,255,255,0.4), transparent),
    radial-gradient(1px 1px at 20% 90%, rgba(255,255,255,0.2), transparent),
    radial-gradient(1px 1px at 80% 85%, rgba(255,255,255,0.3), transparent);
  pointer-events: none;
}

/* Lineup Warning Modal */
.lineup-warning-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 8px 0 16px;
}

.warning-icon {
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(232, 90, 79, 0.15);
  border-radius: 50%;
  color: var(--color-primary);
  margin-bottom: 16px;
}

.warning-message {
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-primary);
  margin: 0 0 8px 0;
  line-height: 1.5;
}

.warning-hint {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin: 0 0 24px 0;
}

.warning-actions {
  display: flex;
  gap: 12px;
  width: 100%;
}

.warning-actions .btn-secondary {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.warning-actions .btn-secondary:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.warning-actions .btn-primary {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-xl);
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.warning-actions .btn-primary:hover {
  background: var(--color-primary-dark);
}

/* Desktop adjustments */
@media (min-width: 1024px) {
  .campaign-home {
    padding: 24px 24px;
    padding-bottom: 32px;
  }

  .next-game-buttons {
    flex-direction: row;
  }

  .btn-play-game,
  .btn-simulate-game {
    flex: 1;
  }

  .team-logo-badge {
    width: 88px;
    height: 88px;
    font-size: 1.5rem;
  }

  .team-name {
    font-size: 3rem;
  }

  .team-city {
    font-size: 1rem;
  }

  .date-day {
    font-size: 2.5rem;
  }

  .date-month {
    font-size: 0.85rem;
  }

  .date-weekday {
    font-size: 0.75rem;
  }

  .team-badge-game {
    width: 100px;
    height: 100px;
  }

  .badge-abbr {
    font-size: 1.5rem;
  }

  .badge-record {
    font-size: 0.9rem;
  }

  .next-game-matchup {
    gap: 40px;
  }

  .vs-text {
    font-size: 2rem;
  }

  .next-game-label {
    font-size: 1.75rem;
  }

  .next-game-date {
    font-size: 1.1rem;
  }

  .team-abbr {
    font-size: 1rem;
  }

  .team-rating {
    font-size: 0.8rem;
  }
}
</style>
