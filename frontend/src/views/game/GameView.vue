<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useCampaignStore } from '@/stores/campaign'
import { useLeagueStore } from '@/stores/league'
import { GlassCard, BaseButton, LoadingSpinner, StatBadge, BaseModal } from '@/components/ui'
import { User } from 'lucide-vue-next'
import BasketballCourt from '@/components/game/BasketballCourt.vue'
import BoxScore from '@/components/game/BoxScore.vue'
import PlayAnimator from '@/components/game/PlayAnimator.vue'
import { usePlayAnimation } from '@/composables/usePlayAnimation'
import { usePositionValidation } from '@/composables/usePositionValidation'

const route = useRoute()
const router = useRouter()
const gameStore = useGameStore()
const campaignStore = useCampaignStore()
const leagueStore = useLeagueStore()

// Animation composable
const {
  animationData,
  currentPossessionIndex,
  isPlaying,
  playbackSpeed,
  progress,
  currentPlayName,
  currentTeam,
  currentQuarter,
  currentDescription,
  totalPossessions,
  interpolatedPositions,
  interpolatedBallPosition,
  isQuarterBreak,
  completedQuarter,
  currentHomeScore,
  currentAwayScore,
  loadAnimationData,
  play,
  pause,
  stop,
  togglePlayPause,
  nextPossession,
  previousPossession,
  setSpeed,
  seekTo,
  continueAfterQuarterBreak,
  cleanup
} = usePlayAnimation()

const loading = ref(true)
const simulating = ref(false)
const activeBoxScoreTab = ref('home')
const showPlayByPlay = ref(false)
const showAnimationMode = ref(false)
const courtRef = ref(null)

// Live simulation state
const isLiveMode = ref(false)
const gameJustCompleted = ref(false)  // True when final quarter just finished

// Coaching style selections for quarter breaks
const selectedOffense = ref('balanced')
const selectedDefense = ref('man')

// Lineup selections for quarter breaks (5 player IDs)
const selectedLineup = ref([null, null, null, null, null])
const positionLabels = ['PG', 'SG', 'SF', 'PF', 'C']

// Available coaching styles
const offensiveStyles = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'motion', label: 'Motion' },
  { value: 'iso_heavy', label: 'Isolation Heavy' },
  { value: 'post_centric', label: 'Post Centric' },
  { value: 'three_point', label: 'Three Point' },
  { value: 'run_and_gun', label: 'Run & Gun' },
]

const defensiveStyles = [
  { value: 'man', label: 'Man-to-Man' },
  { value: 'zone_2_3', label: 'Zone 2-3' },
  { value: 'zone_3_2', label: 'Zone 3-2' },
  { value: 'zone_1_3_1', label: 'Zone 1-3-1' },
  { value: 'press', label: 'Full Court Press' },
  { value: 'trap', label: 'Trap' },
]

const campaignId = computed(() => route.params.id)
const gameId = computed(() => route.params.gameId)
const game = computed(() => gameStore.currentGame)
const campaign = computed(() => campaignStore.currentCampaign)
const userTeam = computed(() => campaign.value?.team)

const homeTeam = computed(() => game.value?.home_team)
const awayTeam = computed(() => game.value?.away_team)
const isComplete = computed(() => game.value?.is_complete)
const isInProgress = computed(() => game.value?.is_in_progress)
const savedQuarter = computed(() => game.value?.current_quarter)
const isUserGame = computed(() => game.value?.is_user_game)

// Determine if user is home or away
const userIsHome = computed(() =>
  userTeam.value?.id === homeTeam.value?.id
)

// Get winner
const winner = computed(() => {
  if (!isComplete.value) return null
  return game.value.home_score > game.value.away_score ? 'home' : 'away'
})

const userWon = computed(() => {
  if (!isUserGame.value || !isComplete.value) return null
  return (userIsHome.value && winner.value === 'home') ||
         (!userIsHome.value && winner.value === 'away')
})

// Team standings for display
const getTeamStanding = (team) => {
  if (!team) return null
  const conference = team.conference
  const standings = conference === 'east'
    ? leagueStore.eastStandings
    : leagueStore.westStandings
  return standings.find(s =>
    s.teamId === team.id || s.team_id === team.id ||
    s.team?.id === team.id || s.team?.abbreviation === team.abbreviation
  )
}

const homeTeamStanding = computed(() => getTeamStanding(homeTeam.value))
const awayTeamStanding = computed(() => getTeamStanding(awayTeam.value))

const homeTeamRecord = computed(() => {
  const s = homeTeamStanding.value
  return s ? `${s.wins || 0}-${s.losses || 0}` : ''
})

const awayTeamRecord = computed(() => {
  const s = awayTeamStanding.value
  return s ? `${s.wins || 0}-${s.losses || 0}` : ''
})

const homeTeamRank = computed(() => {
  if (!homeTeam.value) return null
  return leagueStore.getTeamRank(homeTeam.value.id, homeTeam.value.conference)
})

const awayTeamRank = computed(() => {
  if (!awayTeam.value) return null
  return leagueStore.getTeamRank(awayTeam.value.id, awayTeam.value.conference)
})

const getConferenceLabel = (team) => {
  if (!team?.conference) return ''
  return team.conference === 'east' ? 'EAST' : 'WEST'
}

// Box score data
const boxScore = computed(() => {
  const bs = game.value?.box_score
  return {
    home: Array.isArray(bs?.home) ? bs.home : [],
    away: Array.isArray(bs?.away) ? bs.away : []
  }
})

// User's team players for lineup selection
const userTeamPlayers = computed(() => {
  if (userIsHome.value) {
    return boxScore.value.home
  }
  return boxScore.value.away
})

// Position validation for lineup selection
const { canPlayPosition } = usePositionValidation()

