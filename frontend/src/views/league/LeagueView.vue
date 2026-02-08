<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLeagueStore } from '@/stores/league'
import { useTeamStore } from '@/stores/team'
import { useCampaignStore } from '@/stores/campaign'
import { useGameStore } from '@/stores/game'
import { GlassCard, BaseButton, BaseModal, LoadingSpinner, StatBadge } from '@/components/ui'

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
  if (newTab === 'leaders' && !leadersFetched.value) {
    try {
      await leagueStore.fetchPlayerLeaders(campaignId.value)
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

// Evolution history display state
const showAllRecentEvolution = ref(false)
const showAllTimeEvolution = ref(false)
const showAllTimeExpanded = ref(false)

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const userTeam = computed(() => campaign.value?.team)

const eastStandings = computed(() => leagueStore.eastStandings)
const westStandings = computed(() => leagueStore.westStandings)

const activeStandings = computed(() => {
  if (activeConference.value === null) {
    // Combine both conferences and sort by win percentage
    const all = [...eastStandings.value, ...westStandings.value]
    return all.sort((a, b) => {
      const pctA = a.wins / (a.wins + a.losses) || 0
      const pctB = b.wins / (b.wins + b.losses) || 0
      return pctB - pctA
    })
  }
  return activeConference.value === 'east' ? eastStandings.value : westStandings.value
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
  showPlayerModal.value = true
}

function backToTeamModal() {
  showPlayerModal.value = false
  selectedPlayer.value = null
}

function closeAllModals() {
  showPlayerModal.value = false
  showTeamModal.value = false
  selectedPlayer.value = null
  selectedTeam.value = null
}

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

// Get date 7 days ago for filtering recent evolution
const sevenDaysAgo = computed(() => {
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return date.toISOString().split('T')[0]
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
    <div v-if="loading" class="flex justify-center items-center py-12 opacity-60">
      <LoadingSpinner size="md" />
    </div>

    <template v-else>
      <!-- Tab Navigation -->
      <div class="flex gap-2 mb-6">
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

      <!-- Standings View -->
      <template v-if="activeTab === 'standings'">
        <!-- Conference Toggle -->
        <div class="flex gap-2 mb-6">
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
                  <td class="stat-col">{{ standing.homeWins || 0 }}-{{ standing.homeLosses || 0 }}</td>
                  <td class="stat-col">{{ standing.awayWins || 0 }}-{{ standing.awayLosses || 0 }}</td>
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
        <div class="grid md:grid-cols-2 gap-6 mt-6">
          <GlassCard padding="lg" :hoverable="false">
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

          <GlassCard padding="lg" :hoverable="false">
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
        <!-- Conference Toggle -->
        <div class="flex gap-2 mb-6">
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
                  class="leader-row-table"
                  :class="{ 'user-team': isUserTeam(player.teamId) }"
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
    <BaseModal
      :show="showTeamModal && !showPlayerModal"
      @close="closeTeamModal"
      :title="`${selectedTeam?.team?.city} ${selectedTeam?.team?.name}`"
      size="lg"
    >
      <div v-if="selectedTeam" class="team-modal-content">
        <!-- Team Header -->
        <div class="team-modal-header">
          <div class="team-logo-lg" :style="{ backgroundColor: selectedTeam.team?.primary_color }">
            {{ selectedTeam.team?.abbreviation }}
          </div>
          <div class="team-info-header">
            <div class="team-record">{{ selectedTeam.wins }}-{{ selectedTeam.losses }}</div>
            <div class="team-stats-row">
              <span>Home: {{ selectedTeam.homeWins || 0 }}-{{ selectedTeam.homeLosses || 0 }}</span>
              <span>Away: {{ selectedTeam.awayWins || 0 }}-{{ selectedTeam.awayLosses || 0 }}</span>
              <span>Streak: {{ selectedTeam.streak || '-' }}</span>
            </div>
          </div>
        </div>

        <!-- Roster List -->
        <div class="roster-section">
          <h4 class="section-title">Roster</h4>

          <div v-if="loadingTeamRoster" class="loading-state">
            <LoadingSpinner size="md" />
          </div>

          <div v-else class="roster-list">
            <div
              v-for="player in selectedTeamRoster"
              :key="player.id"
              class="roster-row"
              :class="{ injured: player.is_injured || player.isInjured }"
              @click="openPlayerFromTeam(player)"
            >
              <!-- Player basic info -->
              <div class="player-main">
                <div class="rating-with-injury">
                  <StatBadge :value="player.overall_rating" size="sm" />
                  <span v-if="player.is_injured || player.isInjured" class="injury-indicator" title="Injured">INJ</span>
                </div>
                <div class="player-identity">
                  <span class="player-name" :class="{ 'injured-name': player.is_injured || player.isInjured }">{{ player.name }}</span>
                  <div class="player-meta">
                    <span class="position-badge" :style="{ backgroundColor: getPositionColor(player.position) }">
                      {{ player.position }}<template v-if="player.secondary_position">/{{ player.secondary_position }}</template>
                    </span>
                    <span v-if="player.is_injured || player.isInjured" class="injury-tag">Injured</span>
                    <span v-else class="jersey">#{{ player.jersey_number || '00' }}</span>
                  </div>
                </div>
              </div>

              <!-- Season stats (compact) -->
              <div v-if="player.season_stats && !(player.is_injured || player.isInjured)" class="player-stats-compact">
                <span class="stat">{{ player.season_stats.ppg }} PPG</span>
                <span class="stat">{{ player.season_stats.rpg }} RPG</span>
                <span class="stat">{{ player.season_stats.apg }} APG</span>
              </div>
              <div v-else-if="player.is_injured || player.isInjured" class="player-stats-compact">
                <span class="injury-status">Out - Injured</span>
              </div>
              <div v-else class="player-stats-compact">
                <span class="no-stats">No stats yet</span>
              </div>

              <!-- Chevron indicator -->
              <div class="row-chevron">&rsaquo;</div>
            </div>
          </div>
        </div>
      </div>
    </BaseModal>

    <!-- Player Details Modal (from Team View) -->
    <BaseModal
      :show="showPlayerModal"
      @close="closeAllModals"
      :title="selectedPlayer?.name || 'Player Details'"
      size="lg"
    >
      <div v-if="selectedPlayer" class="player-modal-content">
        <!-- Back Button -->
        <button class="back-button" @click="backToTeamModal">
          &larr; Back to {{ selectedTeam?.team?.name }}
        </button>

        <!-- Player Header -->
        <div class="player-modal-header" :class="{ 'injured-header': selectedPlayer.is_injured || selectedPlayer.isInjured }">
          <div class="flex items-center gap-4">
            <div class="rating-with-injury-lg">
              <StatBadge :value="selectedPlayer.overall_rating" size="lg" />
              <span v-if="selectedPlayer.is_injured || selectedPlayer.isInjured" class="injury-badge-lg">INJ</span>
            </div>
            <div>
              <h2 class="h3" :class="{ 'injured-name': selectedPlayer.is_injured || selectedPlayer.isInjured }">{{ selectedPlayer.name }}</h2>
              <div class="flex items-center gap-2">
                <span
                  class="position-badge"
                  :style="{ backgroundColor: getPositionColor(selectedPlayer.position) }"
                >
                  {{ selectedPlayer.position }}
                </span>
                <span v-if="selectedPlayer.secondary_position" class="position-badge secondary">
                  {{ selectedPlayer.secondary_position }}
                </span>
                <span v-if="selectedPlayer.is_injured || selectedPlayer.isInjured" class="injury-tag">Injured</span>
                <span v-else class="text-secondary">#{{ selectedPlayer.jersey_number || '00' }}</span>
              </div>
            </div>
          </div>
          <div class="player-bio">
            <span>{{ selectedPlayer.height || "6'6\"" }}</span>
            <span class="divider">|</span>
            <span>{{ formatWeight(selectedPlayer.weight) }} lbs</span>
            <span class="divider">|</span>
            <span>Age {{ selectedPlayer.age || 25 }}</span>
          </div>
        </div>

        <!-- Badges -->
        <div v-if="selectedPlayer.badges?.length > 0" class="badges-section">
          <div class="badges-grid">
            <div
              v-for="badge in selectedPlayer.badges"
              :key="badge.id"
              class="badge-card"
              :style="{ borderColor: getBadgeLevelColor(badge.level) }"
            >
              <span
                class="badge-level"
                :style="{ backgroundColor: getBadgeLevelColor(badge.level) }"
              >
                {{ badge.level?.toUpperCase() }}
              </span>
              <span class="badge-name">{{ formatBadgeName(badge.id) }}</span>
            </div>
          </div>
        </div>

        <!-- Tab Navigation -->
        <div class="modal-tabs">
          <button
            class="modal-tab"
            :class="{ active: playerModalTab === 'stats' }"
            @click="playerModalTab = 'stats'"
          >
            Season Stats
          </button>
          <button
            class="modal-tab"
            :class="{ active: playerModalTab === 'attributes' }"
            @click="playerModalTab = 'attributes'"
          >
            Attributes
          </button>
        </div>

        <!-- Tab Content -->
        <div class="modal-tab-content">
          <!-- Stats Tab -->
          <div v-if="playerModalTab === 'stats'" class="tab-panel">
            <template v-if="selectedPlayer.season_stats">
              <!-- Scoring Stats -->
              <div class="stats-section">
                <h4 class="stats-section-title">Scoring</h4>
                <div class="stats-grid">
                  <div class="stat-cell">
                    <span class="stat-label">PPG</span>
                    <span class="stat-value highlight">{{ selectedPlayer.season_stats.ppg }}</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">FG%</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.fg_pct }}%</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">3P%</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.three_pct }}%</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">FT%</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.ft_pct }}%</span>
                  </div>
                </div>
              </div>

              <!-- Playmaking Stats -->
              <div class="stats-section">
                <h4 class="stats-section-title">Playmaking</h4>
                <div class="stats-grid">
                  <div class="stat-cell">
                    <span class="stat-label">APG</span>
                    <span class="stat-value highlight">{{ selectedPlayer.season_stats.apg }}</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">RPG</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.rpg }}</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">MPG</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.mpg }}</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">GP</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.games_played }}</span>
                  </div>
                </div>
              </div>

              <!-- Defense Stats -->
              <div class="stats-section">
                <h4 class="stats-section-title">Defense</h4>
                <div class="stats-grid">
                  <div class="stat-cell">
                    <span class="stat-label">SPG</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.spg }}</span>
                  </div>
                  <div class="stat-cell">
                    <span class="stat-label">BPG</span>
                    <span class="stat-value">{{ selectedPlayer.season_stats.bpg }}</span>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="empty-state">
              <p>No stats available yet.</p>
              <p class="text-sm text-secondary">Play some games to see this player's stats.</p>
            </div>
          </div>

          <!-- Attributes Tab -->
          <div v-if="playerModalTab === 'attributes'" class="tab-panel">
            <!-- Offensive Attributes -->
            <div v-if="selectedPlayer.attributes?.offense" class="attr-section">
              <h4 class="attr-section-title">Offense</h4>
              <div class="attributes-grid">
                <div v-for="(value, key) in selectedPlayer.attributes.offense" :key="key" class="attr-row">
                  <span class="attr-name">{{ formatAttrName(key) }}</span>
                  <div class="attr-bar-container">
                    <div
                      class="attr-bar"
                      :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                    />
                  </div>
                  <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ value }}</span>
                </div>
              </div>
            </div>

            <!-- Defensive Attributes -->
            <div v-if="selectedPlayer.attributes?.defense" class="attr-section">
              <h4 class="attr-section-title">Defense</h4>
              <div class="attributes-grid">
                <div v-for="(value, key) in selectedPlayer.attributes.defense" :key="key" class="attr-row">
                  <span class="attr-name">{{ formatAttrName(key) }}</span>
                  <div class="attr-bar-container">
                    <div
                      class="attr-bar"
                      :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                    />
                  </div>
                  <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ value }}</span>
                </div>
              </div>
            </div>

            <!-- Physical Attributes -->
            <div v-if="selectedPlayer.attributes?.physical" class="attr-section">
              <h4 class="attr-section-title">Physical</h4>
              <div class="attributes-grid">
                <div v-for="(value, key) in selectedPlayer.attributes.physical" :key="key" class="attr-row">
                  <span class="attr-name">{{ formatAttrName(key) }}</span>
                  <div class="attr-bar-container">
                    <div
                      class="attr-bar"
                      :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                    />
                  </div>
                  <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ value }}</span>
                </div>
              </div>
            </div>

            <!-- Mental Attributes -->
            <div v-if="selectedPlayer.attributes?.mental" class="attr-section">
              <h4 class="attr-section-title">Mental</h4>
              <div class="attributes-grid">
                <div v-for="(value, key) in selectedPlayer.attributes.mental" :key="key" class="attr-row">
                  <span class="attr-name">{{ formatAttrName(key) }}</span>
                  <div class="attr-bar-container">
                    <div
                      class="attr-bar"
                      :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }"
                    />
                  </div>
                  <span class="attr-value" :style="{ color: getAttrColor(value) }">{{ value }}</span>
                </div>
              </div>
            </div>

            <!-- Season Evolution Section -->
            <div class="evolution-section">
              <h4 class="attr-section-title">Season Evolution</h4>

              <!-- Recent Evolution (Last 7 Days) -->
              <div class="evolution-subsection">
                <h5 class="evolution-subtitle">Recent (Last 7 Days)</h5>
                <div v-if="recentEvolution.length > 0" class="evolution-list">
                  <div
                    v-for="(item, index) in (showAllRecentEvolution ? recentEvolution : recentEvolution.slice(0, 10))"
                    :key="`recent-${item.category}-${item.attribute}`"
                    class="evolution-item"
                  >
                    <span class="evolution-category">{{ formatCategoryName(item.category) }}</span>
                    <span class="evolution-attr">{{ formatAttrName(item.attribute) }}</span>
                    <span class="evolution-change" :style="{ color: getEvolutionColor(item.totalChange) }">
                      {{ formatChange(item.totalChange) }}
                    </span>
                  </div>
                  <button
                    v-if="recentEvolution.length > 10"
                    class="evolution-toggle"
                    @click="showAllRecentEvolution = !showAllRecentEvolution"
                  >
                    {{ showAllRecentEvolution ? 'Show Less' : `Show All (${recentEvolution.length})` }}
                  </button>
                </div>
                <div v-else class="evolution-empty">
                  No recent development activity
                </div>
              </div>

              <!-- All-Time Evolution -->
              <div class="evolution-subsection">
                <button
                  class="evolution-alltime-header"
                  @click="showAllTimeExpanded = !showAllTimeExpanded"
                >
                  <h5 class="evolution-subtitle">All-Time Evolution</h5>
                  <span class="evolution-toggle-icon">{{ showAllTimeExpanded ? '▼' : '▶' }}</span>
                </button>
                <div v-if="showAllTimeExpanded" class="evolution-list">
                  <template v-if="allTimeEvolution.length > 0">
                    <div
                      v-for="(item, index) in (showAllTimeEvolution ? allTimeEvolution : allTimeEvolution.slice(0, 10))"
                      :key="`alltime-${item.category}-${item.attribute}`"
                      class="evolution-item"
                    >
                      <span class="evolution-category">{{ formatCategoryName(item.category) }}</span>
                      <span class="evolution-attr">{{ formatAttrName(item.attribute) }}</span>
                      <span class="evolution-change" :style="{ color: getEvolutionColor(item.totalChange) }">
                        {{ formatChange(item.totalChange) }}
                      </span>
                      <span class="evolution-count">({{ item.count }}x)</span>
                    </div>
                    <button
                      v-if="allTimeEvolution.length > 10"
                      class="evolution-toggle"
                      @click="showAllTimeEvolution = !showAllTimeEvolution"
                    >
                      {{ showAllTimeEvolution ? 'Show Less' : `Show All (${allTimeEvolution.length})` }}
                    </button>
                  </template>
                  <div v-else class="evolution-empty">
                    No development history available
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Contract Footer -->
        <div v-if="selectedPlayer.contract" class="contract-footer">
          <div class="contract-item">
            <span class="contract-label">Salary</span>
            <span class="contract-value text-success">{{ formatSalary(selectedPlayer.contract.salary) }}/yr</span>
          </div>
          <div class="contract-item">
            <span class="contract-label">Years Remaining</span>
            <span class="contract-value">{{ selectedPlayer.contract.years_remaining }}</span>
          </div>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
.league-view {
  padding-top: 45px;
  padding-bottom: 100px;
}

@media (min-width: 1024px) {
  .league-view {
    padding-bottom: 24px;
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
  font-size: 0.875rem;
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
</style>
