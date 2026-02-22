<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/composables/useApi'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { useGameStore } from '@/stores/game'
import { useLeagueStore } from '@/stores/league'
import { useToastStore } from '@/stores/toast'
import { usePlayoffStore } from '@/stores/playoff'
import { useTradeStore } from '@/stores/trade'
import { useBreakingNewsStore } from '@/stores/breakingNews'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { BreakingNewsService } from '@/engine/season/BreakingNewsService'
import { LoadingSpinner, BaseModal } from '@/components/ui'
import { SimulateConfirmModal } from '@/components/game'
import SeasonEndModal from '@/components/playoffs/SeasonEndModal.vue'
import SeriesResultModal from '@/components/playoffs/SeriesResultModal.vue'
import ChampionshipModal from '@/components/playoffs/ChampionshipModal.vue'
import TradeProposalModal from '@/components/trade/TradeProposalModal.vue'
import AllStarModal from '@/components/game/AllStarModal.vue'
import WeeklySummaryModal from '@/components/game/WeeklySummaryModal.vue'
import NewSeasonModal from '@/components/game/NewSeasonModal.vue'
import { enterOffseason, startNewSeason } from '@/engine/campaign/CampaignManager'
import { simFullOffseason } from '@/engine/draft/OffseasonOrchestrator'
import { Play, Search, Users, User, Newspaper, FastForward, Calendar, TrendingUp, Settings, Trophy, Star, AlertTriangle, Heart, X, Zap, Binoculars, Coins, Award, ShoppingBag } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()
const gameStore = useGameStore()
const leagueStore = useLeagueStore()
const toastStore = useToastStore()
const playoffStore = usePlayoffStore()
const tradeStore = useTradeStore()
const breakingNewsStore = useBreakingNewsStore()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const showSimulateModal = ref(false)
const simSeasonMode = ref(false)
const lastSimResult = ref(null) // Last simulated user game result shown during background sim
const showTradeProposalModal = ref(false)
const currentProposal = ref(null)
const showAllStarModal = ref(false)
const allStarRosters = ref(null)
const showInjuryModal = ref(false)
const injuredPlayers = ref([])
const showRecoveryModal = ref(false)
const recoveredPlayers = ref([])
const showLineupWarningModal = ref(false)
const pendingGameAction = ref(null) // 'simulate' or gameId for play
const showWeeklySummaryModal = ref(false)
const weeklySummary = ref(null)
const showRosterWarningModal = ref(false)
const rosterWarningMessage = ref('')
const rosterWarningHint = ref('')
const advancingToNextSeason = ref(false)
const showNewSeasonModal = ref(false)
const newSeasonData = ref(null)
const offseasonData = ref(null) // Stores AI contract results + expiring players after entering offseason

// Only show loading if we don't have cached campaign data
const loading = ref(!campaignStore.currentCampaign)

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const team = computed(() => campaign.value?.team)
// Use teamStore roster which includes season_stats
const roster = computed(() => teamStore.roster || [])
const news = computed(() => (campaign.value?.news || []).slice().reverse())

// Top player by overall rating
const topPlayer = computed(() => {
  if (!roster.value.length) return null
  return [...roster.value].sort((a, b) => b.overall_rating - a.overall_rating)[0]
})

// Get top player's season stats - check multiple possible data paths
const topPlayerStats = computed(() => {
  if (!topPlayer.value) {
    return { ppg: '0.0', rpg: '0.0', apg: '0.0' }
  }

  const player = topPlayer.value
  // Try different possible stat locations (snake_case and camelCase)
  const stats = player.season_stats || player.seasonStats || player.stats || player

  // Helper to format stat value (handles both numbers and pre-formatted strings)
  const formatStat = (val) => {
    if (val === null || val === undefined) return '0.0'
    if (typeof val === 'string') return val
    return Number(val).toFixed(1)
  }

  // Check multiple possible property names
  const ppg = stats.ppg ?? stats.pointsPerGame ?? stats.points_per_game ?? 0
  const rpg = stats.rpg ?? stats.reboundsPerGame ?? stats.rebounds_per_game ?? 0
  const apg = stats.apg ?? stats.assistsPerGame ?? stats.assists_per_game ?? 0

  return {
    ppg: formatStat(ppg),
    rpg: formatStat(rpg),
    apg: formatStat(apg)
  }
})

// Team's standing - use leagueStore for accurate data
const teamStanding = computed(() => {
  if (!team.value) return null
  const conference = team.value.conference
  const standings = conference === 'east'
    ? leagueStore.eastStandings
    : leagueStore.westStandings
  // Try matching by teamId or team_id
  return standings.find(s => s.teamId === team.value.id || s.team_id === team.value.id)
})

const wins = computed(() => teamStanding.value?.wins || 0)
const losses = computed(() => teamStanding.value?.losses || 0)

const teamRank = computed(() => {
  if (!team.value) return '-'
  const rank = leagueStore.getTeamRank(team.value.id, team.value.conference)
  return rank || '-'
})

const conferenceLabel = computed(() => {
  if (!team.value?.conference) return ''
  return team.value.conference === 'east' ? 'EAST' : 'WEST'
})

// Offseason state
const isOffseason = computed(() => campaign.value?.phase === 'offseason')

const lastSeasonChampion = computed(() => {
  const teams = campaign.value?.allTeams
  if (!teams) return null
  const year = campaign.value?.currentSeasonYear ?? 2025
  for (const t of teams) {
    const last = t.seasonHistory?.[t.seasonHistory.length - 1]
    if (last?.champion && last.year === year) return t
  }
  return null
})

const userSeasonHistory = computed(() => {
  const userTeam = campaign.value?.allTeams?.find(t => t.id === campaign.value?.teamId)
  if (!userTeam?.seasonHistory?.length) return null
  return userTeam.seasonHistory[userTeam.seasonHistory.length - 1]
})

const releasedUserPlayers = computed(() => offseasonData.value?.releasedUserPlayers || [])

const rookieDraftCompleted = computed(() => {
  const c = campaign.value
  const year = c?.gameYear
  return c?.[`rookieDraftCompleted_${year}`] === true
})

const aiTransactionSummary = computed(() => {
  if (!offseasonData.value?.aiContractResults) return null
  const { cuts, extensions, signings } = offseasonData.value.aiContractResults
  return {
    cuts: cuts?.length || 0,
    reSignings: extensions?.length || 0,
    freeAgentSignings: signings?.length || 0,
  }
})

// Check if user's team has been eliminated from playoffs
const userEliminated = computed(() => {
  if (!playoffStore.isInPlayoffs || !team.value) return false
  // If there's a next user game, they're still playing
  if (nextGame.value) return false
  // If champion is already declared, show offseason card instead
  if (playoffStore.champion) return false
  // No next game and no champion — user is eliminated or between rounds
  // Check bracket for any active/pending series involving the user
  const bracket = playoffStore.bracket
  if (!bracket) return false
  const userId = team.value.id
  for (const conf of ['east', 'west']) {
    const confData = bracket[conf]
    if (!confData) continue
    for (const round of ['round1', 'round2']) {
      for (const series of (confData[round] || [])) {
        if ((series.team1?.teamId == userId || series.team2?.teamId == userId) &&
            series.status !== 'complete') {
          return false // user still has an active series
        }
        if ((series.team1?.teamId == userId || series.team2?.teamId == userId) &&
            series.status === 'complete' && series.winner?.teamId != userId) {
          return true // user lost this series
        }
      }
    }
    if (confData.confFinals) {
      const s = confData.confFinals
      if ((s.team1?.teamId == userId || s.team2?.teamId == userId) &&
          s.status === 'complete' && s.winner?.teamId != userId) {
        return true
      }
    }
  }
  if (bracket.finals) {
    const s = bracket.finals
    if ((s.team1?.teamId == userId || s.team2?.teamId == userId) &&
        s.status === 'complete' && s.winner?.teamId != userId) {
      return true
    }
  }
  return false
})

// Check if lineup is complete - use teamStore as single source of truth
const isLineupComplete = computed(() => teamStore.isLineupComplete)

// Validate roster before game: check injured starters and minutes total
function validateRosterForGame() {
  const starters = teamStore.starterPlayers || []
  const injuredStarters = starters.filter(p => p && (p.is_injured || p.isInjured))
  if (injuredStarters.length > 0) {
    const names = injuredStarters.map(p => p.name || `${p.first_name} ${p.last_name}`).join(', ')
    rosterWarningMessage.value = `You have injured ${injuredStarters.length === 1 ? 'starter' : 'starters'} in your lineup: ${names}`
    rosterWarningHint.value = 'Go to the Team tab to adjust your lineup before playing.'
    showRosterWarningModal.value = true
    return false
  }

  const totalMins = teamStore.totalTargetMinutes
  if (totalMins !== 200) {
    rosterWarningMessage.value = `Your rotation minutes total ${totalMins} — they must equal exactly 200.`
    rosterWarningHint.value = 'Go to the Team tab to adjust your player minutes before playing.'
    showRosterWarningModal.value = true
    return false
  }

  return true
}

function goToTeamTabFromWarning() {
  showRosterWarningModal.value = false
  router.push(`/campaign/${campaignId.value}/team?tab=team`)
}

// Parse a date string (YYYY-MM-DD or datetime) into a local Date, avoiding UTC shift
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('T')[0].split(' ')[0].split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Current in-game date
const currentDate = computed(() => campaign.value?.current_date)

const formattedCurrentDate = computed(() => {
  if (!currentDate.value) return ''
  const date = parseLocalDate(currentDate.value)
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'short' }),
    month: date.toLocaleDateString('en-US', { month: 'short' }),
    day: date.getDate(),
    year: date.getFullYear()
  }
})

// Next upcoming user game
const nextGame = computed(() => gameStore.nextUserGame)

// Check if next game is in progress
const isGameInProgress = computed(() => nextGame.value?.is_in_progress || false)

// Remaining regular season games for "Sim Season" feature
const remainingSeasonGames = computed(() => {
  const allGames = gameStore.games || []
  const remaining = allGames.filter(g => !g.is_complete && !g.is_playoff)
  const userGames = remaining.filter(g => g.is_user_game)
  const aiGames = remaining.filter(g => !g.is_user_game)
  return { totalGames: remaining.length, userGames: userGames.length, aiGames: aiGames.length }
})

// Get current scores for in-progress game
const inProgressScores = computed(() => {
  if (!isGameInProgress.value || !nextGame.value) return null
  return {
    homeScore: nextGame.value.home_score ?? 0,
    awayScore: nextGame.value.away_score ?? 0,
    quarter: nextGame.value.current_quarter ?? gameStore.currentSimQuarter ?? 1
  }
})

// Playoff series info for next game
const nextGameSeriesInfo = computed(() => {
  if (!nextGame.value?.is_playoff || !nextGame.value?.playoff_series_id) return null
  const series = playoffStore.getSeriesFromBracket(nextGame.value.playoff_series_id)
  if (!series) return null
  const gameNum = nextGame.value.playoff_game_number
  return {
    ...series,
    gameLabel: gameNum ? `Game ${gameNum}` : ''
  }
})

