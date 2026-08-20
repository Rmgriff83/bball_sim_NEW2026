<script setup>
import { ref, reactive, computed, watch, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { StatBadge, BaseModal } from '@/components/ui'
import { User, Trophy, Award, Medal, Star, Users, X, AlertTriangle, Zap, Shield, Repeat, RefreshCw, UserMinus, UserPlus, Lock, Binoculars, ShoppingBag, Smile, Meh, Frown, Coins, MessagesSquare, Check, Brush, Dumbbell, Sparkles, ChevronDown, Pencil } from 'lucide-vue-next'
import { PERSONALITY_TRAITS } from '@/engine/campaign/CampaignManager'
import { getCoachActionBudget, COACH_MEETING_EXTRA_COST } from '@/engine/data/coaches'
import { detectArchetype } from '@/engine/data/archetypes'
import { getAttrCap } from '@/engine/evolution/PlayerEvolution'
import CoachMeetingConfirmModal from './CoachMeetingConfirmModal.vue'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import PlayerBadgeStoreModal from '@/components/team/PlayerBadgeStoreModal.vue'
import CareerHighsPanel from '@/components/team/CareerHighsPanel.vue'
import { useTradeStore } from '@/stores/trade'
import { useToastStore } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { useTeamStore } from '@/stores/team'
import { useAudioStore } from '@/stores/audio'
import { getBadgeStoreEntries, PLAYER_BADGE_LEVELS } from '@/engine/data/playerBadgeStore'
import { BADGES, badgeDisplayName } from '@/engine/data/badges'
import { getCoachTrainBudget } from '@/engine/data/coaches'
import { useBadgeSynergies } from '@/composables/useBadgeSynergies'
import { useWalkthroughStore } from '@/stores/walkthrough'
import WalkthroughReplayButton from '@/components/walkthrough/WalkthroughReplayButton.vue'
import { useHeadshotEditorReturnStore } from '@/stores/headshotEditorReturn'
import { buildSeasonStatsTable } from '@/composables/useSeasonHistory'
import { getMotivationLabel, getArchetypeLabel, calculateRetentionScore } from '@/engine/ai/MotivationService'
import { t, tDynamic, dateLocale } from '@wl-i18n/i18n.js'

const { getActivatedBadges, isPlayerInDynamicDuo } = useBadgeSynergies()

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  player: {
    type: Object,
    default: null
  },
  // Show growth tab for user's own players (with evolution data)
  showGrowth: {
    type: Boolean,
    default: false
  },
  // Evolution data for growth tab
  recentEvolution: {
    type: Array,
    default: () => []
  },
  allTimeEvolution: {
    type: Array,
    default: () => []
  },
  // Player news for history tab
  playerNews: {
    type: Array,
    default: () => []
  },
  showHistory: {
    type: Boolean,
    default: true
  },
  // For nested modals (like in LeagueView)
  backButton: {
    type: Object,
    default: null // { label: 'Back to Team', handler: Function }
  },
  // Current season year for season stats table
  currentSeasonYear: {
    type: Number,
    default: null
  },
  // Whether user can upgrade attributes (only for user's own team players)
  canUpgrade: {
    type: Boolean,
    default: false
  },
  // Lineup players for badge synergy highlighting
  lineupPlayers: {
    type: Array,
    default: () => []
  },
  // Enable trade block toggle for user's own players
  isUserPlayer: {
    type: Boolean,
    default: false
  },
  // Campaign ID needed for trade block persistence
  campaignId: {
    type: [String, Number],
    default: null
  },
  // Show resign/drop action buttons in header (finances page only)
  showContractActions: {
    type: Boolean,
    default: false
  },
  // Whether player is on an expiring contract (for showing resign button)
  isExpiringContract: {
    type: Boolean,
    default: false
  },
  // Whether in-season re-signing is closed (deadline passed). Hides the
  // header Re-sign button, mirroring the ContractCard row button gating.
  resignDisabled: {
    type: Boolean,
    default: false
  },
  // Scouting mode: hides unrevealed attributes, locks badges/morale
  scoutingMode: {
    type: Boolean,
    default: false
  },
  // List of revealed attribute keys (from scouting system)
  revealedAttributes: {
    type: Array,
    default: () => []
  },
  // Whether player is 100% scouted (gates potential rating display)
  isFullyScouted: {
    type: Boolean,
    default: false
  },
  // Animating attribute keys for stat-pop effect { 'attrKey': true }
  animatingAttributes: {
    type: Object,
    default: () => ({})
  },
  // Available scouting points (for scout button in modal header)
  scoutingPoints: {
    type: Number,
    default: 0
  },
  // Whether a scout action is in progress
  scoutingInProgress: {
    type: Boolean,
    default: false
  },
  // Whether badges have been revealed by scout perk
  badgesRevealed: {
    type: Boolean,
    default: false
  },
  // Whether morale/personality has been revealed by scout perk
  moraleRevealed: {
    type: Boolean,
    default: false
  },
  // Current user token balance — used by the Buy +1 buttons in the
  // upgrade-points banner to disable when insufficient.
  userTokens: {
    type: Number,
    default: 0
  },
  // The user team's currently signed head coach (or null). Drives the
  // "Coach Meeting" button on the Morale tab — needs `actionsRemaining`
  // and `overallRating` (to resolve tier → budget).
  coach: {
    type: Object,
    default: null
  },
  // When true, switching to a sub-tab auto-starts that tab's onboarding
  // walkthrough (first visit only). Set by the lineup tab so these tours fire
  // only for the lineup-opened modal, matching the initial-page tour gating.
  enableTabTours: {
    type: Boolean,
    default: false
  },
  // Draft room: when true (it's the user's pick), show a "Draft Player" button
  // in the header that emits `draft-player`.
  canDraft: {
    type: Boolean,
    default: false
  },
  // True when this modal is being shown from any draft-room flow (rookie
  // OR fantasy). Used to suppress contract actions (Sign / Re-sign / Drop)
  // that don't make sense before the player has been drafted to a team.
  // The rookie-draft caller can rely on `scoutingMode` for the same effect,
  // but the fantasy-draft caller needs this explicit signal because its
  // players already carry the free-agent flag.
  inDraft: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'upgrade-attribute', 'purchase-upgrade-point', 'resign-player', 'drop-player', 'sign-player', 'scout-player', 'hold-coach-meeting', 'draft-player'])

const activeTab = ref('stats')
// Sub-tab for the recent-games / career-highs box within the stats tab.
const recentStatsTab = ref('recent')
const showPlayerBadgeStore = ref(false)
// Collapsible "badges this player could earn" list on the Badges tab — same
// eligibility data the Badge Store uses, surfaced here for visibility.
const showBadgeOptions = ref(false)
const PLAYER_BADGE_TIER_COLORS = {
  bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700', hof: '#9333EA',
}
const BADGE_CATEGORY_LABELS = {
  shooting: 'Shooting', finishing: 'Finishing', playmaking: 'Playmaking', defense: 'Defense', physical: 'Physical',
}
function badgeLevelLabel(level) {
  if (!level) return '—'
  if (level === 'hof') return 'HOF'
  return level.charAt(0).toUpperCase() + level.slice(1)
}
// Eligible badges + the per-player level ceiling (uses the raw player, same as
// the Badge Store, so position/attribute/potential fit is evaluated identically),
// MERGED with every badge the player already owns. getBadgeStoreEntries omits
// badges the player no longer meets the eligibility fit for, but if they own one
// it should still show here (as owned, maxed at the level they hold).
const badgeOptions = computed(() => {
  if (!props.player) return []
  const entries = getBadgeStoreEntries(props.player)
  const lvlIdx = (l) => PLAYER_BADGE_LEVELS.indexOf(l)
  // An owned tier can sit above the player's current eligibility ceiling — show
  // the ceiling as at least what they hold so the dots/label aren't misleading.
  for (const e of entries) {
    if (e.currentLevel && lvlIdx(e.currentLevel) > lvlIdx(e.maxLevel)) e.maxLevel = e.currentLevel
  }
  const seen = new Set(entries.map((e) => e.badge.id))
  for (const ob of props.player.badges ?? []) {
    if (!ob?.id || seen.has(ob.id)) continue
    seen.add(ob.id)
    const meta = BADGES.find((b) => b.id === ob.id)
      || { id: ob.id, name: formatBadgeName(ob), category: 'other', description: '' }
    entries.push({
      badge: meta,
      category: meta.category || 'other',
      currentLevel: ob.level,
      nextLevel: null,
      nextCost: null,
      maxLevel: ob.level,
      isMaxedForPlayer: true,
      attrFit: 0,
    })
  }
  return entries
})
const badgeOptionsByCategory = computed(() => {
  const by = {}
  for (const e of badgeOptions.value) {
    if (!by[e.category]) by[e.category] = []
    by[e.category].push(e)
  }
  return Object.entries(by).map(([category, entries]) => ({ category, entries }))
})
// Dot state per tier: owned (already at/above), reachable (≤ ceiling, not yet
// owned), or locked (above this player's ceiling).
function badgeDotClass(entry, level) {
  const lvlIdx = PLAYER_BADGE_LEVELS.indexOf(level)
  const ownIdx = entry.currentLevel ? PLAYER_BADGE_LEVELS.indexOf(entry.currentLevel) : -1
  const maxIdx = PLAYER_BADGE_LEVELS.indexOf(entry.maxLevel)
  return {
    owned: ownIdx >= lvlIdx,
    reachable: lvlIdx <= maxIdx && ownIdx < lvlIdx,
    locked: lvlIdx > maxIdx,
  }
}

// Per-sub-tab onboarding walkthroughs. When the lineup opens this modal
// (enableTabTours), the first visit to each sub-tab auto-starts its own tour.
// The 'stats' tab is the initial page, covered by the 'playerDetail' tour.
const walkthroughStore = useWalkthroughStore()
const TAB_TOUR_KEYS = {
  attributes: 'playerDetailAttributes',
  badges: 'playerDetailBadges',
  growth: 'playerDetailGrowth',
  morale: 'playerDetailMorale',
  // History tab intentionally has no walkthrough.
}
watch(activeTab, (tab) => {
  if (!props.enableTabTours) return
  const key = TAB_TOUR_KEYS[tab]
  // maybeStart no-ops if the tour isn't enabled, already seen, already running,
  // or not yet defined in the registry — so undefined keys are safe.
  if (key) walkthroughStore.maybeStart(key)
})

// Replay key for the "?" button — the active sub-tab's tour ('stats' is the
// initial page, covered by 'playerDetail'). Only offered where the tab tours
// were designed to run (opened from the lineup), and null on tour-less tabs
// (history) so the button hides there.
const replayTourKey = computed(() => {
  if (!props.enableTabTours) return null
  if (activeTab.value === 'stats') return 'playerDetail'
  return TAB_TOUR_KEYS[activeTab.value] ?? null
})

// Evolution display state
const showAllRecentEvolution = ref(false)
const showAllTimeEvolution = ref(false)
const showAllTimeExpanded = ref(false)

// Reset tab when modal opens
watch(() => props.show, (newVal) => {
  if (newVal) {
    activeTab.value = props.scoutingMode ? 'attributes' : 'stats'
    showAllRecentEvolution.value = false
    showAllTimeEvolution.value = false
    showAllTimeExpanded.value = false
  }
})

// Trade block
const tradeStore = useTradeStore()
const toastStore = useToastStore()
const teamStore = useTeamStore()
const audio = useAudioStore()
const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const headshotEditorReturnStore = useHeadshotEditorReturnStore()

function openHeadshotEditor() {
  if (!canEditHeadshot.value) return
  const pid = normalizedPlayer.value?.id ?? props.player?.id
  if (!pid) return
  // Capture the host route so the editor can return us here and the host
  // view can auto-reopen the modal on the same player.
  headshotEditorReturnStore.capture({
    routeName: route.name,
    routeParams: { ...route.params },
    playerId: pid,
  })
  // Close the modal before navigating so the route change doesn't fight
  // with the modal's open state.
  emit('close')
  router.push({
    name: 'headshot-editor',
    params: { id: route.params.id, playerId: pid },
  })
}

const isOnTradingBlock = computed(() => {
  if (!props.isUserPlayer || !props.player) return false
  const pid = props.player.id ?? props.player.playerId
  return tradeStore.isOnUserTradingBlock(pid)
})

async function toggleTradingBlock() {
  if (!props.campaignId || !props.player) return
  const pid = props.player.id ?? props.player.playerId
  const added = await tradeStore.togglePlayerOnTradingBlock(props.campaignId, pid)
  const name = normalizedPlayer.value?.name || t('Player')
  if (added) {
    toastStore.showSuccess(t('{name} added to trading block', { name }))
  } else {
    toastStore.showSuccess(t('{name} removed from trading block', { name }))
  }
}

function close() {
  emit('close')
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    close()
  }
}

watch(() => props.show, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeydown)
})

// Normalize player data (handles both camelCase and snake_case)
const normalizedPlayer = computed(() => {
  if (!props.player) return null
  const p = props.player
  return {
    id: p.id || p.player_id,
    name: p.name || `${p.firstName || p.first_name} ${p.lastName || p.last_name}`,
    position: p.position,
    secondaryPosition: p.secondaryPosition || p.secondary_position,
    // Recompute live from the player's CURRENT attributes/vitals so the chip
    // promotes from "Role Player" to a specialist archetype the moment the
    // user upgrades enough attribute points to clear a fingerprint
    // threshold. Falls back to the snapshot stored at generation time
    // (`p.archetype`) only if attributes aren't loaded yet — e.g., a stale
    // player record from a cold sync.
    archetype: detectArchetype(p)?.name || p.archetype || p.archetypeName || null,
    jerseyNumber: p.jerseyNumber || p.jersey_number || '00',
    overallRating: p.overallRating || p.overall_rating,
    potentialRating: p.potentialRating || p.potential_rating,
    height: p.height || p.heightFormatted || "6'6\"",
    weight: formatWeight(p.weight || p.weightLbs || p.weight_lbs),
    age: p.age,
    isInjured: p.is_injured || p.isInjured,
    attributes: p.attributes,
    badges: p.badges || [],
    seasonStats: p.season_stats || p.stats || null,
    contract: p.contract || (p.contractSalary ? {
      salary: p.contractSalary || p.contract_salary,
      years_remaining: p.contractYearsRemaining || p.contract_years_remaining
    } : null),
    // Awards
    championships: p.championships || 0,
    finals_mvp_awards: p.finals_mvp_awards || p.finalsMvpAwards || 0,
    conference_finals_mvp_awards: p.conference_finals_mvp_awards || p.conferenceFinalsMvpAwards || 0,
    mvp_awards: p.mvp_awards || p.mvpAwards || 0,
    all_star_selections: p.all_star_selections || p.allStarSelections || 0,
    rookie_of_the_year: p.rookie_of_the_year || p.rookieOfTheYear || 0,
    all_nba_selections: p.all_nba_selections || p.allNbaSelections || 0,
    all_nba_first_team: p.all_nba_first_team || p.allNbaFirstTeam || 0,
    all_rookie_team: p.all_rookie_team || p.allRookieTeam || 0,
    all_defensive_team: p.all_defensive_team || p.allDefensiveTeam || 0,
    dpoy_awards: p.dpoy_awards || p.dpoyAwards || 0,
    awards: p.awards || {},
    // Draft info
    draftInfo: p.draftInfo || null,
    // Fatigue
    fatigue: p.fatigue ?? 0,
    // Upgrade points
    upgrade_points: p.upgrade_points ?? p.upgradePoints ?? 0,
    offense_upgrade_points: p.offense_upgrade_points ?? p.offenseUpgradePoints ?? 0,
    defense_upgrade_points: p.defense_upgrade_points ?? p.defenseUpgradePoints ?? 0,
    // Recent performances
    recentPerformances: p.recent_performances || p.recentPerformances || [],
    careerHighs: p.careerHighs || p.career_highs || null,
    // Morale & personality
    morale: p.morale ?? p.personality?.morale ?? 80,
    personality: p.personality || null,
    personalityTraits: p.personality?.traits || [],
    headshot: p.headshot || null,
    // PlayerAvatar's resolver checks hasCustomHeadshot to decide whether to
    // load the user-edited SVG from IDB. Without this passthrough the modal
    // header always renders the bundled base headshot, even after a save.
    hasCustomHeadshot: p.hasCustomHeadshot ?? p.has_custom_headshot ?? false,
  }
})

// Badge synergy activation data
const activatedBadgeData = computed(() => {
  if (!normalizedPlayer.value || !props.lineupPlayers.length) {
    return { activatedIds: new Set(), synergyDetails: new Map() }
  }
  return getActivatedBadges(normalizedPlayer.value, props.lineupPlayers)
})

function isBadgeActivated(badgeId) {
  return activatedBadgeData.value.activatedIds.has(badgeId)
}

function getBadgeSynergyTooltip(badge) {
  const details = activatedBadgeData.value.synergyDetails.get(badge.id)
  if (!details?.length) return ''
  return details.map(d => t('⚡ {synergy} (w/ {partner})', { synergy: tDynamic(d.synergyName), partner: d.partnerName })).join('\n')
}

