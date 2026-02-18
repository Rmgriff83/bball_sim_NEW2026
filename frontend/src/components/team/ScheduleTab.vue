<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useCampaignStore } from '@/stores/campaign'
import { usePlayoffStore } from '@/stores/playoff'
import { LoadingSpinner } from '@/components/ui'
import GameDayModal from '@/components/calendar/GameDayModal.vue'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-vue-next'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const router = useRouter()
const gameStore = useGameStore()
const campaignStore = useCampaignStore()
const playoffStore = usePlayoffStore()

const campaign = computed(() => campaignStore.currentCampaign)
const userTeam = computed(() => campaign.value?.team)
const loading = ref(true)
const isExpanded = ref(false)

// Current viewing month (Date object set to first of month)
const currentMonth = ref(new Date())

// Modal state
const selectedGame = ref(null)
const showGameModal = ref(false)

// Team record (wins-losses)
const teamRecord = computed(() => {
  const userGames = gameStore.userGames || []
  let wins = 0
  let losses = 0
  for (const game of userGames) {
    if (game.is_complete && userTeam.value) {
      const isHome = game.home_team?.id === userTeam.value.id
      const userScore = isHome ? game.home_score : game.away_score
      const oppScore = isHome ? game.away_score : game.home_score
      if (userScore > oppScore) {
        wins++
      } else {
        losses++
      }
    }
  }
  return { wins, losses }
})

// Parse a date string into local time (avoids UTC shift from new Date('YYYY-MM-DD'))
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('T')[0].split(' ')[0].split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Season spans Oct-Apr (2 years)
const seasonYear = computed(() => {
  if (!campaign.value?.current_date) return new Date().getFullYear()
  const date = parseLocalDate(campaign.value.current_date)
  // If we're in Jan-Apr, season started previous year
  if (date.getMonth() < 9) { // 0-indexed, 9 = October
    return date.getFullYear() - 1
  }
  return date.getFullYear()
})

// Get all months in the season (Oct year1 through Apr year2)
const seasonMonths = computed(() => {
  const year = seasonYear.value
  const months = []
  // Oct, Nov, Dec of first year
  for (let m = 9; m <= 11; m++) {
    months.push(new Date(year, m, 1))
  }
  // Jan, Feb, Mar, Apr of second year
  for (let m = 0; m <= 3; m++) {
    months.push(new Date(year + 1, m, 1))
  }
  // May, Jun when playoffs are active
  if (playoffStore.isInPlayoffs) {
    for (let m = 4; m <= 5; m++) {
      months.push(new Date(year + 1, m, 1))
    }
  }
  return months
})

// Current campaign date (for "today" highlighting)
const campaignDate = computed(() => {
  if (!campaign.value?.current_date) return null
  return parseLocalDate(campaign.value.current_date)
})

// Focus date: the date of the current/next user game, falling back to campaign date
const focusDate = computed(() => {
  // Check for in-progress game first
  const inProgress = (gameStore.userGames || []).find(g => g.is_in_progress)
  if (inProgress?.game_date) return parseLocalDate(inProgress.game_date)
  // Then next upcoming game
  const next = gameStore.nextUserGame
  if (next?.game_date) return parseLocalDate(next.game_date)
  // Fall back to campaign date
  return campaignDate.value
})

// Group games by date string (exclude cancelled playoff games)
const gamesGroupedByDate = computed(() => {
  const grouped = {}
  for (const game of gameStore.userGames) {
    if (game.is_cancelled) continue
    const dateKey = game.game_date // Already in YYYY-MM-DD format
    if (!grouped[dateKey]) {
      grouped[dateKey] = []
    }
    grouped[dateKey].push(game)
  }
  return grouped
})