// Get opponent info for next game
const nextGameOpponent = computed(() => {
  if (!nextGame.value || !team.value) return null
  const homeTeam = nextGame.value.home_team
  const awayTeam = nextGame.value.away_team
  const isHome = homeTeam?.id === team.value.id
  const opponent = isHome ? awayTeam : homeTeam

  // Find opponent's standing for record and rank - search both conferences
  const opponentId = opponent?.id
  const opponentAbbr = opponent?.abbreviation
  const matchTeam = (standing) => {
    // Try matching by ID first
    const standingTeamId = standing.teamId ?? standing.team_id ?? standing.team?.id
    if (standingTeamId && opponentId && standingTeamId == opponentId) return true
    // Fallback to matching by abbreviation
    const standingAbbr = standing.team?.abbreviation
    if (standingAbbr && opponentAbbr && standingAbbr === opponentAbbr) return true
    return false
  }

  let opponentStanding = leagueStore.eastStandings.find(matchTeam)
  let opponentConference = 'EAST'
  let opponentRank = null

  if (opponentStanding) {
    opponentRank = leagueStore.eastStandings.indexOf(opponentStanding) + 1
  } else {
    opponentStanding = leagueStore.westStandings.find(matchTeam)
    if (opponentStanding) {
      opponentConference = 'WEST'
      opponentRank = leagueStore.westStandings.indexOf(opponentStanding) + 1
    }
  }

  return {
    name: opponent?.name || opponent?.city || 'Opponent',
    abbreviation: opponent?.abbreviation || '???',
    color: opponent?.primary_color || '#666',
    rating: opponent?.overall_rating || opponent?.rating || null,
    wins: opponentStanding?.wins ?? 0,
    losses: opponentStanding?.losses ?? 0,
    rank: opponentRank,
    conference: opponentConference,
    isHome
  }
})

// User team rating for next game display
const userTeamRating = computed(() => {
  return team.value?.overall_rating || team.value?.rating || null
})

const lastSimResultOutcome = computed(() => {
  if (!lastSimResult.value) return null
  const { homeScore, awayScore, isUserHome } = lastSimResult.value
  const userScore = isUserHome ? homeScore : awayScore
  const oppScore = isUserHome ? awayScore : homeScore
  return userScore > oppScore ? 'win' : 'loss'
})

// Format game date
function formatGameDate(dateStr) {
  if (!dateStr) return ''
  const date = parseLocalDate(dateStr)
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Format news date
function formatNewsDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---- Recent Games Ticker (idle detection) ----
const showTicker = ref(false)
let idleTimer = null
const IDLE_TIMEOUT = 5000

function resetIdleTimer() {
  if (showTicker.value) showTicker.value = false
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (recentLeagueGames.value.length > 0) {
      showTicker.value = true
    }
  }, IDLE_TIMEOUT)
}

const idleEvents = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']

function startIdleDetection() {
  idleEvents.forEach(evt => window.addEventListener(evt, resetIdleTimer, { passive: true }))
  resetIdleTimer()
}

function stopIdleDetection() {
  idleEvents.forEach(evt => window.removeEventListener(evt, resetIdleTimer))
  clearTimeout(idleTimer)
}

// Recent completed games across the league (last 7 in-game days), grouped by date
const recentLeagueGames = computed(() => {
  if (!currentDate.value) return []
  const allGames = gameStore.games || []
  const curDate = parseLocalDate(currentDate.value)
  const weekAgo = new Date(curDate)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const filtered = allGames
    .filter(g => {
      if (!g.is_complete || !g.game_date) return false
      const gd = parseLocalDate(g.game_date)
      return gd >= weekAgo && gd <= curDate
    })
    .sort((a, b) => {
      const da = parseLocalDate(a.game_date)
      const db = parseLocalDate(b.game_date)
      return db - da
    })

  // Group by date and produce flat list with date headers
  const userTeamId = campaign.value?.teamId
  const items = []
  let lastDate = null
  for (const game of filtered) {
    const dateKey = game.game_date.split('T')[0].split(' ')[0]
    if (dateKey !== lastDate) {
      const d = parseLocalDate(dateKey)
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      items.push({ type: 'date', label, key: 'date-' + dateKey })
      lastDate = dateKey
    }
    // Determine winner side and user result
    const homeWon = game.home_score > game.away_score
    let userResult = null
    if (game.is_user_game) {
      const userIsHome = game.home_team_id === userTeamId
      userResult = (userIsHome && homeWon) || (!userIsHome && !homeWon) ? 'win' : 'loss'
    }
    items.push({ type: 'game', game, homeWon, userResult, key: 'game-' + game.id })
  }
  return items
})

onMounted(async () => {
  startIdleDetection()
  // Check for pending weekly summary (e.g., from live game completion)
  if (gameStore.weeklySummaryData) {
    weeklySummary.value = gameStore.weeklySummaryData
    showWeeklySummaryModal.value = true
  }

  // If we already have campaign data, refresh in background without blocking
  const hasCachedData = campaignStore.currentCampaign

  const fetchAll = Promise.all([
    campaignStore.fetchCampaign(campaignId.value),
    teamStore.fetchTeam(campaignId.value),
    leagueStore.fetchStandings(campaignId.value),
    gameStore.fetchGames(campaignId.value)
  ])

  if (hasCachedData) {
    // Refresh in background, don't wait
    fetchAll.then(() => {
      // After refresh, check if a simulation batch is in progress
      const batchId = campaignStore.currentCampaign?.simulation_batch_id
      if (batchId) {
        gameStore.resumePollingIfNeeded(campaignId.value, batchId)
      }
      // Check for pending trade proposals
      checkPendingTradeProposals()
      // Check for All-Star selections
      checkAllStarSelections()
    }).catch(err => console.error('Failed to refresh campaign:', err))
    // Also check playoff status in background
    checkPlayoffStatus()
  } else {
    // No cached data, wait for fetch and show loading
    try {
      await fetchAll
      // Check if a simulation batch is in progress
      const batchId = campaignStore.currentCampaign?.simulation_batch_id
      if (batchId) {
        gameStore.resumePollingIfNeeded(campaignId.value, batchId)
      }
      // Check playoff status after initial load
      await checkPlayoffStatus()
      // Check for pending trade proposals
      await checkPendingTradeProposals()
      // Check for All-Star selections
      await checkAllStarSelections()
    } catch (err) {
      console.error('Failed to load campaign:', err)
    } finally {
      loading.value = false
    }
  }
})

onUnmounted(() => {
  stopIdleDetection()
})

// Check if regular season ended and handle playoffs
async function checkPlayoffStatus() {
  try {
    await playoffStore.checkRegularSeasonEnd(campaignId.value)
    // If bracket exists, also fetch it
    if (playoffStore.bracketGenerated) {
      await playoffStore.fetchBracket(campaignId.value)
    }
  } catch (err) {
    console.error('Failed to check playoff status:', err)
  }
}

// Handle season end modal continue
async function handleSeasonEndContinue() {
  playoffStore.closeSeasonEndModal()

  if (playoffStore.userQualified) {
    // Generate bracket and enter playoffs
    const loadingToastId = toastStore.showLoading('Generating playoff bracket...')
    try {
      await playoffStore.generateBracket(campaignId.value)

      // Breaking news: top seed
      if (playoffStore.userSeed === 1) {
        const userTeam = campaignStore.currentCampaign?.team
        const standing = teamStanding.value
        const record = standing ? `${standing.wins}-${standing.losses}` : ''
        const conf = userTeam?.conference || 'east'
        breakingNewsStore.enqueue(
          BreakingNewsService.topSeed({
            teamName: userTeam?.name || 'Your Team',
            conference: conf,
            record,
            date: campaignStore.currentCampaign?.settings?.currentDate || new Date().toISOString().split('T')[0],
          }),
          campaignId.value
        )
      }

      toastStore.removeMinimalToast(loadingToastId)
      toastStore.showSuccess('Playoffs have begun!')
      router.push(`/campaign/${campaignId.value}/playoffs`)
    } catch (err) {
      toastStore.removeMinimalToast(loadingToastId)
      toastStore.showError('Failed to generate bracket')
    }
  } else {
    // Team didn't qualify - enter offseason
    await handleEnterOffseason()
  }
}

// Handle playoff series result modal
async function handleSeriesResultClose() {
  const result = playoffStore.seriesResult
  const userTeamId = campaignStore.currentCampaign?.teamId
  const userLost = result?.seriesComplete && result?.winner?.teamId != userTeamId

  playoffStore.closeSeriesResultModal()

  if (userLost) {
    // User eliminated — refresh to show between-rounds / sim to next round card
    await Promise.all([
      playoffStore.fetchBracket(campaignId.value),
      gameStore.fetchGames(campaignId.value, { force: true }),
    ])
  } else {
    // Breaking news: making the finals (conference finals win, round 3)
    if (result?.seriesComplete && result?.round === 3) {
      const userTeam = campaignStore.currentCampaign?.team
      const loserName = result?.winner?.teamId == campaignStore.currentCampaign?.teamId
        ? (result?.series?.awayTeam?.name || result?.series?.homeTeam?.name || 'their opponent')
        : 'their opponent'
      breakingNewsStore.enqueue(
        BreakingNewsService.makingFinals({
          teamName: userTeam?.name || 'Your Team',
          opponentName: loserName,
          date: campaignStore.currentCampaign?.settings?.currentDate || new Date().toISOString().split('T')[0],
        }),
        campaignId.value
      )
    }

    // User won — refresh bracket and games to show next round schedule
    await Promise.all([
      playoffStore.fetchBracket(campaignId.value),
      gameStore.fetchGames(campaignId.value, { force: true }),
    ])
  }
}

// Handle championship modal — show offseason card (don't auto-advance)
function handleChampionshipClose() {
  // Breaking news: winning the championship
  const userTeam = campaignStore.currentCampaign?.team
  const year = campaignStore.currentCampaign?.season?.year || campaignStore.currentCampaign?.game_year || new Date().getFullYear()
  breakingNewsStore.enqueue(
    BreakingNewsService.winningFinals({
      teamName: userTeam?.name || 'Your Team',
      year,
      date: campaignStore.currentCampaign?.settings?.currentDate || new Date().toISOString().split('T')[0],
    }),
    campaignId.value
  )

  playoffStore.closeChampionshipModal()
}

// Handle entering the offseason (after champion declared or non-qualifying)
async function handleEnterOffseason() {
  advancingToNextSeason.value = true
  const loadingToastId = toastStore.showLoading('Processing offseason...')
  try {
    const result = await enterOffseason(campaignId.value)

    // Store offseason data for the UI hub
    offseasonData.value = {
      aiContractResults: result.aiContractResults,
      releasedUserPlayers: result.releasedUserPlayers,
      seasonAwards: result.seasonAwards,
    }

    // Reset playoff state and breaking news
    playoffStore.$reset()
    breakingNewsStore.clear()
    financeStore.invalidate()

    // Refresh campaign data (phase is now 'offseason')
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
    ])

    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showSuccess('Welcome to the offseason!')
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Failed to enter offseason')
    console.error('Failed to enter offseason:', err)
  } finally {
    advancingToNextSeason.value = false
  }
}

// Handle starting a new season from offseason hub
async function handleStartNewSeason() {
  advancingToNextSeason.value = true
  const loadingToastId = toastStore.showLoading('Starting new season...')
  try {
    const result = await startNewSeason(campaignId.value)

    // Clear offseason data
    offseasonData.value = null
    financeStore.invalidate()

    // Refresh all data from the new season
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
      gameStore.fetchGames(campaignId.value, { force: true }),
      leagueStore.fetchStandings(campaignId.value, { force: true }),
    ])

    toastStore.removeMinimalToast(loadingToastId)

    // Show new season modal
    newSeasonData.value = {
      seasonYear: result.campaign.currentSeasonYear,
      facilitiesBefore: result.facilitiesBefore,
      facilitiesAfter: result.facilitiesAfter,
    }
    showNewSeasonModal.value = true
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Failed to start new season')
    console.error('Failed to start new season:', err)
  } finally {
    advancingToNextSeason.value = false
  }
}

