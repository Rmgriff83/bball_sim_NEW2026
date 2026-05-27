<script setup>
import { ref, computed, onMounted } from 'vue'
import { useTradeStore } from '@/stores/trade'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { GlassCard, StatBadge, LoadingSpinner } from '@/components/ui'
import { Repeat, Users, ArrowRightLeft } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import PlayerDetailModal from '@/components/team/PlayerDetailModal.vue'

function getPositionColor(position) {
  const colors = {
    PG: '#3B82F6',
    SG: '#10B981',
    SF: '#F59E0B',
    PF: '#EF4444',
    C: '#8B5CF6',
  }
  return colors[position] || '#6B7280'
}

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const emit = defineEmits(['start-trade'])

const tradeStore = useTradeStore()
const loading = ref(true)
const userBlockPlayers = ref([])
const leagueBlockPlayers = ref([])
const selectedPlayer = ref(null)
const showPlayerModal = ref(false)
const playerStatsMap = ref({})
const currentSeasonYear = ref(null)

function getPlayerName(player) {
  const first = player.firstName || player.first_name || ''
  const last = player.lastName || player.last_name || ''
  return `${first} ${last}`.trim()
}

function getPlayerRating(player) {
  return player.overallRating ?? player.overall_rating ?? 75
}

function getPlayerPosition(player) {
  return player.position ?? ''
}

function getTeamAbbr(player) {
  return player.teamAbbreviation ?? player.team_abbreviation ?? ''
}

function getStatLine(playerId) {
  const stats = playerStatsMap.value[playerId]
  if (!stats || !stats.gamesPlayed) return null
  const gp = stats.gamesPlayed
  return {
    ppg: ((stats.points || 0) / gp).toFixed(1),
    rpg: ((stats.rebounds || 0) / gp).toFixed(1),
    apg: ((stats.assists || 0) / gp).toFixed(1),
  }
}

// Build a per-game season_stats object the PlayerDetailModal can render.
// Matches the shape produced by team store's _attachSeasonStats.
function buildSeasonStats(playerId) {
  const raw = playerStatsMap.value[playerId]
  if (!raw || !raw.gamesPlayed) return null
  const gp = raw.gamesPlayed
  const fgPct = raw.fieldGoalsAttempted > 0
    ? Math.round((raw.fieldGoalsMade / raw.fieldGoalsAttempted) * 1000) / 10
    : 0
  const threePct = raw.threePointersAttempted > 0
    ? Math.round((raw.threePointersMade / raw.threePointersAttempted) * 1000) / 10
    : 0
  const ftPct = raw.freeThrowsAttempted > 0
    ? Math.round((raw.freeThrowsMade / raw.freeThrowsAttempted) * 1000) / 10
    : 0
  return {
    games_played: gp,
    gamesPlayed: gp,
    ppg: Math.round((raw.points / gp) * 10) / 10,
    rpg: Math.round((raw.rebounds / gp) * 10) / 10,
    apg: Math.round((raw.assists / gp) * 10) / 10,
    spg: Math.round((raw.steals / gp) * 10) / 10,
    bpg: Math.round((raw.blocks / gp) * 10) / 10,
    mpg: Math.round((raw.minutesPlayed / gp) * 10) / 10,
    fg_pct: fgPct, fgPct,
    three_pct: threePct, threePct,
    ft_pct: ftPct, ftPct,
    points: raw.points,
    rebounds: raw.rebounds,
    assists: raw.assists,
    steals: raw.steals,
    blocks: raw.blocks,
    turnovers: raw.turnovers,
    minutesPlayed: raw.minutesPlayed,
    fgm: raw.fieldGoalsMade,
    fga: raw.fieldGoalsAttempted,
    fg3m: raw.threePointersMade,
    fg3a: raw.threePointersAttempted,
    ftm: raw.freeThrowsMade,
    fta: raw.freeThrowsAttempted,
  }
}

function openPlayer(player) {
  // Clone before attaching season_stats so we don't mutate the underlying
  // PlayerRepository record (which other tabs/store code may reference).
  selectedPlayer.value = {
    ...player,
    season_stats: buildSeasonStats(player.id),
  }
  showPlayerModal.value = true
}

