<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useCampaignStore } from '@/stores/campaign'
import { useLeagueStore } from '@/stores/league'
import { useTeamStore } from '@/stores/team'
import { useToastStore } from '@/stores/toast'
import { GlassCard, BaseButton, LoadingSpinner, StatBadge, BaseModal } from '@/components/ui'
import { User, Users, Play, Pause, ArrowUpDown, ArrowLeft, ChevronRight, ChevronDown, TrendingUp, TrendingDown, AlertTriangle, Flame, Snowflake, Heart, Activity, Newspaper, Coins, Trophy, Zap, FastForward } from 'lucide-vue-next'
import BasketballCourt from '@/components/game/BasketballCourt.vue'
import BoxScore from '@/components/game/BoxScore.vue'
import { SimulateConfirmModal, EvolutionSummary } from '@/components/game'
import { usePlayAnimation } from '@/composables/usePlayAnimation'
import { usePositionValidation } from '@/composables/usePositionValidation'

const route = useRoute()
const router = useRouter()
const gameStore = useGameStore()
const campaignStore = useCampaignStore()
const leagueStore = useLeagueStore()
const teamStore = useTeamStore()
const toastStore = useToastStore()

// Animation composable
const {
  animationData,
  currentPossessionIndex,
  currentKeyframeIndex,
  currentKeyframe,
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
const showLiveBoxScore = ref(true)
const liveBoxScoreTab = ref('away') // Start with away team (visitor listed first traditionally)
const liveBoxSortColumn = ref('points')
const liveBoxSortDirection = ref('desc')
const showAllLiveBoxPlayers = ref(false)
const LIVE_BOX_INITIAL_COUNT = 7

// Track previous stat values for animations { playerId: { points: 5, assists: 2, ... } }
const prevPlayerStats = ref({})

// Track which stats are currently animating { `${playerId}-${statKey}`: true }
const animatingStats = ref({})

// Simulate modal state
const showSimulateModal = ref(false)

// Coaching style selections for quarter breaks
const selectedOffense = ref('balanced')
const selectedDefense = ref('man')

// Local lineup for quarter-break adjustments (synced from teamStore)
// During pre-game: synced from teamStore.lineup
// During game: used for quarter-break substitutions
const localLineup = ref([null, null, null, null, null])
const positionLabels = ['PG', 'SG', 'SF', 'PF', 'C']

// Alias for backwards compatibility with existing code
const selectedLineup = localLineup

// Expanded swap dropdown state for quarter break
const expandedSwapPlayer = ref(null)
// Track if substitutions view is open in quarter break modal
const showSubstitutionsView = ref(false)

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
// User's roster comes from teamStore (single source of truth)
// Opponent's roster is fetched separately and stored locally
const opponentRoster = ref([])

// Computed rosters that use teamStore for user team, local ref for opponent
const userRoster = computed(() => teamStore.roster || [])

const homeRoster = computed(() =>
  userIsHome.value ? userRoster.value : opponentRoster.value
)
const awayRoster = computed(() =>
  userIsHome.value ? opponentRoster.value : userRoster.value
)

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
const evolutionData = computed(() => game.value?.evolution)
const gameNews = computed(() => game.value?.news || [])
const rewardsData = computed(() => game.value?.rewards)

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

// Persistent tracking of on-court players to prevent "popping" during transitions
const lastKnownOnCourtIds = ref([])

// Get on-court player IDs from current keyframe positions (most stable source)
// Updates lastKnownOnCourtIds when valid data is available
const onCourtPlayerIds = computed(() => {
  // First try: current keyframe positions (direct from animation data)
  const keyframePositions = currentKeyframe.value?.positions
  if (keyframePositions && Object.keys(keyframePositions).length >= 10) {
    const ids = Object.keys(keyframePositions)
    // Update persistent tracking
    lastKnownOnCourtIds.value = ids
    return ids
  }
  // Second try: interpolated positions
  const interpPositions = interpolatedPositions.value
  if (interpPositions && Object.keys(interpPositions).length >= 10) {
    const ids = Object.keys(interpPositions)
    lastKnownOnCourtIds.value = ids
    return ids
  }
  // Use last known on-court IDs during transitions
  if (lastKnownOnCourtIds.value.length >= 10) {
    return lastKnownOnCourtIds.value
  }
  // No animation data available
  return []
})

// Normalize ID for comparison (handles both string and number IDs)
function normalizeId(id) {
  return String(id).trim()
}

// Get user's current lineup IDs (from selectedLineup during live mode)
const userLineupIds = computed(() => {
  if (isLiveMode.value && selectedLineup.value) {
    return selectedLineup.value.filter(id => id != null).map(normalizeId)
  }
  return []
})

// Sort players by points (descending) - ensure numeric comparison
function sortByPoints(players) {
  return [...players].sort((a, b) => {
    const ptsA = Number(a.points) || 0
    const ptsB = Number(b.points) || 0
    return ptsB - ptsA
  })
}

// Players currently on court for live stats
// For user's team in live mode, use selectedLineup for guaranteed accuracy
// For opponent team, use keyframe positions
const topAwayScorers = computed(() => {
  const awayPlayers = boxScore.value.away || []
  if (awayPlayers.length === 0) return []

  // Get on-court IDs from keyframe positions (works for both teams)
  const onCourtIds = onCourtPlayerIds.value.map(normalizeId)

  // If user is away team and we're in live mode, prioritize selectedLineup
  if (!userIsHome.value && isLiveMode.value && userLineupIds.value.length === 5) {
    // Try to match by selectedLineup first
    const lineupPlayers = awayPlayers.filter(player =>
      userLineupIds.value.includes(normalizeId(player.player_id))
    )
    // Return if we found at least some players (don't require exactly 5)
    if (lineupPlayers.length >= 3) {
      return sortByPoints(lineupPlayers)
    }
  }

  // Use keyframe positions for opponent team or as fallback
  if (onCourtIds.length >= 5) {
    const onCourtPlayers = awayPlayers.filter(player =>
      onCourtIds.includes(normalizeId(player.player_id))
    )
    if (onCourtPlayers.length >= 3) {
      return sortByPoints(onCourtPlayers)
    }
  }

  // Final fallback: top 5 by minutes played (those who've played the most are likely starters)
  return [...awayPlayers]
    .sort((a, b) => (Number(b.minutes) || 0) - (Number(a.minutes) || 0))
    .slice(0, 5)
})

const topHomeScorers = computed(() => {
  const homePlayers = boxScore.value.home || []
  if (homePlayers.length === 0) return []

  // Get on-court IDs from keyframe positions (works for both teams)
  const onCourtIds = onCourtPlayerIds.value.map(normalizeId)

  // If user is home team and we're in live mode, prioritize selectedLineup
  if (userIsHome.value && isLiveMode.value && userLineupIds.value.length === 5) {
    // Try to match by selectedLineup first
    const lineupPlayers = homePlayers.filter(player =>
      userLineupIds.value.includes(normalizeId(player.player_id))
    )
    // Return if we found at least some players (don't require exactly 5)
    if (lineupPlayers.length >= 3) {
      return sortByPoints(lineupPlayers)
    }
  }

  // Use keyframe positions for opponent team or as fallback
  if (onCourtIds.length >= 5) {
    const onCourtPlayers = homePlayers.filter(player =>
      onCourtIds.includes(normalizeId(player.player_id))
    )
    if (onCourtPlayers.length >= 3) {
      return sortByPoints(onCourtPlayers)
    }
  }

  // Final fallback: top 5 by minutes played (those who've played the most are likely starters)
  return [...homePlayers]
    .sort((a, b) => (Number(b.minutes) || 0) - (Number(a.minutes) || 0))
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

  // Get on-court player IDs (normalized for comparison)
  const onCourtIds = new Set(onCourtPlayerIds.value.map(normalizeId))

  return [...stats].sort((a, b) => {
    // Players currently on court come first
    if (onCourtIds.size > 0) {
      const aOnCourt = onCourtIds.has(normalizeId(a.player_id))
      const bOnCourt = onCourtIds.has(normalizeId(b.player_id))

      if (aOnCourt && !bOnCourt) return -1
      if (!aOnCourt && bOnCourt) return 1
    }

    // Secondary sort by selected column (default: points descending)
    let aVal = a[col] || 0
    let bVal = b[col] || 0

    if (col === 'name') {
      aVal = a.name || ''
      bVal = b.name || ''
      return dir * aVal.localeCompare(bVal)
    }

    // Primary sort by column
    const primaryCompare = dir * (aVal - bVal)

    // Tertiary sort by minutes
    if (primaryCompare === 0 && col !== 'minutes') {
      return -1 * ((a.minutes || 0) - (b.minutes || 0))
    }

    return primaryCompare
  })
})

// Displayed live box stats (limited unless showAll is true)
const displayedLiveBoxStats = computed(() => {
  if (showAllLiveBoxPlayers.value) {
    return activeLiveBoxStats.value
  }
  return activeLiveBoxStats.value.slice(0, LIVE_BOX_INITIAL_COUNT)
})

// Check if there are more players
const hasMoreLiveBoxPlayers = computed(() => activeLiveBoxStats.value.length > LIVE_BOX_INITIAL_COUNT)
const hiddenLiveBoxPlayerCount = computed(() => activeLiveBoxStats.value.length - LIVE_BOX_INITIAL_COUNT)

const activeLiveBoxTeam = computed(() => {
  return liveBoxScoreTab.value === 'home' ? homeTeam.value : awayTeam.value
})

// Check if the live box score tab is showing the user's team
const isUserTeamLiveBoxTab = computed(() => {
  return (userIsHome.value && liveBoxScoreTab.value === 'home') ||
         (!userIsHome.value && liveBoxScoreTab.value === 'away')
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

// Format attribute name for display (e.g., "offense.threePoint" -> "3PT")
function formatAttribute(attr) {
  const attrMap = {
    'offense.threePoint': '3PT',
    'offense.midRange': 'MID',
    'offense.layup': 'LAYUP',
    'offense.passAccuracy': 'PASS',
    'defense.defensiveRebound': 'DREB',
    'defense.offensiveRebound': 'OREB',
    'defense.steal': 'STL',
    'defense.block': 'BLK',
    'defense.interiorDefense': 'INT DEF',
    'defense.perimeterDefense': 'PER DEF',
  }
  return attrMap[attr] || attr.split('.').pop().toUpperCase()
}

// Check if a stat is currently animating
function isStatAnimating(playerId, statKey) {
  return animatingStats.value[`${playerId}-${statKey}`] === true
}

// User's team players for lineup selection
// Uses boxScore during game, falls back to roster data for pre-game preview
const userTeamPlayers = computed(() => {
  // Get roster data for fatigue/injury fallback
  const teamRoster = userIsHome.value ? homeRoster.value : awayRoster.value
  const rosterLookup = {}
  if (teamRoster && teamRoster.length > 0) {
    teamRoster.forEach(p => {
      const id = p.player_id || p.id
      rosterLookup[id] = p
    })
  }

  // During game, use box score data but merge roster data for missing fields
  const bs = userIsHome.value ? boxScore.value.home : boxScore.value.away
  if (bs && bs.length > 0) {
    return bs.map(p => {
      const rosterPlayer = rosterLookup[p.player_id] || {}
      return {
        ...p,
        // Use box score fatigue if present, otherwise fall back to roster
        fatigue: p.fatigue ?? rosterPlayer.fatigue ?? 0,
        overall_rating: p.overall_rating ?? rosterPlayer.overall_rating ?? null,
        is_injured: p.is_injured ?? rosterPlayer.is_injured ?? false
      }
    })
  }

  // Pre-game: use team roster (has fatigue, injury status, etc.)
  if (teamRoster && teamRoster.length > 0) {
    // Normalize roster data to match boxScore format (ensure player_id exists)
    return teamRoster.map(p => ({
      ...p,
      player_id: p.player_id || p.id,
      fatigue: p.fatigue ?? 0
    }))
  }

  // Fallback: use teamStore roster directly (single source of truth)
  const storeRoster = teamStore.roster
  if (storeRoster && storeRoster.length > 0) {
    return storeRoster.map(p => ({
      ...p,
      player_id: p.player_id || p.id,
      fatigue: p.fatigue ?? 0
    }))
  }

  return []
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
async function swapPlayerIn(slotIndex, playerId) {
  // Find the player being swapped in for the notification
  const newPlayer = userTeamPlayers.value.find(p => (p.player_id || p.id) === playerId)
  const playerName = newPlayer?.name || 'Player'

  selectedLineup.value[slotIndex] = playerId
  expandedSwapPlayer.value = null

  // In pre-game mode (not animation), save the lineup to the backend
  if (!showAnimationMode.value) {
    try {
      await teamStore.updateLineup(campaignId.value, selectedLineup.value)
      toastStore.showSuccess(`${playerName} added to lineup`)
    } catch (err) {
      console.error('Failed to save lineup:', err)
      toastStore.showError('Failed to update lineup')
    }
  } else {
    // In quarter break mode, just show success (changes are local until continue)
    toastStore.showSuccess(`${playerName} added to lineup`)
  }
}

// Move starter to bench (clear slot)
async function moveStarterToBench(slotIndex) {
  selectedLineup.value[slotIndex] = null
  expandedSwapPlayer.value = null

  // In pre-game mode (not animation), save the lineup to the backend
  if (!showAnimationMode.value) {
    try {
      await teamStore.updateLineup(campaignId.value, selectedLineup.value)
      toastStore.showSuccess('Player moved to bench')
    } catch (err) {
      console.error('Failed to save lineup:', err)
      toastStore.showError('Failed to update lineup')
    }
  } else {
    toastStore.showSuccess('Player moved to bench')
  }
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

// Get fatigue color based on level
function getFatigueColor(fatigue) {
  if (fatigue >= 70) return '#ef4444'  // red
  if (fatigue >= 50) return '#f59e0b'  // amber/warning
  return '#22c55e'  // green
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
  // User is home team - use teamStore lineup (single source of truth)
  if (userIsHome.value) {
    const lineup = teamStore.lineup
    const roster = teamStore.roster
    if (lineup?.length === 5 && roster?.length > 0) {
      return buildStartersFromLineup(lineup, roster)
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
  // User is away team - use teamStore lineup (single source of truth)
  if (!userIsHome.value) {
    const lineup = teamStore.lineup
    const roster = teamStore.roster
    if (lineup?.length === 5 && roster?.length > 0) {
      return buildStartersFromLineup(lineup, roster)
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
    // Fetch team data first (single source of truth for user's roster and lineup)
    await teamStore.fetchTeam(campaignId.value)

    // Sync local lineup from teamStore
    if (teamStore.lineup && teamStore.lineup.length === 5) {
      localLineup.value = [...teamStore.lineup]
    }

    // Refresh campaign data for settings
    await campaignStore.fetchCampaign(campaignId.value)

    // Load saved coaching styles from campaign settings
    const campaignSettings = campaignStore.currentCampaign?.settings
    if (campaignSettings?.offensive_style) {
      selectedOffense.value = campaignSettings.offensive_style
    }
    if (campaignSettings?.defensive_style) {
      selectedDefense.value = campaignSettings.defensive_style
    }

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

    // Fetch opponent roster only (user roster comes from teamStore)
    const currentGame = gameStore.currentGame
    if (currentGame?.home_team?.id && currentGame?.away_team?.id) {
      const opponentTeamId = userIsHome.value
        ? currentGame.away_team.id
        : currentGame.home_team.id

      try {
        const opponentData = await teamStore.fetchTeamRoster(campaignId.value, opponentTeamId)
        opponentRoster.value = opponentData.roster || []
      } catch (rosterErr) {
        console.error('Failed to load opponent roster:', rosterErr)
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
 * From the game preview page, we exclude the user's game so they can play it live.
 */
async function handleConfirmSimulate() {
  const preview = gameStore.simulatePreview
  const hasGamesToSimulate = preview?.totalGamesToSimulate > 0

  if (hasGamesToSimulate) {
    // Fire off AI games as background batch — don't wait for completion
    gameStore.simulateToNextGame(campaignId.value, true).catch(err => {
      console.error('Failed to dispatch AI games:', err)
    })
  }

  // Close modal and start the user's game immediately
  showSimulateModal.value = false
  gameStore.clearSimulatePreview()
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

    // Build settings with lineup
    const settings = {
      offensive_style: selectedOffense.value,
      defensive_style: selectedDefense.value,
    }

    // Include lineup if valid
    const validLineup = selectedLineup.value.filter(id => id !== null && id !== undefined)
    if (validLineup.length === 5) {
      if (userIsHome.value) {
        settings.home_lineup = validLineup
      } else {
        settings.away_lineup = validLineup
      }
    }

    // If game is already in progress, continue from where we left off
    if (isInProgress.value) {
      result = await gameStore.continueGame(campaignId.value, gameId.value, settings)
    } else {
      result = await gameStore.startLiveGame(campaignId.value, gameId.value, settings)
    }

    // Load animation data and auto-play
    if (result.animation_data?.possessions?.length > 0) {
      const quarter = result.quarter || 1
      let startingHomeScore = 0
      let startingAwayScore = 0
      if (quarter > 1 && quarterScores.value) {
        for (let i = 0; i < quarter - 1; i++) {
          startingHomeScore += quarterScores.value.home?.[i] || 0
          startingAwayScore += quarterScores.value.away?.[i] || 0
        }
      }
      loadAnimationData(result.animation_data, {
        isLive: true,
        quarter,
        startingHomeScore,
        startingAwayScore
      })
      setTimeout(() => {
        play()
      }, 500)
    }

    // Check if game completed
    if (result.isGameComplete) {
      isLiveMode.value = false
      await leagueStore.fetchStandings(campaignId.value, { force: true })
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
  // Capture starting scores BEFORE async call (they reflect end of previous quarter)
  const startingHomeScore = currentHomeScore.value
  const startingAwayScore = currentAwayScore.value

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
      // If remaining day games were batched, start background polling
      // Standings will refresh when batch completes
      if (result.batchId) {
        gameStore.startPollingSimulationStatus(campaignId.value, result.batchId)
      } else {
        // No background batch — refresh standings now
        await leagueStore.fetchStandings(campaignId.value, { force: true })
      }
    }

    // Load this quarter's animation data and play
    if (result.animation_data?.possessions?.length > 0) {
      // Always set isLive: true so we get the overlay at the end
      // The overlay will show different content based on gameJustCompleted
      loadAnimationData(result.animation_data, {
        isLive: true,
        quarter: result.quarter,
        startingHomeScore,
        startingAwayScore
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
 * Sim the in-progress game to completion (skip remaining quarters).
 */
async function handleSimToEnd() {
  simulating.value = true

  try {
    const response = await gameStore.simToEnd(campaignId.value, gameId.value)

    gameJustCompleted.value = true
    isLiveMode.value = false
    showAnimationMode.value = true
    completedQuarter.value = 4
    isQuarterBreak.value = true

    if (response.batchId) {
      gameStore.startPollingSimulationStatus(campaignId.value, response.batchId)
    } else {
      await leagueStore.fetchStandings(campaignId.value, { force: true })
    }
  } catch (err) {
    console.error('Failed to sim to end:', err)
    alert('Failed to sim to end')
  } finally {
    simulating.value = false
  }
}

/**
 * Handle viewing box score after game completion.
 * Closes animation mode to show the stats view.
 */
function viewBoxScore() {
  showAnimationMode.value = false
  gameJustCompleted.value = false
  // Restore scroll when leaving overlay
  document.body.style.overflow = ''
  // Refresh the game data to get final stats
  gameStore.fetchGame(campaignId.value, gameId.value)
}

function goBack() {
  // Restore scroll when navigating away
  document.body.style.overflow = ''
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

  // Convert to remaining time (600 seconds = 10 minutes, counting down)
  const totalSeconds = Math.max(0, Math.floor(600 * (1 - quarterProgress)))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
})

// Watch for background simulation completion (remaining day games after live game)
watch(() => gameStore.backgroundSimulating, async (newVal, oldVal) => {
  if (oldVal === true && newVal === false) {
    // Background AI games finished — refresh standings
    try {
      await leagueStore.fetchStandings(campaignId.value, { force: true })
    } catch (err) {
      console.error('Failed to refresh standings after background simulation:', err)
    }
  }
})

// Load animation when game data is available
watch(gameAnimationData, (newData) => {
  if (newData && newData.possessions?.length > 0) {
    loadAnimationData(newData)
  }
}, { immediate: true })

// Clear cached on-court IDs when quarter changes (new lineup may be in effect)
watch(currentQuarter, () => {
  lastKnownOnCourtIds.value = []
})

// Watch for possession changes and trigger basket animation at END of each play
watch(
  currentPossessionIndex,
  (newIndex, oldIndex) => {
    // Only trigger when moving forward to a new possession (play just ended)
    if (newIndex > oldIndex && animationData.value?.possessions) {
      const possessions = animationData.value.possessions
      const justEndedPossession = possessions[oldIndex]  // The possession that just finished
      const previousPossession = oldIndex > 0 ? possessions[oldIndex - 1] : null

      if (justEndedPossession) {
        // Calculate score change from the possession that just ended
        const endedHomeScore = justEndedPossession.home_score || 0
        const endedAwayScore = justEndedPossession.away_score || 0
        const prevHomeScore = previousPossession?.home_score || 0
        const prevAwayScore = previousPossession?.away_score || 0

        const homePoints = endedHomeScore - prevHomeScore
        const awayPoints = endedAwayScore - prevAwayScore

        // Trigger animation for the team that scored
        if (homePoints > 0 && homePoints <= 3 && courtRef.value) {
          courtRef.value.triggerScoreAnimation(homePoints, true)  // Home team scored
        } else if (awayPoints > 0 && awayPoints <= 3 && courtRef.value) {
          courtRef.value.triggerScoreAnimation(awayPoints, false)  // Away team scored
        }

        // Check for defensive plays (blocks, steals) and trigger crowd celebration only
        // The on-court animation is triggered in real-time by the keyframe watcher
        if (courtRef.value) {
          let defensivePlayDetected = false

          // Search through keyframes for defensive outcomes
          if (justEndedPossession.keyframes?.length > 0) {
            for (const keyframe of justEndedPossession.keyframes) {
              const outcome = keyframe?.outcome
              if (outcome === 'blocked' || outcome === 'stolen' || outcome === 'turnover') {
                defensivePlayDetected = true
                break
              }
            }
          }

          // Trigger crowd celebration (fans jump) if defensive play occurred
          if (defensivePlayDetected) {
            const defendingTeamIsHome = justEndedPossession.team !== 'home'
            // Just trigger crowd jump, on-court emojis are triggered in real-time by keyframe watcher
            courtRef.value.triggerDefensiveCelebration(defendingTeamIsHome, 'block')
          }
        }
      }
    }
  }
)

// Track which keyframes we've already triggered animations for (to prevent duplicates)
const triggeredDefensiveKeyframes = ref(new Set())

// Watch for keyframe changes to trigger defensive animations in real-time
watch(
  [currentKeyframeIndex, currentPossessionIndex],
  ([keyframeIdx, possessionIdx], [oldKeyframeIdx, oldPossessionIdx]) => {
    // Reset tracking when possession changes
    if (possessionIdx !== oldPossessionIdx) {
      triggeredDefensiveKeyframes.value.clear()
    }

    // Only process if we have a keyframe and court ref
    if (!currentKeyframe.value || !courtRef.value || !showAnimationMode.value) return

    const keyframe = currentKeyframe.value
    const outcome = keyframe?.outcome
    const keyframeId = `${possessionIdx}-${keyframeIdx}`

    // Check if this is a defensive play we haven't animated yet
    if ((outcome === 'blocked' || outcome === 'stolen' || outcome === 'turnover') &&
        !triggeredDefensiveKeyframes.value.has(keyframeId)) {

      triggeredDefensiveKeyframes.value.add(keyframeId)

      const defenseType = outcome === 'blocked' ? 'block' : 'steal'

      // Find the ball carrier's position from the keyframe positions
      // The ball carrier is the player who got blocked/stolen from
      const positions = keyframe.positions || {}
      let ballCarrierPos = null

      // Look for the player with the ball in this keyframe
      for (const [playerId, pos] of Object.entries(positions)) {
        if (pos.hasBall) {
          ballCarrierPos = pos
          break
        }
      }

      // Fallback to ball position if no player has it
      if (!ballCarrierPos && keyframe.ball) {
        ballCarrierPos = keyframe.ball
      }

      // Default to center court if we can't find the position
      const x = ballCarrierPos?.x ?? 0.5
      const y = ballCarrierPos?.y ?? 0.5

      console.log('[Defensive Play] Real-time trigger:', {
        outcome,
        defenseType,
        position: { x, y },
        keyframeId
      })

      // Trigger the on-court defensive animation at the player's position
      courtRef.value.triggerDefensiveAnimationAtPosition(x, y, defenseType)
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

// Sync local lineup from teamStore when it changes (single source of truth)
watch(
  () => teamStore.lineup,
  (storeLineup) => {
    // Only sync in pre-game (not during animation/game)
    if (!showAnimationMode.value && storeLineup?.length === 5) {
      localLineup.value = [...storeLineup]
    }
  },
  { immediate: true }
)

// Auto-save coaching styles when changed on pre-game page
watch(
  [selectedOffense, selectedDefense],
  async ([offense, defense], [prevOffense, prevDefense]) => {
    // Only save if values actually changed and we're not in animation mode
    if (showAnimationMode.value) return
    if (offense === prevOffense && defense === prevDefense) return

    // Don't save on initial load (when prev values are undefined)
    if (prevOffense === undefined || prevDefense === undefined) return

    try {
      await campaignStore.updateCampaign(campaignId.value, {
        settings: {
          offensive_style: offense,
          defensive_style: defense
        }
      })
    } catch (err) {
      console.error('Failed to save coaching styles:', err)
    }
  }
)

// Also watch roster data to initialize lineup if no saved lineup exists
watch(
  [homeRoster, awayRoster, () => userIsHome.value],
  ([home, away, isHome]) => {
    // Only if not in animation mode and lineup not already set
    if (showAnimationMode.value) return

    const hasValidLineup = localLineup.value.filter(id => id !== null).length === 5
    if (hasValidLineup) return

    const roster = isHome ? home : away
    if (!roster || roster.length < 5) return

    // Build lineup from roster using best players per position
    const positions = ['PG', 'SG', 'SF', 'PF', 'C']
    const newLineup = []
    const usedIds = new Set()
    const sorted = [...roster].sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))

    for (const pos of positions) {
      const player = sorted.find(p =>
        !usedIds.has(p.id) &&
        (p.position === pos || p.secondary_position === pos)
      )
      if (player) {
        newLineup.push(player.id)
        usedIds.add(player.id)
      } else {
        newLineup.push(null)
      }
    }

    if (newLineup.filter(id => id !== null).length === 5) {
      localLineup.value = newLineup
    }
  },
  { immediate: true }
)

// Reset show all players when switching live box score tabs
watch(
  () => liveBoxScoreTab.value,
  () => {
    showAllLiveBoxPlayers.value = false
  }
)

// Pre-game roster for user's team (for lineup swap functionality)
// Uses the roster fetched from the team roster API calls
const preGameUserRoster = computed(() => {
  const roster = userIsHome.value ? homeRoster.value : awayRoster.value
  if (!roster || roster.length === 0) return []
  return roster.map(p => ({
    player_id: p.id,
    name: `${p.first_name} ${p.last_name}`,
    position: p.position,
    secondary_position: p.secondary_position,
    overall_rating: p.overall_rating,
    is_injured: p.is_injured,
    fatigue: p.fatigue ?? 0,
    points: 0,
    rebounds: 0,
    assists: 0,
  }))
})

// Pre-game starters with stats structure for lineup cards (similar to currentStartersWithStats)
const preGameStartersWithStats = computed(() => {
  const players = preGameUserRoster.value
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

// Get pre-game swap candidates for a position slot
function getPreGameSwapCandidates(slotPosition, slotIndex) {
  const players = preGameUserRoster.value
  if (!players) return []

  // Get IDs already in lineup (except current slot)
  const excludeIds = selectedLineup.value
    .filter((id, i) => i !== slotIndex && id != null)

  // Filter to players who can play this position and aren't in other slots
  return players.filter(p => {
    const canPlay = p.position === slotPosition || p.secondary_position === slotPosition
    const isHealthy = !p.is_injured
    const notInLineup = !excludeIds.includes(p.player_id)
    const notCurrentStarter = p.player_id !== selectedLineup.value[slotIndex]
    return canPlay && isHealthy && notInLineup && notCurrentStarter
  }).sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))
}

// Pre-game starters for overlay (uses localLineup for user's team)
const preGameHomeStarters = computed(() => {
  if (userIsHome.value) {
    // Build from localLineup using user's roster from teamStore
    return buildStartersFromSelectedLineup(localLineup.value, homeRoster.value)
  }
  return selectStartersFromRoster(homeRoster.value)
})

const preGameAwayStarters = computed(() => {
  if (!userIsHome.value) {
    // Build from localLineup using user's roster from teamStore
    return buildStartersFromSelectedLineup(localLineup.value, awayRoster.value)
  }
  return selectStartersFromRoster(awayRoster.value)
})

// Build starters from lineup IDs for pre-game display
function buildStartersFromSelectedLineup(lineupIds, roster) {
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

// Get offensive strategy label
function getOffenseLabel(scheme) {
  const style = offensiveStyles.find(s => s.value === scheme)
  return style?.label || 'Balanced'
}

// Get defensive strategy label
function getDefenseLabel(scheme) {
  const style = defensiveStyles.find(s => s.value === scheme)
  return style?.label || 'Man-to-Man'
}

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

// Lock body scroll when quarter break overlay is shown
watch([isQuarterBreak, showAnimationMode], ([isBreak, isAnimating]) => {
  if (isBreak && isAnimating) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
    // Reset substitutions view when quarter break closes
    showSubstitutionsView.value = false
  }
})

// Cleanup on unmount
onUnmounted(() => {
  cleanup()
  // Ensure scroll is restored on unmount
  document.body.style.overflow = ''
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
            <div class="team-side-column">
              <span class="team-location-label">AWAY</span>
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
            <p class="game-type-label">Regular Season</p>
            <p v-if="isUserGame" class="user-game-badge">Your Game</p>
          </div>

          <!-- Home Team -->
          <div class="team-side home" :class="{ winner: winner === 'home' }">
            <div v-if="isComplete || isInProgress" class="team-score-lg">
              {{ game.home_score || 0 }}
            </div>
            <div class="team-side-column">
              <span class="team-location-label">HOME</span>
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
                <div v-if="isQuarterBreak" class="qb-modal-overlay">
                  <div class="qb-modal-container">
                    <!-- Header -->
                    <header class="qb-modal-header" :class="{ 'game-complete-header': gameJustCompleted || completedQuarter >= 4 }">
                      <!-- Game Complete Header (use completedQuarter >= 4 as fallback) -->
                      <template v-if="gameJustCompleted || completedQuarter >= 4">
                        <h2 class="qb-modal-title game-complete">Final</h2>
                        <button class="qb-header-btn" @click="viewBoxScore">
                          View Box Score
                        </button>
                      </template>
                      <!-- Quarter Break Header -->
                      <template v-else>
                        <h2 class="qb-modal-title">End of Q{{ completedQuarter }}</h2>
                      </template>
                    </header>

                    <!-- Content -->
                    <main class="qb-modal-content">
                      <!-- Score Display - Cosmic Theme (hidden in substitutions view) -->
                      <div v-show="!showSubstitutionsView" class="qb-score-card card-cosmic">
                        <div class="qb-matchup">
                          <!-- Away Team -->
                          <div class="qb-matchup-team">
                            <div
                              class="qb-team-badge"
                              :style="{ backgroundColor: awayTeam?.primary_color || '#666' }"
                            >
                              <span class="qb-badge-abbr">{{ awayTeam?.abbreviation }}</span>
                              <span class="qb-badge-record">{{ awayTeamRecord }}</span>
                            </div>
                            <span class="qb-team-name">{{ awayTeam?.name }}</span>
                          </div>

                          <!-- Score -->
                          <div class="qb-score-center">
                            <div class="qb-scores">
                              <span class="qb-score away">{{ currentAwayScore }}</span>
                              <span class="qb-score-divider">-</span>
                              <span class="qb-score home">{{ currentHomeScore }}</span>
                            </div>
                          </div>

                          <!-- Home Team -->
                          <div class="qb-matchup-team">
                            <div
                              class="qb-team-badge"
                              :style="{ backgroundColor: homeTeam?.primary_color || '#666' }"
                            >
                              <span class="qb-badge-abbr">{{ homeTeam?.abbreviation }}</span>
                              <span class="qb-badge-record">{{ homeTeamRecord }}</span>
                            </div>
                            <span class="qb-team-name">{{ homeTeam?.name }}</span>
                          </div>
                        </div>
                      </div>

                      <!-- Coaching Adjustments (only in live mode during quarter breaks, not game complete) -->
                      <div v-if="isLiveMode && !gameJustCompleted && completedQuarter < 4" class="qb-coaching-section">
                        <!-- Main View -->
                        <template v-if="!showSubstitutionsView">
                          <!-- Strategy Settings - Full Width -->
                          <div class="qb-strategy-card">
                            <div class="strategy-row">
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
                            </div>
                          </div>

                          <!-- Substitutions Button -->
                          <button
                            class="qb-subs-btn"
                            @click="showSubstitutionsView = true"
                          >
                            <Users :size="18" />
                            <span>Substitutions</span>
                          </button>

                          <!-- Continue Button -->
                          <button
                            class="qb-continue-btn"
                            :disabled="simulating"
                            @click="handleQuarterBreakContinue"
                          >
                            <span v-if="simulating" class="qb-btn-loading"></span>
                            <template v-else>
                              <ChevronRight :size="20" />
                              <span>Continue</span>
                            </template>
                          </button>
                          <button
                            class="qb-sim-to-end-btn"
                            :disabled="simulating"
                            @click="handleSimToEnd"
                          >
                            <span v-if="simulating" class="qb-btn-loading"></span>
                            <template v-else>
                              <FastForward :size="20" />
                              <span>Sim to End</span>
                            </template>
                          </button>
                        </template>

                        <!-- Substitutions View -->
                        <template v-else>
                          <!-- Back Button -->
                          <button
                            class="qb-back-btn"
                            @click="showSubstitutionsView = false; expandedSwapPlayer = null"
                          >
                            <ArrowLeft :size="18" />
                            <span>Back</span>
                          </button>

                          <!-- Lineup Cards -->
                          <div class="lineup-cards-section">
                            <div class="lineup-cards-header">
                              <span class="lineup-cards-title">Current Lineup</span>
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
                                      <div class="lineup-player-name-row">
                                        <span class="lineup-player-name">{{ slot.player.name }}</span>
                                        <span class="lineup-fatigue" :style="{ color: getFatigueColor(slot.player.fatigue || 0) }">{{ slot.player.fatigue || 0 }}%</span>
                                      </div>
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
                                        <div class="swap-option-name-row">
                                          <span class="swap-option-name">{{ candidate.name }}</span>
                                          <span class="swap-option-fatigue" :style="{ color: getFatigueColor(candidate.fatigue || 0) }">{{ candidate.fatigue || 0 }}%</span>
                                        </div>
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
                        </template>
                      </div>

                      <!-- Replay mode: show continue button (only for Q1-Q3) -->
                      <div v-if="!isLiveMode && !gameJustCompleted && completedQuarter < 4" class="qb-replay-mode">
                        <p class="qb-replay-hint">Replay mode - no adjustments available</p>
                        <button
                          class="qb-replay-btn"
                          @click="handleQuarterBreakContinue"
                        >
                          Continue
                        </button>
                      </div>

                      <!-- Game Complete: Evolution Summary (use completedQuarter >= 4 as fallback) -->
                      <div v-if="gameJustCompleted || completedQuarter >= 4" class="qb-game-complete">
                        <!-- Evolution Summary for User's Team -->
                        <div v-if="isUserGame" class="evolution-section">
                          <EvolutionSummary
                            :evolution="evolutionData"
                            :team-key="userIsHome ? 'home' : 'away'"
                            :team-name="userTeam?.name || 'Your Team'"
                            :loading="!evolutionData"
                            :limit="5"
                          />
                        </div>
                      </div>
                    </main>
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
                        v-for="player in displayedLiveBoxStats"
                        :key="player.player_id"
                        class="player-row"
                      >
                        <td class="player-col">
                          <div class="player-info">
                            <span class="player-name">{{ player.name }}</span>
                            <span class="player-pos">
                              {{ player.position }}<template v-if="player.secondary_position">/{{ player.secondary_position }}</template>
                              <span v-if="onCourtPlayerIds.map(id => String(id)).includes(String(player.player_id))" class="on-court-badge">ON</span>
                            </span>
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
                      <!-- Show more button row -->
                      <tr v-if="hasMoreLiveBoxPlayers && !showAllLiveBoxPlayers" class="show-more-row">
                        <td :colspan="11">
                          <button
                            class="show-more-btn"
                            @click="showAllLiveBoxPlayers = true"
                          >
                            <ChevronDown :size="16" />
                            Show {{ hiddenLiveBoxPlayerCount }} more players
                          </button>
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
          </GlassCard>
        </template>

        <!-- Pre-game Setup View (when not simulating) -->
        <template v-else>
          <div class="pregame-layout">
            <!-- Court Preview with Starters Overlay -->
            <GlassCard padding="lg" :hoverable="false" class="pregame-court-card">
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
                      <div v-for="player in preGameAwayStarters" :key="player.id || player.player_id" class="starter-row">
                        <span class="starter-pos">{{ player.slotPosition }}</span>
                        <span class="starter-name">{{ player.last_name || player.lastName || player.name?.split(' ').pop() }}</span>
                        <span class="starter-ovr">{{ player.overall_rating || player.overallRating }}</span>
                      </div>
                    </div>
                    <!-- Coach Settings for Away Team (use selections if user is away) -->
                    <div class="team-coach-settings">
                      <div class="coach-setting-row">
                        <span class="coach-setting-label">Off:</span>
                        <span class="coach-setting-value">{{ getOffenseLabel(!userIsHome && isUserGame ? selectedOffense : awayTeam?.coaching_scheme?.offensive) }}</span>
                      </div>
                      <div class="coach-setting-row">
                        <span class="coach-setting-label">Def:</span>
                        <span class="coach-setting-value">{{ getDefenseLabel(!userIsHome && isUserGame ? selectedDefense : awayTeam?.coaching_scheme?.defensive) }}</span>
                      </div>
                    </div>
                  </div>
                  <!-- Home Team Starters -->
                  <div class="starters-column">
                    <div class="starters-header" :style="{ borderColor: homeTeam?.primary_color }">
                      {{ homeTeam?.abbreviation }}
                    </div>
                    <div class="starters-list">
                      <div v-for="player in preGameHomeStarters" :key="player.id || player.player_id" class="starter-row">
                        <span class="starter-pos">{{ player.slotPosition }}</span>
                        <span class="starter-name">{{ player.last_name || player.lastName || player.name?.split(' ').pop() }}</span>
                        <span class="starter-ovr">{{ player.overall_rating || player.overallRating }}</span>
                      </div>
                    </div>
                    <!-- Coach Settings for Home Team (use selections if user is home) -->
                    <div class="team-coach-settings">
                      <div class="coach-setting-row">
                        <span class="coach-setting-label">Off:</span>
                        <span class="coach-setting-value">{{ getOffenseLabel(userIsHome && isUserGame ? selectedOffense : homeTeam?.coaching_scheme?.offensive) }}</span>
                      </div>
                      <div class="coach-setting-row">
                        <span class="coach-setting-label">Def:</span>
                        <span class="coach-setting-value">{{ getDefenseLabel(userIsHome && isUserGame ? selectedDefense : homeTeam?.coaching_scheme?.defensive) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </GlassCard>

            <!-- Game Settings Card - Styled like Quarter Break Modal -->
            <GlassCard padding="lg" :hoverable="false" class="pregame-settings-card">
              <div class="pregame-coaching-section">
                <!-- Main View -->
                <template v-if="!showSubstitutionsView">
                  <!-- Strategy Settings - Full Width (only for user's game) -->
                  <div v-if="isUserGame" class="qb-strategy-card">
                    <div class="strategy-row">
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
                    </div>
                  </div>

                  <!-- Substitutions Button (only for user's game) -->
                  <button
                    v-if="isUserGame"
                    class="qb-subs-btn"
                    @click="showSubstitutionsView = true"
                  >
                    <Users :size="18" />
                    <span>Substitutions</span>
                  </button>

                  <!-- Play Game Button -->
                  <button
                    v-if="isUserGame"
                    class="qb-continue-btn pregame-play-btn"
                    :disabled="simulating"
                    @click="handlePlayGame"
                  >
                    <span v-if="simulating" class="qb-btn-loading"></span>
                    <template v-else>
                      <Play :size="20" />
                      <span>{{ isInProgress ? `Resume Game (Q${savedQuarter + 1})` : 'Play Game' }}</span>
                    </template>
                  </button>

                  <!-- Sim to End Button (in-progress games only) -->
                  <button
                    v-if="isInProgress"
                    class="qb-sim-to-end-btn"
                    :disabled="simulating"
                    @click="handleSimToEnd"
                  >
                    <span v-if="simulating" class="qb-btn-loading"></span>
                    <template v-else>
                      <FastForward :size="20" />
                      <span>Sim to End</span>
                    </template>
                  </button>

                  <!-- Simulate Button for non-user games -->
                  <button
                    v-else-if="!isUserGame"
                    class="qb-continue-btn pregame-play-btn"
                    :disabled="simulating"
                    @click="startGame"
                  >
                    <span v-if="simulating" class="qb-btn-loading"></span>
                    <template v-else>
                      <Play :size="20" />
                      <span>{{ isInProgress ? 'Resume Simulation' : 'Simulate Game' }}</span>
                    </template>
                  </button>
                </template>

                <!-- Substitutions View -->
                <template v-else>
                  <!-- Back Button -->
                  <button
                    class="qb-back-btn"
                    @click="showSubstitutionsView = false; expandedSwapPlayer = null"
                  >
                    <ArrowLeft :size="18" />
                    <span>Back</span>
                  </button>

                  <!-- Lineup Cards -->
                  <div class="lineup-cards-section">
                    <div class="lineup-cards-header">
                      <span class="lineup-cards-title">Starting Lineup</span>
                      <span class="lineup-cards-hint">Tap swap icon to make changes</span>
                    </div>
                    <div class="lineup-cards-grid">
                      <div
                        v-for="slot in preGameStartersWithStats"
                        :key="slot.slotPosition"
                        class="lineup-card"
                        :class="{
                          empty: !slot.player,
                          'dropdown-open': expandedSwapPlayer === slot.slotIndex
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
                              <div class="lineup-player-name-row">
                                <span class="lineup-player-name">{{ slot.player.name }}</span>
                                <span class="lineup-fatigue" :style="{ color: getFatigueColor(slot.player.fatigue || 0) }">{{ slot.player.fatigue || 0 }}%</span>
                              </div>
                              <span class="lineup-player-pos-secondary">{{ slot.player.position }}{{ slot.player.secondary_position ? ` / ${slot.player.secondary_position}` : '' }}</span>
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
                              <!-- Available players who can play this position -->
                              <button
                                v-for="candidate in getPreGameSwapCandidates(slot.slotPosition, slot.slotIndex)"
                                :key="candidate.player_id || candidate.id"
                                class="swap-option"
                                :class="{ injured: candidate.is_injured }"
                                @click="swapPlayerIn(slot.slotIndex, candidate.player_id || candidate.id)"
                              >
                                <ArrowUpDown :size="12" class="swap-option-icon" />
                                <span
                                  class="swap-option-pos"
                                  :style="{ backgroundColor: getPositionColor(candidate.position) }"
                                >
                                  {{ candidate.position }}
                                </span>
                                <div class="swap-option-name-row">
                                  <span class="swap-option-name">{{ candidate.name }}</span>
                                  <span class="swap-option-fatigue" :style="{ color: getFatigueColor(candidate.fatigue || 0) }">{{ candidate.fatigue || 0 }}%</span>
                                </div>
                                <span class="swap-option-ovr">{{ candidate.overall_rating }}</span>
                              </button>
                              <div v-if="getPreGameSwapCandidates(slot.slotPosition, slot.slotIndex).length === 0" class="swap-empty">
                                No eligible players
                              </div>
                            </div>
                          </div>
                        </Transition>
                      </div>
                    </div>
                  </div>
                </template>
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

        <!-- Post-Game Summary Section -->
        <div v-if="isComplete && isUserGame" class="post-game-summary mb-6">
          <h3 class="summary-header">
            <Activity :size="20" />
            Post-Game Summary
          </h3>

          <div class="summary-grid">
            <!-- Rewards Card -->
            <GlassCard v-if="rewardsData" padding="md" :hoverable="false" class="summary-card rewards-card">
              <h4 class="card-title">
                <Coins :size="16" />
                Rewards Earned
              </h4>
              <div class="rewards-content">
                <div class="reward-item">
                  <span class="reward-label">Synergies Activated</span>
                  <span class="reward-value">{{ rewardsData.synergies_activated || 0 }}</span>
                </div>
                <div class="reward-item highlight">
                  <span class="reward-label">Tokens Earned</span>
                  <span class="reward-value tokens">+{{ rewardsData.tokens_awarded || 0 }}</span>
                </div>
                <div v-if="rewardsData.win_bonus_applied" class="reward-bonus">
                  <Trophy :size="14" />
                  Win bonus applied (2x tokens)
                </div>
              </div>
            </GlassCard>

            <!-- Game Result Card -->
            <GlassCard padding="md" :hoverable="false" class="summary-card result-card">
              <h4 class="card-title">
                <Trophy :size="16" />
                Game Result
              </h4>
              <div class="result-content">
                <div class="result-teams">
                  <div class="result-team" :class="{ winner: winner === 'away' }">
                    <span class="team-name">{{ awayTeam?.abbreviation }}</span>
                    <span class="team-score">{{ game?.away_score }}</span>
                  </div>
                  <span class="result-at">@</span>
                  <div class="result-team" :class="{ winner: winner === 'home' }">
                    <span class="team-name">{{ homeTeam?.abbreviation }}</span>
                    <span class="team-score">{{ game?.home_score }}</span>
                  </div>
                </div>
                <div v-if="userWon !== null" class="user-result" :class="userWon ? 'win' : 'loss'">
                  {{ userWon ? 'Victory!' : 'Defeat' }}
                </div>
              </div>
            </GlassCard>
          </div>

          <!-- Evolution Data - Home Team -->
          <GlassCard v-if="evolutionData?.home && Object.keys(evolutionData.home).length > 0" padding="md" :hoverable="false" class="summary-card evolution-card mb-4">
            <h4 class="card-title">
              <Zap :size="16" />
              {{ homeTeam?.name }} Updates
            </h4>
            <div class="evolution-content">
              <!-- Injuries -->
              <div v-if="evolutionData.home.injuries?.length" class="evolution-section">
                <h5 class="section-label injury-label">
                  <AlertTriangle :size="14" />
                  Injuries
                </h5>
                <div class="evolution-items">
                  <div v-for="injury in evolutionData.home.injuries" :key="injury.player_id" class="evolution-item injury">
                    <span class="player-name">{{ injury.name }}</span>
                    <span class="injury-details">{{ injury.injury_type }} - Out {{ injury.games_out }} games</span>
                    <span class="severity-badge" :class="injury.severity">{{ injury.severity }}</span>
                  </div>
                </div>
              </div>

              <!-- Development -->
              <div v-if="evolutionData.home.development?.length" class="evolution-section">
                <h5 class="section-label positive-label">
                  <TrendingUp :size="14" />
                  Development
                </h5>
                <div class="evolution-items">
                  <div v-for="dev in evolutionData.home.development" :key="dev.player_id" class="evolution-item positive">
                    <span class="player-name">{{ dev.name }}</span>
                    <div class="attr-badges">
                      <span v-for="attr in dev.attributes_improved" :key="attr" class="attr-badge positive">+{{ formatAttribute(attr) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Regression -->
              <div v-if="evolutionData.home.regression?.length" class="evolution-section">
                <h5 class="section-label negative-label">
                  <TrendingDown :size="14" />
                  Regression
                </h5>
                <div class="evolution-items">
                  <div v-for="reg in evolutionData.home.regression" :key="reg.player_id" class="evolution-item negative">
                    <span class="player-name">{{ reg.name }}</span>
                    <div class="attr-badges">
                      <span v-for="attr in reg.attributes_declined" :key="attr" class="attr-badge negative">-{{ formatAttribute(attr) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Hot Streaks -->
              <div v-if="evolutionData.home.hot_streaks?.length" class="evolution-section">
                <h5 class="section-label hot-label">
                  <Flame :size="14" />
                  Hot Streaks
                </h5>
                <div class="evolution-items">
                  <div v-for="streak in evolutionData.home.hot_streaks" :key="streak.player_id" class="evolution-item hot">
                    <span class="player-name">{{ streak.name }}</span>
                    <span class="streak-info">{{ streak.games }} game streak</span>
                  </div>
                </div>
              </div>

              <!-- Cold Streaks -->
              <div v-if="evolutionData.home.cold_streaks?.length" class="evolution-section">
                <h5 class="section-label cold-label">
                  <Snowflake :size="14" />
                  Cold Streaks
                </h5>
                <div class="evolution-items">
                  <div v-for="streak in evolutionData.home.cold_streaks" :key="streak.player_id" class="evolution-item cold">
                    <span class="player-name">{{ streak.name }}</span>
                    <span class="streak-info">{{ streak.games }} game slump</span>
                  </div>
                </div>
              </div>

              <!-- Fatigue Warnings -->
              <div v-if="evolutionData.home.fatigue_warnings?.length" class="evolution-section">
                <h5 class="section-label warning-label">
                  <Activity :size="14" />
                  Fatigue Warnings
                </h5>
                <div class="evolution-items">
                  <div v-for="warn in evolutionData.home.fatigue_warnings" :key="warn.player_id" class="evolution-item warning">
                    <span class="player-name">{{ warn.name }}</span>
                    <span class="fatigue-bar">
                      <span class="fatigue-fill" :style="{ width: warn.fatigue + '%' }"></span>
                    </span>
                    <span class="fatigue-value">{{ warn.fatigue }}%</span>
                  </div>
                </div>
              </div>

              <!-- Morale Changes -->
              <div v-if="evolutionData.home.morale_changes?.length" class="evolution-section">
                <h5 class="section-label">
                  <Heart :size="14" />
                  Morale Changes
                </h5>
                <div class="evolution-items">
                  <div v-for="morale in evolutionData.home.morale_changes" :key="morale.player_id" class="evolution-item" :class="morale.change > 0 ? 'positive' : 'negative'">
                    <span class="player-name">{{ morale.name }}</span>
                    <span class="morale-change">{{ morale.change > 0 ? '+' : '' }}{{ morale.change }}</span>
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>

          <!-- Evolution Data - Away Team -->
          <GlassCard v-if="evolutionData?.away && Object.keys(evolutionData.away).length > 0" padding="md" :hoverable="false" class="summary-card evolution-card mb-4">
            <h4 class="card-title">
              <Zap :size="16" />
              {{ awayTeam?.name }} Updates
            </h4>
            <div class="evolution-content">
              <!-- Injuries -->
              <div v-if="evolutionData.away.injuries?.length" class="evolution-section">
                <h5 class="section-label injury-label">
                  <AlertTriangle :size="14" />
                  Injuries
                </h5>
                <div class="evolution-items">
                  <div v-for="injury in evolutionData.away.injuries" :key="injury.player_id" class="evolution-item injury">
                    <span class="player-name">{{ injury.name }}</span>
                    <span class="injury-details">{{ injury.injury_type }} - Out {{ injury.games_out }} games</span>
                    <span class="severity-badge" :class="injury.severity">{{ injury.severity }}</span>
                  </div>
                </div>
              </div>

              <!-- Development -->
              <div v-if="evolutionData.away.development?.length" class="evolution-section">
                <h5 class="section-label positive-label">
                  <TrendingUp :size="14" />
                  Development
                </h5>
                <div class="evolution-items">
                  <div v-for="dev in evolutionData.away.development" :key="dev.player_id" class="evolution-item positive">
                    <span class="player-name">{{ dev.name }}</span>
                    <div class="attr-badges">
                      <span v-for="attr in dev.attributes_improved" :key="attr" class="attr-badge positive">+{{ formatAttribute(attr) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Regression -->
              <div v-if="evolutionData.away.regression?.length" class="evolution-section">
                <h5 class="section-label negative-label">
                  <TrendingDown :size="14" />
                  Regression
                </h5>
                <div class="evolution-items">
                  <div v-for="reg in evolutionData.away.regression" :key="reg.player_id" class="evolution-item negative">
                    <span class="player-name">{{ reg.name }}</span>
                    <div class="attr-badges">
                      <span v-for="attr in reg.attributes_declined" :key="attr" class="attr-badge negative">-{{ formatAttribute(attr) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Hot Streaks -->
              <div v-if="evolutionData.away.hot_streaks?.length" class="evolution-section">
                <h5 class="section-label hot-label">
                  <Flame :size="14" />
                  Hot Streaks
                </h5>
                <div class="evolution-items">
                  <div v-for="streak in evolutionData.away.hot_streaks" :key="streak.player_id" class="evolution-item hot">
                    <span class="player-name">{{ streak.name }}</span>
                    <span class="streak-info">{{ streak.games }} game streak</span>
                  </div>
                </div>
              </div>

              <!-- Cold Streaks -->
              <div v-if="evolutionData.away.cold_streaks?.length" class="evolution-section">
                <h5 class="section-label cold-label">
                  <Snowflake :size="14" />
                  Cold Streaks
                </h5>
                <div class="evolution-items">
                  <div v-for="streak in evolutionData.away.cold_streaks" :key="streak.player_id" class="evolution-item cold">
                    <span class="player-name">{{ streak.name }}</span>
                    <span class="streak-info">{{ streak.games }} game slump</span>
                  </div>
                </div>
              </div>

              <!-- Fatigue Warnings -->
              <div v-if="evolutionData.away.fatigue_warnings?.length" class="evolution-section">
                <h5 class="section-label warning-label">
                  <Activity :size="14" />
                  Fatigue Warnings
                </h5>
                <div class="evolution-items">
                  <div v-for="warn in evolutionData.away.fatigue_warnings" :key="warn.player_id" class="evolution-item warning">
                    <span class="player-name">{{ warn.name }}</span>
                    <span class="fatigue-bar">
                      <span class="fatigue-fill" :style="{ width: warn.fatigue + '%' }"></span>
                    </span>
                    <span class="fatigue-value">{{ warn.fatigue }}%</span>
                  </div>
                </div>
              </div>

              <!-- Morale Changes -->
              <div v-if="evolutionData.away.morale_changes?.length" class="evolution-section">
                <h5 class="section-label">
                  <Heart :size="14" />
                  Morale Changes
                </h5>
                <div class="evolution-items">
                  <div v-for="morale in evolutionData.away.morale_changes" :key="morale.player_id" class="evolution-item" :class="morale.change > 0 ? 'positive' : 'negative'">
                    <span class="player-name">{{ morale.name }}</span>
                    <span class="morale-change">{{ morale.change > 0 ? '+' : '' }}{{ morale.change }}</span>
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>

          <!-- Game News -->
          <GlassCard v-if="gameNews.length > 0" padding="md" :hoverable="false" class="summary-card news-card">
            <h4 class="card-title">
              <Newspaper :size="16" />
              Game Headlines
            </h4>
            <div class="news-content">
              <div v-for="news in gameNews" :key="news.id" class="news-item" :class="news.event_type">
                <div class="news-icon">
                  <AlertTriangle v-if="news.event_type === 'injury'" :size="16" />
                  <Trophy v-else-if="news.event_type === 'game_winner'" :size="16" />
                  <Flame v-else-if="news.event_type === 'hot_streak'" :size="16" />
                  <Snowflake v-else-if="news.event_type === 'cold_streak'" :size="16" />
                  <TrendingUp v-else-if="news.event_type === 'development' || news.event_type === 'breakout'" :size="16" />
                  <TrendingDown v-else-if="news.event_type === 'decline'" :size="16" />
                  <Heart v-else-if="news.event_type === 'recovery'" :size="16" />
                  <Newspaper v-else :size="16" />
                </div>
                <div class="news-text">
                  <div class="news-headline">{{ news.headline }}</div>
                  <div class="news-body">{{ news.body }}</div>
                </div>
              </div>
            </div>
          </GlassCard>
        </div>

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
      :simulating="false"
      :background-progress="null"
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
  color: #000000;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.3);
}

/* Light mode game header adjustments */
[data-theme="light"] .game-header-card .team-rating,
[data-theme="light"] .game-header-card .team-rank,
[data-theme="light"] .game-header-card .game-date {
  color: rgba(0, 0, 0);
}

[data-theme="light"] .game-header-card .vs-text,
[data-theme="light"] .game-header-card .final-text,
[data-theme="light"] .game-header-card .in-progress-text {
  color: white;
}

[data-theme="light"] .game-header-card .team-score-lg {
  color: #000000;
}

[data-theme="light"] .game-header-card .user-game-badge {
  background: rgba(255, 255, 255, 0.25);
  color: black;
}

[data-theme="light"] .game-header-card .team-name-text {
  color: black;
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

.team-side-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
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

.team-location-label {
  font-size: 0.6rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 2px;
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

.game-type-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 2px;
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

/* Team Coach Settings in Overlay */
.team-coach-settings {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.65rem;
}

.coach-setting-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.coach-setting-label {
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  min-width: 24px;
}

.coach-setting-value {
  color: var(--color-text-primary);
  font-weight: 600;
}

/* Pre-game Layout */
.pregame-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.pregame-court-card {
  min-height: 400px;
}

.pregame-settings-card {
  display: flex;
  flex-direction: column;
}

.pregame-coaching-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.pregame-play-btn {
  margin-top: auto;
}

.lineup-player-pos-secondary {
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  opacity: 0.8;
}

/* Light mode coach settings */
[data-theme="light"] .team-coach-settings {
  border-top-color: rgba(0, 0, 0, 0.1);
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

/* Quarter Break Modal - New Design */
.qb-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.qb-modal-container {
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.qb-modal-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.qb-modal-header.game-complete-header {
  justify-content: space-between;
}

.qb-header-btn {
  padding: 8px 16px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-lg);
  color: white;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.qb-header-btn:hover {
  background: var(--color-primary-dark);
}

.qb-modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.qb-modal-title.game-complete {
  font-size: 2rem;
  color: var(--color-success);
}

.qb-modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.qb-modal-content::-webkit-scrollbar {
  display: none;
}

/* Score Display - Cosmic Card */
.qb-score-card {
  margin-bottom: 16px;
}

.qb-score-card.card-cosmic {
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-xl);
  padding: 20px;
  position: relative;
  overflow: hidden;
}

.qb-score-card.card-cosmic::before {
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

.qb-matchup {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  position: relative;
  z-index: 1;
}

.qb-matchup-team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.qb-team-badge {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  border: 3px solid rgba(255, 255, 255, 0.3);
}

.qb-badge-abbr {
  font-size: 1rem;
  font-weight: 700;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  line-height: 1;
}

.qb-badge-record {
  font-size: 0.6rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  line-height: 1;
}

.qb-team-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: #1a1520;
  text-align: center;
  max-width: 100px;
}

.qb-score-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.qb-scores {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qb-score {
  font-size: 2.25rem;
  font-weight: 800;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: #1a1520;
  min-width: 48px;
  text-align: center;
}

.qb-score-divider {
  font-size: 1.5rem;
  color: rgba(26, 21, 32, 0.4);
  font-weight: 300;
}

/* Coaching Section - Full Width */
.qb-coaching-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.qb-strategy-card {
  padding: 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.strategy-row {
  display: flex;
  gap: 24px;
  justify-content: center;
}

/* Substitutions Button */
.qb-subs-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 24px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.qb-subs-btn:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border-medium);
}

/* Back Button */
.qb-back-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 12px;
}

.qb-back-btn:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

/* Continue Button */
.qb-continue-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 24px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-xl);
  color: white;
  font-size: 0.9rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.qb-continue-btn:hover:not(:disabled) {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.qb-continue-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.qb-btn-loading {
  width: 20px;
  height: 20px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Replay Mode */
.qb-replay-mode {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px;
}

.qb-replay-hint {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  font-style: italic;
  margin: 0;
}

.qb-replay-btn {
  padding: 12px 32px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.qb-replay-btn:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

/* Game Complete */
.qb-game-complete {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.evolution-section {
  width: 100%;
  margin-bottom: 16px;
}

/* Quarter Break Strategy Styles */
.strategy-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.strategy-label {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-secondary);
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
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
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

/* Light mode strategy pills */
[data-theme="light"] .strategy-pill {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.15);
  color: var(--color-text-primary);
}

[data-theme="light"] .strategy-pill:hover {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(0, 0, 0, 0.2);
}

[data-theme="light"] .strategy-pill.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

/* Lineup Cards Section */
.lineup-cards-section {
  margin-top: 4px;
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

.lineup-player-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lineup-player-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.lineup-fatigue {
  font-size: 0.7rem;
  font-weight: 600;
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

.swap-option-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.swap-option-name {
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.swap-option-fatigue {
  font-size: 0.7rem;
  font-weight: 600;
  flex-shrink: 0;
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
[data-theme="light"] .qb-coaching-section .strategy-pill {
  background: rgba(0, 0, 0, 0.05);
  border-color: rgba(0, 0, 0, 0.1);
  color: var(--color-text-secondary);
}

[data-theme="light"] .qb-coaching-section .strategy-pill:hover {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .qb-coaching-section .lineup-card {
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .qb-coaching-section .lineup-card::before {
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.05) 0%, transparent 40%);
}

[data-theme="light"] .qb-coaching-section .lineup-card.empty {
  border-color: rgba(0, 0, 0, 0.15);
}

[data-theme="light"] .qb-coaching-section .lineup-card-header {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .qb-coaching-section .swap-dropdown {
  border-top-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .qb-coaching-section .swap-dropdown-header {
  background: rgba(0, 0, 0, 0.04);
  border-bottom-color: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .qb-coaching-section .swap-option {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .qb-coaching-section .swap-option:hover {
  background: rgba(0, 0, 0, 0.06);
}

/* Light mode quarter break modal */
[data-theme="light"] .qb-strategy-card {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.1);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Quarter break modal scale animation */
.fade-enter-active .qb-modal-container {
  animation: qbScaleIn 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.fade-leave-active .qb-modal-container {
  animation: qbScaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes qbScaleIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes qbScaleOut {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
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
  color: #000;
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
  color: #000;
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
  min-height: 44px;
  max-height: 100px;
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
  color: #000;
}

[data-theme="light"] .broadcast-record {
  color: #000;
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
  width: 100%;
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
    flex-direction: column;
    align-items: center;
    padding: 12px;
  }

  .court-in-broadcast,
  .court-in-replay {
    padding: 0;
  }

  .live-stats-panel {
    width: 100%;
    max-width: 100%;
    margin-top: 8px;
  }

  .live-stats-grid {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .live-stats-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px;
  }

  .live-stat-card {
    width: 100%;
    max-width: 100%;
    padding: 4px 6px;
    text-align: center;
  }

  .live-stat-name {
    font-size: 0.65rem;
    text-align: center;
  }

  .live-stat-line {
    font-size: 0.55rem;
    gap: 4px;
    justify-content: center;
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

/* Extra small mobile: stack team stats vertically */
@media (max-width: 465px) {
  .live-stats-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .live-stats-team {
    width: 100%;
  }

  .live-stats-list {
    flex-direction: column;
    align-items: stretch;
  }

  .live-stat-card {
    width: 100%;
    max-width: 100%;
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
  margin: 12px 16px 0;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-lg);
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
  margin: 8px 16px 16px;
  background: var(--color-bg-secondary);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-lg);
  overflow: hidden;
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

.live-box-table .on-court-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 4px;
  font-size: 0.55rem;
  font-weight: 700;
  background: var(--color-success, #22c55e);
  color: white;
  border-radius: 3px;
  vertical-align: middle;
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

.live-box-table .show-more-row td {
  text-align: center;
  padding: 8px;
  background: transparent;
}

.live-box-table .show-more-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.1);
  border: 1px solid rgba(var(--primary-rgb), 0.2);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
}

.live-box-table .show-more-btn:hover {
  background: rgba(var(--primary-rgb), 0.2);
  border-color: rgba(var(--primary-rgb), 0.3);
}

/* Light mode overrides for live box score */
[data-theme="light"] .live-box-score-toggle {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .live-box-score-toggle:hover {
  background: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .live-box-score-container {
  border-color: rgba(0, 0, 0, 0.1);
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

/* Pre-game layout responsive adjustments */
@media (max-width: 1024px) {
  .pregame-layout {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}

/* Pre-game lineup grid responsive adjustments */
@media (max-width: 900px) {
  .pregame-coaching-section .lineup-cards-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 620px) {
  .pregame-coaching-section .lineup-cards-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .pregame-coaching-section .strategy-row {
    flex-direction: column;
    gap: 16px;
  }
}

@media (max-width: 400px) {
  .pregame-coaching-section .lineup-cards-grid {
    grid-template-columns: 1fr;
  }
}

/* Post-Game Summary Styles */
.post-game-summary {
  margin-top: 24px;
}

.summary-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 16px;
  color: var(--color-text-primary);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.summary-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  margin: 0 0 16px 0;
  color: var(--color-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* Rewards Card */
.rewards-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reward-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-md);
}

.reward-item.highlight {
  background: rgba(var(--primary-rgb), 0.1);
  border: 1px solid rgba(var(--primary-rgb), 0.2);
}

.reward-label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.reward-value {
  font-size: 1rem;
  font-weight: 700;
}

.reward-value.tokens {
  color: var(--color-success);
}

.reward-bonus {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: #fbbf24;
  padding: 6px 10px;
  background: rgba(251, 191, 36, 0.1);
  border-radius: var(--radius-sm);
}

/* Result Card */
.result-content {
  text-align: center;
}

.result-teams {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 12px;
}

.result-team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.result-team .team-name {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.result-team .team-score {
  font-size: 2rem;
  font-weight: 800;
}

.result-team.winner .team-score {
  color: var(--color-success);
}

.result-at {
  font-size: 1rem;
  color: var(--color-text-secondary);
}

.user-result {
  font-size: 1.25rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 16px;
  border-radius: var(--radius-md);
}

.user-result.win {
  color: var(--color-success);
  background: rgba(34, 197, 94, 0.1);
}

.user-result.loss {
  color: var(--color-error);
  background: rgba(239, 68, 68, 0.1);
}

/* Evolution Card */
.evolution-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.evolution-section {
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: var(--radius-md);
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 10px 0;
  color: var(--color-text-secondary);
}

.section-label.injury-label { color: var(--color-error); }
.section-label.positive-label { color: var(--color-success); }
.section-label.negative-label { color: var(--color-error); }
.section-label.hot-label { color: #ff6b35; }
.section-label.cold-label { color: #4fc3f7; }
.section-label.warning-label { color: var(--color-warning); }

.evolution-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.evolution-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-md);
  font-size: 0.85rem;
}

.evolution-item .player-name {
  font-weight: 600;
  min-width: 120px;
}

.evolution-item.injury { border-left: 3px solid var(--color-error); }
.evolution-item.positive { border-left: 3px solid var(--color-success); }
.evolution-item.negative { border-left: 3px solid var(--color-error); }
.evolution-item.hot { border-left: 3px solid #ff6b35; }
.evolution-item.cold { border-left: 3px solid #4fc3f7; }
.evolution-item.warning { border-left: 3px solid var(--color-warning); }

.injury-details {
  flex: 1;
  color: var(--color-text-secondary);
}

.severity-badge {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}

.severity-badge.minor { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
.severity-badge.moderate { background: rgba(251, 146, 60, 0.2); color: #fb923c; }
.severity-badge.severe { background: rgba(239, 68, 68, 0.2); color: var(--color-error); }
.severity-badge.season_ending { background: rgba(239, 68, 68, 0.3); color: var(--color-error); }

.attr-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: auto;
}

.attr-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.attr-badge.positive {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-success);
}

.attr-badge.negative {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-error);
}

.streak-info {
  margin-left: auto;
  color: var(--color-text-secondary);
}

.fatigue-bar {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
  max-width: 100px;
}

.fatigue-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--color-warning), var(--color-error));
  border-radius: 3px;
}

.fatigue-value {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-warning);
  min-width: 40px;
  text-align: right;
}

.morale-change {
  margin-left: auto;
  font-weight: 700;
}

.evolution-item.positive .morale-change { color: var(--color-success); }
.evolution-item.negative .morale-change { color: var(--color-error); }

/* News Card */
.news-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.news-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-md);
  border-left: 3px solid var(--color-primary);
}

.news-item.injury { border-left-color: var(--color-error); }
.news-item.game_winner { border-left-color: #fbbf24; }
.news-item.hot_streak { border-left-color: #ff6b35; }
.news-item.cold_streak { border-left-color: #4fc3f7; }
.news-item.development, .news-item.breakout { border-left-color: var(--color-success); }
.news-item.decline { border-left-color: var(--color-error); }
.news-item.recovery { border-left-color: #4ade80; }

.news-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
}

.news-item.injury .news-icon { color: var(--color-error); }
.news-item.game_winner .news-icon { color: #fbbf24; }
.news-item.hot_streak .news-icon { color: #ff6b35; }
.news-item.cold_streak .news-icon { color: #4fc3f7; }
.news-item.development .news-icon, .news-item.breakout .news-icon { color: var(--color-success); }
.news-item.decline .news-icon { color: var(--color-error); }
.news-item.recovery .news-icon { color: #4ade80; }

.news-text {
  flex: 1;
}

.news-headline {
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--color-text-primary);
}

.news-body {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

/* Light mode overrides */
[data-theme="light"] .evolution-item,
[data-theme="light"] .reward-item,
[data-theme="light"] .news-item,
[data-theme="light"] .evolution-section {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .fatigue-bar {
  background: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .news-icon {
  background: rgba(0, 0, 0, 0.05);
}

.qb-sim-to-end-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-xl);
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}
.qb-sim-to-end-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.3);
}
.qb-sim-to-end-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
