<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useCampaignStore } from '@/stores/campaign'
import { useLeagueStore } from '@/stores/league'
import { useTeamStore } from '@/stores/team'
import { GlassCard, BaseButton, LoadingSpinner, StatBadge, BaseModal } from '@/components/ui'
import { User, Play, Pause, ArrowUpDown, ChevronRight } from 'lucide-vue-next'
import BasketballCourt from '@/components/game/BasketballCourt.vue'
import BoxScore from '@/components/game/BoxScore.vue'
import { SimulateConfirmModal } from '@/components/game'
import { usePlayAnimation } from '@/composables/usePlayAnimation'
import { usePositionValidation } from '@/composables/usePositionValidation'

const route = useRoute()
const router = useRouter()
const gameStore = useGameStore()
const campaignStore = useCampaignStore()
const leagueStore = useLeagueStore()
const teamStore = useTeamStore()

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
  currentBoxScore,
  currentActivatedBadges,
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

// Live stats animation state
const animatingStatPlayers = ref({}) // { [playerId]: 'up' | 'down' }
const prevAwayRanking = ref([])
const prevHomeRanking = ref([])

// Live box score state
const showLiveBoxScore = ref(false)
const liveBoxScoreTab = ref('away') // Start with away team (visitor listed first traditionally)
const liveBoxSortColumn = ref('points')
const liveBoxSortDirection = ref('desc')

// Track previous stat values for animations { playerId: { points: 5, assists: 2, ... } }
const prevPlayerStats = ref({})

// Track which stats are currently animating { `${playerId}-${statKey}`: true }
const animatingStats = ref({})

// Simulate modal state
const showSimulateModal = ref(false)

// Coaching style selections for quarter breaks
const selectedOffense = ref('balanced')
const selectedDefense = ref('man')

// Lineup selections for quarter breaks (5 player IDs)
const selectedLineup = ref([null, null, null, null, null])
const positionLabels = ['PG', 'SG', 'SF', 'PF', 'C']

// Expanded swap dropdown state for quarter break
const expandedSwapPlayer = ref(null)

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

// Team rosters for pre-game starters preview
const homeRoster = ref([])
const awayRoster = ref([])

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

// Box score data - use animation box score when playing, otherwise game box score
const boxScore = computed(() => {
  // During animation playback, use the per-possession box score if available
  if (showAnimationMode.value && currentBoxScore.value) {
    return {
      home: Array.isArray(currentBoxScore.value?.home) ? currentBoxScore.value.home : [],
      away: Array.isArray(currentBoxScore.value?.away) ? currentBoxScore.value.away : []
    }
  }
  // Fallback to game's final box score
  const bs = game.value?.box_score
  return {
    home: Array.isArray(bs?.home) ? bs.home : [],
    away: Array.isArray(bs?.away) ? bs.away : []
  }
})

// Top 5 scorers for live stats (sorted by points)
const topAwayScorers = computed(() => {
  return [...boxScore.value.away]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, 5)
})

const topHomeScorers = computed(() => {
  return [...boxScore.value.home]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, 5)
})

// Live box score - sorted stats for the full table
const liveBoxScoreColumns = [
  { key: 'name', label: 'Player', class: 'player-col' },
  { key: 'minutes', label: 'MIN', class: 'stat-col' },
  { key: 'points', label: 'PTS', class: 'stat-col' },
  { key: 'rebounds', label: 'REB', class: 'stat-col' },
  { key: 'assists', label: 'AST', class: 'stat-col' },
  { key: 'steals', label: 'STL', class: 'stat-col' },
  { key: 'blocks', label: 'BLK', class: 'stat-col' },
  { key: 'turnovers', label: 'TO', class: 'stat-col' },
]

const activeLiveBoxStats = computed(() => {
  const stats = liveBoxScoreTab.value === 'home' ? boxScore.value.home : boxScore.value.away
  const col = liveBoxSortColumn.value
  const dir = liveBoxSortDirection.value === 'desc' ? -1 : 1

  return [...stats].sort((a, b) => {
    let aVal = a[col] || 0
    let bVal = b[col] || 0

    if (col === 'name') {
      aVal = a.name || ''
      bVal = b.name || ''
      return dir * aVal.localeCompare(bVal)
    }

    return dir * (aVal - bVal)
  })
})

const activeLiveBoxTeam = computed(() => {
  return liveBoxScoreTab.value === 'home' ? homeTeam.value : awayTeam.value
})

const activeLiveBoxTotals = computed(() => {
  const stats = liveBoxScoreTab.value === 'home' ? boxScore.value.home : boxScore.value.away
  if (!Array.isArray(stats) || stats.length === 0) {
    return { points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0 }
  }
  return stats.reduce((totals, player) => {
    totals.points += player.points || 0
    totals.rebounds += player.rebounds || 0
    totals.assists += player.assists || 0
    totals.steals += player.steals || 0
    totals.blocks += player.blocks || 0
    totals.turnovers += player.turnovers || 0
    totals.fgm += player.fgm || 0
    totals.fga += player.fga || 0
    totals.fg3m += player.fg3m || 0
    totals.fg3a += player.fg3a || 0
    totals.ftm += player.ftm || 0
    totals.fta += player.fta || 0
    return totals
  }, { points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0 })
})

function sortLiveBoxBy(column) {
  if (liveBoxSortColumn.value === column) {
    liveBoxSortDirection.value = liveBoxSortDirection.value === 'desc' ? 'asc' : 'desc'
  } else {
    liveBoxSortColumn.value = column
    liveBoxSortDirection.value = column === 'name' ? 'asc' : 'desc'
  }
}

function getLiveBoxSortIcon(column) {
  if (liveBoxSortColumn.value !== column) return ''
  return liveBoxSortDirection.value === 'desc' ? ' ▼' : ' ▲'
}

function formatShootingLine(made, attempted) {
  return `${made || 0}-${attempted || 0}`
}

function formatPercentage(made, attempted) {
  if (!attempted || attempted === 0) return '-'
  return ((made / attempted) * 100).toFixed(1) + '%'
}

// Check if a stat is currently animating
function isStatAnimating(playerId, statKey) {
  return animatingStats.value[`${playerId}-${statKey}`] === true
}

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

// Current starters with game stats for quarter break display
const currentStartersWithStats = computed(() => {
  const players = userTeamPlayers.value
  if (!players || players.length === 0) return []

  return positionLabels.map((pos, index) => {
    const playerId = selectedLineup.value[index]
    const player = players.find(p => p.player_id === playerId)
    return {
      slotPosition: pos,
      slotIndex: index,
      player: player || null
    }
  })
})

// Bench players (not in selected lineup) for swap dropdown
const benchPlayersForSwap = computed(() => {
  const players = userTeamPlayers.value
  if (!players) return []

  const starterIds = selectedLineup.value.filter(id => id != null)
  return players.filter(p => !starterIds.includes(p.player_id))
})

// Get swap candidates for a position slot
function getSwapCandidates(slotPosition, slotIndex) {
  const players = userTeamPlayers.value
  if (!players) return []

  // Get IDs already in lineup (except current slot)
  const excludeIds = selectedLineup.value
    .filter((id, i) => i !== slotIndex && id != null)

  // Filter to players who can play this position and aren't in other slots
  return players.filter(p => {
    const canPlay = p.position === slotPosition || p.secondary_position === slotPosition
    const isHealthy = !p.is_injured && !p.isInjured
    const notInLineup = !excludeIds.includes(p.player_id)
    const notCurrentStarter = p.player_id !== selectedLineup.value[slotIndex]
    return canPlay && isHealthy && notInLineup && notCurrentStarter
  }).sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))
}

// Toggle swap dropdown for a position slot
function toggleSwapDropdown(slotIndex) {
  if (expandedSwapPlayer.value === slotIndex) {
    expandedSwapPlayer.value = null
  } else {
    expandedSwapPlayer.value = slotIndex
  }
}

// Swap a player into a position slot
function swapPlayerIn(slotIndex, playerId) {
  selectedLineup.value[slotIndex] = playerId
  expandedSwapPlayer.value = null
}

// Move starter to bench (clear slot)
function moveStarterToBench(slotIndex) {
  selectedLineup.value[slotIndex] = null
  expandedSwapPlayer.value = null
}

// Get position badge color
function getPositionColor(position) {
  const colors = {
    'PG': '#3B82F6',
    'SG': '#8B5CF6',
    'SF': '#10B981',
    'PF': '#F59E0B',
    'C': '#EF4444'
  }
  return colors[position] || '#6B7280'
}

