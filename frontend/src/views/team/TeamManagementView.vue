<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTeamStore } from '@/stores/team'
import { useCampaignStore } from '@/stores/campaign'
import { badgeDisplayName } from '@/engine/data/badges'
import { useAuthStore } from '@/stores/auth'
import { useTradeStore } from '@/stores/trade'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { usePositionValidation } from '@/composables/usePositionValidation'
import { useBadgeSynergies } from '@/composables/useBadgeSynergies'
import { GlassCard, BaseButton, LoadingSpinner, StatBadge, BaseModal } from '@/components/ui'
import { User, Users, ArrowUpDown, AlertTriangle, Calendar, Eye, Star, Zap, Smile, Meh, Frown, ChevronsUp, Coins, Dumbbell, MessagesSquare } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import CoachAvatar from '@/components/common/CoachAvatar.vue'
import TeamHeader from '@/components/common/TeamHeader.vue'
import { computeTeamOverall } from '@/utils/teamOverall'
import { fitTierLabel } from '@/utils/fitTiers'
import { t } from '@wl-i18n/i18n.js'
import { generateRoleAwareTargetMinutes } from '@/engine/simulation/SubstitutionEngine'
import TradesTab from '@/components/trade/TradesTab.vue'
import FinancesTab from '@/components/team/FinancesTab.vue'
import FacilitiesTab from '@/components/team/FacilitiesTab.vue'
import OwnerTab from '@/components/team/OwnerTab.vue'
import ScheduleTab from '@/components/team/ScheduleTab.vue'
import PlayerDetailModal from '@/components/team/PlayerDetailModal.vue'
import HireCoachModal from '@/components/team/HireCoachModal.vue'
import CoachBadgeStoreModal from '@/components/coach/CoachBadgeStoreModal.vue'
import { coachBadges as COACH_BADGE_DEFS } from '@/engine/data/coachBadges'
import { getCoachResignCost, getCoachActionBudget, getCoachTrainBudget, COACH_MEETING_EXTRA_COST } from '@/engine/data/coaches'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { useSyncStore } from '@/stores/sync'
import { isPastTradeDeadline } from '@/engine/season/SeasonDeadlines'
import { useWalkthroughStore } from '@/stores/walkthrough'
import WalkthroughReplayButton from '@/components/walkthrough/WalkthroughReplayButton.vue'
import { useWalkthroughTab } from '@/composables/useWalkthroughTab'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { getSchemePlaybook } from '@/engine/simulation/PlayService'
// Lazy-loaded: the play-animation preview (its CourtDiagram + graph helper) is
// code-split into its own chunk that only downloads the first time a user opens
// a scheme's "View plays" — it stays out of the Team Management view bundle.
const PlayAnimationPreview = defineAsyncComponent(() =>
  import('@/components/coaching/PlayAnimationPreview.vue')
)
// Lazy for the same reason: only mounts on the Coach tab's offensive scheme
// view (season play analytics — analytics facility Lv3+ payoff).
const PlayAnalyticsPanel = defineAsyncComponent(() =>
  import('@/components/analytics/PlayAnalyticsPanel.vue')
)

const route = useRoute()
const router = useRouter()
const teamStore = useTeamStore()
const campaignStore = useCampaignStore()
const authStore = useAuthStore()
const tradeStore = useTradeStore()
const toastStore = useToastStore()
const audio = useAudioStore()
const syncStore = useSyncStore()
const walkthroughStore = useWalkthroughStore()
const { loadSynergies, getActivatedBadges, isPlayerInDynamicDuo } = useBadgeSynergies()

// 1-second tick that drives the live training countdown / ready flip on the
// lineup/bench player cards. Runs only while a training session is active so an
// idle GM view isn't paying for a per-second timer. (One view-level interval —
// not per card.)
const _trainClockTick = ref(Date.now())
let _trainClockHandle = null
function _stopTrainClock() {
  if (_trainClockHandle != null) {
    clearInterval(_trainClockHandle)
    _trainClockHandle = null
  }
}
watch(() => !!teamStore.coach?.activeTraining?.endsAt, (active) => {
  if (active) {
    _trainClockTick.value = Date.now()
    if (_trainClockHandle == null) {
      _trainClockHandle = setInterval(() => { _trainClockTick.value = Date.now() }, 1000)
    }
  } else {
    _stopTrainClock()
  }
}, { immediate: true })
onUnmounted(_stopTrainClock)

// The active session IF it belongs to `player` (in progress OR done-unclaimed).
function _trainingSessionFor(player) {
  const t = teamStore.coach?.activeTraining
  if (!t?.endsAt) return null
  const pid = player?.id
  if (pid == null || String(t.playerId) !== String(pid)) return null
  return t
}

// Milliseconds left on this player's training session (0 if none/finished).
function trainingMsLeftFor(player) {
  void _trainClockTick.value
  const t = _trainingSessionFor(player)
  if (!t) return 0
  return Math.max(0, new Date(t.endsAt).getTime() - Date.now())
}

// In progress = session exists and the clock hasn't run out → show countdown.
function isTrainingInProgressFor(player) {
  return !!_trainingSessionFor(player) && trainingMsLeftFor(player) > 0
}

// True when THIS player has a finished training session waiting to claim.
// Surfaces a green dot in the top-left of each player-avatar block on the
// starting-lineup and bench cards.
function isTrainingReadyFor(player) {
  return !!_trainingSessionFor(player) && trainingMsLeftFor(player) <= 0
}

// Pretty "Xh Ym" / "Xm Ys" / "Xs" countdown (mirrors the player-detail modal).
function formatTrainingCountdown(ms) {
  if (ms == null || ms <= 0) return 'Done'
  const totalSeconds = Math.ceil(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours >= 1) return `${hours}h ${minutes}m`
  const seconds = totalSeconds % 60
  if (minutes >= 1) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

// Each GM sub-tab has its own first-visit walkthrough. The engine drives the
// active tab through this channel when a step needs a particular tab shown.
const TAB_TOUR_KEYS = {
  team: 'gmTeam',
  personnel: 'gmPersonnel',
  finances: 'gmFinances',
  trades: 'gmTrades',
  facilities: 'gmFacilities',
  owner: 'gmOwner',
  schedule: 'gmSchedule',
}
// Replay key for the "?" button — the active GM tab's tour, if it has one.
const replayTourKey = computed(() => TAB_TOUR_KEYS[activeTab.value] ?? null)

function startTabTour(tab) {
  const key = TAB_TOUR_KEYS[tab]
  if (!key) return
  // Skip the trades-tab tour when the user is in the middle of a Negotiate
  // handoff from an inbound proposal — the wizard auto-opens and the tour
  // would overlay it. The tour will fire on a normal future visit when no
  // prefill is pending.
  if (tab === 'trades' && tradeStore.negotiationPrefill) return
  // The Finances (roster) tour spotlights the Roster sub-tab. When the page is
  // deep-linked to another finances sub-tab (e.g. ?sub=free-agents during the
  // free-agency window), its roster steps have no targets — so defer the tour
  // to a normal visit on the Roster sub-tab rather than firing it half-blind.
  if (tab === 'finances') {
    const sub = route.query?.sub
    if (sub && sub !== 'team') return
  }
  walkthroughStore.maybeStart(key)
}

// Deep-link target for the Facilities tab's sub-tab
// (?tab=facilities&sub=scouting|training|medical|analytics|arena) — e.g.
// from the homepage staff overview card's per-row links.
const initialFacilitiesSubTab = ['scouting', 'training', 'medical', 'analytics', 'arena']
  .includes(route.query?.sub) ? route.query.sub : null

// Only show loading if we don't have cached team data
const loading = ref(!teamStore.team)
const validTabs = ['team', 'personnel', 'finances', 'trades', 'facilities', 'owner', 'schedule']
const queryTab = route.query?.tab
const hashTab = route.hash?.slice(1)
const initialTab = queryTab || hashTab

// Trades tab is hidden once the in-season trade deadline passes (Feb 5) — the
// trade UI would just toast "deadline passed" on every action otherwise. Same
// flag drives the AI proposal generation gate in CampaignHomeView, so the
// rest of the app stays consistent.
const tradeDeadlinePassed = computed(() => isPastTradeDeadline(campaignStore.currentCampaign))

// Resolve the active tab, accounting for the deadline gate (a stale URL hash
// like `#trades` after the deadline lands the user on the team tab instead).
const requestedTab = validTabs.includes(initialTab) ? initialTab : 'team'
const activeTab = ref(
  requestedTab === 'trades' && tradeDeadlinePassed.value ? 'team' : requestedTab
)

// If the deadline flips while the user is sitting on the trades tab (e.g. they
// just simulated through Feb 5), kick them back to the team tab.
watch(tradeDeadlinePassed, (passed) => {
  if (passed && activeTab.value === 'trades') {
    activeTab.value = 'team'
  }
})

// Let the walkthrough engine drive the active tab when a step needs one shown.
useWalkthroughTab('gm', (tab) => { activeTab.value = tab })

// Mirror the active tab into the URL query (replace — no history spam) so a
// refresh, a shared link, and especially the headshot-editor round trip all
// land back on the tab the user was actually on. `sub` (facilities sub-tab,
// synced by FacilitiesTab) only makes sense on the facilities tab — drop it
// when leaving.
watch(activeTab, (tab) => {
  const query = { ...route.query, tab }
  if (tab !== 'facilities') delete query.sub
  if (route.query.tab !== tab || (tab !== 'facilities' && route.query.sub != null)) {
    router.replace({ query }).catch(() => {})
  }
})
const selectedPlayer = ref(null)
const showPlayerModal = ref(false)

// If the user just came back from the headshot editor, restore the modal on
// Exiting the headshot editor now leaves the user on this view's default
// state (the lineup tab) — no auto-reopen of the PlayerDetailModal. The
// editor's exit handler still routes here via the captured return route;
// it just lands without the modal popping back up.
// True only when the modal was opened from the lineup tab — gates both the
// initial player-detail tour and the per-sub-tab tours inside the modal.
const playerModalTours = ref(false)

// Evolution history display state
const showAllRecentEvolution = ref(false)
const showAllTimeEvolution = ref(false)
const showAllTimeExpanded = ref(false)

// Move dropdown state
const expandedMovePlayer = ref(null)
const swappingLineup = ref(false)

// Animation state for lineup changes - supports multiple players
const animatingPlayers = ref({}) // { [playerId]: 'up' | 'down' }

// Coach tab modal state (staff hire/manage moved into FacilitiesTab)
const showHireCoachModal = ref(false)
const showCoachBadgeStore = ref(false)

// Coach badge tier colors for the chip display
const COACH_BADGE_TIER_COLORS = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  hof: '#9333EA',
}

// Hired-staff presence — drives the Facilities tab's warning badge (the staff
// hire/manage UI itself lives in FacilitiesTab, one card per facility).
const hiredScout = computed(() => campaignStore.currentCampaign?.settings?.scout ?? null)
const hiredTrainer = computed(() => campaignStore.currentCampaign?.settings?.trainer ?? null)
const hiredStaffTrainer = computed(() => campaignStore.currentCampaign?.settings?.staff_trainer ?? null)
const hiredAnalyst = computed(() => campaignStore.currentCampaign?.settings?.analyst ?? null)

// Coach settings state
const activeCoachTab = ref('offensive')
const schemesFetched = ref(false)
const updatingScheme = ref(false)
const selectedScheme = ref(null)

// --- Playbook preview (offensive scheme cards) ---------------------------
// Which scheme card has its play list expanded, and the selected play per
// scheme. Reading getSchemePlaybook directly keeps this in sync with the sim's
// actual play weighting (no separate data copy).
const expandedPlaybookScheme = ref(null)
const selectedPlayId = ref({})

const CATEGORY_LABELS = {
  isolation: 'Isolation',
  pick_and_roll: 'Pick & Roll',
  post_up: 'Post Up',
  motion: 'Motion',
  spot_up: 'Spot Up',
  cut: 'Cuts',
  transition: 'Transition',
}
function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] || cat
}

// `getSchemePlaybook` reads from PlayService, which is already in this view's
// eager graph (team store → CoachingEngine → PlayService), so this adds no
// bundle weight. The heavy/continuous part — the looping animation component
// (CourtDiagram + graph builder + rAF) — is the lazily-loaded piece (see the
// defineAsyncComponent import above), and only mounts on expand.
function playbookFor(schemeId) {
  // Only the categories this scheme genuinely emphasises — weighted ABOVE
  // neutral (> 1.0). The universal pick&roll / cut / transition tag-alongs are
  // hidden so each scheme's dropdown shows its distinctive play set. Balanced
  // has no above-neutral category, so it falls back to the full book.
  const full = getSchemePlaybook(schemeId)
  const emphasized = full.filter((grp) => grp.weight > 1.0)
  return emphasized.length ? emphasized : full
}

function defaultPlayId(schemeId) {
  const pb = playbookFor(schemeId)
  return pb[0]?.plays?.[0]?.id ?? null
}

function togglePlaybook(schemeId) {
  if (expandedPlaybookScheme.value === schemeId) {
    expandedPlaybookScheme.value = null
    return
  }
  expandedPlaybookScheme.value = schemeId
  if (!selectedPlayId.value[schemeId]) {
    selectedPlayId.value = { ...selectedPlayId.value, [schemeId]: defaultPlayId(schemeId) }
  }
}

function selectedPlayObj(schemeId) {
  const id = selectedPlayId.value[schemeId] || defaultPlayId(schemeId)
  for (const grp of playbookFor(schemeId)) {
    const found = grp.plays.find((p) => p.id === id)
    if (found) return found
  }
  return null
}

// --- Analytics facility — tiered coach insights ------------------------------
// The ANALYTICS facility's baseline per-level payoff (no analyst needed):
// Lv1 rough fit tiers · Lv2 exact Fit % · Lv3 season play analytics panel ·
// Lv4 per-play season chips in the playbook · Lv5 "Season Proven" scheme tag.
// The analyst's per-game postgame + pregame opponent reports (GameView) stay
// analyst-gated and are unrelated to this ladder.

const analyticsLevel = computed(() =>
  Math.min(5, Math.max(1, teamStore.team?.facilities?.analytics ?? 1))
)

// Lv4: season efficiency for the play currently selected in a scheme's
// playbook viewer. Null (chips hidden) when the play has no season data yet.
function seasonStatsForSelectedPlay(schemeId) {
  const id = selectedPlayId.value[schemeId] || defaultPlayId(schemeId)
  const entry = teamStore.team?.playAnalytics?.plays?.[id]
  if (!entry || !(entry.poss > 0)) return null
  return {
    poss: entry.poss,
    ppp: (entry.pts / entry.poss).toFixed(2),
    two: entry.fg2a > 0 ? Math.round((entry.fg2m / entry.fg2a) * 100) : null,
    three: entry.fg3a > 0 ? Math.round((entry.fg3m / entry.fg3a) * 100) : null,
  }
}

// Lv5: the offensive scheme whose emphasized play categories have produced the
// best points-per-possession this season (min sample so a hot first game
// doesn't crown a scheme). Null until enough data exists.
const PROVEN_MIN_POSS = 25

const provenScheme = computed(() => {
  if (analyticsLevel.value < 5) return null
  const plays = teamStore.team?.playAnalytics?.plays
  if (!plays) return null
  // Aggregate season pts/poss per play category once.
  const byCategory = {}
  for (const entry of Object.values(plays)) {
    if (!entry?.category || !(entry.poss > 0)) continue
    const agg = byCategory[entry.category] ?? (byCategory[entry.category] = { pts: 0, poss: 0 })
    agg.pts += entry.pts ?? 0
    agg.poss += entry.poss
  }
  let best = null
  let bestPpp = -Infinity
  for (const schemeId of Object.keys(teamStore.coachingSchemes?.offensive ?? {})) {
    let pts = 0
    let poss = 0
    for (const grp of playbookFor(schemeId)) {
      const agg = byCategory[grp.category]
      if (agg) {
        pts += agg.pts
        poss += agg.poss
      }
    }
    if (poss < PROVEN_MIN_POSS) continue
    const ppp = pts / poss
    if (ppp > bestPpp) {
      bestPpp = ppp
      best = schemeId
    }
  }
  return best
})
const selectedDefensiveScheme = ref(null)
const selectedSubStrategy = ref('staggered')

// Player minutes state
const playerMinutes = ref({})
let minutesSaveTimeout = null

// Defensive schemes data
const defensiveSchemes = {
  man: {
    name: 'Man-to-Man',
    description: 'Each defender guards a specific opponent. Best for teams with strong individual defenders.',
    type: 'aggressive',
    strengths: ['1-on-1 Defense', 'Ball Pressure'],
    weaknesses: ['Pick & Roll', 'Fatigue']
  },
  zone_2_3: {
    name: '2-3 Zone',
    description: 'Two guards up top, three defenders protecting the paint. Great for limiting interior scoring.',
    type: 'passive',
    strengths: ['Paint Protection', 'Rebounding'],
    weaknesses: ['Corner 3s', 'Ball Movement']
  },
  zone_3_2: {
    name: '3-2 Zone',
    description: 'Three defenders up top, two protecting the baseline. Effective against perimeter shooters.',
    type: 'balanced',
    strengths: ['Perimeter D', 'Transition'],
    weaknesses: ['High Post', 'Baseline Cuts']
  },
  zone_1_3_1: {
    name: '1-3-1 Zone',
    description: 'Trapping zone defense that forces turnovers. High risk, high reward.',
    type: 'aggressive',
    strengths: ['Turnovers', 'Fast Breaks'],
    weaknesses: ['Corner Shots', 'Skip Passes']
  },
  press: {
    name: 'Full Court Press',
    description: 'Apply pressure the full length of the court. Exhausting but can create chaos.',
    type: 'aggressive',
    strengths: ['Turnovers', 'Tempo Control'],
    weaknesses: ['Stamina', 'Easy Baskets']
  },
  trap: {
    name: 'Trap Defense',
    description: 'Aggressive double-teams on ball handlers. Creates turnovers but leaves shooters open.',
    type: 'aggressive',
    strengths: ['Ball Pressure', 'Steals'],
    weaknesses: ['Open 3s', 'Rotation']
  },
  switch_everything: {
    name: 'Switch Everything',
    description: 'Switch every screen to erase pick-and-roll and iso advantages. Needs versatile, switchable defenders.',
    type: 'aggressive',
    strengths: ['Pick & Roll', 'Isolation'],
    weaknesses: ['Post Mismatches']
  },
  box_and_one: {
    name: 'Box-and-One',
    description: 'Four defenders in a zone box with one chaser hounding the opposing star. Smothers iso scorers.',
    type: 'aggressive',
    strengths: ['Star Scorers', 'Isolation'],
    weaknesses: ['Ball Movement', 'Spot-Up 3s']
  },
  drop_coverage: {
    name: 'Drop Coverage',
    description: 'Bigs sag into the paint on ball screens to wall off the rim, conceding the pull-up and pop three.',
    type: 'balanced',
    strengths: ['Pick & Roll', 'Rim Protection'],
    weaknesses: ['Pull-Up 3s', 'Spot-Up Shooters']
  },
  half_court_trap: {
    name: 'Half-Court Trap',
    description: 'Spring traps past half court to force live-ball turnovers without the full-court risk.',
    type: 'aggressive',
    strengths: ['Turnovers', 'Post Offense'],
    weaknesses: ['Open Man', 'Quick Offense']
  }
}