// Eligible players per position slot (filtered by position and injury status)
const eligiblePlayersForSlot = computed(() => {
  const result = {}
  const players = userTeamPlayers.value

  positionLabels.forEach((pos, index) => {
    // Get IDs of players already selected in OTHER slots
    const excludeIds = selectedLineup.value
      .filter((id, i) => i !== index && id != null)

    // Filter to players who can play this position, aren't injured, and aren't selected elsewhere
    result[pos] = players.filter(p => {
      const canPlay = p.position === pos || p.secondary_position === pos
      const isHealthy = !p.is_injured && !p.isInjured
      return canPlay && isHealthy && !excludeIds.includes(p.player_id)
    })
  })

  return result
})

// Play by play (if available)
const playByPlay = computed(() => game.value?.play_by_play || [])

// Quarter scores (can come from direct property or from box_score)
const quarterScores = computed(() => {
  const qs = game.value?.quarter_scores || game.value?.box_score?.quarter_scores
  if (qs && Array.isArray(qs.home) && qs.home.length > 0) {
    return qs
  }
  return { home: [0, 0, 0, 0], away: [0, 0, 0, 0] }
})

onMounted(async () => {
  try {
    // If no gameId provided (from /play route), get the next user game
    if (!gameId.value) {
      await gameStore.fetchGames(campaignId.value)
      const nextGame = gameStore.nextUserGame
      if (nextGame) {
        // Load the game directly and update URL silently
        await gameStore.fetchGame(campaignId.value, nextGame.id)
        // Update the URL without triggering a navigation
        router.replace(`/campaign/${campaignId.value}/game/${nextGame.id}`)
      } else {
        // No next game available, redirect to home
        router.replace(`/campaign/${campaignId.value}`)
      }
    } else {
      await gameStore.fetchGame(campaignId.value, gameId.value)
    }
  } catch (err) {
    console.error('Failed to load game:', err)
  } finally {
    loading.value = false
  }
})

/**
 * Start a live quarter-by-quarter game simulation.
 * If game is already in progress, continues from saved state.
 */
async function simulateGame() {
  simulating.value = true
  isLiveMode.value = true
  showAnimationMode.value = true

  try {
    let result

    // If game is already in progress, continue from where we left off
    if (isInProgress.value) {
      result = await gameStore.continueGame(campaignId.value, gameId.value, {
        offensive_style: selectedOffense.value,
        defensive_style: selectedDefense.value,
      })
    } else {
      result = await gameStore.startLiveGame(campaignId.value, gameId.value)
    }

    // Load animation data and auto-play
    if (result.animation_data?.possessions?.length > 0) {
      // Pass live mode options so composable knows to trigger quarter break at end
      loadAnimationData(result.animation_data, {
        isLive: true,
        quarter: result.quarter || 1
      })
      setTimeout(() => {
        play()
      }, 500)
    }

    // Check if game completed
    if (result.isGameComplete) {
      isLiveMode.value = false
      await leagueStore.fetchStandings(campaignId.value)
    }
  } catch (err) {
    console.error('Failed to start/continue game:', err)
    alert('Failed to start game')
    showAnimationMode.value = false
    isLiveMode.value = false
  } finally {
    simulating.value = false
  }
}

/**
 * Continue to next quarter with coaching adjustments.
 */
async function continueToNextQuarter() {
  simulating.value = true

  try {
    // Gather coaching adjustments and lineup
    const adjustments = {
      offensive_style: selectedOffense.value,
      defensive_style: selectedDefense.value,
    }

    // Add lineup based on whether user is home or away (only if all 5 slots have valid IDs)
    const validLineup = selectedLineup.value.filter(id => id !== null && id !== undefined)
    if (validLineup.length === 5) {
      if (userIsHome.value) {
        adjustments.home_lineup = validLineup
      } else {
        adjustments.away_lineup = validLineup
      }
    }

    const result = await gameStore.continueGame(campaignId.value, gameId.value, adjustments)

    // Track if game just completed so we can show the game complete overlay
    if (result.isGameComplete) {
      gameJustCompleted.value = true
      isLiveMode.value = false
      // Refresh standings after game completes
      await leagueStore.fetchStandings(campaignId.value)
    }

    // Load this quarter's animation data and play
    if (result.animation_data?.possessions?.length > 0) {
      // Always set isLive: true so we get the overlay at the end
      // The overlay will show different content based on gameJustCompleted
      loadAnimationData(result.animation_data, {
        isLive: true,
        quarter: result.quarter
      })
      setTimeout(() => {
        play()
      }, 500)
    }
  } catch (err) {
    console.error('Failed to continue game:', err)
    alert('Failed to continue game')
  } finally {
    simulating.value = false
  }
}

/**
 * Handle quarter break continue button.
 * In live mode, calls server for next quarter.
 * In replay mode, just resumes animation.
 */
function handleQuarterBreakContinue() {
  if (isLiveMode.value) {
    continueToNextQuarter()
  } else {
    continueAfterQuarterBreak()
  }
}

/**
 * Handle viewing box score after game completion.
 * Closes animation mode to show the stats view.
 */
function viewBoxScore() {
  showAnimationMode.value = false
  gameJustCompleted.value = false
  // Refresh the game data to get final stats
  gameStore.fetchGame(campaignId.value, gameId.value)
}

function goBack() {
  router.push(`/campaign/${campaignId.value}`)
}

function formatDate(dateString) {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

function getTopPerformers(stats) {
  if (!stats || !Array.isArray(stats) || stats.length === 0) return []
  return [...stats]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, 3)
}

const homeTopPerformers = computed(() => getTopPerformers(boxScore.value.home))
const awayTopPerformers = computed(() => getTopPerformers(boxScore.value.away))

// Player modal state
const showPlayerModal = ref(false)
const selectedPlayer = ref(null)

function openPlayerModal(player) {
  selectedPlayer.value = player
  showPlayerModal.value = true
}