// Generate calendar grid for current month
const calendarDays = computed(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth()

  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  const days = []

  // Add days from previous month to fill first week
  const startDayOfWeek = firstDay.getDay()
  if (startDayOfWeek > 0) {
    const prevMonth = new Date(year, month, 0)
    const prevMonthDays = prevMonth.getDate()
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthDays - i
      const date = new Date(year, month - 1, day)
      days.push({
        date,
        day,
        isCurrentMonth: false,
        dateKey: formatDateKey(date),
        games: []
      })
    }
  }

  // Add days of current month
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day)
    const dateKey = formatDateKey(date)
    days.push({
      date,
      day,
      isCurrentMonth: true,
      dateKey,
      games: gamesGroupedByDate.value[dateKey] || []
    })
  }

  // Add days from next month to complete grid (6 weeks = 42 days)
  const remaining = 42 - days.length
  for (let i = 1; i <= remaining; i++) {
    const date = new Date(year, month + 1, i)
    days.push({
      date,
      day: i,
      isCurrentMonth: false,
      dateKey: formatDateKey(date),
      games: []
    })
  }

  return days
})

// Filter to only current month days (no other month padding)
const currentMonthDays = computed(() => {
  return calendarDays.value.filter(day => day.isCurrentMonth)
})

// Whether the user is viewing the month that contains the focus date (next/current game)
const isViewingFocusMonth = computed(() => {
  if (!focusDate.value) return false
  return currentMonth.value.getFullYear() === focusDate.value.getFullYear() &&
    currentMonth.value.getMonth() === focusDate.value.getMonth()
})

// The 7 days (Sun-Sat) of the week containing the focus date (next/current game)
const focusWeekDays = computed(() => {
  const date = focusDate.value || campaignDate.value || new Date()
  const dayOfWeek = date.getDay() // 0=Sun
  const sunday = new Date(date)
  sunday.setDate(date.getDate() - dayOfWeek)
  const saturday = new Date(sunday)
  saturday.setDate(sunday.getDate() + 6)

  const sunKey = formatDateKey(sunday)
  const satKey = formatDateKey(saturday)

  return calendarDays.value.filter(d => d.dateKey >= sunKey && d.dateKey <= satKey)
})

// What days to actually render in the grid
const displayDays = computed(() => {
  if (!isViewingFocusMonth.value) return currentMonthDays.value
  if (isExpanded.value) return currentMonthDays.value
  return focusWeekDays.value
})

// Check if a day is "today" in campaign time
function isToday(date) {
  if (!campaignDate.value) return false
  return formatDateKey(date) === formatDateKey(campaignDate.value)
}

// Check if a game is the next game to play
function isNextGame(game) {
  return gameStore.nextUserGame?.id === game.id
}

// Check if a game is in progress
function isGameInProgress(game) {
  return game?.is_in_progress || false
}

// Format date to YYYY-MM-DD
function formatDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Navigation
function prevMonth() {
  const current = currentMonth.value
  const prevIndex = seasonMonths.value.findIndex(m =>
    m.getFullYear() === current.getFullYear() && m.getMonth() === current.getMonth()
  )
  if (prevIndex > 0) {
    currentMonth.value = seasonMonths.value[prevIndex - 1]
    isExpanded.value = false
  }
}

function nextMonth() {
  const current = currentMonth.value
  const currentIndex = seasonMonths.value.findIndex(m =>
    m.getFullYear() === current.getFullYear() && m.getMonth() === current.getMonth()
  )
  if (currentIndex < seasonMonths.value.length - 1) {
    currentMonth.value = seasonMonths.value[currentIndex + 1]
    isExpanded.value = false
  }
}

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

function goToToday() {
  if (!campaignDate.value) return
  // Find which season month contains campaign date
  const target = seasonMonths.value.find(m =>
    m.getFullYear() === campaignDate.value.getFullYear() &&
    m.getMonth() === campaignDate.value.getMonth()
  )
  if (target) {
    currentMonth.value = target
  }
}

// Check if at first/last month of season
const isFirstMonth = computed(() => {
  const current = currentMonth.value
  const first = seasonMonths.value[0]
  return current.getFullYear() === first.getFullYear() && current.getMonth() === first.getMonth()
})

const isLastMonth = computed(() => {
  const current = currentMonth.value
  const last = seasonMonths.value[seasonMonths.value.length - 1]
  return current.getFullYear() === last.getFullYear() && current.getMonth() === last.getMonth()
})