// Position validation
const { POSITIONS, canPlayPosition } = usePositionValidation()

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const team = computed(() => teamStore.team)
const roster = computed(() => teamStore.roster)
// Live team-overall — average OVR of healthy, non-FA, non-retired players.
// Drives the small badge that overlays the team logo in the header.
const teamOverall = computed(() => computeTeamOverall(roster.value))
const coach = computed(() => teamStore.coach)

// Owned coach badges enriched with their definitions (name/description) and
// merged with the per-entry level + source for the chip display.
const ownedCoachBadges = computed(() => {
  const owned = coach.value?.badges ?? []
  return owned
    .map(entry => {
      const def = COACH_BADGE_DEFS.find(b => b.id === entry?.id)
      if (!def) return null
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        category: def.category,
        level: entry.level ?? 'bronze',
        source: entry.source,
      }
    })
    .filter(Boolean)
})
// Normalize career stats — supports both nested career_stats object (post-season-archive)
// and flat fields (career_wins, career_losses, etc.) from initial coach generation
const coachCareerStats = computed(() => {
  const c = coach.value
  if (!c) return null
  if (c.career_stats) return c.career_stats
  // Fall back to flat fields
  const wins = c.career_wins ?? 0
  const losses = c.career_losses ?? 0
  const totalGames = wins + losses
  const playoffWins = c.playoff_wins ?? 0
  const playoffLosses = c.playoff_losses ?? 0
  const totalPlayoff = playoffWins + playoffLosses
  return {
    wins,
    losses,
    win_pct: totalGames > 0 ? Math.round((wins / totalGames) * 1000) / 1000 : 0,
    playoff_wins: playoffWins,
    playoff_losses: playoffLosses,
    playoff_win_pct: totalPlayoff > 0 ? Math.round((playoffWins / totalPlayoff) * 1000) / 1000 : 0,
    championships: c.championships ?? 0,
    seasons_coached: c.seasons_coached ?? 0,
    conference_titles: c.conference_titles ?? 0,
    coach_of_year_awards: c.coach_of_year_awards ?? 0,
  }
})
const teamChemistry = computed(() => teamStore.teamChemistry)
// 3-band signal: green (happy) / amber (meh) / red (frown). Matches the
// face icon next to the % so users can read the locker-room mood at a glance.
const chemistryColor = computed(() => {
  const v = teamChemistry.value
  if (v >= 70) return '#22c55e'
  if (v >= 50) return '#f59e0b'
  return '#ef4444'
})
const chemistryIcon = computed(() => {
  const v = teamChemistry.value
  if (v >= 70) return Smile
  if (v >= 50) return Meh
  return Frown
})
const expiringContractsCount = computed(() => roster.value.filter(p => p.contractYearsRemaining === 1).length)

// During the offseason the Finances "Expiring" sub-tab is hidden (those
// contracts only matter for the next season's planning), so the Roster tab's
// expiring-count badge is suppressed too. Mirrors FinancesTab's isOffseason.
const isOffseason = computed(() =>
  (campaignStore.currentCampaign?.phase ?? '').startsWith('offseason')
)

// Starters in position order (PG, SG, SF, PF, C) - may contain nulls for empty slots
const starters = computed(() => teamStore.starterPlayers)

// Starter slots - always 5 positions, with player or null
const starterSlots = computed(() => {
  return POSITIONS.map((pos, index) => ({
    position: pos,
    player: starters.value[index] || null
  }))
})

// Drag state (declared early so bench watch can reference it)
const draggingPlayerId = ref(null)

// Bench players sorted by target minutes (highest to lowest), injured players at end.
// Final tiebreaker is the player id so two players with identical injured/minutes/rating
// don't flip-flop between renders. Without it, sort comparator returns 0 for the equal-rated
// pair and the displayed order then depends on whatever order the upstream array happens
// to land in — which can shift across navigations.
const benchPlayers = computed(() => {
  return [...teamStore.benchPlayers]
    .filter(p => p !== null)
    .sort((a, b) => {
      const aInjured = a.is_injured || a.isInjured ? 1 : 0
      const bInjured = b.is_injured || b.isInjured ? 1 : 0
      if (aInjured !== bInjured) return aInjured - bInjured
      const aMins = playerMinutes.value[a.id] ?? 0
      const bMins = playerMinutes.value[b.id] ?? 0
      if (bMins !== aMins) return bMins - aMins
      const ar = a.overallRating ?? a.overall_rating ?? 0
      const br = b.overallRating ?? b.overall_rating ?? 0
      if (br !== ar) return br - ar
      return String(a.id).localeCompare(String(b.id))
    })
})

// Display list for bench — defers re-sort by 500ms after drag ends for smooth animation.
// Note: this watch is registered AFTER the watch on `roster` below, so on mount the
// `initPlayerMinutes` watcher fires before this one. That ordering matters: the bench
// sort consumes `playerMinutes.value`, so seeding it first prevents a transient render
// where minutes are all 0 and the sort falls back to rating-only order — which the
// TransitionGroup would then animate to the real order on the next tick.
const displayBenchPlayers = ref([])
let benchSortTimer = null

// Available roster slots (max 15 players) - exclude nulls from count
const availableRosterSlots = computed(() => {
  const actualPlayers = roster.value.filter(p => p !== null).length
  return Math.max(0, 15 - actualPlayers)
})

// Group roster by position (sorted by overall within each position)
const rosterByPosition = computed(() => {
  const positions = { PG: [], SG: [], SF: [], PF: [], C: [] }
  roster.value.forEach(player => {
    // Skip null players (empty starter slots)
    if (!player) return
    if (positions[player.position]) {
      positions[player.position].push(player)
    }
  })
  // Sort each position group by overall rating
  Object.keys(positions).forEach(pos => {
    positions[pos].sort((a, b) => b.overall_rating - a.overall_rating)
  })
  return positions
})

// Conference label
const conferenceLabel = computed(() => {
  if (!team.value?.conference) return ''
  return team.value.conference === 'east' ? 'EAST' : 'WEST'
})

onMounted(async () => {
  loadSynergies()

  // If we already have team data, refresh in background without blocking
  const hasCachedData = teamStore.team

  const fetchAll = Promise.all([
    teamStore.fetchTeam(campaignId.value),
    campaignStore.fetchCampaign(campaignId.value)
  ])

  if (hasCachedData) {
    // Refresh in background, don't wait
    fetchAll.catch(err => console.error('Failed to refresh team:', err))
  } else {
    // No cached data, wait for fetch and show loading
    try {
      await fetchAll
    } catch (err) {
      console.error('Failed to load team:', err)
    } finally {
      loading.value = false
    }
  }

  // If the GM page opened directly on the Coach tab (id 'personnel'), the activeTab watcher
  // won't fire — load the coaching schemes here so the Offensive/Substitution
  // grids and Fit % populate. (roster is loaded by the fetch above.)
  if (activeTab.value === 'personnel') {
    await loadCoachingSchemes()
  }

  // First-visit walkthrough for whichever tab we landed on.
  startTabTour(activeTab.value)
})

// Initialize player minutes — defaults sum to exactly 240, distributed by
// the team's chosen substitution strategy (deep_bench, staggered, etc).
function initPlayerMinutes() {
  // Don't run if roster hasn't loaded yet
  if (!roster.value || roster.value.length === 0) return

  const stored = teamStore.targetMinutes || {}
  const lineupIds = teamStore.lineup?.filter(id => id !== null) || []
  const hasStored = Object.keys(stored).length > 0

  // If we have stored values, use them (preserve user customizations)
  if (hasStored) {
    const newMinutes = {}
    for (const player of roster.value) {
      if (!player) continue
      const isInjured = player.is_injured || player.isInjured
      newMinutes[player.id] = isInjured ? 0 : (stored[player.id] ?? 0)
    }
    playerMinutes.value = newMinutes
    return
  }

  // Build fresh defaults using the team's coaching substitution strategy.
  const strategy = teamStore.team?.coaching_scheme?.substitution || 'staggered'
  playerMinutes.value = generateRoleAwareTargetMinutes(roster.value, lineupIds, strategy)

  // Persist generated defaults to store and backend
  if (campaignId.value) {
    teamStore.updateTargetMinutes(campaignId.value, playerMinutes.value).catch(() => {})
  }
}

// Watch roster changes to reinitialize minutes.
// Registered BEFORE the displayBenchPlayers watcher so playerMinutes.value is
// populated before the bench sort first reads it.
watch(roster, () => {
  initPlayerMinutes()
}, { immediate: true })

// Now mirror benchPlayers into the display list. By this point initPlayerMinutes
// has already populated playerMinutes.value, so the first immediate fire produces
// the same order subsequent fires will.
watch(benchPlayers, (newVal) => {
  if (!draggingPlayerId.value && !benchSortTimer) {
    displayBenchPlayers.value = [...newVal]
  }
}, { immediate: true })

// Total minutes computed
const totalMinutes = computed(() =>
  Object.values(playerMinutes.value).reduce((sum, m) => sum + (m || 0), 0)
)

const totalMinutesColor = computed(() => {
  const t = totalMinutes.value
  if (t >= 235 && t <= 245) return '#22c55e'
  if ((t >= 225 && t < 235) || (t > 245 && t <= 255)) return '#f59e0b'
  return '#ef4444'
})

function getPlayerMinutes(playerId, fallback = 0) {
  return playerMinutes.value[playerId] ?? fallback
}

function setPlayerMinutes(playerId, desired) {
  const current = playerMinutes.value[playerId] || 0
  const othersTotal = totalMinutes.value - current
  const available = 240 - othersTotal
  playerMinutes.value[playerId] = Math.max(0, Math.min(desired, available))
  debouncedSaveMinutes()
}

function isPlayerInjured(playerId) {
  const p = roster.value.find(rp => rp.id === playerId)
  return !!(p?.is_injured || p?.isInjured)
}

function getMinutesMeterColor(mins) {
  if (mins <= 0) return '#6b7280'
  if (mins <= 24) return '#22c55e'
  if (mins <= 38) return '#3b82f6'
  if (mins <= 43) return '#f59e0b'
  return '#ef4444'
}

const draggingMinFloor = ref(0)

function calcMinutesFromEvent(e, bar) {
  const rect = bar.getBoundingClientRect()
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return Math.round(ratio * 48)
}