function closePlayerModal() {
  showPlayerModal.value = false
  selectedPlayer.value = null
}

function getPositionColor(position) {
  const colors = { PG: '#3B82F6', SG: '#10B981', SF: '#F59E0B', PF: '#EF4444', C: '#8B5CF6' }
  return colors[position] || '#6B7280'
}

// Animation data from game result
const gameAnimationData = computed(() => game.value?.animation_data || null)

// Has animation data available (from stored game OR loaded into composable)
const hasAnimationData = computed(() => {
  return gameAnimationData.value?.possessions?.length > 0 ||
         animationData.value?.possessions?.length > 0
})

// Load animation when game data is available
watch(gameAnimationData, (newData) => {
  if (newData && newData.possessions?.length > 0) {
    loadAnimationData(newData)
  }
}, { immediate: true })

// Initialize lineup selections when entering quarter break
// Watch both the break state and the players data to handle timing issues
watch(
  [isQuarterBreak, userTeamPlayers],
  ([isBreak, players]) => {
    if (isBreak && isLiveMode.value && players.length >= 5) {
      // Only initialize if not already set (all nulls)
      if (selectedLineup.value.every(id => id === null)) {
        // Sort by minutes played (descending)
        const sortedPlayers = [...players]
          .filter(p => p.player_id != null)
          .sort((a, b) => (b.minutes || 0) - (a.minutes || 0))

        // Select best player for each position who can play that position
        const selectedIds = []
        const newLineup = []

        positionLabels.forEach(pos => {
          const eligible = sortedPlayers.find(p => {
            const canPlay = p.position === pos || p.secondary_position === pos
            return canPlay && !selectedIds.includes(p.player_id)
          })
          if (eligible) {
            newLineup.push(eligible.player_id)
            selectedIds.push(eligible.player_id)
          } else {
            newLineup.push(null)
          }
        })

        if (newLineup.filter(id => id !== null).length >= 5) {
          selectedLineup.value = newLineup
        }
      }
    }
  },
  { immediate: true }
)

// Toggle animation mode
function toggleAnimationMode() {
  showAnimationMode.value = !showAnimationMode.value
  if (!showAnimationMode.value) {
    stop()
  }
  // Clear trails when switching modes
  if (courtRef.value?.clearTrails) {
    courtRef.value.clearTrails()
  }
}

// Handle seek from progress bar click
function handleSeek(percent) {
  if (!animationData.value) return
  const possession = animationData.value.possessions[currentPossessionIndex.value]
  if (possession) {
    seekTo(percent * possession.duration)
  }
}

// Cleanup on unmount
onUnmounted(() => {
  cleanup()
})
</script>