// Handle "Sim Offseason" one-click flow (auto-drafts + starts new season)
async function handleSimOffseason() {
  advancingToNextSeason.value = true
  const loadingToastId = toastStore.showLoading('Simulating offseason...')
  try {
    const result = await simFullOffseason(campaignId.value)

    offseasonData.value = null
    financeStore.invalidate()

    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
      gameStore.fetchGames(campaignId.value, { force: true }),
      leagueStore.fetchStandings(campaignId.value, { force: true }),
    ])

    toastStore.removeMinimalToast(loadingToastId)

    // Show new season modal
    newSeasonData.value = {
      seasonYear: result.campaign.currentSeasonYear,
      facilitiesBefore: result.facilitiesBefore,
      facilitiesAfter: result.facilitiesAfter,
    }
    showNewSeasonModal.value = true
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Failed to simulate offseason')
    console.error('Failed to sim offseason:', err)
  } finally {
    advancingToNextSeason.value = false
  }
}

function navigateToRoster() {
  router.push(`/campaign/${campaignId.value}/team`)
}

function navigateToScout() {
  router.push(`/campaign/${campaignId.value}/scouting`)
}

function openPlayerDetails() {
  router.push(`/campaign/${campaignId.value}/team`)
}

function navigateToGame(gameId) {
  if (!isLineupComplete.value) {
    pendingGameAction.value = gameId
    showLineupWarningModal.value = true
    return
  }
  if (!validateRosterForGame()) return
  router.push(`/campaign/${campaignId.value}/game/${gameId}`)
}

async function handleSimulateToNextGame() {
  if (!isLineupComplete.value) {
    pendingGameAction.value = 'simulate'
    showLineupWarningModal.value = true
    return
  }
  if (!validateRosterForGame()) return
  showSimulateModal.value = true
  await gameStore.fetchSimulateToNextGamePreview(campaignId.value)
}

function handleCloseLineupWarning() {
  showLineupWarningModal.value = false
  pendingGameAction.value = null
}

function goToRosterFromWarning() {
  showLineupWarningModal.value = false
  pendingGameAction.value = null
  router.push(`/campaign/${campaignId.value}/team`)
}

async function handleConfirmSimulate() {
  // Close modal immediately so user sees loading state on the button
  showSimulateModal.value = false
  gameStore.clearSimulatePreview()

  // Capture team colors from current nextGame before the async call replaces it
  const preSimHomeColor = nextGame.value?.home_team?.primary_color || '#666'
  const preSimAwayColor = nextGame.value?.away_team?.primary_color || '#666'

  // Show loading toast
  const loadingToastId = toastStore.showLoading('Simulating your game...')

  try {
    const response = await gameStore.simulateToNextGame(campaignId.value)

    // Remove loading toast
    toastStore.removeMinimalToast(loadingToastId)

    // Store last result for display during background sim
    if (response.userGameResult) {
      lastSimResult.value = {
        homeTeam: response.userGameResult.home_team?.abbreviation || 'HOME',
        awayTeam: response.userGameResult.away_team?.abbreviation || 'AWAY',
        homeTeamColor: preSimHomeColor,
        awayTeamColor: preSimAwayColor,
        homeScore: response.userGameResult.home_score,
        awayScore: response.userGameResult.away_score,
        gameId: response.userGameResult.game_id,
        isUserHome: response.userGameResult.is_user_home,
      }

      toastStore.showGameResult({
        homeTeam: lastSimResult.value.homeTeam,
        awayTeam: lastSimResult.value.awayTeam,
        homeScore: lastSimResult.value.homeScore,
        awayScore: lastSimResult.value.awayScore,
        gameId: lastSimResult.value.gameId,
        campaignId: campaignId.value,
        isUserHome: lastSimResult.value.isUserHome
      })

      // Check for user team injuries and recoveries
      const evo = response.userGameResult.evolution
      const teamKey = response.userGameResult.is_user_home ? 'home' : 'away'
      if (evo?.[teamKey]?.injuries?.length > 0) {
        injuredPlayers.value = evo[teamKey].injuries
        showInjuryModal.value = true
      }
      if (evo?.[teamKey]?.recoveries?.length > 0) {
        recoveredPlayers.value = evo[teamKey].recoveries
        if (showInjuryModal.value) {
          setTimeout(() => { showRecoveryModal.value = true }, 500)
        } else {
          showRecoveryModal.value = true
        }
      }
    }

    // Show upgrade points toasts
    if (response.upgrade_points_awarded?.length) {
      response.upgrade_points_awarded.forEach((award, i) => {
        setTimeout(() => {
          toastStore.showSuccess(
            `${award.name} earned ${award.points_earned} upgrade point${award.points_earned > 1 ? 's' : ''}! (${award.total_points} total)`,
            5000
          )
        }, i * 600)
      })
    }

    // Handle playoff update if present
    if (response.userGameResult?.playoffUpdate) {
      playoffStore.handlePlayoffUpdate(response.userGameResult.playoffUpdate)
    }

    // Refresh campaign, team, games, and standings immediately
    // Standings include the user's game result (updated synchronously on backend)
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
      gameStore.fetchGames(campaignId.value, { force: true }),
      leagueStore.fetchStandings(campaignId.value, { force: true })
    ])

    if (!gameStore.backgroundSimulating) {
      lastSimResult.value = null
      await checkPlayoffStatus()
      // Check for trade proposals after user game sim
      await checkTradeDeadline()
      await checkPendingTradeProposals()
    }

    // Show weekly summary if weeks passed
    if (response.weeklySummary) {
      weeklySummary.value = response.weeklySummary
      showWeeklySummaryModal.value = true
    }
  } catch (err) {
    // Remove loading toast and show error
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Simulation failed. Please try again.')
    console.error('Failed to simulate to next game:', err)
  }
}

async function handleSimToEndFromModal() {
  showSimulateModal.value = false
  await handleSimToEnd()
}

async function handleSimToEnd() {
  if (!validateRosterForGame()) return

  // Capture game info before async call (nextGame may change after simToEnd completes)
  const gameToSim = nextGame.value
  const simGameId = gameToSim.id
  const simHomeAbbr = gameToSim.home_team?.abbreviation || 'HOME'
  const simAwayAbbr = gameToSim.away_team?.abbreviation || 'AWAY'
  const simHomeColor = gameToSim.home_team?.primary_color || '#666'
  const simAwayColor = gameToSim.away_team?.primary_color || '#666'
  const loadingToastId = toastStore.showLoading('Simming to end...')

  try {
    const response = await gameStore.simToEnd(campaignId.value, simGameId)

    toastStore.removeMinimalToast(loadingToastId)

    if (response.result) {
      const simIsUserHome = response.is_user_home

      lastSimResult.value = {
        homeTeam: simHomeAbbr,
        awayTeam: simAwayAbbr,
        homeTeamColor: simHomeColor,
        awayTeamColor: simAwayColor,
        homeScore: response.result.home_score,
        awayScore: response.result.away_score,
        gameId: simGameId,
        isUserHome: simIsUserHome,
      }

      toastStore.showGameResult({
        homeTeam: lastSimResult.value.homeTeam,
        awayTeam: lastSimResult.value.awayTeam,
        homeScore: lastSimResult.value.homeScore,
        awayScore: lastSimResult.value.awayScore,
        gameId: lastSimResult.value.gameId,
        campaignId: campaignId.value,
        isUserHome: simIsUserHome,
      })

      // Check for user team injuries and recoveries
      const evo = response.result.evolution
      const teamKey = simIsUserHome ? 'home' : 'away'
      if (evo?.[teamKey]?.injuries?.length > 0) {
        injuredPlayers.value = evo[teamKey].injuries
        showInjuryModal.value = true
      }
      if (evo?.[teamKey]?.recoveries?.length > 0) {
        recoveredPlayers.value = evo[teamKey].recoveries
        if (showInjuryModal.value) {
          setTimeout(() => { showRecoveryModal.value = true }, 500)
        } else {
          showRecoveryModal.value = true
        }
      }
    }

    // Show upgrade points toasts
    if (response.upgrade_points_awarded?.length) {
      response.upgrade_points_awarded.forEach((award, i) => {
        setTimeout(() => {
          toastStore.showSuccess(
            `${award.name} earned ${award.points_earned} upgrade point${award.points_earned > 1 ? 's' : ''}! (${award.total_points} total)`,
            5000
          )
        }, i * 600)
      })
    }

    if (response.playoffUpdate) {
      playoffStore.handlePlayoffUpdate(response.playoffUpdate)
    }

    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
      gameStore.fetchGames(campaignId.value, { force: true }),
      leagueStore.fetchStandings(campaignId.value, { force: true })
    ])

    if (!gameStore.backgroundSimulating) {
      lastSimResult.value = null
      await checkPlayoffStatus()
    }

    // Show weekly summary if weeks passed
    if (gameStore.weeklySummaryData) {
      weeklySummary.value = gameStore.weeklySummaryData
      showWeeklySummaryModal.value = true
    }
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Sim to end failed. Please try again.')
    console.error('Failed to sim to end:', err)
  }
}

// Watch for background simulation completion to refresh data
watch(() => gameStore.backgroundSimulating, async (newVal, oldVal) => {
  if (oldVal === true && newVal === false) {
    // Close sim-season modal if open
    if (simSeasonMode.value) {
      showSimulateModal.value = false
      simSeasonMode.value = false
    }
    // Clear last sim result so the next game card shows the upcoming game
    lastSimResult.value = null

    // Background AI games finished — refresh all data
    try {
      await Promise.all([
        campaignStore.fetchCampaign(campaignId.value, true),
        leagueStore.fetchStandings(campaignId.value, { force: true }),
        gameStore.fetchGames(campaignId.value, { force: true })
      ])
      await checkPlayoffStatus()
      toastStore.showSuccess('All league games simulated')
      // Check for trade deadline
      await checkTradeDeadline()
      // Check for new trade proposals generated during simulation
      await checkPendingTradeProposals()
      // Check for All-Star selections
      await checkAllStarSelections()
    } catch (err) {
      console.error('Failed to refresh after background simulation:', err)
    }
  }
})

// Trade deadline check
const tradeDeadlineAlerted = ref(false)
async function checkTradeDeadline() {
  if (tradeDeadlineAlerted.value) return
  const camp = campaignStore.currentCampaign
  if (!camp) return
  const currentDate = camp.current_date ?? camp.currentDate
  if (!currentDate) return
  const year = camp.currentSeasonYear ?? camp.game_year ?? new Date().getFullYear()
  const settings = camp.settings || {}
  // Trade deadline is January 6 of the season year + 1 (season starts in Oct)
  const deadlineYear = year + 1
  const deadlineDate = `${deadlineYear}-01-06`
  if (currentDate >= deadlineDate && !settings.trade_deadline_passed) {
    tradeDeadlineAlerted.value = true
    // Persist the flag so it doesn't fire again
    if (!camp.settings) camp.settings = {}
    camp.settings.trade_deadline_passed = true
    const { CampaignRepository } = await import('@/engine/db/CampaignRepository')
    const storedCampaign = await CampaignRepository.get(campaignId.value)
    if (storedCampaign) {
      if (!storedCampaign.settings) storedCampaign.settings = {}
      storedCampaign.settings.trade_deadline_passed = true
      await CampaignRepository.save(storedCampaign)
    }
    breakingNewsStore.enqueue(
      BreakingNewsService.tradeDeadlinePassed({ date: deadlineDate }),
      campaignId.value
    )
  }
}

// Trade proposal handling
async function checkPendingTradeProposals() {
  const camp = campaignStore.currentCampaign
  if (!camp) return

  // Only generate proposals during regular season, before trade deadline
  if (camp.phase === 'offseason' || camp.phase === 'playoffs') return
  if (camp.settings?.trade_deadline_passed) return

  try {
    const proposals = await tradeStore.fetchPendingProposals(campaignId.value)
    if (proposals.length > 0) {
      currentProposal.value = proposals[0]
      showTradeProposalModal.value = true
    }
  } catch (err) {
    console.error('Failed to check trade proposals:', err)
  }
}