function closePlayer() {
  showPlayerModal.value = false
  selectedPlayer.value = null
}

function startTrade(player, ev) {
  ev.stopPropagation()
  emit('start-trade', {
    player,
    teamId: player._teamId,
  })
}

onMounted(async () => {
  try {
    const campaign = await CampaignRepository.get(props.campaignId)
    const userTeamId = campaign?.team_id ?? campaign?.teamId
    const year = campaign?.currentSeasonYear ?? campaign?.gameYear ?? 2025
    currentSeasonYear.value = year

    const [allTeams, allPlayers, seasonData] = await Promise.all([
      TeamRepository.getAllForCampaign(props.campaignId),
      PlayerRepository.getAllForCampaign(props.campaignId),
      SeasonRepository.get(props.campaignId, year),
    ])

    // Build stats map
    const statsArr = seasonData?.playerStats ?? []
    const statsMap = {}
    if (Array.isArray(statsArr)) {
      for (const s of statsArr) {
        const pid = s.playerId ?? s.player_id
        if (pid) statsMap[pid] = s
      }
    } else if (typeof statsArr === 'object') {
      Object.assign(statsMap, statsArr)
    }
    playerStatsMap.value = statsMap

    // User trading block
    const userBlockIds = campaign?.settings?.tradingBlock ?? []
    const userPlayers = allPlayers.filter(p => userBlockIds.includes(p.id))
    userBlockPlayers.value = userPlayers

    // AI trading blocks
    const leaguePlayers = []
    for (const team of allTeams) {
      if (team.id === userTeamId) continue
      const blockIds = team.tradingBlock || []
      if (blockIds.length === 0) continue
      for (const pid of blockIds) {
        const player = allPlayers.find(p => p.id === pid)
        if (player) {
          leaguePlayers.push({ ...player, _teamId: team.id, _teamName: team.name, _teamAbbr: team.abbreviation })
        }
      }
    }
    // Sort by rating descending
    leaguePlayers.sort((a, b) => getPlayerRating(b) - getPlayerRating(a))
    leagueBlockPlayers.value = leaguePlayers
  } catch (err) {
    console.warn('TradingBlockTab load error:', err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="trading-block-tab">
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="lg" />
    </div>

    <template v-else>
      <!-- User Trading Block -->
      <div class="block-section">
        <h3 class="section-title">Your Trading Block</h3>
        <GlassCard v-if="userBlockPlayers.length === 0" padding="lg" :hoverable="false">
          <div class="empty-state">
            <Repeat :size="32" class="empty-icon" />
            <p>No players on your trading block. Open a player's detail modal and tap the trade block toggle to add them.</p>
          </div>
        </GlassCard>
        <div v-else class="players-grid">
          <div
            v-for="player in userBlockPlayers"
            :key="player.id"
            class="player-card"
            @click="openPlayer(player)"
          >
            <div class="card-header">
              <div class="avatar-column">
                <div class="player-avatar">
                  <PlayerAvatar :player="player" :size="78" class="avatar-icon" />
                </div>
              </div>
              <div class="player-main-info">
                <h4 class="player-name">{{ getPlayerName(player) }}</h4>
                <div class="player-meta">
                  <div class="vitals-row">
                    {{ player.height || "6'6\"" }} · {{ player.age || 25 }} yrs
                  </div>
                  <div class="position-badges">
                    <span class="position-badge" :style="{ backgroundColor: getPositionColor(getPlayerPosition(player)) }">
                      {{ getPlayerPosition(player) }}
                    </span>
                  </div>
                  <span class="team-tag">Your Team</span>
                </div>
                <div v-if="getStatLine(player.id)" class="stats-inline">
                  <span class="stat-inline"><span class="stat-label">PPG</span><span class="stat-val">{{ getStatLine(player.id).ppg }}</span></span>
                  <span class="stat-inline"><span class="stat-label">RPG</span><span class="stat-val">{{ getStatLine(player.id).rpg }}</span></span>
                  <span class="stat-inline"><span class="stat-label">APG</span><span class="stat-val">{{ getStatLine(player.id).apg }}</span></span>
                </div>
              </div>
              <div class="rating-container">
                <StatBadge :value="getPlayerRating(player)" size="md" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- League Trading Block -->
      <div class="block-section">
        <h3 class="section-title">
          <Users :size="16" />
          League Trading Block
        </h3>
        <GlassCard v-if="leagueBlockPlayers.length === 0" padding="lg" :hoverable="false">
          <div class="empty-state">
            <p>No AI teams have players on the trading block yet.</p>
          </div>
        </GlassCard>
        <div v-else class="players-grid">
          <div
            v-for="player in leagueBlockPlayers"
            :key="player.id"
            class="player-card"
            @click="openPlayer(player)"
          >
            <div class="card-header">
              <div class="avatar-column">
                <div class="player-avatar">
                  <PlayerAvatar :player="player" :size="78" class="avatar-icon" />
                </div>
              </div>
              <div class="player-main-info">
                <h4 class="player-name">{{ getPlayerName(player) }}</h4>
                <div class="player-meta">
                  <div class="vitals-row">
                    {{ player.height || "6'6\"" }} · {{ player.age || 25 }} yrs
                  </div>
                  <div class="position-badges">
                    <span class="position-badge" :style="{ backgroundColor: getPositionColor(getPlayerPosition(player)) }">
                      {{ getPlayerPosition(player) }}
                    </span>
                  </div>
                  <span class="team-tag">{{ player._teamAbbr || getTeamAbbr(player) }}</span>
                </div>
                <div v-if="getStatLine(player.id)" class="stats-inline">
                  <span class="stat-inline"><span class="stat-label">PPG</span><span class="stat-val">{{ getStatLine(player.id).ppg }}</span></span>
                  <span class="stat-inline"><span class="stat-label">RPG</span><span class="stat-val">{{ getStatLine(player.id).rpg }}</span></span>
                  <span class="stat-inline"><span class="stat-label">APG</span><span class="stat-val">{{ getStatLine(player.id).apg }}</span></span>
                </div>
              </div>
              <div class="rating-container">
                <StatBadge :value="getPlayerRating(player)" size="md" />
                <button class="trade-btn" @click="startTrade(player, $event)" title="Start trade">
                  <ArrowRightLeft :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Player Detail Modal -->
    <PlayerDetailModal
      :show="showPlayerModal"
      :player="selectedPlayer"
      :current-season-year="currentSeasonYear"
      @close="closePlayer"
    />
  </div>
</template>

<style scoped>
.trading-block-tab {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.block-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-title {
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--color-text-primary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.5rem 1rem;
  gap: 0.5rem;
}

.empty-icon {
  color: var(--color-text-secondary);
  opacity: 0.4;
}

.empty-state p {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  max-width: 400px;
  margin: 0;
}

.players-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 12px;
}

@media (max-width: 415px) {
  .players-grid {
    grid-template-columns: 1fr;
  }
}

.player-card {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  min-width: 360px;
}

@media (max-width: 415px) {
  .player-card {
    min-width: 0;
  }
}

.player-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
  border-color: rgba(232, 90, 79, 0.3);
}

.card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.1);
}

.avatar-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.player-avatar {
  width: 80px;
  height: 80px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  position: relative;
}

.avatar-icon {
  stroke-width: 1.5;
}

.position-badges {
  display: flex;
  gap: 4px;
}

.position-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: white;
}

.player-main-info {
  flex: 1;
  min-width: 0;
}

.player-name {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-primary);
}

.player-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.vitals-row {
  font-size: 0.75rem;
  color: var(--color-text-primary);
}

.team-tag {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
}

.stats-inline {
  display: flex;
  gap: 0.75rem;
  margin-top: 6px;
}

.stat-inline {
  display: flex;
  align-items: baseline;
  gap: 3px;
  font-size: 0.75rem;
}

.stat-label {
  color: var(--color-text-tertiary);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.stat-val {
  color: var(--color-text-primary);
  font-weight: 600;
}

.rating-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.trade-btn {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: rgba(232, 90, 79, 0.12);
  border: 1px solid rgba(232, 90, 79, 0.25);
  color: #E85A4F;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.trade-btn:hover {
  background: rgba(232, 90, 79, 0.25);
  border-color: #E85A4F;
}
</style>