<template>
  <div class="game-view p-6">
    <!-- Loading -->
    <div v-if="loading" class="flex justify-center items-center py-12 opacity-60">
      <LoadingSpinner size="md" />
    </div>

    <template v-else-if="game">
      <!-- Back Button -->
      <button class="back-btn mb-6" @click="goBack">
        &larr; Back to Campaign
      </button>

      <!-- Game Header -->
      <GlassCard padding="lg" :hoverable="false" class="mb-6">
        <div class="game-header">
          <!-- Away Team -->
          <div class="team-side away" :class="{ winner: winner === 'away' }">
            <div class="team-badge-wrapper">
              <div
                class="team-badge-game"
                :style="{ backgroundColor: awayTeam?.primary_color || '#6B7280' }"
              >
                <span class="badge-abbr">{{ awayTeam?.abbreviation }}</span>
                <span class="badge-record">{{ awayTeamRecord }}</span>
              </div>
              <div class="team-info">
                <span v-if="awayTeam?.overall_rating" class="team-rating">{{ awayTeam.overall_rating }} OVR</span>
                <span v-if="awayTeamRank" class="team-rank">#{{ awayTeamRank }} {{ getConferenceLabel(awayTeam) }}</span>
              </div>
            </div>
            <div v-if="isComplete" class="team-score-lg">
              {{ game.away_score }}
            </div>
          </div>

          <!-- Center Info -->
          <div class="game-center">
            <p v-if="!isComplete" class="vs-text">VS</p>
            <p v-else class="final-text">FINAL</p>
            <p class="game-date">{{ formatDate(game.game_date) }}</p>
            <p v-if="isUserGame" class="user-game-badge">Your Game</p>
          </div>

          <!-- Home Team -->
          <div class="team-side home" :class="{ winner: winner === 'home' }">
            <div v-if="isComplete" class="team-score-lg">
              {{ game.home_score }}
            </div>
            <div class="team-badge-wrapper">
              <div
                class="team-badge-game"
                :style="{ backgroundColor: homeTeam?.primary_color || '#6B7280' }"
              >
                <span class="badge-abbr">{{ homeTeam?.abbreviation }}</span>
                <span class="badge-record">{{ homeTeamRecord }}</span>
              </div>
              <div class="team-info">
                <span v-if="homeTeam?.overall_rating" class="team-rating">{{ homeTeam.overall_rating }} OVR</span>
                <span v-if="homeTeamRank" class="team-rank">#{{ homeTeamRank }} {{ getConferenceLabel(homeTeam) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Result Banner (for user games) -->
        <div v-if="isUserGame && isComplete" class="result-banner" :class="{ win: userWon, loss: !userWon }">
          {{ userWon ? 'Victory!' : 'Defeat' }}
        </div>
      </GlassCard>

      <!-- Pre-Game (Not Simulated Yet) OR Live Animation Mode -->
      <template v-if="!isComplete || (showAnimationMode && hasAnimationData)">
        <!-- Live Game Simulation View (during sim or replay) -->
        <template v-if="showAnimationMode && (simulating || hasAnimationData)">
          <GlassCard padding="lg" :hoverable="false" class="mb-6">
            <div class="live-game-header mb-4">
              <h3 class="h4">{{ simulating ? 'Live Game' : 'Game Replay' }}</h3>
              <div class="live-game-info">
                <!-- Running Score (during animation) -->
                <div v-if="hasAnimationData && currentPossessionIndex >= 0" class="live-score">
                  <span class="live-team" :style="{ color: awayTeam?.primary_color }">
                    {{ awayTeam?.abbreviation }} {{ currentAwayScore }}
                  </span>
                  <span class="score-separator">-</span>
                  <span class="live-team" :style="{ color: homeTeam?.primary_color }">
                    {{ currentHomeScore }} {{ homeTeam?.abbreviation }}
                  </span>
                </div>
                <div v-if="simulating || isPlaying" class="live-indicator">
                  <span class="live-dot"></span>
                  {{ simulating ? 'SIMULATING' : 'PLAYING' }}
                </div>
              </div>
            </div>

            <!-- Animated Court -->
            <div class="court-container court-with-overlay mb-4">
              <BasketballCourt
                ref="courtRef"
                :width="700"
                :height="420"
                :home-team="homeTeam"
                :away-team="awayTeam"
                :animation-mode="true"
                :interpolated-positions="interpolatedPositions"
                :interpolated-ball-position="interpolatedBallPosition"
                :home-roster="boxScore.home"
                :away-roster="boxScore.away"
                :show-trails="true"
              />

              <!-- Quarter Break / Game Complete Overlay -->
              <Transition name="fade">
                <div v-if="isQuarterBreak" class="quarter-break-overlay">
                  <div class="quarter-break-content">
                    <!-- Game Complete Header -->
                    <template v-if="gameJustCompleted">
                      <h2 class="quarter-break-title game-complete-title">Final</h2>
                      <p class="game-complete-subtitle">Game Complete</p>
                    </template>
                    <!-- Quarter Break Header -->
                    <template v-else>
                      <h2 class="quarter-break-title">End of Quarter {{ completedQuarter }}</h2>
                    </template>

                    <div class="quarter-break-score">
                      <div class="break-team">
                        <span class="break-team-name">{{ awayTeam?.name }}</span>
                        <span class="break-team-score" :style="{ color: awayTeam?.primary_color }">
                          {{ currentAwayScore }}
                        </span>
                      </div>
                      <div class="break-divider">-</div>
                      <div class="break-team">
                        <span class="break-team-score" :style="{ color: homeTeam?.primary_color }">
                          {{ currentHomeScore }}
                        </span>
                        <span class="break-team-name">{{ homeTeam?.name }}</span>
                      </div>
                    </div>

                    <!-- Coaching Adjustments (only in live mode during quarter breaks, not game complete) -->
                    <div v-if="isLiveMode && !gameJustCompleted" class="coaching-adjustments">
                      <div class="adjustment-row">
                        <label class="adjustment-label">Offense</label>
                        <select v-model="selectedOffense" class="adjustment-select">
                          <option v-for="style in offensiveStyles" :key="style.value" :value="style.value">
                            {{ style.label }}
                          </option>
                        </select>
                      </div>
                      <div class="adjustment-row">
                        <label class="adjustment-label">Defense</label>
                        <select v-model="selectedDefense" class="adjustment-select">
                          <option v-for="style in defensiveStyles" :key="style.value" :value="style.value">
                            {{ style.label }}
                          </option>
                        </select>
                      </div>

                      <!-- Lineup Adjustments -->
                      <div class="lineup-adjustments">
                        <div class="adjustment-section-title">Starting Lineup</div>
                        <p class="injured-note">Injured players are not available</p>
                        <div v-for="(slot, index) in positionLabels" :key="slot" class="adjustment-row">
                          <label class="adjustment-label">{{ slot }}</label>
                          <select v-model="selectedLineup[index]" class="adjustment-select">
                            <option :value="null">Select {{ slot }}...</option>
                            <option v-for="player in eligiblePlayersForSlot[slot]" :key="player.player_id" :value="player.player_id">
                              {{ player.name }} ({{ player.position }}<template v-if="player.secondary_position">/{{ player.secondary_position }}</template>)
                            </option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <p v-if="!isLiveMode && !gameJustCompleted" class="break-hint">Replay mode - no adjustments available</p>

                    <!-- Game Complete: View Box Score Button -->
                    <template v-if="gameJustCompleted">
                      <p class="break-hint">View the full box score and game statistics</p>
                      <BaseButton
                        variant="primary"
                        size="lg"
                        @click="viewBoxScore"
                      >
                        View Box Score
                      </BaseButton>
                    </template>

                    <!-- Quarter Break: Continue Button -->
                    <template v-else>
                      <BaseButton
                        variant="primary"
                        size="lg"
                        :loading="simulating"
                        @click="handleQuarterBreakContinue"
                      >
                        {{ simulating ? 'Simulating...' : `Continue to Quarter ${completedQuarter + 1}` }}
                      </BaseButton>
                    </template>
                  </div>
                </div>
              </Transition>
            </div>

            <!-- Animation Controls -->
            <PlayAnimator
              v-if="hasAnimationData"
              :is-playing="isPlaying"
              :current-possession-index="currentPossessionIndex"
              :total-possessions="totalPossessions"
              :progress="progress"
              :playback-speed="playbackSpeed"
              :current-play-name="currentPlayName"
              :current-team="currentTeam"
              :current-quarter="currentQuarter"
              :current-description="currentDescription"
              :home-team-name="homeTeam?.name || 'Home'"
              :away-team-name="awayTeam?.name || 'Away'"
              :home-team-color="homeTeam?.primary_color || '#3B82F6'"
              :away-team-color="awayTeam?.primary_color || '#EF4444'"
              @play="play"
              @pause="pause"
              @stop="stop"
              @toggle-play-pause="togglePlayPause"
              @next-possession="nextPossession"
              @previous-possession="previousPossession"
              @set-speed="setSpeed"
              @seek="handleSeek"
            />

            <!-- Loading indicator while waiting for animation data -->
            <div v-else class="flex items-center justify-center py-8">
              <LoadingSpinner size="md" />
              <span class="ml-4 text-secondary">Preparing game simulation...</span>
            </div>

            <!-- View Stats Button (after game is complete) -->
            <div v-if="isComplete && hasAnimationData" class="mt-4 flex justify-center">
              <BaseButton
                variant="secondary"
                @click="showAnimationMode = false"
              >
                View Game Stats
              </BaseButton>
            </div>
          </GlassCard>
        </template>

        <!-- Pre-game Setup View (when not simulating) -->
        <template v-else>
          <div class="grid lg:grid-cols-2 gap-6">
            <!-- Court Preview -->
            <GlassCard padding="lg" :hoverable="false">
              <h3 class="h4 mb-4">Court Preview</h3>
              <div class="court-container">
                <BasketballCourt
                  :width="500"
                  :height="300"
                  :home-team="homeTeam"
                  :away-team="awayTeam"
                  :show-players="false"
                />
              </div>
            </GlassCard>

            <!-- Matchup Info -->
            <GlassCard padding="lg" :hoverable="false">
              <h3 class="h4 mb-4">Matchup Preview</h3>
              <div class="matchup-grid">
                <div class="matchup-item">
                  <span class="matchup-label">Home Advantage</span>
                  <span class="matchup-value">{{ homeTeam?.abbreviation }}</span>
                </div>
                <div class="matchup-item">
                  <span class="matchup-label">Game Type</span>
                  <span class="matchup-value">Regular Season</span>
                </div>
              </div>

              <!-- Simulate Button -->
              <div v-if="isUserGame" class="mt-6">
                <BaseButton
                  variant="primary"
                  size="lg"
                  class="w-full"
                  :loading="simulating"
                  @click="simulateGame"
                >
                  {{ isInProgress ? `Resume Game (Q${savedQuarter + 1})` : 'Play Game' }}
                </BaseButton>
              </div>
              <div v-else class="mt-6">
                <BaseButton
                  variant="secondary"
                  size="lg"
                  class="w-full"
                  :loading="simulating"
                  @click="simulateGame"
                >
                  {{ isInProgress ? 'Resume Simulation' : 'Simulate Game' }}
                </BaseButton>
              </div>
            </GlassCard>
          </div>
        </template>
      </template>

      <!-- Post-Game (Completed) -->
      <template v-else>
        <!-- Quarter Scores -->
        <GlassCard padding="md" :hoverable="false" class="mb-6">
          <div class="quarter-scores">
            <table class="quarters-table">
              <thead>
                <tr>
                  <th class="team-header"></th>
                  <th>Q1</th>
                  <th>Q2</th>
                  <th>Q3</th>
                  <th>Q4</th>
                  <th v-if="quarterScores.home?.length > 4">OT</th>
                  <th class="total-col">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr :class="{ winner: winner === 'away' }">
                  <td class="team-header">
                    <div class="team-mini">
                      <div
                        class="team-dot"
                        :style="{ backgroundColor: awayTeam?.primary_color }"
                      />
                      {{ awayTeam?.abbreviation }}
                    </div>
                  </td>
                  <td v-for="(score, i) in quarterScores.away" :key="i">{{ score }}</td>
                  <td class="total-col">{{ game.away_score }}</td>
                </tr>
                <tr :class="{ winner: winner === 'home' }">
                  <td class="team-header">
                    <div class="team-mini">
                      <div
                        class="team-dot"
                        :style="{ backgroundColor: homeTeam?.primary_color }"
                      />
                      {{ homeTeam?.abbreviation }}
                    </div>
                  </td>
                  <td v-for="(score, i) in quarterScores.home" :key="i">{{ score }}</td>
                  <td class="total-col">{{ game.home_score }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </GlassCard>

        <!-- Animation Mode -->
        <div v-if="hasAnimationData" class="mb-6">
          <BaseButton
            :variant="showAnimationMode ? 'primary' : 'secondary'"
            @click="toggleAnimationMode"
          >
            {{ showAnimationMode ? 'Hide' : 'Watch' }} Game Animation
          </BaseButton>
        </div>

        <!-- Animated Court Viewer -->
        <GlassCard v-if="showAnimationMode && hasAnimationData" padding="lg" :hoverable="false" class="mb-6">
          <h3 class="h4 mb-4">Game Replay</h3>

          <!-- Court with animation -->
          <div class="court-container court-with-overlay mb-4">
            <BasketballCourt
              ref="courtRef"
              :width="700"
              :height="420"
              :home-team="homeTeam"
              :away-team="awayTeam"
              :animation-mode="true"
              :interpolated-positions="interpolatedPositions"
              :interpolated-ball-position="interpolatedBallPosition"
              :home-roster="boxScore.home"
              :away-roster="boxScore.away"
              :show-trails="true"
            />

            <!-- Quarter Break Overlay (for replay) -->
            <Transition name="fade">
              <div v-if="isQuarterBreak" class="quarter-break-overlay">
                <div class="quarter-break-content">
                  <h2 class="quarter-break-title">End of Quarter {{ completedQuarter }}</h2>
                  <div class="quarter-break-score">
                    <div class="break-team">
                      <span class="break-team-name">{{ awayTeam?.name }}</span>
                      <span class="break-team-score" :style="{ color: awayTeam?.primary_color }">
                        {{ currentAwayScore }}
                      </span>
                    </div>
                    <div class="break-divider">-</div>
                    <div class="break-team">
                      <span class="break-team-score" :style="{ color: homeTeam?.primary_color }">
                        {{ currentHomeScore }}
                      </span>
                      <span class="break-team-name">{{ homeTeam?.name }}</span>
                    </div>
                  </div>
                  <p class="break-hint">Replay mode - click to continue</p>
                  <BaseButton variant="primary" size="lg" @click="handleQuarterBreakContinue">
                    Continue to Quarter {{ completedQuarter + 1 }}
                  </BaseButton>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Animation Controls -->
          <PlayAnimator
            :is-playing="isPlaying"
            :current-possession-index="currentPossessionIndex"
            :total-possessions="totalPossessions"
            :progress="progress"
            :playback-speed="playbackSpeed"
            :current-play-name="currentPlayName"
            :current-team="currentTeam"
            :current-quarter="currentQuarter"
            :current-description="currentDescription"
            :home-team-name="homeTeam?.name || 'Home'"
            :away-team-name="awayTeam?.name || 'Away'"
            :home-team-color="homeTeam?.primary_color || '#3B82F6'"
            :away-team-color="awayTeam?.primary_color || '#EF4444'"
            @play="play"
            @pause="pause"
            @stop="stop"
            @toggle-play-pause="togglePlayPause"
            @next-possession="nextPossession"
            @previous-possession="previousPossession"
            @set-speed="setSpeed"
            @seek="handleSeek"
          />
        </GlassCard>

        <!-- Top Performers -->
        <div class="grid md:grid-cols-2 gap-6 mb-6">
          <GlassCard padding="md" :hoverable="false">
            <h3 class="performers-header">{{ awayTeam?.abbreviation }} Top Performers</h3>
            <div class="performers-list">
              <div
                v-for="player in awayTopPerformers"
                :key="player.player_id"
                class="performer-card"
                @click="openPlayerModal(player)"
              >
                <div class="performer-avatar">
                  <User class="avatar-icon" :size="24" />
                </div>
                <div class="performer-main">
                  <div class="performer-identity">
                    <span class="performer-name">{{ player.name }}</span>
                    <div class="performer-meta">
                      <span
                        class="position-badge"
                        :style="{ backgroundColor: getPositionColor(player.position) }"
                      >
                        {{ player.position }}<template v-if="player.secondary_position">/{{ player.secondary_position }}</template>
                      </span>
                    </div>
                  </div>
                  <div class="performer-stats">
                    <div class="stat-item-inline">
                      <span class="stat-value-highlight">{{ player.points }}</span>
                      <span class="stat-label-sm">PTS</span>
                    </div>
                    <div class="stat-item-inline">
                      <span class="stat-value-sm">{{ player.rebounds }}</span>
                      <span class="stat-label-sm">REB</span>
                    </div>
                    <div class="stat-item-inline">
                      <span class="stat-value-sm">{{ player.assists }}</span>
                      <span class="stat-label-sm">AST</span>
                    </div>
                  </div>
                </div>
                <div class="performer-chevron">&rsaquo;</div>
              </div>
            </div>
          </GlassCard>

          <GlassCard padding="md" :hoverable="false">
            <h3 class="performers-header">{{ homeTeam?.abbreviation }} Top Performers</h3>
            <div class="performers-list">
              <div
                v-for="player in homeTopPerformers"
                :key="player.player_id"
                class="performer-card"
                @click="openPlayerModal(player)"
              >
                <div class="performer-avatar">
                  <User class="avatar-icon" :size="24" />
                </div>
                <div class="performer-main">
                  <div class="performer-identity">
                    <span class="performer-name">{{ player.name }}</span>
                    <div class="performer-meta">
                      <span
                        class="position-badge"
                        :style="{ backgroundColor: getPositionColor(player.position) }"
                      >
                        {{ player.position }}<template v-if="player.secondary_position">/{{ player.secondary_position }}</template>
                      </span>
                    </div>
                  </div>
                  <div class="performer-stats">
                    <div class="stat-item-inline">
                      <span class="stat-value-highlight">{{ player.points }}</span>
                      <span class="stat-label-sm">PTS</span>
                    </div>
                    <div class="stat-item-inline">
                      <span class="stat-value-sm">{{ player.rebounds }}</span>
                      <span class="stat-label-sm">REB</span>
                    </div>
                    <div class="stat-item-inline">
                      <span class="stat-value-sm">{{ player.assists }}</span>
                      <span class="stat-label-sm">AST</span>
                    </div>
                  </div>
                </div>
                <div class="performer-chevron">&rsaquo;</div>
              </div>
            </div>
          </GlassCard>
        </div>

        <!-- Box Score -->
        <GlassCard padding="none" :hoverable="false" class="mb-6">
          <BoxScore
            :box-score="boxScore"
            :home-team="homeTeam"
            :away-team="awayTeam"
            v-model:active-tab="activeBoxScoreTab"
          />
        </GlassCard>

        <!-- Play by Play Toggle -->
        <div v-if="playByPlay.length > 0" class="mb-6">
          <BaseButton
            variant="secondary"
            @click="showPlayByPlay = !showPlayByPlay"
          >
            {{ showPlayByPlay ? 'Hide' : 'Show' }} Play-by-Play
          </BaseButton>
        </div>

        <!-- Play by Play -->
        <GlassCard v-if="showPlayByPlay && playByPlay.length > 0" padding="lg" :hoverable="false">
          <h3 class="h4 mb-4">Play-by-Play</h3>
          <div class="play-by-play">
            <div
              v-for="(play, index) in playByPlay"
              :key="index"
              class="play-item"
              :class="play.type"
            >
              <span class="play-time">{{ play.time }}</span>
              <span class="play-team">{{ play.team }}</span>
              <span class="play-action">{{ play.description }}</span>
              <span v-if="play.points" class="play-score">
                {{ play.away_score }} - {{ play.home_score }}
              </span>
            </div>
          </div>
        </GlassCard>
      </template>
    </template>

    <!-- Player Details Modal -->
    <BaseModal
      :show="showPlayerModal"
      @close="closePlayerModal"
      :title="selectedPlayer?.name || 'Player Details'"
      size="md"
    >
      <div v-if="selectedPlayer" class="player-modal-content">
        <!-- Player Header -->
        <div class="player-modal-header">
          <div class="player-avatar-lg">
            <User class="avatar-icon" :size="32" />
          </div>
          <div class="player-header-info">
            <h2 class="player-modal-name">{{ selectedPlayer.name }}</h2>
            <div class="player-header-meta">
              <span
                class="position-badge"
                :style="{ backgroundColor: getPositionColor(selectedPlayer.position) }"
              >
                {{ selectedPlayer.position }}<template v-if="selectedPlayer.secondary_position">/{{ selectedPlayer.secondary_position }}</template>
              </span>
            </div>
          </div>
        </div>

        <!-- Game Stats -->
        <div class="game-stats-section">
          <h4 class="stats-section-title">Game Stats</h4>
          <div class="game-stats-grid">
            <div class="game-stat-cell">
              <span class="game-stat-value highlight">{{ selectedPlayer.points || 0 }}</span>
              <span class="game-stat-label">PTS</span>
            </div>
            <div class="game-stat-cell">
              <span class="game-stat-value">{{ selectedPlayer.rebounds || 0 }}</span>
              <span class="game-stat-label">REB</span>
            </div>
            <div class="game-stat-cell">
              <span class="game-stat-value">{{ selectedPlayer.assists || 0 }}</span>
              <span class="game-stat-label">AST</span>
            </div>
            <div class="game-stat-cell">
              <span class="game-stat-value">{{ selectedPlayer.steals || 0 }}</span>
              <span class="game-stat-label">STL</span>
            </div>
            <div class="game-stat-cell">
              <span class="game-stat-value">{{ selectedPlayer.blocks || 0 }}</span>
              <span class="game-stat-label">BLK</span>
            </div>
            <div class="game-stat-cell turnover">
              <span class="game-stat-value">{{ selectedPlayer.turnovers || 0 }}</span>
              <span class="game-stat-label">TO</span>
            </div>
          </div>
        </div>

        <!-- Shooting Stats -->
        <div class="shooting-stats-section">
          <h4 class="stats-section-title">Shooting</h4>
          <div class="shooting-stats-grid">
            <div class="shooting-stat-cell">
              <span class="shooting-stat-line">{{ selectedPlayer.fgm || 0 }}-{{ selectedPlayer.fga || 0 }}</span>
              <span class="shooting-stat-label">FG</span>
            </div>
            <div class="shooting-stat-cell">
              <span class="shooting-stat-line">{{ selectedPlayer.fg3m || 0 }}-{{ selectedPlayer.fg3a || 0 }}</span>
              <span class="shooting-stat-label">3PT</span>
            </div>
            <div class="shooting-stat-cell">
              <span class="shooting-stat-line">{{ selectedPlayer.ftm || 0 }}-{{ selectedPlayer.fta || 0 }}</span>
              <span class="shooting-stat-label">FT</span>
            </div>
          </div>
        </div>

        <!-- Minutes -->
        <div class="minutes-row">
          <span class="minutes-label">Minutes Played</span>
          <span class="minutes-value">{{ selectedPlayer.minutes || 0 }}</span>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
.game-view {
  padding-bottom: 100px;
}

@media (min-width: 1024px) {
  .game-view {
    padding-bottom: 24px;
  }
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-default);
}