async function handleAcceptProposal(proposal) {
  const loadingToastId = toastStore.showLoading('Processing trade...')
  try {
    const result = await tradeStore.acceptProposal(campaignId.value, proposal.id)

    // Enqueue breaking news for the accepted trade
    if (result?.tradeContext) {
      breakingNewsStore.enqueue(
        BreakingNewsService.tradeCompleted(result.tradeContext),
        campaignId.value
      )
    }

    showTradeProposalModal.value = false
    currentProposal.value = null
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showSuccess('Trade completed!')
    // Refresh team and campaign data
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
    ])
    // Show next proposal if any
    if (tradeStore.pendingProposals.length > 0) {
      currentProposal.value = tradeStore.pendingProposals[0]
      showTradeProposalModal.value = true
    }
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError(tradeStore.error || 'Failed to accept trade')
  }
}

async function handleRejectProposal(proposal) {
  try {
    await tradeStore.rejectProposal(campaignId.value, proposal.id)
    showTradeProposalModal.value = false
    currentProposal.value = null
    // Show next proposal if any
    if (tradeStore.pendingProposals.length > 0) {
      currentProposal.value = tradeStore.pendingProposals[0]
      showTradeProposalModal.value = true
    }
  } catch (err) {
    toastStore.showError('Failed to reject proposal')
  }
}

function handleCloseProposalModal() {
  showTradeProposalModal.value = false
  currentProposal.value = null
}

// All-Star selection handling
async function checkAllStarSelections() {
  const camp = campaignStore.currentCampaign
  if (!camp) return

  const year = camp.currentSeasonYear ?? camp.game_year ?? 2025
  const currentDate = camp.current_date ?? camp.currentDate
  if (!currentDate) return

  const { SeasonRepository } = await import('@/engine/db/SeasonRepository')
  const { TeamRepository } = await import('@/engine/db/TeamRepository')
  const { PlayerRepository } = await import('@/engine/db/PlayerRepository')
  const { AllStarService } = await import('@/engine/season/AllStarService')

  const seasonData = await SeasonRepository.get(campaignId.value, year)
  if (!seasonData) return

  // If rosters already exist on seasonData, check if user has viewed them
  if (seasonData.allStarRosters) {
    if (!seasonData.allStarViewed) {
      allStarRosters.value = seasonData.allStarRosters
      showAllStarModal.value = true
    }
    return
  }

  // Try to process selections (will return null if date hasn't been reached)
  const teams = await TeamRepository.getAllForCampaign(campaignId.value)
  const allPlayers = await PlayerRepository.getAllForCampaign(campaignId.value)
  const userTeamId = camp.teamId

  const result = AllStarService.processAllStarSelections({
    seasonData,
    year,
    currentDate,
    allPlayers,
    teams,
    userTeamId,
    alreadySelected: false,
  })

  if (!result) return

  // Save season data with allStarRosters
  await SeasonRepository.save(seasonData)

  allStarRosters.value = result.rosters

  // Enqueue breaking news for user team All-Stars
  const userTeamName = camp.team?.name || 'Your Team'
  for (const event of result.newsEvents) {
    if (event.playerId) {
      breakingNewsStore.enqueue(
        BreakingNewsService.allStarSelection({
          playerName: event.headline.replace(/ selected to .*/, ''),
          teamName: userTeamName,
          selectionType: event.headline.includes('Rising') ? 'rising_stars' : 'all_star',
          date: currentDate,
        }),
        campaignId.value
      )
    }
  }

  showAllStarModal.value = true
}

function getInjurySeverityColor(severity) {
  switch (severity) {
    case 'minor': return '#fbbf24'
    case 'moderate': return '#fb923c'
    case 'severe': return '#ef4444'
    case 'season_ending': return '#ef4444'
    default: return '#fbbf24'
  }
}

function goToLineup() {
  showInjuryModal.value = false
  router.push(`/campaign/${campaignId.value}/team`)
}

function goToLineupFromRecovery() {
  showRecoveryModal.value = false
  router.push(`/campaign/${campaignId.value}/team`)
}

async function handleCloseAllStarModal() {
  showAllStarModal.value = false
  try {
    const { SeasonRepository } = await import('@/engine/db/SeasonRepository')
    const camp = campaignStore.currentCampaign
    const year = camp?.currentSeasonYear ?? camp?.game_year ?? 2025
    const seasonData = await SeasonRepository.get(campaignId.value, year)
    if (seasonData) {
      seasonData.allStarViewed = true
      await SeasonRepository.save(seasonData)
    }
  } catch (err) {
    console.error('Failed to mark All-Star as viewed:', err)
  }
}

async function openAllStarModal() {
  if (allStarRosters.value) {
    showAllStarModal.value = true
    return
  }
  try {
    const { SeasonRepository } = await import('@/engine/db/SeasonRepository')
    const camp = campaignStore.currentCampaign
    const year = camp?.currentSeasonYear ?? camp?.game_year ?? 2025
    const seasonData = await SeasonRepository.get(campaignId.value, year)
    if (seasonData?.allStarRosters) {
      allStarRosters.value = seasonData.allStarRosters
      showAllStarModal.value = true
    }
  } catch (err) {
    console.error('Failed to fetch All-Star rosters:', err)
  }
}

async function handleFinishSeason() {
  try {
    await gameStore.simulateRemainingSeason(campaignId.value)
  } catch (err) {
    toastStore.showError('Failed to simulate remaining games')
  }
}

async function handleConfirmSimSeason() {
  if (!isLineupComplete.value) {
    showSimulateModal.value = false
    simSeasonMode.value = false
    pendingGameAction.value = 'simulate'
    showLineupWarningModal.value = true
    return
  }
  if (!validateRosterForGame()) {
    showSimulateModal.value = false
    simSeasonMode.value = false
    return
  }
  try {
    await gameStore.simulateRemainingSeason(campaignId.value)
    // Modal stays open during simulation — backgroundSimulating watcher handles refresh
  } catch (err) {
    toastStore.showError('Failed to simulate remaining season')
  }
}

async function handleSimToNextPlayoffRound() {
  try {
    if (userEliminated.value) {
      // User is eliminated — sim ALL remaining playoff rounds internally
      await gameStore.simulateToNextPlayoffRound(campaignId.value, { simAll: true })
    } else {
      // User still in playoffs — sim one round of AI games
      await gameStore.simulateToNextPlayoffRound(campaignId.value)
    }
    // Refresh all data — bracket, games, standings
    await Promise.all([
      playoffStore.fetchBracket(campaignId.value),
      gameStore.fetchGames(campaignId.value, { force: true }),
      campaignStore.fetchCampaign(campaignId.value, true),
      leagueStore.fetchStandings(campaignId.value, { force: true }),
    ])

    if (userEliminated.value && playoffStore.champion) {
      const champion = playoffStore.champion
      const year = campaign.value?.season?.year || campaign.value?.game_year || new Date().getFullYear()
      breakingNewsStore.enqueue(
        BreakingNewsService.winningFinals({
          teamName: `${champion.city} ${champion.name}`,
          year,
          date: campaign.value?.settings?.currentDate || new Date().toISOString().split('T')[0],
        }),
        campaignId.value
      )
    } else {
      toastStore.showSuccess('Next round is ready!')
    }
  } catch (err) {
    toastStore.showError('Failed to simulate playoff games')
    console.error('Failed to sim to next playoff round:', err)
  }
}

function handleCloseSimulateModal() {
  showSimulateModal.value = false
  simSeasonMode.value = false
  gameStore.clearSimulatePreview()
}
</script>

