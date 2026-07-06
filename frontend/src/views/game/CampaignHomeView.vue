<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/composables/useApi'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { useGameStore } from '@/stores/game'
import { useLeagueStore } from '@/stores/league'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { usePlayoffStore } from '@/stores/playoff'
import { useTradeStore } from '@/stores/trade'
import { useBreakingNewsStore } from '@/stores/breakingNews'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useSyncStore } from '@/stores/sync'
import { useWalkthroughStore } from '@/stores/walkthrough'
import { BreakingNewsService } from '@/engine/season/BreakingNewsService'
import { LoadingSpinner, BaseModal, StandardModal, BaseButton } from '@/components/ui'
import { SimulateConfirmModal } from '@/components/game'
import SeasonEndModal from '@/components/playoffs/SeasonEndModal.vue'
import SeriesResultModal from '@/components/playoffs/SeriesResultModal.vue'
import ChampionshipModal from '@/components/playoffs/ChampionshipModal.vue'
import SeasonAwardsModal from '@/components/playoffs/SeasonAwardsModal.vue'
import RetirementModal from '@/components/team/RetirementModal.vue'
import ContractDecisionModal from '@/components/team/ContractDecisionModal.vue'
import CoachResignModal from '@/components/team/CoachResignModal.vue'
import HireCoachModal from '@/components/team/HireCoachModal.vue'
import OwnerCheckInModal from '@/components/team/OwnerCheckInModal.vue'
import OwnerWelcomeModal from '@/components/team/OwnerWelcomeModal.vue'
import DraftLotteryModal from '@/components/draft/DraftLotteryModal.vue'
import TradeProposalModal from '@/components/trade/TradeProposalModal.vue'
import AllStarModal from '@/components/game/AllStarModal.vue'
import NewSeasonModal from '@/components/game/NewSeasonModal.vue'
import StartSeasonBlockerModal from '@/components/game/StartSeasonBlockerModal.vue'
import { enterOffseason, startNewSeason, backfillPlayerAwards, resignGmContract, switchUserTeam } from '@/engine/campaign/CampaignManager'
import { gmLevelLabel } from '@/engine/data/gmLevels'
import { evaluateSubtasks } from '@/engine/season/OwnerSubtaskService'
import { buildOwnerCheckIn } from '@/engine/season/OwnerCheckInService'
import { findOwnerForTeam, EXPECTATION_BLURB_DEFAULT, EXPECTATION_LABEL } from '@/engine/data/owners'
import { getEffectiveExpectation, effectiveOwner } from '@/engine/season/OwnerExpectationService'
import { SALARY_CAP } from '@/engine/data/teams'
import { aiFinishUserTeamSetup } from '@/engine/campaign/UserTeamFinalizer'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { simFullOffseason, runDraftLotteryForCampaign } from '@/engine/draft/OffseasonOrchestrator'
import { FREE_AGENCY_DURATION_DAYS, isPastResignDeadline } from '@/engine/season/SeasonDeadlines'
import { Play, Search, Users, User, Newspaper, FastForward, Calendar, TrendingUp, Settings, Trophy, Star, AlertTriangle, Heart, X, Zap, Binoculars, Coins, Award, ShoppingBag, ChevronDown, Cpu, Briefcase, Dumbbell, HeartPulse, Telescope, BarChart3, Clock, Smile, Meh, Frown, Shield } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import TeamOverallBadge from '@/components/common/TeamOverallBadge.vue'
import TeamHeader from '@/components/common/TeamHeader.vue'
import { computeTeamOverall } from '@/utils/teamOverall'
import { calculateRetentionScore } from '@/engine/ai/MotivationService'
import EndOfFreeAgencyModal from '@/components/team/EndOfFreeAgencyModal.vue'
import UserFreeAgencyOffers from '@/components/team/UserFreeAgencyOffers.vue'
import PlayerDetailModal from '@/components/team/PlayerDetailModal.vue'

const route = useRoute()
const router = useRouter()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()
const gameStore = useGameStore()
const leagueStore = useLeagueStore()
const toastStore = useToastStore()
const audio = useAudioStore()
const playoffStore = usePlayoffStore()
const tradeStore = useTradeStore()
const breakingNewsStore = useBreakingNewsStore()
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const syncStore = useSyncStore()
const walkthroughStore = useWalkthroughStore()

const showSimulateModal = ref(false)
const simSeasonMode = ref(false)
const lastSimResult = ref(null) // Last simulated user game result shown during background sim
const showTradeProposalModal = ref(false)
const currentProposal = ref(null)
// Proposal IDs the user dismissed via the modal X this session. Skipped when
// auto-popping the next proposal so we don't re-show the same offer after
// every sim, but the offer stays in pendingProposals (visible in Offers tab).
const dismissedProposalIds = ref(new Set())
// Guards the trade-proposal modal buttons while an accept/reject is processing so
// rapid taps can't queue multiple in-flight actions.
const proposalActionBusy = ref(false)
const showAllStarModal = ref(false)
const allStarRosters = ref(null)
const showInjuryModal = ref(false)
const injuredPlayers = ref([])
const showRecoveryModal = ref(false)
const recoveredPlayers = ref([])
const showLineupWarningModal = ref(false)
const pendingGameAction = ref(null) // 'simulate' or gameId for play
const showRosterWarningModal = ref(false)
const rosterWarningMessage = ref('')
const rosterWarningHint = ref('')
const advancingToNextSeason = ref(false)
const showNewSeasonModal = ref(false)
const newSeasonData = ref(null)

// Start-season prerequisites: need ≥ 12 rostered players + a head coach.
// Clicking START SEASON pops a blocker modal when these aren't met; the
// modal offers a one-click "let AI finish setup" path that hires a free
// coach and signs FAs to fill the roster.
const START_SEASON_ROSTER_MIN = 12
const showStartSeasonBlockerModal = ref(false)
const simmingStartSetup = ref(false)
const offseasonData = ref(null) // Stores AI contract results + expiring players after entering offseason

// Season awards announcement state. Set when enterOffseason returns awards;
// cleared when the user dismisses the modal. The seasonData.seasonAwardsViewed
// flag persists the dismissal across navigations / reloads.
const showSeasonAwardsModal = ref(false)
const seasonAwardsForModal = ref(null)
const showRetirementModal = ref(false)
const seasonAwardsYear = ref(null)

// GM contract-end decision modal (Part 2). Fired in the offseason chain after
// awards + retirements. Mandatory — the user re-signs (extend) or picks a new
// team to run (not extended) before reaching the offseason hub.
const showContractDecisionModal = ref(false)
const contractDecisionData = ref(null)
// Coach re-sign prompt when an expiring head coach hits the new season.
const showCoachResignModal = ref(false)
const coachDecisionData = ref(null)
const coachResignBusy = ref(false)
const showHireCoachModal = ref(false)
const contractDecisionBusy = ref(false)

// Owner Check-In modal (start of each season / right after campaign creation).
// Fire-once-per-season via campaign.settings.ownerCheckInShownYear, and the very
// first thing the user sees — onboarding tours are suspended until it's dismissed.
const showOwnerCheckInModal = ref(false)
const ownerCheckInData = ref(null)

// Minimal owner "welcome" shown the moment a NEW GM job is accepted (a fresh
// campaign or taking over a new franchise) — precedes the full season-start
// Owner Check-In on a new campaign; on a mid-campaign switch it fires alone.
const showOwnerWelcomeModal = ref(false)
const ownerWelcomeData = ref(null)

// Only show loading if we don't have cached campaign data
const loading = ref(!campaignStore.currentCampaign)

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const team = computed(() => campaign.value?.team)
// Use teamStore roster which includes season_stats
const roster = computed(() => teamStore.roster || [])

// Facilities (training / medical / scouting / analytics, 1-5 scale).
// Prefer teamStore.team — it's loaded straight from TeamRepository so
// always carries facilities. Fall back to the campaign-attached team
// during the initial hydrate window.
const FACILITIES_ORDER = [
  { key: 'training', label: 'Training', icon: Dumbbell },
  { key: 'medical', label: 'Medical', icon: HeartPulse },
  { key: 'scouting', label: 'Scouting', icon: Telescope },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
]
const facilities = computed(() => {
  const src = teamStore.team?.facilities ?? team.value?.facilities ?? null
  if (!src) return null
  return FACILITIES_ORDER.map(({ key, label, icon }) => ({
    key,
    label,
    icon,
    level: Math.max(0, Math.min(5, Number(src[key] ?? 0))),
  }))
})

// Upcoming free agents — roster players whose contracts expire this
// offseason (`contractYearsRemaining === 1`). Same filter the finance
// store uses in `playersEligibleForResign` (stores/finance.js:48);
// inlined here so the home view doesn't pull the finance store in
// just for one predicate. Sorted by OVR so the most valuable expiring
// guys lead the at-a-glance list.
const upcomingFreeAgents = computed(() =>
  (teamStore.roster ?? [])
    .filter(p => (p.contractYearsRemaining ?? p.contract_years_remaining ?? 0) === 1)
    .sort((a, b) => (b.overallRating ?? b.overall_rating ?? 0) - (a.overallRating ?? a.overall_rating ?? 0))
)
const upcomingFreeAgentsPreview = computed(() => upcomingFreeAgents.value.slice(0, 4))

// Hide the home-view "Expiring Contracts" strip when re-signing is closed.
// Two close states:
//   1. In-season after Feb 5 — `resign_deadline_passed` is set; the user
//      can no longer extend anyone until next offseason, so a teaser they
//      can't act on is just noise.
//   2. Any offseason phase — `isOffseason` covers 'offseason',
//      'offseason_free_agency', and 'offseason_draft'. By the time the
//      user lands in offseason, expiring contracts have already been
//      flipped to FA so the list would be empty anyway; explicit gate keeps
//      the card off the offseason hub regardless.
const showUpcomingFreeAgents = computed(() => {
  if (!teamStore.team) return false
  if (isOffseason.value) return false
  if (isPastResignDeadline(campaign.value)) return false
  return true
})

function formatSalaryShort(salary) {
  const n = Number(salary ?? 0)
  if (!n) return '—'
  return `$${(n / 1_000_000).toFixed(1)}M`
}

// Team morale = rounded average of roster `personality.morale` (with a few
// fallback paths). Already aggregated by the team store as `teamChemistry`,
// so just reuse it — null when no roster is loaded yet.
const teamMorale = computed(() => {
  if (!teamStore.team) return null
  const value = Number(teamStore.teamChemistry ?? 0)
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null
})

// Color + label thresholds match `PlayerDetailModal.vue:585-596` (the
// same green/amber/orange/red bands used on the per-player morale tile).
function moraleColor(pct) {
  if (pct == null) return 'var(--color-text-tertiary)'
  if (pct >= 80) return '#22c55e'
  if (pct >= 50) return '#f59e0b'
  if (pct >= 25) return '#f97316'
  return '#ef4444'
}
function moraleLabel(pct) {
  if (pct == null) return '—'
  if (pct >= 80) return 'Excellent'
  if (pct >= 50) return 'Good'
  if (pct >= 25) return 'Low'
  return 'Critical'
}

// Face icon tier matches `PlayerDetailModal.vue:594-598` so the home-view
// at-a-glance read uses the same iconography as the per-player tile.
function moraleIcon(pct) {
  if (pct == null || pct >= 80) return Smile
  if (pct >= 25) return Meh
  return Frown
}

// Re-sign likelihood for an expiring player. Same scoring used by the
// PlayerDetailModal / ResignModal / DropPlayerModal — see
// `frontend/src/engine/ai/MotivationService.js:307` (calculateRetentionScore).
// Returns null when the player has no motivations object so we can hide the
// meter cleanly instead of showing a meaningless 50%.
function resignLikelihood(player) {
  if (!player?.motivations) return null
  return calculateRetentionScore(player, {})
}

// Matches the green/amber/red breakpoints PlayerDetailModal uses at
// PlayerDetailModal.vue:572 — keeps the visual language consistent across
// the app.
function resignColor(pct) {
  if (pct == null) return 'var(--color-text-tertiary)'
  if (pct >= 70) return '#22c55e'
  if (pct >= 40) return '#f59e0b'
  return '#ef4444'
}

// Live team-overall (avg OVR of healthy, non-FA, non-retired players).
// Derived from the reactive roster so it updates immediately after trades /
// signings / injury state changes without re-fetching.
const userTeamOverall = computed(() => computeTeamOverall(roster.value))

// Count of players actually on the user team (excludes nulls from the slot
// array + any FA / retired entries that may have leaked through). Drives the
// start-season prerequisite check.
const rosterCount = computed(() => roster.value.filter(p => {
  if (!p) return false
  if (p.isRetired || p.is_retired) return false
  if (p.isFreeAgent === 1 || p.is_free_agent === 1) return false
  return true
}).length)
const startSeasonRosterShort = computed(() => rosterCount.value < START_SEASON_ROSTER_MIN)
const startSeasonNeedsCoach = computed(() => !teamStore.coach)
const startSeasonBlocked = computed(() => startSeasonRosterShort.value || startSeasonNeedsCoach.value)
const news = computed(() => (campaign.value?.news || []).slice().reverse())

// The campaign's bi-weekly Featured Player selection (set by
// `_refreshFeaturedPlayerIfStale` in game.js). Resolves to the live roster
// entry so the avatar / OVR / position stay current even though the
// selection was made at the start of the 14-day window.
const featuredSelection = computed(() => campaign.value?.settings?.featuredPlayer ?? null)

// The selected featured player IF they're still on the user's roster. A stale
// selection (player traded, cut, or released to free agency in the offseason)
// resolves to null so the card falls back to a real current player instead of a
// blank 0-OVR stub. The bi-weekly refresh only runs during the regular season,
// so in the offseason a released player would otherwise linger here forever.
const featuredRosterPlayer = computed(() => {
  const sel = featuredSelection.value
  if (!sel?.playerId) return null
  return roster.value.find(p => String(p?.id) === String(sel.playerId)) ?? null
})

const featuredPlayer = computed(() => {
  if (featuredRosterPlayer.value) return featuredRosterPlayer.value
  // No valid selection (none made yet, or the featured player left the roster):
  // show the team's top current player by OVR so the card isn't empty/stale.
  if (!roster.value.length) return null
  return [...roster.value].sort((a, b) => b.overall_rating - a.overall_rating)[0]
})

// 14-day per-game averages from the selection window (PPG / RPG / APG strip
// on the Featured Player card). Falls back to the player's season averages
// for the cold-start case when no selection exists yet.
const featuredPlayerStats = computed(() => {
  const sel = featuredSelection.value
  // Only use the cached selection's stats while that player is still on the
  // roster; otherwise show the fallback player's own season averages.
  if (featuredRosterPlayer.value && sel?.stats) {
    const round1 = v => (v == null ? '0.0' : Number(v).toFixed(1))
    return {
      ppg: round1(sel.stats.ppg),
      rpg: round1(sel.stats.rpg),
      apg: round1(sel.stats.apg),
      spg: round1(sel.stats.spg),
      bpg: round1(sel.stats.bpg),
      gamesPlayed: sel.stats.gamesPlayed ?? 0,
    }
  }
  return _legacyTopPlayerStats(featuredPlayer.value)
})

// Recent-performances rows for the strip on the right of the card. Mirrors
// the `recent_performances` entry shape PlayerDetailModal renders, so the
// minimal table on the card uses the same columns.
// Source order:
//   1. The bi-weekly selection's `recentGames` (matches the 14-day window
//      the player was chosen on)
//   2. Fallback to the featured player's own `recent_performances` rolling
//      log (last 10 games) so the strip is visible immediately, before the
//      first selection ever fires (the first ~2 weeks of a new campaign).
// Always returns newest-first and capped to keep the card height bounded.
const FEATURED_STRIP_MAX_ROWS = 6
const featuredRecentGames = computed(() => {
  const sel = featuredSelection.value
  // The cached window's game log only applies while the selected player is still
  // on the roster; otherwise use the fallback player's own recent games.
  if (featuredRosterPlayer.value && Array.isArray(sel?.recentGames) && sel.recentGames.length > 0) {
    return sel.recentGames.slice().reverse().slice(0, FEATURED_STRIP_MAX_ROWS)
  }
  const p = featuredPlayer.value
  const log = p?.recent_performances || p?.recentPerformances
  if (!Array.isArray(log) || log.length === 0) return []
  // `recent_performances` entries are PlayerEvolution `trackPerformance`
  // shape: { date, opponent, won, min, pts, reb, ast, stl, blk, to, fgm,
  // fga, tpm, tpa, ftm, fta }. Already matches the columns the strip uses.
  // Filter out any legacy float entries (older code stored just a rating).
  return log
    .filter(g => g && typeof g === 'object' && g.date)
    .slice()
    .reverse()
    .slice(0, FEATURED_STRIP_MAX_ROWS)
})