.back-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.game-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.team-side {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}

.team-side.away {
  justify-content: flex-start;
}

.team-side.home {
  justify-content: flex-end;
}

.team-side.winner .badge-abbr {
  color: var(--color-success);
}

.team-badge-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.team-badge-game {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.badge-abbr {
  font-size: 1.5rem;
  font-weight: 800;
  color: white;
  letter-spacing: 0.02em;
}

.badge-record {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.team-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.team-rating {
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

.team-score-lg {
  font-size: 3rem;
  font-weight: 800;
  font-family: monospace;
  min-width: 80px;
  text-align: center;
}

.game-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0 24px;
}

.vs-text {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-secondary);
}

.final-text {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.game-date {
  font-size: 0.875rem;
  color: var(--color-secondary);
  text-align: center;
}

.user-game-badge {
  margin-top: 4px;
  padding: 4px 12px;
  background: var(--color-primary);
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.result-banner {
  margin-top: 20px;
  padding: 16px;
  border-radius: 8px;
  text-align: center;
  font-size: 1.5rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.result-banner.win {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1));
  color: var(--color-success);
  border: 1px solid var(--color-success);
}

.result-banner.loss {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.1));
  color: var(--color-error);
  border: 1px solid var(--color-error);
}

.court-container {
  display: flex;
  justify-content: center;
  overflow: hidden;
  border-radius: 8px;
}