function startMinutesDrag(e, playerId, minFloor) {
  if (isPlayerInjured(playerId)) return
  e.preventDefault()
  draggingPlayerId.value = playerId
  draggingMinFloor.value = minFloor
  const bar = e.currentTarget.closest('.minutes-meter-bar') || e.currentTarget
  bar.classList.add('dragging')
  const mins = Math.max(minFloor, Math.min(48, calcMinutesFromEvent(e, bar)))
  setPlayerMinutes(playerId, mins)

  const onMove = (moveEvent) => {
    moveEvent.preventDefault()
    const m = Math.max(minFloor, Math.min(48, calcMinutesFromEvent(moveEvent, bar)))
    setPlayerMinutes(playerId, m)
  }
  const onUp = () => {
    bar.classList.remove('dragging')
    // Schedule bench re-sort after 500ms delay, set timer before clearing drag flag
    if (benchSortTimer) clearTimeout(benchSortTimer)
    benchSortTimer = setTimeout(() => {
      displayBenchPlayers.value = [...benchPlayers.value]
      benchSortTimer = null
    }, 500)
    draggingPlayerId.value = null
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.addEventListener('touchmove', onMove, { passive: false })
  document.addEventListener('touchend', onUp)
}

function debouncedSaveMinutes() {
  if (minutesSaveTimeout) clearTimeout(minutesSaveTimeout)
  minutesSaveTimeout = setTimeout(async () => {
    // Don't save if minutes data is empty
    if (!playerMinutes.value || Object.keys(playerMinutes.value).length === 0) return
    try {
      await teamStore.updateTargetMinutes(campaignId.value, playerMinutes.value)
    } catch (err) {
      console.error('Failed to save target minutes:', err)
      toastStore.showError('Failed to save minutes')
    }
  }, 500)
}

async function updateSubstitutionStrategy(strategy) {
  if (updatingScheme.value) return
  updatingScheme.value = true
  try {
    await teamStore.updateCoachingScheme(
      campaignId.value,
      selectedScheme.value || team.value?.coaching_scheme?.offensive || 'balanced',
      selectedDefensiveScheme.value || team.value?.coaching_scheme?.defensive || 'man',
      strategy
    )
    selectedSubStrategy.value = strategy
    toastStore.showSuccess('Substitution strategy updated')
  } catch (err) {
    console.error('Failed to update substitution strategy:', err)
    toastStore.showError('Failed to update strategy')
  } finally {
    updatingScheme.value = false
  }
}

// Watch for tab change to fetch coaching schemes and clear trade state
// Load the coaching-scheme list + per-scheme Fit % for the Coach tab (id
// 'personnel'). Used by BOTH the activeTab watcher (on tab switch) AND
// onMounted (when the GM page opens directly on it — e.g. a reload or deep
// link — where the watcher
// never fires and the Offensive/Substitution grids would otherwise stay empty).
async function loadCoachingSchemes() {
  if (schemesFetched.value) return
  try {
    await teamStore.fetchCoachingSchemes(campaignId.value)
    // coaching_scheme is now {offensive, defensive} object
    const scheme = team.value?.coaching_scheme
    selectedScheme.value = scheme?.offensive || scheme || 'balanced'
    selectedDefensiveScheme.value = scheme?.defensive || 'man'
    selectedSubStrategy.value = scheme?.substitution || 'staggered'
    schemesFetched.value = true
  } catch (err) {
    console.error('Failed to fetch coaching schemes:', err)
  }
}

watch(activeTab, async (newTab, oldTab) => {
  // Clear trade state when leaving the trades tab
  if (oldTab === 'trades' && newTab !== 'trades') {
    tradeStore.clearTrade()
    tradeStore.clearSelectedTeam()
  }

  if (newTab === 'personnel') {
    await loadCoachingSchemes()
  }

  // First-visit walkthrough for the tab the user just opened.
  startTabTour(newTab)
})

async function updateOffensiveScheme(scheme) {
  if (updatingScheme.value) return
  updatingScheme.value = true
  try {
    await teamStore.updateCoachingScheme(campaignId.value, scheme, selectedDefensiveScheme.value)
    selectedScheme.value = scheme
    toastStore.showSuccess('Offensive scheme updated')
  } catch (err) {
    console.error('Failed to update offensive scheme:', err)
    toastStore.showError('Failed to update scheme')
  } finally {
    updatingScheme.value = false
  }
}

async function updateDefensiveScheme(scheme) {
  if (updatingScheme.value) return
  updatingScheme.value = true
  try {
    await teamStore.updateCoachingScheme(campaignId.value, selectedScheme.value, scheme)
    selectedDefensiveScheme.value = scheme
    toastStore.showSuccess('Defensive scheme updated')
  } catch (err) {
    console.error('Failed to update defensive scheme:', err)
    toastStore.showError('Failed to update scheme')
  } finally {
    updatingScheme.value = false
  }
}

// Walkthrough side-effects: open/close the first starter's move menu so the
// onboarding tour can demonstrate the lineup-adjustment control. (watch is not
// immediate, so it only runs after setup when an action is requested.)
watch(() => walkthroughStore.requestedAction, (req) => {
  if (!req || req.view !== 'gm') return
  if (req.action === 'openFirstStarterMenu') {
    const slot0 = starterSlots.value[0]
    if (slot0?.player) expandedMovePlayer.value = `starter-${slot0.player.id}`
  } else if (req.action === 'closeLineupMenus') {
    expandedMovePlayer.value = null
  }
})

function openPlayerModal(player) {
  selectedPlayer.value = player
  showPlayerModal.value = true
  // The player-detail tours only fire when the modal is opened from the lineup
  // (team) tab — not from any other GM tab. This flag also gates the per-sub-tab
  // tours inside the modal (via :enable-tab-tours).
  playerModalTours.value = activeTab.value === 'team'
  if (playerModalTours.value) {
    // Wait a tick so the modal's DOM exists before the tour spotlights inside it.
    nextTick(() => walkthroughStore.maybeStart('playerDetail'))
  }
}

function closePlayerModal() {
  showPlayerModal.value = false
  selectedPlayer.value = null
  // If any player-detail tour (initial page or a sub-tab) is still running when
  // the modal closes, end it so it doesn't leave a dangling spotlight.
  if (walkthroughStore.activeKey?.startsWith('playerDetail')) {
    walkthroughStore.skip()
  }
}

// Move dropdown functions
function toggleMoveDropdown(playerId) {
  if (expandedMovePlayer.value === playerId) {
    expandedMovePlayer.value = null
  } else {
    expandedMovePlayer.value = playerId
  }
}

function closeMoveDropdown() {
  expandedMovePlayer.value = null
}

// Get swap candidates for a starter (bench players who can play this position).
// Injured bench players are excluded — they can't be moved into the starting
// lineup until they recover.
function getStarterSwapCandidates(slotPosition) {
  return benchPlayers.value.filter(p => canPlayPosition(p, slotPosition) && !isPlayerInjured(p.id))
}

// Get the starter that a bench player can swap with (based on position)
function getBenchSwapCandidates(benchPlayer) {
  // Find starters whose position matches what this bench player can play
  return starterSlots.value.filter(slot =>
    slot.player && canPlayPosition(benchPlayer, slot.position)
  ).map(slot => ({
    ...slot.player,
    slotPosition: slot.position
  }))
}

// Get empty starter slots that a bench player can fill
function getEmptySlotCandidates(benchPlayer) {
  return starterSlots.value.filter(slot =>
    !slot.player && canPlayPosition(benchPlayer, slot.position)
  ).map(slot => ({
    position: slot.position,
    slotIndex: POSITIONS.indexOf(slot.position)
  }))
}

// Swap a starter with a bench player
async function swapPlayers(starterIndex, benchPlayerId) {
  if (swappingLineup.value) return
  // Block injured bench players from being moved into the starting lineup.
  // Defense-in-depth alongside the dropdown filter — covers any code path
  // that calls swapPlayers directly (walkthrough action triggers, etc.).
  if (isPlayerInjured(benchPlayerId)) {
    toastStore.showError("Can't move an injured player into the starting lineup")
    closeMoveDropdown()
    return
  }
  swappingLineup.value = true
  if (minutesSaveTimeout) { clearTimeout(minutesSaveTimeout); minutesSaveTimeout = null }

  // Get the starter being replaced (will move down)
  const starterBeingReplaced = starters.value[starterIndex]

  // Capture minutes before the swap so we can apply after fetchTeam
  const starterMins = starterBeingReplaced ? (playerMinutes.value[starterBeingReplaced.id] ?? 0) : 0
  const benchMins = playerMinutes.value[benchPlayerId] ?? 0

  try {
    // Build new lineup array (handle null values for empty slots)
    const newLineup = starters.value.map(p => p ? p.id : null)
    newLineup[starterIndex] = benchPlayerId

    closeMoveDropdown()

    await teamStore.updateLineup(campaignId.value, newLineup)
    await teamStore.fetchTeam(campaignId.value, { force: true })

    // Swap minutes after fetchTeam (which re-inits from stored values)
    if (starterBeingReplaced) {
      playerMinutes.value[benchPlayerId] = starterMins
      playerMinutes.value[starterBeingReplaced.id] = benchMins
      debouncedSaveMinutes()
    }

    toastStore.showSuccess('Lineup updated')

    animatingPlayers.value = {
      [benchPlayerId]: 'up',
      ...(starterBeingReplaced ? { [starterBeingReplaced.id]: 'down' } : {})
    }

    setTimeout(() => {
      animatingPlayers.value = {}
    }, 400)
  } catch (err) {
    console.error('Failed to swap players:', err)
    toastStore.showError('Failed to update lineup')
    animatingPlayers.value = {}
  } finally {
    swappingLineup.value = false
  }
}

// Move starter to bench without replacement (leaves empty slot)
async function moveToBench(starterIndex) {
  if (swappingLineup.value) return
  swappingLineup.value = true
  if (minutesSaveTimeout) { clearTimeout(minutesSaveTimeout); minutesSaveTimeout = null }

  const playerToMove = starters.value[starterIndex]

  try {
    // Build new lineup with null for the empty position (handle existing nulls)
    const newLineup = starters.value.map((p, i) => i === starterIndex ? null : (p ? p.id : null))

    closeMoveDropdown()

    await teamStore.updateLineup(campaignId.value, newLineup)
    await teamStore.fetchTeam(campaignId.value, { force: true })

    toastStore.showSuccess('Lineup updated')

    animatingPlayers.value = { [playerToMove.id]: 'down' }

    setTimeout(() => {
      animatingPlayers.value = {}
    }, 400)
  } catch (err) {
    console.error('Failed to move player to bench:', err)
    toastStore.showError('Failed to update lineup')
    animatingPlayers.value = {}
  } finally {
    swappingLineup.value = false
  }
}

// Promote bench player to starter (into empty slot or swap)
async function promoteToStarter(benchPlayer, targetPosition) {
  if (swappingLineup.value) return
  // Block injured bench players from being promoted to the starting lineup.
  if (benchPlayer?.is_injured || benchPlayer?.isInjured) {
    toastStore.showError("Can't move an injured player into the starting lineup")
    closeMoveDropdown()
    return
  }
  swappingLineup.value = true
  if (minutesSaveTimeout) { clearTimeout(minutesSaveTimeout); minutesSaveTimeout = null }

  // Get the starter being replaced (if any)
  const posIndex = POSITIONS.indexOf(targetPosition)
  const starterBeingReplaced = starters.value[posIndex]

  // Capture minutes before the swap so we can apply after fetchTeam
  const starterMins = starterBeingReplaced ? (playerMinutes.value[starterBeingReplaced.id] ?? 0) : 0
  const benchMins = playerMinutes.value[benchPlayer.id] ?? 0

  try {
    // Build new lineup (handle null values for empty slots)
    const newLineup = starters.value.map(p => p ? p.id : null)
    newLineup[posIndex] = benchPlayer.id

    closeMoveDropdown()

    await teamStore.updateLineup(campaignId.value, newLineup)
    await teamStore.fetchTeam(campaignId.value, { force: true })

    // Swap minutes after fetchTeam (which re-inits from stored values)
    if (starterBeingReplaced) {
      playerMinutes.value[benchPlayer.id] = starterMins
      playerMinutes.value[starterBeingReplaced.id] = benchMins
      debouncedSaveMinutes()
    }

    toastStore.showSuccess('Lineup updated')

    animatingPlayers.value = {
      [benchPlayer.id]: 'up',
      ...(starterBeingReplaced ? { [starterBeingReplaced.id]: 'down' } : {})
    }

    setTimeout(() => {
      animatingPlayers.value = {}
    }, 400)
  } catch (err) {
    console.error('Failed to promote player:', err)
    toastStore.showError('Failed to update lineup')
    animatingPlayers.value = {}
  } finally {
    swappingLineup.value = false
  }
}

// CPU-driven lineup auto-fill. Picks the best 5 via AILineupService, then
// distributes minutes according to the team's chosen substitution strategy
// (deep_bench gives starters ~26-36 mins; tight_rotation gives ~34-43, etc).
const cpuAdjusting = ref(false)
async function cpuAdjustLineup() {
  if (cpuAdjusting.value || swappingLineup.value) return
  const rosterArr = teamStore.roster
  if (!rosterArr || rosterArr.length < 5) {
    toastStore.showError('Roster too small for a CPU lineup')
    return
  }
  cpuAdjusting.value = true
  if (minutesSaveTimeout) { clearTimeout(minutesSaveTimeout); minutesSaveTimeout = null }

  try {
    const [{ selectBestLineup }, { generateRoleAwareTargetMinutes }] = await Promise.all([
      import('@/engine/ai/AILineupService'),
      import('@/engine/simulation/SubstitutionEngine'),
    ])
    const newLineup = selectBestLineup(rosterArr)
    if (!Array.isArray(newLineup) || newLineup.length !== 5) {
      toastStore.showError('CPU could not pick a lineup')
      return
    }
    closeMoveDropdown()
    await teamStore.updateLineup(campaignId.value, newLineup, [])

    const strategy = teamStore.team?.coaching_scheme?.substitution || 'staggered'
    const newStarterIds = newLineup.filter(id => id !== null)
    const newMinutes = generateRoleAwareTargetMinutes(rosterArr, newStarterIds, strategy)
    await teamStore.updateTargetMinutes(campaignId.value, newMinutes)
    await teamStore.fetchTeam(campaignId.value, { force: true })
    toastStore.showSuccess('Lineup auto-set by CPU')
  } catch (err) {
    console.error('Failed to CPU-adjust lineup:', err)
    toastStore.showError('Failed to auto-adjust lineup')
  } finally {
    cpuAdjusting.value = false
  }
}

function formatSalary(salary) {
  if (!salary) return '-'
  if (salary >= 1000000) {
    return `$${(salary / 1000000).toFixed(1)}M`
  }
  return `$${(salary / 1000).toFixed(0)}K`
}

function getPositionColor(position) {
  const colors = {
    PG: '#3B82F6',
    SG: '#10B981',
    SF: '#F59E0B',
    PF: '#EF4444',
    C: '#8B5CF6'
  }
  return colors[position] || '#6B7280'
}

function getBadgeLevelColor(level) {
  const colors = {
    bronze: '#CD7F32',
    silver: '#C0C0C0',
    gold: '#FFD700',
    hof: '#9B59B6'
  }
  return colors[level] || '#6B7280'
}

function getAttrColor(value) {
  if (value >= 90) return 'var(--color-success)'
  if (value >= 80) return '#22D3EE'
  if (value >= 70) return 'var(--color-primary)'
  if (value >= 60) return 'var(--color-warning)'
  return 'var(--color-error)'
}

function getFatigueColor(fatigue) {
  if (fatigue >= 70) return '#ef4444'  // red
  if (fatigue >= 50) return '#f59e0b'  // amber/warning
  return '#22c55e'  // green
}

function isOverFatigued(fatigue) {
  return fatigue >= 70
}

// True when a player has at least one upgrade point available to spend on
// either the offensive or defensive attribute pool. Drives the double-chevron
// indicator on the lineup card OVR badges.
function hasUpgradePoints(player) {
  if (!player) return false
  const off = player.offense_upgrade_points ?? player.offenseUpgradePoints ?? 0
  const def = player.defense_upgrade_points ?? player.defenseUpgradePoints ?? 0
  return (Number(off) || 0) >= 1 || (Number(def) || 0) >= 1
}

function formatBadgeName(badge) {
  return badgeDisplayName(badge)
}

function formatAttrName(attrKey) {
  if (!attrKey) return ''
  return attrKey
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim()
}

// Read injury days remaining (with `games_remaining` legacy fallback for
// players injured before the games→days migration).
function injuryDaysLabel(player) {
  const injury = player?.injury_details || player?.injuryDetails || {}
  const days = Math.ceil(injury.days_remaining ?? injury.games_remaining ?? 0)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

function formatWeight(weight) {
  if (!weight) return '210'
  const w = parseInt(weight)
  if (w > 400) return Math.round(w / 10)
  return w
}

function getEffectivenessClass(value) {
  if (value >= 70) return 'high'
  if (value >= 50) return 'medium'
  return 'low'
}

function getRatingClass(rating) {
  if (rating >= 90) return 'elite'
  if (rating >= 80) return 'star'
  if (rating >= 70) return 'starter'
  if (rating >= 60) return 'rotation'
  return 'bench'
}

// Get top 3 badges sorted by synergy activation then level
function getTopBadges(badges, player) {
  if (!badges) return []
  const starters = teamStore.starterPlayers?.filter(p => p != null) || []
  const { activatedIds } = getActivatedBadges(player, starters)
  const levelOrder = { hof: 0, gold: 1, silver: 2, bronze: 3 }
  return [...badges]
    .sort((a, b) => {
      // Synergy-active badges first
      const aActive = activatedIds.has(a.id) ? 0 : 1
      const bActive = activatedIds.has(b.id) ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      // Then by level
      return (levelOrder[a.level] || 4) - (levelOrder[b.level] || 4)
    })
    .slice(0, 3)
}

// Badge synergy helpers
function getStarterActivatedData(player) {
  const starters = teamStore.starterPlayers?.filter(p => p != null) || []
  return getActivatedBadges(player, starters)
}

function isStarterBadgeActivated(player, badgeId) {
  const { activatedIds } = getStarterActivatedData(player)
  return activatedIds.has(badgeId)
}

function getPlayerDuoPartner(player) {
  const starters = teamStore.starterPlayers?.filter(p => p != null) || []
  return isPlayerInDynamicDuo(player, starters)
}

function getStarterBadgeSynergyTooltip(player, badge) {
  const { synergyDetails } = getStarterActivatedData(player)
  const details = synergyDetails.get(badge.id)
  if (!details?.length) return `${formatBadgeName(badge)} (${badge.level})`
  const synergyText = details.map(d => `⚡ ${d.synergyName} (w/ ${d.partnerName})`).join('\n')
  return `${formatBadgeName(badge)} (${badge.level})\n${synergyText}`
}

// Evolution history processing
const evolutionHistory = computed(() => {
  if (!selectedPlayer.value?.development_history) return []
  return selectedPlayer.value.development_history || []
})

// Get date 7 days ago for filtering recent evolution (using in-game date)
const sevenDaysAgo = computed(() => {
  const currentDateStr = campaign.value?.current_date || new Date().toISOString().split('T')[0]
  const [y, m, d] = currentDateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - 7)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
})

// Aggregate evolution by attribute (category.attribute as key)
function aggregateEvolution(history) {
  const aggregated = {}
  for (const entry of history) {
    const key = `${entry.category}.${entry.attribute}`
    if (!aggregated[key]) {
      aggregated[key] = {
        category: entry.category,
        attribute: entry.attribute,
        totalChange: 0,
        count: 0,
      }
    }
    aggregated[key].totalChange += entry.change
    aggregated[key].count++
  }
  // Convert to array and sort by total change (descending by absolute value, positive first)
  return Object.values(aggregated)
    .sort((a, b) => {
      // Positive changes first, then by absolute value
      if (a.totalChange > 0 && b.totalChange <= 0) return -1
      if (a.totalChange <= 0 && b.totalChange > 0) return 1
      return Math.abs(b.totalChange) - Math.abs(a.totalChange)
    })
}

// Recent evolution (last 7 days)
const recentEvolution = computed(() => {
  const recent = evolutionHistory.value.filter(e => e.date >= sevenDaysAgo.value)
  return aggregateEvolution(recent)
})

// All-time evolution
const allTimeEvolution = computed(() => {
  return aggregateEvolution(evolutionHistory.value)
})

// Format category name for display
function formatCategoryName(category) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

// Get color for evolution change
function getEvolutionColor(change) {
  if (change > 0) return '#22c55e' // green
  if (change < 0) return '#ef4444' // red
  return '#6b7280' // gray
}

// Format change with sign
function formatChange(change) {
  const rounded = Math.round(change * 10) / 10
  return change > 0 ? `+${rounded}` : `${rounded}`
}

const playerNews = computed(() => {
  if (!selectedPlayer.value) return []
  const allNews = campaignStore.currentCampaign?.news ?? []
  return allNews
    .filter(n => n.player_id === selectedPlayer.value.id)
    .slice()
    .reverse()
})

// Handle attribute upgrade from PlayerDetailModal
async function handleUpgradeAttribute({ playerId, category, attribute, pool }) {
  audio.suppressClickSound() // affirmation on success instead of the generic tap
  try {
    const result = await teamStore.upgradePlayerAttribute(
      campaignId.value,
      playerId,
      category,
      attribute,
      pool
    )
    audio.affirm()
    toastStore.showSuccess(`${formatAttrName(attribute)} upgraded to ${Math.floor(result.new_value)}!`)
    // Refresh selected player with updated data
    selectedPlayer.value = roster.value.find(p => p.id === playerId)
  } catch (err) {
    toastStore.showError(err.response?.data?.message || err.message || 'Upgrade failed')
  }
}

// Handle upgrade-point purchase from PlayerDetailModal (tokens → +1 to pool)
async function handlePurchaseUpgradePoint({ playerId, pool, price }) {
  audio.suppressClickSound() // cha-ching instead of the generic tap (spends tokens)
  try {
    const result = await teamStore.purchaseUpgradePoint(campaignId.value, playerId, pool)
    audio.purchase()
    const label = pool === 'defense' ? 'defensive' : 'offensive'
    toastStore.showSuccess(`+1 ${label} upgrade point purchased for ${price.toLocaleString()} tokens`)
    selectedPlayer.value = roster.value.find(p => p.id === playerId)
  } catch (err) {
    toastStore.showError(err.response?.data?.message || err.message || 'Purchase failed')
  }
}

async function handleHoldCoachMeeting({ playerId, purchasedAction }) {
  // Buying an extra meeting spends tokens → cha-ching instead of the generic
  // tap. A free per-season meeting just gets the generic button tap.
  if (purchasedAction) audio.suppressClickSound()
  try {
    const res = await teamStore.holdCoachMeeting(
      campaignId.value, playerId, { purchasedAction }
    )
    const summary = purchasedAction
      ? `Bought a coach meeting · morale +30 (now ${res.morale})`
      : `Coach meeting held · morale +30 (now ${res.morale}) · ${res.actionsRemaining} actions left`
    if (purchasedAction) audio.purchase()
    toastStore.showSuccess(summary)
    // Refresh the selected player ref so the modal re-renders with the new
    // morale and the button's "X left" counter both update in the same tick.
    selectedPlayer.value = roster.value.find(p => p.id === playerId)
  } catch (err) {
    toastStore.showError(err.response?.data?.message || err.message || 'Failed to hold meeting')
  }
}

// Coach functions
const resigningCoach = ref(false)
const showResignModal = ref(false)

// Token cost to re-sign the current coach, scaled by their tier.
const resignCost = computed(() => (coach.value ? getCoachResignCost(coach.value) : 0))

// Coach action pools — meetings (morale) and trainings (badges/upgrades) are
// separate per-season budgets. Surfaced on the coach tab so the user can see
// what's left at a glance.
const coachMeetingsLeft = computed(() => coach.value?.actionsRemaining ?? 0)
const coachMeetingsTotal = computed(() => (coach.value ? getCoachActionBudget(coach.value) : 0))
const coachTrainsLeft = computed(() => coach.value?.trainActionsRemaining ?? 0)
const coachTrainsTotal = computed(() => (coach.value ? getCoachTrainBudget(coach.value) : 0))
const canAffordResign = computed(() => (authStore.profile?.tokens ?? 0) >= resignCost.value)

async function resignCoach() {
  if (resigningCoach.value) return
  resigningCoach.value = true
  try {
    const { cost } = await teamStore.resignCoach(campaignId.value)
    showResignModal.value = false
    toastStore.showSuccess(`Head coach re-signed for 2 more seasons (−${cost} tokens)`)
  } catch (err) {
    console.error('Failed to re-sign coach:', err)
    toastStore.showError(err.message || 'Failed to re-sign coach')
  } finally {
    resigningCoach.value = false
  }
}

// Expired-coach decision — stashed by the season-end contract processing
// when the head coach's deal ran out. Surfaced on the empty state so a user
// who dismissed the campaign-home popup can still re-sign their coach here
// at the stashed cost (instead of only being offered fresh hires).
const pendingCoachDecision = computed(() => {
  const pending = campaignStore.currentCampaign?.settings?.pendingCoachDecision
  if (!pending?.coach) return null
  if (pending.teamId && team.value?.id && pending.teamId !== team.value.id) return null
  return pending
})
const canAffordPendingResign = computed(() =>
  (authStore.profile?.tokens ?? 0) >= (pendingCoachDecision.value?.resignCost ?? 0))
const resigningPendingCoach = ref(false)

async function resignExpiredCoach() {
  if (resigningPendingCoach.value) return
  resigningPendingCoach.value = true
  try {
    const { cost } = await teamStore.resignPendingCoach(campaignId.value)
    // Mirror the cleared decision into the reactive campaign so the banner
    // swaps to the coach card without a refetch.
    if (campaignStore.currentCampaign?.settings) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        pendingCoachDecision: null,
      }
    }
    toastStore.showSuccess(t('Head coach re-signed for 2 more seasons (−{cost} tokens)', { cost }))
  } catch (err) {
    console.error('Failed to re-sign expired coach:', err)
    toastStore.showError(err.message || t('Failed to re-sign coach'))
  } finally {
    resigningPendingCoach.value = false
  }
}