<template>
  <div class="campaign-home">
    <!-- Loading -->
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="md" />
    </div>

    <template v-else-if="campaign">
      <!-- Team Header - City stacked on top of Name -->
      <section class="team-header">
        <div class="team-header-row">
          <div
            class="team-logo-badge"
            :style="{ backgroundColor: team?.primary_color || '#E85A4F' }"
          >
            {{ team?.abbreviation }}
          </div>
          <div class="team-header-text">
            <p class="team-city">{{ team?.city }} · {{ conferenceLabel }}</p>
            <h1 class="team-name">{{ team?.name }}</h1>
          </div>
          <!-- Current date only visible on desktop (mobile shows in header) -->
          <div v-if="formattedCurrentDate" class="current-date">
            <span class="date-day">{{ formattedCurrentDate.day }}</span>
            <div class="date-details">
              <span class="date-month">{{ formattedCurrentDate.month }} {{ formattedCurrentDate.year }}</span>
              <span class="date-weekday">{{ formattedCurrentDate.weekday }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Record Card - Cosmic gradient -->
      <section class="record-card card-cosmic">
        <div class="record-content">
          <div class="record-left">
            <span class="record-label">Record</span>
            <span class="record-rank">#{{ teamRank }} Conf. Rank</span>
          </div>
          <div class="record-right">
            <span class="record-value">{{ wins }}-{{ losses }}</span>
          </div>
        </div>
        <div class="record-tokens">
          <Coins :size="13" class="record-tokens-icon" />
          <div class="tokens-score-container">
            <TransitionGroup name="token-slide" tag="div" class="tokens-score-slot">
              <span :key="authStore.profile?.tokens" class="record-tokens-value">{{ (authStore.profile?.tokens ?? 0).toLocaleString() }}</span>
            </TransitionGroup>
          </div>
          <span class="record-tokens-label">tokens</span>
          <router-link to="/store" class="shop-link">
            <ShoppingBag :size="11" />
            Shop
          </router-link>
        </div>
      </section>

      <!-- Last Sim Result Card (shown while background sim is running) -->
      <section v-if="lastSimResult && gameStore.backgroundSimulating" class="next-game-card glass-card-nebula">
        <div class="next-game-header">
          <div class="next-game-label-row">
            <h3 class="next-game-label">LAST GAME</h3>
            <span class="last-result-tag" :class="lastSimResultOutcome">{{ lastSimResultOutcome === 'win' ? 'W' : 'L' }}</span>
          </div>
          <span class="next-game-location">FINAL</span>
        </div>
        <div class="next-game-content">
          <div class="next-game-matchup">
            <div class="matchup-team" :class="{ 'user-team': !lastSimResult.isUserHome }">
              <div
                class="team-badge-game"
                :style="{ backgroundColor: lastSimResult.awayTeamColor }"
              >
                <span class="badge-abbr">{{ lastSimResult.awayTeam }}</span>
                <span class="badge-score">{{ lastSimResult.awayScore }}</span>
              </div>
            </div>
            <div class="matchup-vs">
              <span class="vs-text">-</span>
            </div>
            <div class="matchup-team" :class="{ 'user-team': lastSimResult.isUserHome }">
              <div
                class="team-badge-game"
                :style="{ backgroundColor: lastSimResult.homeTeamColor }"
              >
                <span class="badge-abbr">{{ lastSimResult.homeTeam }}</span>
                <span class="badge-score">{{ lastSimResult.homeScore }}</span>
              </div>
            </div>
          </div>
          <div class="next-game-buttons">
            <button
              class="btn-box-score"
              @click="router.push(`/campaign/${campaignId}/game/${lastSimResult.gameId}`)"
            >
              <Search class="btn-icon" :size="16" />
              VIEW BOX SCORE
            </button>
          </div>
        </div>
      </section>

      <!-- Next Game Card -->
      <section v-else-if="nextGame" class="next-game-card glass-card-nebula" :class="{ 'in-progress': isGameInProgress, 'is-playoff': nextGame.is_playoff }">
        <div class="next-game-header">
          <div class="next-game-label-group">
            <h3 class="next-game-label" :class="{ 'live': isGameInProgress }">
              {{ isGameInProgress ? 'GAME IN PROGRESS' : 'NEXT GAME' }}
            </h3>
            <span v-if="isGameInProgress && inProgressScores" class="live-quarter">Q{{ inProgressScores.quarter }}</span>
            <span v-else class="next-game-date">{{ nextGame?.game_date ? formatGameDate(nextGame.game_date) : '' }}</span>
          </div>
          <span class="next-game-location">{{ nextGameOpponent?.isHome ? 'HOME' : 'AWAY' }}</span>
        </div>
        <!-- Playoff Info Banner -->
        <div v-if="nextGame.is_playoff" class="playoff-info-banner">
          <Trophy :size="14" class="playoff-info-icon" />
          <span class="playoff-round-label">{{ playoffStore.getPlayoffRoundLabel(nextGame.playoff_round) }}</span>
          <span v-if="nextGameSeriesInfo" class="playoff-series-record">
            {{ nextGameSeriesInfo.gameLabel }} &middot; Series {{ nextGameSeriesInfo.team1Wins }}-{{ nextGameSeriesInfo.team2Wins }}
          </span>
        </div>
        <div class="next-game-content">
          <!-- Loading state while simulating -->
          <div v-if="gameStore.simulating" class="next-game-loading">
            <LoadingSpinner size="md" />
            <span class="next-game-loading-text">Simulating...</span>
          </div>

          <!-- Normal content -->
          <template v-else>
            <div class="next-game-matchup">
              <div class="matchup-team user-team">
                <div
                  class="team-badge-game"
                  :style="{ backgroundColor: team?.primary_color || '#E85A4F' }"
                >
                  <span class="badge-abbr">{{ team?.abbreviation }}</span>
                  <span v-if="isGameInProgress && inProgressScores" class="badge-score">
                    {{ nextGameOpponent?.isHome ? inProgressScores.awayScore : inProgressScores.homeScore }}
                  </span>
                  <span v-else class="badge-record">{{ wins }}-{{ losses }}</span>
                </div>
                <div class="team-info">
                  <span v-if="userTeamRating" class="team-rating">{{ userTeamRating }} OVR</span>
                  <span class="team-rank">#{{ teamRank }} {{ conferenceLabel }}</span>
                </div>
              </div>
              <div class="matchup-vs">
                <span class="vs-text">{{ isGameInProgress ? '-' : 'VS' }}</span>
              </div>
              <div class="matchup-team opponent-team">
                <div
                  class="team-badge-game"
                  :style="{ backgroundColor: nextGameOpponent?.color || '#666' }"
                >
                  <span class="badge-abbr">{{ nextGameOpponent?.abbreviation }}</span>
                  <span v-if="isGameInProgress && inProgressScores" class="badge-score">
                    {{ nextGameOpponent?.isHome ? inProgressScores.homeScore : inProgressScores.awayScore }}
                  </span>
                  <span v-else class="badge-record">{{ nextGameOpponent?.wins }}-{{ nextGameOpponent?.losses }}</span>
                </div>
                <div class="team-info">
                  <span v-if="nextGameOpponent?.rating" class="team-rating">{{ nextGameOpponent.rating }} OVR</span>
                  <span v-if="nextGameOpponent?.rank" class="team-rank">#{{ nextGameOpponent.rank }} {{ nextGameOpponent.conference }}</span>
                </div>
              </div>
            </div>
            <div class="next-game-buttons">
              <button
                class="btn-play-game"
                :class="{ 'continue': isGameInProgress }"
                @click="navigateToGame(nextGame.id)"
              >
                <Play class="btn-icon" :size="16" />
                {{ isGameInProgress ? 'CONTINUE GAME' : 'PLAY GAME' }}
              </button>
              <button
                v-if="!isGameInProgress"
                class="btn-simulate-game"
                @click="handleSimulateToNextGame"
              >
                <FastForward class="btn-icon" :size="16" />
                SIMULATE
              </button>
              <button
                v-if="isGameInProgress"
                class="btn-simulate-game"
                @click="handleSimToEnd"
              >
                <FastForward class="btn-icon" :size="16" />
                SIM TO END
              </button>
            </div>
          </template>
        </div>
      </section>

      <!-- Playoff Between-Rounds Card -->
      <section v-else-if="playoffStore.isInPlayoffs && !playoffStore.champion" class="next-game-card glass-card-nebula playoff-between-rounds">
        <div class="next-game-header">
          <div class="next-game-label-row">
            <h3 class="next-game-label">{{ userEliminated ? 'SEASON OVER' : 'SERIES WON' }}</h3>
            <Trophy :size="16" class="playoff-trophy-icon" />
          </div>
        </div>
        <div class="next-game-content">
          <div v-if="gameStore.simulating" class="next-game-loading">
            <LoadingSpinner size="md" />
            <span class="next-game-loading-text">Simulating playoff games...</span>
          </div>
          <template v-else>
            <p class="season-wrap-text">
              {{ userEliminated
                ? 'Your season has ended. Simulate the remaining playoff games to crown a champion.'
                : 'Waiting for other playoff series to finish before the next round begins.'
              }}
            </p>
            <div class="next-game-buttons">
              <button class="btn-play-game" @click="handleSimToNextPlayoffRound">
                <FastForward class="btn-icon" :size="16" />
                {{ userEliminated ? 'SIM REMAINING PLAYOFFS' : 'SIM TO NEXT ROUND' }}
              </button>
            </div>
          </template>
        </div>
      </section>

      <!-- Offseason Hub (interactive offseason period) -->
      <section v-else-if="isOffseason" class="next-game-card glass-card-nebula offseason-card">
        <div class="next-game-header">
          <div class="next-game-label-row">
            <h3 class="next-game-label">OFFSEASON</h3>
            <Trophy :size="16" class="playoff-trophy-icon" />
          </div>
        </div>
        <div class="next-game-content">
          <div v-if="advancingToNextSeason" class="next-game-loading">
            <LoadingSpinner size="md" />
            <span class="next-game-loading-text">Starting new season...</span>
          </div>
          <template v-else>
            <!-- Champion Banner -->
            <div v-if="lastSeasonChampion" class="offseason-champion-banner">
              <Trophy :size="20" class="offseason-champion-icon" />
              <span class="offseason-champion-text">
                {{ lastSeasonChampion.city }} {{ lastSeasonChampion.name }} are NBA Champions
              </span>
            </div>

            <!-- Season Awards Summary -->
            <div v-if="offseasonData?.seasonAwards" class="offseason-awards">
              <div v-if="offseasonData.seasonAwards.mvp" class="offseason-award-line">
                <Star :size="14" class="offseason-award-icon gold" />
                <span class="offseason-award-text">MVP: <strong>{{ offseasonData.seasonAwards.mvp.playerName }}</strong> ({{ offseasonData.seasonAwards.mvp.teamAbbr }})</span>
              </div>
              <div v-if="offseasonData.seasonAwards.rookieOfTheYear" class="offseason-award-line">
                <Award :size="14" class="offseason-award-icon gold" />
                <span class="offseason-award-text">ROTY: <strong>{{ offseasonData.seasonAwards.rookieOfTheYear.playerName }}</strong> ({{ offseasonData.seasonAwards.rookieOfTheYear.teamAbbr }})</span>
              </div>
              <div v-if="offseasonData.seasonAwards.allNba?.first?.length" class="offseason-award-line">
                <Trophy :size="14" class="offseason-award-icon" />
                <span class="offseason-award-text">All-NBA 1st: {{ offseasonData.seasonAwards.allNba.first.map(p => p.playerName).join(', ') }}</span>
              </div>
            </div>

            <!-- User Season Summary -->
            <div class="offseason-summary">
              <div class="offseason-stat">
                <span class="offseason-stat-label">Final Record</span>
                <span class="offseason-stat-value offseason-record-row">
                  <span
                    class="offseason-team-badge"
                    :style="{ backgroundColor: team?.primary_color || '#E85A4F' }"
                  >{{ team?.abbreviation }}</span>
                  {{ userSeasonHistory ? `${userSeasonHistory.wins}-${userSeasonHistory.losses}` : `${wins}-${losses}` }}
                </span>
              </div>
              <div class="offseason-stat">
                <span class="offseason-stat-label">Conference Rank</span>
                <span class="offseason-stat-value">#{{ userSeasonHistory?.conferenceRank || teamRank }} {{ conferenceLabel }}</span>
              </div>
            </div>

            <!-- AI Transactions Summary -->
            <div v-if="aiTransactionSummary" class="offseason-transactions">
              <span class="offseason-transactions-text">
                League transactions: {{ aiTransactionSummary.reSignings }} re-signed, {{ aiTransactionSummary.freeAgentSignings }} FA signed{{ aiTransactionSummary.cuts > 0 ? `, ${aiTransactionSummary.cuts} released` : '' }}
              </span>
            </div>

            <!-- Released Players Warning -->
            <div v-if="releasedUserPlayers.length > 0" class="offseason-expiring">
              <div class="offseason-expiring-header">
                <AlertTriangle :size="16" class="offseason-expiring-icon" />
                <span class="offseason-expiring-title">Players Released</span>
              </div>
              <p class="offseason-expiring-hint">These players' contracts expired and they are now free agents. You can re-sign them from Free Agents in Manage Roster.</p>
              <div class="offseason-expiring-list">
                <div
                  v-for="player in releasedUserPlayers"
                  :key="player.id"
                  class="offseason-expiring-player"
                >
                  <span class="offseason-expiring-name">{{ player.name }}</span>
                  <span class="offseason-expiring-pos">{{ player.position }}</span>
                  <span class="offseason-expiring-ovr">{{ player.overallRating }} OVR</span>
                </div>
              </div>
            </div>

            <div class="next-game-buttons offseason-buttons">
              <button class="btn-simulate-game" @click="router.push(`/campaign/${campaignId}/team`)">
                <Users class="btn-icon" :size="16" />
                MANAGE ROSTER
              </button>
              <button v-if="!rookieDraftCompleted" class="btn-simulate-game" @click="router.push(`/campaign/${campaignId}/scouting`)">
                <Binoculars class="btn-icon" :size="16" />
                SCOUTING
              </button>
              <button v-if="!rookieDraftCompleted" class="btn-play-game" @click="router.push(`/campaign/${campaignId}/draft?mode=rookie`)">
                <Star class="btn-icon" :size="16" />
                BEGIN DRAFT
              </button>
              <button class="btn-simulate-game" @click="handleSimOffseason" :disabled="advancingToNextSeason">
                <FastForward class="btn-icon" :size="16" />
                SIM OFFSEASON
              </button>
              <button v-if="rookieDraftCompleted" class="btn-play-game" @click="handleStartNewSeason" :disabled="advancingToNextSeason">
                <FastForward class="btn-icon" :size="16" />
                START SEASON
              </button>
            </div>
          </template>
        </div>
      </section>

      <!-- Champion Card (champion declared, enter offseason) -->
      <section v-else-if="playoffStore.champion" class="next-game-card glass-card-nebula offseason-card">
        <div class="next-game-header">
          <div class="next-game-label-row">
            <h3 class="next-game-label">SEASON COMPLETE</h3>
            <Trophy :size="16" class="playoff-trophy-icon" />
          </div>
        </div>
        <div class="next-game-content">
          <div v-if="advancingToNextSeason" class="next-game-loading">
            <LoadingSpinner size="md" />
            <span class="next-game-loading-text">Processing offseason...</span>
          </div>
          <template v-else>
            <!-- Champion Banner -->
            <div class="offseason-champion-banner">
              <Trophy :size="20" class="offseason-champion-icon" />
              <span class="offseason-champion-text">
                {{ playoffStore.champion.city }} {{ playoffStore.champion.name }} are NBA Champions
              </span>
            </div>

            <!-- User Season Summary -->
            <div class="offseason-summary">
              <div class="offseason-stat">
                <span class="offseason-stat-label">Final Record</span>
                <span class="offseason-stat-value offseason-record-row">
                  <span
                    class="offseason-team-badge"
                    :style="{ backgroundColor: team?.primary_color || '#E85A4F' }"
                  >{{ team?.abbreviation }}</span>
                  {{ wins }}-{{ losses }}
                </span>
              </div>
              <div class="offseason-stat">
                <span class="offseason-stat-label">Conference Rank</span>
                <span class="offseason-stat-value">#{{ teamRank }} {{ conferenceLabel }}</span>
              </div>
            </div>

            <div class="next-game-buttons">
              <button class="btn-play-game" @click="handleEnterOffseason">
                <FastForward class="btn-icon" :size="16" />
                ENTER OFFSEASON
              </button>
            </div>
          </template>
        </div>
      </section>

      <!-- Season Wrap-Up Card (user has no more games, league still playing) -->
      <section v-else class="next-game-card glass-card-nebula">
        <div class="next-game-header">
          <h3 class="next-game-label">REGULAR SEASON COMPLETE</h3>
        </div>
        <div class="next-game-content">
          <div v-if="gameStore.simulating" class="next-game-loading">
            <LoadingSpinner size="md" />
            <span class="next-game-loading-text">Simulating...</span>
          </div>
          <template v-else>
            <p class="season-wrap-text">
              You've played all your regular season games. Finish the remaining league games to see final standings and enter the playoffs.
            </p>
            <div class="next-game-buttons">
              <button class="btn-play-game" @click="handleFinishSeason">
                <FastForward class="btn-icon" :size="16" />
                FINISH REGULAR SEASON
              </button>
            </div>
          </template>
        </div>
      </section>

      <!-- Background Simulation Progress Bar -->
      <section v-if="gameStore.backgroundSimulating" class="sim-progress-card glass-card-nebula">
        <div class="sim-progress-content">
          <span class="sim-progress-text">
            Simulating league games...
            <template v-if="gameStore.simulationProgress">
              {{ gameStore.simulationProgress.completed }}/{{ gameStore.simulationProgress.total }}
            </template>
          </span>
          <div class="sim-progress-bar">
            <div
              class="sim-progress-fill"
              :style="{
                width: gameStore.simulationProgress
                  ? `${(gameStore.simulationProgress.completed / gameStore.simulationProgress.total) * 100}%`
                  : '0%'
              }"
            ></div>
          </div>
        </div>
      </section>

      <!-- Quick Actions Card -->
      <section class="quick-actions-card glass-card-nebula">
        <h3 class="section-header">QUICK ACTIONS</h3>
        <div class="quick-actions-grid">
          <button class="action-box" @click="navigateToScout">
            <div class="action-icon">
              <Binoculars :size="24" />
            </div>
            <span class="action-label">Scout</span>
          </button>
          <button class="action-box" @click="navigateToRoster">
            <div class="action-icon">
              <Users :size="24" />
            </div>
            <span class="action-label">GM View</span>
          </button>
          <button v-if="playoffStore.isInPlayoffs" class="action-box playoffs" @click="router.push(`/campaign/${campaignId}/playoffs`)">
            <div class="action-icon">
              <Trophy :size="24" />
            </div>
            <span class="action-label">Bracket</span>
          </button>
          <button v-else class="action-box" @click="router.push(`/campaign/${campaignId}/league`)">
            <div class="action-icon">
              <TrendingUp :size="24" />
            </div>
            <span class="action-label">Standings</span>
          </button>
          <button class="action-box" @click="router.push(`/campaign/${campaignId}/team#schedule`)">
            <div class="action-icon">
              <Calendar :size="24" />
            </div>
            <span class="action-label">Schedule</span>
          </button>
        </div>
      </section>

      <!-- Featured Player Card - Cosmic gradient -->
      <section v-if="topPlayer" class="featured-player-card card-cosmic" @click="openPlayerDetails">
        <h3 class="section-header featured-header">FEATURED PLAYER</h3>
        <div class="player-content">
          <div class="player-avatar">
            <User class="avatar-icon" :size="36" />
          </div>
          <div class="player-info">
            <h4 class="player-name">{{ topPlayer.name }}</h4>
            <p class="player-position">{{ topPlayer.position }}</p>
          </div>
          <div class="player-rating">
            <span class="rating-badge">{{ topPlayer.overall_rating }}</span>
          </div>
        </div>
        <div class="player-stats">
          <div class="stat-item">
            <span class="stat-value">{{ topPlayerStats.ppg }}</span>
            <span class="stat-label">PPG</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ topPlayerStats.rpg }}</span>
            <span class="stat-label">RPG</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ topPlayerStats.apg }}</span>
            <span class="stat-label">APG</span>
          </div>
        </div>
      </section>

      <!-- News Feed Card -->
      <section class="news-card">
        <h3 class="section-header">LATEST NEWS</h3>
        <div v-if="news.length" class="news-list">
          <div
            v-for="item in news.slice(0, 5)"
            :key="item.id"
            class="news-item"
            :class="{
              'news-highlight': item.event_type === 'award' && item.headline?.includes('All-Star'),
              'news-breaking': item.is_breaking
            }"
            @click="item.event_type === 'award' && item.headline?.includes('All-Star') ? openAllStarModal() : null"
          >
            <div class="news-icon" :class="{ 'news-icon-star': item.event_type === 'award', 'news-icon-breaking': item.is_breaking }">
              <Zap v-if="item.is_breaking" :size="18" />
              <Star v-else-if="item.event_type === 'award'" :size="18" />
              <Newspaper v-else :size="18" />
            </div>
            <div class="news-content">
              <span v-if="item.is_breaking" class="news-breaking-tag">BREAKING</span>
              <p class="news-headline">{{ item.headline }}</p>
              <span class="news-date">{{ formatNewsDate(item.date) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="news-empty">
          <p>No news yet. Simulate some games to generate headlines!</p>
        </div>
      </section>
    </template>

    <!-- Simulate to Next Game Modal -->
    <SimulateConfirmModal
      :show="showSimulateModal"
      :preview="gameStore.simulatePreview"
      :loading="gameStore.loadingPreview"
      :simulating="gameStore.simulating"
      :user-team="team"
      :game-in-progress="isGameInProgress"
      :sim-season-mode="simSeasonMode"
      :remaining-season-games="remainingSeasonGames"
      :background-progress="gameStore.simulationProgress"
      @close="handleCloseSimulateModal"
      @confirm="handleConfirmSimulate"
      @sim-to-end="handleSimToEndFromModal"
      @sim-season="handleConfirmSimSeason"
    />

    <!-- Lineup Warning Modal -->
    <BaseModal
      :show="showLineupWarningModal"
      title="Incomplete Lineup"
      @close="handleCloseLineupWarning"
    >
      <div class="lineup-warning-content">
        <div class="warning-icon">
          <Users :size="48" />
        </div>
        <p class="warning-message">
          Your starting lineup is incomplete. You need 5 starters to play or simulate games.
        </p>
        <p class="warning-hint">
          Go to your roster to set your lineup before continuing.
        </p>
        <div class="warning-actions">
          <button class="btn-secondary" @click="handleCloseLineupWarning">Cancel</button>
          <button class="btn-primary" @click="goToRosterFromWarning">
            <Users :size="16" />
            Go to GM View
          </button>
        </div>
      </div>
    </BaseModal>

    <!-- Roster Warning Modal (minutes / injured starters) -->
    <BaseModal
      :show="showRosterWarningModal"
      title="Roster Issue"
      @close="showRosterWarningModal = false"
    >
      <div class="lineup-warning-content">
        <div class="warning-icon">
          <AlertTriangle :size="48" />
        </div>
        <p class="warning-message">{{ rosterWarningMessage }}</p>
        <p class="warning-hint">{{ rosterWarningHint }}</p>
        <div class="warning-actions">
          <button class="btn-secondary" @click="showRosterWarningModal = false">Cancel</button>
          <button class="btn-primary" @click="goToTeamTabFromWarning">
            <Users :size="16" />
            Go to Team Tab
          </button>
        </div>
      </div>
    </BaseModal>

    <!-- Season End Modal -->
    <SeasonEndModal
      :show="playoffStore.showSeasonEndModal"
      :user-status="playoffStore.userStatus"
      :user-team="team"
      :roster="roster"
      @close="playoffStore.closeSeasonEndModal()"
      @continue="handleSeasonEndContinue"
    />

    <!-- Series Result Modal -->
    <SeriesResultModal
      :show="playoffStore.showSeriesResultModal"
      :series-result="playoffStore.seriesResult"
      :user-team-id="team?.id"
      @close="handleSeriesResultClose"
    />

    <!-- Championship Modal -->
    <ChampionshipModal
      :show="playoffStore.showChampionshipModal"
      :series-result="playoffStore.seriesResult"
      :year="campaign?.current_season?.year"
      :user-team-id="team?.id"
      @close="handleChampionshipClose"
    />

    <!-- Trade Proposal Modal -->
    <TradeProposalModal
      :show="showTradeProposalModal"
      :proposal="currentProposal"
      @close="handleCloseProposalModal"
      @accept="handleAcceptProposal"
      @reject="handleRejectProposal"
    />

    <!-- All-Star Modal -->
    <AllStarModal
      :show="showAllStarModal"
      :rosters="allStarRosters"
      :user-team-id="team?.id"
      @close="handleCloseAllStarModal"
    />

    <!-- Weekly Summary Modal -->
    <WeeklySummaryModal
      :show="showWeeklySummaryModal"
      :summary-data="weeklySummary"
      @close="showWeeklySummaryModal = false; weeklySummary = null; gameStore.weeklySummaryData = null"
    />

    <!-- New Season Modal -->
    <NewSeasonModal
      :show="showNewSeasonModal"
      :season-year="newSeasonData?.seasonYear"
      :facilities-before="newSeasonData?.facilitiesBefore"
      :facilities-after="newSeasonData?.facilitiesAfter"
      @close="showNewSeasonModal = false; newSeasonData = null"
    />

    <!-- Injury Notification Modal -->
    <Teleport to="body">
      <Transition name="inj-modal">
        <div
          v-if="showInjuryModal"
          class="inj-overlay"
          @click.self="showInjuryModal = false"
        >
          <div class="inj-container">
            <!-- Header -->
            <header class="inj-header">
              <div class="inj-header-left">
                <div class="inj-header-icon">
                  <AlertTriangle :size="18" />
                </div>
                <h2 class="inj-title">Injury Report</h2>
              </div>
              <button class="inj-close" @click="showInjuryModal = false" aria-label="Close">
                <X :size="20" />
              </button>
            </header>

            <!-- Content -->
            <main class="inj-content">
              <div class="inj-list">
                <div
                  v-for="injury in injuredPlayers"
                  :key="injury.player_id"
                  class="inj-card"
                  :style="{ '--severity-color': getInjurySeverityColor(injury.severity) }"
                >
                  <div class="inj-severity-bar"></div>
                  <div class="inj-card-body">
                    <div class="inj-player-row">
                      <span class="inj-player-name">{{ injury.name }}</span>
                      <span class="inj-severity-tag">{{ injury.severity }}</span>
                    </div>
                    <div class="inj-detail-row">
                      <span class="inj-type">{{ injury.injury_type }}</span>
                      <span class="inj-duration">{{ injury.games_out }} {{ injury.games_out === 1 ? 'game' : 'games' }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <p class="inj-hint">Injured starters will be automatically benched. Update your lineup to set replacements.</p>
            </main>

            <!-- Footer -->
            <footer class="inj-footer">
              <button class="inj-btn-dismiss" @click="showInjuryModal = false">
                Dismiss
              </button>
              <button class="inj-btn-lineup" @click="goToLineup">
                <Users :size="16" />
                Update Lineup
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Recovery Notification Modal -->
    <Teleport to="body">
      <Transition name="inj-modal">
        <div
          v-if="showRecoveryModal"
          class="inj-overlay"
          @click.self="showRecoveryModal = false"
        >
          <div class="inj-container">
            <header class="inj-header">
              <div class="inj-header-left">
                <div class="rec-header-icon">
                  <Heart :size="18" />
                </div>
                <h2 class="inj-title">Recovery Report</h2>
              </div>
              <button class="inj-close" @click="showRecoveryModal = false" aria-label="Close">
                <X :size="20" />
              </button>
            </header>

            <main class="inj-content">
              <div class="inj-list">
                <div
                  v-for="recovery in recoveredPlayers"
                  :key="recovery.player_id"
                  class="inj-card"
                  :style="{ '--severity-color': '#22c55e' }"
                >
                  <div class="inj-severity-bar"></div>
                  <div class="inj-card-body">
                    <div class="inj-player-row">
                      <span class="inj-player-name">{{ recovery.name }}</span>
                      <span class="inj-severity-tag">Cleared</span>
                    </div>
                    <div class="inj-detail-row">
                      <span class="inj-type">{{ recovery.injury_type }}</span>
                      <span class="rec-status">Ready to play</span>
                    </div>
                  </div>
                </div>
              </div>

              <p class="inj-hint">These players are healthy and available for your lineup.</p>
            </main>

            <footer class="inj-footer">
              <button class="inj-btn-dismiss" @click="showRecoveryModal = false">
                Dismiss
              </button>
              <button class="inj-btn-lineup" @click="goToLineupFromRecovery">
                <Users :size="16" />
                Update Lineup
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Recent Games Ticker (shows on idle) -->
    <Teleport to="body">
      <Transition name="ticker-slide">
        <div v-if="showTicker && recentLeagueGames.length > 0" class="games-ticker">
          <div class="games-ticker-track">
            <div class="games-ticker-content">
              <template v-for="item in recentLeagueGames" :key="'a-' + item.key">
                <span v-if="item.type === 'date'" class="gt-date">{{ item.label }}</span>
                <span v-else class="games-ticker-item">
                  <span class="gt-abbr" :class="{ 'gt-user-win': item.userResult === 'win' && item.game.away_team_id === campaign?.teamId, 'gt-user-loss': item.userResult === 'loss' && item.game.away_team_id === campaign?.teamId }">{{ item.game.away_team_abbreviation }}</span>
                  <span class="gt-score" :class="{ 'gt-win': !item.homeWon && !item.game.is_user_game, 'gt-user-win': item.userResult === 'win' && item.game.away_team_id === campaign?.teamId, 'gt-user-loss': item.userResult === 'loss' && item.game.away_team_id === campaign?.teamId }">{{ item.game.away_score }}</span>
                  <span class="gt-at">@</span>
                  <span class="gt-abbr" :class="{ 'gt-user-win': item.userResult === 'win' && item.game.home_team_id === campaign?.teamId, 'gt-user-loss': item.userResult === 'loss' && item.game.home_team_id === campaign?.teamId }">{{ item.game.home_team_abbreviation }}</span>
                  <span class="gt-score" :class="{ 'gt-win': item.homeWon && !item.game.is_user_game, 'gt-user-win': item.userResult === 'win' && item.game.home_team_id === campaign?.teamId, 'gt-user-loss': item.userResult === 'loss' && item.game.home_team_id === campaign?.teamId }">{{ item.game.home_score }}</span>
                  <span class="gt-divider"></span>
                </span>
              </template>
            </div>
            <div class="games-ticker-content" aria-hidden="true">
              <template v-for="item in recentLeagueGames" :key="'b-' + item.key">
                <span v-if="item.type === 'date'" class="gt-date">{{ item.label }}</span>
                <span v-else class="games-ticker-item">
                  <span class="gt-abbr" :class="{ 'gt-user-win': item.userResult === 'win' && item.game.away_team_id === campaign?.teamId, 'gt-user-loss': item.userResult === 'loss' && item.game.away_team_id === campaign?.teamId }">{{ item.game.away_team_abbreviation }}</span>
                  <span class="gt-score" :class="{ 'gt-win': !item.homeWon && !item.game.is_user_game, 'gt-user-win': item.userResult === 'win' && item.game.away_team_id === campaign?.teamId, 'gt-user-loss': item.userResult === 'loss' && item.game.away_team_id === campaign?.teamId }">{{ item.game.away_score }}</span>
                  <span class="gt-at">@</span>
                  <span class="gt-abbr" :class="{ 'gt-user-win': item.userResult === 'win' && item.game.home_team_id === campaign?.teamId, 'gt-user-loss': item.userResult === 'loss' && item.game.home_team_id === campaign?.teamId }">{{ item.game.home_team_abbreviation }}</span>
                  <span class="gt-score" :class="{ 'gt-win': item.homeWon && !item.game.is_user_game, 'gt-user-win': item.userResult === 'win' && item.game.home_team_id === campaign?.teamId, 'gt-user-loss': item.userResult === 'loss' && item.game.home_team_id === campaign?.teamId }">{{ item.game.home_score }}</span>
                  <span class="gt-divider"></span>
                </span>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.campaign-home {
  padding: 8px 16px;
  padding-bottom: 100px;
  max-width: 1024px;
  margin: 0 auto;
}

.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
}

.loading-container :deep(.loading-spinner) {
  width: 64px;
  height: 64px;
}

@media (min-width: 768px) {
  .loading-container :deep(.loading-spinner) {
    width: 80px;
    height: 80px;
  }
}

/* Team Header */
.team-header {
  margin-bottom: 20px;
}

.team-header-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.team-logo-badge {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
  border: 4px solid var(--color-bg-tertiary);
  box-shadow: var(--shadow-md);
}

.team-header-text {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.team-city {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin: 0 0 2px 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.team-name {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2.25rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* Current Date - Hidden on mobile, shown on desktop */
.current-date {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  flex-shrink: 0;
}

@media (min-width: 1024px) {
  .current-date {
    display: flex;
  }
}

.date-day {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  line-height: 1;
  color: var(--color-primary);
}

.date-details {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.date-month {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.date-weekday {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}

/* Record Card */
.record-card {
  padding: 20px 24px;
  margin-bottom: 16px;
}

.record-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  z-index: 1;
}

.record-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.record-label {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1a1520;
}

.record-rank {
  font-size: 0.85rem;
  color: rgba(26, 21, 32, 0.7);
}

.record-right {
  text-align: right;
}

.record-value {
  font-size: 3rem;
  font-weight: 700;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: #1a1520;
  letter-spacing: -0.02em;
}

/* Record card token info */
.record-tokens {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(26, 21, 32, 0.1);
  position: relative;
  z-index: 1;
}

.record-tokens-icon {
  color: rgba(26, 21, 32, 0.45);
  flex-shrink: 0;
}

.tokens-score-container {
  position: relative;
  height: 1.1rem;
  overflow: hidden;
}

.tokens-score-slot {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
}

.record-tokens-value {
  font-size: 0.8rem;
  font-weight: 700;
  color: #1a1520;
  white-space: nowrap;
  line-height: 1.1rem;
}

/* Token slide animation (matches broadcast scoreboard) */
.token-slide-enter-active,
.token-slide-leave-active {
  transition: all 0.35s ease-out;
}

.token-slide-enter-from {
  opacity: 0;
  transform: translateY(100%);
}

.token-slide-leave-to {
  opacity: 0;
  transform: translateY(-100%);
  position: absolute;
}

.token-slide-leave-active {
  position: absolute;
  width: 100%;
}

.record-tokens-label {
  font-size: 0.72rem;
  font-weight: 500;
  color: rgba(26, 21, 32, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.shop-link {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(26, 21, 32, 0.5);
  text-decoration: none;
  border: 1px solid rgba(26, 21, 32, 0.12);
  border-radius: 6px;
  transition: all 0.15s ease;
}

.shop-link:hover {
  color: rgba(26, 21, 32, 0.8);
  border-color: rgba(26, 21, 32, 0.25);
}

/* Quick Actions Card */
.quick-actions-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 16px;
  margin-bottom: 16px;
}

.section-header {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin: 0 0 12px 0;
}

.quick-actions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

@media (min-width: 640px) {
  .quick-actions-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.action-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-box:hover {
  background: var(--color-bg-elevated);
  border-color: var(--color-primary);
  transform: translateY(-2px);
}

.action-box:active {
  transform: translateY(0);
}

.action-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(232, 90, 79, 0.1);
  border-radius: var(--radius-lg);
  color: var(--color-primary);
}

.action-icon :deep(svg) {
  stroke-width: 1.5;
}

.action-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.action-box:hover .action-label {
  color: var(--color-text-primary);
}

.action-box.playoffs .action-icon {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 140, 0, 0.15));
  color: #ffd700;
}

.action-box.playoffs .action-label {
  color: #ffd700;
}

.btn-loading {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Featured Player Card */
.featured-player-card {
  padding: 16px;
  margin-bottom: 16px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.featured-player-card:active {
  transform: scale(0.98);
}

.featured-header {
  color: rgba(26, 21, 32, 0.8);
  position: relative;
  z-index: 1;
}

.player-content {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}

.player-avatar {
  width: 60px;
  height: 60px;
  background: rgba(26, 21, 32, 0.15);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(26, 21, 32, 0.5);
  flex-shrink: 0;
}

.avatar-icon {
  width: 36px;
  height: 36px;
  stroke-width: 1.5;
}

.player-info {
  flex: 1;
  min-width: 0;
}

.player-name {
  font-size: 1.25rem;
  font-weight: 700;
  color: #1a1520;
  margin: 0;
}

.player-position {
  font-size: 0.9rem;
  color: rgba(26, 21, 32, 0.7);
  margin: 2px 0 0 0;
}

.player-rating {
  flex-shrink: 0;
}

.rating-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  height: 44px;
  padding: 0 12px;
  background: rgba(26, 21, 32, 0.85);
  border-radius: var(--radius-lg);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 1.2rem;
  font-weight: 700;
  color: white;
}

.player-stats {
  display: flex;
  gap: 24px;
  position: relative;
  z-index: 1;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: #1a1520;
}

.stat-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: rgba(26, 21, 32, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* News Card */
.news-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 16px;
  margin-bottom: 16px;
}

.news-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.news-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-lg);
  transition: background 0.2s ease;
}

.news-item:hover {
  background: var(--color-bg-elevated);
}

.news-icon {
  width: 32px;
  height: 32px;
  background: var(--color-primary);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.news-icon :deep(svg) {
  width: 18px;
  height: 18px;
  color: white;
}

.news-content {
  flex: 1;
  min-width: 0;
}

.news-headline {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-text-primary);
  margin: 0 0 4px 0;
  line-height: 1.4;
}

.news-date {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

.news-empty {
  padding: 24px 16px;
  text-align: center;
}

.news-empty p {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  margin: 0;
}

.news-highlight {
  border-left: 3px solid #f59e0b;
  background: linear-gradient(90deg, rgba(245, 158, 11, 0.08), transparent) !important;
  cursor: pointer;
}

.news-highlight:hover {
  background: linear-gradient(90deg, rgba(245, 158, 11, 0.15), transparent) !important;
}

.news-icon-star {
  background: linear-gradient(135deg, #f59e0b, #d97706) !important;
}

.news-breaking {
  border-left: 3px solid #eab308;
  background: linear-gradient(90deg, rgba(234, 179, 8, 0.1), rgba(234, 179, 8, 0.02), transparent) !important;
}

.news-breaking:hover {
  background: linear-gradient(90deg, rgba(234, 179, 8, 0.18), rgba(234, 179, 8, 0.05), transparent) !important;
}

.news-icon-breaking {
  background: linear-gradient(135deg, #eab308, #ca8a04) !important;
}

.news-breaking-tag {
  display: inline-block;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #eab308;
  background: rgba(234, 179, 8, 0.15);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  margin-bottom: 2px;
}

/* Glass Card with Nebula Effect */
.glass-card-nebula {
  position: relative;
  overflow: hidden;
}

.glass-card-nebula::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.05) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

/* Inverted nebula for light mode */
[data-theme="light"] .glass-card-nebula::before {
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.08) 0%, transparent 40%);
}

.glass-card-nebula > * {
  position: relative;
  z-index: 1;
}

/* Next Game Card */
.next-game-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 16px;
  margin-bottom: 16px;
}

.next-game-card.in-progress {
  border-color: rgba(34, 197, 94, 0.4);
  box-shadow: 0 0 20px rgba(34, 197, 94, 0.1);
}

.next-game-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.next-game-label-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.next-game-label {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.75rem;
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  color: var(--color-text-primary);
  margin: 0;
  line-height: 1;
}

.next-game-label.live {
  color: #22c55e;
  animation: pulse-live 2s ease-in-out infinite;
}

@keyframes pulse-live {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.live-quarter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(34, 197, 94, 0.4);
  border-radius: var(--radius-full);
  font-size: 0.8rem;
  font-weight: 700;
  color: #22c55e;
  letter-spacing: 0.05em;
}

.next-game-date {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.next-game-label-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.last-result-tag {
  padding: 4px 14px;
  border-radius: var(--radius-md);
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.025em;
  line-height: 1;
}

.last-result-tag.win {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.last-result-tag.loss {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.next-game-location {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-primary);
  padding: 4px 10px;
  background: rgba(232, 90, 79, 0.15);
  border-radius: var(--radius-full);
}

.playoff-info-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(255, 215, 0, 0.08);
  border: 1px solid rgba(255, 215, 0, 0.2);
  border-radius: var(--radius-md);
  margin-bottom: 4px;
}

.playoff-info-icon {
  color: #ffd700;
  flex-shrink: 0;
}

.playoff-round-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #ffd700;
}

.playoff-series-record {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.next-game-card.is-playoff {
  border-color: rgba(255, 215, 0, 0.2);
}

.next-game-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.offseason-transactions {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.offseason-transactions-text {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

[data-theme="light"] .offseason-transactions {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.06);
}

.offseason-awards {
  padding: 10px 12px;
  background: rgba(255, 200, 50, 0.06);
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 200, 50, 0.15);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.offseason-award-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.offseason-award-icon {
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.offseason-award-icon.gold {
  color: #F59E0B;
}

.offseason-award-text {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.offseason-award-text strong {
  color: var(--color-text-primary);
  font-weight: 600;
}

[data-theme="light"] .offseason-awards {
  background: rgba(255, 200, 50, 0.08);
  border-color: rgba(200, 150, 0, 0.2);
}

.offseason-expiring {
  padding: 12px;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.2);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.offseason-expiring-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.offseason-expiring-icon {
  color: #fbbf24;
  flex-shrink: 0;
}

.offseason-expiring-title {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-primary);
}

.offseason-expiring-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  margin: 0;
}

.offseason-expiring-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.offseason-expiring-player {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: var(--radius-sm);
}

[data-theme="light"] .offseason-expiring-player {
  background: rgba(0, 0, 0, 0.04);
}

.offseason-expiring-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-primary);
  flex: 1;
}

.offseason-expiring-pos {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.offseason-expiring-ovr {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text-secondary);
}

.next-game-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 0;
}

.season-wrap-text {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-bottom: 16px;
}

.playoff-trophy-icon {
  color: #ffd700;
}

.playoff-between-rounds {
  border-color: rgba(255, 215, 0, 0.25);
}

.offseason-card {
  border-color: rgba(255, 215, 0, 0.25);
}

.offseason-champion-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.12), rgba(255, 140, 0, 0.08));
  border: 1px solid rgba(255, 215, 0, 0.25);
  border-radius: var(--radius-lg);
}

