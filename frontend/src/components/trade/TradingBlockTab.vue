<script setup>
import { ref, computed, onMounted } from 'vue'
import { useTradeStore } from '@/stores/trade'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { GlassCard, StatBadge, LoadingSpinner } from '@/components/ui'
import { Repeat, Users, ArrowRightLeft } from 'lucide-vue-next'
import PlayerDetailModal from '@/components/team/PlayerDetailModal.vue'

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

function openPlayer(player) {
  selectedPlayer.value = player
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
          leaguePlayers.push({ ...player, _teamId: team.id, _teamName: `${team.city} ${team.name}`, _teamAbbr: team.abbreviation })
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
        <div v-else class="player-list">
          <div
            v-for="player in userBlockPlayers"
            :key="player.id"
            class="player-row"
            @click="openPlayer(player)"
          >
            <div class="player-pos-badge" :class="getPlayerPosition(player).toLowerCase()">
              {{ getPlayerPosition(player) }}
            </div>
            <div class="player-info">
              <span class="player-name">{{ getPlayerName(player) }}</span>
              <span class="player-team">Your Team</span>
            </div>
            <div class="player-stats" v-if="getStatLine(player.id)">
              <span>{{ getStatLine(player.id).ppg }} PPG</span>
              <span>{{ getStatLine(player.id).rpg }} RPG</span>
              <span>{{ getStatLine(player.id).apg }} APG</span>
            </div>
            <StatBadge :value="getPlayerRating(player)" size="md" />
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
        <div v-else class="player-list">
          <div
            v-for="player in leagueBlockPlayers"
            :key="player.id"
            class="player-row"
            @click="openPlayer(player)"
          >
            <div class="player-pos-badge" :class="getPlayerPosition(player).toLowerCase()">
              {{ getPlayerPosition(player) }}
            </div>
            <div class="player-info">
              <span class="player-name">{{ getPlayerName(player) }}</span>
              <span class="player-team">{{ player._teamAbbr || getTeamAbbr(player) }}</span>
            </div>
            <div class="player-stats" v-if="getStatLine(player.id)">
              <span>{{ getStatLine(player.id).ppg }} PPG</span>
              <span>{{ getStatLine(player.id).rpg }} RPG</span>
              <span>{{ getStatLine(player.id).apg }} APG</span>
            </div>
            <StatBadge :value="getPlayerRating(player)" size="md" />
            <button class="trade-btn" @click="startTrade(player, $event)" title="Start trade">
              <ArrowRightLeft :size="14" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Player Detail Modal -->
    <PlayerDetailModal
      :show="showPlayerModal"
      :player="selectedPlayer"
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

.player-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.player-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.player-row:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

.player-pos-badge {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.7rem;
  color: white;
  text-transform: uppercase;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.1);
}

.player-pos-badge.pg { background: #3B82F6; }
.player-pos-badge.sg { background: #10B981; }
.player-pos-badge.sf { background: #F59E0B; }
.player-pos-badge.pf { background: #EF4444; }
.player-pos-badge.c { background: #8B5CF6; }

.player-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.player-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-team {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.player-stats {
  display: flex;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
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
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.trade-btn:hover {
  background: rgba(232, 90, 79, 0.25);
  border-color: #E85A4F;
}

@media (max-width: 600px) {
  .player-stats {
    display: none;
  }
}
</style>