// Get rating class for player card styling
function getRatingClass(rating) {
  if (rating >= 90) return 'elite'
  if (rating >= 80) return 'star'
  if (rating >= 70) return 'starter'
  if (rating >= 60) return 'rotation'
  return 'bench'
}

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

// Build starters list from saved lineup IDs and roster
// The saved lineup is an array of 5 player IDs in position order (PG, SG, SF, PF, C)
function buildStartersFromLineup(lineupIds, roster) {
  if (!lineupIds || !roster || roster.length === 0) return []

  const positions = ['PG', 'SG', 'SF', 'PF', 'C']
  const starters = []

  // Build a map for quick player lookup
  const playerMap = new Map()
  roster.forEach(p => playerMap.set(p.id, p))

  // Get each starter by ID, assign the position slot
  lineupIds.forEach((playerId, index) => {
    if (playerId) {
      const player = playerMap.get(playerId)
      if (player) {
        starters.push({
          ...player,
          slotPosition: positions[index]
        })
      }
    }
  })

  return starters
}

// Fallback: select starters by position/rating if no saved lineup
function selectStartersFromRoster(roster) {
  if (!roster || roster.length === 0) return []

  const positions = ['PG', 'SG', 'SF', 'PF', 'C']
  const starters = []
  const usedIds = new Set()

  // Sort by overall rating (descending)
  const sorted = [...roster].sort((a, b) =>
    (b.overall_rating || 0) - (a.overall_rating || 0)
  )

  // Fill each position with the best available player
  for (const pos of positions) {
    const player = sorted.find(p =>
      !usedIds.has(p.id) &&
      (p.position === pos || p.secondary_position === pos)
    )
    if (player) {
      starters.push({ ...player, slotPosition: pos })
      usedIds.add(player.id)
    }
  }

  // Fill any empty slots with best available
  for (const pos of positions) {
    if (!starters.find(s => s.slotPosition === pos)) {
      const player = sorted.find(p => !usedIds.has(p.id))
      if (player) {
        starters.push({ ...player, slotPosition: pos })
        usedIds.add(player.id)
      }
    }
  }

  return starters.sort((a, b) =>
    positions.indexOf(a.slotPosition) - positions.indexOf(b.slotPosition)
  )
}

// Pre-game starters for each team
const homeStarters = computed(() => {
  // User is home team - use saved lineup from campaign.settings
  if (userIsHome.value) {
    const savedLineup = campaign.value?.settings?.lineup?.starters
    const roster = campaign.value?.roster
    if (savedLineup?.length === 5 && roster?.length > 0) {
      return buildStartersFromLineup(savedLineup, roster)
    }
    // Fallback to roster if available
    if (roster?.length > 0) {
      return selectStartersFromRoster(roster)
    }
  }
  // Opponent team - use fetched roster
  return selectStartersFromRoster(homeRoster.value)
})

const awayStarters = computed(() => {
  // User is away team - use saved lineup from campaign.settings
  if (!userIsHome.value) {
    const savedLineup = campaign.value?.settings?.lineup?.starters
    const roster = campaign.value?.roster
    if (savedLineup?.length === 5 && roster?.length > 0) {
      return buildStartersFromLineup(savedLineup, roster)
    }
    // Fallback to roster if available
    if (roster?.length > 0) {
      return selectStartersFromRoster(roster)
    }
  }
  // Opponent team - use fetched roster
  return selectStartersFromRoster(awayRoster.value)
})

onMounted(async () => {
  try {
    // Refresh campaign data to get latest roster and lineup settings
    await campaignStore.fetchCampaign(campaignId.value)

    // Fetch standings for team records display
    await leagueStore.fetchStandings(campaignId.value)

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

    // Fetch rosters for both teams (for pre-game starters preview)
    const currentGame = gameStore.currentGame
    if (currentGame?.home_team?.id && currentGame?.away_team?.id) {
      try {
        const [homeData, awayData] = await Promise.all([
          teamStore.fetchTeamRoster(campaignId.value, currentGame.home_team.id),
          teamStore.fetchTeamRoster(campaignId.value, currentGame.away_team.id)
        ])
        homeRoster.value = homeData.roster || []
        awayRoster.value = awayData.roster || []
      } catch (rosterErr) {
        console.error('Failed to load team rosters:', rosterErr)
      }
    }
  } catch (err) {
    console.error('Failed to load game:', err)
  } finally {
    loading.value = false
  }
})

/**
 * Handle Play Game button click.
 * Check if there are games to simulate first, show modal if so.
 */
async function handlePlayGame() {
  // If game is already in progress, skip the modal check
  if (isInProgress.value) {
    await startGame()
    return
  }

  // Check if there are games to simulate before this game
  showSimulateModal.value = true
  await gameStore.fetchSimulateToNextGamePreview(campaignId.value)
}

/**
 * Handle closing the simulate modal.
 */
function handleCloseSimulateModal() {
  showSimulateModal.value = false
  gameStore.clearSimulatePreview()
}

/**
 * Handle confirm from simulate modal - simulate games then start user's game.
 */
async function handleConfirmSimulate() {
  showSimulateModal.value = false

  const preview = gameStore.simulatePreview
  const hasGamesToSimulate = preview?.totalGamesToSimulate > 0

  if (hasGamesToSimulate) {
    // Simulate all games up to the user's game
    try {
      await gameStore.simulateToNextGame(campaignId.value)
      // Refresh standings after simulation
      await leagueStore.fetchStandings(campaignId.value)
    } catch (err) {
      console.error('Failed to simulate games:', err)
      gameStore.clearSimulatePreview()
      return
    }
  }

  gameStore.clearSimulatePreview()
  // Now start the user's game
  await startGame()
}

/**
 * Start a live quarter-by-quarter game simulation.
 * If game is already in progress, continues from saved state.
 */