.court-with-overlay {
  position: relative;
}

/* Quarter Break Overlay */
.quarter-break-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.quarter-break-content {
  text-align: center;
  padding: 32px;
}

.quarter-break-title {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 24px;
  color: var(--color-primary);
}

.quarter-break-title.game-complete-title {
  font-size: 2.5rem;
  margin-bottom: 8px;
  color: var(--color-success);
}

.game-complete-subtitle {
  font-size: 1rem;
  color: var(--color-secondary);
  margin-bottom: 24px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.quarter-break-score {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 32px;
  margin-bottom: 24px;
}

.break-team {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.break-team-name {
  font-size: 0.875rem;
  color: var(--color-secondary);
}

.break-team-score {
  font-size: 3rem;
  font-weight: 800;
  font-family: monospace;
}

.break-divider {
  font-size: 2rem;
  color: var(--color-secondary);
}

.break-hint {
  font-size: 0.875rem;
  color: var(--color-secondary);
  margin-bottom: 24px;
  font-style: italic;
}

/* Coaching Adjustments in Quarter Break */
.coaching-adjustments {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  justify-content: center;
  margin-bottom: 24px;
}

.adjustment-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}

.adjustment-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.adjustment-select {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: white;
  font-size: 0.875rem;
  min-width: 160px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.adjustment-select:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
}

.adjustment-select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.adjustment-select option {
  background: #1a1a2e;
  color: white;
}

.lineup-adjustments {
  width: 100%;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.lineup-adjustments .adjustment-row {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 8px;
}

.lineup-adjustments .adjustment-label {
  width: 32px;
  text-align: right;
}

.lineup-adjustments .adjustment-select {
  min-width: 200px;
}

.adjustment-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
  text-align: center;
}

.injured-note {
  font-size: 0.7rem;
  color: var(--color-error);
  text-align: center;
  margin-bottom: 8px;
  opacity: 0.8;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.matchup-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.matchup-item {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-lg);
}

.matchup-label {
  font-size: 0.75rem;
  color: var(--color-secondary);
  margin-bottom: 4px;
}

.matchup-value {
  font-weight: 600;
}

.quarter-scores {
  overflow-x: auto;
}

.quarters-table {
  width: 100%;
  border-collapse: collapse;
}

.quarters-table th,
.quarters-table td {
  padding: 12px 16px;
  text-align: center;
}

.quarters-table th {
  color: var(--color-secondary);
  font-size: 0.75rem;
  font-weight: 500;
}

.quarters-table .team-header {
  text-align: left;
  width: 120px;
}

.quarters-table .total-col {
  font-weight: 700;
  background: rgba(255, 255, 255, 0.05);
}

.quarters-table tr.winner .total-col {
  color: var(--color-success);
}

.team-mini {
  display: flex;
  align-items: center;
  gap: 8px;
}

.team-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.performers-header {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 10px;
}

.performers-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.performer-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
}