function formatFeaturedGameDate(dateStr) {
  if (!dateStr || dateStr.length < 10) return '—'
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Legacy season-averages helper, kept for the cold-start fallback above.
function _legacyTopPlayerStats(player) {
  if (!player) {
    return { ppg: '0.0', rpg: '0.0', apg: '0.0', spg: '0.0', bpg: '0.0' }
  }
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
  const spg = stats.spg ?? stats.stealsPerGame ?? stats.steals_per_game ?? 0
  const bpg = stats.bpg ?? stats.blocksPerGame ?? stats.blocks_per_game ?? 0

  return {
    ppg: formatStat(ppg),
    rpg: formatStat(rpg),
    apg: formatStat(apg),
    spg: formatStat(spg),
    bpg: formatStat(bpg),
  }
}

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

// W-L comes from the global live record (gameStore.userRecord), derived from
// completed user games — so it updates in real time during multi-game sims, matching
// the Calendar header. (leagueStore standings only refresh on a forced fetch.)
const wins = computed(() => gameStore.userRecord.wins)
const losses = computed(() => gameStore.userRecord.losses)

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
// `isOffseason` covers all offseason sub-phases (the legacy 'offseason' marker,
// the 2-week free-agency window, and the post-FA pre-draft window) so the
// offseason hub UI stays mounted across the whole offseason.
const isOffseason = computed(() => {
  const phase = campaign.value?.phase
  return phase === 'offseason' || phase === 'offseason_free_agency' || phase === 'offseason_draft'
})

const isFreeAgencyActive = computed(() => campaign.value?.phase === 'offseason_free_agency')

const freeAgencyDay = computed(() => campaign.value?.settings?.freeAgencyDay ?? 0)

const freeAgencyCompleted = computed(() => {
  const year = campaign.value?.gameYear ?? 1
  return campaign.value?.[`freeAgencyCompleted_${year}`] === true
})

// Pre-FA: in offseason but free agency hasn't been opened yet
const freeAgencyNotStarted = computed(() => {
  return campaign.value?.phase === 'offseason' && !freeAgencyCompleted.value
})

// Draft lottery pending — gates the Free Agency CTA. While this is true,
// the next-game card shows "Draft Lottery" instead. Once the lottery has
// run for this offseason, the settings flag flips and the FA button takes
// over again. Mirrors the freeAgencyCompleted pattern so the same UI slot
// transitions through Lottery → FA → Draft.
const draftLotteryCompleted = computed(() => {
  return campaign.value?.settings?.draftLotteryCompleted === true
})
const draftLotteryPending = computed(() => {
  return campaign.value?.phase === 'offseason' && !draftLotteryCompleted.value
})

// End-of-FA wrap-up modal state
const showEndOfFreeAgencyModal = ref(false)
const endOfFreeAgencyResults = ref(null)
const enteringFreeAgency = ref(false)
const simmingFAday = ref(false)

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

const champBannerExpanded = ref(false)
const persistedSeasonAwards = ref(null)
const persistedChampion = ref(null)
const persistedBracket = ref(null)

const PLAYOFF_ROUND_LABELS = {
  round1: 'First Round',
  round2: 'Conference Semifinals',
  confFinals: 'Conference Finals',
  finals: 'Finals',
}

// Where the user finished last season — drives the offseason summary line.
// Returns one of:
//   { kind: 'champion' }
//   { kind: 'missed_playoffs' }
//   { kind: 'lost', roundLabel, opponentName }
//   null (data not yet hydrated)
//
// "Made the playoffs" is detected by scanning the bracket for the user's
// team id, NOT by reading seasonHistory.playoffSeed — that field is
// initialized in SeasonManager but never populated by bracket generation,
// so it's always null.
const previousSeasonFinish = computed(() => {
  const hist = userSeasonHistory.value
  if (!hist) return null
  if (hist.champion) return { kind: 'champion' }

  const bracket = persistedBracket.value
  const userTeamId = team.value?.id ?? campaign.value?.teamId
  if (!bracket || !userTeamId) {
    // No bracket loaded yet — can't tell. Stay quiet rather than mislabeling.
    return null
  }
  const idStr = String(userTeamId)

  // Build the round-ordered series list (latest round first).
  const ordered = []
  if (bracket.finals) ordered.push({ series: bracket.finals, round: 'finals' })
  for (const conf of ['east', 'west']) {
    const c = bracket[conf]
    if (!c) continue
    if (c.confFinals) ordered.push({ series: c.confFinals, round: 'confFinals' })
    for (const s of c.round2 || []) ordered.push({ series: s, round: 'round2' })
    for (const s of c.round1 || []) ordered.push({ series: s, round: 'round1' })
  }

  const userParticipated = ordered.some(({ series }) =>
    String(series?.team1?.teamId) === idStr || String(series?.team2?.teamId) === idStr
  )
  if (!userParticipated) return { kind: 'missed_playoffs' }

  // Find the latest series the user lost in.
  for (const { series, round } of ordered) {
    if (!series || series.status !== 'complete') continue
    const t1 = series.team1
    const t2 = series.team2
    const isT1 = String(t1?.teamId) === idStr
    const isT2 = String(t2?.teamId) === idStr
    if (!isT1 && !isT2) continue
    const winnerId = String(series.winner?.teamId)
    if (winnerId === idStr) continue
    const opp = isT1 ? t2 : t1
    // `name` already contains the full "City Nickname" (e.g. "Brooklyn Skylines"),
    // so don't prefix the city again.
    const oppName = opp ? (
      opp.name || opp.city || opp.abbreviation || 'their opponent'
    ) : 'their opponent'
    return {
      kind: 'lost',
      roundLabel: PLAYOFF_ROUND_LABELS[round] ?? 'the Playoffs',
      opponentName: oppName,
    }
  }
  // In the bracket but no completed losing series found — defensive fallback.
  return { kind: 'lost', roundLabel: 'the Playoffs', opponentName: null }
})

const displayedSeasonAwards = computed(() => offseasonData.value?.seasonAwards || persistedSeasonAwards.value)

// Unified champion source for the offseason banner. Prefers the team object
// found via seasonHistory (so we get the full team payload), falls back to
// the playoffBracket.champion record persisted on seasonData (which is the
// authoritative source even when seasonHistory is stale or missing).
const displayedChampion = computed(() => {
  if (lastSeasonChampion.value) return lastSeasonChampion.value
  const c = persistedChampion.value
  if (!c) return null
  // Try resolving against allTeams to get the full record.
  const resolved = campaign.value?.allTeams?.find(t => t.id === c.teamId)
  if (resolved) return resolved
  return {
    id: c.teamId,
    name: c.name || `${c.city ?? ''} ${c.abbreviation ?? ''}`.trim(),
    abbreviation: c.abbreviation,
    primary_color: c.primaryColor,
  }
})

function formatSeasonLabel(year) {
  if (!year) return ''
  const start = ((year - 1) % 100 + 100) % 100
  const end = ((year % 100) + 100) % 100
  return `${start.toString().padStart(2, '0')}/${end.toString().padStart(2, '0')}`
}

const championSeasonLabel = computed(() => {
  const year = campaign.value?.currentSeasonYear ?? campaign.value?.game_year
  return formatSeasonLabel(year)
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

// Validate roster before game: check the lineup is complete (no traded/dropped
// starters), then injured starters and minutes total.
function validateRosterForGame() {
  const starters = teamStore.starterPlayers || []

  // A starting-five slot that no longer resolves to a rostered player — e.g. you
  // traded or dropped a starter — leaves the lineup incomplete. The minutes can
  // still falsely total 240 (the gone player's minutes linger), so check this
  // explicitly rather than relying on the minutes total.
  const validStarters = starters.filter(Boolean)
  if (validStarters.length < 5) {
    const shortBy = 5 - validStarters.length
    rosterWarningMessage.value = `Your starting lineup is missing ${shortBy} player${shortBy === 1 ? '' : 's'} — likely from a recent trade or drop.`
    rosterWarningHint.value = 'Go to the Team tab to set a full starting five and rebalance your minutes to 240.'
    showRosterWarningModal.value = true
    return false
  }

  const injuredStarters = starters.filter(p => p && (p.is_injured || p.isInjured))
  if (injuredStarters.length > 0) {
    const names = injuredStarters.map(p => p.name || `${p.first_name} ${p.last_name}`).join(', ')
    rosterWarningMessage.value = `You have injured ${injuredStarters.length === 1 ? 'starter' : 'starters'} in your lineup: ${names}`
    rosterWarningHint.value = 'Go to the Team tab to adjust your lineup before playing.'
    showRosterWarningModal.value = true
    return false
  }

  const totalMins = teamStore.totalTargetMinutes
  if (totalMins !== 240) {
    rosterWarningMessage.value = `Your rotation minutes total ${totalMins} — they must equal exactly 240.`
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

// True while we don't yet know which variant the next-game box should show —
// either the schedule is being fetched, or it hasn't populated yet for this
// mount. Used to mask the "Regular Season Complete" fallback so it doesn't
// briefly flash on warm navigation before fetchAll finishes.
const nextGameBoxLoading = computed(() => {
  if (!campaign.value) return false
  return gameStore.loading || (gameStore.games?.length ?? 0) === 0
})

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
  // Reorder so the user's wins are always shown first in the series record.
  // The bracket's team1/team2 ordering is seed-based — for a user who is the
  // lower seed it would show the opponent's wins first ("Series 3-2" when the
  // user is actually down 2-3). Detect the user's side and swap if needed.
  const userTeamId = team.value?.id
  const isUserTeam1 = userTeamId != null && (series.team1?.teamId === userTeamId)
  const userWins = isUserTeam1 ? (series.team1Wins ?? 0) : (series.team2Wins ?? 0)
  const opponentWins = isUserTeam1 ? (series.team2Wins ?? 0) : (series.team1Wins ?? 0)
  return {
    ...series,
    gameLabel: gameNum ? `Game ${gameNum}` : '',
    userWins,
    opponentWins,
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

// Top 3 starters by overall rating for the next game matchup display
const userTopStarters = computed(() => {
  const starters = teamStore.starterPlayers || []
  return [...starters]
    .filter(p => p != null)
    .sort((a, b) => (b.overall_rating ?? b.overallRating ?? 0) - (a.overall_rating ?? a.overallRating ?? 0))
    .slice(0, 3)
})

const opponentTopStarters = ref([])
const opponentTeamOverall = ref(null)

// Load opponent starters when next game OR user team changes.
//
// The `team.value?.id` dep is critical: on a fresh mount this watch fires with
// `{ immediate: true }` before teamStore.fetchTeam resolves. Without team.id,
// the home/away identity check below evaluates `homeTeam?.id === undefined`,
// the user-is-home branch never wins, and we end up fetching the home team's
// roster as "opponent." When the user IS the home team (e.g., Round 2 Game 1
// as the higher seed), that means the opponent slot gets the user's own
// players — duplicate headshots in the matchup card. Re-running once team.id
// is available fixes the assignment.
watch(() => [nextGame.value?.id, team.value?.id], async () => {
  if (!nextGame.value || !campaignId.value || !team.value?.id) {
    opponentTopStarters.value = []
    opponentTeamOverall.value = null
    return
  }
  const homeTeam = nextGame.value.home_team
  const awayTeam = nextGame.value.away_team
  const userId = team.value.id
  const homeIsUser = homeTeam?.id != null && String(homeTeam.id) === String(userId)
  const awayIsUser = awayTeam?.id != null && String(awayTeam.id) === String(userId)
  const oppTeam = homeIsUser ? awayTeam : (awayIsUser ? homeTeam : null)
  if (!oppTeam?.id) {
    opponentTopStarters.value = []
    opponentTeamOverall.value = null
    return
  }
  try {
    const oppTeamData = await TeamRepository.get(campaignId.value, oppTeam.id)
    const oppStarters = oppTeamData?.lineup_settings?.starters || []
    const oppPlayers = await PlayerRepository.getByTeam(campaignId.value, oppTeam.id)
    const starterSet = new Set(oppStarters)
    const starters = oppPlayers.filter(p => starterSet.has(p.id))
    opponentTopStarters.value = [...starters]
      .sort((a, b) => (b.overall_rating ?? b.overallRating ?? 0) - (a.overall_rating ?? a.overallRating ?? 0))
      .slice(0, 3)
    // Compute opponent overall from the same fetch (free piggy-back).
    // Other consumers (game preview / broadcast header) will fetch via
    // the cached composable and reuse what's in IndexedDB.
    opponentTeamOverall.value = computeTeamOverall(oppPlayers)
  } catch {
    opponentTopStarters.value = []
    opponentTeamOverall.value = null
  }
}, { immediate: true })

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
  // Relative-label shortcuts based on the campaign's in-game calendar.
  // Math.round handles DST edges where a 24h diff can come back as 23h/25h.
  const cur = currentDate.value ? parseLocalDate(currentDate.value) : null
  if (cur) {
    const diffDays = Math.round((date - cur) / 86_400_000)
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Tomorrow'
  }
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
  // One-time backfill: reconstruct player.awards per-year history from
  // archived seasonData for campaigns that entered offseason before the
  // history was being recorded. Gated by a settings flag, so subsequent
  // mounts no-op.
  backfillPlayerAwards(campaignId.value).then(async () => {
    await teamStore.fetchTeam(campaignId.value, { force: true })
  }).catch(err => console.warn('[CampaignHome] award backfill failed:', err))
  // Check for pending weekly summary (e.g., from live game completion)
  if (gameStore.weeklySummaryData) {
    toastStore.showWeeklySummary({
      scoutingPointsEarned: gameStore.weeklySummaryData.scoutingPointsEarned ?? 0,
      campaignId: campaignId.value,
    })
    gameStore.weeklySummaryData = null
  }

  // If we already have campaign data, refresh in background without blocking
  const hasCachedData = campaignStore.currentCampaign

  // fetchCampaign hydrates IndexedDB (pulls from cloud on cold devices and
  // runs engine migrations). fetchTeam / fetchStandings / fetchGames all
  // read directly from IDB, so if they race against fetchCampaign on a
  // device that doesn't have the campaign locally yet, they'll throw
  // "Campaign not found". Serialize fetchCampaign first, then fan the rest
  // out in parallel.
  const fetchAll = (async () => {
    await campaignStore.fetchCampaign(campaignId.value)
    return Promise.all([
      teamStore.fetchTeam(campaignId.value),
      leagueStore.fetchStandings(campaignId.value),
      gameStore.fetchGames(campaignId.value),
    ])
  })()

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
      // Auto-finish the regular season if the user has no games left
      maybeAutoFinishRegularSeason()
      // Re-pop the retirement modal on mount if the user landed on the
      // offseason hub via a refresh / cold load and hasn't dismissed it yet.
      maybeShowRetirementModal()
      // ...and re-surface the GM contract-end (owner evaluation) decision.
      // Retirements normally chain into it, but when retirements were already
      // dismissed a refresh that closed the decision modal would otherwise
      // strand an unresolved decision. `showRetirementModal` is set
      // synchronously above, so this only fires when no retirement modal opened.
      if (!showRetirementModal.value) maybeShowContractDecisionModal()
      // Now that fetchCampaign has repointed the stores to THIS campaign, fire
      // the owner check-in / onboarding tours with fresh data. The synchronous
      // calls at the end of onMounted no-op on this cached/switch path (the
      // identity guard sees the stale campaign), so this is where they actually
      // run when switching between campaigns.
      maybeShowOwnerCheckIn()
      maybeShowExpectationRaise()
      maybeShowCoachDecisionModal()
      walkthroughStore.maybeStart('campaignHome')
      maybeStartOffseasonTour()
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
      // Auto-finish the regular season if the user has no games left
      await maybeAutoFinishRegularSeason()
      // Re-pop the retirement modal on first cold-load if we land on the
      // offseason hub with un-dismissed retirees.
      maybeShowRetirementModal()
      // ...and re-surface the GM contract-end (owner evaluation) decision when
      // retirements were already dismissed, so a refresh that closed the
      // decision modal doesn't strand it. Synchronous ref check as above.
      if (!showRetirementModal.value) maybeShowContractDecisionModal()
    } catch (err) {
      console.error('Failed to load campaign:', err)
    } finally {
      loading.value = false
    }
  }

  // Owner Check-In — the FIRST thing the user sees on a fresh campaign / new
  // season. The minimal owner-welcome is NOT shown here: a brand-new campaign
  // already gets the full season-start check-in, so showing both would be a
  // redundant double owner conversation. The quick welcome only fires when the
  // user MOVES JOBS mid-campaign (handleSwitchTeam). Suspends tours until dismissed.
  maybeShowOwnerCheckIn()

  // Expiring head-coach re-sign prompt (guarded so it won't stack on the check-in;
  // its close handler re-invokes this).
  maybeShowCoachDecisionModal()

  // First-visit onboarding tour (no-op unless enabled and not yet seen).
  walkthroughStore.maybeStart('campaignHome')

  // First-time offseason tour — fires only in the entry offseason phase
  // (before free agency starts) so the ENTER FREE AGENCY anchor is visible
  // for its step. maybeStart() is a safe no-op if conditions aren't met
  // or the tour has already been completed/skipped.
  maybeStartOffseasonTour()
})

// Centralized trigger for the offseason walkthrough. Gated on three
// conditions so the overlay doesn't render on top of a blocking modal:
//  1. Phase is `offseason` proper (not mid-FA / post-draft sub-phases)
//  2. FA hasn't started yet (so the lottery / FA anchor is on screen)
//  3. No All-Star selection modal is open — that modal can carry over
//     into the offseason if the user simmed past the All-Star break
//     without dismissing it; without this guard the tour fired
//     beneath/over the modal instead of waiting for it to close.
// The watch on `showAllStarModal` below re-runs this when the modal
// dismisses so the tour fires immediately on close instead of being lost.
function maybeStartOffseasonTour() {
  if (!isOffseason.value || !freeAgencyNotStarted.value) return
  // Don't start the tour while any blocking offseason popup is still open — it
  // would render on top of the modal. The watch below re-fires the tour once the
  // last of these dismisses.
  if (
    showAllStarModal.value ||
    showSeasonAwardsModal.value ||
    showRetirementModal.value ||
    showContractDecisionModal.value ||
    showOwnerCheckInModal.value ||
    showOwnerWelcomeModal.value ||
    showCoachResignModal.value ||
    showHireCoachModal.value
  ) {
    return
  }
  walkthroughStore.maybeStart('campaignOffseason')
}

// Live transition into the offseason hub: if the user is already on this
// page when the championship resolves and the phase flips, fire the tour
// without waiting for a re-mount. Guard prevents firing during sub-phases
// (mid-FA, post-draft) where the spotlight anchors wouldn't exist.
// `flush: 'post'` makes the callback run after Vue applies DOM updates so
// the v-if for the offseason buttons has rendered them by the time the
// walkthrough overlay tries to find its targets.
watch([isOffseason, freeAgencyNotStarted], () => {
  // Don't start the tour mid-transition. handleEnterOffseason flips the phase
  // here, but the season-awards / retirement / contract chain hasn't opened yet,
  // so the tour's modal guard would pass and the overlay would render over the
  // awards modal that opens a tick later. The transition's own terminal call and
  // each modal's close handler start the tour once the chain is fully dismissed.
  if (advancingToNextSeason.value) return
  maybeStartOffseasonTour()
}, { flush: 'post' })

// Re-fire the tour the instant the All-Star modal dismisses — covers the case
// where the user landed in the offseason with the All-Star modal still open (it's
// a mid-season modal that can carry over), the tour was blocked by the modal
// guard, and then they closed it. The awards/retirement/contract chain instead
// fires the tour explicitly from each terminal close handler (past their awaits,
// so there's no intermediate all-closed gap for the tour to slip through).
watch(showAllStarModal, (open, prev) => {
  if (prev && !open) maybeStartOffseasonTour()
})

onUnmounted(() => {
  stopIdleDetection()
  // Tear down any open teleported modal so its full-screen overlay can't orphan in
  // <body> and block taps after we've navigated away (the Teleport/Transition node
  // can otherwise outlive this view). Cheap belt-and-suspenders for stability.
  showInjuryModal.value = false
  showRecoveryModal.value = false
  showOwnerCheckInModal.value = false
  showOwnerWelcomeModal.value = false
  showSimulateModal.value = false
  showCoachResignModal.value = false
  showHireCoachModal.value = false
})

// Hydrate persisted season awards + champion when in offseason so the
// banner & dropdown still work after a page reload (offseasonData is
// in-memory only and lastSeasonChampion can be stale across some flows).
// Also backfills playoffs for campaigns that entered offseason without the
// AI bracket ever being simulated (the pre-fix missed-playoffs path did
// this) so the champion banner can populate retroactively.
watch(
  [isOffseason, () => campaign.value?.currentSeasonYear],
  async ([off, year]) => {
    if (!off || !year || !campaignId.value) {
      persistedSeasonAwards.value = null
      persistedChampion.value = null
      persistedBracket.value = null
      return
    }
    try {
      const { SeasonRepository } = await import('@/engine/db/SeasonRepository')
      let seasonData = await SeasonRepository.get(campaignId.value, year)

      // Backfill: in offseason without a crowned champion → run the AI
      // playoffs now so the offseason hub can show the championship banner.
      // handleEnterOffseason (via ensurePlayoffsComplete) is now the primary
      // guard that crowns the champion before the offseason runs; this watcher
      // is the legacy-repair fallback for pre-existing saves already stuck in
      // the offseason without a champion.
      if (seasonData && !seasonData.playoffBracket?.champion &&
          !gameStore.simulating && !gameStore.backgroundSimulating) {
        try {
          if (!seasonData.playoffBracket) {
            await playoffStore.generateBracket(campaignId.value)
          }
          await gameStore.simulateToNextPlayoffRound(campaignId.value, { simAll: true })
          seasonData = await SeasonRepository.get(campaignId.value, year)
        } catch (err) {
          console.warn('[CampaignHome] playoff backfill failed:', err)
        }
      }

      if (!offseasonData.value?.seasonAwards) {
        persistedSeasonAwards.value = seasonData?.seasonAwards || null
      } else {
        persistedSeasonAwards.value = null
      }
      persistedChampion.value = seasonData?.playoffBracket?.champion || null
      // Cache the full bracket so previousSeasonFinish can derive the user's
      // round-by-round finish + the team that knocked them out.
      persistedBracket.value = seasonData?.playoffBracket || null
    } catch (err) {
      console.warn('[CampaignHome] failed to hydrate offseason data:', err)
      persistedSeasonAwards.value = null
      persistedChampion.value = null
      persistedBracket.value = null
    }
  },
  { immediate: true }
)

// Watch for date changes to trigger mid-season events (trade deadline, All-Star, etc.)
watch(currentDate, async (newDate, oldDate) => {
  if (!newDate || newDate === oldDate) return
  // Skip if background sim is running — events will be checked when it finishes
  if (gameStore.backgroundSimulating) return
  await checkTradeDeadline()
  await checkAllStarSelections()
})

// Surface players returning from injury. Date-advance ticks clear injuries
// silently, so the game store queues the user's recovered players; we wait for
// the sim to settle (so the modal doesn't flash mid-run), then show the
// Recovery Report — the mirror of the injury modal — and drain the queue.
function flushPendingRecoveries() {
  const list = gameStore.pendingRecoveries
  if (!Array.isArray(list) || list.length === 0) return
  if (gameStore.simulating || gameStore.backgroundSimulating) return
  recoveredPlayers.value = list.slice()
  gameStore.pendingRecoveries = []
  // Stagger behind the injury modal if both fired this sim so they don't stack.
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

// Auto-finish the regular season once the user has played all of their own
// games but the league still has AI games to simulate. The simulation itself
// shows a progress toast, then checkPlayoffStatus surfaces the SeasonEndModal.
// Guarded against re-entry via the gameStore sim flags.
async function maybeAutoFinishRegularSeason() {
  // Self-heal FIRST, regardless of the guards below: games stranded incomplete
  // behind the campaign date (created by playing a later game directly from
  // the calendar) wedge the season permanently — isRegularSeasonComplete stays
  // false while a playoff bracket may already exist, and every advance button
  // no-ops. The sweep sims them and unblocks the season-end/playoff flow.
  try {
    if (!gameStore.simulating && !gameStore.backgroundSimulating) {
      const swept = await gameStore.sweepOrphanedGames(campaignId.value)
      if (swept > 0) {
        await checkPlayoffStatus()
      }
    }
  } catch (err) {
    console.warn('Orphaned-game sweep failed (non-fatal):', err)
  }

  if (!nextGame.value &&
      !playoffStore.isInPlayoffs &&
      !playoffStore.champion &&
      !isOffseason.value &&
      remainingSeasonGames.value.aiGames > 0 &&
      !gameStore.simulating &&
      !gameStore.backgroundSimulating
  ) {
    try {
      const response = await gameStore.simulateRemainingSeason(campaignId.value)
      // If the run paused on a deadline/All-Star modal, leave playoff-status
      // check to the resume completion — checkPlayoffStatus fires SeasonEndModal
      // which would conflict with the SimPauseModal still on screen.
      if (response?.paused) return
      await checkPlayoffStatus()
    } catch (err) {
      console.error('Failed to auto-finish regular season:', err)
    }
  }
}

// Retry a failed campaign load (the load-error fallback card). Re-runs the
// core fetch chain; if it succeeds `campaign` becomes non-null and the main
// content renders.
async function retryLoad() {
  loading.value = true
  try {
    await campaignStore.fetchCampaign(campaignId.value)
    await Promise.all([
      teamStore.fetchTeam(campaignId.value),
      leagueStore.fetchStandings(campaignId.value),
      gameStore.fetchGames(campaignId.value),
    ])
    await checkPlayoffStatus()
    await maybeAutoFinishRegularSeason()
  } catch (err) {
    console.error('Retry load failed:', err)
  } finally {
    loading.value = false
  }
}

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

      // Reload the games list so it includes the newly-generated Round 1 schedule.
      // Without this, gameStore.games still holds only the (now-completed) regular
      // season — gameStore.nextUserGame returns undefined, and the home view's
      // v-if chain falls through to "SERIES WON" instead of showing the user's
      // first playoff matchup.
      await gameStore.fetchGames(campaignId.value, { force: true })

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
    // Team missed the playoffs. handleEnterOffseason now guarantees the league
    // playoffs are fully simmed and a champion crowned before the offseason /
    // owner evaluation runs, so just hand off to it.
    await handleEnterOffseason()
  }
}

// Tracks the in-flight sim spawned from the SeriesResultModal so the modal
// disables its button while the run is going.
const seriesResultSimulating = ref(false)

// Click handler for both "Sim to Next Series" (user advanced) and "Sim Playoffs"
// (user eliminated) buttons inside SeriesResultModal. Closes the modal first,
// then defers to handleSimToNextPlayoffRound, which already branches between
// "sim one round" and "sim everything" via userEliminated. Without this the
// modal's emits had no listener and clicking either button was a no-op.
async function handleSeriesResultSimNext() {
  if (seriesResultSimulating.value) return
  seriesResultSimulating.value = true
  // Run the standard close path (refreshes bracket + games + breaking news for
  // making the finals) so the post-sim state is consistent.
  await handleSeriesResultClose()
  try {
    await handleSimToNextPlayoffRound()
  } finally {
    seriesResultSimulating.value = false
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

// Handle championship modal — show offseason card (don't auto-advance).
// The ChampionshipModal opens on EVERY Finals completion (win OR lose) and shows the
// real winner. Only enqueue the title breaking-news here when the USER actually won —
// crediting the real champion, never the user by default. A user LOSS already gets the
// correct champion news from handleSimToNextPlayoffRound (userEliminated path), so
// gating here also avoids a duplicate.
function handleChampionshipClose() {
  const champion = playoffStore.champion
  const userTeamId = team.value?.id ?? campaignStore.currentCampaign?.teamId
  // == (loose) to match ChampionshipModal's winner.teamId comparison (id types vary).
  if (champion && userTeamId != null && champion.teamId == userTeamId) {
    const year = campaignStore.currentCampaign?.season?.year || campaignStore.currentCampaign?.game_year || new Date().getFullYear()
    breakingNewsStore.enqueue(
      BreakingNewsService.winningFinals({
        teamName: champion.name,
        year,
        date: campaignStore.currentCampaign?.settings?.currentDate || new Date().toISOString().split('T')[0],
      }),
      campaignId.value
    )
  }

  playoffStore.closeChampionshipModal()
}

// Handle entering the offseason (after champion declared or non-qualifying)
// Guarantee the league playoffs are fully simulated and a champion crowned.
// Best-effort: in the normal case this crowns the champion before the offseason
// runs; if a sim hiccup leaves no champion we log and fall through rather than
// hard-locking the user out of the offseason (the backfill watcher remains the
// final retroactive safety net, same as today).
async function ensurePlayoffsComplete() {
  if (playoffStore.champion) return
  const year = campaign.value?.currentSeasonYear
  if (!year || !campaignId.value) return
  const { SeasonRepository } = await import('@/engine/db/SeasonRepository')
  let seasonData = await SeasonRepository.get(campaignId.value, year)
  if (seasonData?.playoffBracket?.champion) return
  if (!seasonData?.playoffBracket) {
    await playoffStore.generateBracket(campaignId.value)
  }
  await gameStore.simulateToNextPlayoffRound(campaignId.value, { simAll: true })
  seasonData = await SeasonRepository.get(campaignId.value, year)
  if (!seasonData?.playoffBracket?.champion) {
    console.warn('[CampaignHome] entered offseason without a crowned champion; backfill will repair')
  }
}

async function handleEnterOffseason() {
  advancingToNextSeason.value = true
  const loadingToastId = toastStore.showLoading('Processing offseason...')
  try {
    // Invariant: the league playoffs must be fully simulated and a champion
    // crowned BEFORE the offseason runs (owner evaluation / GM-contract decision
    // / firing / retirements). Centralised here so every caller is safe — the
    // missed-playoffs season-end branch and any future path — without relying on
    // the retroactive backfill watcher.
    await ensurePlayoffsComplete()
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

    // Fire achievement toasts for anything the user team earned this season.
    // `enterOffseason` already wrote these onto `campaign.achievements`
    // (see `archiveSeasonData` in CampaignManager.js) — the toasts are the
    // moment-of-earn callout; the persistent record drives the Dashboard
    // Recent Activity feed and Campaign-card meta.
    const earned = Array.isArray(result.newAchievements) ? result.newAchievements : []
    earned.forEach((ach, i) => {
      // Stagger so multiple unlocks (champion + conference title + berth) play
      // in sequence rather than stacking and triple-firing the chime at once.
      setTimeout(() => {
        toastStore.showAchievement({
          label: ach.label,
          subtitle: ach.subtitle ?? '',
          type: ach.type,
        })
      }, i * 900)
    })

    // Surface MVP / All-NBA / All-Defense / All-Rookie selections in a popup
    // modal, mirroring the championship/series-result flow. Skipped if the
    // user already dismissed the awards modal for this season.
    await maybeShowSeasonAwardsModal(result.seasonAwards)
    // If the awards modal didn't open (no awards or already dismissed),
    // still attempt the retirement modal — handleCloseSeasonAwardsModal
    // chains them when both fire, but this covers the no-awards path.
    if (!showSeasonAwardsModal.value) {
      await maybeShowRetirementModal()
    }
    // If neither info modal opened, still surface the GM contract decision.
    if (!showSeasonAwardsModal.value && !showRetirementModal.value) {
      await maybeShowContractDecisionModal()
    }

    // Fire the first-time offseason walkthrough at the canonical
    // "just entered offseason" moment. The campaign refetch above flipped
    // phase to 'offseason', and the offseason hub buttons are now in the
    // DOM. nextTick is the belt to the post-flush watch's suspenders —
    // guarantees layout is settled before the overlay measures the
    // spotlight anchors. maybeStartOffseasonTour also guards on the
    // All-Star modal so the overlay doesn't render on top of a
    // still-open mid-season modal that carried into the offseason.
    await nextTick()
    maybeStartOffseasonTour()
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Failed to enter offseason')
    console.error('Failed to enter offseason:', err)
  } finally {
    advancingToNextSeason.value = false
  }
}

// Open the season-awards modal if we have awards to announce and the user
// hasn't already dismissed them for this season. Persists a viewed flag onto
// seasonData so a refresh / nav doesn't re-pop the modal.
async function maybeShowSeasonAwardsModal(awards) {
  if (!awards) return
  const hasAny = awards.mvp || awards.rookieOfTheYear || awards.allNba || awards.allDefense || awards.allRookie
  if (!hasAny) return

  try {
    const { SeasonRepository } = await import('@/engine/db/SeasonRepository')
    const camp = campaignStore.currentCampaign
    const year = camp?.currentSeasonYear ?? camp?.game_year ?? new Date().getFullYear()
    const seasonData = await SeasonRepository.get(campaignId.value, year)
    if (seasonData?.seasonAwardsViewed) return
    seasonAwardsYear.value = year
  } catch (err) {
    console.warn('[CampaignHome] season awards lookup failed:', err)
    seasonAwardsYear.value = campaignStore.currentCampaign?.currentSeasonYear ?? null
  }

  seasonAwardsForModal.value = awards
  showSeasonAwardsModal.value = true
}

async function handleCloseSeasonAwardsModal() {
  showSeasonAwardsModal.value = false
  // Persist the dismissal so navigating away and back doesn't re-show it.
  try {
    const { SeasonRepository } = await import('@/engine/db/SeasonRepository')
    const year = seasonAwardsYear.value
      ?? campaignStore.currentCampaign?.currentSeasonYear
      ?? campaignStore.currentCampaign?.game_year
    if (year) {
      const seasonData = await SeasonRepository.get(campaignId.value, year)
      if (seasonData) {
        seasonData.seasonAwardsViewed = true
        await SeasonRepository.save(seasonData)
      }
    }
  } catch (err) {
    console.warn('[CampaignHome] failed to persist seasonAwardsViewed:', err)
  }
  seasonAwardsForModal.value = null

  // After awards close, surface the retirement modal (if applicable). Awards
  // and retirements both fire once per offseason, but retirements come second
  // so the user reads the season's wrap-up before seeing who hung it up.
  await maybeShowRetirementModal()
  // If no retirements, chain straight to the GM contract decision.
  if (!showRetirementModal.value) {
    await maybeShowContractDecisionModal()
  }
  // Chain terminal: if nothing else opened, the offseason tour can run now.
  maybeStartOffseasonTour()
}

// Snapshot retirees + year at the moment we open the modal so dismissal can
// safely clear settings.pendingRetirements without the modal blanking out
// during its close transition.
const retireesForModal = ref([])
const pendingRetirementsYear = ref(null)

async function maybeShowRetirementModal() {
  const camp = campaignStore.currentCampaign
  if (!camp) return
  const list = camp.settings?.pendingRetirements ?? []
  if (list.length === 0) return
  const year = camp.settings?.pendingRetirementsYear
  if (camp.settings?.retirementsDismissedYear === year) return
  retireesForModal.value = list
  pendingRetirementsYear.value = year
  showRetirementModal.value = true
  // Persist the dismissal year immediately on show so the modal is fire-once
  // even if the user leaves the page via navigation instead of clicking Close.
  // updateSettings does a shallow merge on the IndexedDB-side plain object,
  // so we don't risk feeding reactive-wrapped values from currentCampaign
  // back into structuredClone (which was throwing DataCloneError before).
  try {
    await CampaignRepository.updateSettings(campaignId.value, {
      retirementsDismissedYear: year,
    })
    if (campaignStore.currentCampaign?.id === campaignId.value) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        retirementsDismissedYear: year,
      }
    }
  } catch (err) {
    console.warn('[CampaignHome] failed to stamp retirement dismissal on show:', err)
  }
}

async function handleCloseRetirementModal() {
  showRetirementModal.value = false
  // Hard-clear `pendingRetirements` from settings (alongside stamping the
  // dismissed year) so the modal cannot re-pop even if the year flag is
  // somehow overwritten by another settings mutation downstream. The list
  // is empty → the maybeShow guard returns early on every future call.
  // updateSettings does a shallow merge on the IndexedDB-side plain object
  // so we skip the reactive-proxy cloning issue that updateCampaign hit.
  try {
    const camp = campaignStore.currentCampaign
    if (!camp) return
    const year = camp.settings?.pendingRetirementsYear
    const patch = {
      pendingRetirements: [],
      retirementsDismissedYear: year,
    }
    await CampaignRepository.updateSettings(campaignId.value, patch)
    if (campaignStore.currentCampaign?.id === campaignId.value) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        ...patch,
      }
    }
  } catch (err) {
    console.warn('[CampaignHome] failed to persist retirement dismissal:', err)
  }

  // Retirements are the last info modal — chain the GM contract-end decision.
  await maybeShowContractDecisionModal()
  // Chain terminal: if no contract decision opened, the offseason tour can run.
  maybeStartOffseasonTour()
}

