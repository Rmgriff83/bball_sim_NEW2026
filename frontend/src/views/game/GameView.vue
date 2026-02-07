<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useCampaignStore } from '@/stores/campaign'
import { useLeagueStore } from '@/stores/league'
import { GlassCard, BaseButton, LoadingSpinner } from '@/components/ui'
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
    await gameStore.fetchGame(campaignId.value, gameId.value)
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
  <div class="p-6">
    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-12">
      <LoadingSpinner size="lg" />
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
            <div
              class="team-logo-lg"
              :style="{ backgroundColor: awayTeam?.primary_color || '#6B7280' }"
            >
              {{ awayTeam?.abbreviation }}
            </div>
            <div class="team-details">
              <p class="team-name">{{ awayTeam?.name }}</p>
              <p class="team-city">{{ awayTeam?.city }}</p>
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
            <div class="team-details text-right">
              <p class="team-name">{{ homeTeam?.name }}</p>
              <p class="team-city">{{ homeTeam?.city }}</p>
            </div>
            <div
              class="team-logo-lg"
              :style="{ backgroundColor: homeTeam?.primary_color || '#6B7280' }"
            >
              {{ homeTeam?.abbreviation }}
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
          <GlassCard padding="lg" :hoverable="false">
            <h3 class="h4 mb-4">{{ awayTeam?.abbreviation }} Top Performers</h3>
            <div class="performers-list">
              <div
                v-for="player in awayTopPerformers"
                :key="player.player_id"
                class="performer-card"
              >
                <div class="performer-info">
                  <span class="performer-name">{{ player.name }}</span>
                  <span class="performer-pos">{{ player.position }}</span>
                </div>
                <div class="performer-stats">
                  <span class="stat-pts">{{ player.points }} PTS</span>
                  <span class="stat-secondary">{{ player.rebounds }} REB</span>
                  <span class="stat-secondary">{{ player.assists }} AST</span>
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard padding="lg" :hoverable="false">
            <h3 class="h4 mb-4">{{ homeTeam?.abbreviation }} Top Performers</h3>
            <div class="performers-list">
              <div
                v-for="player in homeTopPerformers"
                :key="player.player_id"
                class="performer-card"
              >
                <div class="performer-info">
                  <span class="performer-name">{{ player.name }}</span>
                  <span class="performer-pos">{{ player.position }}</span>
                </div>
                <div class="performer-stats">
                  <span class="stat-pts">{{ player.points }} PTS</span>
                  <span class="stat-secondary">{{ player.rebounds }} REB</span>
                  <span class="stat-secondary">{{ player.assists }} AST</span>
                </div>
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
  </div>
</template>

<style scoped>
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: var(--color-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
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

.team-side.winner .team-name {
  color: var(--color-success);
}

.team-logo-lg {
  width: 80px;
  height: 80px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.team-details {
  min-width: 0;
}

.team-name {
  font-size: 1.25rem;
  font-weight: 700;
}

.team-city {
  color: var(--color-secondary);
  font-size: 0.875rem;
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
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
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

.performers-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.performer-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.performer-info {
  display: flex;
  flex-direction: column;
}

.performer-name {
  font-weight: 600;
}

.performer-pos {
  font-size: 0.75rem;
  color: var(--color-secondary);
}

.performer-stats {
  display: flex;
  gap: 12px;
  font-size: 0.875rem;
}

.stat-pts {
  font-weight: 700;
  color: var(--color-primary);
}

.stat-secondary {
  color: var(--color-secondary);
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

@media (max-width: 768px) {
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

  .team-details {
    text-align: center !important;
  }

  .team-score-lg {
    font-size: 2rem;
    min-width: 60px;
  }

  .team-logo-lg {
    width: 60px;
    height: 60px;
    font-size: 1.25rem;
  }
}
</style>