function onCoachHired() {
  // teamStore.hireCoach already updated coach.value, team.coach, and
  // campaignStore.currentCampaign.settings.availableCoaches optimistically,
  // so no refetch needed — the modal's `candidates` computed re-reads the
  // updated pool on the next render.
}

// Refresh team store after a coach badge purchase so the coach card chip row
// and the badge store's "Owned" state both reflect the new badge immediately.
async function onCoachBadgePurchased() {
  try {
    await teamStore.fetchTeam(campaignId.value, { force: true })
  } catch (err) {
    console.error('Failed to refresh team after coach badge purchase:', err)
  }
}

</script>

<template>
  <div class="roster-view">
    <!-- Loading -->
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="md" />
    </div>

    <template v-else-if="team">
      <!-- Team Header - Same style as home page -->
      <div data-tour="gm-team-header">
        <TeamHeader :team="team" :team-overall="teamOverall" />
      </div>

      <!-- Tab Navigation -->
      <div class="tab-nav">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'team' }"
          data-tour="gm-tab-team"
          @click="activeTab = 'team'"
        >
          {{ $t('Lineup') }}
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'personnel' }"
          data-tour="gm-tab-personnel"
          @click="activeTab = 'personnel'"
        >
          {{ $t('Coach') }}
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'finances' }"
          data-tour="gm-tab-finances"
          @click="activeTab = 'finances'"
        >
          {{ $t('Roster') }}
          <span v-if="!isOffseason && expiringContractsCount > 0" class="tab-badge">{{ expiringContractsCount }}</span>
        </button>
        <button
          v-if="!tradeDeadlinePassed"
          class="tab-btn"
          :class="{ active: activeTab === 'trades' }"
          data-tour="gm-tab-trades"
          @click="activeTab = 'trades'"
        >
          {{ $t('Trades') }}
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'facilities' }"
          data-tour="gm-tab-facilities"
          @click="activeTab = 'facilities'"
        >
          {{ $t('Facilities') }}
          <span v-if="!hiredScout || !hiredTrainer || !hiredStaffTrainer || !hiredAnalyst" class="tab-badge tab-badge-warning">
            <AlertTriangle :size="10" />
          </span>
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'owner' }"
          data-tour="gm-tab-owner"
          @click="activeTab = 'owner'"
        >
          {{ $t('Owner') }}
        </button>
        <button
          class="tab-btn tab-btn-icon"
          :class="{ active: activeTab === 'schedule' }"
          data-tour="gm-tab-schedule"
          @click="activeTab = 'schedule'"
          :title="$t('Schedule')"
        >
          <Calendar :size="18" />
        </button>
      </div>

      <!-- Roster View -->
      <div v-if="activeTab === 'team'" class="roster-content" data-tour="gm-roster">
        <!-- Starters Section -->
        <div class="roster-list-header card-cosmic" data-tour="gm-starters">
          <h3 class="list-header-text">{{ $t('STARTERS') }}</h3>
          <div class="header-metrics">
            <span class="chemistry-chip" :style="{ '--chemistry-color': chemistryColor }">
              <component
                :is="chemistryIcon"
                :size="14"
                :stroke-width="2.25"
                class="chemistry-face-icon"
                :style="{ color: chemistryColor }"
                aria-hidden="true"
              />
              <span class="team-chemistry-value" :style="{ color: chemistryColor }">{{ teamChemistry }}%</span>
            </span>
            <!-- i18n-ignore -->
            <span class="header-metrics-divider">&middot;</span>
            <span class="total-minutes-value" data-tour="gm-minutes">{{ totalMinutes }} / 240</span>
            <button
              class="cpu-adjust-btn"
              data-tour="gm-cpu-auto"
              :disabled="cpuAdjusting || swappingLineup"
              :title="$t('Let the CPU pick the best 5 + spread minutes')"
              @click="cpuAdjustLineup"
            >
              <Zap :size="12" />
              <span>{{ cpuAdjusting ? $t('Adjusting…') : $t('Auto') }}</span>
            </button>
          </div>
        </div>
        <div class="players-grid">
          <template v-for="(slot, index) in starterSlots" :key="slot.position">
            <!-- Empty Slot -->
            <div v-if="!slot.player" class="player-card empty-slot">
              <div class="card-header">
                <div class="player-avatar empty">
                  <span class="empty-position">{{ slot.position }}</span>
                </div>
                <div class="player-main-info">
                  <h4 class="player-name empty-name">{{ $t('Empty Slot') }}</h4>
                  <div class="player-meta">
                    <span class="position-badge" :style="{ backgroundColor: getPositionColor(slot.position) }">
                      {{ slot.position }}
                    </span>
                    <span class="role-badge starter">{{ $t('STARTER') }}</span>
                  </div>
                </div>
                <div class="rating-container">
                  <button class="move-btn" @click.stop="toggleMoveDropdown(`starter-empty-${index}`)" :title="$t('Add player')">
                    <ArrowUpDown :size="14" />
                  </button>
                  <div class="empty-rating">--</div>
                </div>
              </div>
              <!-- Empty slot dropdown - show bench players who can play this position -->
              <Transition name="dropdown-slide">
                <div v-if="expandedMovePlayer === `starter-empty-${index}`" class="move-dropdown">
                  <div class="dropdown-header">{{ $t('Select player for {pos}', { pos: slot.position }) }}</div>
                  <div class="dropdown-list">
                    <button
                      v-for="candidate in getStarterSwapCandidates(slot.position)"
                      :key="candidate.id"
                      class="dropdown-item"
                      :class="{ injured: candidate.is_injured || candidate.isInjured }"
                      @click.stop="promoteToStarter(candidate, slot.position)"
                    >
                      <ArrowUpDown :size="14" class="dropdown-move-icon" />
                      <div class="dropdown-avatar">
                        <PlayerAvatar :player="candidate" :size="24" />
                      </div>
                      <span class="dropdown-name">{{ candidate.name }}</span>
                      <span class="dropdown-position-badge" :style="{ backgroundColor: getPositionColor(candidate.position) }">
                        {{ candidate.position }}
                      </span>
                      <span v-if="candidate.is_injured || candidate.isInjured" class="dropdown-injury">{{ $t('INJ') }}</span>
                      <StatBadge :value="candidate.overall_rating" size="sm" />
                    </button>
                    <div v-if="getStarterSwapCandidates(slot.position).length === 0" class="dropdown-empty">
                      {{ $t('No available players') }}
                    </div>
                  </div>
                </div>
              </Transition>
            </div>

            <!-- Filled Slot -->
            <div
              v-else
              class="player-card"
              :data-tour="index === 0 ? 'gm-starter-card' : null"
              :class="{
                injured: slot.player.is_injured || slot.player.isInjured,
                [getRatingClass(slot.player.overall_rating)]: true,
                'dropdown-open': expandedMovePlayer === `starter-${slot.player.id}`,
                'animate-slide-up': animatingPlayers[slot.player.id] === 'up',
                'animate-slide-down': animatingPlayers[slot.player.id] === 'down'
              }"
              @click="expandedMovePlayer !== `starter-${slot.player.id}` && openPlayerModal(slot.player)"
            >
              <div class="card-header">
                <div class="avatar-column">
                  <div class="player-avatar">
                    <PlayerAvatar :player="slot.player" :size="78" class="avatar-icon" />
                    <span
                      v-if="isTrainingInProgressFor(slot.player)"
                      class="train-countdown"
                      :title="$t('Training · {t} remaining', { t: formatTrainingCountdown(trainingMsLeftFor(slot.player)) })"
                    ><Dumbbell :size="10" /><span>{{ formatTrainingCountdown(trainingMsLeftFor(slot.player)) }}</span></span>
                    <span v-else-if="isTrainingReadyFor(slot.player)" class="train-ready-dot" :title="$t('Training ready to claim')"></span>
                    <span class="slot-position-label card-cosmic">{{ slot.position }}</span>
                  </div>
                </div>
                <div class="player-main-info">
                  <h4 class="player-name" :class="{ 'text-injured': slot.player.is_injured || slot.player.isInjured }">
                    {{ slot.player.name }}
                  </h4>
                  <div class="player-meta">
                    <div class="vitals-row">{{ $t('{h} · {w} lbs · {age} yrs', { h: slot.player.height || "6'6\"", w: formatWeight(slot.player.weight), age: slot.player.age || 25 }) }}</div>
                    <div class="position-badges">
                      <span
                        class="position-badge"
                        :style="{ backgroundColor: getPositionColor(slot.player.position) }"
                      >
                        {{ slot.player.position }}
                      </span>
                      <span
                        v-if="slot.player.secondary_position"
                        class="position-badge secondary"
                        :style="{ backgroundColor: getPositionColor(slot.player.secondary_position) }"
                      >
                        {{ slot.player.secondary_position }}
                      </span>
                    </div>
                    <span v-if="slot.player.is_injured || slot.player.isInjured" class="injury-tag">
                      {{ $t('Injured - {d}', { d: injuryDaysLabel(slot.player) }) }}
                    </span>
                  </div>
                  <!-- Minutes + Fatigue meters group (highlighted as a unit
                       by the GM lineup walkthrough so the tip can talk about
                       balancing rotation minutes against fatigue together). -->
                  <div class="min-fatigue-group" data-tour="gm-min-fatigue">
                    <!-- Minutes Meter -->
                    <div class="minutes-meter-row" @click.stop>
                      <label class="meter-label">MIN</label>
                      <div class="minutes-meter-bar"
                        :class="{ disabled: slot.player.is_injured || slot.player.isInjured }"
                        @mousedown="(e) => startMinutesDrag(e, slot.player.id, 8)"
                        @touchstart="(e) => startMinutesDrag(e, slot.player.id, 8)"
                      >
                        <div
                          class="minutes-meter-fill"
                          :style="{
                            width: (getPlayerMinutes(slot.player.id, 30) / 48 * 100) + '%',
                            backgroundColor: getMinutesMeterColor(getPlayerMinutes(slot.player.id, 30))
                          }"
                        >
                          <span class="minutes-thumb" :style="{ backgroundColor: getMinutesMeterColor(getPlayerMinutes(slot.player.id, 30)) }"></span>
                        </div>
                      </div>
                      <span class="minutes-pct-value" :style="{ color: getMinutesMeterColor(getPlayerMinutes(slot.player.id, 30)) }">{{ getPlayerMinutes(slot.player.id, 30) }}</span>
                    </div>
                    <!-- Fatigue Meter -->
                    <div class="fatigue-meter-row">
                      <label class="meter-label fatigue-label">{{ $t('FATIGUE') }}</label>
                      <div class="fatigue-meter-bar">
                        <div
                          class="fatigue-meter-fill"
                          :style="{
                            width: Math.round(slot.player.fatigue || 0) + '%',
                            backgroundColor: getFatigueColor(slot.player.fatigue || 0)
                          }"
                        ></div>
                      </div>
                      <span class="fatigue-value">{{ Math.round(slot.player.fatigue || 0) }}%</span>
                      <AlertTriangle v-if="isOverFatigued(slot.player.fatigue || 0)" :size="12" class="fatigue-warning-icon" />
                    </div>
                  </div>
                </div>
                <div class="rating-container">
                  <div class="ovr-badge-wrap">
                    <StatBadge :value="slot.player.overall_rating" size="md" />
                    <ChevronsUp
                      v-if="hasUpgradePoints(slot.player)"
                      :size="14"
                      class="ovr-upgrade-indicator"
                      :title="$t('Upgrade points available')"
                    />
                  </div>
                  <button class="move-btn" :class="{ active: expandedMovePlayer === `starter-${slot.player.id}` }" :data-tour="index === 0 ? 'gm-move-btn' : null" @click.stop="toggleMoveDropdown(`starter-${slot.player.id}`)" :title="$t('Adjust lineup')">
                    <ArrowUpDown :size="14" />
                  </button>
                </div>
              </div>

              <!-- Move Dropdown for Starters -->
              <Transition name="dropdown-slide">
                <div v-if="expandedMovePlayer === `starter-${slot.player.id}`" class="move-dropdown" :data-tour="index === 0 ? 'gm-move-dropdown' : null">
                  <div class="dropdown-header">{{ $t('Replace {name}', { name: slot.player.name }) }}</div>
                  <div class="dropdown-list">
                    <!-- Move to Bench option (empty-looking) -->
                    <button class="dropdown-item empty-option" @click.stop="moveToBench(index)">
                      <ArrowUpDown :size="14" class="dropdown-move-icon" />
                      <div class="dropdown-avatar empty">
                        <span class="empty-icon">−</span>
                      </div>
                      <span class="dropdown-name">{{ $t('Move to Bench') }}</span>
                      <span class="dropdown-hint">{{ $t('No replacement') }}</span>
                    </button>
                    <!-- Bench players who can play this position -->
                    <button
                      v-for="candidate in getStarterSwapCandidates(slot.position)"
                      :key="candidate.id"
                      class="dropdown-item"
                      :class="{ injured: candidate.is_injured || candidate.isInjured }"
                      @click.stop="swapPlayers(index, candidate.id)"
                    >
                      <ArrowUpDown :size="14" class="dropdown-move-icon" />
                      <div class="dropdown-avatar">
                        <PlayerAvatar :player="candidate" :size="24" />
                      </div>
                      <div class="dropdown-name-row">
                        <span class="dropdown-name">{{ candidate.name }}</span>
                        <span class="dropdown-fatigue" :style="{ color: getFatigueColor(candidate.fatigue || 0) }">{{ Math.round(candidate.fatigue || 0) }}%</span>
                      </div>
                      <span class="dropdown-position-badge" :style="{ backgroundColor: getPositionColor(candidate.position) }">
                        {{ candidate.position }}
                      </span>
                      <span v-if="candidate.is_injured || candidate.isInjured" class="dropdown-injury">{{ $t('INJ') }}</span>
                      <StatBadge :value="candidate.overall_rating" size="sm" />
                    </button>
                  </div>
                </div>
              </Transition>

              <!-- Card body only shows when dropdown is closed -->
              <div v-if="expandedMovePlayer !== `starter-${slot.player.id}`" class="card-body">
                <!-- Season Stats (compact) -->
                <div v-if="slot.player.season_stats" class="stats-inline">
                  <!-- i18n-ignore -->
                  <span class="stat-inline"><span class="stat-label">PPG</span><span class="stat-val">{{ slot.player.season_stats.ppg }}</span></span>
                  <!-- i18n-ignore -->
                  <span class="stat-inline"><span class="stat-label">RPG</span><span class="stat-val">{{ slot.player.season_stats.rpg }}</span></span>
                  <!-- i18n-ignore -->
                  <span class="stat-inline"><span class="stat-label">APG</span><span class="stat-val">{{ slot.player.season_stats.apg }}</span></span>
                  <!-- i18n-ignore -->
                  <span class="stat-inline"><span class="stat-label">SPG</span><span class="stat-val">{{ slot.player.season_stats.spg }}</span></span>
                  <!-- i18n-ignore -->
                  <span class="stat-inline"><span class="stat-label">BPG</span><span class="stat-val">{{ slot.player.season_stats.bpg }}</span></span>
                  <span class="stat-inline"><span class="stat-label">FG%</span><span class="stat-val">{{ slot.player.season_stats.fg_pct }}</span></span>
                  <span class="stat-inline"><span class="stat-label">3P%</span><span class="stat-val">{{ slot.player.season_stats.three_pct }}</span></span>
                </div>

                <!-- Badges -->
                <div v-if="slot.player.badges?.length > 0" class="badges-row">
                  <div
                    v-for="badge in getTopBadges(slot.player.badges, slot.player)"
                    :key="badge.id"
                    class="badge-item"
                    :title="getStarterBadgeSynergyTooltip(slot.player, badge)"
                  >
                    <span
                      class="badge-dot"
                      :class="{ 'synergy-active': isStarterBadgeActivated(slot.player, badge.id) }"
                      :style="{ backgroundColor: getBadgeLevelColor(badge.level) }"
                    />
                    <span class="badge-name" :class="{ 'synergy-active-text': isStarterBadgeActivated(slot.player, badge.id) }">{{ $tDynamic(formatBadgeName(badge)) }}</span>
                  </div>
                  <span v-if="slot.player.badges.length > 3" class="badge-more-count">+{{ slot.player.badges.length - 3 }}</span>
                </div>
                <div v-if="getPlayerDuoPartner(slot.player)" class="dynamic-duo-badge">
                  <Users :size="12" />
                  <span>{{ $t('Dynamic Duo w/ {name}', { name: getPlayerDuoPartner(slot.player) }) }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Bench Section -->
        <div class="roster-list-header card-cosmic" data-tour="gm-bench">
          <h3 class="list-header-text">{{ $t('BENCH') }}</h3>
        </div>
        <TransitionGroup name="bench-reorder" tag="div" class="players-grid">
          <!-- Bench Players -->
          <div
            v-for="player in displayBenchPlayers"
            :key="player.id"
            class="player-card"
            :class="{
              injured: player.is_injured || player.isInjured,
              [getRatingClass(player.overall_rating)]: true,
              'dropdown-open': expandedMovePlayer === `bench-${player.id}`,
              'animate-slide-up': animatingPlayers[player.id] === 'up',
              'animate-slide-down': animatingPlayers[player.id] === 'down'
            }"
            @click="expandedMovePlayer !== `bench-${player.id}` && openPlayerModal(player)"
          >
            <div class="card-header">
              <div class="avatar-column">
                <div class="player-avatar">
                  <PlayerAvatar :player="player" :size="78" class="avatar-icon" />
                  <span
                    v-if="isTrainingInProgressFor(player)"
                    class="train-countdown"
                    :title="$t('Training · {t} remaining', { t: formatTrainingCountdown(trainingMsLeftFor(player)) })"
                  ><Dumbbell :size="10" /><span>{{ formatTrainingCountdown(trainingMsLeftFor(player)) }}</span></span>
                  <span v-else-if="isTrainingReadyFor(player)" class="train-ready-dot" :title="$t('Training ready to claim')"></span>
                  <span class="slot-position-label bench-label">{{ $t('BENCH') }}</span>
                </div>
              </div>
              <div class="player-main-info">
                <h4 class="player-name" :class="{ 'text-injured': player.is_injured || player.isInjured }">
                  {{ player.name }}
                </h4>
                <div class="player-meta">
                  <div class="vitals-row">{{ $t('{h} · {w} lbs · {age} yrs', { h: player.height || "6'6\"", w: formatWeight(player.weight), age: player.age || 25 }) }}</div>
                  <div class="position-badges">
                    <span class="position-badge" :style="{ backgroundColor: getPositionColor(player.position) }">
                      {{ player.position }}
                    </span>
                    <span v-if="player.secondary_position" class="position-badge secondary" :style="{ backgroundColor: getPositionColor(player.secondary_position) }">
                      {{ player.secondary_position }}
                    </span>
                  </div>
                  <span v-if="player.is_injured || player.isInjured" class="injury-tag">
                    {{ $t('Injured - {d}', { d: injuryDaysLabel(player) }) }}
                  </span>
                </div>
                <!-- Minutes Meter -->
                <div class="minutes-meter-row" @click.stop>
                  <label class="meter-label">MIN</label>
                  <div class="minutes-meter-bar"
                    :class="{ disabled: player.is_injured || player.isInjured }"
                    @mousedown="(e) => startMinutesDrag(e, player.id, 0)"
                    @touchstart="(e) => startMinutesDrag(e, player.id, 0)"
                  >
                    <div
                      class="minutes-meter-fill"
                      :style="{
                        width: (getPlayerMinutes(player.id, 0) / 48 * 100) + '%',
                        backgroundColor: getMinutesMeterColor(getPlayerMinutes(player.id, 0))
                      }"
                    >
                      <span class="minutes-thumb" :style="{ backgroundColor: getMinutesMeterColor(getPlayerMinutes(player.id, 0)) }"></span>
                    </div>
                  </div>
                  <span class="minutes-pct-value" :style="{ color: getMinutesMeterColor(getPlayerMinutes(player.id, 0)) }">{{ getPlayerMinutes(player.id, 0) === 0 ? 'DNP' : getPlayerMinutes(player.id, 0) }}</span>
                </div>
                <!-- Fatigue Meter -->
                <div class="fatigue-meter-row">
                  <label class="meter-label fatigue-label">{{ $t('FATIGUE') }}</label>
                  <div class="fatigue-meter-bar">
                    <div
                      class="fatigue-meter-fill"
                      :style="{
                        width: Math.round(player.fatigue || 0) + '%',
                        backgroundColor: getFatigueColor(player.fatigue || 0)
                      }"
                    ></div>
                  </div>
                  <span class="fatigue-value">{{ Math.round(player.fatigue || 0) }}%</span>
                  <AlertTriangle v-if="isOverFatigued(player.fatigue || 0)" :size="12" class="fatigue-warning-icon" />
                </div>
              </div>
              <div class="rating-container">
                <div class="ovr-badge-wrap">
                  <StatBadge :value="player.overall_rating" size="md" />
                  <ChevronsUp
                    v-if="hasUpgradePoints(player)"
                    :size="14"
                    class="ovr-upgrade-indicator"
                    :title="$t('Upgrade points available')"
                  />
                </div>
                <button
                  class="move-btn"
                  :class="{ active: expandedMovePlayer === `bench-${player.id}` }"
                  :disabled="player.is_injured || player.isInjured"
                  :title="(player.is_injured || player.isInjured) ? $t('Injured players cannot be moved into the starting lineup') : $t('Adjust lineup')"
                  @click.stop="toggleMoveDropdown(`bench-${player.id}`)"
                >
                  <ArrowUpDown :size="14" />
                </button>
              </div>
            </div>

            <!-- Move Dropdown for Bench Players -->
            <Transition name="dropdown-slide">
              <div v-if="expandedMovePlayer === `bench-${player.id}`" class="move-dropdown">
                <div class="dropdown-header">{{ $t('Move to starting lineup') }}</div>
                <div class="dropdown-list">
                  <!-- Empty starter slots this player can fill -->
                  <button
                    v-for="emptySlot in getEmptySlotCandidates(player)"
                    :key="`empty-${emptySlot.position}`"
                    class="dropdown-item empty-slot-option"
                    @click.stop="promoteToStarter(player, emptySlot.position)"
                  >
                    <ArrowUpDown :size="14" class="dropdown-move-icon" />
                    <div class="dropdown-avatar empty">
                      <span class="empty-icon">+</span>
                    </div>
                    <span class="dropdown-name">{{ $t('Fill Empty Slot') }}</span>
                    <span class="dropdown-position-badge" :style="{ backgroundColor: getPositionColor(emptySlot.position) }">
                      {{ emptySlot.position }}
                    </span>
                  </button>
                  <!-- Starters this player can replace (based on position) -->
                  <button
                    v-for="candidate in getBenchSwapCandidates(player)"
                    :key="candidate.id"
                    class="dropdown-item"
                    :class="{ injured: candidate.is_injured || candidate.isInjured }"
                    @click.stop="promoteToStarter(player, candidate.slotPosition)"
                  >
                    <ArrowUpDown :size="14" class="dropdown-move-icon" />
                    <div class="dropdown-avatar">
                      <PlayerAvatar :player="candidate" :size="24" />
                    </div>
                    <div class="dropdown-name-row">
                      <span class="dropdown-name">{{ candidate.name }}</span>
                      <span class="dropdown-fatigue" :style="{ color: getFatigueColor(candidate.fatigue || 0) }">{{ Math.round(candidate.fatigue || 0) }}%</span>
                    </div>
                    <span class="dropdown-position-badge" :style="{ backgroundColor: getPositionColor(candidate.position) }">
                      {{ candidate.slotPosition }}
                    </span>
                    <span v-if="candidate.is_injured || candidate.isInjured" class="dropdown-injury">{{ $t('INJ') }}</span>
                    <StatBadge :value="candidate.overall_rating" size="sm" />
                  </button>
                  <div v-if="getBenchSwapCandidates(player).length === 0 && getEmptySlotCandidates(player).length === 0" class="dropdown-empty">
                    {{ $t('No compatible positions') }}
                  </div>
                </div>
              </div>
            </Transition>

            <!-- Card body only shows when dropdown is closed -->
            <div v-if="expandedMovePlayer !== `bench-${player.id}`" class="card-body">
              <!-- Season Stats (compact) -->
              <div v-if="player.season_stats" class="stats-inline">
                <!-- i18n-ignore -->
                <span class="stat-inline"><span class="stat-label">PPG</span><span class="stat-val">{{ player.season_stats.ppg }}</span></span>
                <!-- i18n-ignore -->
                <span class="stat-inline"><span class="stat-label">RPG</span><span class="stat-val">{{ player.season_stats.rpg }}</span></span>
                <!-- i18n-ignore -->
                <span class="stat-inline"><span class="stat-label">APG</span><span class="stat-val">{{ player.season_stats.apg }}</span></span>
                <!-- i18n-ignore -->
                <span class="stat-inline"><span class="stat-label">SPG</span><span class="stat-val">{{ player.season_stats.spg }}</span></span>
                <!-- i18n-ignore -->
                <span class="stat-inline"><span class="stat-label">BPG</span><span class="stat-val">{{ player.season_stats.bpg }}</span></span>
                <span class="stat-inline"><span class="stat-label">FG%</span><span class="stat-val">{{ player.season_stats.fg_pct }}</span></span>
                <span class="stat-inline"><span class="stat-label">3P%</span><span class="stat-val">{{ player.season_stats.three_pct }}</span></span>
              </div>

              <!-- Badges -->
              <div v-if="player.badges?.length > 0" class="badges-row">
                <div
                  v-for="badge in getTopBadges(player.badges)"
                  :key="badge.id"
                  class="badge-item"
                  :title="`${formatBadgeName(badge)} (${badge.level})`"
                >
                  <span
                    class="badge-dot"
                    :style="{ backgroundColor: getBadgeLevelColor(badge.level) }"
                  />
                  <span class="badge-name">{{ $tDynamic(formatBadgeName(badge)) }}</span>
                </div>
                <span v-if="player.badges.length > 3" class="badge-more-count">+{{ player.badges.length - 3 }}</span>
              </div>
            </div>
          </div>

          <!-- Empty Roster Slots -->
          <div v-for="n in availableRosterSlots" :key="`empty-roster-${n}`" class="player-card empty-slot roster-slot">
            <div class="card-header">
              <div class="player-avatar empty">
                <span class="empty-icon">+</span>
              </div>
              <div class="player-main-info">
                <h4 class="player-name empty-name">{{ $t('Empty Roster Slot') }}</h4>
                <div class="player-meta">
                  <span class="empty-hint">{{ $t('{a} of {b} available', { a: 15 - roster.length - n + 1, b: availableRosterSlots }) }}</span>
                </div>
              </div>
              <div class="rating-container">
                <div class="empty-rating">--</div>
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- Coach View (tab id stays 'personnel' for deep links / tour keys;
           the four facility staff moved into the Facilities tab) -->
      <div v-else-if="activeTab === 'personnel'" class="coach-content">
        <!-- Coach content -->
        <div>

        <!-- No coach signed: empty state -->
        <GlassCard v-if="!coach" padding="lg" :hoverable="false" data-tour="gm-personnel-coach">
          <div class="coach-empty-state">
            <div class="coach-empty-icon">
              <User :size="40" />
            </div>
            <template v-if="pendingCoachDecision">
              <h3 class="empty-title">{{ $t("Your Head Coach's Contract Is Up") }}</h3>
              <p class="empty-desc">
                {{ $t("{name}'s deal has expired. Re-sign him for 2 more seasons, or hire a replacement from the free-agent pool. A signed coach is required before you can start a new season.", { name: pendingCoachDecision.coach.name }) }}
              </p>
              <div class="coach-expired-actions">
                <button
                  class="btn-resign-coach"
                  :disabled="resigningPendingCoach || !canAffordPendingResign"
                  @click="resignExpiredCoach"
                >
                  {{ canAffordPendingResign ? $t('Re-sign {name} · {cost}', { name: pendingCoachDecision.coach.name, cost: pendingCoachDecision.resignCost }) : $t('Need {n} tokens to re-sign', { n: pendingCoachDecision.resignCost }) }} <Coins :size="12" class="btn-coin-icon" />
                </button>
                <button class="btn-browse-coaches" @click="showHireCoachModal = true">
                  {{ $t('Browse Coaches') }}
                </button>
              </div>
            </template>
            <template v-else>
              <h3 class="empty-title">{{ $t('No Head Coach Signed') }}</h3>
              <p class="empty-desc">
                {{ $t('Hire a head coach from the free-agent pool. Coaches affect scheme effectiveness, player development, and clutch-time decisions. A signed coach is required before you can start a new season.') }}
              </p>
              <button class="btn-browse-coaches" @click="showHireCoachModal = true">
                {{ $t('Browse Coaches') }}
              </button>
            </template>
          </div>
        </GlassCard>

        <!-- Coach Info Card (only one of the two cards renders, so the
             gm-personnel-coach tour anchor is never duplicated) -->
        <GlassCard v-else padding="lg" :hoverable="false" data-tour="gm-personnel-coach">
          <h3 class="h4 mb-4">{{ $t('Head Coach') }}</h3>
          <div class="coach-header">
            <div class="coach-avatar-wrap">
              <CoachAvatar :coach="coach" :size="84" :campaign-id="campaignId" :editable="true" />
            </div>
            <div class="coach-info">
              <p class="coach-name">{{ coach.name }}</p>
              <span class="rating-label">{{ $t('Overall Rating') }}</span>
              <div v-if="coach.contractYearsRemaining != null" class="coach-contract-line">
                {{ coach.contractYearsRemaining !== 1 ? $t('{n} Seasons Remaining', { n: coach.contractYearsRemaining }) : $t('{n} Season Remaining', { n: coach.contractYearsRemaining }) }}<template v-if="coach.hiredSeason"> · {{ $t('Hired Season {s}', { s: coach.hiredSeason }) }}</template>
              </div>
            </div>
            <div class="coach-header-actions">
              <StatBadge :value="coach.overall_rating" size="lg" />
            </div>
          </div>

          <!-- Coach Actions -->
          <div class="coach-actions-row">
            <button
              v-if="(coach.contractYearsRemaining ?? coach.contract_years_remaining ?? 0) <= 1"
              class="btn-resign-coach"
              :disabled="resigningCoach"
              @click="showResignModal = true"
            >
              {{ $t('Re-sign (2 yrs) · {cost}', { cost: resignCost }) }} <Coins :size="12" class="btn-coin-icon" />
            </button>
            <button class="btn-view-candidates" data-tour="gm-coach-candidates" @click="showHireCoachModal = true">
              {{ $t('View Candidates') }}
            </button>
          </div>

          <!-- Coach Badges -->
          <div class="coach-badges-section mt-4" data-tour="gm-coach-badges">
            <h4 class="section-title">{{ $t('Coach Badges') }}</h4>
            <div v-if="ownedCoachBadges.length > 0" class="coach-badges-row">
              <div
                v-for="badge in ownedCoachBadges"
                :key="badge.id"
                class="coach-badge-chip"
                :title="`${badge.description} (${badge.level.toUpperCase()})`"
              >
                <Star :size="12" :style="{ color: COACH_BADGE_TIER_COLORS[badge.level] || 'var(--color-text-secondary)' }" :fill="COACH_BADGE_TIER_COLORS[badge.level] || 'transparent'" />
                <span class="coach-badge-chip-name">{{ $tDynamic(badge.name) }}</span>
              </div>
            </div>
            <button class="coach-badge-store-btn" data-tour="gm-coach-badge-store" @click="showCoachBadgeStore = true">
              <Star :size="14" />
              {{ $t('Shop Badges') }}
            </button>
          </div>

          <!-- Career Stats -->
          <div v-if="coachCareerStats" class="career-stats-section mt-4">
            <h4 class="section-title">{{ $t('Career Record') }}</h4>
            <div class="career-stats-grid">
              <div class="career-stat-box">
                <span class="career-stat-value">{{ coachCareerStats.wins }}-{{ coachCareerStats.losses }}</span>
                <span class="career-stat-label">{{ $t('Regular Season') }}</span>
                <span class="career-stat-pct">{{ coachCareerStats.win_pct }}%</span>
              </div>
              <div class="career-stat-box">
                <span class="career-stat-value">{{ coachCareerStats.playoff_wins }}-{{ coachCareerStats.playoff_losses }}</span>
                <span class="career-stat-label">{{ $t('Playoffs') }}</span>
                <span class="career-stat-pct">{{ coachCareerStats.playoff_win_pct }}%</span>
              </div>
              <div class="career-stat-box highlight">
                <span class="career-stat-value">{{ coachCareerStats.championships }}</span>
                <span class="career-stat-label">{{ $t('Championships') }}</span>
              </div>
              <div class="career-stat-box">
                <span class="career-stat-value">{{ coachCareerStats.seasons_coached }}</span>
                <span class="career-stat-label">{{ $t('Seasons') }}</span>
              </div>
            </div>

            <!-- Awards row -->
            <div v-if="coachCareerStats.conference_titles > 0 || coachCareerStats.coach_of_year_awards > 0" class="awards-row mt-3">
              <span v-if="coachCareerStats.conference_titles > 0" class="award-badge">
                {{ $t('{n}x Conference Champion', { n: coachCareerStats.conference_titles }) }}
              </span>
              <span v-if="coachCareerStats.coach_of_year_awards > 0" class="award-badge gold">
                {{ $t('{n}x Coach of the Year', { n: coachCareerStats.coach_of_year_awards }) }}
              </span>
            </div>
          </div>

          <!-- Coach Attributes -->
          <div v-if="coach.attributes" class="coach-attributes mt-4" data-tour="gm-coach-skills">
            <h4 class="section-title">{{ $t('Coaching Skills') }}</h4>
            <div class="attr-grid">
              <div v-for="(value, key) in coach.attributes" :key="key" class="coach-attr-item">
                <span class="attr-label">{{ $tDynamic(formatAttrName(key)) }}</span>
                <div class="attr-bar-mini">
                  <div class="attr-fill" :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }" />
                </div>
                <span class="attr-val" :style="{ color: getAttrColor(value) }">{{ value }}</span>
              </div>
            </div>
          </div>

          <!-- Coach Actions — per-season pools + what each one does -->
          <div class="coach-actions-info mt-4" data-tour="gm-coach-actions">
            <h4 class="section-title">{{ $t('Coach Actions') }}</h4>
            <div class="coach-action-list">
              <div class="coach-action-item">
                <div class="coach-action-icon"><MessagesSquare :size="16" /></div>
                <div class="coach-action-body">
                  <div class="coach-action-head">
                    <span class="coach-action-name">{{ $t('Coach Meetings') }}</span>
                    <span class="coach-action-count" :class="{ depleted: coachMeetingsLeft === 0 }">
                      {{ coachMeetingsLeft }}<span class="coach-action-total">/{{ coachMeetingsTotal }}</span>
                    </span>
                  </div>
                  <p class="coach-action-desc">
                    {{ $t("Hold a 1-on-1 to lift a player's morale. Extras cost {n} tokens.", { n: COACH_MEETING_EXTRA_COST }) }}
                  </p>
                </div>
              </div>
              <div class="coach-action-item">
                <div class="coach-action-icon"><Dumbbell :size="16" /></div>
                <div class="coach-action-body">
                  <div class="coach-action-head">
                    <span class="coach-action-name">{{ $t('Player Trainings') }}</span>
                    <span class="coach-action-count" :class="{ depleted: coachTrainsLeft === 0 }">
                      {{ coachTrainsLeft }}<span class="coach-action-total">/{{ coachTrainsTotal }}</span>
                    </span>
                  </div>
                  <p class="coach-action-desc">
                    {{ $t('Run a session to develop a player — earns a new badge or attribute upgrade.') }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        <!-- Strategy Settings (Tabbed) -->
        <GlassCard padding="lg" :hoverable="false" class="mt-6" data-tour="gm-coach-schemes">
          <div class="coach-tabs">
            <button
              class="coach-tab-btn"
              :class="{ active: activeCoachTab === 'offensive' }"
              @click="activeCoachTab = 'offensive'"
            >{{ $t('Offensive') }}</button>
            <button
              class="coach-tab-btn"
              :class="{ active: activeCoachTab === 'defensive' }"
              @click="activeCoachTab = 'defensive'"
            >{{ $t('Defensive') }}</button>
            <button
              class="coach-tab-btn"
              :class="{ active: activeCoachTab === 'substitution' }"
              @click="activeCoachTab = 'substitution'"
            >{{ $t('Substitution') }}</button>
          </div>

          <!-- Offensive Scheme Tab -->
          <div v-if="activeCoachTab === 'offensive'">
            <div class="flex items-center justify-between mb-4">
              <h3 class="h4">{{ $t('Offensive Scheme') }}</h3>
              <div v-if="teamStore.recommendedScheme" class="recommended-badge">
                {{ $t('Recommended: {name}', { name: $tDynamic(teamStore.coachingSchemes?.offensive?.[teamStore.recommendedScheme]?.name) }) }}
              </div>
            </div>

            <p class="text-secondary text-sm mb-6">
              {{ $t("Choose an offensive scheme that fits your roster's strengths. This affects play selection and tempo during games.") }}
            </p>

            <div v-if="teamStore.loading && !schemesFetched" class="flex justify-center py-8">
              <LoadingSpinner size="md" />
            </div>

            <div v-else class="schemes-grid">
              <div
                v-for="(scheme, schemeId, schemeIdx) in teamStore.coachingSchemes?.offensive"
                :key="schemeId"
                class="scheme-card"
                :class="{
                  active: (selectedScheme || team?.coaching_scheme?.offensive || team?.coaching_scheme) === schemeId,
                  recommended: teamStore.recommendedScheme === schemeId
                }"
                :data-tour="schemeIdx === 0 ? 'gm-coach-scheme-card' : null"
                @click="updateOffensiveScheme(schemeId)"
              >
                <div class="scheme-header">
                  <span class="scheme-name">{{ $tDynamic(scheme.name) }}</span>
                  <span v-if="provenScheme === schemeId" class="rec-tag proven-tag" :title="$t('Your best-performing play set this season')">{{ $t('Season Proven') }}</span>
                  <span v-if="teamStore.recommendedScheme === schemeId" class="rec-tag">{{ $t('Best Fit') }}</span>
                </div>

                <p class="scheme-desc">{{ $tDynamic(scheme.description) }}</p>

                <div class="scheme-details">
                  <div class="scheme-pace">
                    <span class="detail-label">{{ $t('Pace') }}</span>
                    <span class="detail-value" :class="scheme.pace">{{ $tDynamic(scheme.pace?.replace('_', ' ')) }}</span>
                  </div>
                  <div class="scheme-effectiveness">
                    <span class="detail-label">{{ $t('Fit') }}</span>
                    <!-- Exact Fit % unlocks at Analytics Lv2; below that only rough tiers -->
                    <span v-if="analyticsLevel >= 2" class="detail-value" :class="getEffectivenessClass(scheme.effectiveness)">
                      {{ scheme.effectiveness ?? '—' }}%
                    </span>
                    <span v-else class="detail-value" :class="getEffectivenessClass(scheme.effectiveness)">
                      {{ $tDynamic(fitTierLabel(scheme.effectiveness)) }}
                    </span>
                  </div>
                </div>

                <div class="scheme-traits">
                  <div class="trait-section">
                    <span class="trait-label">{{ $t('Strengths') }}</span>
                    <div class="trait-tags">
                      <span v-for="str in scheme.strengths" :key="str" class="trait-tag positive">{{ $tDynamic(str) }}</span>
                    </div>
                  </div>
                  <div class="trait-section">
                    <span class="trait-label">{{ $t('Weaknesses') }}</span>
                    <div class="trait-tags">
                      <span v-for="weak in scheme.weaknesses" :key="weak" class="trait-tag negative">{{ $tDynamic(weak) }}</span>
                    </div>
                  </div>
                </div>

                <!-- Playbook preview — view this scheme's plays as looping animations -->
                <div class="playbook-section" @click.stop>
                  <button
                    type="button"
                    class="playbook-toggle"
                    @click="togglePlaybook(schemeId)"
                  >
                    {{ expandedPlaybookScheme === schemeId ? $t('Hide plays') : $t('View plays') }}
                  </button>
                  <div v-if="expandedPlaybookScheme === schemeId" class="playbook-body">
                    <select
                      :value="selectedPlayId[schemeId] || defaultPlayId(schemeId)"
                      class="playbook-select"
                      @change="selectedPlayId = { ...selectedPlayId, [schemeId]: $event.target.value }"
                    >
                      <optgroup
                        v-for="grp in playbookFor(schemeId)"
                        :key="grp.category"
                        :label="$tDynamic(categoryLabel(grp.category))"
                      >
                        <option v-for="pl in grp.plays" :key="pl.id" :value="pl.id">
                          {{ $tDynamic(pl.name) }}
                        </option>
                      </optgroup>
                    </select>
                    <!-- Analytics Lv4: this play's season efficiency (hidden until data exists) -->
                    <div v-if="analyticsLevel >= 4 && seasonStatsForSelectedPlay(schemeId)" class="play-season-chips">
                      <span class="play-chip">{{ $t('{n} poss', { n: seasonStatsForSelectedPlay(schemeId).poss }) }}</span>
                      <!-- i18n-ignore -->
                      <span class="play-chip">PPP {{ seasonStatsForSelectedPlay(schemeId).ppp }}</span>
                      <!-- i18n-ignore -->
                      <span v-if="seasonStatsForSelectedPlay(schemeId).two != null" class="play-chip">2PT {{ seasonStatsForSelectedPlay(schemeId).two }}%</span>
                      <!-- i18n-ignore -->
                      <span v-if="seasonStatsForSelectedPlay(schemeId).three != null" class="play-chip">3PT {{ seasonStatsForSelectedPlay(schemeId).three }}%</span>
                    </div>
                    <!-- Async component: chunk loads on first expand; mounts only
                         while expanded; rAF pauses offscreen / stops on collapse -->
                    <PlayAnimationPreview :play="selectedPlayObj(schemeId)" />
                  </div>
                </div>

                <div v-if="updatingScheme && (selectedScheme || team?.coaching_scheme?.offensive || team?.coaching_scheme) === schemeId" class="scheme-loading">
                  <LoadingSpinner size="sm" />
                </div>
              </div>
            </div>

            <!-- Analytics Lv3: own-team season play analytics (blur-locked below) -->
            <div class="season-analytics-section">
              <PlayAnalyticsPanel
                :title="$t('Season Play Analytics — Your Team')"
                :analytics="teamStore.team?.playAnalytics ?? null"
                :locked="analyticsLevel < 3"
                :locked-message="$t('Upgrade your Analytics Facility to Level 3 to unlock season play analytics.')"
                :default-to-top-category="true"
              />
            </div>
          </div>

          <!-- Defensive Scheme Tab -->
          <div v-else-if="activeCoachTab === 'defensive'">
            <div class="flex items-center justify-between mb-4">
              <h3 class="h4">{{ $t('Defensive Scheme') }}</h3>
              <div v-if="teamStore.recommendedDefensiveScheme" class="recommended-badge">
                {{ $t('Recommended: {name}', { name: $tDynamic(teamStore.coachingSchemes?.defensive?.[teamStore.recommendedDefensiveScheme]?.name) }) }}
              </div>
            </div>

            <p class="text-secondary text-sm mb-6">
              {{ $t("Select your team's defensive strategy. This determines how your players guard opponents and react to plays.") }}
            </p>

            <div v-if="teamStore.loading && !schemesFetched" class="flex justify-center py-8">
              <LoadingSpinner size="md" />
            </div>

            <div v-else class="schemes-grid">
              <div
                v-for="(scheme, schemeId) in defensiveSchemes"
                :key="schemeId"
                class="scheme-card defensive"
                :class="{
                  active: (selectedDefensiveScheme || team?.coaching_scheme?.defensive || 'man') === schemeId,
                  recommended: teamStore.recommendedDefensiveScheme === schemeId
                }"
                @click="updateDefensiveScheme(schemeId)"
              >
                <div class="scheme-header">
                  <span class="scheme-name">{{ $tDynamic(scheme.name) }}</span>
                  <span v-if="teamStore.recommendedDefensiveScheme === schemeId" class="rec-tag">{{ $t('Best Fit') }}</span>
                  <span v-else class="scheme-type-tag" :class="scheme.type">{{ $tDynamic(scheme.type) }}</span>
                </div>

                <p class="scheme-desc">{{ $tDynamic(scheme.description) }}</p>

                <div class="scheme-details">
                  <div class="scheme-effectiveness">
                    <span class="detail-label">{{ $t('Fit') }}</span>
                    <!-- Exact Fit % unlocks at Analytics Lv2; below that only rough tiers -->
                    <span v-if="analyticsLevel >= 2" class="detail-value" :class="getEffectivenessClass(teamStore.coachingSchemes?.defensive?.[schemeId]?.effectiveness)">
                      {{ teamStore.coachingSchemes?.defensive?.[schemeId]?.effectiveness ?? '—' }}%
                    </span>
                    <span v-else class="detail-value" :class="getEffectivenessClass(teamStore.coachingSchemes?.defensive?.[schemeId]?.effectiveness)">
                      {{ $tDynamic(fitTierLabel(teamStore.coachingSchemes?.defensive?.[schemeId]?.effectiveness)) }}
                    </span>
                  </div>
                </div>

                <div class="scheme-traits">
                  <div class="trait-section">
                    <span class="trait-label">{{ $t('Strengths') }}</span>
                    <div class="trait-tags">
                      <span v-for="str in scheme.strengths" :key="str" class="trait-tag positive">{{ $tDynamic(str) }}</span>
                    </div>
                  </div>
                  <div class="trait-section">
                    <span class="trait-label">{{ $t('Weaknesses') }}</span>
                    <div class="trait-tags">
                      <span v-for="weak in scheme.weaknesses" :key="weak" class="trait-tag negative">{{ $tDynamic(weak) }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="updatingScheme && (selectedDefensiveScheme || team?.coaching_scheme?.defensive || 'man') === schemeId" class="scheme-loading">
                  <LoadingSpinner size="sm" />
                </div>
              </div>
            </div>
          </div>

          <!-- Substitution Strategy Tab -->
          <div v-else-if="activeCoachTab === 'substitution'">
            <div class="flex items-center justify-between mb-4">
              <h3 class="h4">{{ $t('Substitution Strategy') }}</h3>
            </div>

            <p class="text-secondary text-sm mb-6">
              {{ $t('Control how your team rotates players during simulated games. This affects how minutes are distributed and when substitutions happen.') }}
            </p>

            <div v-if="teamStore.loading && !schemesFetched" class="flex justify-center py-8">
              <LoadingSpinner size="md" />
            </div>

            <div v-else class="schemes-grid">
              <div
                v-for="(strategy, strategyId) in teamStore.substitutionStrategies"
                :key="strategyId"
                class="scheme-card substitution"
                :class="{
                  active: selectedSubStrategy === strategyId
                }"
                @click="updateSubstitutionStrategy(strategyId)"
              >
                <div class="scheme-header">
                  <span class="scheme-name">{{ $tDynamic(strategy.name) }}</span>
                  <span class="scheme-type-tag" :class="strategy.type">{{ $tDynamic(strategy.type) }}</span>
                </div>

                <p class="scheme-desc">{{ $tDynamic(strategy.description) }}</p>

                <div class="scheme-details">
                  <div class="scheme-pace">
                    <span class="detail-label">{{ $t('Depth') }}</span>
                    <span class="detail-value">{{ $tDynamic(strategy.rotation_depth) }}</span>
                  </div>
                </div>

                <div class="scheme-traits">
                  <div class="trait-section">
                    <span class="trait-label">{{ $t('Strengths') }}</span>
                    <div class="trait-tags">
                      <span v-for="str in strategy.strengths" :key="str" class="trait-tag positive">{{ $tDynamic(str) }}</span>
                    </div>
                  </div>
                  <div class="trait-section">
                    <span class="trait-label">{{ $t('Weaknesses') }}</span>
                    <div class="trait-tags">
                      <span v-for="weak in strategy.weaknesses" :key="weak" class="trait-tag negative">{{ $tDynamic(weak) }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="updatingScheme && selectedSubStrategy === strategyId" class="scheme-loading">
                  <LoadingSpinner size="sm" />
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
        </div><!-- /Coach content -->

        <!-- Hire Coach Modal -->
        <HireCoachModal
          :show="showHireCoachModal"
          :campaign-id="campaignId"
          @close="showHireCoachModal = false"
          @hired="onCoachHired"
        />

        <!-- Coach Badge Store Modal -->
        <CoachBadgeStoreModal
          :show="showCoachBadgeStore"
          :campaign-id="campaignId"
          :team="team"
          @close="showCoachBadgeStore = false"
          @purchased="onCoachBadgePurchased"
        />

        <!-- Re-sign Coach Confirmation Modal -->
        <BaseModal :show="showResignModal" @close="showResignModal = false" :title="$t('Re-sign Head Coach?')">
          <div class="resign-modal">
            <div class="resign-coach-summary">
              <CoachAvatar v-if="coach" :coach="coach" :size="56" :campaign-id="campaignId" />
              <div>
                <p class="resign-coach-name">{{ coach?.name }}</p>
                <p class="resign-coach-meta">{{ $t('Overall {n}', { n: coach?.overall_rating }) }}</p>
              </div>
            </div>
            <p class="resign-text">
              {{ $t('Re-sign your head coach to a new 2-season contract.') }}
            </p>
            <div class="resign-cost-row">
              <span>{{ $t('Cost') }}</span>
              <span class="resign-cost-value" :class="{ insufficient: !canAffordResign }">
                {{ resignCost }} <Coins :size="14" />
              </span>
            </div>
            <div class="resign-balance-row">
              <span>{{ $t('Your balance') }}</span>
              <span>{{ authStore.profile?.tokens ?? 0 }} <Coins :size="14" /></span>
            </div>
            <p v-if="!canAffordResign" class="resign-warning">
              {{ $t("You don't have enough tokens to re-sign this coach.") }}
            </p>
            <div class="resign-actions">
              <BaseButton variant="ghost" @click="showResignModal = false">{{ $t('Cancel') }}</BaseButton>
              <BaseButton
                variant="primary"
                :loading="resigningCoach"
                :disabled="!canAffordResign"
                @click="resignCoach"
              >
                {{ $t('Confirm · {n} tokens', { n: resignCost }) }}
              </BaseButton>
            </div>
          </div>
        </BaseModal>
      </div>

      <!-- Finances View -->
      <div v-else-if="activeTab === 'finances'" class="finances-content">
        <FinancesTab :campaign-id="campaignId" />
      </div>

      <!-- Trades View — hidden after the in-season trade deadline -->
      <div v-else-if="activeTab === 'trades' && !tradeDeadlinePassed" class="trades-content" data-tour="gm-trades-content">
        <TradesTab :campaign-id="campaignId" @trade-completed="activeTab = 'team'" />
      </div>

      <!-- Facilities View -->
      <div v-else-if="activeTab === 'facilities'" class="facilities-content" data-tour="gm-facilities-content">
        <FacilitiesTab :campaign-id="campaignId" :initial-sub-tab="initialFacilitiesSubTab" />
      </div>

      <!-- Owner View -->
      <div v-else-if="activeTab === 'owner'" class="owner-content" data-tour="gm-owner-content">
        <OwnerTab :campaign-id="campaignId" />
      </div>

      <!-- Schedule View -->
      <div v-else-if="activeTab === 'schedule'" class="schedule-content" data-tour="gm-schedule-content">
        <ScheduleTab :campaign-id="campaignId" />
      </div>
    </template>

    <!-- Player Detail Modal -->
    <PlayerDetailModal
      :show="showPlayerModal"
      :player="selectedPlayer"
      :show-growth="true"
      :recent-evolution="recentEvolution"
      :all-time-evolution="allTimeEvolution"
      :player-news="playerNews"
      :show-history="true"
      :can-upgrade="true"
      :is-user-player="true"
      :campaign-id="campaignId"
      :current-season-year="campaignStore.currentCampaign?.currentSeasonYear"
      :lineup-players="teamStore.starterPlayers?.filter(p => p != null) || []"
      :user-tokens="authStore.profile?.tokens ?? 0"
      :coach="teamStore.coach"
      :enable-tab-tours="playerModalTours"
      @close="closePlayerModal"
      @upgrade-attribute="handleUpgradeAttribute"
      @purchase-upgrade-point="handlePurchaseUpgradePoint"
      @hold-coach-meeting="handleHoldCoachMeeting"
    />

    <WalkthroughReplayButton :walkthrough-key="replayTourKey" />
  </div>
</template>

<style scoped>
.roster-view {
  /* Bottom padding clears the floating mobile nav (70px tall, sits at
     var(--safe-area-inset-bottom, env(safe-area-inset-bottom))) with 16px breathing room so the lineup
     tab's last player card isn't covered on devices with a home indicator. */
  padding: 8px 16px;
  padding-bottom: calc(70px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 16px);
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

/* Team header styles live in common/TeamHeader.vue */

/* Tab Navigation */
.tab-nav {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.tab-btn {
  padding: 10px 20px;
  border-radius: var(--radius-lg);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 0.875rem;
}

.tab-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.tab-btn.active {
  background: var(--gradient-cosmic);
  border-color: rgba(255, 255, 255, 0.2);
  color: #1a1520;
  font-weight: 700;
}

.tab-btn-icon {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-btn {
  position: relative;
}

.tab-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #E85A4F;
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

.tab-btn.active .tab-badge {
  background: #E85A4F;
  color: white;
}

.tab-btn-icon :deep(svg) {
  stroke-width: 2;
}

/* Schedule Content */
.schedule-content {
  display: flex;
  flex-direction: column;
}

/* Roster Sections */
.roster-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* List Header - Cosmic gradient */
.roster-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  margin-bottom: 4px;
}

.roster-list-header.card-cosmic {
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  position: relative;
  overflow: hidden;
}

.roster-list-header.card-cosmic::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 10% 20%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 50% 60%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1px 1px at 80% 30%, rgba(255,255,255,0.4), transparent);
  pointer-events: none;
}

.list-header-text {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: #1a1520;
  margin: 0;
  letter-spacing: 0.05em;
  position: relative;
  z-index: 1;
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

/* Player Card - Nebula style */
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

.player-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.08) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

.player-card > * {
  position: relative;
  z-index: 1;
}

.player-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
  border-color: rgba(232, 90, 79, 0.3);
}