// --- GM contract-end decision (Part 2) --------------------------------------
// Opens the ContractDecisionModal if the owner evaluated the GM this offseason.
// Fire-once-by-year, mirroring the retirement stash pattern.
async function maybeShowContractDecisionModal() {
  const camp = campaignStore.currentCampaign
  if (!camp) return
  const pending = camp.settings?.pendingContractDecision
  if (!pending) return
  if (camp.settings?.contractDecisionDismissedYear === pending.year) return
  // The not-extended flow needs the team list for the picker.
  if (!campaignStore.availableTeams?.length) {
    try { await campaignStore.fetchAvailableTeams() } catch { /* picker still renders empty-safe */ }
  }
  contractDecisionData.value = pending
  showContractDecisionModal.value = true
}

// Owner extends → re-sign the same team, bump GM Level (+achievement), continue.
async function handleExtendContract() {
  if (contractDecisionBusy.value) return
  contractDecisionBusy.value = true
  const loadingToastId = toastStore.showLoading('Re-signing your contract...')
  try {
    await resignGmContract(campaignId.value)
    const { previous, level, promoted } = await authStore.promoteGmLevel()
    await _stampContractDecisionDismissed()
    await campaignStore.fetchCampaign(campaignId.value, true)

    toastStore.removeMinimalToast(loadingToastId)
    showContractDecisionModal.value = false
    contractDecisionData.value = null
    toastStore.showSuccess('Contract extended — your owner is keeping you on.', 4000)
    if (promoted) {
      await _recordGmPromotion(level)
      toastStore.showAchievement({
        label: `Promoted to GM Level ${gmLevelLabel(level)}`,
        subtitle: `${gmLevelLabel(previous)} → ${gmLevelLabel(level)}`,
        type: 'gm_promotion',
      })
    }
    // Contract decision was the last modal in the offseason chain — tour can run.
    maybeStartOffseasonTour()
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Failed to re-sign contract')
    console.error('[CampaignHome] extend contract failed:', err)
  } finally {
    contractDecisionBusy.value = false
  }
}

// Owner moves on → take over a newly chosen franchise (staff reset, fresh deal).
async function handleSwitchTeam(newTeamAbbreviation) {
  if (contractDecisionBusy.value || !newTeamAbbreviation) return
  contractDecisionBusy.value = true
  const loadingToastId = toastStore.showLoading('Taking over your new team...')
  try {
    await switchUserTeam(campaignId.value, newTeamAbbreviation)
    await _stampContractDecisionDismissed()
    // Repoint every store to the new team before continuing the offseason.
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
    ])
    financeStore.invalidate()

    toastStore.removeMinimalToast(loadingToastId)
    showContractDecisionModal.value = false
    contractDecisionData.value = null
    // Pop the new owner's welcome conversation right then. Its close handler
    // resumes the offseason tour. Fall back to a toast + the tour only if no
    // owner could be resolved for the new team.
    if (!maybeShowOwnerWelcome()) {
      toastStore.showSuccess(`You're now the GM of the ${teamStore.team?.name ?? 'new team'}.`, 4500)
      maybeStartOffseasonTour()
    }
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError('Failed to switch teams')
    console.error('[CampaignHome] switch team failed:', err)
  } finally {
    contractDecisionBusy.value = false
  }
}