async function startGame() {
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

// Animation data from game result
const gameAnimationData = computed(() => game.value?.animation_data || null)

// Has animation data available (from stored game OR loaded into composable)
const hasAnimationData = computed(() => {
  return gameAnimationData.value?.possessions?.length > 0 ||
         animationData.value?.possessions?.length > 0
})

// Game clock - convert possession progress to time (12:00 countdown to 0:00)
const gameClock = computed(() => {
  if (!hasAnimationData.value || totalPossessions.value === 0) return '12:00'

  // Calculate progress through the quarter (0 to 1)
  const quarterProgress = (currentPossessionIndex.value + progress.value) / totalPossessions.value

  // Convert to remaining time (720 seconds = 12 minutes, counting down)
  const totalSeconds = Math.max(0, Math.floor(720 * (1 - quarterProgress)))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
})

// Load animation when game data is available
watch(gameAnimationData, (newData) => {
  if (newData && newData.possessions?.length > 0) {
    loadAnimationData(newData)
  }
}, { immediate: true })

// Track previous scores to detect baskets
const prevTotalScore = ref(0)

// Watch for score changes and trigger basket animation
watch(
  [currentHomeScore, currentAwayScore],
  ([homeScore, awayScore], [prevHome, prevAway]) => {
    const newTotal = (homeScore || 0) + (awayScore || 0)
    const oldTotal = (prevHome || 0) + (prevAway || 0)
    const pointsScored = newTotal - oldTotal

    if (pointsScored > 0 && pointsScored <= 3 && courtRef.value) {
      courtRef.value.triggerScoreAnimation(pointsScored)
    }
  }
)

// Watch for ranking changes in live stats and trigger animations
watch(
  [topAwayScorers, topHomeScorers],
  ([newAway, newHome]) => {
    const newAnimations = {}

    // Check away team ranking changes
    const newAwayIds = newAway.map(p => p.player_id)
    if (prevAwayRanking.value.length > 0) {
      newAwayIds.forEach((id, newIndex) => {
        const oldIndex = prevAwayRanking.value.indexOf(id)
        if (oldIndex !== -1 && oldIndex > newIndex) {
          newAnimations[id] = 'up'
        } else if (oldIndex !== -1 && oldIndex < newIndex) {
          newAnimations[id] = 'down'
        }
      })
    }
    prevAwayRanking.value = newAwayIds

    // Check home team ranking changes
    const newHomeIds = newHome.map(p => p.player_id)
    if (prevHomeRanking.value.length > 0) {
      newHomeIds.forEach((id, newIndex) => {
        const oldIndex = prevHomeRanking.value.indexOf(id)
        if (oldIndex !== -1 && oldIndex > newIndex) {
          newAnimations[id] = 'up'
        } else if (oldIndex !== -1 && oldIndex < newIndex) {
          newAnimations[id] = 'down'
        }
      })
    }
    prevHomeRanking.value = newHomeIds

    // Apply animations
    if (Object.keys(newAnimations).length > 0) {
      animatingStatPlayers.value = newAnimations
      setTimeout(() => {
        animatingStatPlayers.value = {}
      }, 400)
    }
  },
  { deep: true }
)

// Track previous player stats for live box score animations
watch(
  boxScore,
  (newBoxScore) => {
    const allPlayers = [...(newBoxScore.home || []), ...(newBoxScore.away || [])]
    const newPrevStats = {}
    const changedStats = [] // Collect stats that changed for staggered animation

    for (const player of allPlayers) {
      if (player.player_id) {
        const prev = prevPlayerStats.value[player.player_id]
        const statKeys = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers']

        // Check for changes if we have previous values
        if (prev) {
          for (const key of statKeys) {
            const oldVal = prev[key] || 0
            const newVal = player[key] || 0
            if (newVal !== oldVal) {
              changedStats.push(`${player.player_id}-${key}`)
            }
          }
        }

        newPrevStats[player.player_id] = {
          points: player.points || 0,
          rebounds: player.rebounds || 0,
          assists: player.assists || 0,
          steals: player.steals || 0,
          blocks: player.blocks || 0,
          turnovers: player.turnovers || 0,
          fgm: player.fgm || 0,
          fga: player.fga || 0,
          fg3m: player.fg3m || 0,
          fg3a: player.fg3a || 0,
          ftm: player.ftm || 0,
          fta: player.fta || 0,
        }
      }
    }

    // Trigger staggered animations with 500ms delay between each
    if (changedStats.length > 0) {
      changedStats.forEach((statKey, index) => {
        setTimeout(() => {
          animatingStats.value = { ...animatingStats.value, [statKey]: true }
          // Clear this animation after it completes
          setTimeout(() => {
            const updated = { ...animatingStats.value }
            delete updated[statKey]
            animatingStats.value = updated
          }, 300) // Animation duration
        }, index * 500) // 500ms delay between animations
      })
    }

    prevPlayerStats.value = newPrevStats
  },
  { deep: true }
)

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

      <!-- Game Header (hidden during animation mode) -->
      <GlassCard v-if="!showAnimationMode || !hasAnimationData" padding="lg" :hoverable="false" class="mb-6 game-header-card">
        <div class="game-header">
          <!-- Away Team -->
          <div class="team-side away" :class="{ winner: winner === 'away' }">
            <div class="team-badge-wrapper">
              <div class="team-name-with-logo">
                <div
                  class="team-logo-mini"
                  :style="{ backgroundColor: awayTeam?.primary_color || '#6B7280' }"
                >
                  {{ awayTeam?.abbreviation?.charAt(0) }}
                </div>
                <span class="team-name-text">{{ awayTeam?.name }}</span>
              </div>
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
            <div v-if="isComplete || isInProgress" class="team-score-lg">
              {{ game.away_score || 0 }}
            </div>
          </div>

          <!-- Center Info -->
          <div class="game-center">
            <p v-if="isComplete" class="final-text">FINAL</p>
            <p v-else-if="isInProgress" class="in-progress-text">Q{{ savedQuarter }} Complete</p>
            <p v-else class="vs-text">VS</p>
            <p class="game-date">{{ formatDate(game.game_date) }}</p>
            <p v-if="isUserGame" class="user-game-badge">Your Game</p>
          </div>

          <!-- Home Team -->
          <div class="team-side home" :class="{ winner: winner === 'home' }">
            <div v-if="isComplete || isInProgress" class="team-score-lg">
              {{ game.home_score || 0 }}
            </div>
            <div class="team-badge-wrapper">
              <div class="team-name-with-logo">
                <div
                  class="team-logo-mini"
                  :style="{ backgroundColor: homeTeam?.primary_color || '#6B7280' }"
                >
                  {{ homeTeam?.abbreviation?.charAt(0) }}
                </div>
                <span class="team-name-text">{{ homeTeam?.name }}</span>
              </div>
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
          <GlassCard padding="none" :hoverable="false" class="mb-6 broadcast-court-card" nebula>
            <!-- Broadcast-style Scoreboard with Cosmic Background -->
            <div class="broadcast-header">
              <div class="broadcast-scoreboard">
                <!-- Away Team -->
              <div class="broadcast-team">
                <div class="broadcast-team-column">
                  <div
                    class="broadcast-team-logo"
                    :style="{ backgroundColor: awayTeam?.primary_color || '#6B7280' }"
                  >
                    {{ awayTeam?.abbreviation }}
                  </div>
                  <span class="broadcast-record">{{ awayTeamRecord }}</span>
                </div>
                <div class="broadcast-score-container">
                  <TransitionGroup name="score-slide" tag="div" class="score-slot">
                    <span :key="currentAwayScore" class="broadcast-score">{{ currentAwayScore }}</span>
                  </TransitionGroup>
                </div>
              </div>

              <!-- Center Info -->
              <div class="broadcast-center">
                <div class="broadcast-quarter">{{ currentQuarter <= 4 ? `Q${currentQuarter}` : `OT${currentQuarter - 4}` }}</div>
                <div class="broadcast-time">{{ gameClock }}</div>
                <div v-if="simulating || isPlaying" class="broadcast-live">
                  <span class="live-dot"></span>
                  LIVE
                </div>
              </div>

              <!-- Home Team -->
              <div class="broadcast-team">
                <div class="broadcast-score-container">
                  <TransitionGroup name="score-slide" tag="div" class="score-slot">
                    <span :key="currentHomeScore" class="broadcast-score">{{ currentHomeScore }}</span>
                  </TransitionGroup>
                </div>
                <div class="broadcast-team-column">
                  <div
                    class="broadcast-team-logo"
                    :style="{ backgroundColor: homeTeam?.primary_color || '#6B7280' }"
                  >
                    {{ homeTeam?.abbreviation }}
                  </div>
                  <span class="broadcast-record">{{ homeTeamRecord }}</span>
                </div>
              </div>
              </div>
              <!-- Game Date -->
              <div class="broadcast-date">{{ formatDate(game.game_date) }}</div>
            </div>

            <!-- Court and Live Stats Row -->
            <template v-if="hasAnimationData">
            <div class="court-stats-row">
              <!-- Animated Court with Overlays -->
              <div class="court-container court-in-broadcast">
              <!-- Animation Controls inside court -->
              <div class="animation-controls">
                <button
                  class="play-pause-btn"
                  @click="togglePlayPause"
                  :title="isPlaying ? 'Pause' : 'Play'"
                >
                  <Play v-if="!isPlaying" :size="18" fill="currentColor" />
                  <Pause v-else :size="18" fill="currentColor" />
                </button>

                <div class="speed-buttons">
                  <button
                    class="speed-btn"
                    :class="{ active: playbackSpeed === 1 }"
                    @click="setSpeed(1)"
                  >1x</button>
                  <button
                    class="speed-btn"
                    :class="{ active: playbackSpeed === 2 }"
                    @click="setSpeed(2)"
                  >2x</button>
                  <button
                    class="speed-btn"
                    :class="{ active: playbackSpeed === 4 }"
                    @click="setSpeed(4)"
                  >4x</button>
                </div>
              </div>

              <BasketballCourt
                ref="courtRef"
                :width="500"
                :height="300"
                :home-team="homeTeam"
                :away-team="awayTeam"
                :animation-mode="true"
                :interpolated-positions="interpolatedPositions"
                :interpolated-ball-position="interpolatedBallPosition"
                :home-roster="boxScore.home"
                :away-roster="boxScore.away"
                :show-trails="true"
                :play-name="hasAnimationData ? currentPlayName : ''"
                :play-description="hasAnimationData ? currentDescription : ''"
                :play-team-abbreviation="currentTeam === 'home' ? homeTeam?.abbreviation : awayTeam?.abbreviation"
                :play-team-color="currentTeam === 'home' ? homeTeam?.primary_color : awayTeam?.primary_color"
                :game-clock="gameClock"
                :activated-badges="currentActivatedBadges"
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
                        <span class="break-team-name">{{ homeTeam?.name }}</span>
                        <span class="break-team-score" :style="{ color: homeTeam?.primary_color }">
                          {{ currentHomeScore }}
                        </span>
                      </div>
                    </div>

                    <!-- Coaching Adjustments (only in live mode during quarter breaks, not game complete) -->
                    <div v-if="isLiveMode && !gameJustCompleted" class="coaching-adjustments-v2">
                      <!-- Strategy Pills -->
                      <div class="strategy-section">
                        <div class="strategy-group">
                          <span class="strategy-label">Offense</span>
                          <div class="strategy-pills">
                            <button
                              v-for="style in offensiveStyles"
                              :key="style.value"
                              class="strategy-pill"
                              :class="{ active: selectedOffense === style.value }"
                              @click="selectedOffense = style.value"
                            >
                              {{ style.label }}
                            </button>
                          </div>
                        </div>
                        <div class="strategy-group">
                          <span class="strategy-label">Defense</span>
                          <div class="strategy-pills">
                            <button
                              v-for="style in defensiveStyles"
                              :key="style.value"
                              class="strategy-pill"
                              :class="{ active: selectedDefense === style.value }"
                              @click="selectedDefense = style.value"
                            >
                              {{ style.label }}
                            </button>
                          </div>
                        </div>
                        <!-- Continue Button -->
                        <div class="strategy-continue">
                          <BaseButton
                            variant="primary"
                            size="md"
                            class="continue-btn"
                            :loading="simulating"
                            @click="handleQuarterBreakContinue"
                          >
                            <span>{{ simulating ? 'Simulating...' : 'Continue' }}</span>
                            <ChevronRight v-if="!simulating" :size="18" />
                          </BaseButton>
                        </div>
                      </div>

                      <!-- Lineup Cards -->
                      <div class="lineup-cards-section">
                        <div class="lineup-cards-header">
                          <span class="lineup-cards-title">Starting Lineup</span>
                          <span class="lineup-cards-hint">Tap swap icon to make changes</span>
                        </div>
                        <div class="lineup-cards-grid">
                          <div
                            v-for="slot in currentStartersWithStats"
                            :key="slot.slotPosition"
                            class="lineup-card"
                            :class="{
                              empty: !slot.player,
                              'dropdown-open': expandedSwapPlayer === slot.slotIndex,
                              [slot.player ? getRatingClass(slot.player.overall_rating) : '']: !!slot.player
                            }"
                          >
                            <!-- Empty Slot -->
                            <template v-if="!slot.player">
                              <div class="lineup-card-empty">
                                <span class="slot-position-badge">{{ slot.slotPosition }}</span>
                                <span class="empty-text">Empty</span>
                                <button class="swap-btn" @click="toggleSwapDropdown(slot.slotIndex)">
                                  <ArrowUpDown :size="14" />
                                </button>
                              </div>
                            </template>

                            <!-- Filled Slot -->
                            <template v-else>
                              <div class="lineup-card-header">
                                <span class="slot-position-badge" :style="{ backgroundColor: getPositionColor(slot.slotPosition) }">
                                  {{ slot.slotPosition }}
                                </span>
                                <div class="lineup-player-info">
                                  <span class="lineup-player-name">{{ slot.player.name }}</span>
                                  <span class="lineup-inline-stats">
                                    {{ slot.player.points || 0 }}p {{ slot.player.rebounds || 0 }}r {{ slot.player.assists || 0 }}a
                                  </span>
                                </div>
                                <div class="lineup-card-actions">
                                  <button
                                    class="swap-btn"
                                    :class="{ active: expandedSwapPlayer === slot.slotIndex }"
                                    @click="toggleSwapDropdown(slot.slotIndex)"
                                  >
                                    <ArrowUpDown :size="14" />
                                  </button>
                                  <span class="lineup-player-ovr">{{ slot.player.overall_rating }}</span>
                                </div>
                              </div>
                            </template>

                            <!-- Swap Dropdown -->
                            <Transition name="dropdown-slide">
                              <div v-if="expandedSwapPlayer === slot.slotIndex" class="swap-dropdown">
                                <div class="swap-dropdown-header">
                                  {{ slot.player ? `Replace ${slot.player.name}` : `Select ${slot.slotPosition}` }}
                                </div>
                                <div class="swap-dropdown-list">
                                  <!-- Available bench players -->
                                  <button
                                    v-for="candidate in getSwapCandidates(slot.slotPosition, slot.slotIndex)"
                                    :key="candidate.player_id"
                                    class="swap-option"
                                    :class="{ injured: candidate.is_injured || candidate.isInjured }"
                                    @click="swapPlayerIn(slot.slotIndex, candidate.player_id)"
                                  >
                                    <ArrowUpDown :size="12" class="swap-option-icon" />
                                    <span
                                      class="swap-option-pos"
                                      :style="{ backgroundColor: getPositionColor(candidate.position) }"
                                    >
                                      {{ candidate.position }}
                                    </span>
                                    <span class="swap-option-name">{{ candidate.name }}</span>
                                    <span class="swap-option-stats">
                                      {{ candidate.points || 0 }}p {{ candidate.rebounds || 0 }}r
                                    </span>
                                    <span class="swap-option-ovr">{{ candidate.overall_rating }}</span>
                                  </button>
                                  <div v-if="getSwapCandidates(slot.slotPosition, slot.slotIndex).length === 0" class="swap-empty">
                                    No eligible players
                                  </div>
                                </div>
                              </div>
                            </Transition>
                          </div>
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
                  </div>
                </div>
              </Transition>
              </div>

              <!-- Live Stats Panel -->
              <div class="live-stats-panel">
                <div class="live-stats-grid">
                  <!-- Away Team Stats -->
                  <div class="live-stats-team">
                    <div class="live-stats-header" :style="{ borderColor: awayTeam?.primary_color }">
                      {{ awayTeam?.abbreviation }}
                    </div>
                    <div class="live-stats-list">
                      <div
                        v-for="player in topAwayScorers"
                        :key="player.player_id"
                        class="live-stat-card"
                        :class="{
                          'animate-rank-up': animatingStatPlayers[player.player_id] === 'up',
                          'animate-rank-down': animatingStatPlayers[player.player_id] === 'down'
                        }"
                      >
                        <div class="live-stat-name">{{ player.name?.split(' ').pop() }}</div>
                        <div class="live-stat-line">
                          <span class="stat-item">
                            <strong class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'points') }">{{ player.points || 0 }}</strong>
                            pts
                          </span>
                          <span class="stat-item">
                            <span class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'assists') }">{{ player.assists || 0 }}</span>
                            ast
                          </span>
                          <span class="stat-item">
                            <span class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'rebounds') }">{{ player.rebounds || 0 }}</span>
                            reb
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Home Team Stats -->
                  <div class="live-stats-team">
                    <div class="live-stats-header" :style="{ borderColor: homeTeam?.primary_color }">
                      {{ homeTeam?.abbreviation }}
                    </div>
                    <div class="live-stats-list">
                      <div
                        v-for="player in topHomeScorers"
                        :key="player.player_id"
                        class="live-stat-card"
                        :class="{
                          'animate-rank-up': animatingStatPlayers[player.player_id] === 'up',
                          'animate-rank-down': animatingStatPlayers[player.player_id] === 'down'
                        }"
                      >
                        <div class="live-stat-name">{{ player.name?.split(' ').pop() }}</div>
                        <div class="live-stat-line">
                          <span class="stat-item">
                            <strong class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'points') }">{{ player.points || 0 }}</strong>
                            pts
                          </span>
                          <span class="stat-item">
                            <strong class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'assists') }">{{ player.assists || 0 }}</strong>
                            ast
                          </span>
                          <span class="stat-item">
                            <strong class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'rebounds') }">{{ player.rebounds || 0 }}</strong>
                            reb
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Collapsible Live Box Score (hidden during quarter break) -->
            <div v-show="!isQuarterBreak" class="live-box-score-toggle" @click="showLiveBoxScore = !showLiveBoxScore">
              <span class="toggle-label">Full Box Score</span>
              <span class="toggle-icon" :class="{ open: showLiveBoxScore }">▼</span>
            </div>

            <Transition name="slide-down">
              <div v-if="showLiveBoxScore && !isQuarterBreak" class="live-box-score-container">
                <!-- Team Tabs -->
                <div class="live-box-tabs">
                  <button
                    class="live-box-tab"
                    :class="{ active: liveBoxScoreTab === 'away' }"
                    @click="liveBoxScoreTab = 'away'"
                  >
                    <div class="team-color" :style="{ backgroundColor: awayTeam?.primary_color || '#EF4444' }" />
                    <span>{{ awayTeam?.abbreviation || 'AWAY' }}</span>
                  </button>
                  <button
                    class="live-box-tab"
                    :class="{ active: liveBoxScoreTab === 'home' }"
                    @click="liveBoxScoreTab = 'home'"
                  >
                    <div class="team-color" :style="{ backgroundColor: homeTeam?.primary_color || '#3B82F6' }" />
                    <span>{{ homeTeam?.abbreviation || 'HOME' }}</span>
                  </button>
                </div>

                <!-- Stats Table -->
                <div class="live-box-table-container">
                  <table class="live-box-table">
                    <thead>
                      <tr>
                        <th
                          v-for="col in liveBoxScoreColumns"
                          :key="col.key"
                          :class="[col.class, 'sortable', { active: liveBoxSortColumn === col.key }]"
                          @click="sortLiveBoxBy(col.key)"
                        >
                          {{ col.label }}{{ getLiveBoxSortIcon(col.key) }}
                        </th>
                        <th class="stat-col shooting">FG</th>
                        <th class="stat-col shooting">3PT</th>
                        <th class="stat-col shooting">FT</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="player in activeLiveBoxStats"
                        :key="player.player_id"
                        class="player-row"
                      >
                        <td class="player-col">
                          <div class="player-info">
                            <span class="player-name">{{ player.name }}</span>
                            <span class="player-pos">{{ player.position }}<template v-if="player.secondary_position">/{{ player.secondary_position }}</template></span>
                          </div>
                        </td>
                        <td class="stat-col">{{ player.minutes || 0 }}</td>
                        <td class="stat-col points">
                          <span class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'points') }">
                            {{ player.points || 0 }}
                          </span>
                        </td>
                        <td class="stat-col">
                          <span class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'rebounds') }">
                            {{ player.rebounds || 0 }}
                          </span>
                        </td>
                        <td class="stat-col">
                          <span class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'assists') }">
                            {{ player.assists || 0 }}
                          </span>
                        </td>
                        <td class="stat-col">
                          <span class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'steals') }">
                            {{ player.steals || 0 }}
                          </span>
                        </td>
                        <td class="stat-col">
                          <span class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'blocks') }">
                            {{ player.blocks || 0 }}
                          </span>
                        </td>
                        <td class="stat-col turnovers">
                          <span class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'turnovers') }">
                            {{ player.turnovers || 0 }}
                          </span>
                        </td>
                        <td class="stat-col shooting">
                          <span class="shooting-line">{{ formatShootingLine(player.fgm, player.fga) }}</span>
                          <span class="shooting-pct">{{ formatPercentage(player.fgm, player.fga) }}</span>
                        </td>
                        <td class="stat-col shooting">
                          <span class="shooting-line">{{ formatShootingLine(player.fg3m, player.fg3a) }}</span>
                          <span class="shooting-pct">{{ formatPercentage(player.fg3m, player.fg3a) }}</span>
                        </td>
                        <td class="stat-col shooting">
                          <span class="shooting-line">{{ formatShootingLine(player.ftm, player.fta) }}</span>
                          <span class="shooting-pct">{{ formatPercentage(player.ftm, player.fta) }}</span>
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr class="totals-row">
                        <td class="player-col">TOTALS</td>
                        <td class="stat-col">-</td>
                        <td class="stat-col points">{{ activeLiveBoxTotals.points }}</td>
                        <td class="stat-col">{{ activeLiveBoxTotals.rebounds }}</td>
                        <td class="stat-col">{{ activeLiveBoxTotals.assists }}</td>
                        <td class="stat-col">{{ activeLiveBoxTotals.steals }}</td>
                        <td class="stat-col">{{ activeLiveBoxTotals.blocks }}</td>
                        <td class="stat-col turnovers">{{ activeLiveBoxTotals.turnovers }}</td>
                        <td class="stat-col shooting">
                          <span class="shooting-line">{{ formatShootingLine(activeLiveBoxTotals.fgm, activeLiveBoxTotals.fga) }}</span>
                          <span class="shooting-pct">{{ formatPercentage(activeLiveBoxTotals.fgm, activeLiveBoxTotals.fga) }}</span>
                        </td>
                        <td class="stat-col shooting">
                          <span class="shooting-line">{{ formatShootingLine(activeLiveBoxTotals.fg3m, activeLiveBoxTotals.fg3a) }}</span>
                          <span class="shooting-pct">{{ formatPercentage(activeLiveBoxTotals.fg3m, activeLiveBoxTotals.fg3a) }}</span>
                        </td>
                        <td class="stat-col shooting">
                          <span class="shooting-line">{{ formatShootingLine(activeLiveBoxTotals.ftm, activeLiveBoxTotals.fta) }}</span>
                          <span class="shooting-pct">{{ formatPercentage(activeLiveBoxTotals.ftm, activeLiveBoxTotals.fta) }}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </Transition>
            </template>

            <!-- Loading indicator while waiting for animation data -->
            <div v-else-if="!hasAnimationData" class="flex items-center justify-center py-8">
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
            <!-- Court Preview with Starters Overlay -->
            <GlassCard padding="lg" :hoverable="false">
              <h3 class="h4 mb-4">Starting Lineups</h3>
              <div class="court-container court-container-with-overlay">
                <BasketballCourt
                  :width="500"
                  :height="300"
                  :home-team="homeTeam"
                  :away-team="awayTeam"
                  :show-players="false"
                />
                <!-- Starters Overlay -->
                <div class="starters-overlay">
                  <!-- Away Team Starters -->
                  <div class="starters-column">
                    <div class="starters-header" :style="{ borderColor: awayTeam?.primary_color }">
                      {{ awayTeam?.abbreviation }}
                    </div>
                    <div class="starters-list">
                      <div v-for="player in awayStarters" :key="player.id || player.player_id" class="starter-row">
                        <span class="starter-pos">{{ player.slotPosition }}</span>
                        <span class="starter-name">{{ player.last_name || player.lastName || player.name?.split(' ').pop() }}</span>
                        <span class="starter-ovr">{{ player.overall_rating || player.overallRating }}</span>
                      </div>
                    </div>
                  </div>
                  <!-- Home Team Starters -->
                  <div class="starters-column">
                    <div class="starters-header" :style="{ borderColor: homeTeam?.primary_color }">
                      {{ homeTeam?.abbreviation }}
                    </div>
                    <div class="starters-list">
                      <div v-for="player in homeStarters" :key="player.id || player.player_id" class="starter-row">
                        <span class="starter-pos">{{ player.slotPosition }}</span>
                        <span class="starter-name">{{ player.last_name || player.lastName || player.name?.split(' ').pop() }}</span>
                        <span class="starter-ovr">{{ player.overall_rating || player.overallRating }}</span>
                      </div>
                    </div>
                  </div>
                </div>
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
                  @click="handlePlayGame"
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
                  @click="startGame"
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
        <GlassCard v-if="showAnimationMode && hasAnimationData" padding="none" :hoverable="false" class="mb-6">
          <!-- Court with animation and overlays -->
          <div class="court-container court-in-replay">
            <!-- Animation Controls inside court -->
            <div class="animation-controls">
              <button
                class="play-pause-btn"
                @click="togglePlayPause"
                :title="isPlaying ? 'Pause' : 'Play'"
              >
                <Play v-if="!isPlaying" :size="18" fill="currentColor" />
                <Pause v-else :size="18" fill="currentColor" />
              </button>

              <div class="speed-buttons">
                <button
                  class="speed-btn"
                  :class="{ active: playbackSpeed === 1 }"
                  @click="setSpeed(1)"
                >1x</button>
                <button
                  class="speed-btn"
                  :class="{ active: playbackSpeed === 2 }"
                  @click="setSpeed(2)"
                >2x</button>
                <button
                  class="speed-btn"
                  :class="{ active: playbackSpeed === 4 }"
                  @click="setSpeed(4)"
                >4x</button>
              </div>
            </div>

            <BasketballCourt
              ref="courtRef"
              :width="500"
              :height="300"
              :home-team="homeTeam"
              :away-team="awayTeam"
              :animation-mode="true"
              :interpolated-positions="interpolatedPositions"
              :interpolated-ball-position="interpolatedBallPosition"
              :home-roster="boxScore.home"
              :away-roster="boxScore.away"
              :show-trails="true"
              :play-name="currentPlayName"
              :play-description="currentDescription"
              :play-team-abbreviation="currentTeam === 'home' ? homeTeam?.abbreviation : awayTeam?.abbreviation"
              :play-team-color="currentTeam === 'home' ? homeTeam?.primary_color : awayTeam?.primary_color"
              :game-clock="gameClock"
              :activated-badges="currentActivatedBadges"
            />

            <!-- Quarter Break Overlay (for replay) -->
            <Transition name="fade">
              <div v-if="isQuarterBreak" class="quarter-break-overlay">
                <div class="quarter-break-content">
                  <!-- Game Complete (Q4 finished in replay) -->
                  <template v-if="completedQuarter >= 4">
                    <h2 class="quarter-break-title game-complete-title">Final</h2>
                    <p class="game-complete-subtitle">Game Complete</p>
                  </template>
                  <!-- Quarter Break -->
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
                      <span class="break-team-name">{{ homeTeam?.name }}</span>
                      <span class="break-team-score" :style="{ color: homeTeam?.primary_color }">
                        {{ currentHomeScore }}
                      </span>
                    </div>
                  </div>
                  <!-- Game Complete: View Box Score -->
                  <template v-if="completedQuarter >= 4">
                    <p class="break-hint">View the full box score and game statistics</p>
                    <BaseButton variant="primary" size="lg" @click="viewBoxScore">
                      View Box Score
                    </BaseButton>
                  </template>
                  <!-- Quarter Break: Continue -->
                  <template v-else>
                    <p class="break-hint">Replay mode - click to continue</p>
                    <BaseButton variant="primary" size="lg" @click="handleQuarterBreakContinue">
                      Continue to Quarter {{ completedQuarter + 1 }}
                    </BaseButton>
                  </template>
                </div>
              </div>
            </Transition>
          </div>
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
              <span v-if="selectedPlayer.overall_rating" class="ovr-badge" :class="getRatingClass(selectedPlayer.overall_rating)">
                {{ selectedPlayer.overall_rating }} OVR
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

    <!-- Simulate Games Modal -->
    <SimulateConfirmModal
      :show="showSimulateModal"
      :preview="gameStore.simulatePreview"
      :loading="gameStore.loadingPreview"
      :simulating="gameStore.simulating"
      :user-team="userTeam"
      @close="handleCloseSimulateModal"
      @confirm="handleConfirmSimulate"
    />
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