// Offense/Defense upgrade point pools
const offenseUpgradePoints = computed(() =>
  normalizedPlayer.value?.offense_upgrade_points ?? normalizedPlayer.value?.offenseUpgradePoints ?? 0
)
const defenseUpgradePoints = computed(() =>
  normalizedPlayer.value?.defense_upgrade_points ?? normalizedPlayer.value?.defenseUpgradePoints ?? 0
)
const hasOffenseUpgradePoints = computed(() =>
  props.canUpgrade && offenseUpgradePoints.value >= 1.0
)
const hasDefenseUpgradePoints = computed(() =>
  props.canUpgrade && defenseUpgradePoints.value >= 1.0
)
// Legacy compat
const hasUpgradePoints = computed(() => hasOffenseUpgradePoints.value || hasDefenseUpgradePoints.value)
const upgradePoints = computed(() => offenseUpgradePoints.value + defenseUpgradePoints.value)
// Whole points actually spendable — fractional points across pools don't combine
const spendableUpgradePoints = computed(() =>
  props.canUpgrade
    ? Math.floor(offenseUpgradePoints.value) + Math.floor(defenseUpgradePoints.value)
    : 0
)
// A player who has reached their ceiling (overall === potential) can't be
// improved further, so the upgrade-points box is hidden for them.
const isPotentialMaxed = computed(() => {
  const overall = normalizedPlayer.value?.overallRating
  const potential = normalizedPlayer.value?.potentialRating
  return overall != null && potential != null && overall >= potential
})

// Whether an attribute has hit ITS OWN growth ceiling. Must use the same
// per-attribute cap the store enforces (attributeCaps[category][attr], scalar
// potential fallback for legacy saves) — gating on scalar potential alone
// rendered a + button that upgradePlayerAttribute always rejected.
function attrAtCap(category, attrKey, value) {
  return value >= getAttrCap(props.player, category, attrKey)
}

// Handle upgrade button click
function handleUpgrade(category, attrKey) {
  const pool = (category === 'defense') ? 'defense' : 'offense'
  emit('upgrade-attribute', {
    playerId: props.player.id,
    category,
    attribute: attrKey,
    pool
  })
}

// ----- Upgrade-point purchase (tokens → +1 to a pool) -----
// Mirrors the team-store implementation. Keep in lockstep with
// `MANUAL_UPGRADE_BUMP` / `UPGRADE_POINT_PRICES` in `frontend/src/stores/team.js`.
const UPGRADE_POINT_PRICES = [500, 500, 500]
const UPGRADE_POINT_MAX_PER_POOL = 3
const MANUAL_UPGRADE_BUMP = 0.4

function _seasonPurchases(player, year) {
  const existing = player?.seasonUpgradePurchases ?? player?.season_upgrade_purchases ?? null
  if (existing && existing.year === year) return existing
  return { year, offense: 0, defense: 0 }
}

function _headroom(player) {
  // Same shape as `_getUpgradeHeadroom` in stores/team.js: each spent point
  // bumps the unrounded overall by MANUAL_UPGRADE_BUMP, so the number of
  // additional points the player can absorb is
  // floor((potential − exact − pending × bump) / bump).
  if (!player) return 0
  const exact = typeof player._overallExact === 'number'
    ? player._overallExact
    : (player.overall_rating ?? player.overallRating ?? 0)
  const potential = player.potential_rating ?? player.potentialRating ?? 99
  const pending = (player.offense_upgrade_points ?? player.offenseUpgradePoints ?? 0)
                + (player.defense_upgrade_points ?? player.defenseUpgradePoints ?? 0)
  const remainingOvr = Math.max(0, potential - exact - pending * MANUAL_UPGRADE_BUMP)
  return Math.floor(remainingOvr / MANUAL_UPGRADE_BUMP)
}

function _purchaseInfo(player, pool, year, userTokens) {
  if (!player) return null
  const purchases = _seasonPurchases(player, year)
  const purchasesInPool = purchases[pool] ?? 0
  const remainingInPool = Math.max(0, UPGRADE_POINT_MAX_PER_POOL - purchasesInPool)
  const headroom = _headroom(player)
  const reachedSeasonCap = purchasesInPool >= UPGRADE_POINT_MAX_PER_POOL
  const noHeadroom = headroom < 1
  const price = reachedSeasonCap ? null : UPGRADE_POINT_PRICES[Math.min(purchasesInPool, UPGRADE_POINT_PRICES.length - 1)]
  const insufficientTokens = price != null && userTokens < price
  return {
    price,
    purchasesInPool,
    remainingInPool,
    headroom,
    reachedSeasonCap,
    noHeadroom,
    insufficientTokens,
    canPurchase: !reachedSeasonCap && !noHeadroom && !insufficientTokens,
  }
}

const offensePurchaseInfo = computed(() =>
  _purchaseInfo(normalizedPlayer.value, 'offense', props.currentSeasonYear, props.userTokens)
)
const defensePurchaseInfo = computed(() =>
  _purchaseInfo(normalizedPlayer.value, 'defense', props.currentSeasonYear, props.userTokens)
)

// Pending purchase modal state. Set by handlePurchaseUpgradePoint when the
// user taps Buy on an attribute pool; cleared on Cancel or after Confirm
// fires the actual emit. Holds enough info to render the confirmation copy
// without re-deriving from the original info object.
const pendingUpgradePurchase = ref(null) // { pool, price, label }
const upgradePurchaseInFlight = ref(false)

function handlePurchaseUpgradePoint(pool) {
  const info = pool === 'defense' ? defensePurchaseInfo.value : offensePurchaseInfo.value
  if (!info?.canPurchase) return
  pendingUpgradePurchase.value = {
    pool,
    price: info.price,
    label: pool === 'defense' ? t('Defense') : t('Offense'),
  }
}

function cancelUpgradePurchase() {
  if (upgradePurchaseInFlight.value) return
  pendingUpgradePurchase.value = null
}

function confirmUpgradePurchase() {
  const pending = pendingUpgradePurchase.value
  if (!pending || upgradePurchaseInFlight.value) return
  upgradePurchaseInFlight.value = true
  emit('purchase-upgrade-point', {
    playerId: props.player.id,
    pool: pending.pool,
    price: pending.price,
  })
  // Parent's handler is async-ish (token deduction → IDB save) but the
  // child has no way to await it; close the modal immediately so the
  // user gets snappy feedback. The button below them will reflect the
  // new pool count + price as soon as the parent re-emits the updated
  // player record.
  pendingUpgradePurchase.value = null
  upgradePurchaseInFlight.value = false
}

function purchaseTooltip(info) {
  if (!info) return ''
  if (info.reachedSeasonCap) return t('Season cap reached (3/3 purchases)')
  if (info.noHeadroom) return t('Overall is already at potential')
  if (info.insufficientTokens) return t('Need {n} tokens', { n: info.price.toLocaleString() })
  return t('Buy +1 for {n} tokens', { n: info.price.toLocaleString() })
}

function formatTokens(n) {
  if (n == null) return ''
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  return String(n)
}

// Season history stats table.
// Current-season team label: the player's CURRENT team first, then any other
// team he recorded stats for this season (mid-season trades), most recent
// first — e.g. traded DET→POR renders "POR/DET"; a second trade to NYK renders
// "NYK/POR/DET". Old saves without the tracked list fall back to the single
// current abbreviation exactly as before.
const currentSeasonTeamLabel = computed(() => {
  const p = props.player
  if (!p) return ''
  const currentAbbr = p.teamAbbreviation || p.team_abbreviation || ''
  const recorded = p.season_stats?.teamsAbbrs
  if (!Array.isArray(recorded) || recorded.length === 0) return currentAbbr
  const others = [...new Set(recorded)].filter(a => a && a !== currentAbbr).reverse()
  return [currentAbbr, ...others].filter(Boolean).join('/') || currentAbbr
})

const seasonStatsRows = computed(() => {
  if (!props.player) return []
  const p = props.player
  return buildSeasonStatsTable(
    p.seasonHistory,
    p.season_stats,
    props.currentSeasonYear,
    currentSeasonTeamLabel.value,
    p.season_playoff_stats
  )
})

// Origin (school or international club) shown in the History tab. Reads
// both camelCase and snake_case in case a legacy IndexedDB record still
// has the underscore variant from an older write path. Returns null when
// neither field is populated so the History section hides cleanly on a
// player who pre-dates the country/college fields.
const playerOrigin = computed(() => {
  const p = props.player
  if (!p) return null
  const school = p.college ?? p.school ?? null
  const country = p.country ?? null
  if (!school && !country) return null
  return { school: school || '—', country }
})

// Career trade log (player.tradeLog, stamped by every trade path) — newest
// first. Old saves have no log; the section hides.
const tradeHistoryList = computed(() => {
  const log = props.player?.tradeLog ?? props.player?.trade_log ?? []
  return Array.isArray(log) ? [...log].reverse() : []
})

function formatTradeLogDate(entry) {
  const d = entry?.date ? String(entry.date).split('T')[0].split(' ')[0] : null
  if (!d) return entry?.seasonYear ?? ''
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
}

// Fatigue helpers
const fatiguePercent = computed(() => Math.round(normalizedPlayer.value?.fatigue ?? 0))
const isOverFatigued = computed(() => fatiguePercent.value >= 70)

function getFatigueColor(fatigue) {
  if (fatigue >= 70) return 'var(--color-error)'
  if (fatigue >= 50) return 'var(--color-warning)'
  return 'var(--color-success)'
}

// Morale helpers
const moraleValue = computed(() => normalizedPlayer.value?.morale ?? 80)

// "Coach Meeting" action — bumps morale +30, consumes one of the head coach's
// per-season actions (or buys an extra with tokens once the budget is gone).
const showCoachMeetingModal = ref(false)
const coachMeetingMode = ref('spend') // 'spend' | 'buy'
const meetingInProgress = ref(false)

const coachActionsLeft = computed(() => props.coach?.actionsRemaining ?? 0)
const coachActionBudget = computed(() => getCoachActionBudget(props.coach))
const coachMeetingExtraCost = COACH_MEETING_EXTRA_COST
// Auto-hide on opponent / scouting / free-agent contexts — coach meetings
// only apply to players currently on the user team.
const playerIsFreeAgent = computed(() => (
  props.player?.isFreeAgent === 1 || props.player?.is_free_agent === 1
))
const canShowCoachMeeting = computed(() =>
  props.isUserPlayer && !props.scoutingMode && !playerIsFreeAgent.value
)
// Headshot editing is only for players actually on the USER's roster — never
// free agents or scouted AI players (the free-agents tab opens this modal with
// isUserPlayer=true, so the free-agent guard is what keeps editing off them).
const canEditHeadshot = computed(() =>
  props.isUserPlayer
  && !props.scoutingMode
  && !playerIsFreeAgent.value
  && authStore.hasFeature('headshot_editor')
)

// Roster Editor IAP perk: owners may edit ONLY flavor data — history (bio &
// origin) and personality — for ANY player league-wide (incl. AI teams and
// free agents; it's cosmetic data). Hidden in scouting mode so it can't leak
// prospect reveal info. Attributes/badges/contracts stay non-editable here.
const canEditFlavor = computed(() =>
  !props.scoutingMode
  && !!props.campaignId
  && authStore.hasFeature('custom_roster')
)

const editingHistory = ref(false)
const editingPersonality = ref(false)
const flavorSaving = ref(false)
// Latest authorable draft year = the campaign's current season (a current-year
// draftee IS the rookie class); 2026 fallback matches the new-campaign baseline.
const maxDraftYear = computed(() => props.currentSeasonYear ?? 2026)
const historyForm = reactive({ college: '', country: '', draftRound: null, draftPick: 1, draftYear: null, careerSeasons: 0 })
// Morale is deliberately NOT editable here — it's a sim-managed stat (games,
// coach meetings, streaks); flavor editing covers traits/chemistry/profile.
const personalityForm = reactive({ traits: [], chemistry: 75, mediaProfile: 'normal' })

function startHistoryEdit() {
  const p = props.player ?? {}
  historyForm.college = p.college ?? p.school ?? ''
  historyForm.country = p.country ?? ''
  const di = p.draftInfo ?? null
  historyForm.draftRound = p.draftRound ?? di?.round ?? null
  historyForm.draftPick = p.draftPick ?? di?.pick ?? 1
  historyForm.draftYear = p.draftYear ?? di?.year ?? maxDraftYear.value
  historyForm.careerSeasons = p.careerSeasons ?? p.career_seasons ?? 0
  editingHistory.value = true
}

function startPersonalityEdit() {
  const pers = props.player?.personality ?? {}
  personalityForm.traits = Array.isArray(pers.traits) ? [...pers.traits] : []
  personalityForm.chemistry = pers.chemistry ?? 75
  personalityForm.mediaProfile = ['low_key', 'normal', 'high_profile'].includes(pers.mediaProfile)
    ? pers.mediaProfile : 'normal'
  editingPersonality.value = true
}

function toggleFlavorTrait(trait) {
  const i = personalityForm.traits.indexOf(trait)
  if (i >= 0) personalityForm.traits.splice(i, 1)
  else if (personalityForm.traits.length < 3) personalityForm.traits.push(trait)
}

async function saveHistoryEdit() {
  if (flavorSaving.value) return
  flavorSaving.value = true
  try {
    const pid = props.player.id ?? props.player.playerId
    const patch = await teamStore.updatePlayerFlavor(props.campaignId, pid, {
      college: historyForm.college,
      country: historyForm.country,
      careerSeasons: Number(historyForm.careerSeasons),
      draft: historyForm.draftRound
        ? { year: historyForm.draftYear, round: historyForm.draftRound, pick: historyForm.draftPick }
        : null,
    })
    Object.assign(props.player, patch)
    editingHistory.value = false
    toastStore.showSuccess(t('Player history updated'))
  } catch (err) {
    toastStore.showError(err?.message || t('Failed to update history'))
  } finally {
    flavorSaving.value = false
  }
}

async function savePersonalityEdit() {
  if (flavorSaving.value) return
  flavorSaving.value = true
  try {
    const pid = props.player.id ?? props.player.playerId
    const patch = await teamStore.updatePlayerFlavor(props.campaignId, pid, {
      personality: {
        traits: personalityForm.traits,
        chemistry: Number(personalityForm.chemistry),
        mediaProfile: personalityForm.mediaProfile,
      },
    })
    Object.assign(props.player, patch)
    editingPersonality.value = false
    toastStore.showSuccess(t('Personality updated'))
  } catch (err) {
    toastStore.showError(err?.message || t('Failed to update personality'))
  } finally {
    flavorSaving.value = false
  }
}
const coachMeetingDisabledReason = computed(() => {
  if (!props.coach) return t('Sign a coach first')
  if (moraleValue.value >= 100) return t('Morale already maxed')
  if (meetingInProgress.value) return t('Working…')
  if (coachActionsLeft.value === 0 && (props.userTokens ?? 0) < COACH_MEETING_EXTRA_COST) {
    return t('Out of actions and tokens')
  }
  return null
})
const coachMeetingLabel = computed(() => (
  coachActionsLeft.value > 0
    ? t('Coach Meeting · {n} left', { n: coachActionsLeft.value })
    : t('Coach Meeting · {n} tokens', { n: COACH_MEETING_EXTRA_COST })
))

// -----------------------------------------------------------------------
// Player Training (idle-style badge reward)
// -----------------------------------------------------------------------
// Real-time tick. Bumping this ref every 30s causes the time-relative
// computeds below (msUntilTrainingReady, trainingLabel, trainingReady)
// to re-evaluate without manually forcing a refresh. The watcher on
// `props.show` start/stops the interval so a closed modal isn't paying
// the cost.
const _trainingNow = ref(Date.now())
let _trainingTickHandle = null

const trainBudgetLeft = computed(() => props.coach?.trainActionsRemaining ?? 0)
const trainBudgetTotal = computed(() => getCoachTrainBudget(props.coach))

const activeTraining = computed(() => props.coach?.activeTraining ?? null)
const trainingForThisPlayer = computed(() => (
  !!activeTraining.value && activeTraining.value.playerId === props.player?.id
))
const trainingForOtherPlayer = computed(() => (
  !!activeTraining.value && activeTraining.value.playerId !== props.player?.id
))
const trainingMsLeft = computed(() => {
  if (!activeTraining.value?.endsAt) return null
  void _trainingNow.value  // dependency for reactive re-evaluation
  return Math.max(0, new Date(activeTraining.value.endsAt).getTime() - Date.now())
})
// Only fires when the FINISHED training belongs to the player whose modal
// is open. Previously this ignored playerId, so any time the team had a
// claim-ready session the dot appeared on every modal we opened.
const trainingReady = computed(() => trainingForThisPlayer.value && trainingMsLeft.value === 0)
// In progress = this player's session is still counting down → show the timer.
const trainingInProgress = computed(() => trainingForThisPlayer.value && trainingMsLeft.value > 0)