.player-card.injured {
  opacity: 0.75;
  border-color: var(--color-error);
}

.player-card.injured::before {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05));
}

.player-card.dropdown-open {
  transform: none;
}

.player-card.dropdown-open:hover {
  transform: none;
}

/* Empty Slot Styles */
.player-card.empty-slot {
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.15);
  cursor: default;
}

.player-card.empty-slot::before {
  background: none;
}

.player-card.empty-slot:hover {
  transform: none;
  box-shadow: none;
}

.player-card.empty-slot .player-avatar.empty {
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.2);
}

.empty-position {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
}

.empty-icon {
  font-size: 1.25rem;
  font-weight: 300;
  color: var(--color-text-tertiary);
}

.empty-name {
  color: var(--color-text-tertiary) !important;
  font-style: italic;
}

.empty-rating {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.empty-hint {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
}

.player-card.roster-slot {
  opacity: 0.6;
}

/* Move Dropdown Styles */
.move-dropdown {
  background: rgba(0, 0, 0, 0.4);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.dropdown-header {
  padding: 10px 12px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.dropdown-list {
  max-height: 200px;
  overflow-y: auto;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background 0.15s ease;
  text-align: left;
}

.dropdown-item:last-child {
  border-bottom: none;
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.dropdown-item.injured {
  opacity: 0.6;
}

.dropdown-item.empty-option {
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-md);
  margin: 8px;
  width: calc(100% - 16px);
}

.dropdown-item.empty-option:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.dropdown-item.empty-option .dropdown-avatar {
  border-style: dashed;
}

.dropdown-item.empty-slot-option {
  background: rgba(34, 197, 94, 0.08);
  border: 1px dashed rgba(34, 197, 94, 0.3);
  border-radius: var(--radius-md);
  margin: 8px;
  width: calc(100% - 16px);
}

.dropdown-item.empty-slot-option:hover {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.5);
}

.dropdown-item.empty-slot-option .dropdown-avatar {
  border-style: dashed;
  border-color: rgba(34, 197, 94, 0.5);
  background: rgba(34, 197, 94, 0.15);
}

.dropdown-item.empty-slot-option .dropdown-avatar .empty-icon {
  color: var(--color-success);
}

.dropdown-avatar {
  width: 28px;
  height: 28px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.dropdown-avatar.empty {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.15);
}

.dropdown-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.dropdown-name {
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-fatigue {
  font-size: 0.7rem;
  font-weight: 600;
  flex-shrink: 0;
}

.dropdown-position {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: var(--color-text-secondary);
}

.dropdown-injury {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 2px 5px;
  background: var(--color-error);
  border-radius: 3px;
  color: white;
}

.dropdown-hint {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  margin-left: auto;
}

.dropdown-empty {
  padding: 16px 12px;
  text-align: center;
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
}

.dropdown-move-icon {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.dropdown-item:hover .dropdown-move-icon {
  color: var(--color-primary);
}

.dropdown-position-badge {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* Dropdown slide animation */
.dropdown-slide-enter-active,
.dropdown-slide-leave-active {
  transition: all 0.25s ease;
  max-height: 300px;
}

.dropdown-slide-enter-from,
.dropdown-slide-leave-to {
  max-height: 0;
  opacity: 0;
}

/* Player card lineup change animations */
.player-card.animate-slide-up {
  animation: slideUp 0.4s ease-out;
}

.player-card.animate-slide-down {
  animation: slideDown 0.4s ease-out;
}

@keyframes slideUp {
  0% {
    opacity: 0;
    transform: translateY(30px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideDown {
  0% {
    opacity: 0;
    transform: translateY(-30px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Bench reorder animation (TransitionGroup) */
.bench-reorder-move {
  transition: transform 0.4s ease;
}

.move-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
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

.slot-position-label {
  position: absolute;
  bottom: -10px;
  left: 5px;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 0.95rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: #1a1520;
  padding: 1px 8px;
  border-radius: var(--radius-md);
  line-height: 1.3;
  text-align: center;
}

.slot-position-label.bench-label {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--color-text-secondary);
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  padding: 1px 6px;
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

/* Training-ready pulse dot — top-left of the lineup/bench avatar block,
   mirrors PlayerCard.vue and the GM-nav dot for consistency. */
.player-avatar .train-ready-dot {
  position: absolute;
  top: 0;
  left: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.25);
  z-index: 2;
}

/* Live training countdown — same top-left corner as the ready dot, but a
   small pill of remaining time while training is in progress. */
.player-avatar .train-countdown {
  position: absolute;
  top: -4px;
  left: -4px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px 1px 5px;
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: #3b82f6;
  border-radius: 999px;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  white-space: nowrap;
  z-index: 3;
}
.player-avatar .train-countdown svg {
  flex-shrink: 0;
}

.avatar-icon {
  stroke-width: 1.5;
}

.player-main-info {
  flex: 1;
  min-width: 0;
}

.player-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.player-name {
  font-size: 0.985rem;
  font-weight: 600;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-primary);
}

.starter-position-tag {
  padding: 2px 6px;
  background: var(--color-primary);
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  color: white;
  text-transform: uppercase;
  flex-shrink: 0;
}

.player-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
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

.role-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.role-badge.starter {
  background: var(--color-primary);
  color: white;
}

.role-badge.bench {
  background: rgba(255, 255, 255, 0.15);
  color: var(--color-text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.vitals-row {
  font-size: 0.75rem;
  color: var(--color-text-primary);
}

/* Shared meter label (MIN / FATIGUE) */
.meter-label {
  font-size: 0.6rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}

/* Fatigue Meter in Player Cards */
.fatigue-meter-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.fatigue-meter-bar {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.fatigue-meter-bar::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 1px,
    rgba(255, 255, 255, 0.1) 1px,
    rgba(255, 255, 255, 0.1) 2px
  );
  border-radius: 3px;
  z-index: 1;
  pointer-events: none;
}

.fatigue-meter-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease, background-color 0.3s ease;
  opacity: 0.85;
}

.fatigue-meter-row .fatigue-value {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  min-width: 28px;
  text-align: right;
}

.fatigue-warning-icon {
  color: var(--color-error);
  animation: pulse-warning 2s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse-warning {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.rating-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* Wrapper around the OVR StatBadge + upgrade-indicator overlay. The badge
   itself doesn't expose a slot, so we wrap it and absolute-position the
   chevron icon over its top-right corner. Use display: inline-block (not
   inline-flex) and avoid line-height tricks — the StatBadge's inner element
   is a <div> with its own intrinsic sizing, and any flex/line-height on the
   wrap was squashing it vertically. */
.ovr-badge-wrap {
  position: relative;
  display: inline-block;
}

.ovr-upgrade-indicator {
  position: absolute;
  top: -4px;
  right: -4px;
  color: #22c55e;
  background: var(--color-bg-elevated, #1a1a1a);
  border-radius: 50%;
  padding: 1px;
  box-shadow: 0 0 0 1.5px #22c55e, 0 2px 4px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  animation: ovr-upgrade-pulse 1.8s ease-in-out infinite;
}

@keyframes ovr-upgrade-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.12); }
}

.move-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.move-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--color-text-primary);
  border-color: var(--color-primary);
}

.card-body {
  padding: 4px 8px;
}

.physical-info {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
  margin-bottom: 10px;
}

.physical-info .divider {
  color: rgba(255, 255, 255, 0.15);
}

/* Stats grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-bottom: 0;
}

@media (max-width: 400px) {
  .stats-grid {
    grid-template-columns: repeat(6, 1fr);
  }
  .stats-grid .stat-item {
    grid-column: span 2;
  }
  .stats-grid .stat-item:nth-last-child(-n+2) {
    grid-column: span 3;
  }
}

.stat-item {
  text-align: center;
  padding: 4px 2px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: var(--radius-md);
}

.stat-label {
  display: block;
  font-size: 0.6rem;
  color: var(--color-text-tertiary);
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-value {
  font-weight: 700;
  font-size: 0.9rem;
  font-family: var(--font-mono);
  color: var(--color-primary);
}

.no-stats {
  padding: 10px;
  text-align: center;
  background: rgba(0, 0, 0, 0.15);
  border-radius: var(--radius-md);
  margin-bottom: 10px;
}

/* Compact inline stats for player cards */
.stats-inline {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 4px 0;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-md);
  margin-bottom: 0;
}

.stat-inline {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  padding: 2px 0;
  gap: 3px;
}

.stat-inline .stat-label {
  display: block;
  font-size: 0.475rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 0;
  line-height: 1;
  padding-bottom:1px;
  border-bottom:1px solid var(--color-text-tertiary);
}

.stat-inline .stat-val {
  font-size: 0.7rem;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
  line-height: 1;
}

.stat-sep {
  display: none;
}

/* Badges */
.badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
  padding-left: 10px;
}

.badge-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  font-size: 0.7rem;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.badge-name {
  color: var(--color-text-tertiary);
}

/* "+N" overflow chip for players with more than the 3 shown badges (mirrors
   the scouting page's badge row). */
.badge-more-count {
  align-self: center;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.badge-dot.synergy-active {
  box-shadow: 0 0 4px 2px rgba(0, 229, 255, 0.6);
  animation: synergy-pulse 2s ease-in-out infinite;
}

.synergy-active-text {
  color: #00E5FF !important;
}

[data-theme="light"] .synergy-active-text {
  color: rgb(139, 92, 246) !important;
}

@keyframes synergy-pulse {
  0%, 100% { box-shadow: 0 0 4px 2px rgba(0, 229, 255, 0.6); }
  50% { box-shadow: 0 0 8px 3px rgba(0, 229, 255, 0.3); }
}

[data-theme="light"] .badge-dot.synergy-active {
  box-shadow: 0 0 4px 2px rgba(139, 92, 246, 0.6);
  animation: synergy-pulse-light 2s ease-in-out infinite;
}

@keyframes synergy-pulse-light {
  0%, 100% { box-shadow: 0 0 4px 2px rgba(139, 92, 246, 0.6); }
  50% { box-shadow: 0 0 8px 3px rgba(139, 92, 246, 0.3); }
}

.dynamic-duo-badge {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem;
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 140, 0, 0.15));
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 0.35rem;
  font-size: 0.7rem;
  color: #FFD700;
  font-weight: 600;
  margin-top: 0.25rem;
}

/* Injury styles */
.injury-tag {
  padding: 2px 6px;
  background: var(--color-error);
  color: white;
  border-radius: 4px;
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
}

.text-injured {
  color: var(--color-error) !important;
  text-decoration: line-through;
  text-decoration-color: rgba(239, 68, 68, 0.5);
}

/* Coach Content */
.coach-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.coach-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.coach-tab-btn {
  padding: 6px 14px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 0.8rem;
}

.coach-tab-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.coach-tab-btn.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
  box-shadow: 0 2px 8px rgba(232, 90, 79, 0.3);
}

.coach-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.coach-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
}

.coach-avatar-wrap {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  flex-shrink: 0;
  /* No overflow clipping — the brush edit badge sits at the bottom-left
     corner and gets cut off when this wrapper has `overflow: hidden`.
     The avatar's own `border-radius: 50%` (on .coach-headshot inside
     CoachAvatar) already keeps the photo round, so we don't need wrapper
     clipping to maintain the circle. */
  overflow: visible;
}

.coach-badge-store-btn {
  margin-top: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  color: var(--color-primary);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.2s ease;
}

@media (max-width: 640px) {
  .coach-badge-store-btn {
    width: 100%;
    display: flex;
  }
}

.coach-badge-store-btn:hover {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.coach-badges-section {
  /* Reuses .section-title and .mt-4 from elsewhere in this file */
}

.coach-badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.coach-badge-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  color: var(--color-text-primary);
}

.coach-badge-chip-name {
  font-weight: 500;
}

.coach-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.coach-name {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
}

.coach-rating {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rating-label {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

/* Career Stats Section */
.career-stats-section {
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.career-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.career-stat-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  text-align: center;
  position: relative;
  overflow: hidden;
}

.career-stat-box::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.05) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

.career-stat-box > * {
  position: relative;
  z-index: 1;
}

.career-stat-box.highlight {
  border-color: rgba(232, 90, 79, 0.3);
}

.career-stat-box.highlight::before {
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.15) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.10) 0%, transparent 40%);
}