// Persist the fire-once marker so the decision modal doesn't re-pop. (resign/
// switch already clear pendingContractDecision; this stamps the year too.)
async function _stampContractDecisionDismissed() {
  const year = contractDecisionData.value?.year
  if (year == null) return
  try {
    await CampaignRepository.updateSettings(campaignId.value, { contractDecisionDismissedYear: year })
    if (campaignStore.currentCampaign?.id === campaignId.value) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        contractDecisionDismissedYear: year,
      }
    }
  } catch (err) {
    console.warn('[CampaignHome] failed to stamp contract decision dismissal:', err)
  }
}

// Append a GM-promotion entry to campaign.achievements (drives the Dashboard
// Recent Activity feed + campaign-card meta, same as championship achievements).
async function _recordGmPromotion(level) {
  try {
    // Load a fresh plain campaign (avoid structuredClone choking on reactive
    // proxies) so the achievements write doesn't clobber other settings.
    const camp = await CampaignRepository.get(campaignId.value)
    if (!camp) return
    const list = Array.isArray(camp.achievements) ? [...camp.achievements] : []
    const entry = {
      id: `ach_gm_${level}_${contractDecisionData.value?.year ?? ''}`,
      type: 'gm_promotion',
      // Numeric level reached, so the profile-global gmLevel can self-heal from
      // recorded promotions if a backend persist was ever lost (see campaign.js).
      level,
      year: contractDecisionData.value?.year ?? camp.currentSeasonYear,
      // In-game date for context; createdAt (real wall-clock) drives the
      // Recent Activity feed's "X ago" so recency reflects real time.
      date: camp.currentDate ?? null,
      createdAt: new Date().toISOString(),
      teamId: camp.teamId,
      teamAbbreviation: camp.teamAbbreviation,
      label: `Promoted to GM Level ${gmLevelLabel(level)}`,
      subtitle: `${contractDecisionData.value?.ownerName ?? 'Your owner'} extended your contract`,
    }
    list.push(entry)
    camp.achievements = list
    await CampaignRepository.save(camp)
    if (campaignStore.currentCampaign?.id === campaignId.value) {
      campaignStore.currentCampaign.achievements = list
    }
  } catch (err) {
    console.warn('[CampaignHome] failed to record GM promotion achievement:', err)
  }
}

// --- Owner Welcome (new GM job) ---------------------------------------------
// Minimal welcome conversation the moment a user accepts a NEW GM job — a fresh
// campaign or taking over a new franchise. Greeting + mandate (owner's tone) +
// the franchise expectation; no sub-goal checklist. Fire-once per job, keyed to
// the team + the contract's tenure start, so each new job triggers exactly once
// (and the next season's full check-in doesn't re-pop it). Returns true if opened.
function maybeShowOwnerWelcome() {
  const camp = campaignStore.currentCampaign
  // Identity guard (see maybeShowOwnerCheckIn): never greet for a campaign other
  // than the one in the route, even if the stores are mid-switch.
  if (!camp || camp.id !== campaignId.value) return false
  const abbr = camp.teamAbbreviation ?? teamStore.team?.abbreviation ?? null
  const owner = findOwnerForTeam(abbr)
  if (!owner) return false

  const year = camp.currentSeasonYear ?? camp.current_season_year
  const gmc = camp.settings?.gmContract ?? null
  const tenureStart = gmc?.tenureStartYear ?? gmc?.signedSeasonYear ?? year
  // Only for a genuinely new job — the GM's first season with this team. Guards
  // established campaigns (incl. pre-feature saves missing the marker) from
  // popping a "welcome" to a GM who's been running the team for years.
  if (year == null || year > tenureStart) return false
  const key = `${camp.teamId}:${tenureStart}`
  if (camp.settings?.ownerWelcomeShownKey === key) return false

  const eff = getEffectiveExpectation(camp, owner)
  const built = buildOwnerCheckIn({
    owner: effectiveOwner(owner, eff.tier),
    subtasks: [],
    expectedWins: eff.expectedWins,
    seasonYear: year,
    isFirstSeason: true,
    yearsRemaining: 0,
  })
  ownerWelcomeData.value = {
    owner,
    seasonYear: year,
    expectation: { ...eff, blurb: EXPECTATION_BLURB_DEFAULT[eff.tier] ?? '' },
    lines: [...built.greetingLines, ...built.closingLines],
  }
  showOwnerWelcomeModal.value = true
  // Suspend onboarding tours while the welcome is up — otherwise the
  // campaignHome walkthrough (started in onMounted) renders over this popup on a
  // brand-new campaign. handleCloseOwnerWelcome re-arms them (or hands off to the
  // check-in, which keeps them suspended until it's dismissed).
  walkthroughStore.setSuspended(true)

  // Stamp the fire-once marker immediately (best-effort), like the check-in.
  try {
    CampaignRepository.updateSettings(campaignId.value, { ownerWelcomeShownKey: key })
    if (campaignStore.currentCampaign?.id === campaignId.value) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        ownerWelcomeShownKey: key,
      }
    }
  } catch (err) {
    console.warn('[CampaignHome] failed to stamp owner welcome marker:', err)
  }
  return true
}

function handleCloseOwnerWelcome() {
  showOwnerWelcomeModal.value = false
  ownerWelcomeData.value = null
  // On a fresh campaign the welcome precedes the season-start full check-in
  // (which keeps tours suspended and re-arms them on its own close). After a
  // mid-campaign switch (offseason) the check-in no-ops, so re-arm the tours the
  // welcome suspended and resume the offseason tour instead.
  if (!maybeShowOwnerCheckIn()) {
    walkthroughStore.setSuspended(false)
    walkthroughStore.maybeStart('campaignHome')
    maybeStartOffseasonTour()
  }
}

// --- Owner Check-In (Part 2 capstone) ---------------------------------------
// The owner's start-of-season conversation. Fired as the FIRST thing the user
// sees right after campaign creation and at the start of each new season.
// Fire-once-per-season via settings.ownerCheckInShownYear; suspends onboarding
// tours until dismissed. Returns true if the modal was opened.
// Surface a mid-season owner-expectation raise (set by the sim loop). Toast worded
// as the owner; the Owner tab already lists the newly-appended goals alongside the
// kept ones. Fires once — clears the marker after showing.
async function maybeShowExpectationRaise() {
  const camp = campaignStore.currentCampaign
  if (!camp || camp.id !== campaignId.value) return
  const raise = camp.settings?.pendingOwnerExpectationRaise
  if (!raise?.tier) return

  const label = EXPECTATION_LABEL[raise.tier] ?? raise.tier
  const fromLabel = raise.fromTier ? (EXPECTATION_LABEL[raise.fromTier] ?? raise.fromTier) : ''
  toastStore.showOwnerExpectation({ label, fromLabel, campaignId: campaignId.value })

  try {
    await CampaignRepository.updateSettings(campaignId.value, { pendingOwnerExpectationRaise: null })
    if (campaignStore.currentCampaign?.id === campaignId.value) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        pendingOwnerExpectationRaise: null,
      }
    }
  } catch (err) {
    console.warn('[CampaignHome] failed to clear expectation-raise marker:', err)
  }
}

function maybeShowOwnerCheckIn() {
  const camp = campaignStore.currentCampaign
  // Identity guard: the stores are singletons, so on a campaign switch they may
  // still hold the PREVIOUS campaign until its fetches resolve. Bail unless the
  // loaded campaign matches the one in the route — otherwise we'd render (and
  // mis-stamp) the old campaign's owner/coach intro.
  if (!camp || camp.id !== campaignId.value) return false
  // Only at the top of a regular season (covers fresh creation + new season).
  if (camp.phase !== 'regular_season') return false
  const year = camp.currentSeasonYear ?? camp.current_season_year
  if (year == null) return false
  if (camp.settings?.ownerCheckInShownYear === year) return false

  const abbr = camp.teamAbbreviation ?? teamStore.team?.abbreviation ?? null
  const owner = findOwnerForTeam(abbr)
  if (!owner) return false

  const gmc = camp.settings?.gmContract ?? null
  // Live (ratcheted) expectation for this campaign — falls back to the owner's
  // static baseline for older saves.
  const eff = getEffectiveExpectation(camp, owner)
  const subResult = evaluateSubtasks({
    owner,
    expectation: eff.tier,
    expectationTiers: gmc?.expectationTiers ?? (eff.tier ? [eff.tier] : null),
    roster: teamStore.roster ?? [],
    draftPicks: teamStore.team?.draftPicks ?? [],
    facilities: teamStore.team?.facilities ?? null,
    settings: camp.settings ?? {},
    payroll: teamStore.totalSalary ?? 0,
    progress: gmc?.progress ?? {},
    userTeamId: camp.teamId ?? teamStore.team?.id ?? null,
    coach: teamStore.coach ?? teamStore.team?.coach ?? null,
    salaryCap: SALARY_CAP,
  })

  const signedYear = gmc?.signedSeasonYear ?? year
  const length = gmc?.lengthYears ?? 2
  // First meeting = the GM's first season with THIS team. Keyed off tenure
  // start (preserved across re-signings), not signedSeasonYear (which resets
  // every time the contract is extended) — otherwise a re-signed GM gets the
  // "welcome aboard, nice to meet you" greeting every renewal. Falls back to
  // signedYear for saves created before tenureStartYear existed.
  const tenureStart = gmc?.tenureStartYear ?? signedYear
  const isFirstSeason = year <= tenureStart
  const yearsRemaining = Math.max(0, length - Math.max(0, year - signedYear))

  ownerCheckInData.value = {
    owner,
    seasonYear: year,
    ...buildOwnerCheckIn({
      owner: effectiveOwner(owner, eff.tier),
      subtasks: subResult.subtasks,
      expectedWins: eff.expectedWins,
      seasonYear: year,
      isFirstSeason,
      yearsRemaining,
    }),
  }
  showOwnerCheckInModal.value = true
  walkthroughStore.setSuspended(true)

  // Stamp the fire-once marker immediately (best-effort) so navigating away and
  // back within the season doesn't re-pop it. Mirrors the retirement dismissal.
  try {
    CampaignRepository.updateSettings(campaignId.value, { ownerCheckInShownYear: year })
    if (campaignStore.currentCampaign?.id === campaignId.value) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        ownerCheckInShownYear: year,
      }
    }
  } catch (err) {
    console.warn('[CampaignHome] failed to stamp owner check-in marker:', err)
  }
  return true
}

function handleCloseOwnerCheckIn() {
  showOwnerCheckInModal.value = false
  ownerCheckInData.value = null
  // Resume onboarding now that the check-in has been seen.
  walkthroughStore.setSuspended(false)
  walkthroughStore.maybeStart('campaignHome')
  maybeStartOffseasonTour()
  // The owner check-in is the new-season landing modal; chain the coach re-sign
  // prompt after it so an expiring head coach gets surfaced.
  maybeShowCoachDecisionModal()
}

// --- Coach re-sign decision (expiring head coach) ---------------------------
// startNewSeason stashes an expiring user coach in settings.pendingCoachDecision
// instead of silently dropping it. Surface a prompt to re-sign or replace.
// Fire-once-by-year; won't stack over the new-season/owner/offseason modals.
function maybeShowCoachDecisionModal() {
  const camp = campaignStore.currentCampaign
  if (!camp) return
  const pending = camp.settings?.pendingCoachDecision
  if (!pending?.coach) return
  // Stale after a team switch — only prompt for the current team's coach.
  if (pending.teamId != null && camp.teamId != null && String(pending.teamId) !== String(camp.teamId)) return
  if (camp.settings?.coachDecisionDismissedYear === pending.year) return
  // Don't render over another blocking modal; close handlers re-invoke this.
  if (
    showOwnerCheckInModal.value ||
    showOwnerWelcomeModal.value ||
    showContractDecisionModal.value ||
    showRetirementModal.value ||
    showAllStarModal.value ||
    showSeasonAwardsModal.value ||
    showNewSeasonModal.value
  ) {
    return
  }
  coachDecisionData.value = pending
  showCoachResignModal.value = true
}

async function _stampCoachDecisionDismissed() {
  const year = coachDecisionData.value?.year ?? campaignStore.currentCampaign?.currentSeasonYear
  try {
    await CampaignRepository.updateSettings(campaignId.value, { coachDecisionDismissedYear: year })
    if (campaignStore.currentCampaign?.id === campaignId.value) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        coachDecisionDismissedYear: year,
      }
    }
  } catch (err) {
    console.warn('[CampaignHome] failed to stamp coach decision dismissal:', err)
  }
}

async function handleCoachResigned() {
  if (coachResignBusy.value) return
  coachResignBusy.value = true
  const loadingToastId = toastStore.showLoading('Re-signing your coach...')
  try {
    const { coach, cost } = await teamStore.resignPendingCoach(campaignId.value)
    await _stampCoachDecisionDismissed()
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
    ])
    toastStore.removeMinimalToast(loadingToastId)
    showCoachResignModal.value = false
    coachDecisionData.value = null
    toastStore.showSuccess(
      cost > 0
        ? `Re-signed ${coach?.name ?? 'your coach'} (−${cost} tokens)`
        : `Re-signed ${coach?.name ?? 'your coach'}`,
      4000
    )
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError(err?.message || 'Failed to re-sign coach')
    console.error('[CampaignHome] resign coach failed:', err)
  } finally {
    coachResignBusy.value = false
  }
}

// "Sign a new coach" → close the prompt and open the hire-coach browser.
function handleCoachHireNew() {
  showCoachResignModal.value = false
  showHireCoachModal.value = true
}

// Hire modal completed a hire → clear the pending decision so it doesn't re-prompt.
async function handleCoachHired() {
  showHireCoachModal.value = false
  await _stampCoachDecisionDismissed()
  try {
    await CampaignRepository.updateSettings(campaignId.value, { pendingCoachDecision: null })
    if (campaignStore.currentCampaign?.id === campaignId.value) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        pendingCoachDecision: null,
      }
    }
  } catch (err) {
    console.warn('[CampaignHome] failed to clear pending coach decision:', err)
  }
  coachDecisionData.value = null
}

// Dismiss ("decide later") → leave the team coachless; don't re-pop this year.
async function handleCloseCoachResign() {
  showCoachResignModal.value = false
  await _stampCoachDecisionDismissed()
  coachDecisionData.value = null
}

// New-season summary closed → the owner's check-in is the next (first) thing the
// user sees as the new season opens.
function handleCloseNewSeasonModal() {
  showNewSeasonModal.value = false
  newSeasonData.value = null
  maybeShowOwnerCheckIn()
  // If the owner check-in didn't open (already seen this year), surface the coach
  // re-sign prompt now; otherwise its close handler chains it.
  maybeShowCoachDecisionModal()
}

// Handle starting a new season from offseason hub
async function handleStartNewSeason() {
  // Gate: 12+ rostered players AND a head coach signed. If either is
  // missing, surface the blocker modal instead of attempting the engine
  // call (which would throw and just show a generic error toast).
  if (startSeasonBlocked.value) {
    showStartSeasonBlockerModal.value = true
    return
  }
  advancingToNextSeason.value = true
  const loadingToastId = toastStore.showLoading('Starting new season...')
  try {
    const result = await startNewSeason(campaignId.value)

    // Clear offseason and playoff state
    offseasonData.value = null
    playoffStore.$reset()
    financeStore.invalidate()

    // Refresh all data from the new season
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
      gameStore.fetchGames(campaignId.value, { force: true }),
      leagueStore.fetchStandings(campaignId.value, { force: true }),
    ])

    toastStore.removeMinimalToast(loadingToastId)

    // Surface the AI coach carousel (hires / firings / retirements / extensions)
    // as regular news-feed items — not breaking-news banners.
    for (const item of result.coachCarousel ?? []) {
      breakingNewsStore.addToFeed(item, campaignId.value)
    }

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

// AI-driven "finish my offseason setup" — hires a free coach and signs
// FAs to the roster floor. Wired to the StartSeasonBlockerModal so the
// user can resolve both prereqs in one click, then we automatically chain
// into handleStartNewSeason on success.
async function handleAiFinishStartSetup() {
  if (simmingStartSetup.value) return
  simmingStartSetup.value = true
  const loadingToastId = toastStore.showLoading('Front office is wrapping up your roster…')
  try {
    const result = await aiFinishUserTeamSetup(campaignId.value)
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      teamStore.fetchTeam(campaignId.value, { force: true }),
    ])
    toastStore.removeMinimalToast(loadingToastId)
    const parts = []
    if (result.coachHired) parts.push(`Hired ${result.coachHired.name}`)
    if (result.playersSigned?.length) parts.push(`signed ${result.playersSigned.length} player${result.playersSigned.length === 1 ? '' : 's'}`)
    // Defer a tick so the campaign / team refetch has settled before we
    // re-evaluate `startSeasonBlocked`.
    await new Promise(r => setTimeout(r, 50))
    if (!startSeasonBlocked.value) {
      // Prereqs satisfied — close the modal and chain into the actual start.
      toastStore.showSuccess(parts.length ? parts.join(' · ') : 'Setup complete')
      showStartSeasonBlockerModal.value = false
      await handleStartNewSeason()
    } else {
      // Couldn't fully resolve (e.g., no free coach in the pool, FA pool
      // too thin to fill the roster). Keep the modal open so the user sees
      // the updated state and can either retry the AI fill or finish
      // manually. Toast as a warning rather than a success.
      const summary = parts.length ? parts.join(' · ') : 'Nothing to sign'
      toastStore.showError(`AI couldn't fully finish setup — ${summary}. Resolve the remaining items below.`)
    }
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError(err.message || 'Failed to finish setup')
    console.error('Failed to AI-finish setup:', err)
  } finally {
    simmingStartSetup.value = false
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

    // Surface the AI coach carousel (hires / firings / retirements / extensions)
    // as regular news-feed items — not breaking-news banners.
    for (const item of result.coachCarousel ?? []) {
      breakingNewsStore.addToFeed(item, campaignId.value)
    }

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

function navigateToFreeAgency() {
  router.push({
    path: `/campaign/${campaignId.value}/team`,
    query: { tab: 'finances', sub: 'free-agents' },
  })
}

async function handleEnterFreeAgency() {
  audio.suppressClickSound() // affirmation chime instead of the generic tap
  audio.affirm()
  enteringFreeAgency.value = true
  const loadingToastId = toastStore.showLoading('Opening free agency...')
  try {
    await financeStore.startFreeAgencyPeriod(campaignId.value)
    await campaignStore.fetchCampaign(campaignId.value, true)
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showSuccess('Free agency is open.')
    // Drop the user directly onto the Free Agents sub-tab so they can start
    // making offers without having to hunt for it.
    navigateToFreeAgency()
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError(err.message || 'Failed to open free agency')
    console.error('Failed to start free agency:', err)
  } finally {
    enteringFreeAgency.value = false
  }
}

// Runs the rookie draft lottery for the current offseason. Instant (no
// staged reveal animation); the user sees a toast with a "View Results"
// link to the dedicated lottery results page. After this completes, the
// next-game card's CTA reverts to "Enter Free Agency" because the
// draftLotteryPending guard flips to false.
const runningLottery = ref(false)
const showDraftLotteryModal = ref(false)
async function handleRunDraftLottery() {
  if (runningLottery.value) return
  runningLottery.value = true
  const loadingToastId = toastStore.showLoading('Running draft lottery...')
  try {
    await runDraftLotteryForCampaign(campaignId.value)
    await campaignStore.fetchCampaign(campaignId.value, true)
    toastStore.removeMinimalToast(loadingToastId)
    // Show the results immediately in a popup (with the up/down movement arrows)
    // rather than a transient toast link to a separate page.
    showDraftLotteryModal.value = true
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError(err.message || 'Failed to run draft lottery')
    console.error('Failed to run draft lottery:', err)
  } finally {
    runningLottery.value = false
  }
}

// Closing the lottery results modal is the natural hand-off into free agency —
// kick off the FA walkthrough here. maybeStart is a safe no-op unless the user
// has walkthroughs enabled (and hasn't already seen/skipped this one), so it
// only fires "if they are viewing walkthroughs".
function handleCloseDraftLotteryModal() {
  showDraftLotteryModal.value = false
  walkthroughStore.maybeStart('freeAgency')
}

async function handleSimFreeAgencyDay() {
  audio.navigate() // generic tap; suppress the global one so it doesn't double
  audio.suppressClickSound()
  simmingFAday.value = true
  const loadingToastId = toastStore.showLoading('Simulating free-agency day...')
  try {
    const result = await financeStore.simFreeAgencyDay(campaignId.value)
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      financeStore.fetchFreeAgents(campaignId.value, { force: true }),
    ])
    toastStore.removeMinimalToast(loadingToastId)
    if (result.resolved) {
      const fas = await financeStore.consumeFreeAgencyResults(campaignId.value)
      if (fas) {
        endOfFreeAgencyResults.value = fas
        showEndOfFreeAgencyModal.value = true
      }
      toastStore.showSuccess('Free agency complete!')
    } else {
      toastStore.showSuccess(`Day ${result.day}/${FREE_AGENCY_DURATION_DAYS} simulated`)
    }
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError(err.message || 'Failed to simulate day')
    console.error('Failed to sim FA day:', err)
  } finally {
    simmingFAday.value = false
  }
}