.offseason-champion-icon {
  color: #ffd700;
  flex-shrink: 0;
}

.offseason-champion-text {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.offseason-summary {
  display: flex;
  gap: 16px;
}

.offseason-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: var(--radius-md);
}

[data-theme="light"] .offseason-stat {
  background: rgba(0, 0, 0, 0.04);
}

.offseason-stat-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
}

.offseason-stat-value {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  line-height: 1;
}

.offseason-record-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.offseason-team-badge {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-body, sans-serif);
  font-size: 0.55rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.next-game-loading-text {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.next-game-matchup {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.matchup-team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.team-badge-game {
  width: 124px;
  height: 124px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: white;
  box-shadow: var(--shadow-md);
  border: 3px solid var(--color-bg-tertiary);
}

.badge-abbr {
  font-size: 1.3rem;
  font-weight: 700;
  line-height: 1;
}

.badge-record {
  font-size: 0.85rem;
  font-weight: 600;
  opacity: 0.9;
  line-height: 1;
}

.badge-score {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1;
}

.team-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.team-abbr {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-transform: uppercase;
}

.team-rating {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
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

.matchup-vs {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.vs-text {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  color: var(--color-text-tertiary);
}

.next-game-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn-play-game {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-xl);
  color: white;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-play-game:hover:not(:disabled) {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.btn-play-game:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-play-game .btn-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2.5;
  fill: currentColor;
}

.btn-play-game.continue {
  background: #22c55e;
  animation: pulse-continue 2s ease-in-out infinite;
}

.btn-play-game.continue:hover {
  background: #16a34a;
}

@keyframes pulse-continue {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
}

.btn-simulate-game {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-primary);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-simulate-game:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--color-text-secondary);
}

.btn-simulate-game:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-simulate-game .btn-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

[data-theme="light"] .btn-simulate-game:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.03);
}

