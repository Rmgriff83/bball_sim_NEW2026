<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLeagueStore } from '@/stores/league'
import { useTeamStore } from '@/stores/team'
import { useCampaignStore } from '@/stores/campaign'
import { useGameStore } from '@/stores/game'
import { GlassCard, BaseButton, LoadingSpinner, StatBadge } from '@/components/ui'
import { X, ChevronLeft } from 'lucide-vue-next'
import { buildSeasonStatsTable } from '@/composables/useSeasonHistory'

const route = useRoute()
const router = useRouter()
const leagueStore = useLeagueStore()
const teamStore = useTeamStore()
const campaignStore = useCampaignStore()
const gameStore = useGameStore()

const loading = ref(true)
const activeTab = ref('standings')
const activeConference = ref(null)

// League leaders state
const leadersFetched = ref(false)
const leadersSortColumn = ref('ppg')
const leadersSortDirection = ref('desc')

// League leaders columns for sortable table
const leaderColumns = [
  { key: 'name', label: 'Player', class: 'player-col' },
  { key: 'teamAbbreviation', label: 'Team', class: 'team-col-sm' },
  { key: 'gamesPlayed', label: 'GP', class: 'stat-col' },
  { key: 'ppg', label: 'PPG', class: 'stat-col' },
  { key: 'rpg', label: 'RPG', class: 'stat-col' },
  { key: 'apg', label: 'APG', class: 'stat-col' },
  { key: 'spg', label: 'SPG', class: 'stat-col' },
  { key: 'bpg', label: 'BPG', class: 'stat-col' },
  { key: 'topg', label: 'TO', class: 'stat-col' },
  { key: 'fgPct', label: 'FG%', class: 'stat-col' },
  { key: 'threePct', label: '3P%', class: 'stat-col' },
  { key: 'ftPct', label: 'FT%', class: 'stat-col' },
]

// Get team IDs for each conference from standings
const eastTeamIds = computed(() => {
  return eastStandings.value.map(s => s.teamId)
})

const westTeamIds = computed(() => {
  return westStandings.value.map(s => s.teamId)
})

// Sorted and filtered league leaders
const sortedLeaders = computed(() => {
  let leaders = [...(leagueStore.playerLeaders || [])]

  // Filter by conference (skip if null/all)
  if (activeConference.value) {
    const conferenceTeamIds = activeConference.value === 'east' ? eastTeamIds.value : westTeamIds.value
    if (conferenceTeamIds.length > 0) {
      leaders = leaders.filter(player => conferenceTeamIds.includes(player.teamId))
    }
  }

  const col = leadersSortColumn.value
  const dir = leadersSortDirection.value === 'desc' ? -1 : 1

  return leaders.sort((a, b) => {
    let aVal = a[col] || 0
    let bVal = b[col] || 0

    // Handle string sorting for name/team
    if (col === 'name' || col === 'teamAbbreviation') {
      aVal = col === 'name' ? (a.name || '') : (a.teamAbbreviation || '')
      bVal = col === 'name' ? (b.name || '') : (b.teamAbbreviation || '')
      return dir * aVal.localeCompare(bVal)
    }

    return dir * (aVal - bVal)
  })
})

function sortLeadersBy(column) {
  if (leadersSortColumn.value === column) {
    // Toggle direction if same column
    leadersSortDirection.value = leadersSortDirection.value === 'desc' ? 'asc' : 'desc'
  } else {
    // New column, default to descending (except for name/team which defaults to asc)
    leadersSortColumn.value = column
    leadersSortDirection.value = (column === 'name' || column === 'teamAbbreviation') ? 'asc' : 'desc'
  }
}

function getLeadersSortIcon(column) {
  if (leadersSortColumn.value !== column) return ''
  return leadersSortDirection.value === 'desc' ? ' ▼' : ' ▲'
}

// Watch for tab change to fetch leaders
watch(activeTab, async (newTab) => {
  if (newTab === 'leaders') {
    try {
      await leagueStore.fetchPlayerLeaders(campaignId.value, { force: true })
      leadersFetched.value = true
    } catch (err) {
      console.error('Failed to fetch league leaders:', err)
    }
  }
})

// Team modal state
const showTeamModal = ref(false)
const selectedTeam = ref(null)
const selectedTeamRoster = ref([])
const loadingTeamRoster = ref(false)

// Player modal state (nested within team modal)
const showPlayerModal = ref(false)
const selectedPlayer = ref(null)
const playerModalTab = ref('stats')
const playerModalOrigin = ref('team') // 'team' or 'leaders'
const loadingPlayerFromLeaders = ref(false)

// Evolution history display state
const showAllRecentEvolution = ref(false)
const showAllTimeEvolution = ref(false)
const showAllTimeExpanded = ref(false)

// Badges display state
const showAllBadges = ref(false)

// Season history stats for player modal
const seasonStatsRows = computed(() => {
  const p = selectedPlayer.value
  if (!p) return []
  return buildSeasonStatsTable(
    p.seasonHistory,
    p.season_stats,
    campaign.value?.currentSeasonYear,
    p.teamAbbreviation || p.team_abbreviation
  )
})

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const userTeam = computed(() => campaign.value?.team)

const eastStandings = computed(() => leagueStore.eastStandings)
const westStandings = computed(() => leagueStore.westStandings)

const sortByWinPct = (arr) => [...arr].sort((a, b) => {
  const totalA = a.wins + a.losses
  const totalB = b.wins + b.losses
  const pctA = totalA > 0 ? a.wins / totalA : 0
  const pctB = totalB > 0 ? b.wins / totalB : 0
  if (pctA !== pctB) return pctB - pctA
  const diffA = (a.pointsFor || 0) - (a.pointsAgainst || 0)
  const diffB = (b.pointsFor || 0) - (b.pointsAgainst || 0)
  return diffB - diffA
})

const activeStandings = computed(() => {
  if (activeConference.value === null) {
    return sortByWinPct([...eastStandings.value, ...westStandings.value])
  }
  const conf = activeConference.value === 'east' ? eastStandings.value : westStandings.value
  return sortByWinPct(conf)
})

// Recent games across the league
const recentGames = computed(() => {
  return gameStore.completedGames
    .slice(-10)
    .reverse()
})

// Upcoming games
const upcomingGames = computed(() => {
  return gameStore.upcomingGames.slice(0, 10)
})

// User team's games remaining in regular season (82 game season)
const userGamesRemaining = computed(() => {
  return gameStore.upcomingGames?.filter(g => g.is_user_game)?.length || 0
})

const userGamesPlayed = computed(() => {
  return gameStore.completedGames?.filter(g => g.is_user_game)?.length || 0
})

const totalSeasonGames = 54 // Regular season

// Format season year as '25/'26 (2025-2026 season)
const formattedSeasonYear = computed(() => {
  const year = campaign.value?.season?.year || new Date().getFullYear()
  const startYear = String(year).slice(-2)
  const endYear = String(year + 1).slice(-2)
  return `'${startYear}/'${endYear}`
})

const seasonProgressPercent = computed(() => {
  return Math.round((userGamesPlayed.value / totalSeasonGames) * 100)
})

onMounted(async () => {
  try {
    await Promise.all([
      leagueStore.fetchStandings(campaignId.value),
      gameStore.fetchGames(campaignId.value)
    ])
  } catch (err) {
    console.error('Failed to load league data:', err)
  } finally {
    loading.value = false
  }
})

function getWinPercentage(wins, losses) {
  const total = wins + losses
  if (total === 0) return '.000'
  const pct = wins / total
  return pct.toFixed(3).substring(1)
}

function getGamesBehind(standing, standings) {
  if (!standings || standings.length === 0) return '-'
  const leader = standings[0]
  const gb = ((leader.wins - standing.wins) + (standing.losses - leader.losses)) / 2
  if (gb === 0) return '-'
  return gb.toFixed(1)
}

function getStreakClass(streak) {
  if (!streak) return ''
  if (streak.startsWith('W')) return 'streak-win'
  if (streak.startsWith('L')) return 'streak-loss'
  return ''
}

function isUserTeam(teamId) {
  return userTeam.value?.id === teamId
}

function formatDate(dateString) {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}

function navigateToGame(gameId) {
  router.push(`/campaign/${campaignId.value}/game/${gameId}`)
}

// Team modal handlers
async function openTeamModal(teamStanding) {
  selectedTeam.value = teamStanding
  showTeamModal.value = true
  loadingTeamRoster.value = true

  try {
    const data = await teamStore.fetchTeamRoster(campaignId.value, teamStanding.teamId)
    // Sort roster by overall rating (highest first)
    selectedTeamRoster.value = [...(data.roster || [])].sort((a, b) =>
      (b.overall_rating || b.overallRating || 0) - (a.overall_rating || a.overallRating || 0)
    )
  } catch (err) {
    console.error('Failed to load team roster:', err)
  } finally {
    loadingTeamRoster.value = false
  }
}

function closeTeamModal() {
  showTeamModal.value = false
  selectedTeam.value = null
  selectedTeamRoster.value = []
}

// Player modal handlers (nested within team modal)
function openPlayerFromTeam(player) {
  selectedPlayer.value = player
  playerModalTab.value = 'stats'
  showAllBadges.value = false
  playerModalOrigin.value = 'team'
  showPlayerModal.value = true
}

async function openPlayerFromLeaders(leaderPlayer) {
  playerModalTab.value = 'stats'
  showAllBadges.value = false
  playerModalOrigin.value = 'leaders'
  loadingPlayerFromLeaders.value = true
  showPlayerModal.value = true

  try {
    const data = await teamStore.fetchTeamRoster(campaignId.value, leaderPlayer.teamId)
    const roster = data.roster || []
    const fullPlayer = roster.find(p => String(p.id) === String(leaderPlayer.playerId))
    if (fullPlayer) {
      selectedPlayer.value = fullPlayer
    } else {
      // Fallback: show basic info from leader data
      selectedPlayer.value = {
        id: leaderPlayer.playerId,
        name: leaderPlayer.name,
        position: '',
        overall_rating: 0,
        season_stats: {
          games_played: leaderPlayer.gamesPlayed,
          ppg: leaderPlayer.ppg,
          rpg: leaderPlayer.rpg,
          apg: leaderPlayer.apg,
          spg: leaderPlayer.spg,
          bpg: leaderPlayer.bpg,
          fg_pct: leaderPlayer.fgPct,
          three_pct: leaderPlayer.threePct,
          ft_pct: leaderPlayer.ftPct,
          mpg: leaderPlayer.mpg,
        },
      }
    }
  } catch (err) {
    console.error('Failed to load player details:', err)
    showPlayerModal.value = false
  } finally {
    loadingPlayerFromLeaders.value = false
  }
}