.career-stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
}

[data-theme="light"] .career-stat-value {
  color: black;
}

[data-theme="light"] .scheme-card::before {
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.08) 0%, transparent 40%);
}

.career-stat-label {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  margin-top: 4px;
}

.career-stat-pct {
  font-size: 0.875rem;
  color: var(--color-success);
  font-weight: 500;
  margin-top: 2px;
}

.awards-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.award-badge {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.award-badge.gold {
  background: rgba(255, 215, 0, 0.15);
  border-color: rgba(255, 215, 0, 0.3);
  color: #FFD700;
}

.coach-attributes {
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

/* Coach Actions — per-season pools + minimal explainer */
.coach-actions-info {
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.coach-action-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.coach-action-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
}
.coach-action-icon {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.14);
  color: #3b82f6;
}
.coach-action-body {
  flex: 1;
  min-width: 0;
}
.coach-action-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.coach-action-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.coach-action-count {
  font-size: 0.95rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #22c55e;
  flex-shrink: 0;
}
.coach-action-count.depleted {
  color: var(--color-text-tertiary);
}
.coach-action-total {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}
.coach-action-desc {
  margin: 2px 0 0;
  font-size: 0.76rem;
  line-height: 1.35;
  color: var(--color-text-tertiary);
}

.attr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.coach-attr-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.coach-attr-item .attr-label {
  width: 100px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-transform: capitalize;
}

.attr-bar-mini {
  flex: 1;
  height: 6px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 3px;
  overflow: hidden;
}

.attr-fill {
  height: 100%;
  border-radius: 3px;
}

.coach-attr-item .attr-val {
  width: 30px;
  text-align: right;
  font-weight: 600;
  font-size: 0.875rem;
}

/* Warning badge for the Facilities tab (any facility with unhired staff) */
.tab-badge-warning {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  background: #F59E0B;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.tab-btn.active .tab-badge-warning {
  background: #F59E0B;
  color: white;
}

.coach-tab-btn {
  position: relative;
}

/* Coach hire/fire UI */
.coach-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 16px;
}

