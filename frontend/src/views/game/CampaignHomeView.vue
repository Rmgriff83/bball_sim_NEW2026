<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { useGameStore } from '@/stores/game'
import { useLeagueStore } from '@/stores/league'
import { GlassCard, BaseButton, LoadingSpinner, StatBadge } from '@/components/ui'

const route = useRoute()
const router = useRouter()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()
const gameStore = useGameStore()
const leagueStore = useLeagueStore()

const loading = ref(true)

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const team = computed(() => campaign.value?.team)
const roster = computed(() => campaign.value?.roster || [])

// Top 5 players by overall
const topPlayers = computed(() =>
  [...roster.value].sort((a, b) => b.overall_rating - a.overall_rating).slice(0, 5)
)

// Team's standing
const teamStanding = computed(() => {
  if (!team.value || !campaign.value?.standings) return null
  const conference = team.value.conference
  const standings = campaign.value.standings[conference] || []
  return standings.find(s => s.teamId === team.value.id)
})

const teamRank = computed(() => {
  if (!team.value || !campaign.value?.standings) return '-'
  const conference = team.value.conference
  const standings = campaign.value.standings[conference] || []
  const index = standings.findIndex(s => s.teamId === team.value.id)
  return index >= 0 ? index + 1 : '-'
})

onMounted(async () => {
  try {
    await campaignStore.fetchCampaign(campaignId.value)
    await leagueStore.fetchStandings(campaignId.value)
    await gameStore.fetchGames(campaignId.value)
  } catch (err) {
    console.error('Failed to load campaign:', err)
  } finally {
    loading.value = false
  }
})

async function handleSimulateDay() {
  try {
    await gameStore.simulateDay(campaignId.value)
    // Refresh all campaign data to sync standings, games, and date
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value),
      leagueStore.fetchStandings(campaignId.value),
      gameStore.fetchGames(campaignId.value),
    ])
  } catch (err) {
    console.error('Failed to simulate day:', err)
  }
}