function backToTeamModal() {
  showPlayerModal.value = false
  selectedPlayer.value = null
  playerModalOrigin.value = 'team'
}

function closeAllModals() {
  showPlayerModal.value = false
  showTeamModal.value = false
  selectedPlayer.value = null
  selectedTeam.value = null
  playerModalOrigin.value = 'team'
}

// Keyboard handler for modals
function handleKeydown(e) {
  if (e.key === 'Escape') {
    if (showPlayerModal.value) {
      backToTeamModal()
    } else if (showTeamModal.value) {
      closeTeamModal()
    }
  }
}

// Watch modal state for body overflow and keyboard
watch([showTeamModal, showPlayerModal], ([teamOpen, playerOpen]) => {
  if (teamOpen || playerOpen) {
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

// Helper functions
function getPositionColor(position) {
  const colors = { PG: '#3B82F6', SG: '#10B981', SF: '#F59E0B', PF: '#EF4444', C: '#8B5CF6' }
  return colors[position] || '#6B7280'
}

function getBadgeLevelColor(level) {
  const colors = { bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700', hof: '#9B59B6' }
  return colors[level] || '#6B7280'
}

function getAttrColor(value) {
  if (value >= 90) return 'var(--color-success)'
  if (value >= 80) return '#22D3EE'
  if (value >= 70) return 'var(--color-primary)'
  if (value >= 60) return 'var(--color-warning)'
  return 'var(--color-error)'
}

function formatGameDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatBadgeName(badgeId) {
  if (!badgeId) return ''
  return badgeId.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function formatAttrName(attrKey) {
  if (!attrKey) return ''
  return attrKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim()
}

function formatWeight(weight) {
  if (!weight) return '210'
  const w = parseInt(weight)
  if (w > 400) return Math.round(w / 10)
  return w
}

// Evolution history processing
const evolutionHistory = computed(() => {
  if (!selectedPlayer.value?.development_history) return []
  return selectedPlayer.value.development_history || []
})

// Get date 7 days ago for filtering recent evolution (using in-game date)
const sevenDaysAgo = computed(() => {
  const currentDateStr = campaign.value?.current_date || new Date().toISOString().split('T')[0]
  const [y, m, d] = currentDateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - 7)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
})

// Aggregate evolution by attribute (category.attribute as key)
function aggregateEvolution(history) {
  const aggregated = {}
  for (const entry of history) {
    const key = `${entry.category}.${entry.attribute}`
    if (!aggregated[key]) {
      aggregated[key] = {
        category: entry.category,
        attribute: entry.attribute,
        totalChange: 0,
        count: 0,
      }
    }
    aggregated[key].totalChange += entry.change
    aggregated[key].count++
  }
  // Convert to array and sort by total change (descending by absolute value, positive first)
  return Object.values(aggregated)
    .sort((a, b) => {
      // Positive changes first, then by absolute value
      if (a.totalChange > 0 && b.totalChange <= 0) return -1
      if (a.totalChange <= 0 && b.totalChange > 0) return 1
      return Math.abs(b.totalChange) - Math.abs(a.totalChange)
    })
}

// Recent evolution (last 7 days)
const recentEvolution = computed(() => {
  const recent = evolutionHistory.value.filter(e => e.date >= sevenDaysAgo.value)
  return aggregateEvolution(recent)
})

// All-time evolution
const allTimeEvolution = computed(() => {
  return aggregateEvolution(evolutionHistory.value)
})

// Recent performances for player modal (reversed so most recent first)
const playerRecentPerformances = computed(() => {
  if (!selectedPlayer.value) return []
  const perfs = selectedPlayer.value.recent_performances || selectedPlayer.value.recentPerformances || []
  return [...perfs].reverse()
})

// Format category name for display
function formatCategoryName(category) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

// Get color for evolution change
function getEvolutionColor(change) {
  if (change > 0) return '#22c55e' // green
  if (change < 0) return '#ef4444' // red
  return '#6b7280' // gray
}

// Format change with sign
function formatChange(change) {
  const rounded = Math.round(change * 10) / 10
  return change > 0 ? `+${rounded}` : `${rounded}`
}

function formatSalary(salary) {
  if (!salary) return '-'
  if (salary >= 1000000) {
    return `$${(salary / 1000000).toFixed(1)}M`
  }
  return `$${(salary / 1000).toFixed(0)}K`
}
</script>

<template>
  <div class="league-view p-6">
    <!-- Loading -->
    <div v-if="loading" class="page-loading-container">
      <LoadingSpinner size="md" />
    </div>

    <template v-else>
      <!-- Page Title -->
      <div class="league-title-block">
        <p class="league-subtitle">Across the</p>
        <h1 class="league-title">League</h1>
      </div>

      <!-- Header Row: Tabs/Filters + Games Remaining -->
      <div class="league-header-row">
        <!-- Left Column: Tabs & Filters -->
        <div class="league-controls">
          <!-- Tab Navigation -->
          <div class="league-tabs">
            <button
              class="tab-btn"
              :class="{ active: activeTab === 'standings' }"
              @click="activeTab = 'standings'"
            >
              Standings
            </button>
            <button
              class="tab-btn"
              :class="{ active: activeTab === 'games' }"
              @click="activeTab = 'games'"
            >
              Games
            </button>
            <button
              class="tab-btn"
              :class="{ active: activeTab === 'leaders' }"
              @click="activeTab = 'leaders'"
            >
              League Leaders
            </button>
          </div>

          <!-- Conference Toggle (shown for standings & leaders) -->
          <div v-if="activeTab === 'standings' || activeTab === 'leaders'" class="league-conf-filters">
            <button
              class="conf-btn"
              :class="{ active: activeConference === null }"
              @click="activeConference = null"
            >
              Both
            </button>
            <button
              class="conf-btn"
              :class="{ active: activeConference === 'east' }"
              @click="activeConference = 'east'"
            >
              Eastern
            </button>
            <button
              class="conf-btn"
              :class="{ active: activeConference === 'west' }"
              @click="activeConference = 'west'"
            >
              Western
            </button>
          </div>
        </div>

        <!-- Right Column: Season Card -->
        <div class="season-card">
          <div class="season-card-header">Regular Season</div>
          <div class="season-year">{{ formattedSeasonYear }}</div>
          <div class="season-progress">
            <div class="season-progress-bar" :style="{ width: `${seasonProgressPercent}%` }"></div>
          </div>
          <div class="season-stats">
            <span>{{ userGamesPlayed }} played</span>
            <span>{{ totalSeasonGames - userGamesPlayed }} left</span>
          </div>
        </div>
      </div>

      <!-- Standings View -->
      <template v-if="activeTab === 'standings'">

        <!-- Standings Table -->
        <GlassCard padding="none" :hoverable="false">
          <div class="table-container">
            <table class="standings-table">
              <thead>
                <tr>
                  <th class="rank-col">#</th>
                  <th class="team-col">Team</th>
                  <th class="stat-col">W</th>
                  <th class="stat-col">L</th>
                  <th class="stat-col">PCT</th>
                  <th class="stat-col">GB</th>
                  <th class="stat-col">HOME</th>
                  <th class="stat-col">AWAY</th>
                  <th class="stat-col">STRK</th>
                  <th class="stat-col">L10</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(standing, index) in activeStandings"
                  :key="standing.teamId"
                  class="standing-row clickable"
                  :class="{ 'user-team': isUserTeam(standing.teamId), 'playoff-line': activeConference !== null && index === 7 }"
                  @click="openTeamModal(standing)"
                >
                  <td class="rank-col">{{ index + 1 }}</td>
                  <td class="team-col">
                    <div class="team-info">
                      <div
                        class="team-logo"
                        :style="{ backgroundColor: standing.team?.primary_color || '#6B7280' }"
                      >
                        {{ standing.team?.abbreviation || '?' }}
                      </div>
                      <span class="team-name">{{ standing.team?.name || 'Unknown' }}</span>
                    </div>
                  </td>
                  <td class="stat-col wins">{{ standing.wins }}</td>
                  <td class="stat-col losses">{{ standing.losses }}</td>
                  <td class="stat-col">{{ getWinPercentage(standing.wins, standing.losses) }}</td>
                  <td class="stat-col gb">{{ getGamesBehind(standing, activeStandings) }}</td>
                  <td class="stat-col">{{ standing.homeRecord || '0-0' }}</td>
                  <td class="stat-col">{{ standing.awayRecord || '0-0' }}</td>
                  <td class="stat-col" :class="getStreakClass(standing.streak)">
                    {{ standing.streak || '-' }}
                  </td>
                  <td class="stat-col">{{ standing.lastTen || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </GlassCard>

        <!-- Playoff Picture -->
        <div class="grid gap-6 mt-6" :class="activeConference ? '' : 'md:grid-cols-2'">
          <GlassCard v-if="activeConference !== 'west'" padding="lg" :hoverable="false">
            <h3 class="h4 mb-4">Eastern Conference Playoff Picture</h3>
            <div class="playoff-bracket">
              <div
                v-for="(standing, index) in eastStandings.slice(0, 8)"
                :key="standing.teamId"
                class="playoff-team"
                :class="{ 'user-team': isUserTeam(standing.teamId) }"
              >
                <span class="seed">{{ index + 1 }}</span>
                <span class="team-abbr">{{ standing.team?.abbreviation }}</span>
                <span class="record">{{ standing.wins }}-{{ standing.losses }}</span>
              </div>
            </div>
          </GlassCard>

          <GlassCard v-if="activeConference !== 'east'" padding="lg" :hoverable="false">
            <h3 class="h4 mb-4">Western Conference Playoff Picture</h3>
            <div class="playoff-bracket">
              <div
                v-for="(standing, index) in westStandings.slice(0, 8)"
                :key="standing.teamId"
                class="playoff-team"
                :class="{ 'user-team': isUserTeam(standing.teamId) }"
              >
                <span class="seed">{{ index + 1 }}</span>
                <span class="team-abbr">{{ standing.team?.abbreviation }}</span>
                <span class="record">{{ standing.wins }}-{{ standing.losses }}</span>
              </div>
            </div>
          </GlassCard>
        </div>
      </template>

      <!-- Games View -->
      <template v-else-if="activeTab === 'games'">
        <div class="grid md:grid-cols-2 gap-6">
          <!-- Recent Games -->
          <GlassCard padding="lg" :hoverable="false">
            <h3 class="h4 mb-4">Recent Results</h3>
            <div v-if="recentGames.length === 0" class="text-secondary">
              No games played yet.
            </div>
            <div v-else class="space-y-3">
              <div
                v-for="game in recentGames"
                :key="game.id"
                class="game-card completed"
                @click="navigateToGame(game.id)"
              >
                <div class="game-date">{{ formatDate(game.game_date) }}</div>
                <div class="game-matchup">
                  <div class="game-team" :class="{ winner: game.away_score > game.home_score }">
                    <span class="team-abbr">{{ game.away_team?.abbreviation }}</span>
                    <span class="team-score">{{ game.away_score }}</span>
                  </div>
                  <span class="at-symbol">@</span>
                  <div class="game-team" :class="{ winner: game.home_score > game.away_score }">
                    <span class="team-abbr">{{ game.home_team?.abbreviation }}</span>
                    <span class="team-score">{{ game.home_score }}</span>
                  </div>
                </div>
                <div class="game-status">Final</div>
              </div>
            </div>
          </GlassCard>

          <!-- Upcoming Games -->
          <GlassCard padding="lg" :hoverable="false">
            <h3 class="h4 mb-4">Upcoming Games</h3>
            <div v-if="upcomingGames.length === 0" class="text-secondary">
              No upcoming games scheduled.
            </div>
            <div v-else class="space-y-3">
              <div
                v-for="game in upcomingGames"
                :key="game.id"
                class="game-card upcoming"
                :class="{ 'user-game': game.is_user_game }"
                @click="navigateToGame(game.id)"
              >
                <div class="game-date">{{ formatDate(game.game_date) }}</div>
                <div class="game-matchup">
                  <div class="game-team">
                    <span class="team-abbr">{{ game.away_team?.abbreviation }}</span>
                  </div>
                  <span class="at-symbol">@</span>
                  <div class="game-team">
                    <span class="team-abbr">{{ game.home_team?.abbreviation }}</span>
                  </div>
                </div>
                <div v-if="game.is_user_game" class="game-badge">Your Game</div>
              </div>
            </div>
          </GlassCard>
        </div>
      </template>

      <!-- League Leaders View -->
      <template v-else-if="activeTab === 'leaders'">
        <GlassCard padding="none" :hoverable="false">
          <div class="leaders-header">
            <h3 class="h4">{{ activeConference === null ? 'League' : (activeConference === 'east' ? 'Eastern Conference' : 'Western Conference') }} Leaders</h3>
            <p class="text-secondary text-sm">Click column headers to sort</p>
          </div>

          <!-- Loading state -->
          <div v-if="leagueStore.loadingLeaders" class="loading-state opacity-60">
            <LoadingSpinner size="md" />
          </div>

          <!-- Leaders Table -->
          <div v-else class="table-container">
            <table class="leaders-table">
              <thead>
                <tr>
                  <th class="rank-col">#</th>
                  <th
                    v-for="col in leaderColumns"
                    :key="col.key"
                    :class="[col.class, 'sortable', { active: leadersSortColumn === col.key }]"
                    @click="sortLeadersBy(col.key)"
                  >
                    {{ col.label }}{{ getLeadersSortIcon(col.key) }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(player, index) in sortedLeaders"
                  :key="player.playerId"
                  class="leader-row-table clickable"
                  :class="{ 'user-team': isUserTeam(player.teamId) }"
                  @click="openPlayerFromLeaders(player)"
                >
                  <td class="rank-col">{{ index + 1 }}</td>
                  <td class="player-col">
                    <div class="player-info-cell">
                      <span class="player-name">{{ player.name }}</span>
                    </div>
                  </td>
                  <td class="team-col-sm">
                    <div class="team-cell">
                      <div
                        class="team-logo-mini"
                        :style="{ backgroundColor: player.teamColor || '#6B7280' }"
                      >
                        {{ player.teamAbbreviation }}
                      </div>
                    </div>
                  </td>
                  <td class="stat-col">{{ player.gamesPlayed || 0 }}</td>
                  <td class="stat-col highlight">{{ player.ppg?.toFixed(1) || '0.0' }}</td>
                  <td class="stat-col">{{ player.rpg?.toFixed(1) || '0.0' }}</td>
                  <td class="stat-col">{{ player.apg?.toFixed(1) || '0.0' }}</td>
                  <td class="stat-col">{{ player.spg?.toFixed(1) || '0.0' }}</td>
                  <td class="stat-col">{{ player.bpg?.toFixed(1) || '0.0' }}</td>
                  <td class="stat-col turnover">{{ player.topg?.toFixed(1) || '0.0' }}</td>
                  <td class="stat-col">{{ player.fgPct?.toFixed(1) || '0.0' }}%</td>
                  <td class="stat-col">{{ player.threePct?.toFixed(1) || '0.0' }}%</td>
                  <td class="stat-col">{{ player.ftPct?.toFixed(1) || '0.0' }}%</td>
                </tr>
              </tbody>
            </table>

            <!-- Empty state -->
            <div v-if="sortedLeaders.length === 0 && !leagueStore.loadingLeaders" class="empty-state">
              <p>No stats available yet.</p>
              <p class="text-sm text-secondary">Play some games to see league leaders.</p>
            </div>
          </div>
        </GlassCard>
      </template>
    </template>

    <!-- Team Details Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showTeamModal && !showPlayerModal"
          class="team-modal-overlay"
          @click.self="closeTeamModal"
        >
          <div class="team-modal-container">
            <!-- Header -->
            <header class="team-modal-header-bar">
              <h2 class="team-modal-title">Team Details</h2>
              <button class="modal-btn-close" @click="closeTeamModal" aria-label="Close">
                <X :size="20" />
              </button>
            </header>

            <!-- Content -->
            <main v-if="selectedTeam" class="team-modal-body">
              <!-- Team Card - Cosmic Style -->
              <div class="team-card-cosmic">
                <div class="team-badge-lg" :style="{ backgroundColor: selectedTeam.team?.primary_color || '#666' }">
                  {{ selectedTeam.team?.abbreviation }}
                </div>
                <div class="team-card-info">
                  <h3 class="team-card-name">{{ selectedTeam.team?.name }}</h3>
                  <div class="team-card-record">{{ selectedTeam.wins }}-{{ selectedTeam.losses }}</div>
                </div>
              </div>

              <!-- Quick Stats -->
              <div class="team-quick-stats">
                <div class="quick-stat-item">
                  <span class="quick-stat-value">{{ selectedTeam.homeRecord || '0-0' }}</span>
                  <span class="quick-stat-label">Home</span>
                </div>
                <div class="quick-stat-divider"></div>
                <div class="quick-stat-item">
                  <span class="quick-stat-value">{{ selectedTeam.awayRecord || '0-0' }}</span>
                  <span class="quick-stat-label">Away</span>
                </div>
                <div class="quick-stat-divider"></div>
                <div class="quick-stat-item">
                  <span class="quick-stat-value" :class="getStreakClass(selectedTeam.streak)">{{ selectedTeam.streak || '-' }}</span>
                  <span class="quick-stat-label">Streak</span>
                </div>
              </div>

              <!-- Roster Section -->
              <div class="roster-section-new">
                <h4 class="roster-section-header">ROSTER</h4>

                <div v-if="loadingTeamRoster" class="modal-loading-state">
                  <LoadingSpinner size="md" />
                  <span>Loading roster...</span>
                </div>

                <div v-else class="roster-list-new">
                  <div
                    v-for="player in selectedTeamRoster"
                    :key="player.id"
                    class="roster-player-row"
                    :class="{ injured: player.is_injured || player.isInjured }"
                    @click="openPlayerFromTeam(player)"
                  >
                    <div class="roster-player-main">
                      <div class="roster-player-rating">
                        <StatBadge :value="player.overall_rating" size="sm" />
                        <span v-if="player.is_injured || player.isInjured" class="roster-injury-badge">INJ</span>
                      </div>
                      <div class="roster-player-info">
                        <span class="roster-player-name" :class="{ 'injured-text': player.is_injured || player.isInjured }">
                          {{ player.name }}
                        </span>
                        <div class="roster-player-meta">
                          <span class="roster-position-tag" :style="{ backgroundColor: getPositionColor(player.position) }">
                            {{ player.position }}<template v-if="player.secondary_position">/{{ player.secondary_position }}</template>
                          </span>
                          <span class="roster-jersey">#{{ player.jersey_number || '00' }}</span>
                        </div>
                      </div>
                    </div>
                    <div class="roster-player-stats">
                      <template v-if="player.season_stats && !(player.is_injured || player.isInjured)">
                        <span class="roster-stat">{{ player.season_stats.ppg }} <small>PPG</small></span>
                        <span class="roster-stat">{{ player.season_stats.rpg }} <small>RPG</small></span>
                        <span class="roster-stat">{{ player.season_stats.apg }} <small>APG</small></span>
                      </template>
                      <span v-else-if="player.is_injured || player.isInjured" class="roster-injury-text">Injured</span>
                      <span v-else class="roster-no-stats">-</span>
                    </div>
                    <div class="roster-chevron">&rsaquo;</div>
                  </div>
                </div>
              </div>
            </main>

            <!-- Footer -->
            <footer class="team-modal-footer">
              <button class="modal-btn-secondary" @click="closeTeamModal">Close</button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Player Details Modal (from Team View) -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showPlayerModal"
          class="player-modal-overlay"
          @click.self="closeAllModals"
        >
          <div class="player-modal-container">
            <!-- Header with Back Button -->
            <header class="player-modal-header-bar">
              <button class="modal-back-btn" @click="backToTeamModal">
                <ChevronLeft :size="20" />
                <span>{{ playerModalOrigin === 'leaders' ? 'League Leaders' : selectedTeam?.team?.name }}</span>
              </button>
              <button class="modal-btn-close" @click="closeAllModals" aria-label="Close">
                <X :size="20" />
              </button>
            </header>

            <!-- Loading state for leaders -->
            <main v-if="loadingPlayerFromLeaders" class="player-modal-body" style="display: flex; align-items: center; justify-content: center; min-height: 200px;">
              <LoadingSpinner size="md" />
            </main>

            <!-- Content -->
            <main v-else-if="selectedPlayer" class="player-modal-body">
              <!-- Player Card - Cosmic Style -->
              <div class="player-card-cosmic" :class="{ injured: selectedPlayer.is_injured || selectedPlayer.isInjured }">
                <div class="player-card-rating">
                  <StatBadge :value="selectedPlayer.overall_rating" size="lg" />
                  <span v-if="selectedPlayer.is_injured || selectedPlayer.isInjured" class="player-card-injury">INJ</span>
                </div>
                <div class="player-card-info">
                  <h3 class="player-card-name" :class="{ 'injured-text': selectedPlayer.is_injured || selectedPlayer.isInjured }">
                    {{ selectedPlayer.name }}
                  </h3>
                  <div class="player-card-meta">
                    <span class="player-card-position" :style="{ backgroundColor: getPositionColor(selectedPlayer.position) }">
                      {{ selectedPlayer.position }}
                    </span>
                    <span v-if="selectedPlayer.secondary_position" class="player-card-position secondary">
                      {{ selectedPlayer.secondary_position }}
                    </span>
                    <span class="player-card-jersey">#{{ selectedPlayer.jersey_number || '00' }}</span>
                  </div>
                  <div class="player-card-bio">
                    {{ selectedPlayer.height || "6'6\"" }} · {{ formatWeight(selectedPlayer.weight) }} lbs · Age {{ selectedPlayer.age || 25 }}
                  </div>
                </div>
              </div>

              <!-- Badges (if any) -->
              <div v-if="selectedPlayer.badges?.length > 0" class="player-badges-section">
                <div class="player-badges-list">
                  <div
                    v-for="badge in (showAllBadges ? selectedPlayer.badges : selectedPlayer.badges.slice(0, 5))"
                    :key="badge.id"
                    class="player-badge-item"
                    :style="{ borderColor: getBadgeLevelColor(badge.level) }"
                  >
                    <span class="player-badge-level" :style="{ backgroundColor: getBadgeLevelColor(badge.level) }">
                      {{ badge.level?.toUpperCase() }}
                    </span>
                    <span class="player-badge-name">{{ formatBadgeName(badge.id) }}</span>
                  </div>
                  <button
                    v-if="selectedPlayer.badges.length > 5"
                    class="player-badges-toggle"
                    @click="showAllBadges = !showAllBadges"
                  >
                    {{ showAllBadges ? 'Show Less' : `+${selectedPlayer.badges.length - 5} more` }}
                  </button>
                </div>
              </div>

              <!-- Tab Navigation -->
              <div class="player-tabs">
                <button
                  class="player-tab"
                  :class="{ active: playerModalTab === 'stats' }"
                  @click="playerModalTab = 'stats'"
                >
                  Stats
                </button>
                <button
                  class="player-tab"
                  :class="{ active: playerModalTab === 'attributes' }"
                  @click="playerModalTab = 'attributes'"
                >
                  Attributes
                </button>
                <button
                  class="player-tab"
                  :class="{ active: playerModalTab === 'history' }"
                  @click="playerModalTab = 'history'"
                >
                  History
                </button>
              </div>

              <!-- Tab Content -->
              <div class="player-tab-content">
                <!-- Stats Tab -->
                <div v-if="playerModalTab === 'stats'" class="player-tab-panel">
                  <template v-if="selectedPlayer.season_stats">
                    <div class="player-stats-card">
                      <div class="player-stats-grid">
                        <div class="player-stat-cell">
                          <span class="player-stat-value highlight">{{ selectedPlayer.season_stats.ppg }}</span>
                          <span class="player-stat-label">PPG</span>
                        </div>
                        <div class="player-stat-cell">
                          <span class="player-stat-value">{{ selectedPlayer.season_stats.rpg }}</span>
                          <span class="player-stat-label">RPG</span>
                        </div>
                        <div class="player-stat-cell">
                          <span class="player-stat-value">{{ selectedPlayer.season_stats.apg }}</span>
                          <span class="player-stat-label">APG</span>
                        </div>
                        <div class="player-stat-cell">
                          <span class="player-stat-value">{{ selectedPlayer.season_stats.spg }}</span>
                          <span class="player-stat-label">SPG</span>
                        </div>
                        <div class="player-stat-cell">
                          <span class="player-stat-value">{{ selectedPlayer.season_stats.bpg }}</span>
                          <span class="player-stat-label">BPG</span>
                        </div>
                        <div class="player-stat-cell">
                          <span class="player-stat-value">{{ selectedPlayer.season_stats.fg_pct }}%</span>
                          <span class="player-stat-label">FG%</span>
                        </div>
                        <div class="player-stat-cell">
                          <span class="player-stat-value">{{ selectedPlayer.season_stats.three_pct }}%</span>
                          <span class="player-stat-label">3P%</span>
                        </div>
                        <div class="player-stat-cell">
                          <span class="player-stat-value">{{ selectedPlayer.season_stats.ft_pct }}%</span>
                          <span class="player-stat-label">FT%</span>
                        </div>
                        <div class="player-stat-cell">
                          <span class="player-stat-value">{{ selectedPlayer.season_stats.mpg }}</span>
                          <span class="player-stat-label">MPG</span>
                        </div>
                        <div class="player-stat-cell">
                          <span class="player-stat-value">{{ selectedPlayer.season_stats.games_played }}</span>
                          <span class="player-stat-label">GP</span>
                        </div>
                      </div>
                    </div>
                    <!-- Recent Games (Game Log) -->
                    <div v-if="playerRecentPerformances?.length > 0" class="recent-performances-section">
                      <h4 class="recent-performances-title">Recent Games</h4>
                      <div class="game-log-table-wrap">
                        <table class="game-log-table">
                          <thead>
                            <tr>
                              <th>Date</th><th>OPP</th><th>Result</th>
                              <th>MIN</th><th>PTS</th><th>REB</th><th>AST</th>
                              <th>STL</th><th>BLK</th><th>TO</th>
                              <th>FG</th><th>3P</th><th>FT</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="(game, i) in playerRecentPerformances" :key="i">
                              <td class="game-log-date">{{ typeof game === 'object' ? formatGameDate(game.date) : '—' }}</td>
                              <td class="game-log-opp">{{ typeof game === 'object' ? game.opponent : '—' }}</td>
                              <td :class="typeof game === 'object' && game.won ? 'game-log-win' : 'game-log-loss'">
                                {{ typeof game === 'object' ? (game.won ? 'W' : 'L') : '—' }}
                              </td>
                              <td>{{ typeof game === 'object' ? game.min : '—' }}</td>
                              <td class="game-log-pts">{{ typeof game === 'object' ? game.pts : Math.round(game) }}</td>
                              <td>{{ typeof game === 'object' ? game.reb : '—' }}</td>
                              <td>{{ typeof game === 'object' ? game.ast : '—' }}</td>
                              <td>{{ typeof game === 'object' ? game.stl : '—' }}</td>
                              <td>{{ typeof game === 'object' ? game.blk : '—' }}</td>
                              <td>{{ typeof game === 'object' ? game.to : '—' }}</td>
                              <td>{{ typeof game === 'object' ? `${game.fgm}-${game.fga}` : '—' }}</td>
                              <td>{{ typeof game === 'object' ? `${game.tpm}-${game.tpa}` : '—' }}</td>
                              <td>{{ typeof game === 'object' ? `${game.ftm}-${game.fta}` : '—' }}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </template>
                  <div v-else class="player-empty-state">
                    <p>No stats available yet</p>
                    <span>Play some games to see this player's stats</span>
                  </div>
                </div>

                <!-- Attributes Tab -->
                <div v-if="playerModalTab === 'attributes'" class="player-tab-panel">
                  <!-- Offensive Attributes -->
                  <div v-if="selectedPlayer.attributes?.offense" class="player-attr-card">
                    <h4 class="player-attr-title">Offense</h4>
                    <div class="player-attr-list">
                      <div v-for="(value, key) in selectedPlayer.attributes.offense" :key="key" class="player-attr-row">
                        <span class="player-attr-name">{{ formatAttrName(key) }}</span>
                        <div class="player-attr-bar-wrap">
                          <div class="player-attr-bar" :style="{ width: `${Math.round(value)}%`, backgroundColor: getAttrColor(value) }"></div>
                        </div>
                        <span class="player-attr-value" :style="{ color: getAttrColor(value) }">{{ Math.round(value) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Defensive Attributes -->
                  <div v-if="selectedPlayer.attributes?.defense" class="player-attr-card">
                    <h4 class="player-attr-title">Defense</h4>
                    <div class="player-attr-list">
                      <div v-for="(value, key) in selectedPlayer.attributes.defense" :key="key" class="player-attr-row">
                        <span class="player-attr-name">{{ formatAttrName(key) }}</span>
                        <div class="player-attr-bar-wrap">
                          <div class="player-attr-bar" :style="{ width: `${Math.round(value)}%`, backgroundColor: getAttrColor(value) }"></div>
                        </div>
                        <span class="player-attr-value" :style="{ color: getAttrColor(value) }">{{ Math.round(value) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Physical Attributes -->
                  <div v-if="selectedPlayer.attributes?.physical" class="player-attr-card">
                    <h4 class="player-attr-title">Physical</h4>
                    <div class="player-attr-list">
                      <div v-for="(value, key) in selectedPlayer.attributes.physical" :key="key" class="player-attr-row">
                        <span class="player-attr-name">{{ formatAttrName(key) }}</span>
                        <div class="player-attr-bar-wrap">
                          <div class="player-attr-bar" :style="{ width: `${Math.round(value)}%`, backgroundColor: getAttrColor(value) }"></div>
                        </div>
                        <span class="player-attr-value" :style="{ color: getAttrColor(value) }">{{ Math.round(value) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Mental Attributes -->
                  <div v-if="selectedPlayer.attributes?.mental" class="player-attr-card">
                    <h4 class="player-attr-title">Mental</h4>
                    <div class="player-attr-list">
                      <div v-for="(value, key) in selectedPlayer.attributes.mental" :key="key" class="player-attr-row">
                        <span class="player-attr-name">{{ formatAttrName(key) }}</span>
                        <div class="player-attr-bar-wrap">
                          <div class="player-attr-bar" :style="{ width: `${Math.round(value)}%`, backgroundColor: getAttrColor(value) }"></div>
                        </div>
                        <span class="player-attr-value" :style="{ color: getAttrColor(value) }">{{ Math.round(value) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Evolution Section -->
                  <div class="player-evolution-section">
                    <h4 class="player-attr-title">Season Evolution</h4>

                    <!-- Recent Evolution -->
                    <div class="player-evolution-group">
                      <h5 class="player-evolution-label">Recent (Last 7 Days)</h5>
                      <div v-if="recentEvolution.length > 0" class="player-evolution-list">
                        <div
                          v-for="item in (showAllRecentEvolution ? recentEvolution : recentEvolution.slice(0, 10))"
                          :key="`recent-${item.category}-${item.attribute}`"
                          class="player-evolution-item"
                        >
                          <span class="player-evolution-cat">{{ formatCategoryName(item.category) }}</span>
                          <span class="player-evolution-attr">{{ formatAttrName(item.attribute) }}</span>
                          <span class="player-evolution-change" :style="{ color: getEvolutionColor(item.totalChange) }">
                            {{ formatChange(item.totalChange) }}
                          </span>
                        </div>
                        <button
                          v-if="recentEvolution.length > 10"
                          class="player-evolution-toggle"
                          @click="showAllRecentEvolution = !showAllRecentEvolution"
                        >
                          {{ showAllRecentEvolution ? 'Show Less' : `Show All (${recentEvolution.length})` }}
                        </button>
                      </div>
                      <div v-else class="player-evolution-empty">No recent activity</div>
                    </div>

                    <!-- All-Time Evolution -->
                    <div class="player-evolution-group">
                      <button class="player-evolution-expand" @click="showAllTimeExpanded = !showAllTimeExpanded">
                        <h5 class="player-evolution-label">All-Time</h5>
                        <span>{{ showAllTimeExpanded ? '▼' : '▶' }}</span>
                      </button>
                      <div v-if="showAllTimeExpanded" class="player-evolution-list">
                        <template v-if="allTimeEvolution.length > 0">
                          <div
                            v-for="item in (showAllTimeEvolution ? allTimeEvolution : allTimeEvolution.slice(0, 10))"
                            :key="`alltime-${item.category}-${item.attribute}`"
                            class="player-evolution-item"
                          >
                            <span class="player-evolution-cat">{{ formatCategoryName(item.category) }}</span>
                            <span class="player-evolution-attr">{{ formatAttrName(item.attribute) }}</span>
                            <span class="player-evolution-change" :style="{ color: getEvolutionColor(item.totalChange) }">
                              {{ formatChange(item.totalChange) }}
                            </span>
                            <span class="player-evolution-count">({{ item.count }}x)</span>
                          </div>
                          <button
                            v-if="allTimeEvolution.length > 10"
                            class="player-evolution-toggle"
                            @click="showAllTimeEvolution = !showAllTimeEvolution"
                          >
                            {{ showAllTimeEvolution ? 'Show Less' : `Show All (${allTimeEvolution.length})` }}
                          </button>
                        </template>
                        <div v-else class="player-evolution-empty">No history available</div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- History Tab -->
                <div v-if="playerModalTab === 'history'" class="player-tab-panel">
                  <!-- Draft Info -->
                  <div v-if="selectedPlayer.draftInfo" class="player-history-section">
                    <div class="draft-info-card">
                      <span class="draft-info-pick">#{{ selectedPlayer.draftInfo.pick }}</span>
                      <div class="draft-info-details">
                        <span class="draft-info-label">
                          Round {{ selectedPlayer.draftInfo.round }}, Pick {{ selectedPlayer.draftInfo.pick }}
                          <template v-if="selectedPlayer.draftInfo.year"> &middot; {{ selectedPlayer.draftInfo.year }}</template>
                        </span>
                        <span class="draft-info-team">Drafted by {{ selectedPlayer.draftInfo.teamAbbreviation }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Season Stats -->
                  <div class="player-history-section">
                    <h4 class="player-attr-title">Season Stats</h4>
                    <div v-if="seasonStatsRows.length > 0" class="game-log-table-wrap">
                      <table class="game-log-table season-history-table">
                        <thead>
                          <tr>
                            <th>Year</th><th>Team</th><th>GP</th>
                            <th>PPG</th><th>RPG</th><th>APG</th>
                            <th>SPG</th><th>BPG</th><th>FG%</th>
                            <th>3P%</th><th>FT%</th><th>MPG</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="row in seasonStatsRows" :key="row.year" :class="{ 'current-season-row': row.isCurrent }">
                            <td class="season-year-cell">
                              {{ row.year }}<span v-if="row.isCurrent" class="current-tag">*</span>
                            </td>
                            <td>{{ row.team }}</td>
                            <td>{{ row.gp }}</td>
                            <td class="game-log-pts">{{ row.ppg }}</td>
                            <td>{{ row.rpg }}</td>
                            <td>{{ row.apg }}</td>
                            <td>{{ row.spg }}</td>
                            <td>{{ row.bpg }}</td>
                            <td>{{ row.fg_pct }}%</td>
                            <td>{{ row.three_pct }}%</td>
                            <td>{{ row.ft_pct }}%</td>
                            <td>{{ row.mpg }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div v-else class="player-empty-state">
                      <p>No season stats yet</p>
                    </div>
                  </div>

                  <!-- Awards -->
                  <div class="player-history-section">
                    <h4 class="player-attr-title">Awards</h4>
                    <div v-if="selectedPlayer.championships || selectedPlayer.mvp_awards || selectedPlayer.mvpAwards || selectedPlayer.finals_mvp_awards || selectedPlayer.finalsMvpAwards || selectedPlayer.conference_finals_mvp_awards || selectedPlayer.conferenceFinalsMvpAwards || selectedPlayer.all_star_selections || selectedPlayer.allStarSelections || selectedPlayer.rookie_of_the_year || selectedPlayer.rookieOfTheYear || selectedPlayer.all_nba_selections || selectedPlayer.allNbaSelections || selectedPlayer.all_rookie_team || selectedPlayer.allRookieTeam || selectedPlayer.all_defensive_team || selectedPlayer.allDefensiveTeam" class="player-awards-grid">
                      <span v-if="(selectedPlayer.championships || 0) > 0" class="player-award-item gold">
                        {{ selectedPlayer.championships }}x Champion
                      </span>
                      <span v-if="(selectedPlayer.finals_mvp_awards || selectedPlayer.finalsMvpAwards || 0) > 0" class="player-award-item gold">
                        {{ selectedPlayer.finals_mvp_awards || selectedPlayer.finalsMvpAwards }}x Finals MVP
                      </span>
                      <span v-if="(selectedPlayer.conference_finals_mvp_awards || selectedPlayer.conferenceFinalsMvpAwards || 0) > 0" class="player-award-item silver">
                        {{ selectedPlayer.conference_finals_mvp_awards || selectedPlayer.conferenceFinalsMvpAwards }}x Conf Finals MVP
                      </span>
                      <span v-if="(selectedPlayer.mvp_awards || selectedPlayer.mvpAwards || 0) > 0" class="player-award-item gold">
                        {{ selectedPlayer.mvp_awards || selectedPlayer.mvpAwards }}x League MVP
                      </span>
                      <span v-if="(selectedPlayer.all_star_selections || selectedPlayer.allStarSelections || 0) > 0" class="player-award-item">
                        {{ selectedPlayer.all_star_selections || selectedPlayer.allStarSelections }}x All-Star
                      </span>
                      <span v-if="(selectedPlayer.rookie_of_the_year || selectedPlayer.rookieOfTheYear || 0) > 0" class="player-award-item gold">
                        {{ selectedPlayer.rookie_of_the_year || selectedPlayer.rookieOfTheYear }}x ROTY
                      </span>
                      <span v-if="(selectedPlayer.all_nba_selections || selectedPlayer.allNbaSelections || 0) > 0" class="player-award-item silver">
                        {{ selectedPlayer.all_nba_selections || selectedPlayer.allNbaSelections }}x All-NBA
                      </span>
                      <span v-if="(selectedPlayer.all_defensive_team || selectedPlayer.allDefensiveTeam || 0) > 0" class="player-award-item silver">
                        {{ selectedPlayer.all_defensive_team || selectedPlayer.allDefensiveTeam }}x All-Defense
                      </span>
                      <span v-if="(selectedPlayer.all_rookie_team || selectedPlayer.allRookieTeam || 0) > 0" class="player-award-item">
                        {{ selectedPlayer.all_rookie_team || selectedPlayer.allRookieTeam }}x All-Rookie
                      </span>
                    </div>
                    <div v-else class="player-empty-state">
                      <p>No awards yet</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Contract Info -->
              <div v-if="selectedPlayer.contract" class="player-contract-bar">
                <div class="player-contract-item">
                  <span class="player-contract-label">Salary</span>
                  <span class="player-contract-value success">{{ formatSalary(selectedPlayer.contract.salary) }}/yr</span>
                </div>
                <div class="player-contract-item">
                  <span class="player-contract-label">Years Left</span>
                  <span class="player-contract-value">{{ selectedPlayer.contract.years_remaining }}</span>
                </div>
              </div>
            </main>

            <!-- Footer -->
            <footer class="player-modal-footer">
              <button class="modal-btn-secondary" @click="backToTeamModal">
                <ChevronLeft :size="16" />
                Back
              </button>
              <button class="modal-btn-primary" @click="closeAllModals">Done</button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.league-view {
  padding-bottom: 100px;
  max-width: 1024px;
  margin: 0 auto;
}

/* Remove padding-top on mobile when footer nav is showing */
@media (max-width: 1023px) {
  .league-view {
    padding-top: 0 !important;
  }
}

@media (min-width: 1024px) {
  .league-view {
    padding-bottom: 24px;
  }
}

/* Page Title Block - matches team name/city on campaign home */
.league-title-block {
  margin-bottom: 20px;
}

@media (min-width: 768px) {
  .league-title-block {
    margin-bottom: 0;
  }
}

.league-subtitle {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin: 0 0 2px 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.league-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2.25rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* Header Row: Controls + Games Remaining */
.league-header-row {
  display: flex;
  gap: 20px;
  margin-bottom: 24px;
  align-items: flex-start;
}

@media (min-width: 768px) {
  .league-header-row {
    align-items: center;
  }
}

.league-controls {
  flex: 3;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.league-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.league-conf-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Season Card */
.season-card {
  flex: 1;
  min-width: 160px;
  max-width: 180px;
  padding: 16px;
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-xl);
  text-align: center;
  position: relative;
  overflow: hidden;
}

.season-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 15% 25%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 35% 65%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 55% 15%, rgba(255,255,255,0.4), transparent),
    radial-gradient(1px 1px at 75% 45%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 85% 75%, rgba(255,255,255,0.4), transparent);
  pointer-events: none;
}

.season-card-header {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(26, 21, 32, 0.6);
  margin-bottom: 4px;
  position: relative;
  z-index: 1;
}

.season-year {
  font-size: 2rem;
  font-weight: 800;
  color: #1a1520;
  line-height: 1;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  position: relative;
  z-index: 1;
  margin-bottom: 8px;
}

.season-progress {
  height: 6px;
  background: rgba(26, 21, 32, 0.15);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
  position: relative;
  z-index: 1;
}

.season-progress-bar {
  height: 100%;
  background: rgba(26, 21, 32, 0.5);
  border-radius: 3px;
  transition: width 0.5s ease;
}

.season-stats {
  display: flex;
  justify-content: space-between;
  font-size: 0.65rem;
  color: rgba(26, 21, 32, 0.5);
  font-weight: 500;
  position: relative;
  z-index: 1;
}

/* Mobile: Stack header row */
@media (max-width: 768px) {
  .league-header-row {
    flex-direction: column;
  }

  .season-card {
    max-width: 100%;
    order: -1; /* Show at top on mobile */
  }

  .league-title {
    font-size: 1.75rem;
  }

  .league-subtitle {
    font-size: 0.75rem;
  }
}

.tab-btn {
  padding: 6px 14px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 0.8rem;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.tab-btn.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
  box-shadow: 0 2px 8px rgba(232, 90, 79, 0.3);
}

.conf-btn {
  padding: 8px 16px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 0.8rem;
}

.conf-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.conf-btn.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
  box-shadow: 0 2px 8px rgba(232, 90, 79, 0.3);
}

.table-container {
  overflow-x: auto;
}

.standings-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.standings-table th,
.standings-table td {
  padding: 8px 6px;
  text-align: center;
}

.standings-table th {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-secondary);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.rank-col {
  width: 40px;
}

.team-col {
  text-align: left !important;
  min-width: 200px;
}

.stat-col {
  min-width: 50px;
}

.standing-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.15s ease;
}

.standing-row:nth-child(even) {
  background: rgba(255, 255, 255, 0.02);
}

.standing-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.standing-row:nth-child(even):hover {
  background: rgba(255, 255, 255, 0.06);
}

.standing-row.user-team {
  background: rgba(232, 90, 79, 0.1);
}

.standing-row.user-team:hover {
  background: rgba(232, 90, 79, 0.15);
}

.standing-row.playoff-line {
  border-bottom: 2px solid var(--color-warning);
}

.team-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.team-logo {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
}

.team-logo.sm {
  width: 28px;
  height: 28px;
  font-size: 0.65rem;
}

.team-name {
  font-weight: 500;
}

.stat-col.wins {
  color: var(--color-success);
  font-weight: 600;
}

.stat-col.losses {
  color: var(--color-error);
}

.stat-col.gb {
  color: var(--color-secondary);
}

.streak-win {
  color: var(--color-success) !important;
  font-weight: 600;
}

.streak-loss {
  color: var(--color-error) !important;
}

.playoff-bracket {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.playoff-team {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-md);
  transition: all 0.15s ease;
}

.playoff-team:hover {
  background: rgba(255, 255, 255, 0.06);
}

.playoff-team.user-team {
  background: rgba(232, 90, 79, 0.12);
  border: 1px solid rgba(232, 90, 79, 0.4);
}

.playoff-team.user-team:hover {
  background: rgba(232, 90, 79, 0.18);
}

.playoff-team .seed {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
  border-radius: 50%;
  font-size: 0.7rem;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(232, 90, 79, 0.3);
}

.playoff-team .team-abbr {
  flex: 1;
  font-weight: 600;
  font-size: 0.875rem;
}

.playoff-team .record {
  color: var(--color-secondary);
  font-size: 0.8rem;
  font-weight: 500;
}

.game-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
}

.game-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
}

.game-card.user-game {
  border-color: rgba(232, 90, 79, 0.4);
  background: rgba(232, 90, 79, 0.08);
}

.game-card.user-game:hover {
  background: rgba(232, 90, 79, 0.12);
}

.game-date {
  font-size: 0.7rem;
  color: var(--color-secondary);
  min-width: 50px;
  font-weight: 500;
}

.game-matchup {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.game-team {
  display: flex;
  align-items: center;
  gap: 6px;
}

.game-team .team-abbr {
  font-weight: 600;
  font-size: 0.875rem;
}

.game-team .team-score {
  font-weight: 700;
  font-family: monospace;
  font-size: 0.9rem;
}

.game-team.winner .team-score {
  color: var(--color-success);
}

.at-symbol {
  color: var(--color-secondary);
  font-size: 0.75rem;
}

.game-status {
  font-size: 0.7rem;
  color: var(--color-secondary);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.game-badge {
  padding: 2px 6px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.leaders-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.leader-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.leader-row.user-team {
  background: rgba(232, 90, 79, 0.1);
}

/* League Leaders Table */
.leaders-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.leaders-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.leaders-table th,
.leaders-table td {
  padding: 8px 6px;
  text-align: center;
}

.leaders-table th {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-secondary);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.leaders-table th.sortable {
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.leaders-table th.sortable:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.leaders-table th.sortable.active {
  color: var(--color-primary);
  background: rgba(232, 90, 79, 0.1);
}

.leaders-table .player-col {
  text-align: left !important;
  min-width: 150px;
}

.leaders-table .team-col-sm {
  min-width: 50px;
}

.leaders-table .stat-col {
  min-width: 45px;
}

.leader-row-table {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.15s ease;
}

.leader-row-table.clickable {
  cursor: pointer;
}

.leader-row-table:nth-child(even) {
  background: rgba(255, 255, 255, 0.02);
}

.leader-row-table:hover {
  background: rgba(255, 255, 255, 0.05);
}

.leader-row-table:nth-child(even):hover {
  background: rgba(255, 255, 255, 0.06);
}

.leader-row-table.user-team {
  background: rgba(232, 90, 79, 0.1);
}

.leader-row-table.user-team:hover {
  background: rgba(232, 90, 79, 0.15);
}

.player-info-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.player-info-cell .player-name {
  font-weight: 500;
  white-space: nowrap;
}

.player-info-cell .player-pos {
  font-size: 0.7rem;
  color: var(--color-secondary);
}

.team-cell {
  display: flex;
  justify-content: center;
}

.team-logo-mini {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.55rem;
  font-weight: 700;
  color: white;
}

.leaders-table .stat-col.highlight {
  color: var(--color-primary);
  font-weight: 600;
}

.leaders-table .stat-col.turnover {
  color: var(--color-error);
}

.leader-rank {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  font-weight: 700;
  font-size: 0.875rem;
}

.leader-team {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.leader-stats {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.stat-main {
  font-weight: 700;
}

.stat-pct {
  font-size: 0.75rem;
  color: var(--color-secondary);
}

/* Clickable standings rows */
.standing-row.clickable {
  cursor: pointer;
}

.standing-row.clickable:hover {
  background: rgba(255, 255, 255, 0.08);
}

.standing-row.clickable.user-team:hover {
  background: rgba(232, 90, 79, 0.2);
}

/* Team Modal */
.team-modal-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.team-modal-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.team-logo-lg {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1.25rem;
  color: white;
}

.team-info-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.team-record {
  font-size: 1.5rem;
  font-weight: 700;
}

.team-stats-row {
  display: flex;
  gap: 16px;
  color: var(--color-secondary);
  font-size: 0.875rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.page-loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60vh;
}

.page-loading-container :deep(.loading-spinner) {
  width: 64px;
  height: 64px;
}

@media (min-width: 768px) {
  .page-loading-container :deep(.loading-spinner) {
    width: 80px;
    height: 80px;
  }
}

.loading-state {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

/* Roster List */
.roster-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.roster-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  min-height: 56px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.roster-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

.roster-row.injured {
  opacity: 0.7;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.roster-row.injured:hover {
  background: rgba(239, 68, 68, 0.12);
}

.rating-with-injury {
  position: relative;
  flex-shrink: 0;
}

.injury-indicator {
  position: absolute;
  bottom: -2px;
  right: -4px;
  padding: 1px 3px;
  background: var(--color-error);
  color: white;
  font-size: 0.5rem;
  font-weight: 700;
  border-radius: 3px;
  text-transform: uppercase;
}

.injured-name {
  color: var(--color-error);
  text-decoration: line-through;
  text-decoration-color: rgba(239, 68, 68, 0.5);
}

.injury-tag {
  padding: 2px 6px;
  background: var(--color-error);
  color: white;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
}

.injury-status {
  color: var(--color-error);
  font-weight: 600;
  font-size: 0.875rem;
}

/* Modal injury styles */
.injured-header {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05)) !important;
  border-radius: 10px;
  padding: 16px;
  margin: -16px -16px 0 -16px;
}

.rating-with-injury-lg {
  position: relative;
}

.injury-badge-lg {
  position: absolute;
  bottom: -4px;
  right: -4px;
  padding: 2px 5px;
  background: var(--color-error);
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  border-radius: 4px;
  text-transform: uppercase;
}

.player-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.player-identity {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.player-name {
  font-weight: 600;
}

.player-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
}

.jersey {
  color: var(--color-secondary);
}

.player-stats-compact {
  display: flex;
  gap: 12px;
  color: var(--color-secondary);
  font-size: 0.875rem;
}

.player-stats-compact .stat {
  white-space: nowrap;
}

.player-stats-compact .no-stats {
  font-style: italic;
  font-size: 0.75rem;
}

.row-chevron {
  color: var(--color-secondary);
  font-size: 1.5rem;
  padding-left: 8px;
}

/* Back Button */
.back-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: var(--color-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
  align-self: flex-start;
}

.back-button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

/* Player Modal Styles */
.player-modal-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.player-modal-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.player-bio {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-secondary);
  font-size: 0.875rem;
}

.player-bio .divider {
  color: rgba(255, 255, 255, 0.2);
}

.position-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
}

.position-badge.secondary {
  background: rgba(255, 255, 255, 0.2) !important;
  opacity: 0.8;
}

.badges-section {
  padding: 16px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.badges-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid;
  border-radius: 6px;
}

.badge-level {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.65rem;
  font-weight: 700;
  color: white;
}

.badge-name {
  font-size: 0.875rem;
}

/* Modal Tabs */
.modal-tabs {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.2);
  padding: 4px;
  border-radius: var(--radius-lg);
}

.modal-tab {
  flex: 1;
  padding: 8px 14px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-tab:hover {
  color: white;
  background: rgba(255, 255, 255, 0.08);
}

.modal-tab.active {
  background: var(--gradient-cosmic);
  color: black;
  box-shadow: 0 2px 6px rgba(232, 90, 79, 0.3);
}

.modal-tab-content {
  min-height: 300px;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Stats Sections */
.stats-section {
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-md);
  padding: 12px;
}

.stats-section-title {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 10px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 6px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-md);
}

.stat-cell .stat-label {
  font-size: 0.6rem;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 2px;
}

.stat-cell .stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: white;
}

.stat-cell .stat-value.highlight {
  color: var(--color-primary);
}

/* Attribute Sections */
.attr-section {
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-md);
  padding: 12px;
}

.attr-section-title {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 10px;
}

.attributes-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.attr-row {
  display: grid;
  grid-template-columns: 100px 1fr 36px;
  align-items: center;
  gap: 10px;
}

.attr-name {
  font-size: 0.8rem;
  color: var(--color-secondary);
  text-transform: capitalize;
}

.attr-bar-container {
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.attr-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.attr-value {
  font-weight: 700;
  font-size: 0.85rem;
  text-align: right;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  color: var(--color-secondary);
}

.empty-state p:first-child {
  font-size: 1rem;
  margin-bottom: 8px;
}

/* Contract Footer */
.contract-footer {
  display: flex;
  gap: 20px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-md);
  margin-top: auto;
}

.contract-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.contract-label {
  font-size: 0.65rem;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.contract-value {
  font-size: 1rem;
  font-weight: 700;
}

.text-success {
  color: var(--color-success);
}

/* Mobile responsiveness */
@media (max-width: 640px) {
  .player-stats-compact {
    flex-direction: column;
    gap: 2px;
    font-size: 0.7rem;
  }

  .roster-row {
    min-height: 60px;
    padding: 8px 10px;
  }

  .team-stats-row {
    flex-direction: column;
    gap: 4px;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }

  .stat-cell {
    padding: 6px 4px;
  }

  .stat-cell .stat-value {
    font-size: 1rem;
  }

  .attr-row {
    grid-template-columns: 90px 1fr 32px;
    gap: 6px;
  }

  .attr-name {
    font-size: 0.75rem;
  }

  .contract-footer {
    flex-direction: column;
    gap: 10px;
  }

  .tab-btn, .conf-btn {
    padding: 5px 10px;
    font-size: 0.7rem;
  }

  .playoff-team {
    padding: 6px 8px;
  }

  .game-card {
    padding: 8px 10px;
  }
}

/* Light mode overrides */
[data-theme="light"] .modal-tabs {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .modal-tab {
  color: var(--color-text-secondary);
}

[data-theme="light"] .modal-tab:hover {
  color: var(--color-text-primary);
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .modal-tab.active {
  background: var(--gradient-cosmic);
  color: black;
}

[data-theme="light"] .stats-section {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .stat-cell {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .contract-footer {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .conf-btn {
  background: white;
  border-color: rgba(0, 0, 0, 0.1);
  color: var(--color-text-secondary);
}

[data-theme="light"] .conf-btn:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--color-text-primary);
}

[data-theme="light"] .conf-btn.active {
  background: var(--gradient-cosmic);
  color: black;
}

[data-theme="light"] .tab-btn {
  background: white;
  border-color: rgba(0, 0, 0, 0.1);
  color: var(--color-text-secondary);
}

[data-theme="light"] .tab-btn:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--color-text-primary);
}

[data-theme="light"] .tab-btn.active {
  background: var(--gradient-cosmic);
  color: black;
}

[data-theme="light"] .modal-tab {
  background: white;
}

/* Evolution Section */
.evolution-section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.evolution-subsection {
  margin-bottom: 16px;
}

.evolution-subtitle {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 8px 0;
}

.evolution-alltime-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  border: none;
  padding: 8px 0;
  cursor: pointer;
  color: var(--color-text-primary);
}

.evolution-alltime-header:hover {
  opacity: 0.8;
}

.evolution-toggle-icon {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
}

.evolution-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.evolution-item {
  display: grid;
  grid-template-columns: 70px 1fr 50px 40px;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  font-size: 0.8rem;
}

.evolution-category {
  color: var(--color-text-tertiary);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.evolution-attr {
  color: var(--color-text-primary);
  font-weight: 500;
}

.evolution-change {
  font-weight: 700;
  text-align: right;
  font-family: var(--font-mono);
}

.evolution-count {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  text-align: right;
}

.evolution-toggle {
  margin-top: 8px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.evolution-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

.evolution-empty {
  padding: 16px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 0.8rem;
  font-style: italic;
}

/* ===== NEW MODAL STYLES ===== */

/* Modal Overlay */
.team-modal-overlay,
.player-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(6px);
}

/* Modal Container */
.team-modal-container,
.player-modal-container {
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden; /* Clip border-radius */
}

/* Modal Body - scrollable content area */
.team-modal-body,
.player-modal-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0; /* Allow flex child to shrink */
}

/* Modal Header Bar */
.team-modal-header-bar,
.player-modal-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--color-bg-tertiary);
  flex-shrink: 0;
}

.team-modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.4rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.modal-btn-close {
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

.modal-btn-close:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.modal-back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-back-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

/* Modal Footer */
.team-modal-footer,
.player-modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
  background: var(--color-bg-tertiary);
  flex-shrink: 0;
}

.modal-btn-secondary,
.modal-btn-primary {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-btn-secondary {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.modal-btn-secondary:hover {
  background: var(--color-bg-elevated);
  border-color: var(--color-text-secondary);
}

.modal-btn-primary {
  background: var(--color-primary);
  border: none;
  color: white;
}

.modal-btn-primary:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

/* Team Cosmic Card */
.team-card-cosmic {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-xl);
  position: relative;
}

.team-card-cosmic::before {
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

.team-badge-lg {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 700;
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  border: 3px solid rgba(255, 255, 255, 0.3);
  position: relative;
  z-index: 1;
  flex-shrink: 0;
}

.team-card-info {
  position: relative;
  z-index: 1;
}

.team-card-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: #1a1520;
  margin: 0 0 4px 0;
}

.team-card-record {
  font-size: 1.5rem;
  font-weight: 800;
  color: #1a1520;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

/* Quick Stats */
.team-quick-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.quick-stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.quick-stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--color-text-primary);
}

.quick-stat-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.quick-stat-divider {
  width: 1px;
  height: 32px;
  background: var(--glass-border);
}

/* Roster Section */
.roster-section-new {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.roster-section-header {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin: 0;
  padding-left: 4px;
}

.roster-list-new {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.roster-player-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.15s ease;
}

.roster-player-row:hover {
  background: var(--color-bg-elevated);
  border-color: var(--color-text-tertiary);
}

.roster-player-row.injured {
  opacity: 0.7;
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}

.roster-player-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.roster-player-rating {
  position: relative;
  flex-shrink: 0;
}

.roster-injury-badge {
  position: absolute;
  bottom: -2px;
  right: -4px;
  padding: 1px 3px;
  background: var(--color-error);
  color: white;
  font-size: 0.5rem;
  font-weight: 700;
  border-radius: 3px;
}

.roster-player-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.roster-player-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.roster-player-name.injured-text {
  color: var(--color-error);
  text-decoration: line-through;
}

.roster-player-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
}

.roster-position-tag {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  color: white;
}

.roster-jersey {
  color: var(--color-text-tertiary);
}

.roster-player-stats {
  display: flex;
  gap: 10px;
  font-size: 0.8rem;
}

.roster-stat {
  color: var(--color-text-primary);
  font-weight: 500;
}

.roster-stat small {
  color: var(--color-text-tertiary);
  font-size: 0.65rem;
  margin-left: 2px;
}

.roster-injury-text {
  color: var(--color-error);
  font-weight: 500;
  font-size: 0.75rem;
}

.roster-no-stats {
  color: var(--color-text-tertiary);
}

.roster-chevron {
  color: var(--color-text-tertiary);
  font-size: 1.25rem;
  padding-left: 4px;
}

/* Modal Loading State */
.modal-loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px;
  color: var(--color-text-secondary);
}

/* Player Cosmic Card */
.player-card-cosmic {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-xl);
  position: relative;
}

.player-card-cosmic.injured {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%);
}

.player-card-cosmic::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 10% 20%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 30% 60%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 50% 10%, rgba(255,255,255,0.4), transparent),
    radial-gradient(1px 1px at 70% 40%, rgba(255,255,255,0.3), transparent);
  pointer-events: none;
}

.player-card-rating {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
}

.player-card-injury {
  position: absolute;
  bottom: -4px;
  right: -4px;
  padding: 2px 5px;
  background: white;
  color: var(--color-error);
  font-size: 0.6rem;
  font-weight: 700;
  border-radius: 4px;
}

.player-card-info {
  position: relative;
  z-index: 1;
}

.player-card-name {
  font-size: 1.25rem;
  font-weight: 700;
  color: #1a1520;
  margin: 0 0 6px 0;
}

.player-card-name.injured-text {
  text-decoration: line-through;
  text-decoration-color: rgba(26, 21, 32, 0.4);
}

.player-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.player-card-position {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: white;
}

.player-card-position.secondary {
  background: rgba(26, 21, 32, 0.2) !important;
}

.player-card-jersey {
  color: rgba(26, 21, 32, 0.6);
  font-size: 0.8rem;
  font-weight: 600;
}

.player-card-bio {
  font-size: 0.8rem;
  color: rgba(26, 21, 32, 0.7);
  font-weight: 500;
}

/* Player Badges */
.player-badges-section {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--glass-border);
}

.player-badges-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.player-badge-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid;
  border-radius: 6px;
}

.player-badge-level {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.55rem;
  font-weight: 700;
  color: white;
}

.player-badge-name {
  font-size: 0.8rem;
  color: var(--color-text-primary);
}

.player-badges-toggle {
  padding: 4px 10px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.player-badges-toggle:hover {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

/* Player Tabs */
.player-tabs {
  display: flex;
  gap: 4px;
  background: var(--color-bg-tertiary);
  padding: 4px;
  border-radius: var(--radius-lg);
}

.player-tab {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.player-tab:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-elevated);
}

.player-tab.active {
  background: var(--gradient-cosmic);
  color: #1a1520;
  box-shadow: 0 2px 6px rgba(232, 90, 79, 0.3);
}

/* Player Tab Content */
.player-tab-content {
  /* No min-height - content determines size */
}

.player-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Player Stats Card */
.player-stats-card {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 12px;
}

.player-stats-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.player-stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
}

.player-stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text-primary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

.player-stat-value.highlight {
  color: var(--color-primary);
}

.player-stat-label {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

/* Player Attributes Card */
.player-attr-card {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 12px;
}

.player-attr-title {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin: 0 0 10px 0;
}

.player-attr-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.player-attr-row {
  display: grid;
  grid-template-columns: 90px 1fr 36px;
  align-items: center;
  gap: 10px;
}

.player-attr-name {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  text-transform: capitalize;
}

.player-attr-bar-wrap {
  height: 6px;
  background: var(--color-bg-secondary);
  border-radius: 3px;
  overflow: hidden;
}

.player-attr-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.player-attr-value {
  font-weight: 700;
  font-size: 0.8rem;
  text-align: right;
}

/* Player Empty State */
.player-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.player-empty-state p {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px 0;
}

.player-empty-state span {
  font-size: 0.85rem;
  color: var(--color-text-tertiary);
}

/* Player Evolution */
.player-evolution-section {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--glass-border);
}

.player-evolution-group {
  margin-bottom: 12px;
}

.player-evolution-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  margin: 0;
}

.player-evolution-expand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  border: none;
  padding: 6px 0;
  cursor: pointer;
  color: var(--color-text-primary);
}

.player-evolution-expand:hover {
  opacity: 0.8;
}

.player-evolution-expand span {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
}

.player-evolution-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.player-evolution-item {
  display: grid;
  grid-template-columns: 60px 1fr 45px 35px;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--color-bg-tertiary);
  border-radius: 4px;
  font-size: 0.75rem;
}

.player-evolution-cat {
  color: var(--color-text-tertiary);
  font-size: 0.65rem;
  text-transform: uppercase;
}

.player-evolution-attr {
  color: var(--color-text-primary);
  font-weight: 500;
}

.player-evolution-change {
  font-weight: 700;
  text-align: right;
  font-family: var(--font-mono);
}

.player-evolution-count {
  font-size: 0.65rem;
  color: var(--color-text-tertiary);
  text-align: right;
}

.player-evolution-toggle {
  margin-top: 6px;
  padding: 5px 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.player-evolution-toggle:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.player-evolution-empty {
  padding: 12px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
  font-style: italic;
}

/* Player Contract Bar */
.player-contract-bar {
  display: flex;
  gap: 20px;
  padding: 12px 16px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  flex-shrink: 0;
}

.player-contract-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.player-contract-label {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.player-contract-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.player-contract-value.success {
  color: var(--color-success);
}

/* Modal Animation */
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

.modal-enter-active .team-modal-container,
.modal-enter-active .player-modal-container {
  animation: modalScaleIn 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active .team-modal-container,
.modal-leave-active .player-modal-container {
  animation: modalScaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes modalScaleIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes modalScaleOut {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}

/* Mobile responsiveness for new modals */
@media (max-width: 640px) {
  .team-modal-container,
  .player-modal-container {
    max-width: 100%;
    max-height: 95vh;
    margin: 8px;
    border-radius: var(--radius-xl);
  }

  .team-card-cosmic,
  .player-card-cosmic {
    padding: 16px;
  }

  .team-badge-lg {
    width: 52px;
    height: 52px;
    font-size: 0.85rem;
  }

  .team-card-name {
    font-size: 1rem;
  }

  .team-card-record {
    font-size: 1.25rem;
  }

  .team-quick-stats {
    padding: 10px;
    gap: 12px;
  }

  .quick-stat-value {
    font-size: 0.95rem;
  }

  .roster-player-stats {
    flex-direction: column;
    gap: 2px;
    font-size: 0.7rem;
  }

  .player-stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .player-attr-row {
    grid-template-columns: 80px 1fr 32px;
    gap: 6px;
  }

  .player-evolution-item {
    grid-template-columns: 55px 1fr 40px 30px;
  }
}

/* Light mode for games remaining card - cosmic gradient works in both modes */

/* Light mode overrides for new modals */
[data-theme="light"] .team-modal-overlay,
[data-theme="light"] .player-modal-overlay {
  background: rgba(0, 0, 0, 0.5);
}

[data-theme="light"] .team-modal-container,
[data-theme="light"] .player-modal-container {
  background: white;
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .team-modal-header-bar,
[data-theme="light"] .player-modal-header-bar,
[data-theme="light"] .team-modal-footer,
[data-theme="light"] .player-modal-footer {
  background: rgba(0, 0, 0, 0.02);
}

[data-theme="light"] .roster-player-row,
[data-theme="light"] .player-stats-card,
[data-theme="light"] .player-attr-card,
[data-theme="light"] .player-contract-bar {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .roster-player-row:hover {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .player-tabs {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .player-tab {
  color: var(--color-text-secondary);
}

[data-theme="light"] .player-tab:hover {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .player-tab.active {
  background: var(--gradient-cosmic);
  color: #1a1520;
}

/* Recent Games (Game Log Table) */
.recent-performances-section {
  margin-top: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-lg);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.recent-performances-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin-bottom: 10px;
}

.game-log-table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

.game-log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.7rem;
  white-space: nowrap;
  min-width: 520px;
}

.game-log-table th {
  padding: 4px 6px;
  text-align: center;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.6rem;
}

.game-log-table td {
  padding: 5px 6px;
  text-align: center;
  color: var(--color-text-secondary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.game-log-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.04);
}

.game-log-date {
  text-align: left !important;
  color: var(--color-text-tertiary) !important;
}

.game-log-opp {
  font-weight: 600;
  color: var(--color-text-primary) !important;
}

.game-log-pts {
  font-weight: 700;
  color: var(--color-text-primary) !important;
}

.game-log-win {
  color: var(--color-success) !important;
  font-weight: 700;
}

.game-log-loss {
  color: var(--color-error) !important;
  font-weight: 700;
}

.player-history-section {
  margin-bottom: 16px;
}

.draft-info-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md, 8px);
}

.draft-info-pick {
  font-size: 1.2rem;
  font-weight: 800;
  color: var(--color-primary);
  min-width: 36px;
  text-align: center;
}

.draft-info-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.draft-info-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-weight: 600;
}

.draft-info-team {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
}

.current-season-row {
  background: rgba(139, 92, 246, 0.08);
}

.current-season-row:hover {
  background: rgba(139, 92, 246, 0.14) !important;
}

.season-year-cell {
  font-weight: 600;
  color: var(--color-text-primary) !important;
  text-align: left !important;
  white-space: nowrap;
}

.current-tag {
  color: var(--color-primary);
  margin-left: 2px;
  font-weight: 700;
}

.player-awards-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.player-award-item {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: var(--radius-lg);
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.player-award-item.gold {
  background: rgba(255, 215, 0, 0.1);
  color: #ffd700;
  border-color: rgba(255, 215, 0, 0.2);
}

.player-award-item.silver {
  background: rgba(192, 192, 192, 0.1);
  color: #c0c0c0;
  border-color: rgba(192, 192, 192, 0.2);
}

</style>