.coach-empty-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--color-bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  opacity: 0.6;
  margin-bottom: 16px;
}

.coach-empty-state .empty-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  color: var(--color-text-primary);
  margin: 0 0 8px 0;
}

.coach-empty-state .empty-desc {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin: 0 0 20px 0;
  line-height: 1.5;
  max-width: 380px;
}

/* Expired-coach empty state: re-sign + browse side by side (wraps on
   phones). Reuses the coach card's .btn-resign-coach styling. */
.coach-expired-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.btn-browse-coaches {
  padding: 12px 24px;
  border-radius: var(--radius-xl);
  background: var(--color-primary);
  border: none;
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-browse-coaches:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.coach-contract-line {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  opacity: 0.85;
}

.coach-header-actions {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  flex-shrink: 0;
}

.coach-actions-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.coach-actions-row .btn-resign-coach,
.coach-actions-row .btn-view-candidates {
  width: 100%;
  text-align: center;
}

.btn-coin-icon {
  display: inline-block;
  vertical-align: -2px;
}

/* Re-sign confirmation modal */
.resign-modal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  /* Match the app's standard popup width so this confirm doesn't render narrow
     like a bare dialog — BaseModal caps at max-w-lg, this sets the floor. */
  min-width: 460px;
}
/* Drop the floor on small screens so it can't overflow a phone viewport. */
@media (max-width: 540px) {
  .resign-modal {
    min-width: 0;
  }
}