async function handleSimRestOfFreeAgency() {
  audio.navigate() // generic tap; suppress the global one so it doesn't double
  audio.suppressClickSound()
  simmingFAday.value = true
  const loadingToastId = toastStore.showLoading('Simulating remainder of free agency...')
  try {
    await financeStore.simRestOfFreeAgency(campaignId.value)
    await Promise.all([
      campaignStore.fetchCampaign(campaignId.value, true),
      financeStore.fetchFreeAgents(campaignId.value, { force: true }),
    ])
    toastStore.removeMinimalToast(loadingToastId)
    const fas = await financeStore.consumeFreeAgencyResults(campaignId.value)
    if (fas) {
      endOfFreeAgencyResults.value = fas
      showEndOfFreeAgencyModal.value = true
    }
    toastStore.showSuccess('Free agency complete!')
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError(err.message || 'Failed to simulate free agency')
    console.error('Failed to sim rest of FA:', err)
  } finally {
    simmingFAday.value = false
  }
}

function closeEndOfFreeAgencyModal() {
  showEndOfFreeAgencyModal.value = false
  endOfFreeAgencyResults.value = null
}

const finalizingChoices = ref(false)
async function handleConfirmFreeAgencyChoices(selectedIds) {
  if (finalizingChoices.value) return
  const pending = endOfFreeAgencyResults.value?.pendingChoice
  if (!pending) return
  finalizingChoices.value = true
  try {
    const { accepted: newAccepted, declined: newDeclined } =
      await financeStore.finalizeFreeAgencyUserChoices(
        campaignId.value,
        pending.offers,
        selectedIds
      )
    endOfFreeAgencyResults.value = {
      accepted: [...(endOfFreeAgencyResults.value?.accepted ?? []), ...newAccepted],
      declined: [...(endOfFreeAgencyResults.value?.declined ?? []), ...newDeclined],
      pendingChoice: null,
    }
    toastStore.showSuccess(
      newAccepted.length === 1
        ? `${newAccepted[0].playerName} signed!`
        : `Signed ${newAccepted.length} free agent${newAccepted.length === 1 ? '' : 's'}`
    )
  } catch (err) {
    console.error('Failed to finalize FA choices:', err)
    toastStore.showError(err.message || 'Failed to finalize signings')
  } finally {
    finalizingChoices.value = false
  }
}

// -----------------------------------------------------------------------------
// Featured-player detail modal
// -----------------------------------------------------------------------------
// Clicking the Featured Player card opens the same PlayerDetailModal the
// Personnel tab uses, so the user can scout, upgrade, and run coach meetings
// without leaving the home view. Wiring mirrors TeamManagementView's setup
// but binds to a separate `modalPlayer` snapshot (not the live
// `featuredPlayer` computed) so the modal stays on whoever the user clicked
// even if the bi-weekly selection rolls over mid-session.
const modalPlayer = ref(null)
const showFeaturedPlayerModal = ref(false)

// Exiting the headshot editor lands the user back on this view's default
// state — no featured-player modal auto-reopens.

function openPlayerDetails() {
  if (!featuredPlayer.value) return
  openPlayerInModal(featuredPlayer.value)
}

// Shared opener so the FA card rows (and any future card surface) can
// reuse the same PlayerDetailModal mount the Featured Player click uses.
function openPlayerInModal(player) {
  if (!player) return
  modalPlayer.value = player
  showFeaturedPlayerModal.value = true
}

function closeFeaturedPlayerModal() {
  showFeaturedPlayerModal.value = false
  modalPlayer.value = null
}

const modalEvolutionHistory = computed(() => {
  return modalPlayer.value?.development_history || []
})

const modalSevenDaysAgo = computed(() => {
  const currentDateStr = campaign.value?.current_date || campaign.value?.currentDate || new Date().toISOString().split('T')[0]
  const [y, m, d] = currentDateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - 7)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
})

function aggregateModalEvolution(history) {
  const aggregated = {}
  for (const entry of history) {
    const key = `${entry.category}.${entry.attribute}`
    if (!aggregated[key]) {
      aggregated[key] = { category: entry.category, attribute: entry.attribute, totalChange: 0, count: 0 }
    }
    aggregated[key].totalChange += entry.change
    aggregated[key].count++
  }
  return Object.values(aggregated).sort((a, b) => {
    if (a.totalChange > 0 && b.totalChange <= 0) return -1
    if (a.totalChange <= 0 && b.totalChange > 0) return 1
    return Math.abs(b.totalChange) - Math.abs(a.totalChange)
  })
}

const modalRecentEvolution = computed(() => {
  const recent = modalEvolutionHistory.value.filter(e => e.date >= modalSevenDaysAgo.value)
  return aggregateModalEvolution(recent)
})

const modalAllTimeEvolution = computed(() => {
  return aggregateModalEvolution(modalEvolutionHistory.value)
})

const modalPlayerNews = computed(() => {
  if (!modalPlayer.value) return []
  const allNews = campaignStore.currentCampaign?.news ?? []
  return allNews.filter(n => n.player_id === modalPlayer.value.id).slice().reverse()
})

async function handleModalUpgradeAttribute({ playerId, category, attribute, pool }) {
  try {
    const result = await teamStore.upgradePlayerAttribute(campaignId.value, playerId, category, attribute, pool)
    const attrLabel = attribute.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim()
    toastStore.showSuccess(`${attrLabel} upgraded to ${Math.floor(result.new_value)}!`)
    modalPlayer.value = teamStore.roster?.find(p => p.id === playerId) ?? modalPlayer.value
  } catch (err) {
    toastStore.showError(err.response?.data?.message || err.message || 'Upgrade failed')
  }
}

async function handleModalPurchaseUpgradePoint({ playerId, pool, price }) {
  try {
    await teamStore.purchaseUpgradePoint(campaignId.value, playerId, pool)
    const label = pool === 'defense' ? 'defensive' : 'offensive'
    toastStore.showSuccess(`+1 ${label} upgrade point purchased for ${price.toLocaleString()} tokens`)
    modalPlayer.value = teamStore.roster?.find(p => p.id === playerId) ?? modalPlayer.value
  } catch (err) {
    toastStore.showError(err.response?.data?.message || err.message || 'Purchase failed')
  }
}

async function handleModalHoldCoachMeeting({ playerId, purchasedAction }) {
  try {
    const res = await teamStore.holdCoachMeeting(campaignId.value, playerId, { purchasedAction })
    const summary = purchasedAction
      ? `Bought a coach meeting · morale +30 (now ${res.morale})`
      : `Coach meeting held · morale +30 (now ${res.morale}) · ${res.actionsRemaining} actions left`
    toastStore.showSuccess(summary)
    modalPlayer.value = teamStore.roster?.find(p => p.id === playerId) ?? modalPlayer.value
  } catch (err) {
    toastStore.showError(err.response?.data?.message || err.message || 'Failed to hold meeting')
  }
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
      // Owner may have raised expectations mid-season after this run's results.
      await maybeShowExpectationRaise()
      await checkPlayoffStatus()
      // Check for trade proposals after user game sim
      await checkTradeDeadline()
      await checkPendingTradeProposals()
      // Check for All-Star selections — _processMidSeasonEvents may have just
      // populated seasonData.allStarRosters during the sim. The currentDate
      // watcher bails out when backgroundSimulating flips true mid-sim, so
      // run the check explicitly here.
      await checkAllStarSelections()
      await maybeAutoFinishRegularSeason()
    }

    // Show weekly summary if weeks passed. Clear the gameStore ref afterwards
    // so a later mount of this view doesn't re-fire the same toast — onMounted
    // and handleSimToEnd both read this same ref.
    if (response.weeklySummary) {
      toastStore.showWeeklySummary({
        scoutingPointsEarned: response.weeklySummary.scoutingPointsEarned ?? 0,
        campaignId: campaignId.value,
      })
      gameStore.weeklySummaryData = null
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
      await maybeAutoFinishRegularSeason()
    }

    // Show weekly summary if weeks passed
    if (gameStore.weeklySummaryData) {
      toastStore.showWeeklySummary({
        scoutingPointsEarned: gameStore.weeklySummaryData.scoutingPointsEarned ?? 0,
        campaignId: campaignId.value,
      })
      gameStore.weeklySummaryData = null
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

// Trade deadline check.
// `_processMidSeasonEvents` in game.js enqueues the breaking news at the moment
// the flag flips (Feb 5) AND sets a persistent `trade_deadline_news_shown`
// flag. This fallback runs after sim flows for older campaigns that flipped
// `trade_deadline_passed` before the news-shown flag existed (or for AI-trade
// paths in `AITradeService` that auto-flip the deadline without enqueuing
// news). The flag is what we check — NOT seasonData.news, which gets trimmed
// to the last 50 entries and loses the deadline record by playoff time.
const tradeDeadlineAlerted = ref(false)
async function checkTradeDeadline() {
  if (tradeDeadlineAlerted.value) return
  const camp = campaignStore.currentCampaign
  if (!camp) return
  const settings = camp.settings || {}
  if (!settings.trade_deadline_passed) return
  // Already announced — never re-fire across navigations / playoffs / future seasons.
  if (settings.trade_deadline_news_shown) {
    tradeDeadlineAlerted.value = true
    return
  }
  tradeDeadlineAlerted.value = true

  const year = camp.currentSeasonYear ?? camp.game_year ?? new Date().getFullYear()
  const deadlineDate = `${year}-12-15`
  breakingNewsStore.enqueue(
    BreakingNewsService.tradeDeadlinePassed({ date: deadlineDate }),
    campaignId.value
  )

  // Persist the news-shown flag so this never fires again, even after the news
  // ticker entry gets trimmed out of seasonData.news.
  try {
    await CampaignRepository.updateSettings(campaignId.value, {
      trade_deadline_news_shown: true,
    })
    if (campaignStore.currentCampaign?.id === campaignId.value) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        trade_deadline_news_shown: true,
      }
    }
  } catch (err) {
    console.warn('[CampaignHome] Failed to persist trade_deadline_news_shown:', err)
  }
}

// Trade proposal handling
async function checkPendingTradeProposals() {
  const camp = campaignStore.currentCampaign
  if (!camp) return

  // Only generate proposals during regular season, before trade deadline
  if (camp.phase === 'offseason' || camp.phase === 'offseason_free_agency' || camp.phase === 'offseason_draft' || camp.phase === 'playoffs') return
  if (camp.settings?.trade_deadline_passed) return

  try {
    const proposals = await tradeStore.fetchPendingProposals(campaignId.value)
    const next = proposals.find(p => !dismissedProposalIds.value.has(p.id))
    if (next) {
      currentProposal.value = next
      showTradeProposalModal.value = true
    }
  } catch (err) {
    console.error('Failed to check trade proposals:', err)
  }
}

async function handleAcceptProposal(proposal) {
  if (proposalActionBusy.value) return
  proposalActionBusy.value = true
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
    const next = tradeStore.pendingProposals.find(p => !dismissedProposalIds.value.has(p.id))
    if (next) {
      currentProposal.value = next
      showTradeProposalModal.value = true
    }
  } catch (err) {
    toastStore.removeMinimalToast(loadingToastId)
    toastStore.showError(tradeStore.error || 'Failed to accept trade')
  } finally {
    proposalActionBusy.value = false
  }
}

// Declining is instant from the user's POV: close + advance the queue synchronously,
// then persist the rejection best-effort in the background. A decline can't really
// "fail" (it just leaves the user's queue), so no failure toast — and the button is
// guarded so a rapid double-tap can't double-advance/queue work.
function handleRejectProposal(proposal) {
  if (proposalActionBusy.value || !proposal) return
  proposalActionBusy.value = true

  // Optimistically drop it from the queue + advance to the next, immediately.
  showTradeProposalModal.value = false
  currentProposal.value = null
  const next = tradeStore.pendingProposals.find(
    p => p.id !== proposal.id && !dismissedProposalIds.value.has(p.id)
  )

  // Best-effort persist (removes it from pendingProposals + marks rejected); never
  // blocks the UI or surfaces an error for a decline.
  Promise.resolve(tradeStore.rejectProposal(campaignId.value, proposal.id))
    .catch(err => console.warn('[CampaignHome] reject proposal persist failed:', err))
    .finally(() => {
      proposalActionBusy.value = false
      if (next) {
        currentProposal.value = next
        showTradeProposalModal.value = true
      }
    })
}

function handleCloseProposalModal() {
  // Dismiss the popup only — keep the offer pending so it remains visible in
  // the Trades > Offers tab. Track the ID so checkPendingTradeProposals doesn't
  // re-pop this same proposal after every sim.
  if (currentProposal.value) {
    dismissedProposalIds.value.add(currentProposal.value.id)
  }
  showTradeProposalModal.value = false
  currentProposal.value = null
}

function handleNegotiateProposal(proposal) {
  // Stage the asset breakdown for the trade wizard, then route into the
  // Trades tab. TradesTab consumes the store state on mount and forwards it
  // to TradeCenter, which opens the wizard prefilled with both sides so the
  // user can build a counter.
  tradeStore.setNegotiationFromProposal(proposal)
  if (currentProposal.value) {
    dismissedProposalIds.value.add(currentProposal.value.id)
  }
  showTradeProposalModal.value = false
  currentProposal.value = null
  router.push(`/campaign/${campaignId.value}/team?tab=trades`)
}

// All-Star selection handling
async function checkAllStarSelections() {
  // Guarded: this runs in the mount chain — a malformed season record must not
  // break the whole campaign load.
  try {
    const camp = campaignStore.currentCampaign
    if (!camp) return

    const year = camp.currentSeasonYear ?? camp.game_year ?? 2025

    const { SeasonRepository } = await import('@/engine/db/SeasonRepository')
    const seasonData = await SeasonRepository.get(campaignId.value, year)
    if (!seasonData) return

    // Rosters are populated by game.js _processMidSeasonEvents during date
    // advancement, and the break is ANNOUNCED by the sim-pause modal
    // (SimPauseModal, reason 'all_star' — the one with headshots). We only cache
    // the rosters here for the manual re-view (awards timeline) — no auto-open,
    // which used to stack a second, headshot-less popup on top of the pause modal.
    if (seasonData.allStarRosters) {
      allStarRosters.value = seasonData.allStarRosters
    }
  } catch (err) {
    console.warn('All-Star roster check failed (non-fatal):', err)
  }
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
    const [{ selectBestLineup }, { generateRoleAwareTargetMinutes }] = await Promise.all([
      import('@/engine/ai/AILineupService'),
      import('@/engine/simulation/SubstitutionEngine'),
    ])
    const roster = teamStore.roster
    if (!roster || roster.length < 5) {
      toastStore.showError('Not enough players to set lineup')
      return
    }
    const newLineup = selectBestLineup(roster)
    await teamStore.updateLineup(campaignId.value, newLineup)

    // Distribute 240 minutes per the team's substitution strategy
    // (deep_bench, tight_rotation, etc).
    const strategy = teamStore.team?.coaching_scheme?.substitution || 'staggered'
    const starterIds = newLineup.filter(id => id !== null)
    const newMinutes = generateRoleAwareTargetMinutes(roster, starterIds, strategy)
    await teamStore.updateTargetMinutes(campaignId.value, newMinutes)

    showInjuryModal.value = false
    showRecoveryModal.value = false
    showRosterWarningModal.value = false
    toastStore.showSuccess('CPU adjusted your lineup')
  } catch (err) {
    toastStore.showError('Failed to auto-set lineup')
  }
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