.performer-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
}

.performer-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--gradient-cosmic);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.performer-avatar .avatar-icon {
  color: rgba(255, 255, 255, 0.9);
}

.performer-main {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-width: 0;
}

.performer-identity {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.performer-name {
  font-weight: 600;
  font-size: 0.875rem;
}

.performer-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.position-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  color: white;
  text-transform: uppercase;
}

.performer-stats {
  display: flex;
  gap: 10px;
}

.stat-item-inline {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 32px;
}

.stat-value-highlight {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-primary);
}

.stat-value-sm {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.stat-label-sm {
  font-size: 0.6rem;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.performer-chevron {
  color: var(--color-secondary);
  font-size: 1.25rem;
  padding-left: 4px;
}

/* Player Modal Styles */
.player-modal-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.player-modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.player-avatar-lg {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--gradient-cosmic);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.player-avatar-lg .avatar-icon {
  color: rgba(255, 255, 255, 0.9);
}

.player-header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.player-modal-name {
  font-size: 1.25rem;
  font-weight: 700;
}

.player-header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.game-stats-section,
.shooting-stats-section {
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

.game-stats-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}

.game-stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-md);
}

.game-stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: white;
}

.game-stat-value.highlight {
  color: var(--color-primary);
}

.game-stat-cell.turnover .game-stat-value {
  color: var(--color-error);
}