.resign-coach-summary {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.resign-coach-name {
  font-weight: 700;
  color: var(--color-text-primary);
}

.resign-coach-meta {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.resign-text {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.resign-cost-row,
.resign-balance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

.resign-cost-row {
  font-weight: 600;
  color: var(--color-text-primary);
}

.resign-cost-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #EAB308;
}

.resign-cost-value.insufficient {
  color: var(--color-error, #EF4444);
}

.resign-balance-row {
  display: flex;
}

.resign-balance-row span:last-child {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.resign-warning {
  font-size: 0.8rem;
  color: var(--color-error, #EF4444);
  background: rgba(239, 68, 68, 0.1);
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-lg);
}

.resign-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.btn-view-candidates {
  padding: 8px 14px;
  border-radius: var(--radius-md);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.btn-view-candidates:hover {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.btn-resign-coach {
  padding: 8px 14px;
  border-radius: var(--radius-md);
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.5);
  color: #22c55e;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.btn-resign-coach:hover:not(:disabled) {
  background: rgba(34, 197, 94, 0.2);
}

.btn-resign-coach:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.recommended-badge {
  padding: 6px 12px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 6px;
  color: var(--color-success);
  font-size: 0.75rem;
  font-weight: 500;
}

.schemes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.scheme-card {
  position: relative;
  padding: 20px;
  background: var(--glass-bg);
  border: 2px solid var(--glass-border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;
}

.scheme-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.05) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

.scheme-card > * {
  position: relative;
  z-index: 1;
}

.scheme-card:hover {
  border-color: rgba(255, 255, 255, 0.2);
}

.scheme-card.active {
  border-color: var(--color-primary);
}

.scheme-card.active::before {
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.15) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.10) 0%, transparent 40%);
}

.scheme-card.recommended:not(.active) {
  border-color: rgba(16, 185, 129, 0.4);
}

.scheme-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.scheme-name {
  font-size: 1.1rem;
  font-weight: 600;
}

.rec-tag {
  padding: 2px 8px;
  background: var(--color-success);
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  color: white;
}

/* Analytics Lv5: scheme with the best season PPP over its emphasized plays */
.proven-tag {
  background: #F59E0B;
  color: #1a1520;
}

.scheme-desc {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin-bottom: 16px;
  line-height: 1.4;
}

.scheme-details {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.scheme-pace,
.scheme-effectiveness {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
}

.detail-value {
  font-weight: 600;
  text-transform: capitalize;
}

.detail-value.very_fast,
.detail-value.fast {
  color: var(--color-warning);
}

.detail-value.medium {
  color: var(--color-text-tertiary);
}

.detail-value.slow {
  color: var(--color-text-secondary);
}

.detail-value.high {
  color: var(--color-success);
}

.detail-value.low {
  color: var(--color-error);
}

.scheme-traits {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trait-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trait-label {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
}

.trait-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.trait-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  text-transform: capitalize;
}

.trait-tag.positive {
  background: rgba(16, 185, 129, 0.15);
  color: var(--color-success);
}

.trait-tag.negative {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-error);
}

.scheme-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 12px;
}

/* Playbook preview (offensive scheme cards) */
.playbook-section {
  margin-top: 0.85rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 0.75rem;
}

.playbook-toggle {
  width: 100%;
  padding: 6px 12px;
  border-radius: var(--radius-lg, 10px);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.playbook-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
}

.playbook-body {
  margin-top: 0.75rem;
}

/* Analytics Lv4: selected play's season efficiency chips */
.play-season-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 0.6rem;
}

.play-chip {
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-border);
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

[data-theme='light'] .play-chip {
  background: rgba(0, 0, 0, 0.05);
}

/* Analytics Lv3: own-team season play analytics under the offensive grid */
.season-analytics-section {
  margin-top: 20px;
  /* Guard: never let the analytics table's intrinsic width push this
     section (and the page) wider than the viewport on mobile. */
  min-width: 0;
  max-width: 100%;
}

.playbook-select {
  width: 100%;
  margin-bottom: 0.6rem;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--color-text-primary);
  font-size: 0.82rem;
}

[data-theme='light'] .playbook-toggle {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.12);
}

[data-theme='light'] .playbook-select {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.15);
}


.scheme-card.defensive.active {
  background: rgba(59, 130, 246, 0.1);
  border-color: #3B82F6;
}

.scheme-type-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
}

.scheme-type-tag.aggressive {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-error);
}

.scheme-type-tag.balanced {
  background: rgba(245, 158, 11, 0.15);
  color: var(--color-warning);
}

.scheme-type-tag.passive {
  background: rgba(16, 185, 129, 0.15);
  color: var(--color-success);
}

/* Finances Content */
.finances-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Player Modal Styles */
.player-modal-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-xl);
  padding: 20px;
  margin: -20px;
  position: relative;
  overflow: visible;
}

.player-modal-content::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 90% 90%, rgba(232, 90, 79, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(244, 162, 89, 0.08) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
  border-radius: var(--radius-xl);
}

.player-modal-content > * {
  position: relative;
  z-index: 1;
}

/* Remove modal scrollbar */
:deep(.modal-container) {
  overflow-y: visible !important;
  max-height: none !important;
}

.player-modal-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.player-modal-header.injured-header {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05));
  border-radius: 10px;
  padding: 16px;
  margin: -8px -8px 0 -8px;
}

.modal-player-avatar {
  width: 60px;
  height: 60px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.rating-with-injury {
  position: relative;
}

.injury-badge-modal {
  position: absolute;
  bottom: -4px;
  right: -4px;
  padding: 2px 5px;
  background: var(--color-error);
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  border-radius: 4px;
  text-transform: uppercase;
}

.injured-name {
  color: var(--color-error) !important;
  text-decoration: line-through;
  text-decoration-color: rgba(239, 68, 68, 0.5);
}

.player-bio {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.player-bio .divider {
  color: rgba(255, 255, 255, 0.2);
}

/* Badges Section */
.badges-section {
  padding: 16px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.badges-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid;
  border-radius: 6px;
}

.badge-level {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.65rem;
  font-weight: 700;
  color: white;
}

.badge-card .badge-name {
  font-size: 0.875rem;
  color: var(--color-text-primary);
}

/* Modal Tabs */
.modal-tabs {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.2);
  padding: 4px;
  border-radius: 10px;
}

.modal-tab {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-tab:hover {
  color: white;
  background: rgba(255, 255, 255, 0.05);
}

.modal-tab.active {
  background: var(--color-primary);
  color: white;
}

.modal-tab-content {
  min-height: 300px;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Awards Grid */
.awards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.award-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  text-align: center;
}

.award-card svg {
  color: var(--color-text-secondary);
}

.award-card.gold {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 140, 0, 0.1));
  border-color: rgba(255, 215, 0, 0.3);
}

.award-card.gold svg {
  color: #ffd700;
}

.award-card.silver {
  background: linear-gradient(135deg, rgba(192, 192, 192, 0.15), rgba(128, 128, 128, 0.1));
  border-color: rgba(192, 192, 192, 0.3);
}

.award-card.silver svg {
  color: #c0c0c0;
}

.award-count {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.award-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.empty-icon {
  color: var(--color-text-tertiary);
  opacity: 0.3;
  margin-bottom: 8px;
}

/* Stats Sections in Modal */
.stats-section-modal {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 16px;
}

.stats-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.stats-grid-modal {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.stat-cell .stat-label {
  font-size: 0.65rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.stat-cell .stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.stat-cell .stat-value.highlight {
  color: var(--color-primary);
}

/* Attribute Sections */
.attr-section {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 16px;
}

.attr-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.attributes-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.attr-row {
  display: grid;
  grid-template-columns: 120px 1fr 40px;
  align-items: center;
  gap: 12px;
}

.attr-name {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  text-transform: capitalize;
}

.attr-bar-container {
  height: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  overflow: hidden;
}

.attr-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.attr-value {
  font-weight: 600;
  text-align: right;
}

/* Evolution Section */
.evolution-section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.evolution-subsection {
  margin-bottom: 16px;
}

.evolution-subtitle {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 8px 0;
}

.evolution-alltime-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  border: none;
  padding: 8px 0;
  cursor: pointer;
  color: var(--color-text-primary);
}

.evolution-alltime-header:hover {
  opacity: 0.8;
}

.evolution-toggle-icon {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
}

.evolution-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.evolution-item {
  display: grid;
  grid-template-columns: 70px 1fr 50px 40px;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  font-size: 0.8rem;
}

.evolution-category {
  color: var(--color-text-tertiary);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.evolution-attr {
  color: var(--color-text-primary);
  font-weight: 500;
}

.evolution-change {
  font-weight: 700;
  text-align: right;
  font-family: var(--font-mono);
}

.evolution-count {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  text-align: right;
}

.evolution-toggle {
  margin-top: 8px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.evolution-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

.evolution-empty {
  padding: 16px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 0.8rem;
  font-style: italic;
}

/* News List */
.news-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.news-item {
  padding: 16px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
  border-left: 3px solid var(--color-primary);
}

.news-headline {
  font-weight: 500;
  margin: 0 0 4px 0;
}

.news-date {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin: 0;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  color: var(--color-text-secondary);
}

.empty-state p:first-child {
  font-size: 1rem;
  margin: 0 0 8px 0;
}

/* Position badge secondary */
.position-badge.secondary {
  opacity: 0.85;
}

/* Badges Tab Styles */
.badges-tab-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.badge-level-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.badge-level-title {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 2px solid;
}

.badge-level-title.hof {
  color: #9B59B6;
  border-color: #9B59B6;
}

.badge-level-title.gold {
  color: #FFD700;
  border-color: #FFD700;
}

.badge-level-title.silver {
  color: #C0C0C0;
  border-color: #C0C0C0;
}

.badge-level-title.bronze {
  color: #CD7F32;
  border-color: #CD7F32;
}

.badges-grid-modal {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}

.badge-card-modal {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: var(--radius-lg);
  border-left: 3px solid;
}

.badge-card-modal.hof {
  border-color: #9B59B6;
  background: rgba(155, 89, 182, 0.15);
}

.badge-card-modal.gold {
  border-color: #FFD700;
  background: rgba(255, 215, 0, 0.1);
}

.badge-card-modal.silver {
  border-color: #C0C0C0;
  background: rgba(192, 192, 192, 0.1);
}

.badge-card-modal.bronze {
  border-color: #CD7F32;
  background: rgba(205, 127, 50, 0.1);
}

.badge-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 0.65rem;
  font-weight: 800;
  flex-shrink: 0;
}

.badge-card-modal.hof .badge-icon {
  background: #9B59B6;
  color: white;
}

.badge-card-modal.gold .badge-icon {
  background: #FFD700;
  color: #1a1520;
}

.badge-card-modal.silver .badge-icon {
  background: #C0C0C0;
  color: #1a1520;
}

.badge-card-modal.bronze .badge-icon {
  background: #CD7F32;
  color: white;
}

.badge-name-modal {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

/* Responsive adjustments */
@media (min-width: 1024px) {
  .roster-view {
    padding: 24px;
    padding-bottom: 32px;
  }
  /* Team header desktop sizing lives in common/TeamHeader.vue */
}

@media (max-width: 640px) {
  .stats-grid-modal {
    grid-template-columns: repeat(2, 1fr);
  }

  .attr-row {
    grid-template-columns: 100px 1fr 35px;
    gap: 8px;
  }

  .schemes-grid {
    grid-template-columns: 1fr;
  }

  .attr-grid {
    grid-template-columns: 1fr;
  }

  .career-stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 700px) {
  .tab-nav {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}

/* Light mode overrides */
[data-theme="light"] .stat-item {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .stat-label {
  color: var(--color-text-secondary);
}

[data-theme="light"] .no-stats {
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

[data-theme="light"] .move-btn {
  background: white;
  border-color: rgba(0, 0, 0, 0.15);
  color: var(--color-text-secondary);
}

[data-theme="light"] .move-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  border-color: var(--color-primary);
  color: var(--color-text-primary);
}

[data-theme="light"] .move-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

[data-theme="light"] .move-dropdown {
  background: white;
  border-top-color: rgba(0, 0, 0, 0.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .dropdown-header {
  border-bottom-color: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .dropdown-item {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .dropdown-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .dropdown-item.empty-option {
  background: rgba(0, 0, 0, 0.02);
  border-color: rgba(0, 0, 0, 0.15);
}

[data-theme="light"] .dropdown-item.empty-option:hover {
  background: rgba(0, 0, 0, 0.05);
  border-color: rgba(0, 0, 0, 0.25);
}

[data-theme="light"] .dropdown-avatar {
  background: rgba(0, 0, 0, 0.08);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .dropdown-avatar.empty {
  background: transparent;
  border-color: rgba(0, 0, 0, 0.2);
}

[data-theme="light"] .dropdown-position {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .player-card.empty-slot {
  border-color: rgba(0, 0, 0, 0.15);
}

[data-theme="light"] .fatigue-meter-bar,
[data-theme="light"] .minutes-meter-bar {
  background: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .minutes-thumb {
  border-color: rgba(0, 0, 0, 0.2);
}

[data-theme="light"] .stats-inline {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .role-badge.bench {
  background: rgba(0, 0, 0, 0.08);
  border-color: rgba(0, 0, 0, 0.12);
  color: var(--color-text-secondary);
}

[data-theme="light"] .slot-position-label.bench-label {
  background: rgba(0, 0, 0, 0.12);
  border-color: rgba(0, 0, 0, 0.15);
  color: var(--color-text-secondary);
}

[data-theme="light"] .stats-section-modal {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .stat-cell {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .badge-card-modal {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .badge-card-modal.hof {
  background: rgba(155, 89, 182, 0.12);
}

[data-theme="light"] .badge-card-modal.gold {
  background: rgba(255, 215, 0, 0.15);
}

[data-theme="light"] .badge-card-modal.silver {
  background: rgba(192, 192, 192, 0.2);
}

[data-theme="light"] .badge-card-modal.bronze {
  background: rgba(205, 127, 50, 0.12);
}

[data-theme="light"] .badges-tab-content {
  color: var(--color-text-primary);
}

[data-theme="light"] .tab-btn {
  background: white;
  border-color: rgba(0, 0, 0, 0.12);
  color: var(--color-text-secondary);
}

[data-theme="light"] .tab-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--color-text-primary);
}

[data-theme="light"] .tab-btn.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
}

[data-theme="light"] .coach-tab-btn {
  background: rgba(0, 0, 0, 0.05);
  border-color: rgba(0, 0, 0, 0.12);
  color: var(--color-text-secondary);
}

[data-theme="light"] .coach-tab-btn:hover {
  background: rgba(0, 0, 0, 0.1);
  color: var(--color-text-primary);
}

[data-theme="light"] .coach-tab-btn.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
  box-shadow: 0 2px 8px rgba(232, 90, 79, 0.2);
}

/* Header Metrics (chemistry + minutes) */
.header-metrics {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 1;
}

/* Chemistry chip — dark translucent pill around the chemistry icon + %
   so the band signal pops against the cosmic header background. Mirrors
   the morale-chip in PlayerDetailModal's header (rgba(26,21,32,.65) fill +
   chemistry-tinted border). */
.chemistry-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  background: rgba(26, 21, 32, 0.65);
  border: 1px solid color-mix(in srgb, var(--chemistry-color, #6b7280) 40%, transparent);
  border-radius: 999px;
  line-height: 1;
}

.team-chemistry-value {
  font-size: 0.85rem;
  font-weight: 800;
  font-family: var(--font-mono, monospace);
}

.chemistry-face-icon {
  flex-shrink: 0;
  transition: color 0.2s ease;
  position: relative;
  z-index: 1;
}

.header-metrics-divider {
  color: rgba(0, 0, 0, 0.3);
  font-weight: 700;
}

/* Total Minutes Value (in header) */
.total-minutes-value {
  font-size: 0.8rem;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  color: var(--color-primary);
  position: relative;
  z-index: 1;
}

.cpu-adjust-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 4px 10px;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(0, 0, 0, 0.3);
  color: rgba(0, 0, 0, 0.85);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease;
  position: relative;
  z-index: 1;
}

.cpu-adjust-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.3);
  transform: translateY(-1px);
}

.cpu-adjust-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Player Minutes Meter */
.minutes-meter-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}

.minutes-meter-bar {
  flex: 1;
  height: 15px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  overflow: visible;
  cursor: pointer;
  position: relative;
}

.minutes-meter-fill {
  height: 100%;
  border-radius: 12px;
  transition: width 0.2s ease, background-color 0.2s ease;
  position: relative;
}

.minutes-meter-bar.dragging .minutes-meter-fill {
  transition: none;
}

.minutes-meter-bar.disabled {
  cursor: not-allowed;
  opacity: 0.4;
  pointer-events: none;
}

.minutes-thumb {
  position: absolute;
  right: -7px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  cursor: grab;
}

.minutes-thumb:active {
  cursor: grabbing;
  transform: translateY(-50%) scale(1.15);
}

.minutes-pct-value {
  font-size: 0.65rem;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  min-width: 30px;
  text-align: left;
  flex-shrink: 0;
}

/* Substitution Strategy Scheme Card */
.scheme-card.substitution {
  border-color: rgba(139, 92, 246, 0.2);
}

.scheme-card.substitution.active {
  border-color: rgba(139, 92, 246, 0.6);
  background: rgba(139, 92, 246, 0.08);
}

.scheme-card.substitution.active::before {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(139, 92, 246, 0.05));
}

</style>
