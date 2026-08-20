<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useAudioStore } from '@/stores/audio'
import { useCampaignStore } from '@/stores/campaign'
import { useLeagueStore } from '@/stores/league'
import { useTeamStore } from '@/stores/team'
import { useToastStore } from '@/stores/toast'
import { usePlayoffStore } from '@/stores/playoff'
import { useWalkthroughStore } from '@/stores/walkthrough'
import WalkthroughReplayButton from '@/components/walkthrough/WalkthroughReplayButton.vue'
import { GlassCard, BaseButton, LoadingSpinner, StatBadge, BaseModal } from '@/components/ui'
import { User, Users, Play, Pause, ArrowUpDown, ArrowLeft, ChevronRight, ChevronDown, TrendingUp, TrendingDown, AlertTriangle, Flame, Snowflake, Heart, Activity, Newspaper, Coins, Trophy, Zap, FastForward, X, Volume2, VolumeX } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import CoachAvatar from '@/components/common/CoachAvatar.vue'
import TeamOverallBadge from '@/components/common/TeamOverallBadge.vue'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { computeTeamOverall } from '@/utils/teamOverall'
import { coachingEngine } from '@/engine/simulation/CoachingEngine'
import { QUARTER_LENGTH_MINUTES } from '@/engine/config/GameConfig'
import { t, tDynamic, dateLocale } from '@wl-i18n/i18n.js'
import BasketballCourt from '@/components/game/BasketballCourt.vue'
import BoxScore from '@/components/game/BoxScore.vue'
import PlayAnalyticsPanel from '@/components/analytics/PlayAnalyticsPanel.vue'
import DefensiveMatchupEditor from '@/components/game/DefensiveMatchupEditor.vue'
import { SimulateConfirmModal, EvolutionSummary, MomentumRail, CoachOverview } from '@/components/game'
import { usePlayAnimation } from '@/composables/usePlayAnimation'
import { usePositionValidation } from '@/composables/usePositionValidation'
import { useBadgeSynergies } from '@/composables/useBadgeSynergies'

const route = useRoute()
const router = useRouter()
const gameStore = useGameStore()
const audioStore = useAudioStore()
const campaignStore = useCampaignStore()
const leagueStore = useLeagueStore()
const teamStore = useTeamStore()
const toastStore = useToastStore()
const playoffStore = usePlayoffStore()
const walkthroughStore = useWalkthroughStore()
const { loadSynergies, getActivatedBadges, getHypotheticalActivations, getLineupSynergyCount } = useBadgeSynergies()