// Month display name
const monthDisplayName = computed(() => {
  return currentMonth.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

// Click on a calendar day - open first game or do nothing
function handleDayClick(dayData) {
  if (dayData.games.length > 0) {
    openGameModal(dayData.games[0])
  }
}

// Open modal for a game
function openGameModal(game) {
  selectedGame.value = game
  showGameModal.value = true
}

function closeGameModal() {
  showGameModal.value = false
  selectedGame.value = null
}

// Handle simulation complete - refresh data
async function handleSimulated() {
  // Data is already refreshed by the modal, just close it
  closeGameModal()
}

// Get teams info for a game
function getTeamsInfo(game) {
  if (!userTeam.value) return null
  const isHome = game.home_team?.id === userTeam.value.id
  return {
    user: isHome ? game.home_team : game.away_team,
    opponent: isHome ? game.away_team : game.home_team,
    userScore: isHome ? game.home_score : game.away_score,
    oppScore: isHome ? game.away_score : game.home_score,
    isHome
  }
}

// Get game result (W/L)
function getGameResult(game) {
  if (!game.is_complete || !userTeam.value) return null
  const info = getTeamsInfo(game)
  if (!info) return null
  return {
    won: info.userScore > info.oppScore,
    userScore: info.userScore,
    oppScore: info.oppScore
  }
}

// Get in-progress score display
function getInProgressScore(game) {
  if (!isGameInProgress(game) || !userTeam.value) return null
  const info = getTeamsInfo(game)
  if (!info) return null
  const quarter = game.current_quarter ?? gameStore.currentSimQuarter ?? 1
  return {
    userScore: info.userScore ?? 0,
    oppScore: info.oppScore ?? 0,
    quarter
  }
}

// Navigate to the month containing a specific game date
function goToGameDate(gameDateStr) {
  if (!gameDateStr || !seasonMonths.value.length) return
  const date = new Date(gameDateStr + 'T00:00:00')
  const target = seasonMonths.value.find(m =>
    m.getFullYear() === date.getFullYear() &&
    m.getMonth() === date.getMonth()
  )
  if (target) {
    currentMonth.value = target
  }
}

// Load data
onMounted(async () => {
  try {
    // Fetch games if not already loaded
    if (!gameStore.games.length) {
      await gameStore.fetchGames(props.campaignId)
    }

    // Navigate to next/current user game, falling back to campaign date
    const targetGame = gameStore.nextUserGame
    if (targetGame?.game_date) {
      goToGameDate(targetGame.game_date)
    } else if (campaignDate.value && seasonMonths.value.length) {
      goToToday()
    } else if (seasonMonths.value.length) {
      currentMonth.value = seasonMonths.value[0]
    }
  } catch (err) {
    console.error('Failed to load calendar data:', err)
  } finally {
    loading.value = false
  }
})

// Update current month when focus date changes (e.g. game completed, next game updated)
watch(focusDate, () => {
  if (focusDate.value) {
    goToGameDate(formatDateKey(focusDate.value))
  }
})
</script>

<template>
  <div class="schedule-tab">
    <!-- Tab Title with Record - Cosmic Header -->
    <div class="schedule-header card-cosmic">
      <div class="header-left">
        <div
          v-if="userTeam"
          class="header-team-logo"
          :style="{ backgroundColor: userTeam.primary_color || '#666' }"
        >
          {{ userTeam.abbreviation }}
        </div>
        <h2 class="header-text">SCHEDULE</h2>
      </div>
      <span class="team-record">{{ teamRecord.wins }}-{{ teamRecord.losses }}</span>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="lg" />
      <span>Loading schedule...</span>
    </div>

    <!-- Calendar -->
    <div v-else class="calendar-wrapper">

      <div class="calendar-container">
        <!-- Calendar Header with Month -->
        <div class="calendar-header">
          <span class="month-label">{{ monthDisplayName }}</span>
        </div>

        <!-- Expand/Collapse Toggle -->
        <div v-if="isViewingFocusMonth" class="expand-toggle-row">
          <button class="expand-toggle-btn" @click="toggleExpand">
            <span>{{ isExpanded ? 'Show This Week' : 'See Full Month' }}</span>
            <component :is="isExpanded ? ChevronUp : ChevronDown" :size="16" />
          </button>
        </div>

        <!-- Calendar Grid -->
        <div class="calendar-grid-wrapper">
          <div class="calendar-grid">
            <button
              v-for="(dayData, index) in displayDays"
              :key="index"
              :data-date="dayData.dateKey"
              class="calendar-day"
              :class="{
                'has-game': dayData.games.length > 0,
                'is-today': isToday(dayData.date),
                'game-won': dayData.games[0] && getGameResult(dayData.games[0])?.won,
                'game-lost': dayData.games[0] && getGameResult(dayData.games[0]) && !getGameResult(dayData.games[0])?.won,
                'game-in-progress': dayData.games[0] && isGameInProgress(dayData.games[0]),
                'game-upcoming': dayData.games[0] && !dayData.games[0].is_complete && !isGameInProgress(dayData.games[0]),
                'game-next': dayData.games[0] && isNextGame(dayData.games[0]) && !isGameInProgress(dayData.games[0]),
                'game-playoff': dayData.games[0]?.is_playoff
              }"
              @click="handleDayClick(dayData)"
            >
              <!-- Day number in corner -->
              <span class="day-number">{{ dayData.day }}</span>

              <!-- PO badge for playoff games -->
              <span
                v-if="dayData.games[0]?.is_playoff && !dayData.games[0]?.is_complete"
                class="playoff-badge"
              >PO</span>

              <!-- W/L badge in upper left for completed games -->
              <span
                v-if="dayData.games[0]?.is_complete"
                class="result-badge"
              >
                {{ getGameResult(dayData.games[0])?.won ? 'W' : 'L' }}
              </span>

              <!-- Game content -->
              <div v-if="dayData.games.length" class="game-content">
                <template v-if="dayData.games[0].is_complete">
                  <!-- Completed: Show team badge stacked on score -->
                  <div class="matchup-stack">
                    <div
                      class="team-logo-badge"
                      :style="{ backgroundColor: getTeamsInfo(dayData.games[0])?.opponent?.primary_color || '#666' }"
                    >
                      {{ getTeamsInfo(dayData.games[0])?.opponent?.abbreviation }}
                    </div>
                    <span class="score-text">{{ getTeamsInfo(dayData.games[0])?.userScore }}-{{ getTeamsInfo(dayData.games[0])?.oppScore }}</span>
                  </div>
                </template>

                <template v-else-if="isGameInProgress(dayData.games[0])">
                  <!-- In Progress: Live indicator with score -->
                  <span class="live-indicator">LIVE</span>
                  <div class="matchup-stack">
                    <div
                      class="team-logo-badge"
                      :style="{ backgroundColor: getTeamsInfo(dayData.games[0])?.opponent?.primary_color || '#666' }"
                    >
                      {{ getTeamsInfo(dayData.games[0])?.opponent?.abbreviation }}
                    </div>
                    <span class="score-text">{{ getInProgressScore(dayData.games[0])?.userScore }}-{{ getInProgressScore(dayData.games[0])?.oppScore }}</span>
                  </div>
                </template>

                <template v-else>
                  <!-- Upcoming: Show matchup -->
                  <span class="location-label">{{ getTeamsInfo(dayData.games[0])?.isHome ? 'vs' : '@' }}</span>
                  <div
                    class="team-logo-badge team-logo-badge-lg"
                    :style="{ backgroundColor: getTeamsInfo(dayData.games[0])?.opponent?.primary_color || '#666' }"
                  >
                    {{ getTeamsInfo(dayData.games[0])?.opponent?.abbreviation }}
                  </div>
                </template>
              </div>
            </button>
          </div>
        </div>

        <!-- Navigation at Bottom -->
        <div class="calendar-nav">
          <button
            class="nav-btn"
            :disabled="isFirstMonth"
            @click="prevMonth"
          >
            <ChevronLeft :size="20" />
            <span>Prev</span>
          </button>

          <button
            class="nav-btn"
            :disabled="isLastMonth"
            @click="nextMonth"
          >
            <span>Next</span>
            <ChevronRight :size="20" />
          </button>
        </div>
      </div>
    </div>

    <!-- Game Day Modal -->
    <GameDayModal
      :show="showGameModal"
      :game="selectedGame"
      :user-team="userTeam"
      :is-next-game="selectedGame ? isNextGame(selectedGame) : false"
      :campaign-id="campaignId"
      @close="closeGameModal"
      @simulated="handleSimulated"
    />
  </div>
</template>

<style scoped>
.schedule-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Cosmic Header - matches Starters header style */
.schedule-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: var(--radius-md);
}