// Pretty "Xh Ym" / "Xm Ys" countdown.
function formatTrainingCountdown(ms) {
  if (ms == null) return ''
  if (ms <= 0) return t('Ready!')
  const totalSeconds = Math.ceil(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours >= 1) return `${hours}h ${minutes}m`
  const seconds = totalSeconds % 60
  if (minutes >= 1) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

// Pool of badges/upgrades available for the player. Used both by the
// hide-when-empty gate and (server-side) by claimTrainingReward.
const trainingPool = computed(() => {
  if (!props.player) return []
  return getBadgeStoreEntries(props.player).filter(e => e.nextLevel)
})

const canShowTrain = computed(() => (
  props.isUserPlayer
  && !props.scoutingMode
  && !playerIsFreeAgent.value
  && !!props.coach
  && props.campaignId != null
  && trainingPool.value.length > 0
))

const trainDisabledReason = computed(() => {
  if (!props.coach) return t('Sign a coach first')
  if (trainingForOtherPlayer.value) return t('Another training is in progress')
  if (trainingForThisPlayer.value) return null  // handled by Claim/Countdown UI
  if (trainBudgetLeft.value <= 0) return t('No training actions left this season')
  if (trainingPool.value.length === 0) return t('No badges left to train into')
  return null
})

const trainInProgress = ref(false)

async function handleStartTraining() {
  if (!props.campaignId || !props.player?.id) return
  if (trainInProgress.value) return
  trainInProgress.value = true
  audio.suppressClickSound() // affirmation on success instead of the generic tap
  try {
    await teamStore.startTrainingSession(props.campaignId, props.player.id)
    audio.affirm()
    toastStore.showSuccess(t('Training session started'))
  } catch (err) {
    toastStore.showError(err?.message || t('Failed to start training'))
  } finally {
    trainInProgress.value = false
  }
}

async function handleClaimTraining() {
  if (!props.campaignId || !props.player?.id) return
  if (trainInProgress.value) return
  trainInProgress.value = true
  audio.suppressClickSound()
  try {
    const result = await teamStore.claimTrainingReward(props.campaignId, props.player.id)
    if (result?.badge && result.level) {
      audio.affirm()
      const badgeName = result.badge.name ?? result.badgeId
      toastStore.showSuccess(t('🏅 Trained: {badge} → {level}', { badge: tDynamic(badgeName), level: String(result.level).toUpperCase() }), 4500)
    } else {
      // No eligible pool remained — surface gracefully.
      toastStore.showSuccess(t('Training complete (no eligible badges remained)'))
    }
  } catch (err) {
    // Cross-device claim race: another device already claimed this reward
    // while this tab was backgrounded. The store has already silently
    // refreshed the in-memory coach.activeTraining so the button will
    // disappear. Show an informational toast rather than a red "failed"
    // error since the user's data is fine, just out of date.
    if (err?.code === 'ALREADY_CLAIMED') {
      toastStore.showSuccess(t('This reward was already claimed on another device'))
    } else {
      toastStore.showError(err?.message || t('Failed to claim training reward'))
    }
  } finally {
    trainInProgress.value = false
  }
}

// Start/stop a 1-second tick alongside the modal lifecycle so the countdown
// actually ticks down second-by-second while open (a closed modal stops the
// timer so it isn't paying the cost).
watch(() => props.show, (open) => {
  if (open) {
    _trainingNow.value = Date.now()
    if (_trainingTickHandle == null) {
      _trainingTickHandle = setInterval(() => { _trainingNow.value = Date.now() }, 1000)
    }
  } else if (_trainingTickHandle != null) {
    clearInterval(_trainingTickHandle)
    _trainingTickHandle = null
  }
}, { immediate: true })

onUnmounted(() => {
  if (_trainingTickHandle != null) {
    clearInterval(_trainingTickHandle)
    _trainingTickHandle = null
  }
})

function openCoachMeetingModal() {
  if (coachMeetingDisabledReason.value) return
  coachMeetingMode.value = coachActionsLeft.value > 0 ? 'spend' : 'buy'
  showCoachMeetingModal.value = true
}
function confirmCoachMeeting() {
  if (meetingInProgress.value) return
  meetingInProgress.value = true
  emit('hold-coach-meeting', {
    playerId: props.player?.id ?? props.player?.player_id,
    purchasedAction: coachMeetingMode.value === 'buy',
  })
  // Optimistic close — parent handles the async store call + toast feedback.
  // Reset the in-progress flag a tick later so the props refresh first.
  showCoachMeetingModal.value = false
  setTimeout(() => { meetingInProgress.value = false }, 400)
}

// Motivation helpers
const playerMotivations = computed(() => props.player?.motivations ?? null)
const motivationArchetype = computed(() => props.player ? getArchetypeLabel(props.player) : '')
const isContractYear = computed(() => {
  const years = normalizedPlayer.value?.contract?.years_remaining ?? 2
  return years <= 1
})
const retentionPct = computed(() => {
  if (!props.player?.motivations) return null
  return calculateRetentionScore(props.player, {})
})
function getMotivationBarColor(weight) {
  if (weight >= 0.7) return '#f87171' // coral/red
  if (weight >= 0.4) return '#fbbf24' // amber
  return '#6b7280' // muted gray
}
function getRetentionColor(pct) {
  if (pct >= 70) return '#22c55e'
  if (pct >= 40) return '#f59e0b'
  return '#ef4444'
}

function getMoraleLabel(morale) {
  if (morale >= 80) return t('Excellent')
  if (morale >= 50) return t('Good')
  if (morale >= 25) return t('Low')
  return t('Critical')
}

function getMoraleColor(morale) {
  if (morale >= 80) return '#22c55e'
  if (morale >= 50) return '#f59e0b'
  if (morale >= 25) return '#f97316'
  return '#ef4444'
}

// Face icon matching the morale color band — smile for green, meh for the
// amber/orange middle, frown for the red critical bucket.
function getMoraleIcon(morale) {
  if (morale >= 80) return Smile
  if (morale >= 25) return Meh
  return Frown
}

function formatTraitName(trait) {
  if (!trait) return ''
  return trait.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function getTraitDescription(trait) {
  const descriptions = {
    hot_head: t('Morale swings are amplified — reacts strongly to wins and losses'),
    team_player: t('Morale stays more stable — a positive locker room presence'),
    quiet: t('Morale stays more stable — keeps to himself'),
    leader: t('Boosts team chemistry — positive influence on teammates'),
    ball_hog: t('Hurts team chemistry — wants the ball too much'),
    clutch: t('Performs better in high-pressure situations'),
    lazy: t('May not develop as quickly — inconsistent work ethic'),
    hard_worker: t('Develops faster — always in the gym'),
    emotional: t('Morale can swing unpredictably'),
    confident: t('Bounces back from bad games quickly'),
  }
  return descriptions[trait] || t('Affects how the player behaves and responds')
}

// Dynamic Duo detection
const duoPartnerName = computed(() => {
  if (!normalizedPlayer.value || !props.lineupPlayers?.length) return null
  return isPlayerInDynamicDuo(normalizedPlayer.value, props.lineupPlayers)
})

const hasAwards = computed(() => {
  if (!normalizedPlayer.value) return false
  const p = normalizedPlayer.value
  return p.championships > 0 || p.finals_mvp_awards > 0 ||
         p.conference_finals_mvp_awards > 0 || p.mvp_awards > 0 ||
         p.all_star_selections > 0 || p.rookie_of_the_year > 0 ||
         p.dpoy_awards > 0 ||
         p.all_nba_selections > 0 || p.all_rookie_team > 0 ||
         p.all_defensive_team > 0
})

// Award history helpers — format year(s) + tier metadata for award cards.
// Reads from `player.awards = { mvp: [year], all_nba_first: [year], ... }`.
function _formatYears(years) {
  if (!Array.isArray(years) || !years.length) return ''
  const sorted = [...years].sort((a, b) => a - b)
  return sorted.map(y => `'${String(y).slice(-2)}`).join(', ')
}

function getAwardYears(key) {
  const arr = normalizedPlayer.value?.awards?.[key]
  return _formatYears(arr)
}

// Format a season-start year as a season label, e.g. 2025 -> "2025-26".
function _seasonLabel(year) {
  const y = Number(year)
  if (!Number.isFinite(y)) return String(year ?? '')
  return `${y}-${String(y + 1).slice(-2)}`
}

// Per-selection All-Star history for the dedicated History section. Prefers the
// richer awards.all_star_history ({ year, teamAbbr }); falls back to the plain
// awards.all_star years array (older saves) with no team. Most-recent first.
const allStarSelectionList = computed(() => {
  const awards = normalizedPlayer.value?.awards || {}
  const history = Array.isArray(awards.all_star_history) ? awards.all_star_history : null
  const rows = history && history.length
    ? history.map(h => ({ year: Number(h?.year), teamAbbr: h?.teamAbbr ?? '' }))
    : (Array.isArray(awards.all_star) ? awards.all_star : []).map(y => ({ year: Number(y), teamAbbr: '' }))
  return rows
    .filter(r => Number.isFinite(r.year))
    .sort((a, b) => b.year - a.year)
    .map(r => ({ season: _seasonLabel(r.year), teamAbbr: r.teamAbbr }))
})

function getTieredAwardSummary(prefix, tiers) {
  const awards = normalizedPlayer.value?.awards || {}
  const lines = []
  for (const tier of tiers) {
    const years = awards[`${prefix}_${tier}`]
    if (Array.isArray(years) && years.length) {
      lines.push(t('{tier} Team: {years}', { tier: tier === 'first' ? '1st' : tier === 'second' ? '2nd' : '3rd', years: _formatYears(years) }))
    }
  }
  return lines
}

const hasNews = computed(() => props.playerNews && props.playerNews.length > 0)

// Helper functions
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

function getAttrColor(value) {
  if (value >= 90) return 'var(--color-success)'
  if (value >= 80) return '#22D3EE'
  if (value >= 70) return 'var(--color-primary)'
  if (value >= 60) return 'var(--color-warning)'
  return 'var(--color-error)'
}

// Game log helpers
const reversedPerformances = computed(() => {
  const perfs = normalizedPlayer.value?.recentPerformances || []
  return [...perfs].reverse()
})

function formatGameDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })
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

function roundAttr(value) {
  if (value === null || value === undefined) return 0
  return Math.round(value)
}

function formatWeight(weight) {
  if (!weight) return '210'
  const w = parseInt(weight)
  if (w > 400) return Math.round(w / 10)
  return w
}

// Scouting-aware attribute value lookup
function getScoutedAttrValue(attrKey, value) {
  if (!props.scoutingMode) return roundAttr(value)
  // potentialRating: only if 100% scouted
  if (attrKey === 'potentialRating' && !props.isFullyScouted) return '?'
  // Other attributes: check revealedAttributes array
  if (props.revealedAttributes.includes(attrKey)) return roundAttr(value)
  return '?'
}

function isAttrRevealed(attrKey) {
  if (!props.scoutingMode) return true
  if (attrKey === 'potentialRating' && !props.isFullyScouted) return false
  return props.revealedAttributes.includes(attrKey)
}

function getScoutedAttrColor(attrKey, value) {
  if (!isAttrRevealed(attrKey)) return 'var(--color-text-tertiary)'
  return getAttrColor(value)
}

function formatSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1000000) {
    return `$${(salary / 1000000).toFixed(1)}M`
  }
  return `$${(salary / 1000).toFixed(0)}K`
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

function getStat(key) {
  const stats = normalizedPlayer.value?.seasonStats
  if (!stats) return 0
  // Handle both camelCase and snake_case
  return stats[key] || stats[key.replace(/_/g, '')] || 0
}

function formatStat(value, decimals = 1) {
  if (value === null || value === undefined) return '0'
  const num = parseFloat(value)
  return isNaN(num) ? '0' : num.toFixed(decimals)
}