.btn-sim-season {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-radius: var(--radius-xl);
  color: var(--color-primary);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-sim-season:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  border-color: var(--color-primary);
}

.btn-sim-season .btn-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

.btn-box-score {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-primary);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-box-score:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: var(--color-text-secondary);
  transform: translateY(-1px);
}

.btn-box-score .btn-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

/* Cosmic card styles */
.card-cosmic {
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
}

.card-cosmic::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 10% 20%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 30% 60%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 50% 10%, rgba(255,255,255,0.4), transparent),
    radial-gradient(1px 1px at 70% 40%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 90% 70%, rgba(255,255,255,0.4), transparent),
    radial-gradient(1px 1px at 20% 90%, rgba(255,255,255,0.2), transparent),
    radial-gradient(1px 1px at 80% 85%, rgba(255,255,255,0.3), transparent);
  pointer-events: none;
}

/* Lineup Warning Modal */
.lineup-warning-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 8px 0 16px;
}

.warning-icon {
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(232, 90, 79, 0.15);
  border-radius: 50%;
  color: var(--color-primary);
  margin-bottom: 16px;
}

.warning-message {
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-primary);
  margin: 0 0 8px 0;
  line-height: 1.5;
}

.warning-hint {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin: 0 0 24px 0;
}

.warning-actions {
  display: flex;
  gap: 12px;
  width: 100%;
}