.schedule-header.card-cosmic {
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  position: relative;
  overflow: hidden;
}

.schedule-header.card-cosmic::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 10% 20%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 50% 60%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1px 1px at 80% 30%, rgba(255,255,255,0.4), transparent);
  pointer-events: none;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
  z-index: 1;
}

.header-team-logo {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.55rem;
  font-weight: 700;
  color: white;
  border: 2px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.header-text {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: #1a1520;
  margin: 0;
  letter-spacing: 0.05em;
}

.team-record {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.25rem;
  color: #1a1520;
  position: relative;
  z-index: 1;
}

/* Loading */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 300px;
  color: var(--color-text-secondary);
}

/* Calendar Wrapper */
.calendar-wrapper {
  position: relative;
}

/* Calendar Container */
.calendar-container {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  overflow: hidden;
}

/* Calendar Header */
.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(0, 0, 0, 0.15);
}

[data-theme="light"] .calendar-header {
  background: rgba(0, 0, 0, 0.03);
}

.month-label {
  font-family: var(--font-display);
  font-size: 1.25rem;
  color: var(--color-text-primary);
  letter-spacing: 0.02em;
}

/* Calendar Grid - Responsive columns */
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--glass-border);
}

@media (min-width: 500px) {
  .calendar-grid {
    grid-template-columns: repeat(5, 1fr);
  }
}

