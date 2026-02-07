<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLeagueStore } from '@/stores/league'
import { useTeamStore } from '@/stores/team'
import { useCampaignStore } from '@/stores/campaign'
import { useGameStore } from '@/stores/game'
import { GlassCard, BaseButton, LoadingSpinner } from '@/components/ui'

const route = useRoute()
const router = useRouter()
const leagueStore = useLeagueStore()
const teamStore = useTeamStore()
const campaignStore = useCampaignStore()
const gameStore = useGameStore()

const loading = ref(true)
const activeTab = ref('standings')
const activeConference = ref('east')

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const userTeam = computed(() => campaign.value?.team)

const eastStandings = computed(() => leagueStore.eastStandings)
const westStandings = computed(() => leagueStore.westStandings)

const activeStandings = computed(() =>
  activeConference.value === 'east' ? eastStandings.value : westStandings.value
)

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
</script>

<template>
  <div class="p-6">
    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-12">
      <LoadingSpinner size="lg" />
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex items-center justify-between mb-8">
        <h1 class="h2 text-gradient">League</h1>
        <div class="text-right">
          <p class="text-sm text-secondary">Current Date</p>
          <p class="font-semibold">{{ formatDate(campaign?.current_date) }}</p>
        </div>
      </div>

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
            :class="{ active: activeConference === 'east' }"
            @click="activeConference = 'east'"
          >
            Eastern Conference
          </button>
          <button
            class="conf-btn"
            :class="{ active: activeConference === 'west' }"
            @click="activeConference = 'west'"
          >
            Western Conference
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
                  class="standing-row"
                  :class="{ 'user-team': isUserTeam(standing.teamId), 'playoff-line': index === 7 }"
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
        <GlassCard padding="lg" :hoverable="false">
          <h3 class="h4 mb-4">League Leaders by Wins</h3>
          <div class="leaders-list">
            <div
              v-for="(standing, index) in leagueStore.leagueLeaders.slice(0, 10)"
              :key="standing.teamId"
              class="leader-row"
              :class="{ 'user-team': isUserTeam(standing.teamId) }"
            >
              <span class="leader-rank">{{ index + 1 }}</span>
              <div class="leader-team">
                <div
                  class="team-logo sm"
                  :style="{ backgroundColor: standing.team?.primary_color || '#6B7280' }"
                >
                  {{ standing.team?.abbreviation }}
                </div>
                <span>{{ standing.team?.name }}</span>
              </div>
              <div class="leader-stats">
                <span class="stat-main">{{ standing.wins }}-{{ standing.losses }}</span>
                <span class="stat-pct">{{ getWinPercentage(standing.wins, standing.losses) }}</span>
              </div>
            </div>
          </div>
        </GlassCard>
      </template>
    </template>
  </div>
</template>

<style scoped>
.tab-btn {
  padding: 8px 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--color-secondary);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.tab-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.conf-btn {
  padding: 10px 20px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--color-secondary);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.conf-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.conf-btn.active {
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
  border-color: transparent;
  color: white;
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
  padding: 12px 8px;
  text-align: center;
}

.standings-table th {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-secondary);
  font-weight: 500;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.2s ease;
}

.standing-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.standing-row.user-team {
  background: rgba(124, 58, 237, 0.1);
}

.standing-row.user-team:hover {
  background: rgba(124, 58, 237, 0.15);
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
  gap: 8px;
}

.playoff-team {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.playoff-team.user-team {
  background: rgba(124, 58, 237, 0.15);
  border: 1px solid var(--color-primary);
}

.playoff-team .seed {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary);
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 700;
}

.playoff-team .team-abbr {
  flex: 1;
  font-weight: 600;
}

.playoff-team .record {
  color: var(--color-secondary);
}

.game-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.game-card:hover {
  background: rgba(255, 255, 255, 0.1);
}

.game-card.user-game {
  border-color: var(--color-primary);
}

.game-date {
  font-size: 0.75rem;
  color: var(--color-secondary);
  min-width: 60px;
}

.game-matchup {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.game-team {
  display: flex;
  align-items: center;
  gap: 8px;
}

.game-team .team-abbr {
  font-weight: 600;
}

.game-team .team-score {
  font-weight: 700;
  font-family: monospace;
}

.game-team.winner .team-score {
  color: var(--color-success);
}

.at-symbol {
  color: var(--color-secondary);
  font-size: 0.875rem;
}

.game-status {
  font-size: 0.75rem;
  color: var(--color-secondary);
}

.game-badge {
  padding: 2px 8px;
  background: var(--color-primary);
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
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
  background: rgba(124, 58, 237, 0.1);
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
</style>