// Evolution helpers
function formatCategoryName(category) {
  if (!category) return ''
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function getEvolutionColor(change) {
  if (change > 0) return 'var(--color-success)'
  if (change < 0) return 'var(--color-error)'
  return 'var(--color-text-secondary)'
}

function formatChange(change) {
  if (change > 0) return `+${change.toFixed(1)}`
  return change.toFixed(1)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="show"
        class="modal-overlay"
        @click.self="close"
      >
        <div v-if="normalizedPlayer" class="modal-container">
          <!-- Modal Header -->
          <header class="modal-header">
            <div class="modal-header-left">
              <button
                v-if="backButton"
                class="back-button"
                @click="backButton.handler"
              >
                <!-- i18n-ignore (arrow entity; label supplied by parent) -->
                &larr; {{ $tDynamic(backButton.label) }}
              </button>
              <h2 class="modal-title">{{ $t('Player Details') }}</h2>
            </div>
            <button class="btn-close" @click="close" aria-label="Close">
              <X :size="20" />
            </button>
          </header>

          <!-- Modal Content (Scrollable) -->
          <main class="modal-content">
            <!-- Player Header Card -->
            <div class="player-modal-header" :class="{ 'injured-header': normalizedPlayer.isInjured }" data-tour="pdm-header">
              <div class="header-top-row">
                <div class="modal-player-avatar">
                  <PlayerAvatar :player="normalizedPlayer" :size="84" class="avatar-icon" />
                  <button
                    v-if="canEditHeadshot"
                    type="button"
                    class="edit-headshot-overlay"
                    :title="$t('Edit headshot')"
                    @click.stop="openHeadshotEditor"
                  >
                    <Brush :size="13" />
                  </button>
                </div>
                <div class="header-rating-corner">
                  <span class="ovr-label">OVR</span>
                  <template v-if="scoutingMode && !revealedAttributes.includes('overallRating')">
                    <div class="unknown-rating-modal">?</div>
                  </template>
                  <StatBadge v-else :value="normalizedPlayer.overallRating" size="lg" />
                  <span v-if="normalizedPlayer.isInjured" class="injury-badge-modal">{{ $t('INJ') }}</span>
                  <button
                    v-if="isUserPlayer && campaignId && !playerIsFreeAgent"
                    class="trade-block-toggle"
                    :class="{ active: isOnTradingBlock }"
                    data-tour="pdm-trade-toggle"
                    @click.stop="toggleTradingBlock"
                    :title="isOnTradingBlock ? $t('Remove from trading block') : $t('Add to trading block')"
                  >
                    <Repeat :size="14" />
                  </button>
                </div>
                <div class="player-card-info">
                  <h3 class="player-card-name" :class="{ 'injured-name': normalizedPlayer.isInjured }">
                    {{ normalizedPlayer.name }}
                  </h3>
                  <div class="player-card-meta">
                    <span
                      class="position-badge"
                      :style="{ backgroundColor: getPositionColor(normalizedPlayer.position) }"
                    >
                      {{ normalizedPlayer.position }}
                    </span>
                    <span
                      v-if="normalizedPlayer.secondaryPosition"
                      class="position-badge secondary"
                      :style="{ backgroundColor: getPositionColor(normalizedPlayer.secondaryPosition) }"
                    >
                      {{ normalizedPlayer.secondaryPosition }}
                    </span>
                    <span v-if="normalizedPlayer.isInjured" class="injury-tag">{{ $t('Injured') }}</span>
                    <span v-else class="player-card-jersey">#{{ normalizedPlayer.jerseyNumber }}</span>
                    <!-- Scout Button (scouting page) -->
                    <button
                      v-if="scoutingMode && !isFullyScouted"
                      class="header-scout-btn"
                      :disabled="scoutingPoints < 1 || scoutingInProgress"
                      @click.stop="emit('scout-player', player)"
                    >
                      <Binoculars :size="14" />
                      {{ $t('Scout') }}
                    </button>
                  </div>
                  <div class="player-card-bio">
                    {{ $t('{h} · {w} lbs · Age {a}', { h: normalizedPlayer.height, w: normalizedPlayer.weight, a: normalizedPlayer.age || 25 }) }}
                  </div>
                  <!-- Archetype + morale row. Archetype chip (populated by
                       `pickBadgesByFit` at generation time, sourced from
                       `engine/data/archetypes.js`) reads as the player's
                       canonical NBA identity; morale chip rides on the
                       right of the same row so both quick-read indicators
                       sit between the vitals and the action buttons.
                       Morale's scouting-gate behavior is unchanged. -->
                  <div
                    v-if="normalizedPlayer.archetype || !scoutingMode || moraleRevealed"
                    class="archetype-row"
                  >
                    <span
                      v-if="normalizedPlayer.archetype"
                      class="archetype-chip"
                      :title="$t('Player archetype: {a}', { a: $tDynamic(normalizedPlayer.archetype) })"
                    >
                      {{ $tDynamic(normalizedPlayer.archetype) }}
                    </span>
                    <div
                      v-if="!scoutingMode || moraleRevealed"
                      class="morale-chip"
                      :style="{ '--morale-color': getMoraleColor(moraleValue) }"
                      :title="$t('Morale: {label} ({n}/100)', { label: getMoraleLabel(moraleValue), n: moraleValue })"
                    >
                      <component :is="getMoraleIcon(moraleValue)" :size="12" :stroke-width="2.25" />
                      <span class="morale-chip-label">{{ getMoraleLabel(moraleValue) }}</span>
                      <span class="morale-chip-value">{{ moraleValue }}</span>
                    </div>
                  </div>
                  <!-- Sign button (free agents) — suppressed in draft room
                       contexts since the player hasn't been drafted yet. -->
                  <div v-if="playerIsFreeAgent && !scoutingMode && !inDraft" class="header-contract-actions">
                    <button
                      class="header-action-btn sign"
                      @click.stop="emit('sign-player', player)"
                    >
                      <UserPlus :size="13" />
                      {{ $t('Sign') }}
                    </button>
                  </div>
                  <!-- Contract Action Buttons (finances page) -->
                  <div v-if="showContractActions && !playerIsFreeAgent" class="header-contract-actions">
                    <button
                      v-if="isExpiringContract && !resignDisabled"
                      class="header-action-btn resign"
                      @click.stop="emit('resign-player', player)"
                    >
                      <RefreshCw :size="13" />
                      {{ $t('Re-sign') }}
                    </button>
                    <button
                      v-if="!(player?.isFreeAgent === 1 || player?.is_free_agent === 1)"
                      class="header-action-btn drop"
                      @click.stop="emit('drop-player', player)"
                    >
                      <UserMinus :size="13" />
                      {{ $t('Drop') }}
                    </button>
                  </div>
                  <!-- Draft button (draft room — shown only on the user's pick) -->
                  <div v-if="canDraft" class="header-draft-action">
                    <button class="header-action-btn draft" @click.stop="emit('draft-player', player)">
                      <Check :size="14" />
                      {{ $t('Draft Player') }}
                    </button>
                  </div>
                </div>
              </div>
              <!-- Fatigue Meter (hidden in scouting mode) -->
              <div v-if="!scoutingMode" class="fatigue-meter-container" data-tour="pdm-fatigue">
                <div class="fatigue-meter-label">
                  <span>{{ $t('Fatigue') }}</span>
                  <span class="fatigue-value" :class="{ warning: fatiguePercent >= 50 && fatiguePercent < 70, high: fatiguePercent >= 70 }">{{ fatiguePercent }}%</span>
                </div>
                <div class="fatigue-meter-bar">
                  <div
                    class="fatigue-meter-fill"
                    :style="{
                      width: fatiguePercent + '%',
                      backgroundColor: getFatigueColor(fatiguePercent)
                    }"
                  ></div>
                </div>
                <div v-if="isOverFatigued" class="fatigue-warning" :title="$t('Attributes affected by fatigue')">
                  <AlertTriangle :size="14" />
                </div>
              </div>
            </div>

            <div v-if="duoPartnerName" class="dynamic-duo-badge">
              <Users :size="14" />
              <span>{{ $t('Dynamic Duo w/ {name}', { name: duoPartnerName }) }}</span>
            </div>

            <!-- Badges Preview -->
            <div v-if="normalizedPlayer.badges?.length > 0" class="badges-preview" data-tour="pdm-badges">
              <div class="badges-grid-preview">
                <template v-if="scoutingMode && !badgesRevealed">
                  <div
                    v-for="(badge, i) in normalizedPlayer.badges.slice(0, 6)"
                    :key="i"
                    class="badge-chip unknown-badge"
                  >
                    <Lock :size="10" />
                    <span class="badge-name-preview">???</span>
                  </div>
                  <span v-if="normalizedPlayer.badges.length > 6" class="more-badges">
                    {{ $t('+{n} more', { n: normalizedPlayer.badges.length - 6 }) }}
                  </span>
                </template>
                <template v-else>
                  <div
                    v-for="badge in normalizedPlayer.badges.slice(0, 6)"
                    :key="badge.id"
                    class="badge-chip"
                    :class="{ 'synergy-active': isBadgeActivated(badge.id) }"
                    :style="{ borderColor: isBadgeActivated(badge.id) ? '#00E5FF' : getBadgeLevelColor(badge.level) }"
                    :title="getBadgeSynergyTooltip(badge)"
                  >
                    <Zap v-if="isBadgeActivated(badge.id)" :size="10" class="synergy-icon" />
                    <span class="badge-level-icon" :style="{ color: getBadgeLevelColor(badge.level) }">
                      {{ badge.level === 'hof' ? 'HOF' : badge.level.charAt(0).toUpperCase() }}
                    </span>
                    <span class="badge-name-preview">{{ $tDynamic(formatBadgeName(badge)) }}</span>
                  </div>
                  <span v-if="normalizedPlayer.badges.length > 6" class="more-badges">
                    {{ $t('+{n} more', { n: normalizedPlayer.badges.length - 6 }) }}
                  </span>
                </template>
              </div>
            </div>

            <!-- Tab Navigation -->
            <div class="modal-tabs" data-tour="pdm-tabs">
              <button
                v-if="!scoutingMode"
                class="tab-btn"
                :class="{ active: activeTab === 'stats' }"
                @click="activeTab = 'stats'"
              >
                {{ $t('Stats') }}
              </button>
              <button
                class="tab-btn"
                data-tour="pdm-tab-attributes"
                :class="{ active: activeTab === 'attributes' }"
                @click="activeTab = 'attributes'"
              >
                {{ $t('Attributes') }}
                <span v-if="spendableUpgradePoints > 0" class="tab-badge">{{ spendableUpgradePoints }}</span>
              </button>
              <button
                class="tab-btn"
                :class="{ active: activeTab === 'badges' }"
                @click="activeTab = 'badges'"
              >
                {{ $t('Badges') }}
                <span
                  v-if="trainingInProgress"
                  class="train-countdown-tab"
                  :title="$t('Training · {a} remaining', { a: formatTrainingCountdown(trainingMsLeft) })"
                ><Dumbbell :size="10" /><span>{{ formatTrainingCountdown(trainingMsLeft) }}</span></span>
                <span v-else-if="trainingReady" class="train-ready-dot" :title="$t('Training ready to claim')"></span>
              </button>
              <button
                v-if="showGrowth && !scoutingMode"
                class="tab-btn"
                :class="{ active: activeTab === 'growth' }"
                @click="activeTab = 'growth'"
              >
                {{ $t('Growth') }}
              </button>
              <button
                v-if="showHistory"
                class="tab-btn"
                :class="{ active: activeTab === 'history' }"
                @click="activeTab = 'history'"
              >
                {{ $t('History') }}
              </button>
              <button
                class="tab-btn"
                :class="{ active: activeTab === 'morale' }"
                @click="activeTab = 'morale'"
              >
                {{ $t('Morale') }}
              </button>
            </div>

            <!-- Tab Content -->
            <div class="modal-tab-content">
              <!-- Stats Tab -->
              <div v-if="activeTab === 'stats'" class="tab-panel" data-tour="pdm-stats">
                  <div v-if="seasonStatsRows.length > 0" class="game-log-table-wrap">
                    <table class="game-log-table season-history-table">
                      <thead>
                        <tr>
                          <th>{{ $t('Year') }}</th><th>{{ $t('Team') }}</th><th>GP</th>
                          <!-- i18n-ignore (stat abbreviations) -->
                          <th>PPG</th><th>RPG</th><th>APG</th>
                          <!-- i18n-ignore (stat abbreviations) -->
                          <th>SPG</th><th>BPG</th><th>FG%</th>
                          <!-- i18n-ignore (stat abbreviations) -->
                          <th>3P%</th><th>FT%</th><th>MPG</th>
                        </tr>
                      </thead>
                      <tbody>
                        <template v-for="row in seasonStatsRows" :key="row.year">
                          <tr :class="{ 'current-season-row': row.isCurrent }">
                            <td class="season-year-cell">
                              {{ row.year }}<span v-if="row.isCurrent" class="current-tag">*</span>
                            </td>
                            <td>{{ row.team }}</td>
                            <td>{{ row.gp }}</td>
                            <td class="game-log-pts">{{ row.ppg }}</td>
                            <td>{{ row.rpg }}</td>
                            <td>{{ row.apg }}</td>
                            <td>{{ row.spg }}</td>
                            <td>{{ row.bpg }}</td>
                            <td>{{ row.fg_pct }}%</td>
                            <td>{{ row.three_pct }}%</td>
                            <td>{{ row.ft_pct }}%</td>
                            <td>{{ row.mpg }}</td>
                          </tr>
                          <tr v-if="row.playoffStats" class="playoff-subrow">
                            <td class="playoff-label">{{ $t('↳ Playoffs') }}</td>
                            <td>{{ row.playoffStats.team }}</td>
                            <td>{{ row.playoffStats.gp }}</td>
                            <td class="game-log-pts">{{ row.playoffStats.ppg }}</td>
                            <td>{{ row.playoffStats.rpg }}</td>
                            <td>{{ row.playoffStats.apg }}</td>
                            <td>{{ row.playoffStats.spg }}</td>
                            <td>{{ row.playoffStats.bpg }}</td>
                            <td>{{ row.playoffStats.fg_pct }}%</td>
                            <td>{{ row.playoffStats.three_pct }}%</td>
                            <td>{{ row.playoffStats.ft_pct }}%</td>
                            <td>{{ row.playoffStats.mpg }}</td>
                          </tr>
                        </template>
                      </tbody>
                    </table>
                  </div>
                  <div v-else class="empty-state-inline">
                    <p>{{ $t('No season stats yet') }}</p>
                  </div>
                  <!-- Recent Games / Career Highs (secondary tabbed box) -->
                  <div v-if="reversedPerformances.length > 0 || normalizedPlayer.careerHighs" class="recent-performances-section">
                    <div class="stat-subtabs">
                      <button
                        class="stat-subtab-btn"
                        :class="{ active: recentStatsTab === 'recent' }"
                        @click="recentStatsTab = 'recent'"
                      >{{ $t('Recent Games') }}</button>
                      <button
                        class="stat-subtab-btn"
                        :class="{ active: recentStatsTab === 'highs' }"
                        @click="recentStatsTab = 'highs'"
                      >{{ $t('Career Highs') }}</button>
                    </div>

                    <div v-if="recentStatsTab === 'recent'">
                      <div v-if="reversedPerformances.length > 0" class="game-log-table-wrap">
                        <table class="game-log-table">
                          <thead>
                            <tr>
                              <!-- i18n-ignore (OPP is a stat abbreviation) -->
                              <th>{{ $t('Date') }}</th><th>OPP</th><th>{{ $t('Result') }}</th>
                              <th>MIN</th><th>PTS</th><th>REB</th><th>AST</th>
                              <!-- i18n-ignore (stat abbreviations) -->
                              <th>STL</th><th>BLK</th><th>TO</th>
                              <th>FG</th><th>3P</th><th>FT</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="(game, i) in reversedPerformances" :key="i">
                              <td class="game-log-date">{{ typeof game === 'object' ? formatGameDate(game.date) : '—' }}</td>
                              <td class="game-log-opp">{{ typeof game === 'object' ? game.opponent : '—' }}</td>
                              <td :class="typeof game === 'object' && game.won ? 'game-log-win' : 'game-log-loss'">
                                {{ typeof game === 'object' ? (game.won ? 'W' : 'L') : '—' }}
                              </td>
                              <td>{{ typeof game === 'object' ? game.min : '—' }}</td>
                              <td class="game-log-pts">{{ typeof game === 'object' ? game.pts : Math.round(game) }}</td>
                              <td>{{ typeof game === 'object' ? game.reb : '—' }}</td>
                              <td>{{ typeof game === 'object' ? game.ast : '—' }}</td>
                              <td>{{ typeof game === 'object' ? game.stl : '—' }}</td>
                              <td>{{ typeof game === 'object' ? game.blk : '—' }}</td>
                              <td>{{ typeof game === 'object' ? game.to : '—' }}</td>
                              <td>{{ typeof game === 'object' ? `${game.fgm}-${game.fga}` : '—' }}</td>
                              <td>{{ typeof game === 'object' ? `${game.tpm}-${game.tpa}` : '—' }}</td>
                              <td>{{ typeof game === 'object' ? `${game.ftm}-${game.fta}` : '—' }}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div v-else class="empty-state-inline"><p>{{ $t('No recent games yet') }}</p></div>
                    </div>

                    <CareerHighsPanel v-else :career-highs="normalizedPlayer.careerHighs" />
                  </div>
              </div>

              <!-- Attributes Tab -->
              <div v-if="activeTab === 'attributes'" class="tab-panel">
                <!-- Ratings row (scouting mode) -->
                <div v-if="scoutingMode" class="attr-section">
                  <h4 class="attr-section-title">{{ $t('Ratings') }}</h4>
                  <div class="attributes-grid">
                    <div class="attr-row">
                      <span class="attr-name">{{ $t('Overall') }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{
                            width: isAttrRevealed('overallRating') ? `${normalizedPlayer.overallRating}%` : '0%',
                            backgroundColor: getScoutedAttrColor('overallRating', normalizedPlayer.overallRating)
                          }"
                        />
                      </div>
                      <span
                        class="attr-value"
                        :class="{ 'stat-pop': animatingAttributes['overallRating'] }"
                        :style="{ color: getScoutedAttrColor('overallRating', normalizedPlayer.overallRating) }"
                      >{{ getScoutedAttrValue('overallRating', normalizedPlayer.overallRating) }}</span>
                    </div>
                    <div class="attr-row">
                      <span class="attr-name">{{ $t('Potential') }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{
                            width: isAttrRevealed('potentialRating') ? `${normalizedPlayer.potentialRating}%` : '0%',
                            backgroundColor: getScoutedAttrColor('potentialRating', normalizedPlayer.potentialRating)
                          }"
                        />
                      </div>
                      <span
                        class="attr-value"
                        :class="{ 'stat-pop': animatingAttributes['potentialRating'] }"
                        :style="{ color: getScoutedAttrColor('potentialRating', normalizedPlayer.potentialRating) }"
                      >{{ getScoutedAttrValue('potentialRating', normalizedPlayer.potentialRating) }}</span>
                    </div>
                  </div>
                </div>

                <!-- Upgrade Points Banner - dual pools -->
                <div v-if="canUpgrade && !scoutingMode && !isPotentialMaxed" class="upgrade-points-banner" :class="{ 'no-points': upgradePoints === 0 }" data-tour="pdm-upgrade-banner">
                  <div class="upgrade-pools">
                    <div class="pool-item offense-pool" :class="{ 'has-points': offenseUpgradePoints >= 1.0 }">
                      <span class="pool-value">{{ offenseUpgradePoints.toFixed(1) }}</span>
                      <span class="pool-label">{{ $t('Offense') }}</span>
                      <button
                        v-if="isUserPlayer"
                        class="pool-buy-btn"
                        data-tour="pdm-buy-offense"
                        :disabled="!offensePurchaseInfo?.canPurchase"
                        :title="purchaseTooltip(offensePurchaseInfo)"
                        @click="handlePurchaseUpgradePoint('offense')"
                      >
                        <Coins :size="12" />
                        <span>{{ offensePurchaseInfo?.price != null ? formatTokens(offensePurchaseInfo.price) : $t('Max') }}</span>
                      </button>
                    </div>
                    <div class="pool-divider"></div>
                    <div class="pool-item defense-pool" :class="{ 'has-points': defenseUpgradePoints >= 1.0 }">
                      <span class="pool-value">{{ defenseUpgradePoints.toFixed(1) }}</span>
                      <span class="pool-label">{{ $t('Defense') }}</span>
                      <button
                        v-if="isUserPlayer"
                        class="pool-buy-btn"
                        data-tour="pdm-buy-defense"
                        :disabled="!defensePurchaseInfo?.canPurchase"
                        :title="purchaseTooltip(defensePurchaseInfo)"
                        @click="handlePurchaseUpgradePoint('defense')"
                      >
                        <Coins :size="12" />
                        <span>{{ defensePurchaseInfo?.price != null ? formatTokens(defensePurchaseInfo.price) : $t('Max') }}</span>
                      </button>
                    </div>
                  </div>
                  <p class="upgrade-hint">
                    {{ upgradePoints > 0 ? $t('1.0 pts = +1 attribute upgrade') : $t('Earn points through game performance') }}
                  </p>
                </div>

                <!-- Ratings (non-scouting mode) -->
                <div v-if="!scoutingMode" class="attr-section">
                  <h4 class="attr-section-title">{{ $t('Ratings') }}</h4>
                  <div class="attributes-grid">
                    <div class="attr-row">
                      <span class="attr-name">{{ $t('Overall') }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{
                            width: `${normalizedPlayer.overallRating}%`,
                            backgroundColor: getAttrColor(normalizedPlayer.overallRating)
                          }"
                        />
                      </div>
                      <span class="attr-value" :style="{ color: getAttrColor(normalizedPlayer.overallRating) }">
                        {{ normalizedPlayer.overallRating }}
                      </span>
                    </div>
                    <div v-if="normalizedPlayer.potentialRating" class="attr-row">
                      <span class="attr-name">{{ $t('Potential') }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{
                            width: `${normalizedPlayer.potentialRating}%`,
                            backgroundColor: getAttrColor(normalizedPlayer.potentialRating)
                          }"
                        />
                      </div>
                      <span class="attr-value" :style="{ color: getAttrColor(normalizedPlayer.potentialRating) }">
                        {{ normalizedPlayer.potentialRating }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Offensive Attributes -->
                <div v-if="normalizedPlayer.attributes?.offense" class="attr-section" data-tour="pdm-attributes-list">
                  <h4 class="attr-section-title">{{ $t('Offense') }}</h4>
                  <div class="attributes-grid">
                    <div v-for="(value, key) in normalizedPlayer.attributes.offense" :key="key" class="attr-row" :class="{ 'has-upgrade': hasOffenseUpgradePoints && !scoutingMode }">
                      <span class="attr-name">{{ $tDynamic(formatAttrName(key)) }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{
                            width: scoutingMode ? (isAttrRevealed(key) ? `${value}%` : '0%') : `${value}%`,
                            backgroundColor: scoutingMode ? getScoutedAttrColor(key, value) : getAttrColor(value)
                          }"
                        />
                      </div>
                      <span
                        class="attr-value"
                        :class="{ 'stat-pop': animatingAttributes[key] }"
                        :style="{ color: scoutingMode ? getScoutedAttrColor(key, value) : getAttrColor(value) }"
                      >{{ scoutingMode ? getScoutedAttrValue(key, value) : roundAttr(value) }}</span>
                      <span
                        v-if="hasOffenseUpgradePoints && !scoutingMode && attrAtCap('offense', key, value)"
                        class="upgrade-max"
                        :title="$t('At this attribute’s ceiling')"
                      >
                        {{ $t('MAX') }}
                      </span>
                      <button
                        v-else-if="hasOffenseUpgradePoints && !scoutingMode"
                        class="upgrade-btn"
                        :title="$t('Upgrade (+1)')"
                        @click.stop="handleUpgrade('offense', key)"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Defensive Attributes -->
                <div v-if="normalizedPlayer.attributes?.defense" class="attr-section">
                  <h4 class="attr-section-title">{{ $t('Defense') }}</h4>
                  <div class="attributes-grid">
                    <div v-for="(value, key) in normalizedPlayer.attributes.defense" :key="key" class="attr-row" :class="{ 'has-upgrade': hasDefenseUpgradePoints && !scoutingMode }">
                      <span class="attr-name">{{ $tDynamic(formatAttrName(key)) }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{
                            width: scoutingMode ? (isAttrRevealed(key) ? `${value}%` : '0%') : `${value}%`,
                            backgroundColor: scoutingMode ? getScoutedAttrColor(key, value) : getAttrColor(value)
                          }"
                        />
                      </div>
                      <span
                        class="attr-value"
                        :class="{ 'stat-pop': animatingAttributes[key] }"
                        :style="{ color: scoutingMode ? getScoutedAttrColor(key, value) : getAttrColor(value) }"
                      >{{ scoutingMode ? getScoutedAttrValue(key, value) : roundAttr(value) }}</span>
                      <span
                        v-if="hasDefenseUpgradePoints && !scoutingMode && attrAtCap('defense', key, value)"
                        class="upgrade-max"
                        :title="$t('At this attribute’s ceiling')"
                      >
                        {{ $t('MAX') }}
                      </span>
                      <button
                        v-else-if="hasDefenseUpgradePoints && !scoutingMode"
                        class="upgrade-btn"
                        :title="$t('Upgrade (+1)')"
                        @click.stop="handleUpgrade('defense', key)"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Physical Attributes -->
                <div v-if="normalizedPlayer.attributes?.physical" class="attr-section">
                  <h4 class="attr-section-title">{{ $t('Physical') }}</h4>
                  <div class="attributes-grid">
                    <div v-for="(value, key) in normalizedPlayer.attributes.physical" :key="key" class="attr-row">
                      <span class="attr-name">{{ $tDynamic(formatAttrName(key)) }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{
                            width: scoutingMode ? (isAttrRevealed(key) ? `${value}%` : '0%') : `${value}%`,
                            backgroundColor: scoutingMode ? getScoutedAttrColor(key, value) : getAttrColor(value)
                          }"
                        />
                      </div>
                      <span
                        class="attr-value"
                        :class="{ 'stat-pop': animatingAttributes[key] }"
                        :style="{ color: scoutingMode ? getScoutedAttrColor(key, value) : getAttrColor(value) }"
                      >{{ scoutingMode ? getScoutedAttrValue(key, value) : roundAttr(value) }}</span>
                    </div>
                  </div>
                </div>

                <!-- Mental Attributes (Cannot be upgraded) -->
                <div v-if="normalizedPlayer.attributes?.mental" class="attr-section">
                  <h4 class="attr-section-title">
                    {{ $t('Mental') }}
                    <span v-if="canUpgrade && !scoutingMode" class="no-upgrade-hint">{{ $t('(Cannot be upgraded)') }}</span>
                  </h4>
                  <div class="attributes-grid">
                    <div v-for="(value, key) in normalizedPlayer.attributes.mental" :key="key" class="attr-row">
                      <span class="attr-name">{{ $tDynamic(formatAttrName(key)) }}</span>
                      <div class="attr-bar-container">
                        <div
                          class="attr-bar"
                          :style="{
                            width: scoutingMode ? (isAttrRevealed(key) ? `${value}%` : '0%') : `${value}%`,
                            backgroundColor: scoutingMode ? getScoutedAttrColor(key, value) : getAttrColor(value)
                          }"
                        />
                      </div>
                      <span
                        class="attr-value"
                        :class="{ 'stat-pop': animatingAttributes[key] }"
                        :style="{ color: scoutingMode ? getScoutedAttrColor(key, value) : getAttrColor(value) }"
                      >{{ scoutingMode ? getScoutedAttrValue(key, value) : roundAttr(value) }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="!normalizedPlayer.attributes" class="empty-state-modal">
                  <p>{{ $t('No attributes available.') }}</p>
                </div>
              </div>

              <!-- Badges Tab -->
              <div v-if="activeTab === 'badges'" class="tab-panel">
                <div v-if="scoutingMode && !badgesRevealed" class="scouting-locked-section">
                  <Lock :size="24" />
                  <p>{{ $t('Badge data is hidden for draft prospects') }}</p>
                  <span class="locked-hint">{{ $t('Hire a 4-Star Scout with Scouting Facility Lv 4 to unlock') }}</span>
                </div>
                <template v-else>
                  <div v-if="isUserPlayer && !scoutingMode && campaignId" class="badges-store-row">
                    <!-- Train button — opens a real-time idler that grants a
                         random open badge/upgrade when claimed. Primary
                         path to growing a player's badge sheet. Hidden when
                         there's nothing to award OR when no coach is hired.
                         Three states: idle (Train · N left), counting down
                         for THIS player (countdown), counting down for
                         ANOTHER player (disabled chip), and ready-to-claim. -->
                    <template v-if="canShowTrain">
                      <button
                        v-if="!activeTraining"
                        class="badges-train-btn"
                        data-tour="pdm-train-btn"
                        :disabled="!!trainDisabledReason || trainInProgress"
                        :title="trainDisabledReason || $t('Start a real-time training session — earn a random badge or upgrade')"
                        @click="handleStartTraining"
                      >
                        <Dumbbell :size="14" />
                        <span>{{ $t('Train · {n} left', { n: trainBudgetLeft }) }}</span>
                      </button>
                      <template v-else-if="trainingForThisPlayer">
                        <button
                          v-if="trainingReady"
                          class="badges-train-btn is-ready"
                          :disabled="trainInProgress"
                          @click="handleClaimTraining"
                        >
                          <Sparkles :size="14" />
                          <span>{{ $t('Claim Reward') }}</span>
                        </button>
                        <span v-else class="badges-train-countdown" :title="$t('Training in progress · {a} remaining', { a: formatTrainingCountdown(trainingMsLeft) })">
                          <Dumbbell :size="14" />
                          <span>{{ $t('Training · {a}', { a: formatTrainingCountdown(trainingMsLeft) }) }}</span>
                        </span>
                      </template>
                      <span
                        v-else
                        class="badges-train-blocked"
                        :title="$t('A training is already in progress for another player on the roster.')"
                      >
                        <Dumbbell :size="14" />
                        <span>{{ $t('Trainer busy') }}</span>
                      </span>
                    </template>
                    <button class="badges-store-btn" data-tour="pdm-badge-store-btn" @click="showPlayerBadgeStore = true">
                      <ShoppingBag :size="14" />
                      <span>{{ $t('Badge Store') }}</span>
                    </button>
                  </div>

                  <div v-if="normalizedPlayer.badges?.length > 0" class="badges-tab-content" data-tour="pdm-badges-list">
                  <!-- HOF Badges -->
                  <div v-if="normalizedPlayer.badges.filter(b => b.level === 'hof').length > 0" class="badge-level-section">
                    <h4 class="badge-level-title hof">{{ $t('Hall of Fame') }}</h4>
                    <div class="badges-grid-modal">
                      <div
                        v-for="badge in normalizedPlayer.badges.filter(b => b.level === 'hof')"
                        :key="badge.id"
                        class="badge-card-modal hof"
                        :class="{ 'synergy-active': isBadgeActivated(badge.id) }"
                        :title="getBadgeSynergyTooltip(badge)"
                      >
                        <Zap v-if="isBadgeActivated(badge.id)" :size="12" class="synergy-icon" />
                        <span class="badge-icon">{{ $t('HOF') }}</span>
                        <span class="badge-name-modal">{{ $tDynamic(formatBadgeName(badge)) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Gold Badges -->
                  <div v-if="normalizedPlayer.badges.filter(b => b.level === 'gold').length > 0" class="badge-level-section">
                    <h4 class="badge-level-title gold">{{ $t('Gold') }}</h4>
                    <div class="badges-grid-modal">
                      <div
                        v-for="badge in normalizedPlayer.badges.filter(b => b.level === 'gold')"
                        :key="badge.id"
                        class="badge-card-modal gold"
                        :class="{ 'synergy-active': isBadgeActivated(badge.id) }"
                        :title="getBadgeSynergyTooltip(badge)"
                      >
                        <Zap v-if="isBadgeActivated(badge.id)" :size="12" class="synergy-icon" />
                        <span class="badge-icon">G</span>
                        <span class="badge-name-modal">{{ $tDynamic(formatBadgeName(badge)) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Silver Badges -->
                  <div v-if="normalizedPlayer.badges.filter(b => b.level === 'silver').length > 0" class="badge-level-section">
                    <h4 class="badge-level-title silver">{{ $t('Silver') }}</h4>
                    <div class="badges-grid-modal">
                      <div
                        v-for="badge in normalizedPlayer.badges.filter(b => b.level === 'silver')"
                        :key="badge.id"
                        class="badge-card-modal silver"
                        :class="{ 'synergy-active': isBadgeActivated(badge.id) }"
                        :title="getBadgeSynergyTooltip(badge)"
                      >
                        <Zap v-if="isBadgeActivated(badge.id)" :size="12" class="synergy-icon" />
                        <span class="badge-icon">S</span>
                        <span class="badge-name-modal">{{ $tDynamic(formatBadgeName(badge)) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Bronze Badges -->
                  <div v-if="normalizedPlayer.badges.filter(b => b.level === 'bronze').length > 0" class="badge-level-section">
                    <h4 class="badge-level-title bronze">{{ $t('Bronze') }}</h4>
                    <div class="badges-grid-modal">
                      <div
                        v-for="badge in normalizedPlayer.badges.filter(b => b.level === 'bronze')"
                        :key="badge.id"
                        class="badge-card-modal bronze"
                        :class="{ 'synergy-active': isBadgeActivated(badge.id) }"
                        :title="getBadgeSynergyTooltip(badge)"
                      >
                        <Zap v-if="isBadgeActivated(badge.id)" :size="12" class="synergy-icon" />
                        <span class="badge-icon">B</span>
                        <span class="badge-name-modal">{{ $tDynamic(formatBadgeName(badge)) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
                  <div v-else class="empty-state-modal">
                    <p>{{ $t('No badges earned yet.') }}</p>
                    <p class="text-sm text-secondary">
                      <template v-if="isUserPlayer && !scoutingMode">{{ $t('Use the Badge Store above to purchase eligible badges.') }}</template>
                      <template v-else>{{ $t('Badges are earned through gameplay performance.') }}</template>
                    </p>
                  </div>

                  <!-- Available badges dropdown — every badge this player could
                       earn and the tier ceiling for each (same data as the Badge
                       Store). Pinned at the bottom of the Badges tab. -->
                  <div v-if="badgeOptions.length" class="badge-options">
                    <button class="badge-options-toggle" @click="showBadgeOptions = !showBadgeOptions">
                      <span>{{ $t('Badge options — owned & available ({n})', { n: badgeOptions.length }) }}</span>
                      <ChevronDown :size="16" class="badge-options-chevron" :class="{ open: showBadgeOptions }" />
                    </button>
                    <div v-if="showBadgeOptions" class="badge-options-panel">
                      <p class="badge-options-hint">
                        {{ $t("Each badge's ceiling depends on this player's position fit, attribute fit, and potential. Filled dots are tiers they already hold, outlined dots are still reachable, and greyed dots are locked.") }}
                      </p>
                      <div v-for="grp in badgeOptionsByCategory" :key="grp.category" class="badge-options-cat">
                        <h5 class="badge-options-cat-title">{{ $tDynamic(BADGE_CATEGORY_LABELS[grp.category] || grp.category) }}</h5>
                        <div
                          v-for="entry in grp.entries"
                          :key="entry.badge.id"
                          class="badge-option-row"
                          :title="$tDynamic(entry.badge.description || '')"
                        >
                          <span class="badge-option-name">{{ $tDynamic(entry.badge.name) }}</span>
                          <span class="badge-option-levels">
                            <span
                              v-for="lvl in PLAYER_BADGE_LEVELS"
                              :key="lvl"
                              class="badge-option-dot"
                              :class="badgeDotClass(entry, lvl)"
                              :style="badgeDotClass(entry, lvl).owned ? { backgroundColor: PLAYER_BADGE_TIER_COLORS[lvl], borderColor: PLAYER_BADGE_TIER_COLORS[lvl] } : {}"
                              :title="$tDynamic(badgeLevelLabel(lvl))"
                            />
                            <span class="badge-option-max" :style="{ color: PLAYER_BADGE_TIER_COLORS[entry.maxLevel] }">
                              {{ $t('max {a}', { a: $tDynamic(badgeLevelLabel(entry.maxLevel)) }) }}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>

              <!-- Growth Tab (Season Evolution) -->
              <div v-if="activeTab === 'growth' && showGrowth" class="tab-panel">
                <div class="evolution-section" data-tour="pdm-growth">
                  <!-- Recent Evolution (Last 7 Days) -->
                  <div class="evolution-subsection" data-tour="pdm-growth-recent">
                    <h5 class="evolution-subtitle">{{ $t('Recent (Last 7 Days)') }}</h5>
                    <div v-if="recentEvolution.length > 0" class="evolution-list">
                      <div
                        v-for="(item, index) in (showAllRecentEvolution ? recentEvolution : recentEvolution.slice(0, 10))"
                        :key="`recent-${item.category}-${item.attribute}`"
                        class="evolution-item"
                      >
                        <span class="evolution-category">{{ $tDynamic(formatCategoryName(item.category)) }}</span>
                        <span class="evolution-attr">{{ $tDynamic(formatAttrName(item.attribute)) }}</span>
                        <span class="evolution-change" :style="{ color: getEvolutionColor(item.totalChange) }">
                          {{ formatChange(item.totalChange) }}
                        </span>
                      </div>
                      <button
                        v-if="recentEvolution.length > 10"
                        class="evolution-toggle"
                        @click="showAllRecentEvolution = !showAllRecentEvolution"
                      >
                        {{ showAllRecentEvolution ? $t('Show Less') : $t('Show All ({n})', { n: recentEvolution.length }) }}
                      </button>
                    </div>
                    <div v-else class="evolution-empty">
                      {{ $t('No recent development activity') }}
                    </div>
                  </div>

                  <!-- All-Time Evolution -->
                  <div class="evolution-subsection">
                    <button
                      class="evolution-alltime-header"
                      @click="showAllTimeExpanded = !showAllTimeExpanded"
                    >
                      <h5 class="evolution-subtitle">{{ $t('All-Time Evolution') }}</h5>
                      <span class="evolution-toggle-icon">{{ showAllTimeExpanded ? '▼' : '▶' }}</span>
                    </button>
                    <div v-if="showAllTimeExpanded" class="evolution-list">
                      <template v-if="allTimeEvolution.length > 0">
                        <div
                          v-for="(item, index) in (showAllTimeEvolution ? allTimeEvolution : allTimeEvolution.slice(0, 10))"
                          :key="`alltime-${item.category}-${item.attribute}`"
                          class="evolution-item"
                        >
                          <span class="evolution-category">{{ $tDynamic(formatCategoryName(item.category)) }}</span>
                          <span class="evolution-attr">{{ $tDynamic(formatAttrName(item.attribute)) }}</span>
                          <span class="evolution-change" :style="{ color: getEvolutionColor(item.totalChange) }">
                            {{ formatChange(item.totalChange) }}
                          </span>
                          <span class="evolution-count">({{ item.count }}x)</span>
                        </div>
                        <button
                          v-if="allTimeEvolution.length > 10"
                          class="evolution-toggle"
                          @click="showAllTimeEvolution = !showAllTimeEvolution"
                        >
                          {{ showAllTimeEvolution ? $t('Show Less') : $t('Show All ({n})', { n: allTimeEvolution.length }) }}
                        </button>
                      </template>
                      <div v-else class="evolution-empty">
                        {{ $t('No development history available') }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Morale Tab -->
              <div v-if="activeTab === 'morale' && scoutingMode && !moraleRevealed" class="tab-panel">
                <div class="scouting-locked-section">
                  <Lock :size="24" />
                  <p>{{ $t('Personality & motivation data is hidden for draft prospects') }}</p>
                  <span class="locked-hint">{{ $t('Hire a 4-Star Scout with Scouting Facility Lv 4 to unlock') }}</span>
                </div>
              </div>
              <div v-else-if="activeTab === 'morale'" class="tab-panel">
                <!-- Current Morale -->
                <div class="morale-current-section" data-tour="pdm-morale-current">
                  <div class="morale-header-row">
                    <component
                      :is="getMoraleIcon(moraleValue)"
                      :size="32"
                      :stroke-width="2"
                      class="morale-face-icon"
                      :style="{ color: getMoraleColor(moraleValue) }"
                      :aria-label="getMoraleLabel(moraleValue)"
                    />
                    <div class="morale-big-number" :style="{ color: getMoraleColor(moraleValue) }">
                      {{ moraleValue }}
                    </div>
                    <div class="morale-label-section">
                      <span class="morale-status-label" :style="{ color: getMoraleColor(moraleValue) }">
                        {{ getMoraleLabel(moraleValue) }}
                      </span>
                      <span class="morale-subtitle">{{ $t('Current Morale') }}</span>
                    </div>
                    <!-- Right-aligned Coach Meeting trigger. Auto-hides for
                         opponent players / scouting mode; otherwise toggles
                         between "spend an action" and "buy with tokens" based
                         on the coach's remaining per-season budget. -->
                    <button
                      v-if="canShowCoachMeeting"
                      class="coach-meeting-btn"
                      data-tour="pdm-coach-meeting"
                      :class="{ 'is-buy-mode': coachActionsLeft === 0 }"
                      :disabled="!!coachMeetingDisabledReason"
                      :title="coachMeetingDisabledReason || $t('Boost morale by +30')"
                      @click="openCoachMeetingModal"
                    >
                      <MessagesSquare :size="14" />
                      <span>{{ coachMeetingLabel }}</span>
                    </button>
                  </div>
                  <div class="morale-bar-container">
                    <div
                      class="morale-bar-fill"
                      :style="{
                        width: moraleValue + '%',
                        backgroundColor: getMoraleColor(moraleValue)
                      }"
                    ></div>
                  </div>
                </div>

                <!-- Personality Traits -->
                <div class="morale-traits-section" data-tour="pdm-traits">
                  <h4 class="morale-section-title">
                    {{ $t('Personality Traits') }}
                    <button
                      v-if="canEditFlavor && !editingPersonality"
                      class="flavor-edit-btn inline"
                      @click="startPersonalityEdit"
                    >
                      <Pencil :size="11" /> {{ $t('Edit') }}
                    </button>
                  </h4>

                  <div v-if="editingPersonality" class="flavor-edit-panel">
                    <div class="flavor-traits">
                      <button
                        v-for="t in PERSONALITY_TRAITS"
                        :key="t"
                        class="flavor-trait"
                        :class="{ on: personalityForm.traits.includes(t) }"
                        @click="toggleFlavorTrait(t)"
                      >
                        {{ $tDynamic(formatTraitName(t)) }}
                      </button>
                    </div>
                    <div class="flavor-grid">
                      <label class="flavor-field">
                        <span>{{ $t('Chemistry') }}</span>
                        <input v-model.number="personalityForm.chemistry" type="number" min="0" max="99" class="flavor-input" />
                      </label>
                      <label class="flavor-field">
                        <span>{{ $t('Media Profile') }}</span>
                        <select v-model="personalityForm.mediaProfile" class="flavor-input">
                          <option value="low_key">{{ $t('Low-key') }}</option>
                          <option value="normal">{{ $t('Normal') }}</option>
                          <option value="high_profile">{{ $t('High-profile') }}</option>
                        </select>
                      </label>
                    </div>
                    <div class="flavor-actions">
                      <button class="flavor-cancel" :disabled="flavorSaving" @click="editingPersonality = false">{{ $t('Cancel') }}</button>
                      <button class="flavor-save" :disabled="flavorSaving" @click="savePersonalityEdit">
                        <Check :size="13" /> {{ $t('Save') }}
                      </button>
                    </div>
                  </div>

                  <template v-else>
                    <div v-if="normalizedPlayer.personalityTraits.length > 0" class="traits-list">
                      <div
                        v-for="trait in normalizedPlayer.personalityTraits"
                        :key="trait"
                        class="trait-item"
                      >
                        <span class="trait-name">{{ $tDynamic(formatTraitName(trait)) }}</span>
                        <span class="trait-description">{{ getTraitDescription(trait) }}</span>
                      </div>
                    </div>
                    <div v-else class="morale-empty">
                      {{ $t('No notable personality traits') }}
                    </div>
                  </template>
                </div>

                <!-- Motivations -->
                <div v-if="playerMotivations" class="morale-motivations-section" data-tour="pdm-motivations">
                  <h4 class="morale-section-title">
                    {{ $t('Motivations') }}
                    <span class="archetype-label">{{ $tDynamic(motivationArchetype) }}</span>
                  </h4>
                  <div class="motivation-bars">
                    <div
                      v-for="(data, key) in playerMotivations"
                      :key="key"
                      class="motivation-row"
                    >
                      <span class="motivation-label">{{ $tDynamic(getMotivationLabel(key)) }}</span>
                      <div class="motivation-bar-track">
                        <div
                          class="motivation-bar-fill"
                          :style="{
                            width: (data.weight * 100) + '%',
                            backgroundColor: getMotivationBarColor(data.weight)
                          }"
                        />
                      </div>
                      <span class="motivation-value">{{ Math.round(data.weight * 100) }}</span>
                    </div>
                  </div>
                </div>

                <!-- Re-sign Likelihood (contract year only) -->
                <div v-if="isContractYear && retentionPct !== null" class="retention-section">
                  <h4 class="morale-section-title">{{ $t('Re-sign Likelihood') }}</h4>
                  <div class="retention-bar-container">
                    <div
                      class="retention-bar-fill"
                      :style="{
                        width: retentionPct + '%',
                        backgroundColor: getRetentionColor(retentionPct)
                      }"
                    />
                  </div>
                  <span class="retention-pct" :style="{ color: getRetentionColor(retentionPct) }">
                    {{ retentionPct }}%
                  </span>
                </div>

                <!-- Context -->
                <div class="morale-context-section">
                  <h4 class="morale-section-title">{{ $t('Context') }}</h4>
                  <div class="context-items">
                    <div v-if="normalizedPlayer.seasonStats" class="context-item">
                      <span class="context-label">{{ $t('Avg Minutes') }}</span>
                      <span class="context-value">{{ $t('{n} MPG', { n: formatStat(getStat('mpg'), 1) }) }}</span>
                    </div>
                    <div class="context-item">
                      <span class="context-label">{{ $t('Contract') }}</span>
                      <span class="context-value" :class="{ 'contract-year': normalizedPlayer.contract?.years_remaining <= 1 }">
                        {{ normalizedPlayer.contract?.years_remaining <= 1 ? $t('Contract Year') : $t('{n} yrs left', { n: normalizedPlayer.contract?.years_remaining }) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- History Tab (Awards + News) -->
              <div v-if="activeTab === 'history' && showHistory" class="tab-panel">
                <!-- Roster Editor IAP: edit bio & origin in place -->
                <button
                  v-if="canEditFlavor && !editingHistory"
                  class="flavor-edit-btn"
                  @click="startHistoryEdit"
                >
                  <Pencil :size="12" /> {{ $t('Edit History') }}
                </button>

                <div v-if="editingHistory" class="flavor-edit-panel">
                  <div class="flavor-grid">
                    <label class="flavor-field">
                      <span>{{ $t('College / Club') }}</span>
                      <input v-model="historyForm.college" class="flavor-input" />
                    </label>
                    <label class="flavor-field">
                      <span>{{ $t('Country') }}</span>
                      <input v-model="historyForm.country" class="flavor-input" />
                    </label>
                    <label class="flavor-field">
                      <span>{{ $t('Draft Round') }}</span>
                      <select
                        :value="historyForm.draftRound ?? ''"
                        class="flavor-input"
                        @change="historyForm.draftRound = $event.target.value ? Number($event.target.value) : null"
                      >
                        <option value="">{{ $t('Undrafted') }}</option>
                        <option :value="1">1</option>
                        <option :value="2">2</option>
                      </select>
                    </label>
                    <template v-if="historyForm.draftRound">
                      <label class="flavor-field">
                        <span>{{ $t('Pick') }}</span>
                        <input v-model.number="historyForm.draftPick" type="number" min="1" max="60" class="flavor-input" />
                      </label>
                      <label class="flavor-field">
                        <span>{{ $t('Draft Year') }}</span>
                        <input v-model.number="historyForm.draftYear" type="number" min="1990" :max="maxDraftYear" class="flavor-input" />
                      </label>
                    </template>
                    <label class="flavor-field">
                      <span>{{ $t('Career Seasons') }}</span>
                      <input v-model.number="historyForm.careerSeasons" type="number" min="0" max="25" class="flavor-input" />
                    </label>
                  </div>
                  <div class="flavor-actions">
                    <button class="flavor-cancel" :disabled="flavorSaving" @click="editingHistory = false">{{ $t('Cancel') }}</button>
                    <button class="flavor-save" :disabled="flavorSaving" @click="saveHistoryEdit">
                      <Check :size="13" /> {{ $t('Save') }}
                    </button>
                  </div>
                </div>

                <template v-else>
                  <!-- Draft Info -->
                  <div v-if="normalizedPlayer.draftInfo" class="history-section draft-info-section">
                    <div class="draft-info-card">
                      <span class="draft-info-pick">#{{ normalizedPlayer.draftInfo.pick }}</span>
                      <div class="draft-info-details">
                        <span class="draft-info-label">
                          {{ $t('Round {r}, Pick {p}', { r: normalizedPlayer.draftInfo.round, p: normalizedPlayer.draftInfo.pick }) }}
                          <!-- i18n-ignore (middot separator entity; surrounding text is wrapped) -->
                          <template v-if="normalizedPlayer.draftInfo.year"> &middot; {{ normalizedPlayer.draftInfo.year }}</template>
                        </span>
                        <span class="draft-info-team">{{ $t('Drafted by {team}', { team: normalizedPlayer.draftInfo.teamAbbreviation }) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Origin (school or international club + country) -->
                  <div v-if="playerOrigin" class="history-section origin-section">
                    <div class="origin-card">
                      <span class="origin-label">{{ $t('From') }}</span>
                      <span class="origin-value">{{ playerOrigin.school }}</span>
                      <span v-if="playerOrigin.country" class="origin-country">{{ playerOrigin.country }}</span>
                    </div>
                  </div>
                </template>

                <!-- Trade history (permanent career trade log) -->
                <div v-if="!scoutingMode && tradeHistoryList.length" class="history-section">
                  <h4 class="history-section-title">{{ $t('Trades') }}</h4>
                  <div class="trade-log-list">
                    <div v-for="(t, i) in tradeHistoryList" :key="`tl-${i}`" class="trade-log-row">
                      <span class="trade-log-route">{{ t.fromAbbr || t.fromName || '—' }} → {{ t.toAbbr || t.toName || '—' }}</span>
                      <span class="trade-log-date">{{ formatTradeLogDate(t) }}</span>
                    </div>
                  </div>
                </div>

                <!-- All Star Selections — hidden for draft prospects (none yet) -->
                <div v-if="!scoutingMode" class="history-section">
                  <h4 class="history-section-title">{{ $t('All Star Selections') }}</h4>
                  <div v-if="allStarSelectionList.length > 0" class="allstar-list">
                    <div v-for="(sel, i) in allStarSelectionList" :key="`as-${i}`" class="allstar-row">
                      <span class="allstar-season">{{ sel.season }}</span>
                      <span v-if="sel.teamAbbr" class="allstar-team">{{ sel.teamAbbr }}</span>
                    </div>
                  </div>
                  <div v-else class="empty-state-inline">
                    <p>{{ $t('No All-Star selections') }}</p>
                  </div>
                </div>

                <!-- Awards Section — hidden for draft prospects (none yet) -->
                <div v-if="!scoutingMode" class="history-section">
                  <h4 class="history-section-title">{{ $t('Awards') }}</h4>
                  <div v-if="hasAwards" class="awards-grid">
                    <!-- Championships -->
                    <div v-if="normalizedPlayer.championships > 0" class="award-card gold">
                      <Trophy :size="32" />
                      <span class="award-count">{{ normalizedPlayer.championships }}x</span>
                      <span class="award-label">{{ $t('League Champion') }}</span>
                      <span v-if="getAwardYears('championship')" class="award-years">{{ getAwardYears('championship') }}</span>
                    </div>

                    <!-- Finals MVP -->
                    <div v-if="normalizedPlayer.finals_mvp_awards > 0" class="award-card gold">
                      <Award :size="32" />
                      <span class="award-count">{{ normalizedPlayer.finals_mvp_awards }}x</span>
                      <span class="award-label">{{ $t('Finals MVP') }}</span>
                      <span v-if="getAwardYears('finals_mvp')" class="award-years">{{ getAwardYears('finals_mvp') }}</span>
                    </div>

                    <!-- Conference Finals MVP -->
                    <div v-if="normalizedPlayer.conference_finals_mvp_awards > 0" class="award-card silver">
                      <Medal :size="32" />
                      <span class="award-count">{{ normalizedPlayer.conference_finals_mvp_awards }}x</span>
                      <span class="award-label">{{ $t('Conf Finals MVP') }}</span>
                      <span v-if="getAwardYears('conference_finals_mvp')" class="award-years">{{ getAwardYears('conference_finals_mvp') }}</span>
                    </div>

                    <!-- League MVP -->
                    <div v-if="normalizedPlayer.mvp_awards > 0" class="award-card gold">
                      <Star :size="32" />
                      <span class="award-count">{{ normalizedPlayer.mvp_awards }}x</span>
                      <span class="award-label">{{ $t('League MVP') }}</span>
                      <span v-if="getAwardYears('mvp')" class="award-years">{{ getAwardYears('mvp') }}</span>
                    </div>

                    <!-- Defensive Player of the Year -->
                    <div v-if="normalizedPlayer.dpoy_awards > 0" class="award-card gold">
                      <Shield :size="32" />
                      <span class="award-count">{{ normalizedPlayer.dpoy_awards }}x</span>
                      <span class="award-label">{{ $t('Defensive Player of the Year') }}</span>
                      <span v-if="getAwardYears('dpoy')" class="award-years">{{ getAwardYears('dpoy') }}</span>
                    </div>

                    <!-- All-Star -->
                    <div v-if="normalizedPlayer.all_star_selections > 0" class="award-card">
                      <Users :size="32" />
                      <span class="award-count">{{ normalizedPlayer.all_star_selections }}x</span>
                      <span class="award-label">{{ $t('All-Star') }}</span>
                      <span v-if="getAwardYears('all_star')" class="award-years">{{ getAwardYears('all_star') }}</span>
                    </div>

                    <!-- Rookie of the Year -->
                    <div v-if="normalizedPlayer.rookie_of_the_year > 0" class="award-card gold">
                      <Award :size="32" />
                      <span class="award-count">{{ normalizedPlayer.rookie_of_the_year }}x</span>
                      <span class="award-label">{{ $t('Rookie of the Year') }}</span>
                      <span v-if="getAwardYears('rookie_of_the_year')" class="award-years">{{ getAwardYears('rookie_of_the_year') }}</span>
                    </div>

                    <!-- All-NBA -->
                    <div v-if="normalizedPlayer.all_nba_selections > 0" class="award-card silver">
                      <Star :size="32" />
                      <span class="award-count">{{ normalizedPlayer.all_nba_selections }}x</span>
                      <span class="award-label">{{ $t('All-League') }}</span>
                      <div v-if="getTieredAwardSummary('all_nba', ['first','second','third']).length" class="award-tiers">
                        <span v-for="line in getTieredAwardSummary('all_nba', ['first','second','third'])" :key="line" class="award-tier-line">{{ line }}</span>
                      </div>
                    </div>

                    <!-- All-Defense -->
                    <div v-if="normalizedPlayer.all_defensive_team > 0" class="award-card silver">
                      <Shield :size="32" />
                      <span class="award-count">{{ normalizedPlayer.all_defensive_team }}x</span>
                      <span class="award-label">{{ $t('All-Defense') }}</span>
                      <div v-if="getTieredAwardSummary('all_defense', ['first','second']).length" class="award-tiers">
                        <span v-for="line in getTieredAwardSummary('all_defense', ['first','second'])" :key="line" class="award-tier-line">{{ line }}</span>
                      </div>
                    </div>

                    <!-- All-Rookie -->
                    <div v-if="normalizedPlayer.all_rookie_team > 0" class="award-card">
                      <Zap :size="32" />
                      <span class="award-count">{{ normalizedPlayer.all_rookie_team }}x</span>
                      <span class="award-label">{{ $t('All-Rookie') }}</span>
                      <div v-if="getTieredAwardSummary('all_rookie', ['first','second']).length" class="award-tiers">
                        <span v-for="line in getTieredAwardSummary('all_rookie', ['first','second'])" :key="line" class="award-tier-line">{{ line }}</span>
                      </div>
                    </div>
                  </div>
                  <div v-else class="empty-state-inline">
                    <p>{{ $t('No awards yet') }}</p>
                  </div>
                </div>

                <!-- News Section — hidden for draft prospects (none yet) -->
                <div v-if="!scoutingMode" class="history-section">
                  <h4 class="history-section-title">{{ $t('News') }}</h4>
                  <div v-if="playerNews.length > 0" class="news-list">
                    <div v-for="news in playerNews" :key="news.id" class="news-item">
                      <p class="news-headline">{{ news.headline_tpl ? $tDynamic(news.headline_tpl, news.headline_params) : news.headline }}</p>
                      <p class="news-date">{{ news.date }}</p>
                    </div>
                  </div>
                  <div v-else class="empty-state-inline">
                    <p>{{ $t('No news available') }}</p>
                  </div>
                </div>
              </div>
            </div>
          </main>

          <!-- Footer -->
          <footer class="modal-footer">
            <div v-if="normalizedPlayer.contract" class="contract-info" data-tour="pdm-contract">
              <div class="contract-item">
                <span class="contract-label">{{ $t('Salary') }}</span>
                <span class="contract-value text-success">{{ $t('{a}/yr', { a: formatSalary(normalizedPlayer.contract.salary) }) }}</span>
              </div>
              <div class="contract-item">
                <span class="contract-label">{{ $t('Years Remaining') }}</span>
                <span class="contract-value">{{ normalizedPlayer.contract.years_remaining }}</span>
              </div>
            </div>
            <button class="btn-close-footer" @click="close">
              {{ $t('Close') }}
            </button>
          </footer>

          <WalkthroughReplayButton :walkthrough-key="replayTourKey" variant="modal" />
        </div>
      </div>
    </Transition>
  </Teleport>

  <PlayerBadgeStoreModal
    :show="showPlayerBadgeStore"
    :campaign-id="campaignId"
    :player="normalizedPlayer"
    @close="showPlayerBadgeStore = false"
  />

  <CoachMeetingConfirmModal
    :show="showCoachMeetingModal"
    :mode="coachMeetingMode"
    :player-name="normalizedPlayer?.name || $t('Player')"
    :actions-remaining="coachActionsLeft"
    :action-budget="coachActionBudget"
    :extra-action-cost="coachMeetingExtraCost"
    :user-tokens="userTokens"
    :loading="meetingInProgress"
    @close="showCoachMeetingModal = false"
    @confirm="confirmCoachMeeting"
  />

  <!-- Upgrade-point purchase confirmation. Triggered by the +Buy chip on
       either attribute pool — gives the user a chance to bail on a 500-
       token spend before tokens leave their balance. -->
  <BaseModal
    :show="!!pendingUpgradePurchase"
    :title="$t('Buy {a} Upgrade Point?', { a: pendingUpgradePurchase?.label })"
    @close="cancelUpgradePurchase"
  >
    <div v-if="pendingUpgradePurchase" class="upgrade-confirm-body">
      <p class="upgrade-confirm-line">
        {{ $t('Spend {price} tokens to buy one {label} upgrade point for {name}?', { price: pendingUpgradePurchase.price.toLocaleString(), label: pendingUpgradePurchase.label, name: normalizedPlayer?.name }) }}
      </p>
      <p class="upgrade-confirm-hint">
        {{ $t("The point lands in the {pool} pool and can be spent on any eligible attribute below. This action can't be undone.", { pool: pendingUpgradePurchase.label.toLowerCase() }) }}
      </p>
      <div class="upgrade-confirm-actions">
        <button class="btn-cancel" :disabled="upgradePurchaseInFlight" @click="cancelUpgradePurchase">
          {{ $t('Cancel') }}
        </button>
        <button class="btn-confirm" :disabled="upgradePurchaseInFlight" @click="confirmUpgradePurchase">
          <Coins :size="14" />
          {{ $t('Confirm · {n}', { n: pendingUpgradePurchase.price.toLocaleString() }) }}
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
/* Modal Overlay & Container */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.modal-container {
  position: relative;
  width: 100%;
  max-width: 42rem;
  max-height: 90vh;
  min-height: 90vh;
  background: var(--glass-bg-elevated, rgba(30, 35, 45, 0.98));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-lg);
  animation: scaleIn var(--duration-normal) var(--ease-out);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Modal Header */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.modal-header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.btn-close {
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

.btn-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

/* Modal Content (Scrollable) */
.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
}

.modal-content::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Opera */
}

/* Modal Footer */
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.contract-info {
  display: flex;
  gap: 2rem;
}

/* Lift the walkthrough "?" above the footer (which holds the contract info in
   its bottom-left). Compound selector out-specifies the component's own
   scoped `.wt-replay-modal` rule. */
.wt-replay-btn.wt-replay-modal {
  bottom: 82px;
}

.btn-close-footer {
  padding: 10px 24px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-left: auto;
}

.btn-close-footer:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

/* Close Button (legacy, keeping for back-button support) */
.modal-close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 50%;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: var(--color-text-primary);
}

.back-button {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
}

.back-button:hover {
  text-decoration: underline;
}

/* Player Header */
.player-modal-header {
  padding: 1rem;
  margin-bottom: 0.75rem;
  background: var(--gradient-cosmic);
  border-radius: var(--radius-xl);
  border: 1px solid rgba(255, 255, 255, 0.2);
  position: relative;
  overflow: hidden;
}

.player-modal-header::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 10% 20%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 30% 60%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 50% 10%, rgba(255,255,255,0.4), transparent),
    radial-gradient(1px 1px at 70% 40%, rgba(255,255,255,0.3), transparent);
  pointer-events: none;
}

.player-modal-header > * {
  position: relative;
  z-index: 1;
}

.player-modal-header.injured-header {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%);
}

.header-top-row {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.modal-player-avatar {
  position: relative;
  width: 92px;
  height: 92px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.9);
  flex-shrink: 0;
}

.edit-headshot-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border: 2px solid var(--color-bg-secondary, #1a1520);
  color: white;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  transition: filter 0.15s ease, transform 0.15s ease;
  padding: 0;
}

.edit-headshot-overlay:hover {
  filter: brightness(1.1);
  transform: scale(1.05);
}

.header-rating-corner {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ovr-label {
  font-size: 0.55rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(26, 21, 32, 0.5);
}

.player-modal-header :deep(.stat-badge) {
  background: transparent;
  color: #1a1520;
  font-size: 1.3rem;
  padding: 0;
}

.player-card-info {
  position: relative;
  z-index: 1;
}

.player-card-name {
  font-size: 1.25rem;
  font-weight: 700;
  color: #1a1520;
  margin: 0 0 6px 0;
}

.player-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.player-card-jersey {
  color: rgba(26, 21, 32, 0.6);
  font-size: 0.8rem;
  font-weight: 600;
}

.player-card-bio {
  font-size: 0.8rem;
  color: rgba(26, 21, 32, 0.7);
  font-weight: 500;
}

/* Morale chip under the bio line — color-keyed by bucket via the same
   helper functions the dedicated Morale tab uses, so the face icon and
   label always match. Sits on a translucent dark fill since the header
   has a light cosmic background. */
.morale-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  padding: 3px 9px;
  background: rgba(26, 21, 32, 0.65);
  border: 1px solid color-mix(in srgb, var(--morale-color, #6b7280) 40%, transparent);
  border-radius: 999px;
  color: var(--morale-color, #6b7280);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1;
}

.morale-chip-label {
  /* slight tracking adjustment relative to the value */
  letter-spacing: 0.05em;
}

.morale-chip-value {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.66rem;
  letter-spacing: 0;
  padding-left: 6px;
  border-left: 1px solid color-mix(in srgb, var(--morale-color, #6b7280) 30%, transparent);
}

.injury-badge-modal {
  position: absolute;
  bottom: -4px;
  right: -4px;
  padding: 2px 4px;
  background: var(--color-error);
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  border-radius: 4px;
}

.injured-name {
  text-decoration: line-through;
  text-decoration-color: rgba(26, 21, 32, 0.4);
}

/* Header Contract Action Buttons */
.header-scout-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.3rem 0.6rem;
  margin-left: auto;
  border: 1px solid rgba(26, 21, 32, 0.25);
  border-radius: 6px;
  background: rgba(26, 21, 32, 0.1);
  color: rgba(26, 21, 32, 0.8);
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.header-scout-btn:hover:not(:disabled) {
  background: rgba(26, 21, 32, 0.2);
  border-color: rgba(26, 21, 32, 0.4);
}

.header-scout-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.header-contract-actions {
  display: flex;
  gap: 0.375rem;
  margin-left: auto;
}

.header-action-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.3rem 0.6rem;
  border: none;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.header-action-btn.resign {
  background: rgba(26, 21, 32, 0.1);
  color: rgba(26, 21, 32, 0.8);
  border: 1px solid rgba(26, 21, 32, 0.2);
}

.header-action-btn.resign:hover {
  background: rgba(26, 21, 32, 0.2);
  border-color: rgba(26, 21, 32, 0.4);
}

.header-action-btn.drop {
  background: rgba(180, 40, 40, 0.15);
  color: rgba(140, 20, 20, 0.9);
  border: 1px solid rgba(180, 40, 40, 0.25);
}

.header-action-btn.drop:hover {
  background: rgba(180, 40, 40, 0.25);
  border-color: rgba(180, 40, 40, 0.4);
}

.header-action-btn.sign {
  background: var(--color-primary);
  color: #fff;
  border: 1px solid var(--color-primary);
}

.header-action-btn.sign:hover {
  background: var(--color-primary-dark);
  border-color: var(--color-primary-dark);
}

.header-draft-action {
  margin-top: 0.5rem;
}

.header-action-btn.draft {
  padding: 0.45rem 0.9rem;
  font-size: 0.8rem;
  background: var(--color-primary);
  color: #fff;
  border: none;
}

.header-action-btn.draft:hover {
  background: var(--color-primary-dark);
}

.position-badges {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.position-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
}

.position-badge.secondary {
  opacity: 0.7;
}

/* Archetype + morale row — sits on its own line under the vitals
   (.player-card-bio). Two chips side by side: archetype left, morale
   right. Wraps to a second line on cramped widths so neither chip gets
   truncated. */
.archetype-row {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* Archetype chip — quiet outline-style so it reads as a label rather than
   a colored tag like the position badges. */
.archetype-chip {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  white-space: nowrap;
}

.injury-tag {
  padding: 2px 6px;
  background: var(--color-error);
  color: white;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
}

.trade-block-toggle {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid rgba(26, 21, 32, 0.2);
  background: rgba(26, 21, 32, 0.1);
  color: rgba(26, 21, 32, 0.6);
  cursor: pointer;
  transition: all 0.15s ease;
}

.trade-block-toggle:hover {
  background: rgba(26, 21, 32, 0.15);
  color: rgba(26, 21, 32, 0.8);
}

.trade-block-toggle.active {
  background: rgba(232, 90, 79, 0.15);
  border-color: rgba(232, 90, 79, 0.3);
  color: #E85A4F;
}


/* Fatigue Meter */
.fatigue-meter-container {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
}

.fatigue-meter-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
  font-weight: 600;
  color: #1a1520;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  min-width: 80px;
}

.fatigue-value {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  color: white;
  background: #22c55e;
}

.fatigue-value.warning {
  background: #f59e0b;
}

.fatigue-value.high {
  background: #ef4444;
}

.fatigue-meter-bar {
  flex: 1;
  height: 6px;
  background: rgba(26, 21, 32, 0.2);
  border-radius: 3px;
  overflow: hidden;
}

.fatigue-meter-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.fatigue-warning {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-error);
  animation: pulse-warning 2s ease-in-out infinite;
}

@keyframes pulse-warning {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
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

/* Badges Preview */
.badges-preview {
  padding: 0.75rem;
  background: var(--color-bg-tertiary);
  border-radius: 10px;
}

.badges-grid-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.badge-chip {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid;
  border-radius: 6px;
  font-size: 0.75rem;
}

.badge-level-icon {
  font-weight: 700;
  font-size: 0.65rem;
}

.badge-name-preview {
  color: var(--color-text-secondary);
}

.more-badges {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

/* Modal Tabs - styled like GM view tabs */
.modal-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 12px 0;
}

.tab-btn {
  position: relative;
  padding: 0.5rem 1rem;
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

/* Training-ready pulse dot on the Badges tab button — mirrors the
   PlayerCard avatar dot and the GM-nav dot so the indicator reads the
   same everywhere. Anchored top-right of the tab pill. */
.tab-btn .train-ready-dot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.25);
}

/* Live training countdown on the Badges tab button — same top-right corner as
   the ready dot, but a small pill of remaining time while training runs. */
.tab-btn .train-countdown-tab {
  position: absolute;
  top: -9px;
  right: -8px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px 1px 5px;
  font-size: 0.58rem;
  font-weight: 700;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
  text-transform: none;
  letter-spacing: 0;
  color: #fff;
  background: #3b82f6;
  border-radius: 999px;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  white-space: nowrap;
}
.tab-btn .train-countdown-tab svg {
  flex-shrink: 0;
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

/* Modal Tab Content */
.modal-tab-content {
  min-height: 200px;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Stats Grid */
.stats-grid-modal {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.stat-cell .stat-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  letter-spacing: 0.5px;
}

.stat-cell .stat-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.stat-cell .stat-value.highlight {
  color: var(--color-primary);
}

/* Attributes Section */
.attr-section {
  margin-bottom: 1rem;
}

.attr-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
}

.attributes-grid {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.attr-row {
  display: grid;
  grid-template-columns: 120px 1fr 40px;
  align-items: center;
  gap: 0.5rem;
}

.attr-name {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.attr-bar-container {
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.attr-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.attr-value {
  font-size: 0.8rem;
  font-weight: 600;
  text-align: right;
}

/* Upgrade attr-row with extra column for upgrade button */
.attr-row.has-upgrade {
  grid-template-columns: 120px 1fr 40px 32px;
}

/* Upgrade Points UI */
.upgrade-points-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 12px;
  margin-bottom: 16px;
}

.upgrade-points-banner.no-points {
  background: rgba(107, 114, 128, 0.1);
  border-color: rgba(107, 114, 128, 0.3);
}

.upgrade-pools {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  justify-content: center;
}

.pool-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.pool-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
}

.pool-item.has-points .pool-value {
  color: var(--color-success);
}

.pool-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.pool-divider {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.15);
}

.upgrade-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  margin: 0;
}

.upgrade-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-success);
  color: white;
  border: none;
  border-radius: 50%;
  font-size: 1.25rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.upgrade-btn:hover:not(:disabled) {
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(34, 197, 94, 0.4);
}

.upgrade-btn:disabled {
  background: var(--color-text-tertiary);
  opacity: 0.5;
  cursor: not-allowed;
}

/* Buy +1 upgrade-point button (in the dual-pool banner). Mirrors
   `.badge-purchase-btn` from PlayerBadgeStoreModal. */
.pool-buy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  border: none;
  color: white;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.2s ease;
}

.pool-buy-btn:hover:not(:disabled) {
  background: var(--color-primary-dark);
}

.pool-buy-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Upgrade-point purchase confirmation modal body. Drops on top of the
   BaseModal's default content area; layout is a stacked sentence + hint
   + action row. */
.upgrade-confirm-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 0;
}

.upgrade-confirm-line {
  font-size: 0.92rem;
  color: var(--color-text-primary);
  line-height: 1.45;
  margin: 0;
}

.upgrade-confirm-hint {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
  margin: 0;
}

.upgrade-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}

.upgrade-confirm-actions .btn-cancel,
.upgrade-confirm-actions .btn-confirm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: var(--radius-md);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--glass-border);
}

.upgrade-confirm-actions .btn-cancel {
  background: transparent;
  color: var(--color-text-secondary);
}

.upgrade-confirm-actions .btn-cancel:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
}

.upgrade-confirm-actions .btn-confirm {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.upgrade-confirm-actions .btn-confirm:hover:not(:disabled) {
  background: var(--color-primary-dark);
}

.upgrade-confirm-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* "MAX" indicator shown in place of the + button when an attribute has hit
   the player's potential cap. Sits in the same 32px column as the button
   so the row layout stays consistent. */
.upgrade-max {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 22px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-tertiary);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  flex-shrink: 0;
  user-select: none;
  cursor: default;
}

.no-upgrade-hint {
  font-weight: 400;
  font-size: 0.65rem;
  color: var(--color-text-tertiary);
  text-transform: none;
  margin-left: 6px;
}

/* Badges Section */
.badges-store-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.badges-store-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--radius-lg);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.2s ease;
}

.badges-store-btn:hover {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

/* Train button + countdown widget. Quiet outline-style when idle, accent
   glow when ready to claim, muted chip when blocked / in-progress for
   another player. */
.badges-train-btn,
.badges-train-countdown,
.badges-train-blocked {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--radius-lg);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.badges-train-btn {
  background: var(--color-bg-tertiary);
  border: 1px solid #22c55e;
  color: #22c55e;
  cursor: pointer;
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.badges-train-btn:hover:not(:disabled) {
  background: color-mix(in srgb, #22c55e 15%, transparent);
}

.badges-train-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.badges-train-btn.is-ready {
  background: color-mix(in srgb, #22c55e 22%, transparent);
  box-shadow: 0 0 0 4px color-mix(in srgb, #22c55e 18%, transparent);
}

.badges-train-countdown {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.badges-train-blocked {
  background: transparent;
  border: 1px dashed var(--glass-border);
  color: var(--color-text-tertiary);
}

/* Available-badges dropdown (what this player could earn) — pinned at the
   bottom of the Badges tab. */
.badge-options {
  margin-top: 0.75rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg, 10px);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.02);
}
.badge-options-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.badge-options-toggle:hover {
  background: rgba(255, 255, 255, 0.04);
}
.badge-options-chevron {
  color: var(--color-text-secondary);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}
.badge-options-chevron.open {
  transform: rotate(180deg);
}
.badge-options-panel {
  padding: 4px 14px 12px;
  border-top: 1px solid var(--glass-border);
}
.badge-options-hint {
  font-size: 0.7rem;
  line-height: 1.4;
  color: var(--color-text-tertiary);
  margin: 8px 0 10px;
}
.badge-options-cat {
  margin-bottom: 10px;
}
.badge-options-cat-title {
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
  margin: 0 0 5px;
}
.badge-option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.badge-option-row:last-child {
  border-bottom: none;
}
.badge-option-name {
  font-size: 0.8rem;
  color: var(--color-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge-option-levels {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.badge-option-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--color-text-tertiary);
  box-sizing: border-box;
}
.badge-option-dot.reachable {
  border-color: var(--color-text-secondary);
  background: transparent;
}
.badge-option-dot.locked {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
}
.badge-option-max {
  font-size: 0.66rem;
  font-weight: 700;
  margin-left: 4px;
  min-width: 64px;
  text-align: right;
}

.badges-tab-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.badge-level-section {
  margin-bottom: 0.5rem;
}

.badge-level-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 0.5rem;
}

.badge-level-title.hof { color: #9B59B6; }
.badge-level-title.gold { color: #FFD700; }
.badge-level-title.silver { color: #C0C0C0; }
.badge-level-title.bronze { color: #CD7F32; }

.badges-grid-modal {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.5rem;
}

.badge-card-modal {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.badge-card-modal.hof {
  border-color: rgba(155, 89, 182, 0.3);
  background: rgba(155, 89, 182, 0.1);
}

.badge-card-modal.gold {
  border-color: rgba(255, 215, 0, 0.3);
  background: rgba(255, 215, 0, 0.1);
}

.badge-card-modal.silver {
  border-color: rgba(192, 192, 192, 0.3);
  background: rgba(192, 192, 192, 0.1);
}

.badge-card-modal.bronze {
  border-color: rgba(205, 127, 50, 0.3);
  background: rgba(205, 127, 50, 0.1);
}

.badge-icon {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 2px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.1);
}

.badge-name-modal {
  font-size: 0.8rem;
  color: var(--color-text-primary);
}

/* Badge synergy activation */
.badge-chip.synergy-active {
  background: rgba(0, 229, 255, 0.1);
  box-shadow: 0 0 6px rgba(0, 229, 255, 0.3);
}

.badge-card-modal.synergy-active {
  border-color: rgba(0, 229, 255, 0.5) !important;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.2);
}

.synergy-icon {
  color: #00E5FF;
  flex-shrink: 0;
}

/* Awards Section */
.awards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 1rem;
}

.award-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  text-align: center;
}

.award-card.gold {
  border-color: rgba(255, 215, 0, 0.3);
  background: rgba(255, 215, 0, 0.1);
  color: #FFD700;
}

.award-card.silver {
  border-color: rgba(192, 192, 192, 0.3);
  background: rgba(192, 192, 192, 0.1);
  color: #C0C0C0;
}

.award-count {
  font-size: 1.25rem;
  font-weight: 700;
}

.award-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.award-years {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  font-weight: 500;
  letter-spacing: 0.02em;
}

.award-tiers {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  margin-top: 2px;
}

.award-tier-line {
  font-size: 0.65rem;
  color: var(--color-text-tertiary);
  font-weight: 500;
  letter-spacing: 0.02em;
  text-align: center;
}

/* Contract Footer */

.contract-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.contract-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-tertiary);
}

.contract-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Empty State */
.empty-state-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

.empty-state-modal .empty-icon {
  margin-bottom: 1rem;
  opacity: 0.5;
}

.empty-state-inline {
  padding: 1rem;
  color: var(--color-text-tertiary);
  font-size: 0.875rem;
}

/* Evolution Section */
.evolution-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.evolution-subsection {
  margin-bottom: 0.5rem;
}

.evolution-subtitle {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin: 0 0 0.5rem 0;
}

.evolution-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.evolution-item {
  display: grid;
  grid-template-columns: 80px 1fr auto auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  font-size: 0.8rem;
}

.evolution-category {
  color: var(--color-text-tertiary);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.evolution-attr {
  color: var(--color-text-secondary);
}

.evolution-change {
  font-weight: 600;
  font-family: var(--font-mono);
}

.evolution-count {
  color: var(--color-text-tertiary);
  font-size: 0.7rem;
}

.evolution-toggle {
  margin-top: 0.5rem;
  padding: 0.375rem 0.75rem;
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
  padding: 0.75rem;
  color: var(--color-text-tertiary);
  font-size: 0.8rem;
  text-align: center;
}

.evolution-alltime-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.evolution-alltime-header:hover {
  background: rgba(255, 255, 255, 0.06);
}

.evolution-toggle-icon {
  color: var(--color-text-tertiary);
  font-size: 0.7rem;
}

/* History Section */
.history-section {
  margin-bottom: 1.5rem;
}

.history-section:last-child {
  margin-bottom: 0;
}

.history-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

/* News List */
.allstar-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.allstar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border-left: 3px solid var(--color-primary);
}

/* Career trade log */
.trade-log-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.trade-log-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border-left: 3px solid var(--color-accent, #e85a4f);
}

.trade-log-route {
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trade-log-date {
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
  flex-shrink: 0;
}

.allstar-season {
  color: var(--color-text-primary);
  font-size: 0.875rem;
  font-weight: 600;
}

.allstar-team {
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.news-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.news-item {
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border-left: 3px solid var(--color-primary);
}

.news-headline {
  margin: 0 0 0.25rem 0;
  color: var(--color-text-primary);
  font-size: 0.875rem;
}

.news-date {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
}

/* Morale Tab */
.morale-current-section {
  padding: 1rem;
  background: var(--color-bg-tertiary);
  border-radius: 12px;
}

.morale-header-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

/* Coach Meeting trigger — pushed to the right edge of the morale header. */
.coach-meeting-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: rgba(168, 85, 247, 0.14);
  border: 1px solid rgba(168, 85, 247, 0.4);
  border-radius: var(--radius-full, 999px);
  color: #c084fc;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.coach-meeting-btn:hover:not(:disabled) {
  background: rgba(168, 85, 247, 0.22);
  border-color: rgba(168, 85, 247, 0.6);
  transform: translateY(-1px);
}

.coach-meeting-btn.is-buy-mode {
  background: rgba(255, 196, 0, 0.14);
  border-color: rgba(255, 196, 0, 0.4);
  color: #ffd45a;
}

.coach-meeting-btn.is-buy-mode:hover:not(:disabled) {
  background: rgba(255, 196, 0, 0.22);
  border-color: rgba(255, 196, 0, 0.6);
}

.coach-meeting-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

/* On mobile, drop the Coach Meeting button to its own row beneath the
   morale icon / number / label row and stretch it edge-to-edge so it
   reads as a clear primary action instead of getting squeezed against
   the label column. */
@media (max-width: 640px) {
  .morale-header-row {
    flex-wrap: wrap;
  }
  .coach-meeting-btn {
    flex-basis: 100%;
    width: 100%;
    margin-left: 0;
    justify-content: center;
  }
}

.morale-face-icon {
  flex-shrink: 0;
  transition: color 0.2s ease;
}

.morale-big-number {
  font-size: 2.5rem;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  line-height: 1;
}

.morale-label-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.morale-status-label {
  font-size: 1rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.morale-subtitle {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

.morale-bar-container {
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.morale-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.morale-traits-section,
.morale-context-section {
  margin-top: 0.5rem;
}

.morale-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
}

.traits-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.trait-item {
  padding: 0.625rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border-left: 3px solid var(--color-primary);
}

.trait-name {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.trait-description {
  display: block;
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

.morale-empty {
  padding: 0.75rem;
  color: var(--color-text-tertiary);
  font-size: 0.8rem;
  text-align: center;
}

/* Motivations */
.morale-motivations-section,
.retention-section {
  margin-top: 0.5rem;
}

.archetype-label {
  float: right;
  font-weight: 500;
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  text-transform: none;
  letter-spacing: 0;
}

.motivation-bars {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.motivation-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.motivation-label {
  flex: 0 0 130px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.motivation-bar-track {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.motivation-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.motivation-value {
  flex: 0 0 24px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-align: right;
}

.retention-bar-container {
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.25rem;
}

.retention-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.retention-pct {
  font-size: 0.85rem;
  font-weight: 700;
}

.context-items {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.context-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.context-label {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.context-value {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.context-value.contract-year {
  color: var(--color-warning);
}

/* Light mode morale */
[data-theme="light"] .morale-current-section {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .morale-bar-container {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .trait-item {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .context-item {
  background: rgba(0, 0, 0, 0.03);
}

/* Modal Transition */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

/* Light mode */
[data-theme="light"] .modal-container {
  background: rgba(255, 255, 255, 0.98);
}

[data-theme="light"] .modal-close-btn {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .modal-close-btn:hover {
  background: rgba(0, 0, 0, 0.12);
}

[data-theme="light"] .player-modal-header.injured-header {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%);
}

[data-theme="light"] .badges-preview {
  background: rgba(0, 0, 0, 0.07);
}

[data-theme="light"] .badge-chip {
  background: rgba(0, 0, 0, 0.07);
}

[data-theme="light"] .stat-cell {
  background: rgba(0, 0, 0, 0.07);
}

[data-theme="light"] .attr-bar-container {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .badge-card-modal {
  background: rgba(0, 0, 0, 0.07);
  border-color: rgba(0, 0, 0, 0.12);
}

[data-theme="light"] .badge-card-modal.hof {
  background: rgba(155, 89, 182, 0.08);
  border-color: rgba(155, 89, 182, 0.25);
}

[data-theme="light"] .badge-card-modal.gold {
  background: rgba(255, 215, 0, 0.08);
  border-color: rgba(255, 215, 0, 0.25);
}

[data-theme="light"] .badge-card-modal.silver {
  background: rgba(192, 192, 192, 0.15);
  border-color: rgba(128, 128, 128, 0.25);
}

[data-theme="light"] .badge-card-modal.bronze {
  background: rgba(205, 127, 50, 0.08);
  border-color: rgba(205, 127, 50, 0.25);
}

[data-theme="light"] .badge-icon {
  background: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .award-card {
  background: rgba(0, 0, 0, 0.07);
  border-color: rgba(0, 0, 0, 0.12);
}

[data-theme="light"] .award-card.gold {
  background: rgba(255, 215, 0, 0.1);
  border-color: rgba(255, 215, 0, 0.3);
}

[data-theme="light"] .award-card.silver {
  background: rgba(192, 192, 192, 0.15);
  border-color: rgba(128, 128, 128, 0.3);
}

[data-theme="light"] .modal-header {
  border-bottom-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .modal-footer {
  border-top-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .evolution-item {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .evolution-toggle {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .evolution-toggle:hover {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .evolution-alltime-header {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .evolution-alltime-header:hover {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .history-section-title {
  border-bottom-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .news-item {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .upgrade-points-banner {
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.25);
}

[data-theme="light"] .upgrade-points-banner.no-points {
  background: rgba(107, 114, 128, 0.08);
  border-color: rgba(107, 114, 128, 0.2);
}

[data-theme="light"] .pool-divider {
  background: rgba(0, 0, 0, 0.15);
}

/* Mobile Responsive Styles */
@media (max-width: 480px) {
  .modal-container{
    max-height:85vh;
    min-height: 85vh;
  }
  .modal-header {
    padding: 12px 16px;
  }

  .modal-title {
    font-size: 1.25rem;
  }

  .modal-content {
    padding: 16px;
  }

  .modal-footer {
    padding: 12px 16px;
  }

  .player-modal-header {
    padding: 0.75rem;
  }

  .player-card-name {
    font-size: 1.1rem;
  }

  .player-card-bio {
    font-size: 0.7rem;
  }

  .modal-tabs {
    padding: 10px 0;
    gap: 0.375rem;
  }

  .tab-btn {
    padding: 0.4rem 0.75rem;
    font-size: 0.75rem;
  }

  .stats-grid-modal {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.375rem;
  }

  .stat-cell .stat-value {
    font-size: 0.9rem;
  }

  .attr-row {
    grid-template-columns: 100px 1fr 36px;
  }

  .attr-row.has-upgrade {
    grid-template-columns: 100px 1fr 36px 28px;
  }

  .attr-name {
    font-size: 0.7rem;
  }

  .attr-value {
    font-size: 0.7rem;
  }

  .modal-footer {
    flex-wrap: wrap;
    gap: 12px;
  }

  .contract-info {
    gap: 1.5rem;
  }

  .contract-label {
    font-size: 0.65rem;
  }

  .contract-value {
    font-size: 0.9rem;
  }

  .btn-close-footer {
    padding: 8px 20px;
    font-size: 0.8rem;
  }

  .badges-grid-modal {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }

  .badge-name-modal {
    font-size: 0.7rem;
  }

  .awards-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 0.75rem;
  }

  .award-card {
    padding: 0.75rem;
  }

  .upgrade-points-banner {
    padding: 10px 12px;
    gap: 6px;
  }

  .pool-value {
    font-size: 1.1rem;
  }
}

/* Recent Games (Game Log Table) */
.recent-performances-section {
  margin-top: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-lg);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.recent-performances-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin-bottom: 10px;
}

/* Secondary tab bar inside the stats box (Recent Games / Career Highs). */
.stat-subtabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.stat-subtab-btn {
  padding: 5px 12px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}
.stat-subtab-btn:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--color-text-primary);
}
.stat-subtab-btn.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
  box-shadow: 0 2px 8px rgba(232, 90, 79, 0.3);
}

.game-log-table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

.game-log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.7rem;
  white-space: nowrap;
  min-width: 520px;
}

.game-log-table th {
  padding: 4px 6px;
  text-align: center;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.6rem;
}

.game-log-table td {
  padding: 5px 6px;
  text-align: center;
  color: var(--color-text-secondary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.game-log-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.04);
}

.game-log-date {
  text-align: left !important;
  color: var(--color-text-tertiary) !important;
}

.game-log-opp {
  font-weight: 600;
  color: var(--color-text-primary) !important;
}

.game-log-pts {
  font-weight: 700;
  color: var(--color-text-primary) !important;
}

.game-log-win {
  color: var(--color-success) !important;
  font-weight: 700;
}

.game-log-loss {
  color: var(--color-error) !important;
  font-weight: 700;
}

.draft-info-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md, 8px);
}

.draft-info-pick {
  font-size: 1.2rem;
  font-weight: 800;
  color: var(--color-primary);
  min-width: 36px;
  text-align: center;
}

.draft-info-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.draft-info-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-weight: 600;
}

.draft-info-team {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
}

.origin-card {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md, 8px);
}

.origin-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.origin-value {
  font-size: 0.95rem;
  color: var(--color-text-primary);
  font-weight: 600;
}

.origin-country {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  font-style: italic;
}

.current-season-row {
  background: rgba(139, 92, 246, 0.08);
}

.current-season-row:hover {
  background: rgba(139, 92, 246, 0.14) !important;
}

.playoff-subrow {
  background: rgba(139, 92, 246, 0.04);
}

.playoff-subrow:hover {
  background: rgba(139, 92, 246, 0.04) !important;
}

.playoff-subrow td {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  font-weight: 500;
  padding-top: 4px;
  padding-bottom: 4px;
}

.playoff-label {
  padding-left: 18px !important;
  text-align: left !important;
  white-space: nowrap;
  font-style: italic;
}

.season-year-cell {
  font-weight: 600;
  color: var(--color-text-primary) !important;
  text-align: left !important;
  white-space: nowrap;
}

.current-tag {
  color: var(--color-primary);
  margin-left: 2px;
  font-weight: 700;
}

/* Scouting Mode Styles */
.unknown-rating-modal {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-md);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
}

.scouting-locked-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--color-text-tertiary);
  text-align: center;
}

.scouting-locked-section svg {
  opacity: 0.4;
}

.scouting-locked-section p {
  font-size: 0.85rem;
  font-weight: 500;
  margin: 0;
}

.locked-hint {
  font-size: 0.72rem;
  opacity: 0.6;
  font-style: italic;
}

.unknown-badge {
  border-color: rgba(255, 255, 255, 0.1) !important;
  opacity: 0.5;
}

.unknown-badge .badge-name-preview {
  color: var(--color-text-tertiary);
}

/* Stat pop animation for scouting reveal */
@keyframes stat-pop {
  0% {
    transform: scale(1);
    color: inherit;
  }
  30% {
    transform: scale(1.3);
    color: var(--color-success, #4CAF50);
  }
  100% {
    transform: scale(1);
    color: inherit;
  }
}

.attr-value.stat-pop {
  animation: stat-pop 0.4s ease-out;
}

/* ── Roster Editor IAP flavor editing (history + personality) ─────────── */
.flavor-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid rgba(232, 90, 79, 0.35);
  background: rgba(232, 90, 79, 0.12);
  color: var(--color-primary);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
}

.flavor-edit-btn.inline {
  margin-left: 8px;
  padding: 3px 8px;
  font-size: 0.66rem;
  vertical-align: middle;
}

.flavor-edit-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-lg, 12px);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
}

.flavor-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.flavor-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.64rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  font-weight: 700;
}

.flavor-input {
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  padding: 7px 9px;
  font-size: 0.88rem;
  min-width: 0;
  max-width: 150px;
}

.flavor-traits {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.flavor-trait {
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--color-text-secondary);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.flavor-trait.on {
  background: rgba(232, 90, 79, 0.16);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.flavor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.flavor-cancel {
  padding: 7px 14px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  font-weight: 600;
  cursor: pointer;
}

.flavor-save {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 16px;
  border-radius: 8px;
  background: var(--color-primary);
  border: none;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.flavor-save:disabled,
.flavor-cancel:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