@media (min-width: 700px) {
  .calendar-grid {
    grid-template-columns: repeat(7, 1fr);
  }
}

/* Calendar Day */
.calendar-day {
  aspect-ratio: 1;
  min-height: 0;
  padding: 4px;
  background: var(--color-bg-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
  position: relative;
  overflow: visible;
}

.calendar-day:hover {
  background: var(--color-bg-tertiary);
}

.calendar-day.is-today {
  background: rgba(232, 90, 79, 0.12);
  box-shadow: inset 0 0 0 2px var(--color-primary);
}

.calendar-day.has-game {
  cursor: pointer;
}

.calendar-day.has-game:hover {
  transform: scale(1.05);
  z-index: 2;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

/* Game state colors - Green for wins, Red for losses */
.calendar-day.game-won {
  background: rgba(34, 197, 94, 0.18);
}

.calendar-day.game-lost {
  background: rgba(239, 68, 68, 0.18);
}

.calendar-day.game-in-progress {
  background: rgba(34, 197, 94, 0.2);
  animation: pulse-live 1.5s ease-in-out infinite;
  box-shadow: inset 0 0 0 3px rgba(34, 197, 94, 0.6);
}

@keyframes pulse-live {
  0%, 100% {
    box-shadow: inset 0 0 0 3px rgba(34, 197, 94, 0.6), 0 0 8px rgba(34, 197, 94, 0.3);
    background: rgba(34, 197, 94, 0.2);
  }
  50% {
    box-shadow: inset 0 0 0 3px rgba(34, 197, 94, 0.9), 0 0 20px rgba(34, 197, 94, 0.5);
    background: rgba(34, 197, 94, 0.3);
  }
}

/* Playoff game gold border accent */
.calendar-day.game-playoff {
  box-shadow: inset 0 0 0 2px rgba(255, 215, 0, 0.5);
}

.calendar-day.game-playoff.game-won,
.calendar-day.game-playoff.game-lost {
  box-shadow: inset 0 0 0 2px rgba(255, 215, 0, 0.35);
}

.calendar-day.game-next {
  background: rgba(34, 197, 94, 0.1);
  box-shadow: inset 0 0 0 2px var(--color-success);
}

.calendar-day.game-playoff.game-next {
  box-shadow: inset 0 0 0 2px rgba(255, 215, 0, 0.6);
}

.calendar-day.game-upcoming:not(.game-next) {
  background: var(--color-bg-tertiary);
}

/* Day Number - top right corner */
.day-number {
  position: absolute;
  top: 4px;
  right: 5px;
  font-size: 0.8rem;
  font-weight: 800;
  color: var(--color-text-tertiary);
  line-height: 1;
}

@media (min-width: 500px) {
  .day-number {
    font-size: 0.85rem;
  }
}

@media (min-width: 700px) {
  .day-number {
    font-size: 0.95rem;
  }
}

.is-today .day-number {
  color: var(--color-primary);
}

.game-won .day-number,
.game-lost .day-number,
.game-next .day-number {
  color: var(--color-text-secondary);
}

/* Result Badge - Upper left corner */
.result-badge {
  position: absolute;
  top: 5px;
  left: 5px;
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 400;
  text-transform: uppercase;
  line-height: 1;
}

@media (min-width: 500px) {
  .result-badge {
    font-size: 1.7rem;
  }
}

@media (min-width: 700px) {
  .result-badge {
    font-size: 1.9rem;
  }
}

.game-won .result-badge {
  color: var(--color-success);
}

.game-lost .result-badge {
  color: var(--color-error);
}

/* Game Content */
.game-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 100%;
  min-height: 0;
}

/* Matchup Stack - vertical layout */
.matchup-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

@media (min-width: 500px) {
  .matchup-stack {
    gap: 4px;
  }
}

@media (min-width: 700px) {
  .matchup-stack {
    gap: 5px;
  }
}

/* Team Logo Badge */
.team-logo-badge {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.45rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

@media (min-width: 500px) {
  .team-logo-badge {
    width: 28px;
    height: 28px;
    font-size: 0.5rem;
  }
}

@media (min-width: 700px) {
  .team-logo-badge {
    width: 32px;
    height: 32px;
    font-size: 0.55rem;
  }
}

.team-logo-badge-lg {
  width: 30px;
  height: 30px;
  font-size: 0.5rem;
}

@media (min-width: 500px) {
  .team-logo-badge-lg {
    width: 36px;
    height: 36px;
    font-size: 0.55rem;
  }
}

@media (min-width: 700px) {
  .team-logo-badge-lg {
    width: 42px;
    height: 42px;
    font-size: 0.6rem;
  }
}

/* Score Text */
.score-text {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1;
}

@media (min-width: 500px) {
  .score-text {
    font-size: 0.8rem;
  }
}

@media (min-width: 700px) {
  .score-text {
    font-size: 0.9rem;
  }
}

/* Live Indicator */
.live-indicator {
  font-size: 0.7rem;
  font-weight: 800;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  line-height: 1;
  padding: 3px 6px;
  background: linear-gradient(135deg, #ef4444 0%, #f97316 100%);
  border-radius: 4px;
  animation: pulse-badge 1.2s ease-in-out infinite;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
}

@media (min-width: 500px) {
  .live-indicator {
    font-size: 0.75rem;
    padding: 3px 8px;
  }
}

@media (min-width: 700px) {
  .live-indicator {
    font-size: 0.85rem;
    padding: 4px 10px;
  }
}

@keyframes pulse-badge {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
  }
  50% {
    transform: scale(1.05);
    box-shadow: 0 4px 16px rgba(239, 68, 68, 0.6);
  }
}

/* Playoff Badge */
.playoff-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  font-size: 0.55rem;
  font-weight: 800;
  color: #1a1520;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  line-height: 1;
  padding: 2px 4px;
  background: linear-gradient(135deg, #ffd700, #ffb300);
  border-radius: 3px;
  z-index: 1;
}

@media (min-width: 500px) {
  .playoff-badge {
    font-size: 0.6rem;
    padding: 2px 5px;
  }
}

@media (min-width: 700px) {
  .playoff-badge {
    font-size: 0.65rem;
    padding: 3px 6px;
  }
}

/* Upcoming Game Display */
.location-label {
  font-size: 0.45rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  font-weight: 600;
  line-height: 1;
}

@media (min-width: 500px) {
  .location-label {
    font-size: 0.5rem;
  }
}

@media (min-width: 700px) {
  .location-label {
    font-size: 0.55rem;
  }
}

/* Bottom Navigation */
.calendar-nav {
  display: flex;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--glass-border);
  background: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .calendar-nav {
  background: rgba(0, 0, 0, 0.02);
}

.nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-btn:hover:not(:disabled) {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Expand/Collapse Toggle */
.expand-toggle-row {
  display: flex;
  justify-content: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--glass-border);
}

.expand-toggle-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: color 0.2s ease;
}

.expand-toggle-btn:hover {
  color: var(--color-text-primary);
}
</style>