/* Game Header Card with cosmic background */
.game-header-card {
  background: var(--gradient-cosmic) !important;
  border: 1px solid rgba(232, 90, 79, 0.3);
}

.game-header-card .team-rating,
.game-header-card .team-rank,
.game-header-card .game-date {
  color: rgba(0, 0, 0, 0.7);
}

.game-header-card .vs-text,
.game-header-card .final-text,
.game-header-card .in-progress-text {
  color: var(--color-text-primary);
}

.game-header-card .user-game-badge {
  background: rgba(0, 0, 0, 0.15);
  color: var(--color-text-primary);
}

.game-header-card .team-score-lg {
  color: var(--color-text-primary);
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.3);
}

/* Light mode game header adjustments */
[data-theme="light"] .game-header-card .team-rating,
[data-theme="light"] .game-header-card .team-rank,
[data-theme="light"] .game-header-card .game-date {
  color: rgba(255, 255, 255, 0.85);
}

[data-theme="light"] .game-header-card .vs-text,
[data-theme="light"] .game-header-card .final-text,
[data-theme="light"] .game-header-card .in-progress-text,
[data-theme="light"] .game-header-card .team-score-lg {
  color: white;
}

[data-theme="light"] .game-header-card .user-game-badge {
  background: rgba(255, 255, 255, 0.25);
  color: white;
}