// User dismissed the SeasonEndModal without clicking "Continue to Playoffs",
// then got stuck on the wrap-up card. Re-running checkRegularSeasonEnd flips
// the modal back open (it gates on `regularSeasonComplete && !bracketGenerated
// && phase !== 'offseason'`) so they can pick up the playoff transition.
async function handleContinueToPlayoffs() {
  try {
    await playoffStore.checkRegularSeasonEnd(campaignId.value)
  } catch (err) {
    console.error('Failed to re-open season-end modal:', err)
    toastStore.showError('Failed to advance to playoffs')
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
  // Step 1: run the sim. Only this step's failure means "the sim failed".
  try {
    if (userEliminated.value) {
      await gameStore.simulateToNextPlayoffRound(campaignId.value, { simAll: true })
    } else {
      await gameStore.simulateToNextPlayoffRound(campaignId.value)
    }
  } catch (err) {
    toastStore.showError('Failed to simulate playoff games')
    console.error('Failed to sim to next playoff round:', err)
    return
  }

  // Step 2: sim succeeded and persisted to IndexedDB. Refresh in-memory
  // stores with allSettled so a single fetch rejection doesn't masquerade
  // as a sim failure — production hit a case where the user was eliminated,
  // the sim finished and saved, but one of these refreshes rejected. The
  // user saw "Failed to simulate playoff games", got stuck, and only after
  // leaving and re-entering the campaign did the persisted (correct) state
  // surface. Treat refresh failures as recoverable: log them, fall back to
  // a less alarming toast, and let the next nav reload pick up the truth.
  const refreshResults = await Promise.allSettled([
    playoffStore.fetchBracket(campaignId.value),
    gameStore.fetchGames(campaignId.value, { force: true }),
    campaignStore.fetchCampaign(campaignId.value, true),
    leagueStore.fetchStandings(campaignId.value, { force: true }),
  ])
  const refreshFailures = refreshResults.filter(r => r.status === 'rejected')
  if (refreshFailures.length > 0) {
    for (const r of refreshFailures) {
      console.warn('[PlayoffSim] Post-sim refresh partial failure:', r.reason)
    }
    toastStore.showError('Playoffs simulated, but the page failed to refresh — reload to see the latest bracket.')
    return
  }

  if (userEliminated.value && playoffStore.champion) {
    const champion = playoffStore.champion
    const year = campaign.value?.season?.year || campaign.value?.game_year || new Date().getFullYear()
    breakingNewsStore.enqueue(
      BreakingNewsService.winningFinals({
        teamName: champion.name,
        year,
        date: campaign.value?.settings?.currentDate || new Date().toISOString().split('T')[0],
      }),
      campaignId.value
    )
  } else {
    toastStore.showSuccess('Next round is ready!')
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
      <!-- Team Header — shared component; date widget slots into the right -->
      <div data-tour="home-team-header">
        <TeamHeader :team="team" :team-overall="userTeamOverall">
          <template #right>
            <div v-if="formattedCurrentDate" class="current-date" data-tour="home-date">
              <span class="date-day">{{ formattedCurrentDate.day }}</span>
              <div class="date-details">
                <span class="date-month">{{ formattedCurrentDate.month }} {{ formattedCurrentDate.year }}</span>
                <span class="date-weekday">{{ formattedCurrentDate.weekday }}</span>
              </div>
            </div>
          </template>
        </TeamHeader>
      </div>

      <!-- Status row — pairs the facilities strip (85% width, deep-links
           to Personnel) with a minimal morale chip (15% width, just a
           face icon + percent). Both render their own card chrome so a
           missing data state on either side still looks like an
           intentional section break, not a broken layout. Sits above
           the Record card so the at-a-glance "franchise health" line
           (facilities + morale) is the first thing the user reads on
           the home view. -->
      <div v-if="facilities || teamMorale != null" class="home-status-row">
        <router-link
          v-if="facilities"
          :to="`/campaign/${campaignId}/team?tab=facilities`"
          class="facilities-card glass-card-nebula"
          data-tour="home-facilities"
          :aria-label="'Open Facilities tab'"
        >
          <div class="facilities-strip">
            <div
              v-for="f in facilities"
              :key="f.key"
              class="facility-tile"
              :title="`${f.label}: ${f.level} / 5`"
              :aria-label="`${f.label} ${f.level} of 5`"
            >
              <component :is="f.icon" :size="14" class="facility-icon" />
              <span class="facility-label">{{ f.label }}</span>
              <span class="facility-rating">
                <span class="facility-value">{{ f.level }}</span>
                <Star :size="11" class="facility-star" />
              </span>
            </div>
          </div>
        </router-link>

        <!-- Team morale chip — just a face icon + numeric percent. Same
             threshold bands as the per-player morale tile in
             PlayerDetailModal so the visual language carries across. -->
        <section
          v-if="teamMorale != null"
          class="team-morale-card glass-card-nebula"
          data-tour="home-team-morale"
          :title="`Team morale: ${teamMorale} / 100 (${moraleLabel(teamMorale)})`"
        >
          <component
            :is="moraleIcon(teamMorale)"
            :size="16"
            class="team-morale-icon"
            :style="{ color: moraleColor(teamMorale) }"
          />
          <span class="team-morale-pct" :style="{ color: moraleColor(teamMorale) }">{{ teamMorale }}%</span>
        </section>
      </div>

      <!-- Record Card - Cosmic gradient -->
      <section class="record-card card-cosmic" data-tour="home-record-card">
        <div class="record-content">
          <div class="record-left">
            <span class="record-label">Record</span>
            <span class="record-rank">#{{ teamRank }} Conf. Rank</span>
          </div>
          <div class="record-right">
            <span class="record-value">{{ wins }}-{{ losses }}</span>
          </div>
        </div>
        <div class="record-tokens" data-tour="home-tokens">
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
        <Transition name="card-loader-fade">
          <div v-if="syncStore.isPulling" class="card-pull-loader" aria-label="Refreshing">
            <LoadingSpinner size="sm" />
          </div>
        </Transition>
      </section>

      <!-- Last Sim Result Card (shown while background sim is running) -->
      <section v-if="lastSimResult && gameStore.backgroundSimulating" class="next-game-card glass-card-nebula">
        <Transition name="card-loader-fade">
          <div v-if="syncStore.isPulling" class="card-pull-loader" aria-label="Refreshing">
            <LoadingSpinner size="sm" />
          </div>
        </Transition>
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
              <!-- Away team in this matchup → invert background to white -->
              <div
                class="team-badge-game away-team"
                :style="{ '--team-color': lastSimResult.awayTeamColor }"
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
                :style="{ '--team-color': lastSimResult.homeTeamColor }"
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
      <section v-else-if="nextGame" class="next-game-card glass-card-nebula" :class="{ 'in-progress': isGameInProgress, 'is-playoff': nextGame.is_playoff }" data-tour="home-next-game">
        <Transition name="card-loader-fade">
          <div v-if="syncStore.isPulling" class="card-pull-loader" aria-label="Refreshing">
            <LoadingSpinner size="sm" />
          </div>
        </Transition>
        <div class="next-game-header">
          <div class="next-game-label-group">
            <h3 class="next-game-label" :class="{ 'live': isGameInProgress }">
              {{ isGameInProgress ? 'GAME IN PROGRESS' : 'NEXT GAME' }}
            </h3>
            <div class="next-game-meta-row">
              <span v-if="isGameInProgress && inProgressScores" class="live-quarter">Q{{ inProgressScores.quarter }}</span>
              <span v-else class="next-game-date">{{ nextGame?.game_date ? formatGameDate(nextGame.game_date) : '' }}</span>
              <!-- Playoff Info Banner — sits inline with the date for playoff games -->
              <div v-if="nextGame.is_playoff" class="playoff-info-banner">
                <Trophy :size="14" class="playoff-info-icon" />
                <span class="playoff-round-label">{{ playoffStore.getPlayoffRoundLabel(nextGame.playoff_round) }}</span>
                <span v-if="nextGameSeriesInfo" class="playoff-series-record">
                  {{ nextGameSeriesInfo.gameLabel }} &middot; Series {{ nextGameSeriesInfo.userWins }}-{{ nextGameSeriesInfo.opponentWins }}
                </span>
              </div>
            </div>
          </div>
          <span class="next-game-location">{{ nextGameOpponent?.isHome ? 'HOME' : 'AWAY' }}</span>
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
                <div class="matchup-top-players">
                  <div v-for="p in userTopStarters" :key="p.id" class="top-player-card">
                    <div class="top-player-avatar-wrap">
                      <PlayerAvatar :player="p" :size="52" class="top-player-avatar" />
                      <span class="top-player-ovr">{{ p.overall_rating ?? p.overallRating }}</span>
                    </div>
                    <span class="top-player-name">{{ p.last_name ?? p.lastName }}</span>
                  </div>
                </div>
                <div class="team-badge-group">
                  <div
                    class="team-badge-game"
                    :class="{ 'away-team': nextGameOpponent && !nextGameOpponent.isHome }"
                    :style="{ '--team-color': team?.primary_color || '#E85A4F' }"
                  >
                    <span class="badge-abbr">{{ team?.abbreviation }}</span>
                    <!-- nextGameOpponent.isHome is set to whether the USER is home
                         (see nextGameOpponent computed). User score = home if user
                         is home, otherwise away. -->
                    <span v-if="isGameInProgress && inProgressScores" class="badge-score">
                      {{ nextGameOpponent?.isHome ? inProgressScores.homeScore : inProgressScores.awayScore }}
                    </span>
                    <span v-else class="badge-record">{{ wins }}-{{ losses }}</span>
                    <TeamOverallBadge :overall="userTeamOverall" />
                  </div>
                  <div class="team-info">
                    <span v-if="userTeamRating" class="team-rating">{{ userTeamRating }} OVR</span>
                  </div>
                </div>
              </div>
              <div class="matchup-vs">
                <span class="vs-text">{{ isGameInProgress ? '-' : 'VS' }}</span>
              </div>
              <div class="matchup-team opponent-team">
                <div class="team-badge-group">
                  <div
                    class="team-badge-game"
                    :class="{ 'away-team': nextGameOpponent?.isHome }"
                    :style="{ '--team-color': nextGameOpponent?.color || '#666' }"
                  >
                    <span class="badge-abbr">{{ nextGameOpponent?.abbreviation }}</span>
                    <!-- Opponent score = the side opposite the user. -->
                    <span v-if="isGameInProgress && inProgressScores" class="badge-score">
                      {{ nextGameOpponent?.isHome ? inProgressScores.awayScore : inProgressScores.homeScore }}
                    </span>
                    <span v-else class="badge-record">{{ nextGameOpponent?.wins }}-{{ nextGameOpponent?.losses }}</span>
                    <TeamOverallBadge :overall="opponentTeamOverall" />
                  </div>
                  <div class="team-info">
                    <span v-if="nextGameOpponent?.rating" class="team-rating">{{ nextGameOpponent.rating }} OVR</span>
                  </div>
                </div>
                <div class="matchup-top-players">
                  <div v-for="p in opponentTopStarters" :key="p.id" class="top-player-card">
                    <div class="top-player-avatar-wrap">
                      <PlayerAvatar :player="p" :size="52" class="top-player-avatar" />
                      <span class="top-player-ovr">{{ p.overall_rating ?? p.overallRating }}</span>
                    </div>
                    <span class="top-player-name">{{ p.last_name ?? p.lastName }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="next-game-buttons">
              <button
                class="btn-play-game"
                :class="{ 'continue': isGameInProgress }"
                data-tour="home-play-btn"
                @click="navigateToGame(nextGame.id)"
              >
                <Play class="btn-icon" :size="16" />
                {{ isGameInProgress ? 'CONTINUE GAME' : 'PLAY GAME' }}
              </button>
              <button
                v-if="!isGameInProgress"
                class="btn-simulate-game"
                data-tour="home-sim-btn"
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
        <Transition name="card-loader-fade">
          <div v-if="syncStore.isPulling" class="card-pull-loader" aria-label="Refreshing">
            <LoadingSpinner size="sm" />
          </div>
        </Transition>
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
        <Transition name="card-loader-fade">
          <div v-if="syncStore.isPulling" class="card-pull-loader" aria-label="Refreshing">
            <LoadingSpinner size="sm" />
          </div>
        </Transition>
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
            <!-- Champion Banner (with collapsible awards). Stays visible when
                 awards are present even if the champion couldn't be resolved,
                 so the MVP / All-NBA picks always surface. -->
            <div v-if="displayedChampion || displayedSeasonAwards" class="offseason-champion-banner" :class="{ expanded: champBannerExpanded }">
              <button
                type="button"
                class="offseason-champion-header"
                :class="{ clickable: !!displayedSeasonAwards }"
                :disabled="!displayedSeasonAwards"
                @click="champBannerExpanded = !champBannerExpanded"
              >
                <Trophy :size="20" class="offseason-champion-icon" />
                <span class="offseason-champion-text">
                  <template v-if="displayedChampion">
                    {{ displayedChampion.name }} are the champions for the {{ championSeasonLabel }} season
                  </template>
                  <template v-else>
                    {{ championSeasonLabel }} Season Awards
                  </template>
                </span>
                <ChevronDown
                  v-if="displayedSeasonAwards"
                  :size="18"
                  class="offseason-champion-chevron"
                  :class="{ rotated: champBannerExpanded }"
                />
              </button>
              <div v-if="champBannerExpanded && displayedSeasonAwards" class="offseason-champion-awards">
                <div v-if="displayedSeasonAwards.mvp" class="offseason-award-line">
                  <Star :size="14" class="offseason-award-icon gold" />
                  <span class="offseason-award-text">MVP: <strong>{{ displayedSeasonAwards.mvp.playerName }}</strong> ({{ displayedSeasonAwards.mvp.teamAbbr }})</span>
                </div>
                <div v-if="displayedSeasonAwards.dpoy" class="offseason-award-line">
                  <Shield :size="14" class="offseason-award-icon gold" />
                  <span class="offseason-award-text">DPOY: <strong>{{ displayedSeasonAwards.dpoy.playerName }}</strong> ({{ displayedSeasonAwards.dpoy.teamAbbr }})</span>
                </div>
                <div v-if="displayedSeasonAwards.rookieOfTheYear" class="offseason-award-line">
                  <Award :size="14" class="offseason-award-icon gold" />
                  <span class="offseason-award-text">ROTY: <strong>{{ displayedSeasonAwards.rookieOfTheYear.playerName }}</strong> ({{ displayedSeasonAwards.rookieOfTheYear.teamAbbr }})</span>
                </div>
                <div v-if="displayedSeasonAwards.allNba?.first?.length" class="offseason-award-line">
                  <Trophy :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-League 1st: {{ displayedSeasonAwards.allNba.first.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allNba?.second?.length" class="offseason-award-line">
                  <Trophy :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-League 2nd: {{ displayedSeasonAwards.allNba.second.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allNba?.third?.length" class="offseason-award-line">
                  <Trophy :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-League 3rd: {{ displayedSeasonAwards.allNba.third.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allDefense?.first?.length" class="offseason-award-line">
                  <Shield :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-Defense 1st: {{ displayedSeasonAwards.allDefense.first.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allDefense?.second?.length" class="offseason-award-line">
                  <Shield :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-Defense 2nd: {{ displayedSeasonAwards.allDefense.second.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allRookie?.first?.length" class="offseason-award-line">
                  <Award :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-Rookie 1st: {{ displayedSeasonAwards.allRookie.first.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allRookie?.second?.length" class="offseason-award-line">
                  <Award :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-Rookie 2nd: {{ displayedSeasonAwards.allRookie.second.map(p => p.playerName).join(', ') }}</span>
                </div>
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
              <div v-if="previousSeasonFinish" class="offseason-stat offseason-stat-finish">
                <span class="offseason-stat-label">Postseason Finish</span>
                <span class="offseason-stat-value" :class="`finish-${previousSeasonFinish.kind}`">
                  <template v-if="previousSeasonFinish.kind === 'champion'">
                    <Trophy :size="14" class="finish-icon" />
                    Won the Championship
                  </template>
                  <template v-else-if="previousSeasonFinish.kind === 'missed_playoffs'">
                    Missed the Playoffs
                  </template>
                  <template v-else>
                    Lost in the {{ previousSeasonFinish.roundLabel }}<template v-if="previousSeasonFinish.opponentName"> to {{ previousSeasonFinish.opponentName }}</template>
                  </template>
                </span>
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

            <!-- Free Agency status / controls -->
            <div v-if="isFreeAgencyActive" class="offseason-fa-banner">
              <div class="offseason-fa-header">
                <Briefcase :size="18" class="offseason-fa-icon" />
                <span class="offseason-fa-title">FREE AGENCY · DAY {{ freeAgencyDay }} / {{ FREE_AGENCY_DURATION_DAYS }}</span>
              </div>
              <p class="offseason-fa-hint">
                Make offers from the Free Agents tab. Players evaluate every offer at the end of the period.
              </p>
              <div class="offseason-fa-progress">
                <div class="offseason-fa-progress-bar" :style="{ width: (freeAgencyDay / FREE_AGENCY_DURATION_DAYS * 100) + '%' }"></div>
              </div>
            </div>

            <UserFreeAgencyOffers
              v-if="isFreeAgencyActive"
              :campaign-id="campaignId"
              variant="compact"
            />

            <div class="next-game-buttons offseason-buttons">
              <button
                class="btn-simulate-game"
                data-tour="offseason-manage-roster"
                @click="router.push(`/campaign/${campaignId}/team`)"
              >
                <Users class="btn-icon" :size="16" />
                MANAGE ROSTER
              </button>

              <!-- Free Agents shortcut while the window is open -->
              <button
                v-if="isFreeAgencyActive"
                class="btn-simulate-game"
                @click="navigateToFreeAgency"
              >
                <Briefcase class="btn-icon" :size="16" />
                FREE AGENTS
              </button>
              <button
                v-if="isFreeAgencyActive"
                class="btn-simulate-game"
                @click="handleSimFreeAgencyDay"
                :disabled="simmingFAday"
              >
                <FastForward class="btn-icon" :size="16" />
                SIM FA DAY
              </button>
              <button
                v-if="isFreeAgencyActive"
                class="btn-play-game"
                @click="handleSimRestOfFreeAgency"
                :disabled="simmingFAday"
              >
                <FastForward class="btn-icon" :size="16" />
                SIM REST OF FA
              </button>

              <button
                v-if="!rookieDraftCompleted && !isFreeAgencyActive"
                class="btn-simulate-game"
                data-tour="offseason-scouting"
                @click="router.push(`/campaign/${campaignId}/scouting`)"
              >
                <Binoculars class="btn-icon" :size="16" />
                SCOUTING
              </button>
              <button
                v-if="draftLotteryCompleted && !rookieDraftCompleted && !isFreeAgencyActive"
                class="btn-simulate-game"
                @click="showDraftLotteryModal = true"
              >
                <Star class="btn-icon" :size="16" />
                VIEW LOTTERY
              </button>
              <!-- Offseason primary CTA cycles through three states:
                   1. Draft Lottery (must run before FA opens)
                   2. Enter Free Agency (after lottery, before FA)
                   3. Begin Draft (after FA resolves) -->
              <button
                v-if="draftLotteryPending"
                class="btn-play-game"
                data-tour="offseason-draft-lottery"
                @click="handleRunDraftLottery"
                :disabled="runningLottery"
              >
                <Star class="btn-icon" :size="16" />
                {{ runningLottery ? 'RUNNING...' : 'DRAFT LOTTERY' }}
              </button>
              <button
                v-else-if="freeAgencyNotStarted"
                class="btn-play-game"
                data-tour="offseason-enter-fa"
                @click="handleEnterFreeAgency"
                :disabled="enteringFreeAgency"
              >
                <Briefcase class="btn-icon" :size="16" />
                ENTER FREE AGENCY
              </button>
              <button
                v-else-if="!rookieDraftCompleted && !isFreeAgencyActive"
                class="btn-play-game"
                @click="router.push(`/campaign/${campaignId}/draft?mode=rookie`)"
              >
                <Star class="btn-icon" :size="16" />
                BEGIN DRAFT
              </button>
              <button
                v-if="!isFreeAgencyActive"
                class="btn-simulate-game"
                @click="handleSimOffseason"
                :disabled="advancingToNextSeason"
              >
                <FastForward class="btn-icon" :size="16" />
                SIM OFFSEASON
              </button>
              <button
                v-if="rookieDraftCompleted"
                class="btn-play-game"
                @click="handleStartNewSeason"
                :disabled="advancingToNextSeason"
                :title="startSeasonBlocked ? 'Setup is incomplete — click for details' : ''"
              >
                <FastForward class="btn-icon" :size="16" />
                START SEASON
              </button>
            </div>
          </template>
        </div>
      </section>

      <!-- Champion Card (champion declared, enter offseason) -->
      <section v-else-if="playoffStore.champion" class="next-game-card glass-card-nebula offseason-card">
        <Transition name="card-loader-fade">
          <div v-if="syncStore.isPulling" class="card-pull-loader" aria-label="Refreshing">
            <LoadingSpinner size="sm" />
          </div>
        </Transition>
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
            <!-- Champion Banner (with collapsible awards if available) -->
            <div class="offseason-champion-banner" :class="{ expanded: champBannerExpanded }">
              <button
                type="button"
                class="offseason-champion-header"
                :class="{ clickable: !!displayedSeasonAwards }"
                :disabled="!displayedSeasonAwards"
                @click="champBannerExpanded = !champBannerExpanded"
              >
                <Trophy :size="20" class="offseason-champion-icon" />
                <span class="offseason-champion-text">
                  {{ playoffStore.champion.name }} are the champions for the {{ championSeasonLabel }} season
                </span>
                <ChevronDown
                  v-if="displayedSeasonAwards"
                  :size="18"
                  class="offseason-champion-chevron"
                  :class="{ rotated: champBannerExpanded }"
                />
              </button>
              <div v-if="champBannerExpanded && displayedSeasonAwards" class="offseason-champion-awards">
                <div v-if="displayedSeasonAwards.mvp" class="offseason-award-line">
                  <Star :size="14" class="offseason-award-icon gold" />
                  <span class="offseason-award-text">MVP: <strong>{{ displayedSeasonAwards.mvp.playerName }}</strong> ({{ displayedSeasonAwards.mvp.teamAbbr }})</span>
                </div>
                <div v-if="displayedSeasonAwards.dpoy" class="offseason-award-line">
                  <Shield :size="14" class="offseason-award-icon gold" />
                  <span class="offseason-award-text">DPOY: <strong>{{ displayedSeasonAwards.dpoy.playerName }}</strong> ({{ displayedSeasonAwards.dpoy.teamAbbr }})</span>
                </div>
                <div v-if="displayedSeasonAwards.rookieOfTheYear" class="offseason-award-line">
                  <Award :size="14" class="offseason-award-icon gold" />
                  <span class="offseason-award-text">ROTY: <strong>{{ displayedSeasonAwards.rookieOfTheYear.playerName }}</strong> ({{ displayedSeasonAwards.rookieOfTheYear.teamAbbr }})</span>
                </div>
                <div v-if="displayedSeasonAwards.allNba?.first?.length" class="offseason-award-line">
                  <Trophy :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-League 1st: {{ displayedSeasonAwards.allNba.first.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allNba?.second?.length" class="offseason-award-line">
                  <Trophy :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-League 2nd: {{ displayedSeasonAwards.allNba.second.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allNba?.third?.length" class="offseason-award-line">
                  <Trophy :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-League 3rd: {{ displayedSeasonAwards.allNba.third.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allDefense?.first?.length" class="offseason-award-line">
                  <Shield :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-Defense 1st: {{ displayedSeasonAwards.allDefense.first.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allDefense?.second?.length" class="offseason-award-line">
                  <Shield :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-Defense 2nd: {{ displayedSeasonAwards.allDefense.second.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allRookie?.first?.length" class="offseason-award-line">
                  <Award :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-Rookie 1st: {{ displayedSeasonAwards.allRookie.first.map(p => p.playerName).join(', ') }}</span>
                </div>
                <div v-if="displayedSeasonAwards.allRookie?.second?.length" class="offseason-award-line">
                  <Award :size="14" class="offseason-award-icon" />
                  <span class="offseason-award-text">All-Rookie 2nd: {{ displayedSeasonAwards.allRookie.second.map(p => p.playerName).join(', ') }}</span>
                </div>
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
        <Transition name="card-loader-fade">
          <div v-if="syncStore.isPulling" class="card-pull-loader" aria-label="Refreshing">
            <LoadingSpinner size="sm" />
          </div>
        </Transition>
        <div class="next-game-header">
          <h3 class="next-game-label">REGULAR SEASON COMPLETE</h3>
        </div>
        <div class="next-game-content">
          <div v-if="gameStore.simulating" class="next-game-loading">
            <LoadingSpinner size="md" />
            <span class="next-game-loading-text">Simulating...</span>
          </div>
          <!-- Regular season fully done, bracket not yet generated — user dismissed
               the SeasonEndModal and is now stuck. Surface a direct path back. -->
          <template v-else-if="playoffStore.regularSeasonComplete && !playoffStore.bracketGenerated">
            <p class="season-wrap-text">
              The regular season is over. Continue to the playoffs to generate the bracket and start the postseason.
            </p>
            <div class="next-game-buttons">
              <button class="btn-play-game" @click="handleContinueToPlayoffs">
                <Trophy class="btn-icon" :size="16" />
                CONTINUE TO PLAYOFFS
              </button>
            </div>
          </template>
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
        <!-- Masks the wrap-up content while the schedule is still being
             fetched; otherwise this fallback flashes for the warm-load
             window before nextGame / isOffseason / playoff state populate. -->
        <Transition name="next-game-box-overlay-fade">
          <div v-if="nextGameBoxLoading" class="next-game-box-overlay" aria-label="Loading">
            <LoadingSpinner size="md" />
          </div>
        </Transition>
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
      <section class="quick-actions-card glass-card-nebula" data-tour="home-quick-actions">
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
          <button v-if="playoffStore.isInPlayoffs && campaign?.phase === 'playoffs'" class="action-box playoffs" @click="router.push(`/campaign/${campaignId}/playoffs`)">
            <div class="action-icon">
              <Trophy :size="24" />
            </div>
            <span class="action-label">Bracket</span>
          </button>
          <!-- Offseason: the regular season is over, so surface the playoff
               bracket here instead of standings. -->
          <button v-else-if="isOffseason" class="action-box playoffs" @click="router.push(`/campaign/${campaignId}/playoffs`)">
            <div class="action-icon">
              <Trophy :size="24" />
            </div>
            <span class="action-label">Playoffs</span>
          </button>
          <button v-else class="action-box" @click="router.push(`/campaign/${campaignId}/league`)">
            <div class="action-icon">
              <TrendingUp :size="24" />
            </div>
            <span class="action-label">Standings</span>
          </button>
          <!-- Free Agency replaces Schedule during the offseason FA window;
               Playoffs replaces it once the bracket is live; otherwise the
               default regular-season Schedule link shows. -->
          <button
            v-if="isFreeAgencyActive"
            class="action-box"
            @click="navigateToFreeAgency"
          >
            <div class="action-icon">
              <Briefcase :size="24" />
            </div>
            <span class="action-label">Free Agency</span>
          </button>
          <button
            v-else-if="playoffStore.isInPlayoffs && !playoffStore.champion"
            class="action-box"
            @click="router.push(`/campaign/${campaignId}/playoffs`)"
          >
            <div class="action-icon">
              <Trophy :size="24" />
            </div>
            <span class="action-label">Playoffs</span>
          </button>
          <button v-else class="action-box" @click="router.push(`/campaign/${campaignId}/team#schedule`)">
            <div class="action-icon">
              <Calendar :size="24" />
            </div>
            <span class="action-label">Schedule</span>
          </button>
        </div>
      </section>

      <!-- Featured Player Card - Cosmic gradient -->
      <!-- Bi-weekly Featured Player. Selection refreshed every 14 days by
           `_refreshFeaturedPlayerIfStale` in stores/game.js. PPG/RPG/APG are
           the 14-day window averages (NOT season averages). The strip on
           the right (mobile: below) shows the games that fed the selection. -->
      <section v-if="featuredPlayer" class="featured-player-card card-cosmic" data-tour="home-featured-player" @click="openPlayerDetails">
        <h3 class="section-header featured-header">FEATURED PLAYER</h3>
        <div class="player-content">
          <div class="player-avatar">
            <PlayerAvatar :player="featuredPlayer" :size="86" class="avatar-icon" />
          </div>
          <div class="player-info">
            <h4 class="player-name">{{ featuredPlayer.name }}</h4>
            <p class="player-position">{{ featuredPlayer.position }}</p>
          </div>
          <div class="player-rating">
            <span class="rating-badge">{{ featuredPlayer.overall_rating ?? featuredPlayer.overallRating ?? '—' }}</span>
          </div>
        </div>
        <!-- Unified Last-2-Weeks panel: 14-day per-game averages stacked
             above the game log that fed them. Single container, full card
             width, with a clear label so users know these aren't season
             averages. -->
        <div class="featured-window-panel">
          <div class="featured-window-header">
            <span class="window-label">Last 2 Weeks · Per-Game Averages</span>
            <span v-if="featuredPlayerStats.gamesPlayed" class="window-meta">{{ featuredPlayerStats.gamesPlayed }} GP</span>
          </div>
          <div class="player-stats">
            <div class="stat-item">
              <span class="stat-value">{{ featuredPlayerStats.ppg }}</span>
              <span class="stat-label">PPG</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ featuredPlayerStats.rpg }}</span>
              <span class="stat-label">RPG</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ featuredPlayerStats.apg }}</span>
              <span class="stat-label">APG</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ featuredPlayerStats.spg }}</span>
              <span class="stat-label">SPG</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ featuredPlayerStats.bpg }}</span>
              <span class="stat-label">BPG</span>
            </div>
          </div>

          <div v-if="featuredRecentGames.length" class="featured-recent-games">
            <div class="recent-games-label">Recent Games</div>
            <table class="recent-games-table">
              <thead>
                <tr>
                  <th>Date</th><th>OPP</th><th></th>
                  <th>PTS</th><th>REB</th><th>AST</th><th>MIN</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(game, i) in featuredRecentGames" :key="i">
                  <td class="rg-date">{{ formatFeaturedGameDate(game.date) }}</td>
                  <td class="rg-opp">{{ game.opponent || '—' }}</td>
                  <td :class="game.won ? 'rg-win' : 'rg-loss'">{{ game.won ? 'W' : 'L' }}</td>
                  <td class="rg-pts">{{ game.pts }}</td>
                  <td>{{ game.reb }}</td>
                  <td>{{ game.ast }}</td>
                  <td>{{ game.min }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Upcoming Free Agents — roster players whose contracts expire
           this offseason. At-a-glance teaser that deep-links to the full
           FinancesTab → Expiring sub-tab for actual re-sign work. Hidden
           if there's no team to read a roster off; rendered with an empty
           state when everyone's locked in. -->
      <section v-if="showUpcomingFreeAgents" class="upcoming-fa-card glass-card-nebula" data-tour="home-upcoming-fa">
        <div class="upcoming-fa-header">
          <h3 class="section-header upcoming-fa-title">
            <Clock :size="13" class="upcoming-fa-icon" />
            EXPIRING CONTRACTS
            <span v-if="upcomingFreeAgents.length > 0" class="upcoming-fa-count">{{ upcomingFreeAgents.length }}</span>
          </h3>
          <router-link
            v-if="upcomingFreeAgents.length > 0"
            :to="`/campaign/${campaignId}/team?tab=finances&sub=expiring`"
            class="upcoming-fa-view-all"
          >
            View all →
          </router-link>
        </div>
        <div v-if="upcomingFreeAgents.length === 0" class="upcoming-fa-empty">
          All contracts locked in for next season.
        </div>
        <div v-else class="upcoming-fa-list">
          <button
            v-for="p in upcomingFreeAgentsPreview"
            :key="p.id"
            type="button"
            class="fa-row"
            @click="openPlayerInModal(p)"
          >
            <span class="fa-avatar">
              <PlayerAvatar :player="p" :size="40" :campaign-id="campaignId" />
              <span class="fa-avatar-position">{{ p.position }}</span>
            </span>
            <span class="fa-name">{{ p.name || `${p.firstName ?? p.first_name ?? ''} ${p.lastName ?? p.last_name ?? ''}`.trim() }}</span>
            <span class="fa-ovr" :title="`Overall rating: ${p.overallRating ?? p.overall_rating ?? '—'}`">
              <span class="fa-ovr-label">OVR</span>
              <span class="fa-ovr-value">{{ p.overallRating ?? p.overall_rating ?? '—' }}</span>
            </span>
            <span class="fa-salary">{{ formatSalaryShort(p.contractSalary ?? p.contract_salary) }}</span>
            <span
              v-if="resignLikelihood(p) !== null"
              class="fa-meter"
              :title="`Re-sign likelihood: ${resignLikelihood(p)}%`"
            >
              <span class="fa-meter-label">Re-sign</span>
              <span class="fa-meter-track">
                <span
                  class="fa-meter-fill"
                  :style="{ width: resignLikelihood(p) + '%', background: resignColor(resignLikelihood(p)) }"
                />
              </span>
              <span class="fa-meter-pct" :style="{ color: resignColor(resignLikelihood(p)) }">{{ resignLikelihood(p) }}%</span>
            </span>
          </button>
        </div>
      </section>

      <!-- News Feed Card -->
      <section class="news-card" data-tour="home-news">
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

    <!-- Load-error fallback: without this, a swallowed load failure rendered a
         completely BLANK page (loading=false + campaign=null had no branch). -->
    <div v-else class="load-error-container">
      <h2 class="load-error-title">Couldn't load this campaign</h2>
      <p class="load-error-text">
        Something went wrong while loading your campaign data. This is usually
        temporary — try again, and if it keeps happening, fully close and reopen
        the app.
      </p>
      <BaseButton variant="primary" @click="retryLoad">Try Again</BaseButton>
    </div>

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
    <StandardModal
      :show="showRosterWarningModal"
      title="Lineup Issue"
      size="sm"
      @close="showRosterWarningModal = false"
    >
      <div class="lineup-warning-content">
        <div class="warning-icon">
          <AlertTriangle :size="48" />
        </div>
        <p class="warning-message">{{ rosterWarningMessage }}</p>
        <p class="warning-hint">{{ rosterWarningHint }}</p>
      </div>
      <template #footer>
        <div class="lineup-warning-footer">
          <div class="lineup-warning-btn-row">
            <button class="warning-btn-cancel" @click="showRosterWarningModal = false">Cancel</button>
            <button class="warning-btn-cpu" @click="handleCpuSetLineup">
              <Cpu :size="16" />
              CPU Adjust
            </button>
          </div>
          <button class="warning-btn-confirm" @click="goToTeamTabFromWarning">
            <Users :size="16" />
            View Lineup
          </button>
        </div>
      </template>
    </StandardModal>

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
      :simulating="seriesResultSimulating"
      @close="handleSeriesResultClose"
      @sim-next-series="handleSeriesResultSimNext"
      @sim-remaining-playoffs="handleSeriesResultSimNext"
    />

    <!-- Championship Modal -->
    <ChampionshipModal
      :show="playoffStore.showChampionshipModal"
      :series-result="playoffStore.seriesResult"
      :year="campaign?.current_season?.year"
      :user-team-id="team?.id"
      @close="handleChampionshipClose"
    />

    <!-- Season Awards Modal — fires once per season after entering offseason -->
    <SeasonAwardsModal
      :show="showSeasonAwardsModal"
      :awards="seasonAwardsForModal"
      :year="seasonAwardsYear"
      :user-team-abbr="team?.abbreviation"
      @close="handleCloseSeasonAwardsModal"
    />

    <!-- Retirement Modal — fires after the awards modal closes, before FA opens -->
    <RetirementModal
      :show="showRetirementModal"
      :retirees="retireesForModal"
      :season="pendingRetirementsYear"
      @close="handleCloseRetirementModal"
    />

    <!-- GM contract-end decision (Part 2): extend (re-sign) or pick a new team -->
    <ContractDecisionModal
      :show="showContractDecisionModal"
      :decision="contractDecisionData"
      :teams="campaignStore.availableTeams"
      :gm-level="authStore.gmLevel"
      :busy="contractDecisionBusy"
      @extend="handleExtendContract"
      @switch="handleSwitchTeam"
    />

    <!-- Coach re-sign prompt (expiring head coach at the new season) -->
    <CoachResignModal
      :show="showCoachResignModal"
      :decision="coachDecisionData"
      :campaign-id="campaignId"
      :busy="coachResignBusy"
      @resigned="handleCoachResigned"
      @hire-new="handleCoachHireNew"
      @close="handleCloseCoachResign"
    />

    <!-- Hire-coach browser (opened from the re-sign prompt's "Sign a New Coach") -->
    <HireCoachModal
      :show="showHireCoachModal"
      :campaign-id="campaignId"
      @hired="handleCoachHired"
      @close="showHireCoachModal = false"
    />

    <!-- Trade Proposal Modal -->
    <TradeProposalModal
      :show="showTradeProposalModal"
      :proposal="currentProposal"
      :busy="proposalActionBusy"
      @close="handleCloseProposalModal"
      @accept="handleAcceptProposal"
      @reject="handleRejectProposal"
      @negotiate="handleNegotiateProposal"
    />

    <!-- All-Star Modal -->
    <AllStarModal
      :show="showAllStarModal"
      :rosters="allStarRosters"
      :user-team-id="team?.id"
      @close="handleCloseAllStarModal"
    />

    <!-- New Season Modal -->
    <NewSeasonModal
      :show="showNewSeasonModal"
      :season-year="newSeasonData?.seasonYear"
      :facilities-before="newSeasonData?.facilitiesBefore"
      :facilities-after="newSeasonData?.facilitiesAfter"
      @close="handleCloseNewSeasonModal"
    />

    <!-- Owner Welcome (the moment a new GM job is accepted) -->
    <OwnerWelcomeModal
      :show="showOwnerWelcomeModal"
      :owner="ownerWelcomeData?.owner"
      :season-year="ownerWelcomeData?.seasonYear"
      :expectation="ownerWelcomeData?.expectation"
      :lines="ownerWelcomeData?.lines || []"
      @close="handleCloseOwnerWelcome"
    />

    <!-- Owner Check-In (start of each season / after campaign creation) -->
    <OwnerCheckInModal
      :show="showOwnerCheckInModal"
      :owner="ownerCheckInData?.owner"
      :check-in="ownerCheckInData"
      :season-year="ownerCheckInData?.seasonYear"
      @close="handleCloseOwnerCheckIn"
    />

    <!-- Draft Lottery results (pops immediately after the lottery runs) -->
    <DraftLotteryModal
      :show="showDraftLotteryModal"
      :teams="campaign?.allTeams || []"
      :standings="campaign?.standings || { east: [], west: [] }"
      :lottery-result="campaign?.settings?.draftLottery || null"
      :pick-year="campaign?.gameYear ?? null"
      @close="handleCloseDraftLotteryModal"
    />

    <!-- Start-of-season prerequisites gate -->
    <StartSeasonBlockerModal
      :show="showStartSeasonBlockerModal"
      :roster-count="rosterCount"
      :roster-minimum="START_SEASON_ROSTER_MIN"
      :has-coach="!!teamStore.coach"
      :simming="simmingStartSetup"
      @close="showStartSeasonBlockerModal = false"
      @sim="handleAiFinishStartSetup"
    />

    <!-- Free Agency Wrap-Up Modal -->
    <EndOfFreeAgencyModal
      :show="showEndOfFreeAgencyModal"
      :results="endOfFreeAgencyResults"
      :finalizing="finalizingChoices"
      @close="closeEndOfFreeAgencyModal"
      @confirm-choices="handleConfirmFreeAgencyChoices"
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
                      <span class="inj-duration">{{ injury.days_out ?? injury.games_out ?? 0 }} {{ (injury.days_out ?? injury.games_out ?? 0) === 1 ? 'day' : 'days' }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <p class="inj-hint">Injured starters will be automatically benched. Update your lineup to set replacements.</p>
            </main>

            <!-- Footer — Dismiss removed; the X in the header and the
                 backdrop click both close the modal. Action buttons stay. -->
            <footer class="inj-footer">
              <button class="inj-btn-cpu" @click="handleCpuSetLineup">
                <Zap :size="16" />
                CPU Set Lineup
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
              <!-- Dismiss removed; X close + backdrop click both still
                   exit the modal. -->
              <button class="inj-btn-cpu" @click="handleCpuSetLineup">
                <Zap :size="16" />
                CPU Set Lineup
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

    <!-- Featured Player Detail Modal — opened from the Featured Player card -->
    <PlayerDetailModal
      :show="showFeaturedPlayerModal"
      :player="modalPlayer"
      :show-growth="true"
      :recent-evolution="modalRecentEvolution"
      :all-time-evolution="modalAllTimeEvolution"
      :player-news="modalPlayerNews"
      :show-history="true"
      :can-upgrade="true"
      :is-user-player="true"
      :campaign-id="campaignId"
      :current-season-year="campaign?.currentSeasonYear"
      :lineup-players="teamStore.starterPlayers?.filter(p => p != null) || []"
      :user-tokens="authStore.profile?.tokens ?? 0"
      :coach="teamStore.coach"
      @close="closeFeaturedPlayerModal"
      @upgrade-attribute="handleModalUpgradeAttribute"
      @purchase-upgrade-point="handleModalPurchaseUpgradePoint"
      @hold-coach-meeting="handleModalHoldCoachMeeting"
    />
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

/* Load-error fallback (replaces the previous blank page on load failure). */
.load-error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  gap: 12px;
  padding: 24px;
  text-align: center;
}
.load-error-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
.load-error-text {
  max-width: 420px;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
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

/* Team header styles live in common/TeamHeader.vue */

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
  position: relative;
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
  z-index: 1;
}

.player-avatar {
  width: 88px;
  height: 88px;
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
  position: absolute;
  top: 16px;
  right: 16px;
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

/* Unified Last-2-Weeks panel — single full-width container that stacks the
   per-game averages above the recent games table. Replaces the old
   side-by-side `.featured-body` layout. */
.featured-window-panel {
  position: relative;
  z-index: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(26, 21, 32, 0.18);
  border: 1px solid rgba(26, 21, 32, 0.22);
  border-radius: var(--radius-lg);
}

.featured-window-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.window-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(26, 21, 32, 0.78);
}

.window-meta {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgba(26, 21, 32, 0.55);
  font-variant-numeric: tabular-nums;
}

.player-stats {
  display: flex;
  gap: 24px;
  flex-shrink: 0;
  /* 5 tiles fit comfortably on desktop; wrap on narrow viewports so they
     don't squeeze the labels. */
  flex-wrap: wrap;
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

/* Recent-performances strip lives inside `.featured-window-panel`, directly
   below the averages. Full panel width; horizontal scroll on narrow screens
   if the table overflows. */
.featured-recent-games {
  width: 100%;
  min-width: 0;
  border-top: 1px solid rgba(26, 21, 32, 0.18);
  padding-top: 8px;
  overflow-x: auto;
}

.recent-games-label {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(26, 21, 32, 0.7);
  margin-bottom: 4px;
}

.recent-games-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.72rem;
  color: #1a1520;
}

.recent-games-table th {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(26, 21, 32, 0.6);
  text-align: right;
  padding: 2px 4px;
  border-bottom: 1px solid rgba(26, 21, 32, 0.15);
}

.recent-games-table th:nth-child(-n+2) {
  text-align: left;
}

.recent-games-table td {
  padding: 3px 4px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.recent-games-table td:nth-child(-n+2) {
  text-align: left;
}

.recent-games-table .rg-date {
  font-weight: 500;
  white-space: nowrap;
}

.recent-games-table .rg-opp {
  font-weight: 700;
}

.recent-games-table .rg-pts {
  font-weight: 700;
}

.recent-games-table .rg-win {
  color: #166534;
  font-weight: 700;
}

.recent-games-table .rg-loss {
  color: #991b1b;
  font-weight: 700;
}

@media (max-width: 640px) {
  /* Tighter padding + smaller stat values on mobile so the panel still fits
     comfortably below the player header. */
  .featured-window-panel {
    padding: 10px 12px;
    gap: 8px;
  }
  .player-stats {
    gap: 16px;
  }
  .stat-value {
    font-size: 1.25rem;
  }
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
  position: relative;
}

/* Facilities Card (sits between record-card and next-game-card) */
/* Facilities strip — single tight row of 4 inline tiles. Target height
   is roughly half the record-card so it reads as an accent line rather
   than a section of its own. Rendered as a router-link to the Personnel
   tab, so reset the anchor defaults and add a hover affordance. */
.facilities-card {
  display: block;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 6px 12px;
  margin-bottom: 16px;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.facilities-card:hover,
.facilities-card:focus-visible {
  background: var(--color-bg-hover, rgba(255, 255, 255, 0.05));
  border-color: var(--color-primary);
}

.facilities-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.facility-tile {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  min-width: 0;
  color: var(--color-text-primary);
}

.facility-icon {
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.facility-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.facility-rating {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.facility-value {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.facility-star {
  color: #fbbf24;
  fill: #fbbf24;
}

/* Status row — pairs the facilities strip and the morale chip on one
   line. Facilities takes ~90% via flex:9; morale takes ~10% via flex:1.
   Each child still carries its own .glass-card-nebula chrome so a
   single-side state (no morale or no facilities) doesn't collapse to a
   bare bar — the visible card stretches to fill the row instead. */
.home-status-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-bottom: 16px;
}

.home-status-row > .facilities-card {
  flex: 85 1 0;
  margin-bottom: 0;
}

.home-status-row > .team-morale-card {
  flex: 15 1 0;
  margin-bottom: 0;
}

/* Team Morale chip — face icon + numeric percent only. Thresholds /
   colors match `PlayerDetailModal.vue:585-598`. */
.team-morale-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 6px 10px;
}

.team-morale-icon {
  flex-shrink: 0;
}

.team-morale-pct {
  font-size: 0.85rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/* Upcoming Free Agents Card (sits under featured-player-card) */
.upcoming-fa-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 14px 16px;
  margin-bottom: 16px;
}

.upcoming-fa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.upcoming-fa-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.upcoming-fa-icon {
  color: var(--color-text-secondary);
}

.upcoming-fa-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  margin-left: 4px;
  border-radius: 999px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
}

.upcoming-fa-view-all {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-primary);
  text-decoration: none;
}

.upcoming-fa-view-all:hover {
  text-decoration: underline;
}

.upcoming-fa-empty {
  padding: 8px 4px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  font-style: italic;
}

.upcoming-fa-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fa-row {
  display: grid;
  grid-template-columns: 44px 1fr auto auto;
  grid-template-areas:
    "avatar name  ovr    salary"
    "avatar meter meter  meter";
  align-items: center;
  column-gap: 10px;
  row-gap: 4px;
  padding: 8px 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  color: var(--color-text-primary);
  font: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.fa-row > .fa-avatar { grid-area: avatar; }
.fa-row > .fa-name   { grid-area: name; }
.fa-row > .fa-ovr    { grid-area: ovr; }
.fa-row > .fa-salary { grid-area: salary; }
.fa-row > .fa-meter  { grid-area: meter; }

.fa-row:hover {
  background: var(--color-bg-hover, rgba(255, 255, 255, 0.06));
  border-color: var(--color-primary);
}

/* Avatar wrapper hosts the round headshot and the absolutely-positioned
   position badge that overlays the bottom-left corner. */
.fa-avatar {
  position: relative;
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.fa-avatar :deep(.player-headshot) {
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--color-bg-tertiary);
}

.fa-avatar-position {
  position: absolute;
  left: -8px;
  bottom: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 16px;
  padding: 0 5px;
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1;
  pointer-events: none;
}

.fa-name {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* Overall-rating badge — cosmic-gradient pill mirrors the `.top-player-ovr`
   treatment used elsewhere on this page, so the user immediately reads it
   as a player rating rather than a generic colored number. The tiny "OVR"
   label inside removes any ambiguity. */
.fa-ovr {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--gradient-cosmic);
  color: #1a1520;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.fa-ovr-label {
  font-size: 0.55rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.7;
}

.fa-ovr-value {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.fa-salary {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  min-width: 50px;
  text-align: right;
}

/* Re-sign likelihood meter — thin horizontal bar that sits beneath the
   row's primary cells (spans the meter grid area). Color thresholds and
   scoring match `getRetentionColor` / `calculateRetentionScore` in
   PlayerDetailModal so the visual language stays consistent. */
.fa-meter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.fa-meter-label {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.fa-meter-track {
  position: relative;
  flex: 1;
  height: 5px;
  border-radius: 999px;
  background: var(--glass-border);
  overflow: hidden;
}

.fa-meter-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease, background 0.2s ease;
}

.fa-meter-pct {
  font-size: 0.65rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 30px;
  text-align: right;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  /* Hide the verbose label on phones so all four tiles fit one line.
     Icon + N★ is enough; the title attr still provides the full label
     on long-press. */
  .facility-label {
    display: none;
  }
  .fa-row {
    grid-template-columns: 44px 1fr auto;
    grid-template-areas:
      "avatar name   ovr"
      "avatar salary salary"
      "avatar meter  meter";
    align-items: center;
    row-gap: 2px;
  }
  .fa-avatar { align-self: center; }
  .fa-salary { text-align: left; }
}

/* Pull-in-progress loader badge — shown on .record-card and .next-game-card
   while syncStore.isPulling is true. Sits in the top-right corner without
   covering the card content. */
.card-pull-loader {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 2;
  pointer-events: none;
}

/* Full-cover overlay used to mask the wrap-up fallback while the schedule
   is still being fetched. Inherits the parent .next-game-card's border
   radius and sits above all card content (including .card-pull-loader). */
.next-game-box-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: inherit;
  z-index: 3;
}

.next-game-box-overlay-fade-enter-active,
.next-game-box-overlay-fade-leave-active {
  transition: opacity 0.2s ease;
}

.next-game-box-overlay-fade-enter-from,
.next-game-box-overlay-fade-leave-to {
  opacity: 0;
}

.card-loader-fade-enter-active,
.card-loader-fade-leave-active {
  transition: opacity 0.18s ease;
}

.card-loader-fade-enter-from,
.card-loader-fade-leave-to {
  opacity: 0;
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
  gap: 4px;
}

/* Row that holds the date (or live-quarter) and, on playoff games, the
   playoff-info-banner inline. Wraps if the card is narrow. */
.next-game-meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
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

/* Mobile: inline the "NEXT GAME" label with the date so the header reads
   "NEXT GAME: Tue, Oct 21" on one line instead of stacking. The label-group
   flips from column to row and a colon is appended after the label via
   ::after. The playoff-info-banner stays inside .next-game-meta-row and
   wraps naturally if the row overflows. */
@media (max-width: 640px) {
  .next-game-label-group {
    flex-direction: row;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }
  .next-game-label::after {
    content: ':';
  }
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
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: rgba(255, 215, 0, 0.08);
  border: 1px solid rgba(255, 215, 0, 0.2);
  border-radius: var(--radius-md);
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

.offseason-fa-banner {
  padding: 12px 14px;
  background: rgba(168, 85, 247, 0.10);
  border: 1px solid rgba(168, 85, 247, 0.28);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.offseason-fa-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.offseason-fa-icon {
  color: #c084fc;
  flex-shrink: 0;
}

.offseason-fa-title {
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-text-primary);
}

.offseason-fa-hint {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  margin: 0;
}

.offseason-fa-progress {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.offseason-fa-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #a855f7, #ec4899);
  border-radius: 2px;
  transition: width 0.3s ease;
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
  flex-direction: column;
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.12), rgba(255, 140, 0, 0.08));
  border: 1px solid rgba(255, 215, 0, 0.25);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.offseason-champion-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: default;
  -webkit-tap-highlight-color: transparent;
}

.offseason-champion-header.clickable {
  cursor: pointer;
}

.offseason-champion-header.clickable:hover {
  background: rgba(255, 215, 0, 0.06);
}

.offseason-champion-icon {
  color: #ffd700;
  flex-shrink: 0;
}

.offseason-champion-text {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text-primary);
  flex: 1;
}

.offseason-champion-chevron {
  color: var(--color-text-secondary);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.offseason-champion-chevron.rotated {
  transform: rotate(180deg);
}

.offseason-champion-awards {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 16px 12px;
  border-top: 1px solid rgba(255, 215, 0, 0.2);
}

.offseason-summary {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.offseason-stat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: var(--radius-md);
}

/* Finish line gets its own full-width row so the (sometimes long) "Lost in
   the Conference Finals to Boston Celtics" text doesn't crush the other two
   summary stats. */
.offseason-stat-finish {
  flex-basis: 100%;
  align-items: center;
  text-align: center;
}

.offseason-stat-finish .offseason-stat-value {
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.offseason-stat-finish .offseason-stat-value.finish-champion {
  color: #ffd700;
}

.offseason-stat-finish .offseason-stat-value.finish-missed_playoffs {
  color: #f87171;
}

.offseason-stat-finish .finish-icon {
  color: #ffd700;
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
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.matchup-team.user-team {
  flex-direction: row;
}

.matchup-team.opponent-team {
  flex-direction: row;
}

.matchup-top-players {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.top-player-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.top-player-avatar-wrap {
  position: relative;
}

.top-player-avatar {
  border-radius: 50%;
}

.top-player-avatar-wrap :deep(img) {
  width: 52px !important;
  height: 52px !important;
  border-radius: 50%;
  object-fit: cover;
}

.top-player-avatar-wrap :deep(svg) {
  width: 52px !important;
  height: 52px !important;
}

.top-player-ovr {
  position: absolute;
  bottom: -4px;
  right: -4px;
  min-width: 20px;
  height: 16px;
  padding: 0 3px;
  border-radius: 8px;
  background: var(--gradient-cosmic);
  color: #1a1520;
  font-size: 0.55rem;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

.top-player-name {
  font-size: 0.6rem;
  color: var(--color-text-secondary);
  font-weight: 600;
  max-width: 58px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.team-badge-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.team-badge-game {
  position: relative;
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
  background: var(--team-color, #6B7280);
  overflow: visible;
}

/* AWAY TEAM TREATMENT: invert so away/home logos read clearly even when
   their primary colors are similar. */
.team-badge-game.away-team {
  background: #FFFFFF;
  color: var(--team-color, #1a1520);
  border-color: var(--team-color, #6B7280);
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
  /* Reset the global .btn-icon padding (8px) — it's intended for icon-only
     buttons but cascades into the lucide SVG inside, collapsing the 16x16
     content box to 0 and rendering an empty element. */
  padding: 0;
  width: 16px;
  height: 16px;
  stroke-width: 2.5;
  fill: currentColor;
}

.start-season-coach-hint {
  margin: 8px 0 0 0;
  font-size: 0.75rem;
  color: #F59E0B;
  text-align: center;
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
  /* See note on .btn-play-game .btn-icon — same global-padding fix. */
  padding: 0;
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
  padding: 0;
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
  padding: 0;
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
  padding: 8px 0 8px;
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
  margin: 0;
}

.warning-btn-cancel,
.warning-btn-cpu,
.warning-btn-confirm {
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

.warning-btn-cancel {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.warning-btn-cancel:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

.warning-btn-cpu {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
}

.warning-btn-cpu:hover {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.warning-btn-confirm {
  background: var(--color-primary);
  border: none;
  color: white;
}

.warning-btn-confirm:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

/* Stack the footer: Cancel + CPU Adjust on one row, View Lineup full-width below. */
.lineup-warning-footer {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lineup-warning-btn-row {
  display: flex;
  gap: 12px;
}
.lineup-warning-footer .warning-btn-confirm {
  flex: 0 0 auto;
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

  /* Team header desktop sizing lives in common/TeamHeader.vue */

  .date-day {
    font-size: 2.5rem;
  }

  .date-month {
    font-size: 0.85rem;
  }

  .date-weekday {
    font-size: 0.75rem;
  }

  /* Desktop badges keep the mobile-style proportions (larger circle, smaller
     text) per user request — only the circle gets a slight bump over mobile.
     Text sizes intentionally inherit the base/mobile values (badge-abbr 1.3rem,
     badge-record 0.85rem, team-abbr 0.9rem) so we don't restate them here. */
  .team-badge-game {
    width: 140px;
    height: 140px;
  }

  .next-game-matchup {
    gap: 40px;
  }

  .vs-text {
    font-size: 2rem;
  }

  .next-game-date {
    font-size: 1.1rem;
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
    /* Sit directly above the BottomNav. The nav's height is 70px content +
       var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) on iPhone (~34px home-indicator), so
       hardcoding 70px here would tuck the ticker behind the nav on iOS. */
    bottom: calc(70px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)));
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

@media (max-width: 765px) {
  .matchup-team.user-team,
  .matchup-team.opponent-team {
    flex-direction: column;
  }

  .matchup-team.user-team .matchup-top-players {
    order: 2;
  }

  .matchup-team.user-team .team-badge-group {
    order: 1;
  }

  .top-player-avatar-wrap :deep(img),
  .top-player-avatar-wrap :deep(svg) {
    width: 40px !important;
    height: 40px !important;
  }

  .top-player-name {
    font-size: 0.55rem;
    max-width: 40px;
  }
}

</style>