.game-stat-label {
  font-size: 0.6rem;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-top: 2px;
}

.shooting-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.shooting-stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 6px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-md);
}

.shooting-stat-line {
  font-size: 1rem;
  font-weight: 700;
  color: white;
}

.shooting-stat-label {
  font-size: 0.65rem;
  color: var(--color-secondary);
  text-transform: uppercase;
  margin-top: 2px;
}

.minutes-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-md);
}

.minutes-label {
  font-size: 0.8rem;
  color: var(--color-secondary);
}

.minutes-value {
  font-size: 1rem;
  font-weight: 700;
}

.play-by-play {
  max-height: 400px;
  overflow-y: auto;
}

.play-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.play-item:last-child {
  border-bottom: none;
}

.play-time {
  min-width: 50px;
  font-size: 0.75rem;
  color: var(--color-secondary);
  font-family: monospace;
}

.play-team {
  min-width: 40px;
  font-weight: 600;
  font-size: 0.875rem;
}

.play-action {
  flex: 1;
  font-size: 0.875rem;
}

.play-score {
  font-family: monospace;
  font-weight: 600;
  color: var(--color-secondary);
}

.play-item.score .play-action {
  color: var(--color-success);
}

.play-item.turnover .play-action {
  color: var(--color-error);
}

/* Live Game Simulation Styles */
.live-game-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.live-game-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.live-score {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.25rem;
  font-weight: 700;
  font-family: monospace;
}

.live-team {
  min-width: 70px;
}

.score-separator {
  color: var(--color-secondary);
}

.live-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 6px;
  color: #EF4444;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.live-dot {
  width: 8px;
  height: 8px;
  background: #EF4444;
  border-radius: 50%;
  animation: pulse-live 1.5s infinite;
}

@keyframes pulse-live {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.2);
  }
}

@media (max-width: 400px) {
  .game-header {
    flex-direction: column;
    gap: 16px;
  }

  .team-side {
    width: 100%;
    justify-content: center !important;
  }

  .team-side.home {
    flex-direction: row-reverse;
  }

  .team-badge-game {
    width: 80px;
    height: 80px;
  }

  .badge-abbr {
    font-size: 1.25rem;
  }

  .badge-record {
    font-size: 0.65rem;
  }

  .team-score-lg {
    font-size: 2rem;
  }

  .game-stats-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .performer-stats {
    gap: 6px;
  }

  .stat-item-inline {
    min-width: 26px;
  }
}

/* Light mode overrides */
[data-theme="light"] .performer-card {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .performer-card:hover {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.12);
}

[data-theme="light"] .modal-tabs {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .modal-tab {
  background: white;
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
</style>