.warning-actions .btn-secondary {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.warning-actions .btn-secondary:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.warning-actions .btn-primary {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-xl);
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.warning-actions .btn-primary:hover {
  background: var(--color-primary-dark);
}

/* Background Simulation Progress */
.sim-progress-card {
  background: var(--glass-bg);
  border: 1px solid rgba(232, 90, 79, 0.3);
  border-radius: var(--radius-2xl);
  padding: 14px 16px;
  margin-bottom: 16px;
}

.sim-progress-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  z-index: 1;
}

.sim-progress-text {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sim-progress-bar {
  width: 100%;
  height: 6px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.sim-progress-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: var(--radius-full);
  transition: width 0.5s ease;
  min-width: 2%;
}

/* Desktop adjustments */
@media (min-width: 1024px) {
  .campaign-home {
    padding: 24px 24px;
    padding-bottom: 32px;
  }

  .next-game-buttons {
    flex-direction: row;
  }

  .btn-play-game,
  .btn-simulate-game,
  .btn-sim-season,
  .btn-box-score {
    flex: 1;
  }

  .team-logo-badge {
    width: 88px;
    height: 88px;
    font-size: 1.5rem;
  }

  .team-name {
    font-size: 3rem;
  }

  .team-city {
    font-size: 1rem;
  }

  .date-day {
    font-size: 2.5rem;
  }

  .date-month {
    font-size: 0.85rem;
  }

  .date-weekday {
    font-size: 0.75rem;
  }

  .team-badge-game {
    width: 100px;
    height: 100px;
  }

  .badge-abbr {
    font-size: 1.5rem;
  }

  .badge-record {
    font-size: 0.9rem;
  }

  .next-game-matchup {
    gap: 40px;
  }

  .vs-text {
    font-size: 2rem;
  }

  .next-game-label {
    font-size: 1.75rem;
  }

  .next-game-date {
    font-size: 1.1rem;
  }

  .team-abbr {
    font-size: 1rem;
  }

  .team-rating {
    font-size: 0.8rem;
  }
}

/* Injury Modal */
.inj-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.inj-container {
  width: 100%;
  max-width: 420px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.inj-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.inj-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.inj-header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-lg);
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.inj-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.inj-close {
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

.inj-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.inj-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.inj-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.inj-card {
  display: flex;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.inj-severity-bar {
  width: 4px;
  flex-shrink: 0;
  background: var(--severity-color, #fbbf24);
}

.inj-card-body {
  flex: 1;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.inj-player-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.inj-player-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.inj-severity-tag {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--severity-color, #fbbf24) 15%, transparent);
  color: var(--severity-color, #fbbf24);
}

.inj-detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.inj-type {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-transform: capitalize;
}

.inj-duration {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--severity-color, #fbbf24);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

.inj-hint {
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
  text-align: center;
  margin: 16px 0 0;
  line-height: 1.4;
}

.inj-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.inj-btn-dismiss,
.inj-btn-lineup {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.inj-btn-dismiss {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.inj-btn-dismiss:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

.inj-btn-lineup {
  background: var(--color-primary);
  border: none;
  color: white;
}

.inj-btn-lineup:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

/* Injury modal transition */
.inj-modal-enter-active {
  transition: opacity 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.inj-modal-leave-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.inj-modal-enter-from,
.inj-modal-leave-to {
  opacity: 0;
}

.inj-modal-enter-active .inj-container {
  animation: injScaleIn 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.inj-modal-leave-active .inj-container {
  animation: injScaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes injScaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes injScaleOut {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.95); }
}

.rec-header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-lg);
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.rec-status {
  font-size: 0.8rem;
  font-weight: 600;
  color: #22c55e;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

/* ---- Recent Games Ticker ---- */
.games-ticker {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 35;
  overflow: hidden;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--glass-border);
  height: 32px;
}

@media (max-width: 1023px) {
  .games-ticker {
    bottom: 70px; /* above BottomNav on mobile */
  }
}

.games-ticker-track {
  display: flex;
  width: max-content;
  animation: games-marquee 120s linear infinite;
}

.games-ticker-content {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 8px;
}

.games-ticker-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 0;
  white-space: nowrap;
}

/* Winning score in green for all games */
.gt-win {
  color: #22c55e;
}

/* User team: green for wins, red for losses (abbr + score) */
.gt-user-win {
  color: #22c55e;
  font-weight: 700;
}

.gt-user-loss {
  color: #ef4444;
  font-weight: 700;
}

.gt-date {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-right: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}

.gt-abbr {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.gt-score {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  min-width: 18px;
  text-align: center;
}

.gt-at {
  font-size: 0.6rem;
  color: var(--color-text-tertiary);
}

.gt-divider {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  margin: 0 20px;
  flex-shrink: 0;
}

@keyframes games-marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

/* Ticker slide transitions */
.ticker-slide-enter-active,
.ticker-slide-leave-active {
  transition: transform 0.35s ease-out, opacity 0.35s ease-out;
}

/* Pause marquee during slide in/out */
.ticker-slide-enter-active .games-ticker-track,
.ticker-slide-leave-active .games-ticker-track {
  animation-play-state: paused;
}

/* Slide from bottom */
.ticker-slide-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

.ticker-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

</style>