function formatDate(dateString) {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
</script>

<template>
  <div class="p-6">
    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-12">
      <LoadingSpinner size="lg" />
    </div>

    <template v-else-if="campaign">
      <!-- Header -->
      <div class="flex items-start justify-between mb-8">
        <div>
          <h1 class="h2 text-gradient mb-2">{{ campaign.name }}</h1>
          <div class="flex items-center gap-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold"
              :style="{ backgroundColor: team?.primary_color || '#7c3aed' }"
            >
              {{ team?.abbreviation }}
            </div>
            <div>
              <p class="font-semibold">{{ team?.name }}</p>
              <p class="text-secondary text-sm">
                {{ team?.city }} - {{ team?.conference?.toUpperCase() }} Conference
              </p>
            </div>
          </div>
        </div>

        <div class="text-right">
          <p class="text-sm text-secondary">Current Date</p>
          <p class="h4">{{ formatDate(campaign.current_date) }}</p>
          <p class="text-sm text-secondary mt-1">Year {{ campaign.game_year }}</p>
        </div>
      </div>

      <!-- Quick Stats Row -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <GlassCard padding="md" :hoverable="false">
          <p class="text-secondary text-sm mb-1">Record</p>
          <p class="h3">{{ teamStanding?.wins || 0 }}-{{ teamStanding?.losses || 0 }}</p>
        </GlassCard>
        <GlassCard padding="md" :hoverable="false">
          <p class="text-secondary text-sm mb-1">Conf. Rank</p>
          <p class="h3">#{{ teamRank }}</p>
        </GlassCard>
        <GlassCard padding="md" :hoverable="false">
          <p class="text-secondary text-sm mb-1">Streak</p>
          <p class="h3">{{ teamStanding?.streak || '-' }}</p>
        </GlassCard>
        <GlassCard padding="md" :hoverable="false">
          <p class="text-secondary text-sm mb-1">Season Phase</p>
          <p class="h3 capitalize">{{ campaign.season?.phase || 'Preseason' }}</p>
        </GlassCard>
      </div>

      <!-- Main Content Grid -->
      <div class="grid lg:grid-cols-3 gap-6">
        <!-- Left Column - Actions & Games -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Quick Actions -->
          <GlassCard padding="lg" :hoverable="false">
            <h3 class="h4 mb-4">Quick Actions</h3>
            <div class="flex flex-wrap gap-3">
              <BaseButton
                variant="primary"
                :loading="gameStore.simulating"
                @click="handleSimulateDay"
              >
                Simulate Day
              </BaseButton>
              <BaseButton variant="secondary" @click="router.push(`/campaign/${campaignId}/team`)">
                Manage Roster
              </BaseButton>
              <BaseButton variant="secondary" @click="router.push(`/campaign/${campaignId}/league`)">
                View Standings
              </BaseButton>
            </div>
          </GlassCard>

          <!-- Next Game -->
          <GlassCard v-if="gameStore.nextUserGame" padding="lg" :hoverable="false">
            <h3 class="h4 mb-4">Next Game</h3>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-4">
                <div
                  class="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold"
                  :style="{ backgroundColor: team?.primary_color }"
                >
                  {{ team?.abbreviation }}
                </div>
                <span class="text-secondary">vs</span>
                <div
                  class="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold bg-gray-600"
                >
                  {{
                    gameStore.nextUserGame.home_team_id === team?.id
                      ? gameStore.nextUserGame.away_team?.abbreviation
                      : gameStore.nextUserGame.home_team?.abbreviation
                  }}
                </div>
              </div>
              <div class="text-right">
                <p class="text-sm text-secondary">
                  {{ formatDate(gameStore.nextUserGame.game_date) }}
                </p>
                <p class="text-sm">
                  {{ gameStore.nextUserGame.home_team_id === team?.id ? 'Home' : 'Away' }}
                </p>
              </div>
            </div>
            <div class="mt-4">
              <BaseButton
                variant="primary"
                class="w-full"
                @click="router.push(`/campaign/${campaignId}/game/${gameStore.nextUserGame.id}`)"
              >
                Play Game
              </BaseButton>
            </div>
          </GlassCard>

          <!-- Recent Results -->
          <GlassCard padding="lg" :hoverable="false">
            <h3 class="h4 mb-4">Recent Results</h3>
            <div v-if="gameStore.completedGames.length === 0" class="text-secondary">
              No games played yet.
            </div>
            <div v-else class="space-y-3">
              <div
                v-for="game in gameStore.completedGames.slice(-5).reverse()"
                :key="game.id"
                class="flex items-center justify-between p-3 glass-card cursor-pointer"
                @click="router.push(`/campaign/${campaignId}/game/${game.id}`)"
              >
                <div class="flex items-center gap-2">
                  <span class="text-xs text-secondary">{{ formatDate(game.game_date) }}</span>
                  <span>{{ game.home_team?.abbreviation }}</span>
                  <span class="text-secondary">vs</span>
                  <span>{{ game.away_team?.abbreviation }}</span>
                </div>
                <div class="font-mono font-bold">
                  {{ game.home_score }} - {{ game.away_score }}
                </div>
              </div>
            </div>
          </GlassCard>
        </div>

        <!-- Right Column - Roster & News -->
        <div class="space-y-6">
          <!-- Top Players -->
          <GlassCard padding="lg" :hoverable="false">
            <div class="flex items-center justify-between mb-4">
              <h3 class="h4">Top Players</h3>
              <button
                class="text-sm text-primary hover:text-primary-light"
                @click="router.push(`/campaign/${campaignId}/team`)"
              >
                View All
              </button>
            </div>
            <div class="space-y-3">
              <div
                v-for="player in topPlayers"
                :key="player.id"
                class="flex items-center justify-between"
              >
                <div class="flex items-center gap-3">
                  <StatBadge :value="player.overall_rating" size="sm" />
                  <div>
                    <p class="font-medium">{{ player.name }}</p>
                    <p class="text-xs text-secondary">{{ player.position }}</p>
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>

          <!-- News Feed -->
          <GlassCard padding="lg" :hoverable="false">
            <h3 class="h4 mb-4">Latest News</h3>
            <div v-if="campaign.news?.length === 0" class="text-secondary">
              No news yet.
            </div>
            <div v-else class="space-y-3">
              <div
                v-for="news in (campaign.news || []).slice(0, 5)"
                :key="news.id"
                class="border-b border-white/10 pb-3 last:border-0"
              >
                <p class="text-sm font-medium">{{ news.headline }}</p>
                <p class="text-xs text-secondary mt-1">
                  {{ formatDate(news.game_date) }}
                </p>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </template>
  </div>
</template>