// Animation composable
const {
  animationData,
  currentPossessionIndex,
  currentKeyframeIndex,
  currentKeyframe,
  currentPossession,
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
  isSegmentPause,
  pendingBreakInfo,
  currentHomeScore,
  currentAwayScore,
  currentHomeMomentum,
  currentAwayMomentum,
  currentBoxScore,
  currentActivatedBadges,
  currentActivatedSynergies,
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
  setDisplayedScores,
  resetMomentumDisplay,
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

// Pre-game snapshots of the team records, captured the moment we enter the
// live broadcast flow. Once Q4 sims, the store updates standings (regular
// season W/L) and the playoff bracket (series wins) BEFORE the canvas plays
// the final quarter — so reading the live records during animation would
// reveal the outcome ("2-0 → 3-0" the moment Q4 begins to sim). The broadcast
// header reads from these frozen refs instead, falling back to the live
// computeds when no snapshot exists (e.g. opening a long-completed game).
const frozenAwayTeamRecord = ref(null)
const frozenHomeTeamRecord = ref(null)
const frozenAwaySeriesRecord = ref(null)
const frozenHomeSeriesRecord = ref(null)

function snapshotTeamRecords() {
  frozenAwayTeamRecord.value = awayTeamRecord.value
  frozenHomeTeamRecord.value = homeTeamRecord.value
  frozenAwaySeriesRecord.value = awaySeriesRecord.value
  frozenHomeSeriesRecord.value = homeSeriesRecord.value
}
const gameJustCompleted = ref(false)  // True when final quarter just finished

// Second contextual notification-permission ask (the first is at training
// start): the user just finished a game — a natural payoff moment to offer
// reminders. One-shot per device inside the service; short delay so the OS
// prompt doesn't collide with the final-buzzer overlay landing. Covers all
// three completion paths (resume-complete, final quarter, sim-to-end) since
// they all flip this ref.
watch(gameJustCompleted, (done) => {
  if (!done) return
  setTimeout(() => {
    import('@/services/notifications')
      .then(n => n.maybeAskPermissionAfterGame())
      .catch(() => {})
  }, 2000)
})

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

// Injury notification modal state
const showInjuryModal = ref(false)
const injuredPlayers = ref([])
const showRecoveryModal = ref(false)
const recoveredPlayers = ref([])

// Surface players returning from injury. Date-advance ticks clear injuries
// silently, so the game store queues the user's recovered players; once the sim
// settles we show the Recovery Report (mirror of the injury modal) and drain it.
function flushPendingRecoveries() {
  const list = gameStore.pendingRecoveries
  if (!Array.isArray(list) || list.length === 0) return
  if (gameStore.simulating || gameStore.backgroundSimulating) return
  recoveredPlayers.value = list.slice()
  gameStore.pendingRecoveries = []
  if (showInjuryModal.value) {
    setTimeout(() => { showRecoveryModal.value = true }, 500)
  } else {
    showRecoveryModal.value = true
  }
}
watch(
  () => [gameStore.pendingRecoveries.length, gameStore.simulating, gameStore.backgroundSimulating],
  flushPendingRecoveries
)

// Coaching style selections for quarter breaks
const selectedOffense = ref('balanced')
const selectedDefense = ref('man')

// Pacing mode for played games: 'quarter' (animate a quarter at a time,
// legacy), 'play' (pause after every possession), 'deadBall' (pause at
// natural breaks in the action: fouls, out of bounds, violations). Chosen
// pre-game; for an in-progress game a new selection is applied on resume
// (rides the adjustments into the engine's applyAdjustments).
const PACING_STORAGE_KEY = 'bball_pacing_mode'
const pacingModes = [
  { value: 'quarter', label: 'By Quarter' },
  { value: 'play', label: 'Every Play' },
  { value: 'deadBall', label: 'Dead Balls' },
]
// Dead Balls is the default pacing — users who explicitly picked a mode keep
// their stored choice.
const selectedPacing = ref(localStorage.getItem(PACING_STORAGE_KEY) || 'deadBall')
watch(selectedPacing, (mode) => {
  try { localStorage.setItem(PACING_STORAGE_KEY, mode) } catch { /* private mode */ }
})

// Break metadata from the engine for the currently loaded segment (null in
// legacy quarter pacing). Drives the segment break bar: reason copy, timeout
// availability, subs gating, and foul-out prompts.
const currentBreakInfo = ref(null)
// User armed a timeout — mid-play it fires automatically at the next eligible
// dead ball; at an eligible dead ball it fires immediately.
const timeoutRequested = ref(false)
// The timeout sequence is up: players slide to the sidelines and the court
// shows the 30s TIMEOUT countdown. Play auto-resumes on expiry or Skip.
const timeoutActive = ref(false)
// A timeout was taken this break — send call_timeout with the next Continue
// so the engine burns it (momentum reset + lineup breather).
const pendingTimeoutCall = ref(false)
// Timeout clock — owned here (not the court) so both the canvas bubble and
// the coaches overlay can show it. Ticks while timeoutActive; auto-resumes
// play at 0.
const TIMEOUT_SECONDS = 30
const timeoutSecondsLeft = ref(TIMEOUT_SECONDS)
let timeoutTimer = null
// The coaches overlay: subs / coach settings / matchups over the court canvas,
// openable any time during a live game. Edits ride the next Continue.
const showCoachesOverlay = ref(false)
// Which overlay tab is showing: 'settings' | 'matchups' | 'subs'.
const coachesTab = ref('settings')
// A scheme/matchup/lineup edit was made from the overlay while the ball was
// LIVE — drives the footer note that it applies at the next break. Cleared
// when the next Continue ships the adjustments to the engine.
const liveEditsPending = ref(false)
// User defensive matchup overrides ({ opponentOffId: userDefId }). The pregame
// editor lives in its own always-expanded card; the coaches overlay hosts the
// compact instance on its Matchups tab.
const defensiveMatchups = ref({})

// Local lineup for quarter-break adjustments (synced from teamStore)
// During pre-game: synced from teamStore.lineup
// During game: used for quarter-break substitutions
const localLineup = ref([null, null, null, null, null])
const positionLabels = ['PG', 'SG', 'SF', 'PF', 'C']

// Alias for backwards compatibility with existing code
const selectedLineup = localLineup

// Expanded swap dropdown state for the coaches overlay Subs tab
const expandedSwapPlayer = ref(null)
// Contextual dropdown under the pre-game court-card Substitutions button —
// the pre-game flow opens an inline panel (unrelated to the coaches overlay).
const showSubsDropdown = ref(false)

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

// Live team-overall for both sides (avg OVR of healthy, non-FA, non-retired
// players). Drives the small badge that overlays each team logo in the
// pre-game header AND the broadcast scoreboard.
const homeTeamOverall = ref(null)
const awayTeamOverall = ref(null)
const _gameCampaignId = computed(() => route.params.id)
watch(
  () => [_gameCampaignId.value, homeTeam.value?.id, awayTeam.value?.id],
  async ([cid, hid, aid]) => {
    homeTeamOverall.value = null
    awayTeamOverall.value = null
    if (!cid) return
    try {
      if (hid) {
        const players = await PlayerRepository.getByTeam(cid, hid)
        homeTeamOverall.value = computeTeamOverall(players)
      }
      if (aid) {
        const players = await PlayerRepository.getByTeam(cid, aid)
        awayTeamOverall.value = computeTeamOverall(players)
      }
    } catch {
      // leave overalls null on failure — badge just won't render
    }
  },
  { immediate: true }
)
const isComplete = computed(() => game.value?.is_complete)
const isInProgress = computed(() => game.value?.is_in_progress)
const savedQuarter = computed(() => game.value?.current_quarter)

// For an in-progress game, reflect the pacing mode the game is actually
// saved with (rather than the localStorage default) until the user picks a
// new one — a new pick is applied by the engine on resume.
watch(
  () => game.value?.saved_pacing_mode,
  (saved) => {
    if (saved && isInProgress.value && pacingModes.some(m => m.value === saved)) {
      selectedPacing.value = saved
    }
  },
  { immediate: true }
)
const isUserGame = computed(() => game.value?.is_user_game)

// Replay key for the walkthrough "?" button. During the live broadcast the
// gameLive tour is replayable (the activeKey watcher pauses/resumes the
// animation around it); replay-mode animation of finished games stays
// tour-less; otherwise it's the preview/recap tour per game state.
const replayTourKey = computed(() => {
  if (!isUserGame.value) return null
  if (isLiveMode.value) return 'gameLive'
  if (showAnimationMode.value) return null
  return isComplete.value ? 'gameRecap' : 'gamePreview'
})

const evolutionData = computed(() => game.value?.evolution)
const gameNews = computed(() => game.value?.news || [])
const rewardsData = computed(() => game.value?.rewards)

// Playoff series info for display
const playoffSeriesInfo = computed(() => {
  if (!game.value?.is_playoff || !game.value?.playoff_series_id) return null
  const series = playoffStore.getSeriesFromBracket(game.value.playoff_series_id)
  if (!series) return null
  const gameNum = game.value.playoff_game_number
  const label = gameNum
    ? t('Game {n} — Series {a}-{b}', { n: gameNum, a: series.team1Wins, b: series.team2Wins })
    : t('Series {a}-{b}', { a: series.team1Wins, b: series.team2Wins })
  return { ...series, label }
})

// Per-team series record (wins-losses from that team's POV). The series stores
// team1Wins/team2Wins where team1 is the higher seed. We map back to home/away
// using whichever side matches each team's id.
function teamSeriesRecord(teamId) {
  const series = playoffSeriesInfo.value
  if (!series || teamId == null) return ''
  const isTeam1 = String(series.team1?.teamId) === String(teamId)
  const isTeam2 = String(series.team2?.teamId) === String(teamId)
  if (!isTeam1 && !isTeam2) return ''
  return isTeam1
    ? `${series.team1Wins}-${series.team2Wins}`
    : `${series.team2Wins}-${series.team1Wins}`
}

const homeSeriesRecord = computed(() => teamSeriesRecord(homeTeam.value?.id))
const awaySeriesRecord = computed(() => teamSeriesRecord(awayTeam.value?.id))

// Round label for the broadcast header banner.
const playoffRoundLabel = computed(() => {
  if (!game.value?.is_playoff) return ''
  return playoffStore.getPlayoffRoundLabel(game.value.playoff_round)
})

// Scores: while the live animation flow is active (a quarter just simulated,
// the canvas is about to or is currently rendering possessions, or we're at a
// quarter break) we always use the animation composable's running score.
//
// The store flips `game.home_score` / `game.away_score` to the post-simulated
// values inside `gameStore.continueGame` BEFORE the next quarter's animation
// loads, so reading those fields directly causes the score in the header /
// quarter-break modal to flash the post-quarter result for one frame before
// the canvas catches up. Falling back to `currentHomeScore` (which the
// composable holds at the previous quarter's end until the new animation data
// is loaded with explicit starting scores) avoids that spoiler.
//
// Once we're firmly out of animation mode (postgame view, simToEnd skipped
// animation entirely, or the user navigated to a finished game), `is_complete`
// is the right fallback so the box-score header reads the persisted final.
const displayHomeScore = computed(() => {
  if (showAnimationMode.value || isLiveMode.value) return currentHomeScore.value
  // For both completed AND in-progress games (e.g. user finished Q1 then
  // navigated back to the preview), the persisted schedule entry's score is
  // the source of truth. The animation composable resets to 0 on remount.
  if (game.value?.is_complete || game.value?.is_in_progress) {
    return game.value.home_score ?? currentHomeScore.value
  }
  return currentHomeScore.value
})
const displayAwayScore = computed(() => {
  if (showAnimationMode.value || isLiveMode.value) return currentAwayScore.value
  if (game.value?.is_complete || game.value?.is_in_progress) {
    return game.value.away_score ?? currentAwayScore.value
  }
  return currentAwayScore.value
})

// Determine if user is home or away
const userIsHome = computed(() =>
  userTeam.value?.id === homeTeam.value?.id
)

// Analytics gating (analyst tier AND analytics facility) + per-play data.
// Tier 3 → own-team postgame analytics; tier 4 → also pregame opponent
// analytics. Each perk additionally requires the Analytics facility to reach
// the requiredLevel STORED on the hired analyst's perks (analysts hired before
// facility gating carry requiredLevel 1 → grandfathered until re-hired).
const analystTier = computed(() => campaign.value?.settings?.analyst?.tier ?? 0)
const analyticsFacilityLevel = computed(() => userTeam.value?.facilities?.analytics ?? 1)
function analystPerkUnlocked(key) {
  const perk = campaign.value?.settings?.analyst?.perks?.find((p) => p.key === key)
  if (!perk) return false
  return analyticsFacilityLevel.value >= (perk.requiredLevel ?? 1)
}
const postgameAnalyticsUnlocked = computed(
  () => analystTier.value >= 3 && analystPerkUnlocked('postgame_analytics')
)
const opponentAnalyticsUnlocked = computed(
  () => analystTier.value >= 4 && analystPerkUnlocked('opponent_analytics')
)
// Locked-message for the postgame panel: name the missing piece. t() at
// computed-time keeps these extractor-tracked; the panel's $tDynamic passes
// the already-translated text through unchanged.
const postgameLockedMessage = computed(() =>
  analystTier.value < 3
    ? t("Hire a 3-Star Analyst (Team → GM → Facilities → Analytics) to unlock your team's per-play analytics.")
    : t("Upgrade your Analytics Facility (Team → GM → Facilities) to unlock your team's per-play analytics.")
)
// Locked-message for the pregame opponent-tendencies panel (4-star gate).
const opponentLockedMessage = computed(() =>
  analystTier.value < 4
    ? t('Hire a 4-Star Analyst (Team → GM → Facilities → Analytics) to scout opponent tendencies.')
    : t('Upgrade your Analytics Facility (Team → GM → Facilities) to scout opponent tendencies.')
)
// Postgame: THIS game's per-play analytics for the user's team (persisted per
// game as { home, away } raw maps; wrap as { plays } for the panel).
const userGameAnalytics = computed(() => {
  const src = game.value?.play_analytics
  if (!src) return null
  const side = userIsHome.value ? src.home : src.away
  return side && Object.keys(side).length ? { plays: side } : null
})
// Pregame: opponent's SEASON tendencies (season aggregate on the team object).
const opponentAnalytics = computed(() =>
  (userIsHome.value ? awayTeam.value : homeTeam.value)?.playAnalytics ?? null
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

// Roster-fit % for a single coaching scheme, shown inside each strategy
// pill so the user can pick the best fit for their team at a glance.
// Calls the same engine functions teamStore.fetchCoachingSchemes uses, so
// the values here exactly match the Fit % displayed on the GM view's
// coaching subtab.
function fitFor(scheme) {
  const roster = userRoster.value
  if (!roster?.length) return 0
  const isOffense = offensiveStyles.some(s => s.value === scheme)
  const eff = isOffense
    ? coachingEngine.calculateSchemeEffectiveness(scheme, roster)
    : coachingEngine.calculateDefensiveSchemeEffectiveness(scheme, roster)
  return Math.round(eff)
}

// Coach for each side. Prefer the coach embedded on the game's team payload
// if present; otherwise fall back to teamStore.coach for the user-controlled
// side (the only one we have a guaranteed local copy of). Returns null when
// neither source has data — coach card is rendered with v-if to hide cleanly.
const awayTeamCoach = computed(() => {
  return awayTeam.value?.coach || (!userIsHome.value ? teamStore.coach : null)
})
const homeTeamCoach = computed(() => {
  return homeTeam.value?.coach || (userIsHome.value ? teamStore.coach : null)
})

// Top 2 coach badges sorted hof → gold → silver → bronze so the visible
// chips inside the coach card are the most impressive ones the coach owns.
const COACH_BADGE_RANK = { hof: 4, gold: 3, silver: 2, bronze: 1 }
function topCoachBadges(coach, limit = 2) {
  if (!coach?.badges?.length) return []
  return [...coach.badges]
    .sort((a, b) => (COACH_BADGE_RANK[b.level] || 0) - (COACH_BADGE_RANK[a.level] || 0))
    .slice(0, limit)
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

// Fantasy-style impact score used to pick the "top player" for the
// quarter-break readout. Weighted to match the rough shape of a per-game
// dominance score so a 5-block performance reads as elite even with
// modest scoring.
function impactScore(p) {
  if (!p) return 0
  const pts = Number(p.points) || 0
  const reb = Number(p.rebounds) || 0
  const ast = Number(p.assists) || 0
  const stl = Number(p.steals) || 0
  const blk = Number(p.blocks) || 0
  const to  = Number(p.turnovers) || 0
  return pts + reb * 1.2 + ast * 1.5 + stl * 2 + blk * 2 - to * 0.5
}

function pickTopPlayer(players) {
  if (!Array.isArray(players) || players.length === 0) return null
  // Require at least a point or board played — silences the "no stats yet"
  // edge case at game start where every player is a tied zero.
  const ranked = [...players]
    .filter(p => (Number(p.points) || 0) + (Number(p.rebounds) || 0) + (Number(p.assists) || 0) + (Number(p.steals) || 0) + (Number(p.blocks) || 0) > 0)
    .sort((a, b) => impactScore(b) - impactScore(a))
  return ranked[0] || null
}

const topHomePlayer = computed(() => pickTopPlayer(boxScore.value.home))
const topAwayPlayer = computed(() => pickTopPlayer(boxScore.value.away))

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
  // Unmapped attributes: derive the display name ("ballHandling" → "Ball
  // Handling") — matches the enumerated translatable attribute names; the
  // badge CSS uppercases visually. Mapped abbreviations stay literal.
  const key = attr.split('.').pop()
  return attrMap[attr] || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()
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
        is_injured: p.is_injured ?? rosterPlayer.is_injured ?? false,
        badges: p.badges ?? rosterPlayer.badges ?? []
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

// Current lineup as full player objects (for synergy calculations)
const currentLineupPlayerObjects = computed(() => {
  if (!selectedLineup.value) return []
  const players = userTeamPlayers.value
  return selectedLineup.value.map(id => {
    if (!id) return null
    return players.find(p => (p.player_id || p.id) == id) || null
  })
})

function getPlayerSynergyCount(player) {
  if (!player) return 0
  const lineup = currentLineupPlayerObjects.value.filter(p => p != null)
  const { activatedIds } = getActivatedBadges(player, lineup)
  return activatedIds.size
}

function getCandidateSynergyCount(candidate, slotIndex) {
  const lineup = currentLineupPlayerObjects.value
  const { count } = getHypotheticalActivations(candidate, lineup, slotIndex)
  return count
}

const totalLineupSynergyCount = computed(() => {
  return getLineupSynergyCount(currentLineupPlayerObjects.value)
})

// Eligible players per position slot (filtered by position and injury status)
const eligiblePlayersForSlot = computed(() => {
  const result = {}
  const players = userTeamPlayers.value

  positionLabels.forEach((pos, index) => {
    // Get IDs of players already selected in OTHER slots
    const excludeIds = selectedLineup.value
      .filter((id, i) => i !== index && id != null)

    // Filter to players who can play this position, aren't injured, aren't
    // fouled out (6 personals — can never re-enter), and aren't selected elsewhere
    result[pos] = players.filter(p => {
      const canPlay = p.position === pos || p.secondary_position === pos
      const isHealthy = !p.is_injured && !p.isInjured
      const notFouledOut = (p.fouls ?? 0) < 6
      return canPlay && isHealthy && notFouledOut && !excludeIds.includes(p.player_id)
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
    const notFouledOut = (p.fouls ?? 0) < 6
    const notInLineup = !excludeIds.includes(p.player_id)
    const notCurrentStarter = p.player_id !== selectedLineup.value[slotIndex]
    return canPlay && isHealthy && notFouledOut && notInLineup && notCurrentStarter
  }).sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))
}

// Toggle swap dropdown for a position slot
// The player at the line during a pending free-throw trip cannot be
// substituted out (real rule: the fouled player shoots). The engine also
// enforces this in applyAdjustments; here we lock the slot in the UI.
const pendingFtShooterId = computed(() => currentBreakInfo.value?.freeThrows?.shooterId ?? null)
function isLockedFtShooterSlot(slotIndex) {
  const id = pendingFtShooterId.value
  return id != null && String(selectedLineup.value[slotIndex]) === String(id)
}

function toggleSwapDropdown(slotIndex) {
  if (isLockedFtShooterSlot(slotIndex)) return
  if (expandedSwapPlayer.value === slotIndex) {
    expandedSwapPlayer.value = null
  } else {
    expandedSwapPlayer.value = slotIndex
  }
}

// Swap a player into a position slot
async function swapPlayerIn(slotIndex, playerId) {
  // Shooter at the line can't come out mid-trip.
  if (isLockedFtShooterSlot(slotIndex)) return

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
  // Shooter at the line can't come out mid-trip.
  if (isLockedFtShooterSlot(slotIndex)) return

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
  loadSynergies()

  // Warm-decode the in-game event sounds (swish pool etc.) and ambient
  // loop beds so the first play is instant. Idempotent + no-op when sound
  // is disabled; the fetch/decode is async and never touches the sim worker.
  audioStore.preloadEventSfx()
  audioStore.preloadAmbientSfx()
  audioStore.preloadTimeoutMusic()

  try {
    // Fetch team data first (single source of truth for user's roster and lineup)
    await teamStore.fetchTeam(campaignId.value)

    // Sync local lineup from teamStore
    if (teamStore.lineup && teamStore.lineup.length === 5) {
      localLineup.value = [...teamStore.lineup]
    }

    // Refresh campaign data for settings
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

    // If this is a playoff game, make sure the bracket is loaded so the
    // per-team series record (e.g. "2-1") and the round label can resolve.
    // Without this, `playoffStore.getSeriesFromBracket(...)` returns null on
    // direct-load (or hard reload) of the postgame URL and the series record
    // shows as blank under the team logos.
    if (gameStore.currentGame?.is_playoff) {
      try {
        await playoffStore.fetchBracket(campaignId.value)
      } catch (err) {
        console.error('Failed to fetch playoff bracket:', err)
      }
    }

    // Load coaching styles from user's team coaching_scheme
    // Prefer teamStore (single source of truth, updated in-memory), fall back to game's team object
    const coachingScheme = teamStore.team?.coaching_scheme
      || (userIsHome.value ? gameStore.currentGame?.home_team : gameStore.currentGame?.away_team)?.coaching_scheme
    if (coachingScheme?.offensive) {
      selectedOffense.value = coachingScheme.offensive
    }
    if (coachingScheme?.defensive) {
      selectedDefense.value = coachingScheme.defensive
    }

    // Fetch opponent roster only (user roster comes from teamStore)
    if (gameStore.currentGame?.home_team?.id && gameStore.currentGame?.away_team?.id) {
      const opponentTeamId = userIsHome.value
        ? gameStore.currentGame.away_team.id
        : gameStore.currentGame.home_team.id

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

  // First-visit onboarding tours, gated by what's actually on screen:
  //   - Pre-game flow tour for the user's upcoming games
  //   - Post-game recap tour the first time the user lands on a completed
  //     game (covers the result, rewards, box score, and player evolution)
  if (isUserGame.value && !isComplete.value) {
    walkthroughStore.maybeStart('gamePreview')
  } else if (isUserGame.value && isComplete.value) {
    walkthroughStore.maybeStart('gameRecap')
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

async function handleCpuSetLineup() {
  try {
    const { selectBestLineup } = await import('@/engine/ai/AILineupService')
    const roster = teamStore.roster
    if (!roster || roster.length < 5) {
      toastStore.showError('Not enough players to set lineup')
      return
    }
    const newLineup = selectBestLineup(roster)
    await teamStore.updateLineup(campaignId.value, newLineup)
    showInjuryModal.value = false
    showRecoveryModal.value = false
    toastStore.showSuccess('CPU adjusted your lineup')
  } catch (err) {
    toastStore.showError('Failed to auto-set lineup')
  }
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
  // Capture pre-game records BEFORE entering live mode so the broadcast header
  // shows the going-in records throughout the run. The store mutates standings
  // / bracket as soon as the final quarter sims, which would otherwise spoil
  // the result before the canvas plays Q4.
  snapshotTeamRecords()
  simulating.value = true
  isLiveMode.value = true
  showAnimationMode.value = true
  window.scrollTo({ top: 0, behavior: 'smooth' })

  try {
    let result

    // Build settings with lineup
    const settings = {
      offensive_style: selectedOffense.value,
      defensive_style: selectedDefense.value,
      // User defensive matchup overrides ({ opponentOffId: userDefId }).
      defensive_matchups: { ...defensiveMatchups.value },
      // Pacing mode — read by the engine only on a fresh start; resumes keep
      // the mode serialized in the saved game state.
      pacing_mode: selectedPacing.value,
      // Fetch one possession per call regardless of pacing — the pacing mode
      // only decides where the CLIENT visibly pauses (it auto-continues
      // through the rest), so timeouts/edits land at the current play's end.
      stop_after_play: true,
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

    currentBreakInfo.value = result.breakInfo ?? null

    // Load animation data and auto-play
    if (result.animation_data?.possessions?.length > 0) {
      const quarter = result.quarter || 1
      let startingHomeScore = 0
      let startingAwayScore = 0
      if (result.starting_scores) {
        // Segmented pacing stamps the exact scores at segment start —
        // correct for mid-quarter resumes where summing completed
        // quarterScores would miss the partial quarter's points.
        startingHomeScore = result.starting_scores.home || 0
        startingAwayScore = result.starting_scores.away || 0
      } else if (quarter > 1 && quarterScores.value) {
        for (let i = 0; i < quarter - 1; i++) {
          startingHomeScore += quarterScores.value.home?.[i] || 0
          startingAwayScore += quarterScores.value.away?.[i] || 0
        }
      }
      loadAnimationData(result.animation_data, {
        isLive: true,
        quarter,
        startingHomeScore,
        startingAwayScore,
        breakInfo: result.breakInfo ?? null,
      })
      // First-visit broadcast tour: hold tip-off while it runs — the
      // walkthrough activeKey watcher starts play when it ends/dismisses.
      walkthroughStore.maybeStart('gameLive')
      if (walkthroughStore.activeKey !== 'gameLive') {
        setTimeout(() => {
          play()
        }, 500)
      }
    }

    // Check if game completed (can happen when resuming an in-progress game)
    if (result.isGameComplete) {
      gameJustCompleted.value = true
      isLiveMode.value = false
      await leagueStore.fetchStandings(campaignId.value, { force: true })
      showUpgradePointToasts()
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
async function continueToNextQuarter({ instantPlay = false } = {}) {
  // Capture starting scores BEFORE async call (they reflect end of previous quarter)
  const startingHomeScore = currentHomeScore.value
  const startingAwayScore = currentAwayScore.value

  simulating.value = true

  try {
    // Gather coaching adjustments and lineup
    const adjustments = {
      offensive_style: selectedOffense.value,
      defensive_style: selectedDefense.value,
      // Updated defensive matchups for the next quarter.
      defensive_matchups: { ...defensiveMatchups.value },
      // One possession per call in every pacing mode — the auto-flow watcher
      // continues silently where the pacing wouldn't pause, so timeouts and
      // coaching edits land at the end of the current play.
      stop_after_play: true,
    }

    // A timeout was taken at this dead ball — the engine burns it (momentum
    // reset to even + lineup fatigue/energy breather) before simulating the
    // next segment.
    if (pendingTimeoutCall.value) {
      adjustments.call_timeout = true
      pendingTimeoutCall.value = false
    }

    // Live-made coaching edits ship with these adjustments — retire the
    // overlay's "applies at the next break" note.
    liveEditsPending.value = false

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

    currentBreakInfo.value = result.breakInfo ?? null

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

      // Handle playoff series update
      if (result.playoffUpdate) {
        playoffStore.handlePlayoffUpdate(result.playoffUpdate)
      }

      // Check for user team injuries and recoveries
      const teamKey = userIsHome.value ? 'home' : 'away'
      const evoData = game.value?.evolution?.[teamKey]
      if (evoData?.injuries?.length > 0) {
        injuredPlayers.value = evoData.injuries
        showInjuryModal.value = true
      }
      if (evoData?.recoveries?.length > 0) {
        recoveredPlayers.value = evoData.recoveries
        // Delay if injury modal is also showing so they don't overlap
        if (showInjuryModal.value) {
          setTimeout(() => { showRecoveryModal.value = true }, 500)
        } else {
          showRecoveryModal.value = true
        }
      }

      showUpgradePointToasts()
    }

    // Load this quarter's animation data and play
    if (result.animation_data?.possessions?.length > 0) {
      // Always set isLive: true so we get the overlay at the end
      // The overlay will show different content based on gameJustCompleted
      loadAnimationData(result.animation_data, {
        isLive: true,
        quarter: result.quarter,
        startingHomeScore,
        startingAwayScore,
        breakInfo: result.breakInfo ?? null,
        // Mid-game reload — keep the momentum rail where it is.
        preserveMomentum: true,
      })
      // Auto-flow continues (mid-quarter, no visible pause) resume instantly
      // so back-to-back plays read as continuous action.
      setTimeout(() => {
        play()
      }, instantPlay ? 0 : 500)
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

// ---------------------------------------------------------------------------
// Segment pauses (play / deadBall pacing)
// ---------------------------------------------------------------------------

/**
 * Continue from a segment pause: clear the pause flag and request the next
 * segment (lineup / coach settings / armed timeout ride the adjustments).
 */
function handleSegmentContinue() {
  if (simulating.value) return
  timeoutActive.value = false // strip Continue during the countdown = Skip
  isSegmentPause.value = false
  showCoachesOverlay.value = false
  continueToNextQuarter()
}

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

// Timeout can be taken at this boundary: any play end except a completed
// quarter or mid-free-throw trip, with a timeout left. Deliberately looser
// than the engine's dead-ball-only `allowTimeout` — every possession is now a
// real engine boundary (stop_after_play), and `_applyTimeout` itself imposes
// no dead-ball precondition.
function canFireTimeoutNow(bi) {
  if (!bi || bi.quarterComplete) return false
  if (bi.deadBallType === 'free_throw_pending') return false
  return (bi.timeoutsRemaining ?? lastKnownTimeouts.value) > 0
}

// When the TO button is live: at a pause it fires immediately (any play end);
// mid-play it can always be ARMED — it fires at the end of the current play.
const timeoutAvailable = computed(() => {
  if (timeoutActive.value) return false
  if (isSegmentPause.value || isQuarterBreak.value) {
    return canFireTimeoutNow(currentBreakInfo.value)
  }
  return isLiveMode.value && lastKnownTimeouts.value > 0
})

/**
 * TO button (strip + break modal): tap while armed cancels; tap at a pause
 * starts the timeout sequence immediately; tap mid-play arms it to fire at
 * the end of the current play.
 */
function toggleTimeoutRequest() {
  if (timeoutActive.value) return
  if (timeoutRequested.value) {
    timeoutRequested.value = false
    return
  }
  if (!timeoutAvailable.value) return
  if (isSegmentPause.value && canFireTimeoutNow(currentBreakInfo.value)) {
    startTimeoutSequence()
  } else {
    timeoutRequested.value = true
  }
}

/**
 * The timeout is taken NOW: players slide off, the court counts down 30s.
 * The engine burn (call_timeout) rides the next Continue via
 * pendingTimeoutCall; the count + momentum rail update optimistically and
 * re-sync from the next segment's breakInfo/possession stamps.
 */
function startTimeoutSequence() {
  timeoutRequested.value = false
  pendingTimeoutCall.value = true
  timeoutActive.value = true
  lastKnownTimeouts.value = Math.max(0, lastKnownTimeouts.value - 1)
  resetMomentumDisplay()
  // Audio sequence: whistle NOW (the ref blows it dead — same pool as foul
  // calls), air horn ~0.5s in, hype music ~3.5s in. The scheduled beats
  // cancel if the timeout ends before they fire.
  audioStore.playEventSfx('foul_whistle')
  _clearTimeoutAudioTimers()
  timeoutAudioTimers.push(setTimeout(() => audioStore.playEventSfx('timeout_airhorn'), 500))
  timeoutAudioTimers.push(setTimeout(() => audioStore.startTimeoutMusic(), 3500))
  timeoutSecondsLeft.value = TIMEOUT_SECONDS
  _clearTimeoutTimer()
  timeoutTimer = setInterval(() => {
    timeoutSecondsLeft.value -= 1
    if (timeoutSecondsLeft.value <= 0) {
      onTimeoutComplete()
    }
  }, 1000)
}

function _clearTimeoutTimer() {
  if (timeoutTimer) {
    clearInterval(timeoutTimer)
    timeoutTimer = null
  }
}

// Pending timeout-audio beats (air horn / hype music start).
let timeoutAudioTimers = []
function _clearTimeoutAudioTimers() {
  for (const t of timeoutAudioTimers) clearTimeout(t)
  timeoutAudioTimers = []
}

// However the timeout ends (expiry, Skip, strip Continue): stop the clock,
// cancel unfired audio beats, kill the music, and whistle play back in.
watch(timeoutActive, (active) => {
  if (active) return
  _clearTimeoutTimer()
  _clearTimeoutAudioTimers()
  audioStore.stopTimeoutMusic()
  audioStore.playEventSfx('foul_whistle')
})

/** Countdown expired or Skip tapped — resume play where it left off. */
function onTimeoutComplete() {
  if (!timeoutActive.value) return
  handleSegmentContinue()
}

// Every possession end is an engine boundary now (stop_after_play). This
// watcher decides what each boundary becomes, in precedence order:
//   1. Foul-out → coaches overlay at the subs view (armed TO stays armed).
//      Skipped in hands-off quarter pacing — the engine's auto-sub stands.
//   2. Armed timeout → the timeout sequence fires NOW (end of current play).
//   3. Auto-flow → continue silently through boundaries where the selected
//      pacing wouldn't pause (quarter: everything mid-quarter; deadBall:
//      live-ball ends). Clearing isSegmentPause synchronously (pre-render)
//      keeps the break UI from flashing for a frame.
watch(isSegmentPause, (paused) => {
  if (!paused) return
  const bi = currentBreakInfo.value
  const pacing = selectedPacing.value
  if (pacing !== 'quarter' && (bi?.foulOutPlayerIds?.length ?? 0) > 0) {
    openCoachesSubs()
    return
  }
  if (timeoutRequested.value && canFireTimeoutNow(bi)) {
    startTimeoutSequence()
    return
  }
  const autoFlow = pacing === 'quarter' || (pacing === 'deadBall' && !bi?.deadBall)
  if (autoFlow && bi && !bi.quarterComplete && !simulating.value) {
    isSegmentPause.value = false
    continueToNextQuarter({ instantPlay: true })
  }
})

/** Human copy for why the game stopped (segment break bar + modal title). */
const breakReasonText = computed(() => {
  const bi = currentBreakInfo.value
  if (!bi) return ''
  switch (bi.deadBallType) {
    case 'shooting_foul': return 'Shooting foul — clock stopped'
    case 'non_shooting_foul': return 'Foul on the floor — clock stopped'
    case 'and_one': return 'And-one! Foul on the make'
    case 'deflection_oob': return 'Tipped out of bounds — offense keeps possession'
    case 'offensive_foul': return 'Offensive foul — turnover'
    case 'violation': {
      const kindLabels = {
        travel: 'Traveling — turnover',
        bad_pass_oob: 'Pass out of bounds — turnover',
        lost_ball_oob: 'Out of bounds — turnover',
        double_dribble: 'Double dribble — turnover',
      }
      return kindLabels[bi.violationKind] || 'Turnover — dead ball'
    }
    case 'free_throw_pending':
      if (!bi.freeThrows) return 'Free throw coming up'
      return bi.freeThrows.next === bi.freeThrows.total
        ? `Final free throw coming up (${bi.freeThrows.next} of ${bi.freeThrows.total})`
        : `Free throw ${bi.freeThrows.next} of ${bi.freeThrows.total} coming up`
    case 'quarter_end': return `End of Q${completedQuarter.value}`
    default: return bi.deadBall ? 'Dead ball' : 'End of play'
  }
})

/** User-team players who fouled out at this break (names for the banner). */
const fouledOutNames = computed(() => {
  const ids = currentBreakInfo.value?.foulOutPlayerIds || []
  if (!ids.length) return []
  const roster = userTeamPlayers.value || []
  return ids.map(id => {
    const p = roster.find(pl => String(pl.player_id ?? pl.id) === String(id))
    return p?.name || `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || 'A player'
  })
})

// Drives the dead-ball break UI: the Continue/Subs/Adjust buttons in the
// Coach Overview strip AND the centered stoppage bubble on the court
// (BasketballCourt's stoppageMode).
const showBreakControls = computed(() =>
  isSegmentPause.value && !showCoachesOverlay.value && !isQuarterBreak.value && !timeoutActive.value
)

// The VERIFIED result line for the stoppage bubble. Dead balls use the
// engine's break classification (deadBallType → breakReasonText, foul-outs
// folded in) — authoritative even when the play description is ambiguous.
// Non-dead-ball pauses (Every Play pacing) fall back to the play-by-play
// result line stamped on the possession ("X makes the three-pointer!").
const stoppageResultText = computed(() => {
  if (currentBreakInfo.value?.deadBall) {
    const base = breakReasonText.value || 'Dead ball'
    return fouledOutNames.value.length
      ? `${base} — ${fouledOutNames.value.join(', ')} fouled out`
      : base
  }
  // Prefer the translation template stamped by the engine (result_tpl +
  // result_params) over the pre-interpolated English result_text.
  const p = currentPossession.value
  if (p?.result_tpl) return tDynamic(p.result_tpl, p.result_params)
  return p?.result_text || 'End of play'
})

// ---------------------------------------------------------------------------
// Coach Overview (live band above the court)
// ---------------------------------------------------------------------------

// Timeout count shown on the overview button between breaks. The engine
// reports the live count in every segment breakInfo; seed with the game
// default (4) until the first break arrives.
const lastKnownTimeouts = ref(4)
watch(currentBreakInfo, (bi) => {
  if (typeof bi?.timeoutsRemaining === 'number') {
    lastKnownTimeouts.value = bi.timeoutsRemaining
  }
})

const userCoach = computed(() =>
  userIsHome.value ? homeTeamCoach.value : awayTeamCoach.value
)

/** Open the coaches overlay straight on the Subs tab. */
function openCoachesSubs() {
  coachesTab.value = 'subs'
  showCoachesOverlay.value = true
}

/** Open the coaches overlay on the Settings tab. */
function openCoachesAdjust() {
  coachesTab.value = 'settings'
  showCoachesOverlay.value = true
}

/** Close the overlay; next open starts back at the Settings tab. */
function closeCoachesOverlay() {
  showCoachesOverlay.value = false
  expandedSwapPlayer.value = null
  coachesTab.value = 'settings'
}

// Any coaching edit made from the overlay while the ball is live flips the
// "applies at the next break" footer note on. Deep: lineup swaps mutate an
// array slot and the matchup editor emits a fresh map.
watch([selectedOffense, selectedDefense, defensiveMatchups, selectedLineup], () => {
  if (showCoachesOverlay.value && !isSegmentPause.value && !isQuarterBreak.value) {
    liveEditsPending.value = true
  }
}, { deep: true })

/** Overlay Continue at a pause — close and resume via the matching path. */
function handleCoachesOverlayContinue() {
  if (simulating.value) return
  closeCoachesOverlay()
  if (isSegmentPause.value) {
    handleSegmentContinue()
  } else {
    handleQuarterBreakContinue()
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

    // The end-game modal pulls displayed scores from the animation composable,
    // which hasn't played the simmed-over quarters — so without this it
    // shows the score at the start of the sim-to-end (= last quarter break).
    // Sync to the final result before the user sees the modal.
    const finalGame = gameStore.currentGame
    if (finalGame?.is_complete) {
      setDisplayedScores(finalGame.home_score, finalGame.away_score, finalGame.box_score)
    }

    if (response.batchId) {
      gameStore.startPollingSimulationStatus(campaignId.value, response.batchId)
    } else {
      await leagueStore.fetchStandings(campaignId.value, { force: true })
    }

    // Handle playoff series update
    if (response.playoffUpdate) {
      playoffStore.handlePlayoffUpdate(response.playoffUpdate)
    }

    showUpgradePointToasts()
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
  // currentGame already has full data (box_score, evolution, rewards) from simulation
  // Do NOT call fetchGame here — it rebuilds from schedule which lacks evolution data
}

/**
 * Show toast notifications for players who earned upgrade points.
 */
function showUpgradePointToasts() {
  const points = game.value?.upgrade_points_awarded
  if (!points?.length) return

  // Stagger toasts slightly so they appear one after another
  points.forEach((award, i) => {
    setTimeout(() => {
      toastStore.showSuccess(
        `${award.name} earned ${award.points_earned} upgrade point${award.points_earned > 1 ? 's' : ''}! (${award.total_points} total)`,
        5000
      )
    }, i * 600)
  })
}

function goBack() {
  // Restore scroll when navigating away
  document.body.style.overflow = ''
  router.push(`/campaign/${campaignId.value}`)
}

function formatDate(dateString) {
  if (!dateString) return ''
  const [y, m, d] = dateString.split('T')[0].split(' ')[0].split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(dateLocale(), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

function getTopPerformers(stats, roster) {
  if (!stats || !Array.isArray(stats) || stats.length === 0) return []
  return [...stats]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, 3)
    .map(p => {
      if (p.headshot) return p
      const rosterPlayer = roster?.find(r => r.id === p.player_id)
      return rosterPlayer?.headshot ? { ...p, headshot: rosterPlayer.headshot } : p
    })
}

const homeTopPerformers = computed(() => getTopPerformers(boxScore.value.home, homeRoster.value))
const awayTopPerformers = computed(() => getTopPerformers(boxScore.value.away, awayRoster.value))

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

// Game clock - convert possession progress to time, counting down from
// QUARTER_LENGTH_MINUTES:00 to 0:00. Pulls quarter length from GameConfig
// so the live UI matches what the simulator actually plays.
const QUARTER_SECONDS = QUARTER_LENGTH_MINUTES * 60
const QUARTER_CLOCK_LABEL = `${QUARTER_LENGTH_MINUTES}:00`

const gameClock = computed(() => {
  if (!hasAnimationData.value || totalPossessions.value === 0) return QUARTER_CLOCK_LABEL

  // Per-possession clock: each possession carries `time` = minutes remaining
  // at possession start — count down from it toward the next possession's
  // time. (The proportional fallback below breaks on partial-quarter
  // segments and whizzes on quick plays; it survives only for legacy
  // animation data without `time`.)
  const poss = animationData.value?.possessions
  const cur = poss?.[currentPossessionIndex.value]
  if (typeof cur?.time === 'number') {
    const startSec = Math.max(0, cur.time * 60)

    // Free throws are shot with the clock STOPPED — freeze the display at
    // the whistle time. (Without this, the last-possession "~14s" fallback
    // below drained the clock during every FT attempt, since segmented
    // pacing loads each attempt as its own single-possession batch.)
    if (cur.is_free_throw) {
      const m = Math.floor(startSec / 60)
      const s = Math.floor(startSec % 60)
      return `${m}:${s.toString().padStart(2, '0')}`
    }

    const next = poss[currentPossessionIndex.value + 1]
    const endSec = (typeof next?.time === 'number' && next.quarter === cur.quarter)
      ? Math.max(0, next.time * 60)
      : Math.max(0, startSec - 14) // last loaded possession: assume ~14s

    // Game-time consumed (tempo-rolled, 4-24s) and animation duration
    // (keyframe time, ~2-7s) are INDEPENDENT — interpolating one across the
    // other made the clock visibly whiz ~4-5x on quick plays (turnovers,
    // disruption fouls). Instead: tick at a capped, consistent rate during
    // the live action, then drain the leftover during the play's end-hold —
    // the dead-ball beat at the end of every play, where a quick run-down
    // reads as "time passing between plays" (broadcast cut-back feel).
    const duration = currentPossession.value?.duration || 0
    const consumed = Math.max(0, startSec - endSec)
    let used = consumed * progress.value // legacy linear (duration missing)
    if (duration > 0) {
      const LIVE_RATE_CAP = 1.25                    // max game-sec per presentation-sec during action
      const drainS = Math.min(1.0, duration * 0.25) // leftover drains in the end-hold window
      const liveS = Math.max(0.001, duration - drainS)
      const elapsed = progress.value * duration
      const liveRate = Math.min(consumed / duration, LIVE_RATE_CAP)
      const liveConsumed = Math.min(consumed, liveRate * liveS)
      used = elapsed <= liveS
        ? liveRate * elapsed
        : liveConsumed + (consumed - liveConsumed) * Math.min(1, (elapsed - liveS) / drainS)
    }
    const remaining = Math.max(0, Math.floor(startSec - used))
    const m = Math.floor(remaining / 60)
    const s = remaining % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // Calculate progress through the quarter (0 to 1)
  const quarterProgress = (currentPossessionIndex.value + progress.value) / totalPossessions.value

  // Convert to remaining time (counting down from quarter length to 0)
  const totalSeconds = Math.max(0, Math.floor(QUARTER_SECONDS * (1 - quarterProgress)))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
})

// Walkthrough side-effect: open/close the Substitutions dropdown so the tour
// can spotlight both the button and the panel it reveals. (watch is not
// immediate, so it only fires when an action is requested mid-tour.)
watch(() => walkthroughStore.requestedAction, (req) => {
  if (!req) return
  if (req.view === 'gamePreview') {
    if (req.action === 'openSubsDropdown') {
      showSubsDropdown.value = true
    } else if (req.action === 'closeSubsDropdown') {
      showSubsDropdown.value = false
    }
  } else if (req.view === 'gameLive') {
    // Broadcast tour: the coaches-tabs step opens/closes the coaches overlay
    // (enter is a safety net behind the interactive clipboard tap; leave
    // also fires on skip, so the overlay never sticks open).
    if (req.action === 'openCoaches') {
      openCoachesAdjust()
    } else if (req.action === 'closeCoaches') {
      closeCoachesOverlay()
    }
  }
})

// Broadcast tour pause/resume: entering the gameLive tour (first visit or a
// "?" replay) pauses the animation; when it ends — finished or skipped — play
// starts again UNLESS the game is parked at a break/timeout/final, where the
// user resumes via the normal controls.
watch(() => walkthroughStore.activeKey, (key, prev) => {
  if (key === 'gameLive') {
    if (isPlaying.value) pause()
    return
  }
  if (prev === 'gameLive' && !key) {
    closeCoachesOverlay() // belt & braces alongside the step's leave action
    if (isLiveMode.value && !gameJustCompleted.value && !isQuarterBreak.value
        && !isSegmentPause.value && !timeoutActive.value) {
      play()
    }
  }
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
  // Skip if we're in live mode or animation is already playing — the live game flow
  // manages animation data manually via loadAnimationData() calls in startGame/continueToNextQuarter.
  // Without this guard, the watcher overwrites isLive:true with isLive:false when the store
  // updates currentGame.animation_data on game completion, which prevents the end-game modal.
  if (isLiveMode.value || showAnimationMode.value) return

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
              if (outcome === 'blocked' || outcome === 'stolen' || outcome === 'turnover' || outcome === 'deflected') {
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

// Ambient beds, one sync point for every trigger:
// - play_active (dribbles/sneakers): while the play animation actively runs.
//   Stops at segment/quarter breaks, manual pause, and game end (they all
//   flip `isPlaying` via the composable's pause()); excluded at the FT line
//   (arena goes quiet) — possession index matters because in By Quarter
//   pacing an FT possession plays back-to-back inside one continuous run.
// - game_crowd: the WHOLE game presentation, breaks included — as long as
//   animation mode is on screen.
// startAmbient is idempotent and no-ops while game-muted, so calling this
// eagerly is always safe; the mute toggle calls it to resume the right beds
// mid-play on unmute.
function syncAmbientBeds() {
  // The broadcast walkthrough silences the arena — beds resume when it ends.
  const tourRunning = walkthroughStore.activeKey === 'gameLive'

  if (showAnimationMode.value && !tourRunning) audioStore.startAmbient('game_crowd')
  else audioStore.stopAmbient('game_crowd')

  const atTheLine = !!currentPossession.value?.is_free_throw
  if (isPlaying.value && !atTheLine && !tourRunning) audioStore.startAmbient('play_active')
  else audioStore.stopAmbient('play_active')
}

watch([isPlaying, currentPossessionIndex, showAnimationMode, () => walkthroughStore.activeKey], syncAmbientBeds)

// Movement trails are suppressed during free-throw possessions (the
// formation snap would paint streaks across the court). Also wipe the
// accumulated position history when crossing an FT boundary in EITHER
// direction, so no stale trail connects pre-whistle spots to the line —
// or the line back to the next live play.
watch(() => !!currentPossession.value?.is_free_throw, (isFt, wasFt) => {
  if (isFt !== wasFt && courtRef.value?.clearTrails) {
    courtRef.value.clearTrails()
  }
})

// Game-sound mute (event SFX + ambient beds only — UI sounds unaffected).
// Muting stops the beds inside the store; unmuting resumes whatever the
// current game state calls for.
function toggleGameMute() {
  audioStore.toggleGameMuted()
  if (!audioStore.gameMuted) syncAmbientBeds()
}

// Court-overlay speed pill: one button cycling 1x → 2x → 4x. Chevron count
// grows with speed (› ›› ›››) so the state reads at a glance.
const PLAYBACK_SPEEDS = [1, 2, 4]
function cycleSpeed() {
  const idx = PLAYBACK_SPEEDS.indexOf(playbackSpeed.value)
  setSpeed(PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length])
}
const speedChevrons = computed(() =>
  '›'.repeat(Math.max(1, PLAYBACK_SPEEDS.indexOf(playbackSpeed.value) + 1))
)

// Track which keyframes we've already triggered animations for (to prevent duplicates)
const triggeredDefensiveKeyframes = ref(new Set())
// Same dedupe pattern for keyframe-declared event sounds (kf.sfx).
const triggeredSfxKeyframes = ref(new Set())

// The dedupe keys are `${possessionIdx}-${keyframeIdx}` — unique within ONE
// loaded animation batch, but every segment load restarts at possession 0.
// Consecutive single-possession segments with identical keyframe layouts
// (free throw attempt 1 → attempt 2) collide on every key, which silenced
// all sounds on the second attempt. Reset both sets whenever a new batch
// of animation data is loaded.
watch(animationData, () => {
  triggeredDefensiveKeyframes.value.clear()
  triggeredSfxKeyframes.value.clear()
})

// Watch for keyframe changes to trigger defensive animations in real-time
watch(
  [currentKeyframeIndex, currentPossessionIndex],
  ([keyframeIdx, possessionIdx], [oldKeyframeIdx, oldPossessionIdx]) => {
    // Reset tracking when possession changes
    if (possessionIdx !== oldPossessionIdx) {
      triggeredDefensiveKeyframes.value.clear()
      triggeredSfxKeyframes.value.clear()
    }

    // Only process if we have a keyframe and court ref
    if (!currentKeyframe.value || !courtRef.value || !showAnimationMode.value) return

    const keyframe = currentKeyframe.value
    const outcome = keyframe?.outcome
    const keyframeId = `${possessionIdx}-${keyframeIdx}`

    // Keyframe-declared event sound (e.g. sfx:'made_shot' on the rim-arrival
    // frame of a make): play a random variant from the event's pool once.
    if (keyframe.sfx && !triggeredSfxKeyframes.value.has(keyframeId)) {
      triggeredSfxKeyframes.value.add(keyframeId)
      audioStore.playEventSfx(keyframe.sfx)
    }

    // Check if this is a defensive play we haven't animated yet
    if ((outcome === 'blocked' || outcome === 'stolen' || outcome === 'turnover' || outcome === 'deflected') &&
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

// Reset the stat-animation baselines whenever a new game's animation data
// loads. Without this, prev* refs hold the PREVIOUS game's accumulated
// stats; the new game's first emission has zeros, and the
// `oldVal !== newVal` check fires the green stat-pop on stats that never
// actually accrued. Bug only showed up at the very start of games and
// "fixed itself" once enough new plays accumulated to wash out the stale
// baseline.
watch(animationData, () => {
  prevPlayerStats.value = {}
  prevAwayRanking.value = []
  prevHomeRanking.value = []
  animatingStats.value = {}
  animatingStatPlayers.value = {}
})

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

// Map the engine's on-court five onto the PG-C position slots (primary fit,
// then secondary, then fill in order). Used at segment/quarter breaks so
// Continue sends back exactly who's on the floor unless the user changes it —
// otherwise a stale lineup adjustment would stomp AI rotations every segment.
function seedLineupFromEngine(engineIds, players) {
  const byId = new Map(players.map(p => [String(p.player_id ?? p.id), p]))
  const remaining = engineIds.filter(id => byId.has(String(id)))
  const newLineup = [null, null, null, null, null]
  positionLabels.forEach((pos, slot) => {
    const idx = remaining.findIndex(id => byId.get(String(id))?.position === pos)
    if (idx !== -1) { newLineup[slot] = remaining[idx]; remaining.splice(idx, 1) }
  })
  positionLabels.forEach((pos, slot) => {
    if (newLineup[slot] != null) return
    const idx = remaining.findIndex(id => byId.get(String(id))?.secondary_position === pos)
    if (idx !== -1) { newLineup[slot] = remaining[idx]; remaining.splice(idx, 1) }
  })
  for (let slot = 0; slot < 5; slot++) {
    if (newLineup[slot] == null && remaining.length) newLineup[slot] = remaining.shift()
  }
  return newLineup
}

// Initialize lineup selections when entering quarter break
// Watch both the break state and the players data to handle timing issues
watch(
  [isQuarterBreak, isSegmentPause, userTeamPlayers],
  ([isBreak, isSegBreak, players]) => {
    if ((isBreak || isSegBreak) && isLiveMode.value && players.length >= 5) {
      // Segmented pacing: the engine reports who's actually on the floor —
      // seed from that at every break (subs may have happened mid-quarter).
      const engineIds = currentBreakInfo.value?.currentLineups?.[userIsHome.value ? 'home' : 'away']
      if (engineIds?.length === 5) {
        const seeded = seedLineupFromEngine(engineIds, players)
        if (seeded.filter(id => id !== null).length === 5) {
          selectedLineup.value = seeded
          return
        }
      }
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
      await teamStore.updateCoachingScheme(
        campaignId.value,
        offense,
        defense
      )
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

// Defensive matchup editor sources: the user's 5 defenders and the opponent's 5
// offensive starters (both annotated with slotPosition PG→C).
const userDefenders = computed(() =>
  userIsHome.value ? preGameHomeStarters.value : preGameAwayStarters.value
)
const opponentOffense = computed(() =>
  userIsHome.value ? preGameAwayStarters.value : preGameHomeStarters.value
)

// A matchup map is valid only if it covers all 5 opponents with unique defenders
// that are all currently in the user's lineup.
function isValidMatchupMap(map, opps, defs) {
  if (!map || !opps?.length || !defs?.length) return false
  const defIds = new Set(defs.map((d) => String(d.id)))
  const seen = new Set()
  for (const o of opps) {
    const did = map[String(o.id)]
    if (!did || !defIds.has(String(did)) || seen.has(String(did))) return false
    seen.add(String(did))
  }
  return Object.keys(map).length === opps.length
}

// Seed the positional default (opp slot i ↔ defender slot i). Reseeds whenever
// the current map becomes invalid (e.g. the user changed their lineup or the
// opponent changed); a valid user-swapped permutation is preserved.
function seedDefensiveMatchups() {
  const opps = opponentOffense.value
  const defs = userDefenders.value
  if (!opps || !defs || opps.length < 5 || defs.length < 5) return
  if (isValidMatchupMap(defensiveMatchups.value, opps, defs)) return
  const m = {}
  for (let i = 0; i < 5; i++) m[String(opps[i].id)] = String(defs[i].id)
  defensiveMatchups.value = m
}

watch([userDefenders, opponentOffense], seedDefensiveMatchups, { immediate: true })

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

// Lock body scroll only while the quarter-break modal is actually SHOWING.
// The coaches overlay never locks — it only covers the canvas — including
// when it temporarily replaces the break modal (quarter break + overlay
// open), where the page must stay scrollable so live stats remain reachable.
watch([isQuarterBreak, showCoachesOverlay, showAnimationMode], ([isBreak, coachesOpen, isAnimating]) => {
  if (isBreak && !coachesOpen && isAnimating) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

// Segmented pacing skips IndexedDB writes at live-ball pauses; flush the
// newest engine state when the tab hides or the view unmounts so closing
// the app mid-play-mode doesn't rewind past the last dead ball.
function _flushOnHide() {
  if (document.visibilityState === 'hidden') {
    gameStore.flushPendingGameState()
  }
}
document.addEventListener('visibilitychange', _flushOnHide)

// Cleanup on unmount
onUnmounted(() => {
  cleanup()
  _clearTimeoutTimer()
  _clearTimeoutAudioTimers()
  audioStore.stopTimeoutMusic()
  audioStore.stopAllAmbient()
  document.removeEventListener('visibilitychange', _flushOnHide)
  gameStore.flushPendingGameState()
  // Ensure scroll is restored on unmount
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="game-view p-6">
    <!-- Loading -->
    <div v-if="loading" class="page-loading-container">
      <LoadingSpinner size="md" />
    </div>

    <template v-else-if="game">
      <!-- Back Button -->
      <button class="back-btn mb-6" @click="goBack">
        <!-- i18n-ignore -->
        &larr; {{ $t('Back') }}
      </button>

      <!-- Game Header (hidden during animation mode) -->
      <GlassCard v-if="!showAnimationMode || !hasAnimationData" padding="lg" :hoverable="false" class="mb-6 game-header-card">
        <!-- Top header: date + game type label, lifted out of game-center so
             there's room for the VS-only center column on mobile. The status
             badge (FINAL / Qx complete) also sits here on completed games
             so the matchup row can keep both team logos + stacked scores in
             a single mobile-width row without a center text column eating
             into the gutter. -->
        <div class="game-header-top">
          <p class="game-date">{{ formatDate(game.game_date) }}</p>
          <p v-if="game.is_playoff" class="game-type-label playoff">
            {{ playoffStore.getPlayoffRoundLabel(game.playoff_round) }}
          </p>
          <p v-else class="game-type-label">{{ $t('Regular Season') }}</p>
          <p v-if="game.is_playoff && playoffSeriesInfo" class="series-record-badge">
            {{ playoffSeriesInfo.label }}
          </p>
          <p v-if="isComplete" class="game-status-badge final">{{ $t('FINAL') }}</p>
          <p v-else-if="isInProgress" class="game-status-badge in-progress">{{ game?.saved_mid_quarter ? `IN Q${savedQuarter}` : `Q${savedQuarter} COMPLETE` }}</p>
        </div>

        <div class="game-header">
          <!-- Away Team -->
          <div class="team-side away" :class="{ winner: winner === 'away' }">
            <div class="team-side-column">
              <span class="team-location-label">{{ $t('AWAY') }}</span>
              <div class="team-badge-wrapper">
                <div
                  class="team-badge-game away-team"
                  :style="{ '--team-color': awayTeam?.primary_color || '#6B7280' }"
                >
                  <span class="badge-abbr">{{ awayTeam?.abbreviation }}</span>
                  <span class="badge-record">
                    {{ game.is_playoff ? awaySeriesRecord : awayTeamRecord }}
                  </span>
                  <TeamOverallBadge :overall="awayTeamOverall" />
                </div>
                <div class="team-info">
                  <span v-if="awayTeam?.overall_rating" class="team-rating">{{ awayTeam.overall_rating }} OVR</span>
                  <span v-if="awayTeamRank" class="team-rank">#{{ awayTeamRank }} {{ getConferenceLabel(awayTeam) }}</span>
                </div>
              </div>
            </div>
            <div v-if="isComplete || isInProgress" class="team-score-lg">
              {{ displayAwayScore || 0 }}
            </div>
          </div>

          <!-- Center Info — VS divider for pregame only. The completed /
               in-progress status badge lives in .game-header-top so we
               don't burn a center column on mobile (would squeeze the
               team logos and stacked scores). -->
          <div
            v-if="!isComplete && !isInProgress"
            class="game-center"
            :class="{ 'is-playoff-preview': game.is_playoff }"
          >
            <p class="vs-text">VS</p>
          </div>

          <!-- Home Team -->
          <div class="team-side home" :class="{ winner: winner === 'home' }">
            <div v-if="isComplete || isInProgress" class="team-score-lg">
              {{ displayHomeScore || 0 }}
            </div>
            <div class="team-side-column">
              <span class="team-location-label">{{ $t('HOME') }}</span>
              <div class="team-badge-wrapper">
                <div
                  class="team-badge-game"
                  :style="{ '--team-color': homeTeam?.primary_color || '#6B7280' }"
                >
                  <span class="badge-abbr">{{ homeTeam?.abbreviation }}</span>
                  <span class="badge-record">
                    {{ game.is_playoff ? homeSeriesRecord : homeTeamRecord }}
                  </span>
                  <TeamOverallBadge :overall="homeTeamOverall" />
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
          {{ userWon ? $t('Victory!') : $t('Defeat') }}
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
                    class="broadcast-team-logo away-team"
                    :style="{ '--team-color': awayTeam?.primary_color || '#6B7280' }"
                  >
                    {{ awayTeam?.abbreviation }}
                  </div>
                  <span class="broadcast-record">
                    {{ game.is_playoff ? (frozenAwaySeriesRecord ?? awaySeriesRecord) : (frozenAwayTeamRecord ?? awayTeamRecord) }}
                  </span>
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
                <!-- Stays up through dead-ball stoppages — the broadcast is
                     still live, the ball just isn't in play. -->
                <div v-if="simulating || isPlaying || isSegmentPause" class="broadcast-live">
                  <span class="live-dot"></span>
                  {{ $t('LIVE') }}
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
                    :style="{ '--team-color': homeTeam?.primary_color || '#6B7280' }"
                  >
                    {{ homeTeam?.abbreviation }}
                  </div>
                  <span class="broadcast-record">
                    {{ game.is_playoff ? (frozenHomeSeriesRecord ?? homeSeriesRecord) : (frozenHomeTeamRecord ?? homeTeamRecord) }}
                  </span>
                </div>
              </div>
              </div>
              <!-- Game Date + (for playoff games) round indicator -->
              <div class="broadcast-date">
                <template v-if="game.is_playoff && playoffRoundLabel">
                  <span class="broadcast-playoff-pill">
                    <Trophy :size="11" class="broadcast-playoff-icon" />
                    <span class="broadcast-playoff-label">{{ playoffRoundLabel }}</span>
                    <span v-if="game.playoff_game_number" class="broadcast-playoff-game">
                      <!-- i18n-ignore -->
                      &middot; {{ $t('Game {n}', { n: game.playoff_game_number }) }}
                    </span>
                  </span>
                  <!-- i18n-ignore -->
                  <span class="broadcast-date-sep">&middot;</span>
                </template>
                <span>{{ formatDate(game.game_date) }}</span>
              </div>
            </div>

            <!-- Live band: court column + live stats. The vertical momentum
                 rail now lives inside the court column, left of the canvas. -->
            <template v-if="hasAnimationData">
            <div class="live-main-row">

            <!-- Court and Live Stats Row -->
            <div class="court-stats-row">
              <!-- Animated Court with Overlays -->
              <div class="court-container court-in-broadcast">
              <!-- Momentum rail: left of the canvas, stretching the full
                   height of the court column (co-strip top → canvas bottom).
                   User's team is always the top token/fill. -->
              <MomentumRail
                data-tour="game-live-momentum"
                :user-momentum="userIsHome ? currentHomeMomentum : currentAwayMomentum"
                :opp-momentum="userIsHome ? currentAwayMomentum : currentHomeMomentum"
                :user-color="(userIsHome ? homeTeam : awayTeam)?.primary_color || '#6B7280'"
                :opp-color="(userIsHome ? awayTeam : homeTeam)?.primary_color || '#6B7280'"
                :user-abbr="(userIsHome ? homeTeam : awayTeam)?.abbreviation || ''"
                :opp-abbr="(userIsHome ? awayTeam : homeTeam)?.abbreviation || ''"
              />
              <div class="court-col">
              <!-- Coach Overview strip: the old animation-controls slot —
                   canvas width, two thin rows (contextual strip + on-court
                   stamina/matchup minis). -->
              <CoachOverview
                data-tour="game-live-coach"
                :coach="userCoach"
                :campaign-id="campaignId"
                :team-city="userTeam?.city || ''"
                :team-name="userTeam?.name || ''"
                :team-color="userTeam?.primary_color || '#6B7280'"
                :offense-label="getOffenseLabel(selectedOffense)"
                :defense-label="getDefenseLabel(selectedDefense)"
                :is-stoppage="showBreakControls || timeoutActive"
                :timeouts-remaining="lastKnownTimeouts"
                :timeout-armed="timeoutRequested"
                :allow-timeout="timeoutAvailable"
                :allow-subs="isLiveMode && !gameJustCompleted"
                :simulating="simulating"
                @continue="handleSegmentContinue"
                @toggle-timeout="toggleTimeoutRequest"
                @open-subs="openCoachesSubs"
                @open-adjust="openCoachesAdjust"
              />

              <!-- The canvas box: positioning anchor so the coaches overlay
                   spans exactly the court, nothing else. -->
              <div class="court-canvas-wrap" data-tour="game-live-court">
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
                :show-trails="!currentPossession?.is_free_throw"
                :play-name="hasAnimationData ? currentPlayName : ''"
                :play-description="hasAnimationData ? currentDescription : ''"
                :play-team-abbreviation="currentTeam === 'home' ? homeTeam?.abbreviation : awayTeam?.abbreviation"
                :play-team-color="currentTeam === 'home' ? homeTeam?.primary_color : awayTeam?.primary_color"
                :play-team-is-away="currentTeam === 'away'"
                :game-clock="gameClock"
                :activated-badges="currentActivatedBadges"
                :activated-synergies="currentActivatedSynergies"
                :stoppage-mode="showBreakControls"
                :stoppage-result="stoppageResultText"
                :allow-subs="currentBreakInfo?.allowSubs ?? false"
                :simulating="simulating"
                :timeout-mode="timeoutActive"
                :timeout-seconds-left="timeoutSecondsLeft"
                @stoppage-subs="openCoachesSubs"
                @stoppage-adjust="openCoachesAdjust"
                @stoppage-continue="handleSegmentContinue"
                @timeout-complete="onTimeoutComplete"
              />

              <!-- Coaches Overlay: tabbed subs / coach settings / matchups
                   spanning exactly the court canvas. Openable any time in a
                   live game — edits ride the next Continue (the engine
                   applies them at the next segment, i.e. the next available
                   opportunity). Styled in the co-strip's compact language. -->
              <Transition name="fade">
                <div v-if="showCoachesOverlay" class="coaches-overlay" data-tour="game-live-coaches-panel">
                  <header class="coaches-overlay-header">
                    <div class="coaches-tabs">
                      <button class="coaches-tab" :class="{ active: coachesTab === 'settings' }" @click="coachesTab = 'settings'">{{ $t('Settings') }}</button>
                      <button class="coaches-tab" :class="{ active: coachesTab === 'matchups' }" @click="coachesTab = 'matchups'">{{ $t('Matchups') }}</button>
                      <button class="coaches-tab" :class="{ active: coachesTab === 'subs' }" @click="coachesTab = 'subs'; expandedSwapPlayer = null">{{ $t('Subs') }}</button>
                    </div>
                    <button class="coaches-overlay-close" aria-label="Close" @click="closeCoachesOverlay">
                      <X :size="14" />
                    </button>
                  </header>

                  <!-- Foul-out prompt: engine already auto-subbed a fallback;
                       user confirms/overrides. -->
                  <div v-if="fouledOutNames.length" class="qb-foulout-banner coaches-foulout">
                    <strong>{{ fouledOutNames.join(', ') }}</strong>
                    {{ $t('fouled out — a replacement was auto-selected. Review your lineup before continuing.') }}
                  </div>

                  <div class="coaches-overlay-body">
                    <!-- Settings tab: offense / defense scheme pills -->
                    <template v-if="coachesTab === 'settings'">
                      <div class="strategy-row">
                        <div class="strategy-group">
                          <span class="strategy-label">{{ $t('Offense') }}</span>
                          <div class="strategy-pills">
                            <button
                              v-for="style in offensiveStyles"
                              :key="style.value"
                              class="strategy-pill"
                              :class="{ active: selectedOffense === style.value }"
                              @click="selectedOffense = style.value"
                            >
                              <span class="strategy-pill-label">{{ $tDynamic(style.label) }}</span>
                              <span class="strategy-pill-fit">{{ fitFor(style.value) }}%</span>
                            </button>
                          </div>
                        </div>
                        <div class="strategy-group">
                          <span class="strategy-label">{{ $t('Defense') }}</span>
                          <div class="strategy-pills">
                            <button
                              v-for="style in defensiveStyles"
                              :key="style.value"
                              class="strategy-pill"
                              :class="{ active: selectedDefense === style.value }"
                              @click="selectedDefense = style.value"
                            >
                              <span class="strategy-pill-label">{{ $tDynamic(style.label) }}</span>
                              <span class="strategy-pill-fit">{{ fitFor(style.value) }}%</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </template>

                    <!-- Matchups tab: compact swap editor -->
                    <template v-else-if="coachesTab === 'matchups'">
                      <DefensiveMatchupEditor
                        v-model="defensiveMatchups"
                        :opponent-starters="opponentOffense"
                        :defenders="userDefenders"
                        :compact="true"
                      />
                    </template>

                    <!-- Subs tab: lineup cards + contextual swap dropdowns -->
                    <template v-else>
                      <div class="lineup-cards-section">
                        <div class="lineup-cards-header">
                          <span class="lineup-cards-title">
                            {{ $t('Current Lineup') }}
                            <span v-if="totalLineupSynergyCount > 0" class="synergy-count-badge">
                              <Zap :size="11" />{{ totalLineupSynergyCount }}
                            </span>
                          </span>
                          <span class="lineup-cards-hint">{{ $t('Tap swap icon to make changes') }}</span>
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
                            @click="toggleSwapDropdown(slot.slotIndex)"
                          >
                            <!-- Empty Slot -->
                            <template v-if="!slot.player">
                              <div class="lineup-card-empty">
                                <span class="slot-position-badge">{{ slot.slotPosition }}</span>
                                <span class="empty-text">{{ $t('Empty') }}</span>
                                <!-- Visual affordance only — the whole card is the click target. -->
                                <button class="swap-btn" tabindex="-1">
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
                                    <span class="lineup-fatigue" :style="{ color: getFatigueColor(slot.player.fatigue || 0) }">{{ Math.round(slot.player.fatigue || 0) }}%</span>
                                  </div>
                                  <span class="lineup-inline-stats">
                                    {{ slot.player.points || 0 }}p {{ slot.player.rebounds || 0 }}r {{ slot.player.assists || 0 }}a
                                  </span>
                                </div>
                                <div class="lineup-card-actions">
                                  <span v-if="getPlayerSynergyCount(slot.player) > 0" class="lineup-synergy-indicator">
                                    <Zap :size="11" />{{ getPlayerSynergyCount(slot.player) }}
                                  </span>
                                  <!-- Shooter mid-FT-trip is locked in (real rule) -->
                                  <span
                                    v-if="isLockedFtShooterSlot(slot.slotIndex)"
                                    class="ft-shooter-lock"
                                    :title="$t('At the line — cannot be substituted until the free throws are complete')"
                                  >
                                    🏀 {{ $t('At the line') }}
                                  </span>
                                  <!-- Visual affordance only — the whole card is the click target. -->
                                  <button
                                    v-else
                                    class="swap-btn"
                                    :class="{ active: expandedSwapPlayer === slot.slotIndex }"
                                    tabindex="-1"
                                  >
                                    <ArrowUpDown :size="14" />
                                  </button>
                                  <span class="lineup-player-ovr">{{ slot.player.overall_rating }}</span>
                                </div>
                              </div>
                            </template>

                            <!-- Swap Dropdown -->
                            <Transition name="dropdown-slide">
                              <!-- @click.stop: picks inside the dropdown must not
                                   bubble to the card and re-toggle it. -->
                              <div v-if="expandedSwapPlayer === slot.slotIndex" class="swap-dropdown" @click.stop>
                                <div class="swap-dropdown-header">
                                  {{ slot.player ? $t('Replace {name}', { name: slot.player.name }) : $t('Select {pos}', { pos: slot.slotPosition }) }}
                                </div>
                                <div class="swap-dropdown-list">
                                  <!-- Available bench players -->
                                  <button
                                    v-for="candidate in getSwapCandidates(slot.slotPosition, slot.slotIndex)"
                                    :key="candidate.player_id"
                                    class="swap-option"
                                    :class="{ injured: candidate.is_injured || candidate.isInjured, 'has-synergy': getCandidateSynergyCount(candidate, slot.slotIndex) > 0 }"
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
                                      <span class="swap-option-fatigue" :style="{ color: getFatigueColor(candidate.fatigue || 0) }">{{ Math.round(candidate.fatigue || 0) }}%</span>
                                    </div>
                                    <span class="swap-option-stats">
                                      {{ candidate.points || 0 }}p {{ candidate.rebounds || 0 }}r
                                    </span>
                                    <span v-if="getCandidateSynergyCount(candidate, slot.slotIndex) > 0" class="swap-synergy-badge">
                                      <Zap :size="10" />{{ getCandidateSynergyCount(candidate, slot.slotIndex) }}
                                    </span>
                                    <span class="swap-option-ovr">{{ candidate.overall_rating }}</span>
                                  </button>
                                  <div v-if="getSwapCandidates(slot.slotPosition, slot.slotIndex).length === 0" class="swap-empty">
                                    {{ $t('No eligible players') }}
                                  </div>
                                </div>
                              </div>
                            </Transition>
                          </div>
                        </div>
                      </div>
                    </template>
                  </div>

                  <footer class="coaches-overlay-actions">
                    <span v-if="timeoutActive" class="coaches-timeout-status">
                      {{ $t('Timeout · 0:{s}', { s: String(Math.max(0, timeoutSecondsLeft)).padStart(2, '0') }) }}
                    </span>
                    <span
                      v-if="liveEditsPending && !(isSegmentPause || isQuarterBreak)"
                      class="coaches-overlay-note"
                    >
                      {{ $t('Changes take effect after the current play') }}
                    </span>
                    <!-- Quarter break: closing returns to the break recap modal
                         (it re-shows itself when the overlay drops). -->
                    <button
                      v-if="isQuarterBreak"
                      class="coaches-overlay-done"
                      @click="closeCoachesOverlay"
                    >
                      ◂ {{ $t('Back to Break') }}
                    </button>
                    <button
                      v-if="isSegmentPause || isQuarterBreak"
                      class="coaches-overlay-continue"
                      :disabled="simulating"
                      @click="handleCoachesOverlayContinue"
                    >
                      <span v-if="simulating" class="qb-btn-loading"></span>
                      <span v-else>{{ $t('Continue') }} ▸</span>
                    </button>
                    <button
                      v-if="!isSegmentPause && !isQuarterBreak"
                      class="coaches-overlay-done"
                      @click="closeCoachesOverlay"
                    >
                      {{ $t('Done') }}
                    </button>
                  </footer>
                </div>
              </Transition>
              </div><!-- .court-canvas-wrap -->

              <!-- Minimal playback controls — a compact strip directly under the court. -->
              <div class="court-play-controls court-play-controls-strip" data-tour="game-live-controls">
                <button
                  class="cpc-btn cpc-circle"
                  @click="togglePlayPause"
                  :title="isPlaying ? $t('Pause') : $t('Play')"
                >
                  <Play v-if="!isPlaying" :size="15" fill="currentColor" />
                  <Pause v-else :size="15" fill="currentColor" />
                </button>
                <button
                  class="cpc-btn cpc-speed"
                  @click="cycleSpeed"
                  :title="$t('Playback speed — tap to change ({speed}x)', { speed: playbackSpeed })"
                >
                  <span class="cpc-chevrons">{{ speedChevrons }}</span>{{ playbackSpeed }}x
                </button>
                <button
                  class="cpc-btn cpc-circle cpc-mute"
                  :class="{ 'is-muted': audioStore.gameMuted }"
                  @click="toggleGameMute"
                  :title="audioStore.gameMuted ? $t('Unmute game sounds') : $t('Mute game sounds')"
                >
                  <VolumeX v-if="audioStore.gameMuted" :size="15" />
                  <Volume2 v-else :size="15" />
                </button>
              </div>

              <!-- Quarter Break / Game Complete Overlay (break info only —
                   coaching tools live in the coaches overlay above) -->
              <Transition name="fade">
                <div v-if="isQuarterBreak && !showCoachesOverlay" class="qb-modal-overlay">
                  <div class="qb-modal-container">
                    <!-- Header -->
                    <header class="qb-modal-header" :class="{ 'game-complete-header': gameJustCompleted || completedQuarter >= 4, 'qb-header-with-action': !(gameJustCompleted || completedQuarter >= 4) }">
                      <!-- Game Complete Header (use completedQuarter >= 4 as fallback) -->
                      <template v-if="gameJustCompleted || completedQuarter >= 4">
                        <h2 class="qb-modal-title game-complete">{{ $t('Final') }}</h2>
                        <button class="qb-header-btn" @click="viewBoxScore">
                          {{ $t('View Box Score') }}
                        </button>
                      </template>
                      <!-- Quarter Break Header -->
                      <template v-else>
                        <h2 class="qb-modal-title">{{ $t('End of Q{n}', { n: completedQuarter }) }}</h2>
                        <button
                          v-if="isLiveMode"
                          class="qb-header-continue-btn"
                          :disabled="simulating"
                          @click="handleQuarterBreakContinue"
                        >
                          <span v-if="simulating" class="qb-btn-loading"></span>
                          <template v-else>
                            <span>{{ $t('Continue') }}</span>
                            <ChevronRight :size="18" />
                          </template>
                        </button>
                      </template>
                    </header>

                    <!-- Content -->
                    <main class="qb-modal-content">
                      <!-- Score Display - Cosmic Theme -->
                      <div class="qb-score-card card-cosmic">
                        <div class="qb-matchup">
                          <!-- Away Team -->
                          <div class="qb-matchup-team">
                            <div
                              class="qb-team-badge away-team"
                              :style="{ '--team-color': awayTeam?.primary_color || '#666' }"
                            >
                              <span class="qb-badge-abbr">{{ awayTeam?.abbreviation }}</span>
                              <span class="qb-badge-record">
                                {{ game.is_playoff ? awaySeriesRecord : awayTeamRecord }}
                              </span>
                            </div>
                            <span class="qb-team-name">{{ awayTeam?.name }}</span>
                          </div>

                          <!-- Score -->
                          <div class="qb-score-center">
                            <div class="qb-scores">
                              <span class="qb-score away">{{ displayAwayScore }}</span>
                              <span class="qb-score-divider">-</span>
                              <span class="qb-score home">{{ displayHomeScore }}</span>
                            </div>
                          </div>

                          <!-- Home Team -->
                          <div class="qb-matchup-team">
                            <div
                              class="qb-team-badge"
                              :style="{ '--team-color': homeTeam?.primary_color || '#666' }"
                            >
                              <span class="qb-badge-abbr">{{ homeTeam?.abbreviation }}</span>
                              <span class="qb-badge-record">
                                {{ game.is_playoff ? homeSeriesRecord : homeTeamRecord }}
                              </span>
                            </div>
                            <span class="qb-team-name">{{ homeTeam?.name }}</span>
                          </div>
                        </div>
                      </div>

                      <!-- Top Players (per team) — quick read of who's been
                           carrying the night. Hidden at game-complete to
                           avoid duplicating the postgame leaders panel. -->
                      <div
                        v-if="!gameJustCompleted && completedQuarter < 4 && (topAwayPlayer || topHomePlayer)"
                        class="qb-top-players-card"
                      >
                        <div class="qb-top-players-label">{{ $t('Top Performers') }}</div>
                        <div class="qb-top-players-grid">
                          <!-- Away top -->
                          <div class="qb-top-player-block away" :style="{ '--team-color': awayTeam?.primary_color || '#666' }">
                            <div class="qb-top-player-team">{{ awayTeam?.abbreviation }}</div>
                            <template v-if="topAwayPlayer">
                              <div class="qb-top-player-row">
                                <PlayerAvatar :player="topAwayPlayer" :size="36" />
                                <span class="qb-top-player-name">{{ topAwayPlayer.name }}</span>
                              </div>
                              <div class="qb-top-player-stats">
                                <span class="qb-top-stat"><b>{{ topAwayPlayer.points || 0 }}</b>PTS</span>
                                <span class="qb-top-stat"><b>{{ topAwayPlayer.rebounds || 0 }}</b>REB</span>
                                <span class="qb-top-stat"><b>{{ topAwayPlayer.assists || 0 }}</b>AST</span>
                                <span class="qb-top-stat"><b>{{ topAwayPlayer.steals || 0 }}</b>STL</span>
                                <span class="qb-top-stat"><b>{{ topAwayPlayer.blocks || 0 }}</b>BLK</span>
                              </div>
                            </template>
                            <div v-else class="qb-top-player-empty">—</div>
                          </div>
                          <!-- Home top -->
                          <div class="qb-top-player-block home" :style="{ '--team-color': homeTeam?.primary_color || '#666' }">
                            <div class="qb-top-player-team">{{ homeTeam?.abbreviation }}</div>
                            <template v-if="topHomePlayer">
                              <div class="qb-top-player-row">
                                <PlayerAvatar :player="topHomePlayer" :size="36" />
                                <span class="qb-top-player-name">{{ topHomePlayer.name }}</span>
                              </div>
                              <div class="qb-top-player-stats">
                                <span class="qb-top-stat"><b>{{ topHomePlayer.points || 0 }}</b>PTS</span>
                                <span class="qb-top-stat"><b>{{ topHomePlayer.rebounds || 0 }}</b>REB</span>
                                <span class="qb-top-stat"><b>{{ topHomePlayer.assists || 0 }}</b>AST</span>
                                <span class="qb-top-stat"><b>{{ topHomePlayer.steals || 0 }}</b>STL</span>
                                <span class="qb-top-stat"><b>{{ topHomePlayer.blocks || 0 }}</b>BLK</span>
                              </div>
                            </template>
                            <div v-else class="qb-top-player-empty">—</div>
                          </div>
                        </div>
                      </div>

                      <!-- Coaching Adjustments — the tools now live in the
                           coaches overlay; this swaps the modal for it (the
                           modal returns when the overlay closes). -->
                      <div v-if="isLiveMode && !gameJustCompleted && completedQuarter < 4" class="qb-coaching-section">
                        <button
                          class="qb-subs-btn"
                          @click="openCoachesAdjust"
                        >
                          <Users :size="18" />
                          <span>{{ $t('Subs & Adjustments') }}</span>
                        </button>

                        <button
                          class="qb-sim-to-end-btn"
                          :disabled="simulating"
                          @click="handleSimToEnd"
                        >
                          <span v-if="simulating" class="qb-btn-loading"></span>
                          <template v-else>
                            <FastForward :size="20" />
                            <span>{{ $t('Sim to End') }}</span>
                          </template>
                        </button>
                      </div>

                      <!-- Replay mode: show continue button (only for Q1-Q3) -->
                      <div v-if="!isLiveMode && !gameJustCompleted && completedQuarter < 4" class="qb-replay-mode">
                        <p class="qb-replay-hint">{{ $t('Replay mode - no adjustments available') }}</p>
                        <button
                          class="qb-replay-btn"
                          @click="handleQuarterBreakContinue"
                        >
                          {{ $t('Continue') }}
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
              </div><!-- .court-col -->

              </div>

              <!-- Live Stats Panel -->
              <div class="live-stats-panel" data-tour="game-live-stats">
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
                        <div class="live-stat-name">
                          <span class="live-stat-lastname">{{ player.name?.split(' ').pop() }}</span>
                          <span
                            v-if="player.fatigue != null"
                            class="live-stat-fatigue"
                            :style="{ color: getFatigueColor(player.fatigue) }"
                          >({{ Math.round(player.fatigue) }}%)</span>
                        </div>
                        <div class="live-stat-line">
                          <span class="stat-item">
                            <strong class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'points') }">{{ player.points || 0 }}</strong>
                            <!-- i18n-ignore -->
                            pts
                          </span>
                          <span class="stat-item">
                            <span class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'assists') }">{{ player.assists || 0 }}</span>
                            <!-- i18n-ignore -->
                            ast
                          </span>
                          <span class="stat-item">
                            <span class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'rebounds') }">{{ player.rebounds || 0 }}</span>
                            <!-- i18n-ignore -->
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
                        <div class="live-stat-name">
                          <span class="live-stat-lastname">{{ player.name?.split(' ').pop() }}</span>
                          <span
                            v-if="player.fatigue != null"
                            class="live-stat-fatigue"
                            :style="{ color: getFatigueColor(player.fatigue) }"
                          >({{ Math.round(player.fatigue) }}%)</span>
                        </div>
                        <div class="live-stat-line">
                          <span class="stat-item">
                            <strong class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'points') }">{{ player.points || 0 }}</strong>
                            <!-- i18n-ignore -->
                            pts
                          </span>
                          <span class="stat-item">
                            <strong class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'assists') }">{{ player.assists || 0 }}</strong>
                            <!-- i18n-ignore -->
                            ast
                          </span>
                          <span class="stat-item">
                            <strong class="stat-value" :class="{ 'stat-pop': isStatAnimating(player.player_id, 'rebounds') }">{{ player.rebounds || 0 }}</strong>
                            <!-- i18n-ignore -->
                            reb
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>

            <!-- Collapsible Live Box Score (hidden during quarter break) -->
            <div v-show="!isQuarterBreak" class="live-box-score-toggle" @click="showLiveBoxScore = !showLiveBoxScore">
              <span class="toggle-label">{{ $t('Full Box Score') }}</span>
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
                          {{ $tDynamic(col.label) }}{{ getLiveBoxSortIcon(col.key) }}
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
                              <span v-if="onCourtPlayerIds.map(id => String(id)).includes(String(player.player_id))" class="on-court-badge">{{ $t('ON') }}</span>
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
                            {{ $t('Show {n} more players', { n: hiddenLiveBoxPlayerCount }) }}
                          </button>
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr class="totals-row">
                        <td class="player-col">{{ $t('TOTALS') }}</td>
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
            <div v-else-if="!hasAnimationData" class="game-loading-placeholder">
              <LoadingSpinner size="lg" />
              <span class="text-secondary">{{ $t('Preparing game simulation...') }}</span>
            </div>
          </GlassCard>
        </template>

        <!-- Pre-game Setup View (when not simulating) -->
        <template v-else>
          <div class="pregame-layout">
            <!-- Court Preview with Starters Overlay -->
            <GlassCard padding="lg" :hoverable="false" class="pregame-court-card">
              <h3 class="h4 mb-4">{{ $t('Starting Lineups') }}</h3>
              <div class="court-container court-container-with-overlay" data-tour="game-court">
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
                        <div class="starter-avatar-wrap">
                          <PlayerAvatar :player="player" :size="36" class="starter-avatar" />
                          <span
                            class="starter-pos-badge"
                            :style="{ backgroundColor: getPositionColor(player.slotPosition) }"
                          >{{ player.slotPosition }}</span>
                        </div>
                        <span class="starter-name">{{ player.last_name || player.lastName || player.name?.split(' ').pop() }}</span>
                        <span class="starter-ovr-badge">{{ player.overall_rating || player.overallRating }}</span>
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
                        <div class="starter-avatar-wrap">
                          <PlayerAvatar :player="player" :size="36" class="starter-avatar" />
                          <span
                            class="starter-pos-badge"
                            :style="{ backgroundColor: getPositionColor(player.slotPosition) }"
                          >{{ player.slotPosition }}</span>
                        </div>
                        <span class="starter-name">{{ player.last_name || player.lastName || player.name?.split(' ').pop() }}</span>
                        <span class="starter-ovr-badge">{{ player.overall_rating || player.overallRating }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <!-- Substitutions Button — pulled up from the settings card so
                   it sits directly underneath the canvas. Toggles its own
                   inline dropdown (below) instead of swapping the strategy
                   card's content. Only shown for the user's own games. -->
              <button
                v-if="isUserGame"
                class="qb-subs-btn court-card-subs-btn"
                :class="{ active: showSubsDropdown }"
                data-tour="game-subs-btn"
                @click="showSubsDropdown = !showSubsDropdown"
              >
                <Users :size="18" />
                <span>{{ $t('Substitutions') }}</span>
                <ChevronDown
                  :size="16"
                  class="court-card-subs-chevron"
                  :class="{ open: showSubsDropdown }"
                />
              </button>

              <!-- Inline dropdown panel: same lineup-cards markup the
                   live-game subs view uses, rendered contextually under the
                   button so the strategy card on the right keeps showing the
                   strategy pills. -->
              <Transition name="dropdown-slide">
                <div v-if="isUserGame && showSubsDropdown" class="court-card-subs-dropdown" data-tour="game-subs-dropdown">
                  <div class="lineup-cards-section">
                    <div class="lineup-cards-header">
                      <span class="lineup-cards-title">{{ $t('Starting Lineup') }}</span>
                      <span class="lineup-cards-hint">{{ $t('Tap swap icon to make changes') }}</span>
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
                        <template v-if="!slot.player">
                          <div class="lineup-card-empty">
                            <span class="slot-position-badge">{{ slot.slotPosition }}</span>
                            <span class="empty-text">{{ $t('Empty') }}</span>
                            <button class="swap-btn" @click="toggleSwapDropdown(slot.slotIndex)">
                              <ArrowUpDown :size="14" />
                            </button>
                          </div>
                        </template>
                        <template v-else>
                          <div class="lineup-card-header">
                            <span class="slot-position-badge" :style="{ backgroundColor: getPositionColor(slot.slotPosition) }">
                              {{ slot.slotPosition }}
                            </span>
                            <div class="lineup-player-info">
                              <div class="lineup-player-name-row">
                                <span class="lineup-player-name">{{ slot.player.name }}</span>
                                <span class="lineup-fatigue" :style="{ color: getFatigueColor(slot.player.fatigue || 0) }">{{ Math.round(slot.player.fatigue || 0) }}%</span>
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
                        <Transition name="dropdown-slide">
                          <div v-if="expandedSwapPlayer === slot.slotIndex" class="swap-dropdown">
                            <div class="swap-dropdown-header">
                              {{ slot.player ? $t('Replace {name}', { name: slot.player.name }) : $t('Select {pos}', { pos: slot.slotPosition }) }}
                            </div>
                            <div class="swap-dropdown-list">
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
                                  <span class="swap-option-fatigue" :style="{ color: getFatigueColor(candidate.fatigue || 0) }">{{ Math.round(candidate.fatigue || 0) }}%</span>
                                </div>
                                <span class="swap-option-ovr">{{ candidate.overall_rating }}</span>
                              </button>
                              <div v-if="getPreGameSwapCandidates(slot.slotPosition, slot.slotIndex).length === 0" class="swap-empty">
                                {{ $t('No eligible players') }}
                              </div>
                            </div>
                          </div>
                        </Transition>
                      </div>
                    </div>
                  </div>
                </div>
              </Transition>
              <!-- Coaches row: pulled OUT of the canvas overlay into its own
                   strip beneath the court so each coach card sits aligned
                   under its team's starters column. -->
              <h4 class="coaches-row-label">{{ $t('Head Coaches') }}</h4>
              <div class="coaches-row" data-tour="game-coaches">
                <div v-if="awayTeamCoach" class="team-coach-card">
                  <div class="team-coach-top">
                    <div class="team-coach-avatar-wrap">
                      <CoachAvatar :coach="awayTeamCoach" :size="40" :campaign-id="campaignId" class="team-coach-avatar" />
                      <span
                        v-if="awayTeam?.abbreviation"
                        class="team-coach-team-badge"
                        :style="{ backgroundColor: awayTeam?.primary_color || '#666' }"
                      >{{ awayTeam.abbreviation }}</span>
                    </div>
                    <div class="team-coach-info">
                      <span class="team-coach-name">{{ awayTeamCoach.name }}</span>
                      <span v-if="awayTeamCoach.overall_rating" class="team-coach-ovr">{{ awayTeamCoach.overall_rating }} OVR</span>
                      <div v-if="topCoachBadges(awayTeamCoach).length" class="team-coach-badges">
                        <span
                          v-for="badge in topCoachBadges(awayTeamCoach)"
                          :key="badge.id"
                          class="team-coach-badge-chip"
                          :class="'level-' + badge.level"
                        >
                          {{ $tDynamic(badge.id.replace(/_/g, ' ')) }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <!-- Current Off/Def schemes, lifted out of the starters
                       overlay so each team's settings sit with its coach. -->
                  <div class="team-coach-schemes">
                    <div class="coach-scheme-row">
                      <span class="coach-scheme-label">{{ $t('Off') }}</span>
                      <span class="coach-scheme-value">{{ $tDynamic(getOffenseLabel(!userIsHome && isUserGame ? selectedOffense : awayTeam?.coaching_scheme?.offensive)) }}</span>
                    </div>
                    <div class="coach-scheme-row">
                      <span class="coach-scheme-label">{{ $t('Def') }}</span>
                      <span class="coach-scheme-value">{{ $tDynamic(getDefenseLabel(!userIsHome && isUserGame ? selectedDefense : awayTeam?.coaching_scheme?.defensive)) }}</span>
                    </div>
                  </div>
                </div>
                <div v-else class="team-coach-card team-coach-placeholder"></div>
                <div v-if="homeTeamCoach" class="team-coach-card">
                  <div class="team-coach-top">
                    <div class="team-coach-avatar-wrap">
                      <CoachAvatar :coach="homeTeamCoach" :size="40" :campaign-id="campaignId" class="team-coach-avatar" />
                      <span
                        v-if="homeTeam?.abbreviation"
                        class="team-coach-team-badge"
                        :style="{ backgroundColor: homeTeam?.primary_color || '#666' }"
                      >{{ homeTeam.abbreviation }}</span>
                    </div>
                    <div class="team-coach-info">
                      <span class="team-coach-name">{{ homeTeamCoach.name }}</span>
                      <span v-if="homeTeamCoach.overall_rating" class="team-coach-ovr">{{ homeTeamCoach.overall_rating }} OVR</span>
                      <div v-if="topCoachBadges(homeTeamCoach).length" class="team-coach-badges">
                        <span
                          v-for="badge in topCoachBadges(homeTeamCoach)"
                          :key="badge.id"
                          class="team-coach-badge-chip"
                          :class="'level-' + badge.level"
                        >
                          {{ $tDynamic(badge.id.replace(/_/g, ' ')) }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div class="team-coach-schemes">
                    <div class="coach-scheme-row">
                      <span class="coach-scheme-label">{{ $t('Off') }}</span>
                      <span class="coach-scheme-value">{{ $tDynamic(getOffenseLabel(userIsHome && isUserGame ? selectedOffense : homeTeam?.coaching_scheme?.offensive)) }}</span>
                    </div>
                    <div class="coach-scheme-row">
                      <span class="coach-scheme-label">{{ $t('Def') }}</span>
                      <span class="coach-scheme-value">{{ $tDynamic(getDefenseLabel(userIsHome && isUserGame ? selectedDefense : homeTeam?.coaching_scheme?.defensive)) }}</span>
                    </div>
                  </div>
                </div>
                <div v-else class="team-coach-card team-coach-placeholder"></div>
              </div>
            </GlassCard>

            <!-- Game Settings Card - Styled like Quarter Break Modal -->
            <GlassCard padding="lg" :hoverable="false" class="pregame-settings-card">
              <div class="pregame-coaching-section">
                <h4 v-if="isUserGame" class="strategy-section-label">{{ $t('Game Plan') }}</h4>
                <!-- Strategy Settings - Full Width (only for user's game) -->
                <div v-if="isUserGame" class="qb-strategy-card" data-tour="game-plan">
                  <div class="strategy-row">
                    <div class="strategy-group">
                      <span class="strategy-label">{{ $t('Offense') }}</span>
                      <div class="strategy-pills">
                        <button
                          v-for="style in offensiveStyles"
                          :key="style.value"
                          class="strategy-pill"
                          :class="{ active: selectedOffense === style.value }"
                          @click="selectedOffense = style.value"
                        >
                          <span class="strategy-pill-label">{{ $tDynamic(style.label) }}</span>
                          <span class="strategy-pill-fit">{{ fitFor(style.value) }}%</span>
                        </button>
                      </div>
                    </div>
                    <div class="strategy-group">
                      <span class="strategy-label">{{ $t('Defense') }}</span>
                      <div class="strategy-pills">
                        <button
                          v-for="style in defensiveStyles"
                          :key="style.value"
                          class="strategy-pill"
                          :class="{ active: selectedDefense === style.value }"
                          @click="selectedDefense = style.value"
                        >
                          <span class="strategy-pill-label">{{ $tDynamic(style.label) }}</span>
                          <span class="strategy-pill-fit">{{ fitFor(style.value) }}%</span>
                        </button>
                      </div>
                    </div>

                    <!-- Pacing: how often the played game pauses for input.
                         Changeable any time from this screen — for a game in
                         progress the new mode takes effect on resume. -->
                    <div class="strategy-group" data-tour="game-pacing">
                      <span class="strategy-label">{{ $t('Pacing') }}</span>
                      <div class="strategy-pills">
                        <button
                          v-for="mode in pacingModes"
                          :key="mode.value"
                          class="strategy-pill"
                          :class="{ active: selectedPacing === mode.value }"
                          @click="selectedPacing = mode.value"
                        >
                          <span class="strategy-pill-label">{{ $tDynamic(mode.label) }}</span>
                        </button>
                      </div>
                      <span class="pacing-hint">
                        {{ selectedPacing === 'quarter' ? $t('Watch a full quarter, adjust at breaks') : selectedPacing === 'play' ? $t('Pause after every possession') : $t('Pause at fouls, out-of-bounds & other stoppages') }}{{ isInProgress ? ' — ' + $t('applies when you resume') : '' }}
                      </span>
                    </div>

                  </div>
                </div>

                <!-- Play Game Button -->
                <button
                  v-if="isUserGame"
                  class="qb-continue-btn pregame-play-btn"
                  :disabled="simulating"
                  data-tour="game-start-btn"
                  @click="handlePlayGame"
                >
                  <span v-if="simulating" class="qb-btn-loading"></span>
                  <template v-else>
                    <Play :size="20" class="pregame-play-icon" />
                    <span class="pregame-play-label">{{ isInProgress ? $t('Resume Game (Q{n})', { n: game?.saved_mid_quarter ? savedQuarter : savedQuarter + 1 }) : $t('START') }}</span>
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
                    <span>{{ $t('Sim to End') }}</span>
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
                    <Play :size="20" class="pregame-play-icon" />
                    <span class="pregame-play-label">{{ isInProgress ? $t('Resume Simulation') : $t('Simulate Game') }}</span>
                  </template>
                </button>
              </div>
            </GlassCard>

            <!-- Defensive Matchups — own card, always expanded (swap who guards whom) -->
            <GlassCard
              v-if="isUserGame"
              padding="lg"
              :hoverable="false"
              class="pregame-matchups-card"
              data-tour="game-matchups"
            >
              <h4 class="strategy-section-label">{{ $t('Defensive Matchups') }}</h4>
              <DefensiveMatchupEditor
                v-model="defensiveMatchups"
                :opponent-starters="opponentOffense"
                :defenders="userDefenders"
              />
            </GlassCard>

            <!-- Opponent Analytics — obscured (not hidden) until a Level 4 analyst
                 AND an Analytics Facility at the perk's required level, so users
                 see what they're missing and are nudged to hire the analyst.
                 Wrapped so it spaces like the other grid cards and clears the
                 fixed "pop-in" START button below it. -->
            <div v-if="isUserGame" class="pregame-analytics">
              <PlayAnalyticsPanel
                :title="$t('Opponent Tendencies — This Season')"
                :analytics="opponentAnalytics"
                :locked="!opponentAnalyticsUnlocked"
                :default-to-top-category="true"
                :locked-message="opponentLockedMessage"
              />
            </div>
          </div>
        </template>
      </template>

      <!-- Post-Game (Completed) -->
      <template v-else>
        <!-- Quarter Scores -->
        <GlassCard padding="md" :hoverable="false" class="mb-6" data-tour="postgame-quarter-scores">
          <div class="quarter-scores">
            <table class="quarters-table">
              <thead>
                <tr>
                  <th class="team-header"></th>
                  <th>Q1</th>
                  <th>Q2</th>
                  <th>Q3</th>
                  <th>Q4</th>
                  <th v-if="quarterScores.home?.length > 4">{{ $t('OT') }}</th>
                  <th class="total-col">{{ $t('Total') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr :class="{ winner: winner === 'away' }">
                  <td class="team-header">{{ awayTeam?.abbreviation }}</td>
                  <td v-for="(score, i) in quarterScores.away" :key="i">{{ score }}</td>
                  <td class="total-col">{{ game.away_score }}</td>
                </tr>
                <tr :class="{ winner: winner === 'home' }">
                  <td class="team-header">{{ homeTeam?.abbreviation }}</td>
                  <td v-for="(score, i) in quarterScores.home" :key="i">{{ score }}</td>
                  <td class="total-col">{{ game.home_score }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </GlassCard>

        <!-- Animated Court Viewer -->
        <GlassCard v-if="showAnimationMode && hasAnimationData" padding="none" :hoverable="false" class="mb-6">
          <!-- Court with animation and overlays -->
          <div class="court-container court-in-replay">
            <!-- Minimal playback controls, pinned bottom-left over the court -->
            <div class="court-play-controls">
              <button
                class="cpc-btn cpc-circle"
                @click="togglePlayPause"
                :title="isPlaying ? 'Pause' : 'Play'"
              >
                <Play v-if="!isPlaying" :size="15" fill="currentColor" />
                <Pause v-else :size="15" fill="currentColor" />
              </button>
              <button
                class="cpc-btn cpc-speed"
                @click="cycleSpeed"
                :title="`Playback speed — tap to change (${playbackSpeed}x)`"
              >
                <span class="cpc-chevrons">{{ speedChevrons }}</span>{{ playbackSpeed }}x
              </button>
              <button
                class="cpc-btn cpc-circle cpc-mute"
                :class="{ 'is-muted': audioStore.gameMuted }"
                @click="toggleGameMute"
                :title="audioStore.gameMuted ? 'Unmute game sounds' : 'Mute game sounds'"
              >
                <VolumeX v-if="audioStore.gameMuted" :size="15" />
                <Volume2 v-else :size="15" />
              </button>
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
              :show-trails="!currentPossession?.is_free_throw"
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
                    <h2 class="quarter-break-title game-complete-title">{{ $t('Final') }}</h2>
                    <p class="game-complete-subtitle">{{ $t('Game Complete') }}</p>
                  </template>
                  <!-- Quarter Break -->
                  <template v-else>
                    <h2 class="quarter-break-title">{{ $t('End of Quarter {n}', { n: completedQuarter }) }}</h2>
                  </template>
                  <div class="quarter-break-score">
                    <div class="break-team">
                      <span class="break-team-name">{{ awayTeam?.name }}</span>
                      <span class="break-team-score" :style="{ color: awayTeam?.primary_color }">
                        {{ displayAwayScore }}
                      </span>
                    </div>
                    <div class="break-divider">-</div>
                    <div class="break-team">
                      <span class="break-team-name">{{ homeTeam?.name }}</span>
                      <span class="break-team-score" :style="{ color: homeTeam?.primary_color }">
                        {{ displayHomeScore }}
                      </span>
                    </div>
                  </div>
                  <!-- Game Complete: View Box Score -->
                  <template v-if="completedQuarter >= 4">
                    <p class="break-hint">{{ $t('View the full box score and game statistics') }}</p>
                    <BaseButton variant="primary" size="lg" @click="viewBoxScore">
                      {{ $t('View Box Score') }}
                    </BaseButton>
                  </template>
                  <!-- Quarter Break: Continue -->
                  <template v-else>
                    <p class="break-hint">{{ $t('Replay mode - click to continue') }}</p>
                    <BaseButton variant="primary" size="lg" @click="handleQuarterBreakContinue">
                      {{ $t('Continue to Quarter {n}', { n: completedQuarter + 1 }) }}
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
            <h3 class="performers-header">{{ $t('{team} Top Performers', { team: awayTeam?.abbreviation }) }}</h3>
            <div class="performers-list">
              <div
                v-for="player in awayTopPerformers"
                :key="player.player_id"
                class="performer-card"
                @click="openPlayerModal(player)"
              >
                <div class="performer-avatar">
                  <PlayerAvatar :player="player" :size="38" class="avatar-icon" />
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
                <!-- i18n-ignore -->
                <div class="performer-chevron">&rsaquo;</div>
              </div>
            </div>
          </GlassCard>

          <GlassCard padding="md" :hoverable="false">
            <h3 class="performers-header">{{ $t('{team} Top Performers', { team: homeTeam?.abbreviation }) }}</h3>
            <div class="performers-list">
              <div
                v-for="player in homeTopPerformers"
                :key="player.player_id"
                class="performer-card"
                @click="openPlayerModal(player)"
              >
                <div class="performer-avatar">
                  <PlayerAvatar :player="player" :size="38" class="avatar-icon" />
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
                <!-- i18n-ignore -->
                <div class="performer-chevron">&rsaquo;</div>
              </div>
            </div>
          </GlassCard>
        </div>

        <!-- Box Score -->
        <GlassCard padding="none" :hoverable="false" class="mb-6" data-tour="postgame-box-score">
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
            {{ $t('Post-Game Summary') }}
          </h3>

          <div class="summary-grid">
            <!-- Rewards Card -->
            <GlassCard v-if="rewardsData" padding="md" :hoverable="false" class="summary-card rewards-card" data-tour="postgame-rewards">
              <h4 class="card-title">
                <Coins :size="16" />
                {{ $t('Rewards Earned') }}
              </h4>
              <div class="rewards-content">
                <div class="reward-item">
                  <span class="reward-label">{{ $t('Synergies Activated') }}</span>
                  <span class="reward-value">{{ rewardsData.synergies_activated || 0 }}</span>
                </div>
                <div class="reward-item highlight">
                  <span class="reward-label">{{ $t('Tokens Earned') }}</span>
                  <span class="reward-value tokens">+{{ rewardsData.tokens_awarded || 0 }}</span>
                </div>
                <div v-if="rewardsData.win_bonus_applied" class="reward-bonus">
                  <Trophy :size="14" />
                  {{ $t('Win bonus applied (2x tokens)') }}
                </div>
              </div>
            </GlassCard>

            <!-- Game Result Card -->
            <GlassCard padding="md" :hoverable="false" class="summary-card result-card">
              <h4 class="card-title">
                <Trophy :size="16" />
                {{ $t('Game Result') }}
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
                  {{ userWon ? $t('Victory!') : $t('Defeat') }}
                </div>
              </div>
            </GlassCard>
          </div>

          <!-- Evolution Data - Home Team -->
          <GlassCard
            v-if="evolutionData?.home && Object.keys(evolutionData.home).length > 0"
            padding="md"
            :hoverable="false"
            class="summary-card evolution-card mb-4"
            :data-tour="userIsHome ? 'postgame-updates' : null"
          >
            <h4 class="card-title">
              <Zap :size="16" />
              {{ $t('{team} Updates', { team: homeTeam?.name }) }}
            </h4>
            <div class="evolution-content">
              <!-- Injuries -->
              <div v-if="evolutionData.home.injuries?.length" class="evolution-section">
                <h5 class="section-label injury-label">
                  <AlertTriangle :size="14" />
                  {{ $t('Injuries') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="injury in evolutionData.home.injuries" :key="injury.player_id" class="evolution-item injury">
                    <span class="player-name">{{ injury.name }}</span>
                    <span class="injury-details">{{ $tDynamic(injury.injury_type) }} - {{ (injury.days_out ?? injury.games_out ?? 0) === 1 ? $t('Out {n} day', { n: injury.days_out ?? injury.games_out ?? 0 }) : $t('Out {n} days', { n: injury.days_out ?? injury.games_out ?? 0 }) }}</span>
                    <span class="severity-badge" :class="injury.severity">{{ $tDynamic(injury.severity) }}</span>
                  </div>
                </div>
              </div>

              <!-- Development -->
              <div v-if="evolutionData.home.development?.length" class="evolution-section">
                <h5 class="section-label positive-label">
                  <TrendingUp :size="14" />
                  {{ $t('Development') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="dev in evolutionData.home.development" :key="dev.player_id" class="evolution-item positive">
                    <span class="player-name">{{ dev.name }}</span>
                    <div class="attr-badges">
                      <span v-for="attr in dev.attributes_improved" :key="attr" class="attr-badge positive">+{{ $tDynamic(formatAttribute(attr)) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Regression -->
              <div v-if="evolutionData.home.regression?.length" class="evolution-section">
                <h5 class="section-label negative-label">
                  <TrendingDown :size="14" />
                  {{ $t('Regression') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="reg in evolutionData.home.regression" :key="reg.player_id" class="evolution-item negative">
                    <span class="player-name">{{ reg.name }}</span>
                    <div class="attr-badges">
                      <span v-for="attr in reg.attributes_declined" :key="attr" class="attr-badge negative">-{{ $tDynamic(formatAttribute(attr)) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Hot Streaks -->
              <div v-if="evolutionData.home.hot_streaks?.length" class="evolution-section">
                <h5 class="section-label hot-label">
                  <Flame :size="14" />
                  {{ $t('Hot Streaks') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="streak in evolutionData.home.hot_streaks" :key="streak.player_id" class="evolution-item hot">
                    <span class="player-name">{{ streak.name }}</span>
                    <span class="streak-info">{{ $t('{n} game streak', { n: streak.games }) }}</span>
                  </div>
                </div>
              </div>

              <!-- Cold Streaks -->
              <div v-if="evolutionData.home.cold_streaks?.length" class="evolution-section">
                <h5 class="section-label cold-label">
                  <Snowflake :size="14" />
                  {{ $t('Cold Streaks') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="streak in evolutionData.home.cold_streaks" :key="streak.player_id" class="evolution-item cold">
                    <span class="player-name">{{ streak.name }}</span>
                    <span class="streak-info">{{ $t('{n} game slump', { n: streak.games }) }}</span>
                  </div>
                </div>
              </div>

              <!-- Fatigue Warnings -->
              <div v-if="evolutionData.home.fatigue_warnings?.length" class="evolution-section">
                <h5 class="section-label warning-label">
                  <Activity :size="14" />
                  {{ $t('Fatigue Warnings') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="warn in evolutionData.home.fatigue_warnings" :key="warn.player_id" class="evolution-item warning">
                    <span class="player-name">{{ warn.name }}</span>
                    <span class="fatigue-bar">
                      <span class="fatigue-fill" :style="{ width: Math.round(warn.fatigue) + '%' }"></span>
                    </span>
                    <span class="fatigue-value">{{ Math.round(warn.fatigue) }}%</span>
                  </div>
                </div>
              </div>

              <!-- Morale Changes -->
              <div v-if="evolutionData.home.morale_changes?.length" class="evolution-section">
                <h5 class="section-label">
                  <Heart :size="14" />
                  {{ $t('Morale Changes') }}
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
          <GlassCard
            v-if="evolutionData?.away && Object.keys(evolutionData.away).length > 0"
            padding="md"
            :hoverable="false"
            class="summary-card evolution-card mb-4"
            :data-tour="!userIsHome ? 'postgame-updates' : null"
          >
            <h4 class="card-title">
              <Zap :size="16" />
              {{ $t('{team} Updates', { team: awayTeam?.name }) }}
            </h4>
            <div class="evolution-content">
              <!-- Injuries -->
              <div v-if="evolutionData.away.injuries?.length" class="evolution-section">
                <h5 class="section-label injury-label">
                  <AlertTriangle :size="14" />
                  {{ $t('Injuries') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="injury in evolutionData.away.injuries" :key="injury.player_id" class="evolution-item injury">
                    <span class="player-name">{{ injury.name }}</span>
                    <span class="injury-details">{{ $tDynamic(injury.injury_type) }} - {{ (injury.days_out ?? injury.games_out ?? 0) === 1 ? $t('Out {n} day', { n: injury.days_out ?? injury.games_out ?? 0 }) : $t('Out {n} days', { n: injury.days_out ?? injury.games_out ?? 0 }) }}</span>
                    <span class="severity-badge" :class="injury.severity">{{ $tDynamic(injury.severity) }}</span>
                  </div>
                </div>
              </div>

              <!-- Development -->
              <div v-if="evolutionData.away.development?.length" class="evolution-section">
                <h5 class="section-label positive-label">
                  <TrendingUp :size="14" />
                  {{ $t('Development') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="dev in evolutionData.away.development" :key="dev.player_id" class="evolution-item positive">
                    <span class="player-name">{{ dev.name }}</span>
                    <div class="attr-badges">
                      <span v-for="attr in dev.attributes_improved" :key="attr" class="attr-badge positive">+{{ $tDynamic(formatAttribute(attr)) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Regression -->
              <div v-if="evolutionData.away.regression?.length" class="evolution-section">
                <h5 class="section-label negative-label">
                  <TrendingDown :size="14" />
                  {{ $t('Regression') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="reg in evolutionData.away.regression" :key="reg.player_id" class="evolution-item negative">
                    <span class="player-name">{{ reg.name }}</span>
                    <div class="attr-badges">
                      <span v-for="attr in reg.attributes_declined" :key="attr" class="attr-badge negative">-{{ $tDynamic(formatAttribute(attr)) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Hot Streaks -->
              <div v-if="evolutionData.away.hot_streaks?.length" class="evolution-section">
                <h5 class="section-label hot-label">
                  <Flame :size="14" />
                  {{ $t('Hot Streaks') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="streak in evolutionData.away.hot_streaks" :key="streak.player_id" class="evolution-item hot">
                    <span class="player-name">{{ streak.name }}</span>
                    <span class="streak-info">{{ $t('{n} game streak', { n: streak.games }) }}</span>
                  </div>
                </div>
              </div>

              <!-- Cold Streaks -->
              <div v-if="evolutionData.away.cold_streaks?.length" class="evolution-section">
                <h5 class="section-label cold-label">
                  <Snowflake :size="14" />
                  {{ $t('Cold Streaks') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="streak in evolutionData.away.cold_streaks" :key="streak.player_id" class="evolution-item cold">
                    <span class="player-name">{{ streak.name }}</span>
                    <span class="streak-info">{{ $t('{n} game slump', { n: streak.games }) }}</span>
                  </div>
                </div>
              </div>

              <!-- Fatigue Warnings -->
              <div v-if="evolutionData.away.fatigue_warnings?.length" class="evolution-section">
                <h5 class="section-label warning-label">
                  <Activity :size="14" />
                  {{ $t('Fatigue Warnings') }}
                </h5>
                <div class="evolution-items">
                  <div v-for="warn in evolutionData.away.fatigue_warnings" :key="warn.player_id" class="evolution-item warning">
                    <span class="player-name">{{ warn.name }}</span>
                    <span class="fatigue-bar">
                      <span class="fatigue-fill" :style="{ width: Math.round(warn.fatigue) + '%' }"></span>
                    </span>
                    <span class="fatigue-value">{{ Math.round(warn.fatigue) }}%</span>
                  </div>
                </div>
              </div>

              <!-- Morale Changes -->
              <div v-if="evolutionData.away.morale_changes?.length" class="evolution-section">
                <h5 class="section-label">
                  <Heart :size="14" />
                  {{ $t('Morale Changes') }}
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
              {{ $t('Game Headlines') }}
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
                  <div class="news-headline">{{ news.headline_tpl ? $tDynamic(news.headline_tpl, news.headline_params) : news.headline }}</div>
                  <div class="news-body">{{ news.body_tpl ? $tDynamic(news.body_tpl, news.body_params) : news.body }}</div>
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
            {{ showPlayByPlay ? $t('Hide Play-by-Play') : $t('Show Play-by-Play') }}
          </BaseButton>
        </div>

        <!-- Play by Play -->
        <GlassCard v-if="showPlayByPlay && playByPlay.length > 0" padding="lg" :hoverable="false">
          <h3 class="h4 mb-4">{{ $t('Play-by-Play') }}</h3>
          <div class="play-by-play">
            <div
              v-for="(play, index) in playByPlay"
              :key="index"
              class="play-item"
              :class="play.type"
            >
              <span class="play-time">{{ play.time }}</span>
              <span class="play-team">{{ play.team }}</span>
              <span class="play-action">{{ play.descTpl ? $tDynamic(play.descTpl, play.descParams) : play.description }}</span>
              <span v-if="play.points" class="play-score">
                {{ play.away_score }} - {{ play.home_score }}
              </span>
            </div>
          </div>
        </GlassCard>

        <!-- Play Analytics (your team, THIS game) — obscured until a Level 3
             analyst AND an Analytics Facility at the perk's required level.
             Kept as the LAST element on the postgame page. -->
        <PlayAnalyticsPanel
          v-if="isUserGame"
          :title="$t('Play Analytics — This Game')"
          :analytics="userGameAnalytics"
          :locked="!postgameAnalyticsUnlocked"
          :default-to-top-category="true"
          :locked-message="postgameLockedMessage"
        />
      </template>
    </template>

    <!-- Player Performance Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showPlayerModal" class="modal-overlay perf-modal-overlay" @click.self="closePlayerModal">
          <div class="modal-container perf-modal-container">
            <header class="modal-header">
              <h2 class="modal-title">{{ selectedPlayer?.name || $t('Player') }}</h2>
              <button class="btn-close" aria-label="Close" @click="closePlayerModal">
                <X :size="20" />
              </button>
            </header>

            <main class="modal-content">
              <div v-if="selectedPlayer" class="player-modal-content">
                <!-- Player Identity Card -->
                <div class="player-modal-identity">
                  <div class="player-avatar-lg">
                    <PlayerAvatar :player="selectedPlayer" :size="64" class="avatar-icon" />
                  </div>
                  <div class="player-identity-meta">
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

                <!-- Game Stats -->
                <div class="game-stats-section">
                  <h4 class="stats-section-title">{{ $t('Game Stats') }}</h4>
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
                      <!-- i18n-ignore -->
                      <span class="game-stat-label">TO</span>
                    </div>
                  </div>
                </div>

                <!-- Shooting Stats -->
                <div class="shooting-stats-section">
                  <h4 class="stats-section-title">{{ $t('Shooting') }}</h4>
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
                  <span class="minutes-label">{{ $t('Minutes Played') }}</span>
                  <span class="minutes-value">{{ selectedPlayer.minutes || 0 }}</span>
                </div>
              </div>
            </main>

            <footer class="modal-footer">
              <button class="btn-cancel" @click="closePlayerModal">{{ $t('Close') }}</button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Simulate Games Modal -->
    <SimulateConfirmModal
      :show="showSimulateModal"
      :preview="gameStore.simulatePreview"
      :loading="gameStore.loadingPreview"
      :simulating="false"
      :background-progress="null"
      :user-team="userTeam"
      :gold-confirm="true"
      @close="handleCloseSimulateModal"
      @confirm="handleConfirmSimulate"
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
            <header class="inj-header">
              <div class="inj-header-left">
                <div class="inj-header-icon">
                  <AlertTriangle :size="18" />
                </div>
                <h2 class="inj-title">{{ $t('Injury Report') }}</h2>
              </div>
              <button class="inj-close" @click="showInjuryModal = false" aria-label="Close">
                <X :size="20" />
              </button>
            </header>

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
                      <span class="inj-type">{{ $tDynamic(injury.injury_type) }}</span>
                      <span class="inj-duration">{{ (injury.days_out ?? injury.games_out ?? 0) === 1 ? $t('{n} day', { n: injury.days_out ?? injury.games_out ?? 0 }) : $t('{n} days', { n: injury.days_out ?? injury.games_out ?? 0 }) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <p class="inj-hint">{{ $t('Injured starters will be automatically benched. Update your lineup to set replacements.') }}</p>
            </main>

            <footer class="inj-footer">
              <!-- Dismiss removed; X close + backdrop click both still
                   exit the modal. Action buttons stay. -->
              <button class="inj-btn-cpu" @click="handleCpuSetLineup">
                <Zap :size="16" />
                {{ $t('CPU Set Lineup') }}
              </button>
              <button class="inj-btn-lineup" @click="goToLineup">
                <Users :size="16" />
                {{ $t('Update Lineup') }}
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
                <h2 class="inj-title">{{ $t('Recovery Report') }}</h2>
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
                      <span class="inj-severity-tag">{{ $t('Cleared') }}</span>
                    </div>
                    <div class="inj-detail-row">
                      <span class="inj-type">{{ $tDynamic(recovery.injury_type) }}</span>
                      <span class="rec-status">{{ $t('Ready to play') }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <p class="inj-hint">{{ $t('These players are healthy and available for your lineup.') }}</p>
            </main>

            <footer class="inj-footer">
              <!-- Dismiss removed; X close + backdrop click both still
                   exit the modal. -->
              <button class="inj-btn-cpu" @click="handleCpuSetLineup">
                <Zap :size="16" />
                {{ $t('CPU Set Lineup') }}
              </button>
              <button class="inj-btn-lineup" @click="goToLineupFromRecovery">
                <Users :size="16" />
                {{ $t('Update Lineup') }}
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <WalkthroughReplayButton
      :walkthrough-key="replayTourKey"
      :class="{ 'wt-above-pregame-cta': replayTourKey === 'gamePreview' }"
    />
  </div>
</template>

<style scoped>
.game-view {
  /* Match the homepage's 16px horizontal gutter so the game preview's
     content cards line up with the floating bottom nav and the home
     view's record / status row. Overrides the template's Tailwind `p-6`
     (24px) on the horizontal axis; vertical padding from `p-6` stays. */
  padding-left: 16px;
  padding-right: 16px;
  padding-bottom: 100px;
  max-width: 1024px;
  margin: 0 auto;
}

/* Mobile: slide the page content up so the header card starts close to
   the top of the viewport (matching the homepage's tighter top padding).
   Overrides Tailwind's p-6 / mb-6 from the template just on mobile widths
   so the back-btn bottom sits close to the game-date row in the card.
   Keep the back-btn above the card on the z-axis since they now nearly
   overlap and the card's glass background was intercepting taps. */
@media (max-width: 1023px) {
  .game-view {
    padding-top: 8px;
    /* Bottom nav (70px) + safe-area + 12px gap + floating Play Game button
       (~50px tall) + 16px breathing room below the last content card. */
    padding-bottom: calc(70px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 12px + 16px);
  }
  .back-btn {
    margin-bottom: 8px;
    position: relative;
    z-index: 2;
  }
}

.page-loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60vh;
}

.page-loading-container :deep(.loading-spinner) {
  width: 64px;
  height: 64px;
}

@media (min-width: 768px) {
  .page-loading-container :deep(.loading-spinner) {
    width: 80px;
    height: 80px;
  }
}

.game-loading-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 400px;
  font-size: 0.85rem;
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
  /* Containing block for the absolute-positioned .game-header-top on desktop. */
  position: relative;
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

/* Cosmic-gradient backdrop washes out the default tertiary/gold text on these
   labels — give them a dark pill so they read clearly. Scoped to the header
   card so other surfaces using these classes (e.g. neutral-bg lists) keep
   their existing styling. */
.game-header-card .game-type-label {
  display: inline-block;
  padding: 3px 10px;
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.85);
  border-radius: var(--radius-full);
  letter-spacing: 0.06em;
}

.game-header-card .game-type-label.playoff {
  color: #ffd700;
}

.game-header-card .series-record-badge {
  background: rgba(0, 0, 0, 0.55);
  border-color: rgba(255, 215, 0, 0.45);
  color: #ffd700;
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

[data-theme="light"] .game-header-card .game-type-label {
  background: rgba(0, 0, 0, 0.65);
  color: rgba(255, 255, 255, 0.95);
}

[data-theme="light"] .game-header-card .game-type-label.playoff {
  color: #ffd700;
}

[data-theme="light"] .game-header-card .series-record-badge {
  background: rgba(0, 0, 0, 0.65);
  border-color: rgba(255, 215, 0, 0.5);
  color: #ffd700;
}

[data-theme="light"] .game-header-card .team-name-text {
  color: black;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

/* Top header inside the game-header-card: date on top, game type label
   stacked below. Pulled out of the center column so mobile has room to
   keep both teams in one row with just VS between them. */
.game-header-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-bottom: 16px;
}

/* Desktop: float the header absolutely so it doesn't consume vertical
   space (matchup row moves up to fill it), while staying visually pinned
   to the top-center of the card where it appeared before. */
@media (min-width: 1024px) {
  .game-header-top {
    position: absolute;
    top: 20px;
    left: 0;
    right: 0;
    margin-bottom: 0;
  }
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
  position: relative;
  overflow: visible;
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
  background: var(--team-color, #6B7280);
}

/* AWAY TEAM TREATMENT: invert so the home/away team logos are visually
   distinct even when their primary colors are similar. Background flips
   to white with the team color showing through the abbreviation/record. */
.team-badge-game.away-team {
  background: #FFFFFF;
  border: 2px solid var(--team-color, #6B7280);
}

.team-badge-game.away-team .badge-abbr,
.team-badge-game.away-team .badge-record {
  color: var(--team-color, #1a1520);
  text-shadow: none;
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
  color: rgba(0, 0, 0, 0.7);
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

/* Desktop-only spacer for playoff previews: the round label + series-record
   badge in .game-header-top overlap the VS text on wide layouts. Drop the
   VS column down so it clears the badge. */
@media (min-width: 1024px) {
  .game-center.is-playoff-preview {
    margin-top: 50px;
  }
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

.game-type-label.playoff {
  color: #ffd700;
}

.series-record-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: #ffd700;
  margin-top: 4px;
  padding: 3px 10px;
  background: rgba(255, 215, 0, 0.1);
  border: 1px solid rgba(255, 215, 0, 0.25);
  border-radius: var(--radius-full);
}

/* Status pill that replaces the old center-column FINAL / Q? Complete text.
   Lives in .game-header-top so the matchup row underneath can give all of
   its width to the team logos + stacked scores on mobile. */
.game-status-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-top: 4px;
  padding: 3px 12px;
  border-radius: var(--radius-full);
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.game-status-badge.final {
  background: var(--color-primary);
  color: white;
  border-color: transparent;
}

.game-status-badge.in-progress {
  background: rgba(0, 0, 0, 0.55);
  color: var(--color-warning, #fbbf24);
  border-color: rgba(251, 191, 36, 0.4);
}

[data-theme="light"] .game-status-badge.in-progress {
  background: rgba(0, 0, 0, 0.7);
  color: #fbbf24;
}

[data-theme="light"] .series-record-badge {
  color: #b8860b;
  background: rgba(184, 134, 11, 0.1);
  border-color: rgba(184, 134, 11, 0.3);
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
  gap: 16px;
  min-width: 360px;
}

/* Each team is its own glass "cell" now. The translucent bg + saturated
   blur lives here instead of on the wrapping overlay so home and away
   read as visually distinct cards. */
.starters-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: rgba(37, 32, 48, 0.6);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
  border-radius: 12px;
  border: 1px solid var(--glass-border);
}

[data-theme="light"] .starters-column {
  background: rgba(255, 255, 255, 0.55);
}

/* Mobile: stack each starter as avatar-on-top → name-below. Position
   badge stays in its base bottom-left spot on the avatar. */
@media (max-width: 640px) {
  .starter-row {
    grid-template-columns: 1fr;
    justify-items: start;
    gap: 4px;
  }
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
  /* 44px avatar column (36px avatar + 8px buffer for the pos badge that
     hangs off the bottom-left) | name. OVR is rendered as an absolute
     badge anchored to the row's top-right (see .starter-ovr-badge), which
     keeps it visually consistent across rows regardless of how the name
     wraps. */
  grid-template-columns: 44px 1fr;
  align-items: center;
  gap: 10px;
  font-size: 0.75rem;
  padding: 4px 0;
  position: relative;
}

/* Headshot column — wraps PlayerAvatar so we can absolutely overlay the
   position badge at the bottom-left, mirroring the .slot-position-label
   pattern used on the GM view's lineup tab. */
.starter-avatar-wrap {
  position: relative;
  width: 36px;
  height: 36px;
}

.starter-avatar {
  border-radius: 50%;
  width: 100%;
  height: 100%;
}

.starter-pos-badge {
  position: absolute;
  bottom: -9px;
  left: -4px;
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: white;
  padding: 1px 5px;
  border-radius: 4px;
  line-height: 1.2;
  z-index: 1;
  border: 1px solid rgba(0, 0, 0, 0.25);
}

/* OVR badge — same pill design as .starter-pos-badge, anchored to the
   top-right of the .starter-row (which is position: relative). Sits
   above the row's content regardless of how the name wraps. */
.starter-ovr-badge {
  position: absolute;
  top: 2px;
  right: 0;
  font-size: 0.55rem;
  font-weight: 700;
  color: white;
  background: var(--color-success);
  padding: 1px 5px;
  border-radius: 4px;
  line-height: 1.2;
  z-index: 1;
  border: 1px solid rgba(0, 0, 0, 0.25);
}

.starter-name {
  color: var(--color-text-primary);
  font-size: 0.72rem;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Section label above the coaches row. Matches the visual weight of
   "Starting Lineups" above the court. */
.coaches-row-label {
  margin-top: 16px;
  margin-bottom: 8px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
}

/* Coaches row sits beneath the court (outside the overlay) with each
   coach card aligned under its team's starters column. Two equal-width
   tracks mirror the .starters-overlay's 1fr 1fr grid. */
.coaches-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

/* Per-team coach card: avatar + name + OVR + top 2 badges, then a small
   Off/Def schemes row beneath. Sized to roughly match the width of the
   starters column above it. */
.team-coach-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
}

.team-coach-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Wraps CoachAvatar so we can absolutely overlay a small team-color
   badge at the bottom-left, mirroring the .starter-pos-badge pattern on
   the player avatars above. Identifies which team the coach belongs to. */
.team-coach-avatar-wrap {
  position: relative;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.team-coach-team-badge {
  position: absolute;
  bottom: -9px;
  left: -4px;
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: white;
  padding: 1px 5px;
  border-radius: 4px;
  line-height: 1.2;
  z-index: 1;
  border: 1px solid rgba(0, 0, 0, 0.25);
}

/* When a side doesn't have a coach loaded yet, render an invisible
   placeholder so the grid still allocates the column and the other
   coach card stays aligned with its team. */
.team-coach-placeholder {
  background: transparent;
  border-color: transparent;
}

/* Top 2 coach badges inside the coach card. Same color scale as the
   coach badge chips in the GM-view coach card. */
.team-coach-badges {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.team-coach-badge-chip {
  font-size: 0.5rem;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: white;
  line-height: 1.2;
}

.team-coach-badge-chip.level-bronze { background: #cd7f32; }
.team-coach-badge-chip.level-silver { background: #c0c0c0; color: #1a1520; }
.team-coach-badge-chip.level-gold { background: #ffd700; color: #1a1520; }
.team-coach-badge-chip.level-hof { background: var(--gradient-cosmic, #E85A4F); }

/* Mobile: stack the two coach cards into one column, and stack the badge
   chips inside each card into a column too (the long badge labels don't
   wrap cleanly side-by-side at narrow widths). */
@media (max-width: 640px) {
  .coaches-row {
    grid-template-columns: 1fr;
  }
  .team-coach-badges {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* Off/Def coaching-scheme row inside the coach card. Replaces the
   `.team-coach-settings` block that used to live in the starters overlay. */
.team-coach-schemes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--glass-border);
}

.coach-scheme-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 0.7rem;
  min-width: 0;
}

.coach-scheme-label {
  font-weight: 700;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.6rem;
}

.coach-scheme-value {
  color: var(--color-text-primary);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.team-coach-avatar {
  flex-shrink: 0;
  border-radius: 50%;
}

.team-coach-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.team-coach-name {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.1;
}

.team-coach-ovr {
  font-size: 0.62rem;
  color: var(--color-text-secondary);
  font-weight: 600;
  letter-spacing: 0.04em;
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
  align-self: start;
}

/* Opponent-analytics is the LAST pregame grid item and sits beneath the fixed
   "pop-in" START button. The panel's own GlassCard already matches the other
   cards' padding, so drop its default bottom margin (the grid `gap` spaces it
   like its siblings) and add explicit bottom clearance so the floating START
   button never covers it. Desktop needs more since `.game-view` only reserves
   24px there. */
.pregame-analytics {
  align-self: start;
  margin-bottom: 56px;
}
.pregame-analytics :deep(.analytics-card) {
  margin-bottom: 0;
}
@media (min-width: 1024px) {
  .pregame-analytics {
    margin-bottom: 80px;
  }
}

.pregame-coaching-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.strategy-section-label {
  margin: 0 0 8px 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
}

/* Floating bottom-right primary action. Sits above the mobile bottom nav
   (70px + safe-area-inset-bottom) on small screens and above the page edge
   on desktop. Width: full row (minus 16px gutters) on mobile to preserve
   the original tappable size; capped at 360px on desktop so it reads as a
   bottom-right action rather than a wall-to-wall bar. */
/* Selector intentionally bumps specificity (compound .qb-continue-btn.pregame-play-btn)
   to win against `.qb-continue-btn` which is declared later in this stylesheet
   and would otherwise overwrite the gradient + black color. */
.qb-continue-btn.pregame-play-btn {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(70px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 12px);
  margin-top: 0;
  z-index: 50;
  /* Coral→orange→gold gradient (same recipe as scout-pts-badge). Black
     text/icon gives much higher contrast for the shimmer sweep than
     white-on-coral did. */
  background: var(--gradient-cosmic);
  color: black;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
  opacity: 0;
  transform: translateY(8px) scale(0.92);
  animation: pregamePlayPop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 1s forwards;
}

.qb-continue-btn.pregame-play-btn:hover:not(:disabled) {
  background: var(--gradient-cosmic);
  filter: brightness(1.08);
  transform: translateY(-1px);
}

/* Pre-game, the fixed full-width START button owns the bottom band on mobile —
   lift the walkthrough "?" clear of it. Compound selector out-specifies the
   component's own scoped `.wt-replay-page` rule. */
.wt-replay-btn.wt-above-pregame-cta {
  bottom: calc(70px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 76px);
}

@media (min-width: 1024px) {
  /* Desktop pins the START CTA bottom-right, so the corner is free again. */
  .wt-replay-btn.wt-above-pregame-cta {
    bottom: 16px;
  }
}

@media (min-width: 1024px) {
  .qb-continue-btn.pregame-play-btn {
    left: auto;
    right: 24px;
    bottom: 24px;
    width: 360px;
  }
}

@keyframes pregamePlayPop {
  0% {
    opacity: 0;
    transform: translateY(8px) scale(0.92);
  }
  60% {
    opacity: 1;
    transform: translateY(-2px) scale(1.03);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Shimmer sweep across the label text. Base is solid black (matches the
   button's black-on-gradient color); the stripe is bright white, which
   reads as a "glint" sweeping across the black letters. Background is
   300% wide and position animates 100% → 0%, so the gradient always
   covers the text fully (no edge clipping). */
.pregame-play-label {
  display: inline-block;
  background-image: linear-gradient(
    100deg,
    #000 0%,
    #000 42%,
    rgba(255, 255, 255, 0.95) 50%,
    #000 58%,
    #000 100%
  );
  background-size: 300% 100%;
  background-position: 100% 0;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: pregamePlayShimmer 2.6s ease-in-out 1.8s infinite;
}

@keyframes pregamePlayShimmer {
  0% {
    background-position: 100% 0;
  }
  55% {
    background-position: 0% 0;
  }
  100% {
    background-position: 0% 0;
  }
}

.pregame-play-btn:disabled .pregame-play-label {
  animation: none;
  background: none;
  -webkit-text-fill-color: currentColor;
  color: currentColor;
}

/* Icon glints with the same timing as the text shimmer. Lucide SVGs use
   stroke="currentColor", so animating color is enough — the icon fades
   to bright white at the midpoint of each cycle then back to black,
   matching the highlight stripe sweeping through the label. */
.pregame-play-icon {
  color: black;
  animation: pregamePlayIconShimmer 2.6s ease-in-out 1.8s infinite;
}

@keyframes pregamePlayIconShimmer {
  0%, 100% {
    color: black;
  }
  50% {
    color: #fff;
  }
}

.pregame-play-btn:disabled .pregame-play-icon {
  animation: none;
  color: currentColor;
}

/* ---- Coaches overlay: subs/settings/matchups over the court. Same dark
   translucent family as the stoppage/timeout bubbles, sized to the court
   column so the game stays (dimly) visible beneath. ---- */
/* Positioning anchor sized exactly to the court container's box (desktop
   500-wide canvas; mobile the rotated 300x500 inline-styled box). */
.court-canvas-wrap {
  position: relative;
  width: fit-content;
}

.coaches-overlay {
  position: absolute;
  inset: 0;
  z-index: 20; /* above the court's internal overlays (z ≤ 11) */
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px; /* matches .basketball-court-container */
  background: rgba(10, 12, 18, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
  width: 75%;
  height: 85%;
  margin: auto;
}

.coaches-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-shrink: 0;
}

/* Tab pills — co-chip family: tiny bold uppercase, coral active accent. */
.coaches-tabs {
  display: flex;
  gap: 4px;
  min-width: 0;
}

.coaches-tab {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #8b93a7;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}

.coaches-tab:hover {
  color: #e6e9f0;
}

.coaches-tab.active {
  background: rgba(239, 106, 79, 0.16);
  border-color: rgba(239, 106, 79, 0.45);
  color: #fff;
}

/* Live timeout status — left side of the overlay footer; armed-TO coral,
   tabular clock, sized to the tab pills. (Never shows alongside the
   live-edits note: that one is hidden at pauses.) */
.coaches-timeout-status {
  margin-right: auto;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
  background: rgba(239, 106, 79, 0.16);
  border: 1px solid rgba(239, 106, 79, 0.45);
  color: #fff;
  white-space: nowrap;
}

.coaches-overlay-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
  color: #e6e9f0;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.coaches-overlay-close:hover {
  background: rgba(255, 255, 255, 0.16);
}

.coaches-overlay-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  margin-top: 18px;
  margin-bottom: 12px;
}

.coaches-overlay-body::-webkit-scrollbar {
  display: none;
}

.coaches-overlay-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 2px;
}

/* Live-edit footer note — co-strip muted micro-type; nudged left so the
   Done button keeps the right edge. */
.coaches-overlay-note {
  margin-right: auto;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8b93a7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.coaches-overlay-continue,
.coaches-overlay-done {
  padding: 3px 10px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
  color: #e6e9f0;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease;
}

.coaches-overlay-done:hover {
  background: rgba(255, 255, 255, 0.16);
}

.coaches-overlay-continue {
  background: #ef6a4f;
  border-color: transparent;
  color: #fff;
}

.coaches-overlay-continue:hover:not(:disabled) {
  background: #f4795f;
}

.coaches-overlay-continue:disabled {
  opacity: 0.7;
  cursor: default;
}

/* ---- Coaches overlay content crunch: same element structure as the old
   quarter-break tools, resized to the co-strip's compact type scale. All
   scoped under .coaches-overlay so the base classes used elsewhere
   (pregame card, etc.) are untouched. ---- */
.coaches-overlay .strategy-row {
  gap: 6px;
}

.coaches-overlay .strategy-pill {
  padding: 3px 7px;
}

.coaches-overlay .strategy-pill-label {
  font-size: 11px;
}

.coaches-overlay .strategy-pill-fit {
  font-size: 8px;
}

.coaches-overlay .lineup-cards-section {
  gap: 4px;
}

.coaches-overlay .lineup-cards-title {
  font-size: 10px;
}

.coaches-overlay .lineup-cards-hint {
  font-size: 8.5px;
}

.coaches-overlay .lineup-cards-grid {
  gap: 4px;
}

.coaches-overlay .lineup-card {
  padding: 4px 6px;
  border-radius: 7px;
  cursor: pointer; /* whole card opens the swap dropdown */
}

.coaches-overlay .lineup-card-header {
  padding: 6px;
}

.coaches-overlay .slot-position-badge {
  font-size: 8px;
}

.coaches-overlay .lineup-player-name {
  font-size: 10px;
}

.coaches-overlay .lineup-fatigue {
  font-size: 9px;
}

.coaches-overlay .lineup-inline-stats {
  font-size: 8.5px;
}

.coaches-overlay .lineup-player-ovr {
  font-size: 11px;
}

.coaches-overlay .swap-btn {
  width: 20px;
  height: 20px;
}

.coaches-overlay .swap-dropdown-header {
  font-size: 9px;
  padding: 4px 6px;
}

.coaches-overlay .swap-option {
  padding: 3px 6px;
}

.coaches-overlay .swap-option-name {
  font-size: 10px;
}

.coaches-overlay .swap-option-fatigue,
.coaches-overlay .swap-option-stats {
  font-size: 8.5px;
}

.coaches-overlay .swap-option-ovr {
  font-size: 10px;
}

/* Matchup editor: crunch the compact variant a notch further. */
.coaches-overlay :deep(.me-headers) {
  font-size: 10px;
}

.coaches-overlay :deep(.me-row) {
  padding: 6px 20px;
}

.coaches-overlay :deep(.me-name) {
  font-size: 11px;
}

.coaches-overlay :deep(.me-pick) {
  font-size: 10px;
  padding: 3px 7px 3px 3px;
}

.coaches-overlay .qb-foulout-banner.coaches-foulout {
  padding: 5px 8px;
  font-size: 9.5px;
  margin: 0;
  flex-shrink: 0;
}

/* ---- Segmented pacing: foul-out affordances ---- */
.ft-shooter-lock {
  font-size: 0.62rem;
  font-weight: 700;
  color: #ffd166;
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255, 209, 102, 0.14);
  border: 1px solid rgba(255, 209, 102, 0.35);
}

.qb-foulout-banner {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 107, 107, 0.12);
  border: 1px solid rgba(255, 107, 107, 0.4);
  color: #ffb3b3;
  font-size: 0.82rem;
  margin-bottom: 10px;
}

.pacing-hint {
  display: block;
  margin-top: 6px;
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  opacity: 0.85;
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

/* Mobile adjustments for starters overlay */
@media (max-width: 620px) {
  .starters-overlay {
    min-width: 280px;
    gap: 12px;
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
  max-height: 80vh;
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

/* Quarter-break header with the inline Continue action — title left,
   Continue right (mirrors the game-complete layout). */
.qb-modal-header.qb-header-with-action {
  justify-content: space-between;
}

.qb-header-continue-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-lg);
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.qb-header-continue-btn:hover:not(:disabled) {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.qb-header-continue-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
  background: var(--team-color, #6B7280);
}

.qb-team-badge.away-team {
  background: #FFFFFF;
  border-color: var(--team-color, #6B7280);
}

.qb-team-badge.away-team .qb-badge-abbr,
.qb-team-badge.away-team .qb-badge-record {
  color: var(--team-color, #1a1520);
  text-shadow: none;
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

/* Top Performers card — one mini-block per team showing the highest-impact
   player so far (and their key counting stats). Sits between the score
   card and the coaching adjustments at every live-mode quarter break. */
.qb-top-players-card {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.qb-top-players-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  margin-bottom: 10px;
  text-align: center;
}

.qb-top-players-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.qb-top-player-block {
  position:relative;
  padding: 10px 12px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-left: 3px solid var(--team-color, #666);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.qb-top-player-team {
  font-size: 0.65rem;
  font-weight: 700;
  position: absolute;
  top: -5px;
  right: 5px;
  border-radius:6px;
  background:white;
  padding: 4px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--team-color, var(--color-text-tertiary));
}

.qb-top-player-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.qb-top-player-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qb-top-player-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  letter-spacing: 0.04em;
}

.qb-top-stat b {
  display: inline-block;
  margin-right: 3px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.qb-top-player-empty {
  font-size: 0.85rem;
  color: var(--color-text-tertiary);
  text-align: center;
  padding: 8px 0;
}

@media (max-width: 480px) {
  .qb-top-players-grid {
    grid-template-columns: 1fr;
  }
}

.qb-strategy-card {
  padding: 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.qb-strategy-card.is-collapsed {
  padding: 8px 16px;
}

.qb-strategy-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.qb-strategy-card:not(.is-collapsed) .qb-strategy-toggle {
  margin-bottom: 12px;
}

.qb-strategy-toggle-label {
  color: var(--color-text-secondary);
}

.qb-strategy-chevron {
  transition: transform 0.2s ease;
  color: var(--color-text-tertiary);
}

.qb-strategy-chevron.is-open {
  transform: rotate(180deg);
}

.strategy-row {
  display: flex;
  gap: 24px;
  justify-content: center;
  flex-direction: column;
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

/* Subs button when rendered inside .pregame-court-card directly beneath
   the canvas. Adds breathing room above + a full-width feel. */
.court-card-subs-btn {
  width: 100%;
  margin-top: 16px;
}

/* Chevron rotates when the dropdown is open so the disclosure direction
   reads correctly. */
.court-card-subs-chevron {
  transition: transform 0.2s ease;
  margin-left: auto;
}
.court-card-subs-chevron.open {
  transform: rotate(180deg);
}

/* Inline dropdown panel under the Substitutions button. Sits inside the
   same .pregame-court-card so it expands beneath the button rather than
   replacing the strategy card on the right. */
.court-card-subs-dropdown {
  margin-top: 8px;
  padding: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
}

/* Back Button */
.subs-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 12px;
}

.subs-header-row .qb-back-btn {
  margin-bottom: 0;
}

.subs-continue-btn {
  padding: 10px 18px !important;
  font-size: 0.8rem !important;
  border-radius: var(--radius-lg) !important;
  text-transform: none !important;
}

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
  text-align: left;
}

/* Defensive Matchups disclosure toggle (pre-game + quarter break) */
.matchup-disclosure {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}
.matchup-disclosure-icon {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.strategy-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-start;
}

.strategy-pill {
  /* 3 per row → forces the 6 options into a 2-row grid at every breakpoint,
     same shape mobile already had. Width math: 100% minus the two 8px gaps,
     divided by 3. */
  flex: 1 0 calc((100% - 16px) / 3);
  min-width: 0;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 14px;
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  /* Pill stacks scheme label + small fit% line, left-aligned. */
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 2px;
  line-height: 1.15;
  height: 50px;
}

.strategy-pill-fit {
  font-size: 0.68rem;
  font-weight: 600;
  opacity: 0.65;
  letter-spacing: 0.02em;
}

/* Active pill's fit % loses the muted opacity so it stays legible on the
   primary-color background. */
.strategy-pill.active .strategy-pill-fit {
  opacity: 0.9;
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

/* ── The coaches overlay stays DARK in light mode ──────────────────────────
   It covers the dark court canvas with a hardcoded dark shell. Re-pin the
   theme tokens inside it so its themed content (scheme pills, lineup cards,
   swap dropdowns, matchup editor) keeps the dark-mode palette — custom
   properties inherit into child components. (The coach-overview strip is the
   opposite: it adapts to light mode via its own component styles.) */
[data-theme="light"] .coaches-overlay {
  --color-bg-primary: #1a1520;
  --color-bg-secondary: #252030;
  --color-bg-tertiary: #2d2838;
  --color-bg-elevated: #35303f;
  --color-text-primary: #ffffff;
  --color-text-secondary: #b8b0c4;
  --color-text-tertiary: #7a7486;
  --glass-bg: rgba(37, 32, 48, 0.8);
  --glass-bg-light: rgba(45, 40, 56, 0.9);
  --glass-border: rgba(255, 255, 255, 0.1);
}

/* The global light-mode .strategy-pill override above uses literal colors, so
   the var re-pin can't catch it — restore the dark literals for the overlay's
   Settings tab (the active state is identical in both themes). */
[data-theme="light"] .coaches-overlay .strategy-pill {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.15);
  color: var(--color-text-secondary);
}

[data-theme="light"] .coaches-overlay .strategy-pill:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
  color: var(--color-text-primary);
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
  /* Single line always — long names ellipsize like the swap-dropdown's. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.lineup-fatigue {
  font-size: 0.7rem;
  font-weight: 600;
  flex-shrink: 0; /* the % never collapses; the name ellipsizes instead */
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

/* Synergy indicators */
.synergy-count-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  background: rgba(0, 229, 255, 0.15);
  color: #00E5FF;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 700;
  margin-left: 6px;
  vertical-align: middle;
}

.lineup-synergy-indicator {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 1px 5px;
  background: rgba(0, 229, 255, 0.15);
  color: #00E5FF;
  border-radius: 8px;
  font-size: 0.65rem;
  font-weight: 700;
}

.swap-synergy-badge {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 1px 4px;
  background: rgba(0, 229, 255, 0.15);
  color: #00E5FF;
  border-radius: 6px;
  font-size: 0.65rem;
  font-weight: 700;
  flex-shrink: 0;
}

.swap-option.has-synergy {
  border-left: 2px solid rgba(0, 229, 255, 0.5);
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

/* Player Performance Modal — global modal standard (matches SimulateConfirmModal) */
.perf-modal-overlay {
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

.perf-modal-container {
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.perf-modal-overlay .modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.perf-modal-overlay .modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.perf-modal-overlay .btn-close {
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

.perf-modal-overlay .btn-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.perf-modal-overlay .modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.perf-modal-overlay .modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.perf-modal-overlay .btn-cancel {
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
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.perf-modal-overlay .btn-cancel:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

/* Body content */
.player-modal-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.player-modal-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-lg);
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

.player-identity-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Modal transition */
.modal-enter-active { transition: opacity 0.3s cubic-bezier(0, 0, 0.2, 1); }
.modal-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 1, 1); }
.modal-enter-from, .modal-leave-to { opacity: 0; }

@keyframes perfScaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes perfScaleOut {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.96); }
}

.modal-enter-active .perf-modal-container { animation: perfScaleIn 0.3s cubic-bezier(0, 0, 0.2, 1); }
.modal-leave-active .perf-modal-container { animation: perfScaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards; }

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
  padding: 14px 20px 8px;
  position: relative;
}

/* Playoff round chip embedded inline with the broadcast date footer. Dark pill
   so the gold text reads cleanly against the cosmic gradient. */
.broadcast-playoff-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 215, 0, 0.45);
  border-radius: var(--radius-full);
}

.broadcast-playoff-icon {
  color: #ffd700;
  flex-shrink: 0;
}

.broadcast-playoff-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #ffd700;
}

.broadcast-playoff-game {
  font-size: 0.65rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.04em;
}

.broadcast-date-sep {
  color: rgba(0, 0, 0, 0.45);
  font-weight: 600;
}

.broadcast-scoreboard {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.broadcast-date {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
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
  /* Outer spacing now comes from .live-main-row */
  padding: 0;
}

.court-in-broadcast {
  display: flex;
  flex-direction: row;
  align-items: stretch; /* momentum rail stretches co-strip top → canvas bottom */
}

/* The co-strip + canvas stack; the momentum rail sits to its left. */
.court-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* Anchor for the .court-play-controls overlay */
  position: relative;
}

.court-in-replay {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-radius: 0;
  /* Anchor for the .court-play-controls overlay */
  position: relative;
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
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

/* Name gets the full card width; stamina % sits on its own line below. */
.live-stat-lastname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-stat-fatigue {
  font-size: 0.5rem;
  font-weight: 700;
  line-height: 1;
}

.live-stat-line {
  display: flex;
  gap: 6px;
  text-align:center;
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
  position: relative;
  overflow: visible;
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
  background: var(--team-color, #6B7280);
}

/* AWAY TEAM TREATMENT — same inversion rule as the postgame header. */
.broadcast-team-logo.away-team {
  background: #FFFFFF;
  color: var(--team-color, #1a1520);
  border: 2px solid var(--team-color, #6B7280);
  text-shadow: none;
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
  position: absolute;
  top: 5px;
  right: 5px;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
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
  .broadcast-live{
    top: initial;
    bottom: 3px;
  }
  .team-name-with-logo {
    display: none;
  }
}

@media (max-width: 700px) {
  /* Keep the matchup in a single row on mobile (matches the homepage's
     next-game box pattern: away | center | home all side-by-side). The
     base .game-header is already display: flex row — just trim the gap
     and let .team-side's flex:1 distribute width. */
  .game-header {
    gap: 12px;
  }
  .team-side {
    justify-content: center !important;
    /* Stack the score underneath the team badge on mobile. Away keeps the
       column->score DOM order; home uses column-reverse so the score
       still lands beneath the badge (its DOM order is score then column). */
    flex-direction: column;
    gap: 8px;
  }
  .team-side.home {
    flex-direction: column-reverse;
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

/* Player Performance Modal - Light Mode */
[data-theme="light"] .player-modal-header {
  border-bottom-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .perf-modal-close {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .perf-modal-close:hover {
  background: rgba(0, 0, 0, 0.12);
}

[data-theme="light"] .game-stats-section,
[data-theme="light"] .shooting-stats-section {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .game-stat-cell,
[data-theme="light"] .shooting-stat-cell {
  background: rgba(0, 0, 0, 0.05);
}

[data-theme="light"] .game-stat-value,
[data-theme="light"] .shooting-stat-line {
  color: var(--color-text-primary);
}

[data-theme="light"] .minutes-row {
  background: rgba(0, 0, 0, 0.05);
}

[data-theme="light"] .ovr-badge {
  background: rgba(0, 0, 0, 0.1);
  color: var(--color-text-primary);
}

[data-theme="light"] .ovr-badge.elite {
  color: #1a1520;
}

[data-theme="light"] .ovr-badge.rotation {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .btn-close-modal {
  border-color: rgba(0, 0, 0, 0.15);
}

[data-theme="light"] .btn-close-modal:hover {
  background: rgba(0, 0, 0, 0.06);
}

/* Live band layout: vertical momentum rail on the left, court + stats row
   on the right. The rail stretches the full band height. */
.live-main-row {
  display: flex;
  align-items: stretch;
  gap: 16px;
  padding: 16px;
}

.live-main-row > .court-stats-row {
  flex: 1;
  min-width: 0;
}

/* Minimal playback controls pinned bottom-left OVER the court canvas
   (replaces the old controls bar above the court). */
.court-play-controls {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  gap: 8px;
  z-index: 6;
}

/* Broadcast variant: controls flow in normal layout as a compact, minimal
   strip left-aligned directly beneath the court instead of floating over it. */
.court-play-controls-strip {
  position: absolute;
  bottom: -17px;
}

.court-play-controls-strip .cpc-btn {
  height: 26px;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.court-play-controls-strip .cpc-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.court-play-controls-strip .cpc-btn svg {
  width: 13px;
  height: 13px;
}

.court-play-controls-strip .cpc-circle {
  width: 26px;
}

.court-play-controls-strip .cpc-speed {
  border-radius: 13px;
  padding: 0 9px;
  font-size: 11px;
}

.cpc-btn {
  background: rgba(15, 17, 25, 0.78);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: none;
  color: white;
  height: 38px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease, color 0.2s ease;
}

.cpc-btn:hover {
  background: rgba(15, 17, 25, 0.92);
}

.cpc-circle {
  width: 38px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cpc-speed {
  border-radius: 19px;
  padding: 0 14px;
  gap: 4px;
  font-weight: 800;
  font-size: 13px;
}

.cpc-chevrons {
  letter-spacing: -2px;
  color: #f5a623;
  font-weight: 800;
}

.cpc-mute.is-muted {
  color: rgba(255, 255, 255, 0.45);
  background: rgba(15, 17, 25, 0.6);
}

/* Light mode — the STRIP variant sits on the page background (below the
   court), so its white-alpha ghost buttons + white icons vanish; flip them to
   dark alphas. The floating variant keeps its opaque dark pill (it overlays
   the court canvas, which is dark in both themes). */
[data-theme="light"] .court-play-controls-strip .cpc-btn {
  background: rgba(45, 40, 56, 0.08);
  color: #2d2838;
}

[data-theme="light"] .court-play-controls-strip .cpc-btn:hover {
  background: rgba(45, 40, 56, 0.16);
}

[data-theme="light"] .court-play-controls-strip .cpc-mute.is-muted {
  background: rgba(45, 40, 56, 0.05);
  color: rgba(45, 40, 56, 0.45);
}

/* Darken the speed chevrons' amber for light backgrounds. */
[data-theme="light"] .court-play-controls-strip .cpc-chevrons {
  color: #b97a00;
}

/* Mobile adjustments for animation controls */
@media (max-width: 620px) {
  .broadcast-header {
    padding: 12px 16px 6px;
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
    padding: 0;
  }

  .court-in-broadcast,
  .court-in-replay {
    padding: 0;
  }

  .coaches-overlay {
    width: 95%;
    height: 75%;
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
    align-items: center;
  }

  .live-stat-line {
    font-size: 0.55rem;
    gap: 4px;
    justify-content: center;
  }

  .live-main-row {
    gap: 8px;
    padding: 10px;
  }

  .court-play-controls-strip{
    left:initial;
    right: 0;
  }

  .cpc-btn {
    height: 32px;
  }

  .cpc-circle {
    width: 32px;
  }

  .cpc-speed {
    padding: 0 11px;
    font-size: 12px;
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
  text-transform: uppercase; /* derived names ("Ball Handling") keep the badge look */
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
.inj-btn-cpu,
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

.inj-btn-cpu {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
}

.inj-btn-cpu:hover {
  background: rgba(var(--color-primary-rgb, 99, 102, 241), 0.15);
  transform: translateY(-1px);
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
</style>