[data-theme="light"] .game-header-card .team-name-text {
  color: white;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
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

.team-name-with-logo {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.team-logo-mini {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.team-name-text {
  font-size: 0.8rem;
  font-weight: 600;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
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

.in-progress-text {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-warning);
  text-transform: uppercase;
  letter-spacing: 0.05em;
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

/* Mobile rotated court adjustments */
@media (max-width: 620px) {
  .court-container {
    overflow: visible;
    min-height: 520px;
    align-items: center;
  }
}

/* Court container with starters overlay */
.court-container-with-overlay {
  position: relative;
}

/* Starters overlay centered on court */
.starters-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  padding: 16px 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  min-width: 320px;
}

.starters-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.starters-header {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  text-align: center;
  padding-bottom: 6px;
  border-bottom: 2px solid;
  color: var(--color-text-primary);
}

.starters-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.starter-row {
  display: grid;
  grid-template-columns: 28px 1fr 32px;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  padding: 4px 0;
}

.starter-pos {
  font-weight: 600;
  color: var(--color-secondary);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.starter-name {
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.starter-ovr {
  font-weight: 700;
  color: var(--color-success);
  text-align: right;
  font-size: 0.75rem;
}

/* Light mode starters overlay */
[data-theme="light"] .starters-overlay {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.1);
}

/* Mobile adjustments for starters overlay */
@media (max-width: 620px) {
  .starters-overlay {
    min-width: 280px;
    gap: 16px;
    padding: 12px 16px;
  }

  .starter-row {
    font-size: 0.75rem;
    grid-template-columns: 24px 1fr 28px;
  }
}

/* Quarter Break Overlay */
.quarter-break-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  z-index: 9999;
  overflow-y: auto;
  padding: 20px;
}

.quarter-break-content {
  text-align: center;
  padding: 24px;
  max-width: 100%;
  margin: auto 0;
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

/* Quarter Break V2 Styles */
.coaching-adjustments-v2 {
  width: 100%;
  max-width: 600px;
  margin: 0 auto 24px;
}

.strategy-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.strategy-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.strategy-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  text-align: center;
}

.strategy-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}

.strategy-pill {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.strategy-pill:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
  color: var(--color-text-primary);
}

.strategy-pill.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.strategy-continue {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.strategy-continue .continue-btn {
  width: 33.333%;
  min-width: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.strategy-continue .continue-btn span {
  flex-shrink: 0;
}

/* Lineup Cards Section */
.lineup-cards-section {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 20px;
}

.lineup-cards-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.lineup-cards-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.lineup-cards-hint {
  font-size: 0.65rem;
  color: var(--color-secondary);
}

.lineup-cards-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Individual Lineup Card - matches player-card from roster */
.lineup-card {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: all 0.2s ease;
  position: relative;
}

.lineup-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.08) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

.lineup-card > * {
  position: relative;
  z-index: 1;
}

.lineup-card.dropdown-open {
  border-color: var(--color-primary);
}

.lineup-card.elite {
  border-left: 3px solid #FFD700;
}

.lineup-card.star {
  border-left: 3px solid #A855F7;
}

.lineup-card.starter {
  border-left: 3px solid #3B82F6;
}

.lineup-card.empty {
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.15);
}

.lineup-card.empty::before {
  background: none;
}

.lineup-card-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.lineup-card-empty .empty-text {
  flex: 1;
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
}

.lineup-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.1);
}

.slot-position-badge {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
}

.lineup-player-info {
  flex: 1;
  min-width: 0;
}

.lineup-player-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
  display: block;
}

.lineup-inline-stats {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  font-weight: 500;
  display: block;
}

.lineup-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.swap-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 6px;
  color: var(--color-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.swap-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: var(--color-text-primary);
}

.swap-btn.active {
  background: var(--color-primary);
  color: white;
}

.lineup-player-ovr {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-success);
  min-width: 24px;
  text-align: right;
}

/* Swap Dropdown - matches move-dropdown from roster */
.swap-dropdown {
  background: var(--color-bg-tertiary);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.swap-dropdown-header {
  padding: 10px 12px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  background: rgba(0, 0, 0, 0.15);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.swap-dropdown-list {
  max-height: 160px;
  overflow-y: auto;
}

.swap-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background 0.15s ease;
  text-align: left;
}

.swap-option:last-child {
  border-bottom: none;
}

.swap-option:hover {
  background: rgba(255, 255, 255, 0.08);
}

.swap-option.injured {
  opacity: 0.5;
}

.swap-option-pos {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  color: white;
}

.swap-option-name {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 500;
}

.swap-option-stats {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
}

.swap-option-ovr {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--color-success);
  min-width: 24px;
  text-align: right;
}

.swap-empty {
  padding: 16px;
  text-align: center;
  color: var(--color-secondary);
  font-size: 0.8rem;
}

/* Dropdown slide animation */
.dropdown-slide-enter-active,
.dropdown-slide-leave-active {
  transition: all 0.2s ease;
}

.dropdown-slide-enter-from,
.dropdown-slide-leave-to {
  opacity: 0;
  max-height: 0;
}

.dropdown-slide-enter-to,
.dropdown-slide-leave-from {
  opacity: 1;
  max-height: 250px;
}

/* Light mode adjustments */
[data-theme="light"] .coaching-adjustments-v2 .strategy-pill {
  background: rgba(0, 0, 0, 0.05);
  border-color: rgba(0, 0, 0, 0.1);
  color: var(--color-text-secondary);
}

[data-theme="light"] .coaching-adjustments-v2 .strategy-pill:hover {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .coaching-adjustments-v2 .lineup-card {
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .coaching-adjustments-v2 .lineup-card::before {
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.05) 0%, transparent 40%);
}

[data-theme="light"] .coaching-adjustments-v2 .lineup-card.empty {
  border-color: rgba(0, 0, 0, 0.15);
}

[data-theme="light"] .coaching-adjustments-v2 .lineup-card-header {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .coaching-adjustments-v2 .swap-dropdown {
  border-top-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .coaching-adjustments-v2 .swap-dropdown-header {
  background: rgba(0, 0, 0, 0.04);
  border-bottom-color: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .coaching-adjustments-v2 .swap-option {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .coaching-adjustments-v2 .swap-option:hover {
  background: rgba(0, 0, 0, 0.06);
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
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(232, 90, 79, 0.08) 0%, rgba(244, 162, 89, 0.06) 50%, rgba(232, 90, 79, 0.04) 100%);
  border: 1px solid rgba(232, 90, 79, 0.15);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
}

.performer-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 85% 95%, rgba(232, 90, 79, 0.06) 0%, transparent 40%),
    radial-gradient(ellipse at 15% 5%, rgba(244, 162, 89, 0.04) 0%, transparent 35%);
  pointer-events: none;
  z-index: 0;
}

.performer-card > * {
  position: relative;
  z-index: 1;
}

.performer-card:hover {
  background: linear-gradient(135deg, rgba(232, 90, 79, 0.12) 0%, rgba(244, 162, 89, 0.08) 50%, rgba(232, 90, 79, 0.06) 100%);
  border-color: rgba(232, 90, 79, 0.25);
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

.ovr-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  background: rgba(255, 255, 255, 0.15);
}

.ovr-badge.elite {
  background: linear-gradient(135deg, #FFD700, #FFA500);
  color: #1a1520;
}

.ovr-badge.star {
  background: linear-gradient(135deg, #A855F7, #7C3AED);
}

.ovr-badge.starter {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
}

.ovr-badge.rotation {
  background: rgba(255, 255, 255, 0.2);
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

/* Broadcast-style Scoreboard with Court */
.broadcast-court-card {
  border: 1px solid rgba(232, 90, 79, 0.2);
  overflow: hidden;
}

.broadcast-header {
  background: var(--gradient-cosmic);
  padding: 12px 20px 8px;
}

.broadcast-scoreboard {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.broadcast-date {
  text-align: center;
  font-size: 0.7rem;
  color: rgba(0, 0, 0, 0.5);
  font-weight: 500;
  margin-top: 6px;
}

.broadcast-team-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.broadcast-record {
  font-size: 0.7rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.5);
  letter-spacing: 0.12em;
}

/* Court and Stats Row Layout */
.court-stats-row {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 16px;
}

.court-in-broadcast {
  display: flex;
  flex-direction: column;
}

.court-in-replay {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-radius: 0;
}

/* Live Stats Panel */
.live-stats-panel {
  width: 200px;
  flex-shrink: 0;
}

.live-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  height: 100%;
}

.live-stats-team {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  overflow: hidden;
}

.live-stats-header {
  padding: 8px 10px;
  font-size: 0.75rem;
  font-weight: 700;
  text-align: center;
  border-bottom: 2px solid;
  background: rgba(0, 0, 0, 0.3);
}

.live-stats-list {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.live-stat-card {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  padding: 6px 8px;
}

.live-stat-name {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-stat-line {
  display: flex;
  gap: 6px;
  font-size: 0.6rem;
  color: var(--color-text-tertiary);
}

.live-stat-line .stat-item strong {
  color: var(--color-text-primary);
}

/* Stat value slide animation */
.stat-value-slot {
  position: relative;
  display: inline-block;
  min-width: 1ch;
}

.stat-slide-enter-active,
.stat-slide-leave-active {
  transition: all 0.25s ease-out;
}

.stat-slide-enter-from {
  opacity: 0;
  transform: translateY(100%);
}

.stat-slide-leave-to {
  opacity: 0;
  transform: translateY(-100%);
  position: absolute;
}

.stat-slide-leave-active {
  position: absolute;
}

.broadcast-team {
  display: flex;
  align-items: center;
  gap: 12px;
}

.broadcast-team-logo {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 800;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.broadcast-score-container {
  position: relative;
  min-width: 56px;
  width: auto;
  height: 48px;
  overflow: hidden;
}

.score-slot {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.broadcast-score {
  font-size: 2.25rem;
  font-weight: 800;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
  color: #000000;
  line-height: 1;
  white-space: nowrap;
}

.broadcast-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 60px;
}

.broadcast-quarter {
  font-size: 0.9rem;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.broadcast-time {
  font-size: 0.95rem;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.9);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.broadcast-live {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  color: #dc2626;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.live-dot {
  width: 6px;
  height: 6px;
  background: #dc2626;
  border-radius: 50%;
  animation: pulse-live 1.5s infinite;
}

/* Light mode broadcast adjustments */
[data-theme="light"] .broadcast-date {
  color: rgba(255, 255, 255, 0.7);
}

[data-theme="light"] .broadcast-record {
  color: rgba(255, 255, 255, 0.75);
}

[data-theme="light"] .broadcast-live {
  background: rgba(255, 255, 255, 0.2);
}

[data-theme="light"] .broadcast-quarter {
  color: rgba(255, 255, 255, 0.9);
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

/* Score slide animation */
.score-slide-enter-active,
.score-slide-leave-active {
  transition: all 0.35s ease-out;
}

.score-slide-enter-from {
  opacity: 0;
  transform: translateY(100%);
}

.score-slide-leave-to {
  opacity: 0;
  transform: translateY(-100%);
  position: absolute;
}

.score-slide-leave-active {
  position: absolute;
  width: 100%;
}

@media (max-width: 500px) {
  .team-name-with-logo {
    display: none;
  }
}

@media (max-width: 700px) {
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
}

@media (max-width: 400px) {
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
  background: linear-gradient(135deg, rgba(232, 90, 79, 0.06) 0%, rgba(244, 162, 89, 0.04) 50%, rgba(232, 90, 79, 0.02) 100%);
  border-color: rgba(232, 90, 79, 0.12);
}

[data-theme="light"] .performer-card::after {
  background:
    radial-gradient(ellipse at 15% 5%, rgba(232, 90, 79, 0.05) 0%, transparent 40%),
    radial-gradient(ellipse at 85% 95%, rgba(244, 162, 89, 0.03) 0%, transparent 35%);
}

[data-theme="light"] .performer-card:hover {
  background: linear-gradient(135deg, rgba(232, 90, 79, 0.1) 0%, rgba(244, 162, 89, 0.06) 50%, rgba(232, 90, 79, 0.04) 100%);
  border-color: rgba(232, 90, 79, 0.2);
}

[data-theme="light"] .live-stats-team {
  background: rgba(0, 0, 0, 0.05);
}

[data-theme="light"] .live-stats-header {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .live-stat-card {
  background: rgba(0, 0, 0, 0.04);
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


/* Animation Controls above court */
.animation-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
}

.play-pause-btn {
  background: rgba(0, 0, 0, 0.5);
  border: none;
  color: white;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.play-pause-btn:hover {
  background: rgba(0, 0, 0, 0.7);
  transform: scale(1.05);
}

.speed-buttons {
  display: flex;
  gap: 4px;
}

.speed-btn {
  background: rgba(0, 0, 0, 0.4);
  border: none;
  color: rgba(255, 255, 255, 0.8);
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: all 0.2s;
}

.speed-btn:hover {
  background: rgba(0, 0, 0, 0.6);
  color: white;
}

.speed-btn.active {
  background: var(--color-primary);
  color: white;
}

/* Mobile adjustments for animation controls */
@media (max-width: 620px) {
  .broadcast-header {
    padding: 10px 16px 6px;
  }

  .broadcast-scoreboard {
    gap: 12px;
  }

  .broadcast-date {
    font-size: 0.6rem;
    margin-top: 4px;
  }

  .broadcast-team-column {
    gap: 2px;
  }

  .broadcast-record {
    font-size: 0.6rem;
  }

  .broadcast-team-logo {
    width: 36px;
    height: 36px;
    font-size: 0.7rem;
  }

  .broadcast-score-container {
    min-width: 40px;
    width: auto;
    height: 40px;
  }

  .broadcast-score {
    font-size: 1.5rem;
  }

  .broadcast-quarter {
    font-size: 0.8rem;
  }

  .court-stats-row {
    padding: 12px;
  }

  .court-in-broadcast,
  .court-in-replay {
    padding: 0;
  }

  .live-stats-panel {
    display: none;
  }

  .animation-controls {
    padding-bottom: 10px;
  }

  .play-pause-btn {
    width: 32px;
    height: 32px;
  }

  .speed-btn {
    padding: 5px 8px;
    font-size: 10px;
  }
}

/* Stat pop animation for live box score */
@keyframes stat-pop {
  0% {
    transform: scale(1);
    color: inherit;
  }
  30% {
    transform: scale(1.3);
    color: var(--color-success);
  }
  100% {
    transform: scale(1);
    color: inherit;
  }
}

.stat-value {
  display: inline-block;
  transition: color 0.3s ease;
}

.stat-pop {
  animation: stat-pop 0.3s ease-out;
}

/* Ranking change animations */
@keyframes rank-slide-up {
  0% {
    transform: translateY(20px);
    opacity: 0.5;
    background: rgba(16, 185, 129, 0.2);
  }
  50% {
    background: rgba(16, 185, 129, 0.15);
  }
  100% {
    transform: translateY(0);
    opacity: 1;
    background: rgba(255, 255, 255, 0.05);
  }
}

@keyframes rank-slide-down {
  0% {
    transform: translateY(-20px);
    opacity: 0.5;
    background: rgba(239, 68, 68, 0.15);
  }
  50% {
    background: rgba(239, 68, 68, 0.1);
  }
  100% {
    transform: translateY(0);
    opacity: 1;
    background: rgba(255, 255, 255, 0.05);
  }
}

.animate-rank-up {
  animation: rank-slide-up 0.4s ease-out;
}

.animate-rank-down {
  animation: rank-slide-down 0.4s ease-out;
}

/* 800px breakpoint: Stats below court in horizontal layout */
@media (max-width: 800px) {
  .court-stats-row {
    flex-direction: column;
    align-items: center;
  }

  .live-stats-panel {
    width: 100%;
    max-width: 500px;
    margin-top: 12px;
  }

  .live-stats-grid {
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .live-stats-team {
    display: flex;
    flex-direction: column;
  }

  .live-stats-list {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px;
  }

  .live-stat-card {
    flex: 0 0 calc(50% - 3px);
    min-width: 80px;
    max-width: calc(50% - 3px);
  }
}

/* Horizontal ranking animations for 800px breakpoint */
@media (max-width: 800px) {
  @keyframes rank-slide-up {
    0% {
      transform: translateX(-20px);
      opacity: 0.5;
      background: rgba(16, 185, 129, 0.2);
    }
    50% {
      background: rgba(16, 185, 129, 0.15);
    }
    100% {
      transform: translateX(0);
      opacity: 1;
      background: rgba(255, 255, 255, 0.05);
    }
  }

  @keyframes rank-slide-down {
    0% {
      transform: translateX(20px);
      opacity: 0.5;
      background: rgba(239, 68, 68, 0.15);
    }
    50% {
      background: rgba(239, 68, 68, 0.1);
    }
    100% {
      transform: translateX(0);
      opacity: 1;
      background: rgba(255, 255, 255, 0.05);
    }
  }
}

/* Collapsible Live Box Score */
.live-box-score-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.3);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  transition: background 0.2s ease;
  position: relative;
  z-index: 10;
}

.live-box-score-toggle:hover {
  background: rgba(0, 0, 0, 0.4);
}

.live-box-score-container {
  position: relative;
  z-index: 10;
  background: var(--color-bg-secondary);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.toggle-label {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.toggle-icon {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  transition: transform 0.3s ease;
}

.toggle-icon.open {
  transform: rotate(180deg);
}

/* Slide down animation */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  max-height: 0;
}

.slide-down-enter-to,
.slide-down-leave-from {
  opacity: 1;
  max-height: 600px;
}

/* Live Box Score Tabs */
.live-box-tabs {
  display: flex;
  gap: 4px;
  padding: 6px;
  background: rgba(0, 0, 0, 0.2);
}

.live-box-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--color-secondary);
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.live-box-tab:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.live-box-tab.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
  box-shadow: 0 2px 8px rgba(232, 90, 79, 0.3);
}

.live-box-tab .team-color {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

/* Live Box Score Table */
.live-box-table-container {
  overflow-x: auto;
}

.live-box-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.live-box-table th,
.live-box-table td {
  padding: 6px 6px;
  text-align: center;
}

.live-box-table th {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-secondary);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.live-box-table th.sortable {
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.live-box-table th.sortable:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.live-box-table th.sortable.active {
  color: var(--color-primary);
  background: rgba(232, 90, 79, 0.1);
}

.live-box-table .player-col {
  text-align: left !important;
  min-width: 130px;
}

.live-box-table .stat-col {
  min-width: 36px;
}

.live-box-table .stat-col.shooting {
  min-width: 60px;
}

.live-box-table .player-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.15s ease;
}

.live-box-table .player-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.live-box-table .player-row:nth-child(even) {
  background: rgba(255, 255, 255, 0.02);
}

.live-box-table .player-row:nth-child(even):hover {
  background: rgba(255, 255, 255, 0.06);
}

.live-box-table .player-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.live-box-table .player-name {
  font-weight: 600;
  font-size: 0.8rem;
  white-space: nowrap;
}

.live-box-table .player-pos {
  font-size: 0.65rem;
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.live-box-table .stat-col.points {
  font-weight: 600;
  color: var(--color-primary);
}

.live-box-table .stat-col.turnovers {
  color: var(--color-error);
}

.live-box-table .shooting-line {
  display: block;
  font-weight: 600;
  font-size: 0.8rem;
}

.live-box-table .shooting-pct {
  display: block;
  font-size: 0.65rem;
  color: var(--color-secondary);
}

.live-box-table .totals-row {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.04));
  font-weight: 700;
  border-top: 2px solid rgba(255, 255, 255, 0.1);
}

.live-box-table .totals-row td {
  padding: 10px 6px;
}

.live-box-table .totals-row .player-col {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-secondary);
}

/* Light mode overrides for live box score */
[data-theme="light"] .live-box-score-toggle {
  background: rgba(0, 0, 0, 0.06);
  border-top-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .live-box-score-toggle:hover {
  background: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .live-box-tabs {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .live-box-tab {
  color: var(--color-text-secondary);
  background: white;
}

[data-theme="light"] .live-box-tab:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--color-text-primary);
}

[data-theme="light"] .live-box-tab.active {
  background: var(--gradient-cosmic);
  color: black;
}

[data-theme="light"] .live-box-table th {
  background: rgba(0, 0, 0, 0.04);
  border-bottom-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .live-box-table th.sortable:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--color-text-primary);
}

[data-theme="light"] .live-box-table th.sortable.active {
  background: rgba(232, 90, 79, 0.12);
}

[data-theme="light"] .live-box-table .player-row {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .live-box-table .player-row:hover {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .live-box-table .player-row:nth-child(even) {
  background: rgba(0, 0, 0, 0.02);
}

[data-theme="light"] .live-box-table .player-row:nth-child(even):hover {
  background: rgba(0, 0, 0, 0.05);
}

[data-theme="light"] .live-box-table .totals-row {
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0.03));
  border-top-color: rgba(0, 0, 0, 0.1);
}
</style>
