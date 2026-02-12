<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTeamStore } from '@/stores/team'
import { useCampaignStore } from '@/stores/campaign'
import { useTradeStore } from '@/stores/trade'
import { useToastStore } from '@/stores/toast'
import { usePositionValidation } from '@/composables/usePositionValidation'
import { GlassCard, BaseButton, LoadingSpinner, StatBadge } from '@/components/ui'
import { User, ArrowUpDown, AlertTriangle, Calendar } from 'lucide-vue-next'
import TradeCenter from '@/components/trade/TradeCenter.vue'
import FinancesTab from '@/components/team/FinancesTab.vue'
import ScheduleTab from '@/components/team/ScheduleTab.vue'
import PlayerDetailModal from '@/components/team/PlayerDetailModal.vue'

const route = useRoute()
const teamStore = useTeamStore()
const campaignStore = useCampaignStore()
const tradeStore = useTradeStore()
const toastStore = useToastStore()

// Only show loading if we don't have cached team data
const loading = ref(!teamStore.team)
const validTabs = ['team', 'coach', 'finances', 'trades', 'schedule']
const queryTab = route.query?.tab
const hashTab = route.hash?.slice(1)
const initialTab = queryTab || hashTab
const activeTab = ref(validTabs.includes(initialTab) ? initialTab : 'team')
const selectedPlayer = ref(null)
const showPlayerModal = ref(false)

// Evolution history display state
const showAllRecentEvolution = ref(false)
const showAllTimeEvolution = ref(false)
const showAllTimeExpanded = ref(false)

// Move dropdown state
const expandedMovePlayer = ref(null)
const swappingLineup = ref(false)

// Animation state for lineup changes - supports multiple players
const animatingPlayers = ref({}) // { [playerId]: 'up' | 'down' }

// Coach settings state
const schemesFetched = ref(false)
const updatingScheme = ref(false)
const selectedScheme = ref(null)
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
  }
}

// Position validation
const { POSITIONS, canPlayPosition } = usePositionValidation()

const campaignId = computed(() => route.params.id)
const campaign = computed(() => campaignStore.currentCampaign)
const team = computed(() => teamStore.team)
const roster = computed(() => teamStore.roster)
const coach = computed(() => teamStore.coach)

// Starters in position order (PG, SG, SF, PF, C) - may contain nulls for empty slots
const starters = computed(() => roster.value.slice(0, 5))

// Starter slots - always 5 positions, with player or null
const starterSlots = computed(() => {
  return POSITIONS.map((pos, index) => ({
    position: pos,
    player: starters.value[index] || null
  }))
})

// Drag state (declared early so bench watch can reference it)
const draggingPlayerId = ref(null)

// Bench players sorted by target minutes (highest to lowest), injured players at end
const benchPlayers = computed(() => {
  return [...roster.value.slice(5)]
    .filter(p => p !== null)
    .sort((a, b) => {
      const aInjured = a.is_injured || a.isInjured ? 1 : 0
      const bInjured = b.is_injured || b.isInjured ? 1 : 0
      if (aInjured !== bInjured) return aInjured - bInjured
      const aMins = playerMinutes.value[a.id] ?? 0
      const bMins = playerMinutes.value[b.id] ?? 0
      if (bMins !== aMins) return bMins - aMins
      return b.overall_rating - a.overall_rating
    })
})

// Display list for bench — defers re-sort by 500ms after drag ends for smooth animation
const displayBenchPlayers = ref([])
let benchSortTimer = null

watch(benchPlayers, (newVal) => {
  if (!draggingPlayerId.value && !benchSortTimer) {
    displayBenchPlayers.value = [...newVal]
  }
}, { immediate: true })

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
})

// Initialize player minutes — defaults sum to exactly 200
function initPlayerMinutes() {
  const stored = teamStore.targetMinutes || {}
  const lineupIds = new Set(teamStore.lineup?.filter(id => id !== null) || [])
  const hasStored = Object.keys(stored).length > 0

  // If we have stored values and they're reasonable (within 190-210), use them
  if (hasStored) {
    const storedTotal = Object.values(stored).reduce((s, m) => s + (m || 0), 0)
    if (storedTotal >= 190 && storedTotal <= 210) {
      const newMinutes = {}
      for (const player of roster.value) {
        if (!player) continue
        const isInjured = player.is_injured || player.isInjured
        newMinutes[player.id] = isInjured ? 0 : (stored[player.id] ?? 0)
      }
      playerMinutes.value = newMinutes
      return
    }
  }

  // Build fresh defaults that sum to 200
  const starters = []
  const bench = []
  for (const player of roster.value) {
    if (!player) continue
    if (lineupIds.has(player.id)) {
      starters.push(player)
    } else {
      bench.push(player)
    }
  }

  // Sort bench by rating descending
  bench.sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))

  const newMinutes = {}

  // Injured starters get 0
  let healthyStarterCount = 0
  for (const p of starters) {
    const isInjured = p.is_injured || p.isInjured
    if (isInjured) {
      newMinutes[p.id] = 0
    } else {
      healthyStarterCount++
    }
  }

  // Distribute 200 mins: healthy starters get equal share of 160, bench gets rest
  const starterMins = healthyStarterCount > 0 ? Math.floor(160 / healthyStarterCount) : 0
  let starterTotal = 0
  for (const p of starters) {
    if (newMinutes[p.id] === 0) continue // already set injured to 0
    newMinutes[p.id] = Math.min(starterMins, 40)
    starterTotal += newMinutes[p.id]
  }

  // Bench: top 3 healthy bench players split remaining minutes
  let benchBudget = 200 - starterTotal
  const benchSlots = [16, 12, 8, 4]
  for (let i = 0; i < bench.length; i++) {
    const p = bench[i]
    const isInjured = p.is_injured || p.isInjured
    if (isInjured || benchBudget <= 0 || i >= benchSlots.length) {
      newMinutes[p.id] = 0
    } else {
      const mins = Math.min(benchSlots[i], benchBudget)
      newMinutes[p.id] = mins
      benchBudget -= mins
    }
  }

  playerMinutes.value = newMinutes
}

// Watch roster changes to reinitialize minutes
watch(roster, () => {
  initPlayerMinutes()
}, { immediate: true })

// Total minutes computed
const totalMinutes = computed(() =>
  Object.values(playerMinutes.value).reduce((sum, m) => sum + (m || 0), 0)
)

const totalMinutesColor = computed(() => {
  const t = totalMinutes.value
  if (t >= 195 && t <= 205) return '#22c55e'
  if ((t >= 185 && t < 195) || (t > 205 && t <= 215)) return '#f59e0b'
  return '#ef4444'
})

function getPlayerMinutes(playerId, fallback = 0) {
  return playerMinutes.value[playerId] ?? fallback
}

function setPlayerMinutes(playerId, desired) {
  const current = playerMinutes.value[playerId] || 0
  const othersTotal = totalMinutes.value - current
  const available = 200 - othersTotal
  playerMinutes.value[playerId] = Math.max(0, Math.min(desired, available))
  debouncedSaveMinutes()
}

function getMinutesMeterColor(mins) {
  if (mins <= 0) return '#6b7280'
  if (mins <= 20) return '#22c55e'
  if (mins <= 32) return '#3b82f6'
  if (mins <= 36) return '#f59e0b'
  return '#ef4444'
}

const draggingMinFloor = ref(0)

function calcMinutesFromEvent(e, bar) {
  const rect = bar.getBoundingClientRect()
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return Math.round(ratio * 40)
}

function startMinutesDrag(e, playerId, minFloor) {
  e.preventDefault()
  draggingPlayerId.value = playerId
  draggingMinFloor.value = minFloor
  const bar = e.currentTarget.closest('.minutes-meter-bar') || e.currentTarget
  bar.classList.add('dragging')
  const mins = Math.max(minFloor, Math.min(40, calcMinutesFromEvent(e, bar)))
  setPlayerMinutes(playerId, mins)

  const onMove = (moveEvent) => {
    moveEvent.preventDefault()
    const m = Math.max(minFloor, Math.min(40, calcMinutesFromEvent(moveEvent, bar)))
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
watch(activeTab, async (newTab, oldTab) => {
  // Clear trade state when leaving the trades tab
  if (oldTab === 'trades' && newTab !== 'trades') {
    tradeStore.clearTrade()
    tradeStore.clearSelectedTeam()
  }

  if (newTab === 'coach' && !schemesFetched.value) {
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

function openPlayerModal(player) {
  selectedPlayer.value = player
  showPlayerModal.value = true
}

function closePlayerModal() {
  showPlayerModal.value = false
  selectedPlayer.value = null
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

// Get swap candidates for a starter (bench players who can play this position)
function getStarterSwapCandidates(slotPosition) {
  return benchPlayers.value.filter(p => canPlayPosition(p, slotPosition))
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
  swappingLineup.value = true

  // Get the starter being replaced (will move down)
  const starterBeingReplaced = starters.value[starterIndex]

  try {
    // Build new lineup array (handle null values for empty slots)
    const newLineup = starters.value.map(p => p ? p.id : null)
    newLineup[starterIndex] = benchPlayerId

    closeMoveDropdown()

    await teamStore.updateLineup(campaignId.value, newLineup)
    await teamStore.fetchTeam(campaignId.value, { force: true })

    toastStore.showSuccess('Lineup updated')

    // Trigger animations for both players
    animatingPlayers.value = {
      [benchPlayerId]: 'up',
      ...(starterBeingReplaced ? { [starterBeingReplaced.id]: 'down' } : {})
    }

    // Clear animations after they complete
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

  const playerToMove = starters.value[starterIndex]

  try {
    // Build new lineup with null for the empty position (handle existing nulls)
    const newLineup = starters.value.map((p, i) => i === starterIndex ? null : (p ? p.id : null))

    closeMoveDropdown()

    await teamStore.updateLineup(campaignId.value, newLineup)
    await teamStore.fetchTeam(campaignId.value, { force: true })

    toastStore.showSuccess('Lineup updated')

    // Trigger slide down animation
    animatingPlayers.value = { [playerToMove.id]: 'down' }

    // Clear animation after it completes
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
  swappingLineup.value = true

  // Get the starter being replaced (if any)
  const posIndex = POSITIONS.indexOf(targetPosition)
  const starterBeingReplaced = starters.value[posIndex]

  try {
    // Build new lineup (handle null values for empty slots)
    const newLineup = starters.value.map(p => p ? p.id : null)
    newLineup[posIndex] = benchPlayer.id

    closeMoveDropdown()

    await teamStore.updateLineup(campaignId.value, newLineup)
    await teamStore.fetchTeam(campaignId.value, { force: true })

    toastStore.showSuccess('Lineup updated')

    // Trigger animations for both players
    animatingPlayers.value = {
      [benchPlayer.id]: 'up',
      ...(starterBeingReplaced ? { [starterBeingReplaced.id]: 'down' } : {})
    }

    // Clear animations after they complete
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

function formatBadgeName(badge) {
  // Handle both badge object and string id
  if (!badge) return ''

  // If passed a badge object with a name, use it directly
  if (typeof badge === 'object' && badge.name) {
    return badge.name
  }

  // Otherwise format the id (handle both object.id and raw string)
  const badgeId = typeof badge === 'object' ? badge.id : badge
  if (!badgeId) return ''

  return badgeId
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatAttrName(attrKey) {
  if (!attrKey) return ''
  return attrKey
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim()
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

// Get top 3 badges sorted by level
function getTopBadges(badges) {
  if (!badges) return []
  const levelOrder = { hof: 0, gold: 1, silver: 2, bronze: 3 }
  return [...badges]
    .sort((a, b) => (levelOrder[a.level] || 4) - (levelOrder[b.level] || 4))
    .slice(0, 3)
}

// Evolution history processing
const evolutionHistory = computed(() => {
  if (!selectedPlayer.value?.development_history) return []
  return selectedPlayer.value.development_history || []
})

// Get date 7 days ago for filtering recent evolution
const sevenDaysAgo = computed(() => {
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return date.toISOString().split('T')[0]
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

// Mock player news - in production this would come from backend
const playerNews = computed(() => {
  if (!selectedPlayer.value) return []
  return []
})

// Handle attribute upgrade from PlayerDetailModal
async function handleUpgradeAttribute({ playerId, category, attribute }) {
  try {
    const result = await teamStore.upgradePlayerAttribute(
      campaignId.value,
      playerId,
      category,
      attribute
    )
    toastStore.showSuccess(`${formatAttrName(attribute)} upgraded to ${result.new_value}!`)
    // Refresh selected player with updated data
    selectedPlayer.value = roster.value.find(p => p.id === playerId)
  } catch (err) {
    toastStore.showError(err.response?.data?.message || 'Upgrade failed')
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
      <section class="team-header">
        <div class="team-header-row">
          <div
            class="team-logo-badge"
            :style="{ backgroundColor: team.primary_color || '#E85A4F' }"
          >
            {{ team.abbreviation }}
          </div>
          <div class="team-header-text">
            <p class="team-city">{{ team.city }} · {{ conferenceLabel }}</p>
            <h1 class="team-name">{{ team.name }}</h1>
          </div>
        </div>
      </section>

      <!-- Tab Navigation -->
      <div class="tab-nav">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'team' }"
          @click="activeTab = 'team'"
        >
          Team
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'coach' }"
          @click="activeTab = 'coach'"
        >
          Coach
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'finances' }"
          @click="activeTab = 'finances'"
        >
          Finances
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'trades' }"
          @click="activeTab = 'trades'"
        >
          Trades
        </button>
        <button
          class="tab-btn tab-btn-icon"
          :class="{ active: activeTab === 'schedule' }"
          @click="activeTab = 'schedule'"
          title="Schedule"
        >
          <Calendar :size="18" />
        </button>
      </div>

      <!-- Roster View -->
      <div v-if="activeTab === 'team'" class="roster-content">
        <!-- Starters Section -->
        <div class="roster-list-header card-cosmic">
          <h3 class="list-header-text">STARTERS</h3>
          <span class="total-minutes-value">{{ totalMinutes }} / 200 MIN</span>
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
                  <h4 class="player-name empty-name">Empty Slot</h4>
                  <div class="player-meta">
                    <span class="position-badge" :style="{ backgroundColor: getPositionColor(slot.position) }">
                      {{ slot.position }}
                    </span>
                    <span class="role-badge starter">STARTER</span>
                  </div>
                </div>
                <div class="rating-container">
                  <button class="move-btn" @click.stop="toggleMoveDropdown(`starter-empty-${index}`)" title="Add player">
                    <ArrowUpDown :size="14" />
                  </button>
                  <div class="empty-rating">--</div>
                </div>
              </div>
              <!-- Empty slot dropdown - show bench players who can play this position -->
              <Transition name="dropdown-slide">
                <div v-if="expandedMovePlayer === `starter-empty-${index}`" class="move-dropdown">
                  <div class="dropdown-header">Select player for {{ slot.position }}</div>
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
                        <User :size="16" />
                      </div>
                      <span class="dropdown-name">{{ candidate.name }}</span>
                      <span class="dropdown-position-badge" :style="{ backgroundColor: getPositionColor(candidate.position) }">
                        {{ candidate.position }}
                      </span>
                      <span v-if="candidate.is_injured || candidate.isInjured" class="dropdown-injury">INJ</span>
                      <StatBadge :value="candidate.overall_rating" size="sm" />
                    </button>
                    <div v-if="getStarterSwapCandidates(slot.position).length === 0" class="dropdown-empty">
                      No available players
                    </div>
                  </div>
                </div>
              </Transition>
            </div>

            <!-- Filled Slot -->
            <div
              v-else
              class="player-card"
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
                <div class="player-avatar">
                  <User class="avatar-icon" :size="32" />
                </div>
                <div class="player-main-info">
                  <h4 class="player-name" :class="{ 'text-injured': slot.player.is_injured || slot.player.isInjured }">
                    {{ slot.player.name }}
                  </h4>
                  <div class="player-meta">
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
                    <span v-if="!(slot.player.is_injured || slot.player.isInjured)" class="role-badge starter">STARTER</span>
                    <span v-if="slot.player.is_injured || slot.player.isInjured" class="injury-tag">
                      Injured - {{ (slot.player.injury_details?.games_remaining || slot.player.injuryDetails?.games_remaining || 0) }} {{ (slot.player.injury_details?.games_remaining || slot.player.injuryDetails?.games_remaining || 0) === 1 ? 'game' : 'games' }}
                    </span>
                  </div>
                  <div class="vitals-row">{{ slot.player.height || "6'6\"" }} · {{ formatWeight(slot.player.weight) }} lbs · {{ slot.player.age || 25 }} yrs</div>
                  <!-- Minutes Meter -->
                  <div class="minutes-meter-row" @click.stop>
                    <label class="meter-label">MIN</label>
                    <div class="minutes-meter-bar"
                      @mousedown="(e) => startMinutesDrag(e, slot.player.id, 8)"
                      @touchstart="(e) => startMinutesDrag(e, slot.player.id, 8)"
                    >
                      <div
                        class="minutes-meter-fill"
                        :style="{
                          width: (getPlayerMinutes(slot.player.id, 30) / 40 * 100) + '%',
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
                    <label class="meter-label fatigue-label">FATIGUE</label>
                    <div class="fatigue-meter-bar">
                      <div
                        class="fatigue-meter-fill"
                        :style="{
                          width: (slot.player.fatigue || 0) + '%',
                          backgroundColor: getFatigueColor(slot.player.fatigue || 0)
                        }"
                      ></div>
                    </div>
                    <span class="fatigue-value">{{ slot.player.fatigue || 0 }}%</span>
                    <AlertTriangle v-if="isOverFatigued(slot.player.fatigue || 0)" :size="12" class="fatigue-warning-icon" />
                  </div>
                </div>
                <div class="rating-container">
                  <StatBadge :value="slot.player.overall_rating" size="md" />
                  <button class="move-btn" :class="{ active: expandedMovePlayer === `starter-${slot.player.id}` }" @click.stop="toggleMoveDropdown(`starter-${slot.player.id}`)" title="Adjust lineup">
                    <ArrowUpDown :size="14" />
                  </button>
                </div>
              </div>

              <!-- Move Dropdown for Starters -->
              <Transition name="dropdown-slide">
                <div v-if="expandedMovePlayer === `starter-${slot.player.id}`" class="move-dropdown">
                  <div class="dropdown-header">Replace {{ slot.player.name }}</div>
                  <div class="dropdown-list">
                    <!-- Move to Bench option (empty-looking) -->
                    <button class="dropdown-item empty-option" @click.stop="moveToBench(index)">
                      <ArrowUpDown :size="14" class="dropdown-move-icon" />
                      <div class="dropdown-avatar empty">
                        <span class="empty-icon">−</span>
                      </div>
                      <span class="dropdown-name">Move to Bench</span>
                      <span class="dropdown-hint">No replacement</span>
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
                        <User :size="16" />
                      </div>
                      <div class="dropdown-name-row">
                        <span class="dropdown-name">{{ candidate.name }}</span>
                        <span class="dropdown-fatigue" :style="{ color: getFatigueColor(candidate.fatigue || 0) }">{{ candidate.fatigue || 0 }}%</span>
                      </div>
                      <span class="dropdown-position-badge" :style="{ backgroundColor: getPositionColor(candidate.position) }">
                        {{ candidate.position }}
                      </span>
                      <span v-if="candidate.is_injured || candidate.isInjured" class="dropdown-injury">INJ</span>
                      <StatBadge :value="candidate.overall_rating" size="sm" />
                    </button>
                  </div>
                </div>
              </Transition>

              <!-- Card body only shows when dropdown is closed -->
              <div v-if="expandedMovePlayer !== `starter-${slot.player.id}`" class="card-body">
                <!-- Season Stats (compact) -->
                <div v-if="slot.player.season_stats" class="stats-inline">
                  <span class="stat-inline"><span class="stat-label">PPG</span><span class="stat-val">{{ slot.player.season_stats.ppg }}</span></span>
                  <span class="stat-inline"><span class="stat-label">RPG</span><span class="stat-val">{{ slot.player.season_stats.rpg }}</span></span>
                  <span class="stat-inline"><span class="stat-label">APG</span><span class="stat-val">{{ slot.player.season_stats.apg }}</span></span>
                  <span class="stat-inline"><span class="stat-label">SPG</span><span class="stat-val">{{ slot.player.season_stats.spg }}</span></span>
                  <span class="stat-inline"><span class="stat-label">BPG</span><span class="stat-val">{{ slot.player.season_stats.bpg }}</span></span>
                  <span class="stat-inline"><span class="stat-label">FG%</span><span class="stat-val">{{ slot.player.season_stats.fg_pct }}</span></span>
                  <span class="stat-inline"><span class="stat-label">3P%</span><span class="stat-val">{{ slot.player.season_stats.three_pct }}</span></span>
                </div>

                <!-- Badges -->
                <div v-if="slot.player.badges?.length > 0" class="badges-row">
                  <div
                    v-for="badge in getTopBadges(slot.player.badges)"
                    :key="badge.id"
                    class="badge-item"
                    :title="`${formatBadgeName(badge)} (${badge.level})`"
                  >
                    <span
                      class="badge-dot"
                      :style="{ backgroundColor: getBadgeLevelColor(badge.level) }"
                    />
                    <span class="badge-name">{{ formatBadgeName(badge) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Bench Section -->
        <div class="roster-list-header card-cosmic">
          <h3 class="list-header-text">BENCH</h3>
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
              <div class="player-avatar">
                <User class="avatar-icon" :size="32" />
              </div>
              <div class="player-main-info">
                <h4 class="player-name" :class="{ 'text-injured': player.is_injured || player.isInjured }">
                  {{ player.name }}
                </h4>
                <div class="player-meta">
                  <div class="position-badges">
                    <span class="position-badge" :style="{ backgroundColor: getPositionColor(player.position) }">
                      {{ player.position }}
                    </span>
                    <span v-if="player.secondary_position" class="position-badge secondary" :style="{ backgroundColor: getPositionColor(player.secondary_position) }">
                      {{ player.secondary_position }}
                    </span>
                  </div>
                  <span v-if="!(player.is_injured || player.isInjured)" class="role-badge bench">BENCH</span>
                  <span v-if="player.is_injured || player.isInjured" class="injury-tag">
                    Injured - {{ (player.injury_details?.games_remaining || player.injuryDetails?.games_remaining || 0) }} {{ (player.injury_details?.games_remaining || player.injuryDetails?.games_remaining || 0) === 1 ? 'game' : 'games' }}
                  </span>
                </div>
                <div class="vitals-row">{{ player.height || "6'6\"" }} · {{ formatWeight(player.weight) }} lbs · {{ player.age || 25 }} yrs</div>
                <!-- Minutes Meter -->
                <div class="minutes-meter-row" @click.stop>
                  <label class="meter-label">MIN</label>
                  <div class="minutes-meter-bar"
                    @mousedown="(e) => startMinutesDrag(e, player.id, 0)"
                    @touchstart="(e) => startMinutesDrag(e, player.id, 0)"
                  >
                    <div
                      class="minutes-meter-fill"
                      :style="{
                        width: (getPlayerMinutes(player.id, 0) / 40 * 100) + '%',
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
                  <label class="meter-label fatigue-label">FATIGUE</label>
                  <div class="fatigue-meter-bar">
                    <div
                      class="fatigue-meter-fill"
                      :style="{
                        width: (player.fatigue || 0) + '%',
                        backgroundColor: getFatigueColor(player.fatigue || 0)
                      }"
                    ></div>
                  </div>
                  <span class="fatigue-value">{{ player.fatigue || 0 }}%</span>
                  <AlertTriangle v-if="isOverFatigued(player.fatigue || 0)" :size="12" class="fatigue-warning-icon" />
                </div>
              </div>
              <div class="rating-container">
                <StatBadge :value="player.overall_rating" size="md" />
                <button class="move-btn" :class="{ active: expandedMovePlayer === `bench-${player.id}` }" @click.stop="toggleMoveDropdown(`bench-${player.id}`)" title="Adjust lineup">
                  <ArrowUpDown :size="14" />
                </button>
              </div>
            </div>

            <!-- Move Dropdown for Bench Players -->
            <Transition name="dropdown-slide">
              <div v-if="expandedMovePlayer === `bench-${player.id}`" class="move-dropdown">
                <div class="dropdown-header">Move to starting lineup</div>
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
                    <span class="dropdown-name">Fill Empty Slot</span>
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
                      <User :size="16" />
                    </div>
                    <div class="dropdown-name-row">
                      <span class="dropdown-name">{{ candidate.name }}</span>
                      <span class="dropdown-fatigue" :style="{ color: getFatigueColor(candidate.fatigue || 0) }">{{ candidate.fatigue || 0 }}%</span>
                    </div>
                    <span class="dropdown-position-badge" :style="{ backgroundColor: getPositionColor(candidate.position) }">
                      {{ candidate.slotPosition }}
                    </span>
                    <span v-if="candidate.is_injured || candidate.isInjured" class="dropdown-injury">INJ</span>
                    <StatBadge :value="candidate.overall_rating" size="sm" />
                  </button>
                  <div v-if="getBenchSwapCandidates(player).length === 0 && getEmptySlotCandidates(player).length === 0" class="dropdown-empty">
                    No compatible positions
                  </div>
                </div>
              </div>
            </Transition>

            <!-- Card body only shows when dropdown is closed -->
            <div v-if="expandedMovePlayer !== `bench-${player.id}`" class="card-body">
              <!-- Season Stats (compact) -->
              <div v-if="player.season_stats" class="stats-inline">
                <span class="stat-inline"><span class="stat-label">PPG</span><span class="stat-val">{{ player.season_stats.ppg }}</span></span>
                <span class="stat-inline"><span class="stat-label">RPG</span><span class="stat-val">{{ player.season_stats.rpg }}</span></span>
                <span class="stat-inline"><span class="stat-label">APG</span><span class="stat-val">{{ player.season_stats.apg }}</span></span>
                <span class="stat-inline"><span class="stat-label">SPG</span><span class="stat-val">{{ player.season_stats.spg }}</span></span>
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
                  <span class="badge-name">{{ formatBadgeName(badge) }}</span>
                </div>
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
                <h4 class="player-name empty-name">Empty Roster Slot</h4>
                <div class="player-meta">
                  <span class="empty-hint">{{ 15 - roster.length - n + 1 }} of {{ availableRosterSlots }} available</span>
                </div>
              </div>
              <div class="rating-container">
                <div class="empty-rating">--</div>
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- Coach Settings View -->
      <div v-else-if="activeTab === 'coach'" class="coach-content">
        <!-- Coach Info Card -->
        <GlassCard v-if="coach" padding="lg" :hoverable="false">
          <h3 class="h4 mb-4">Head Coach</h3>
          <div class="coach-header">
            <div class="coach-avatar">
              {{ coach.name?.charAt(0) || 'C' }}
            </div>
            <div class="coach-info">
              <p class="coach-name">{{ coach.name }}</p>
              <div class="coach-rating">
                <StatBadge :value="coach.overall_rating" size="sm" />
                <span class="rating-label">Overall Rating</span>
              </div>
            </div>
          </div>

          <!-- Career Stats -->
          <div v-if="coach.career_stats" class="career-stats-section mt-4">
            <h4 class="section-title">Career Record</h4>
            <div class="career-stats-grid">
              <div class="career-stat-box">
                <span class="career-stat-value">{{ coach.career_stats.wins }}-{{ coach.career_stats.losses }}</span>
                <span class="career-stat-label">Regular Season</span>
                <span class="career-stat-pct">{{ coach.career_stats.win_pct }}%</span>
              </div>
              <div class="career-stat-box">
                <span class="career-stat-value">{{ coach.career_stats.playoff_wins }}-{{ coach.career_stats.playoff_losses }}</span>
                <span class="career-stat-label">Playoffs</span>
                <span class="career-stat-pct">{{ coach.career_stats.playoff_win_pct }}%</span>
              </div>
              <div class="career-stat-box highlight">
                <span class="career-stat-value">{{ coach.career_stats.championships }}</span>
                <span class="career-stat-label">Championships</span>
              </div>
              <div class="career-stat-box">
                <span class="career-stat-value">{{ coach.career_stats.seasons_coached }}</span>
                <span class="career-stat-label">Seasons</span>
              </div>
            </div>

            <!-- Awards row -->
            <div v-if="coach.career_stats.conference_titles > 0 || coach.career_stats.coach_of_year_awards > 0" class="awards-row mt-3">
              <span v-if="coach.career_stats.conference_titles > 0" class="award-badge">
                {{ coach.career_stats.conference_titles }}x Conference Champion
              </span>
              <span v-if="coach.career_stats.coach_of_year_awards > 0" class="award-badge gold">
                {{ coach.career_stats.coach_of_year_awards }}x Coach of the Year
              </span>
            </div>
          </div>

          <!-- Coach Attributes -->
          <div v-if="coach.attributes" class="coach-attributes mt-4">
            <h4 class="section-title">Coaching Skills</h4>
            <div class="attr-grid">
              <div v-for="(value, key) in coach.attributes" :key="key" class="coach-attr-item">
                <span class="attr-label">{{ formatAttrName(key) }}</span>
                <div class="attr-bar-mini">
                  <div class="attr-fill" :style="{ width: `${value}%`, backgroundColor: getAttrColor(value) }" />
                </div>
                <span class="attr-val" :style="{ color: getAttrColor(value) }">{{ value }}</span>
              </div>
            </div>
          </div>
        </GlassCard>

        <!-- Offensive Scheme Selection -->
        <GlassCard padding="lg" :hoverable="false" class="mt-6">
          <div class="scheme-section-header">
            <div class="section-label">OFFENSE</div>
          </div>
          <div class="flex items-center justify-between mb-4">
            <h3 class="h4">Offensive Scheme</h3>
            <div v-if="teamStore.recommendedScheme" class="recommended-badge">
              Recommended: {{ teamStore.coachingSchemes[teamStore.recommendedScheme]?.name }}
            </div>
          </div>

          <p class="text-secondary text-sm mb-6">
            Choose an offensive scheme that fits your roster's strengths. This affects play selection and tempo during games.
          </p>

          <div v-if="teamStore.loading && !schemesFetched" class="flex justify-center py-8">
            <LoadingSpinner size="md" />
          </div>

          <div v-else class="schemes-grid">
            <div
              v-for="(scheme, schemeId) in teamStore.coachingSchemes"
              :key="schemeId"
              class="scheme-card"
              :class="{
                active: (selectedScheme || team?.coaching_scheme?.offensive || team?.coaching_scheme) === schemeId,
                recommended: teamStore.recommendedScheme === schemeId
              }"
              @click="updateOffensiveScheme(schemeId)"
            >
              <div class="scheme-header">
                <span class="scheme-name">{{ scheme.name }}</span>
                <span v-if="teamStore.recommendedScheme === schemeId" class="rec-tag">Best Fit</span>
              </div>

              <p class="scheme-desc">{{ scheme.description }}</p>

              <div class="scheme-details">
                <div class="scheme-pace">
                  <span class="detail-label">Pace</span>
                  <span class="detail-value" :class="scheme.pace">{{ scheme.pace?.replace('_', ' ') }}</span>
                </div>
                <div class="scheme-effectiveness">
                  <span class="detail-label">Fit</span>
                  <span class="detail-value" :class="getEffectivenessClass(scheme.effectiveness)">
                    {{ scheme.effectiveness }}%
                  </span>
                </div>
              </div>

              <div class="scheme-traits">
                <div class="trait-section">
                  <span class="trait-label">Strengths</span>
                  <div class="trait-tags">
                    <span v-for="str in scheme.strengths" :key="str" class="trait-tag positive">{{ str }}</span>
                  </div>
                </div>
                <div class="trait-section">
                  <span class="trait-label">Weaknesses</span>
                  <div class="trait-tags">
                    <span v-for="weak in scheme.weaknesses" :key="weak" class="trait-tag negative">{{ weak }}</span>
                  </div>
                </div>
              </div>

              <div v-if="updatingScheme && (selectedScheme || team?.coaching_scheme?.offensive || team?.coaching_scheme) === schemeId" class="scheme-loading">
                <LoadingSpinner size="sm" />
              </div>
            </div>
          </div>
        </GlassCard>

        <!-- Defensive Scheme Selection -->
        <GlassCard padding="lg" :hoverable="false" class="mt-6">
          <div class="scheme-section-header">
            <div class="section-label defense">DEFENSE</div>
          </div>
          <div class="flex items-center justify-between mb-4">
            <h3 class="h4">Defensive Scheme</h3>
          </div>

          <p class="text-secondary text-sm mb-6">
            Select your team's defensive strategy. This determines how your players guard opponents and react to plays.
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
                active: (selectedDefensiveScheme || team?.coaching_scheme?.defensive || 'man') === schemeId
              }"
              @click="updateDefensiveScheme(schemeId)"
            >
              <div class="scheme-header">
                <span class="scheme-name">{{ scheme.name }}</span>
                <span class="scheme-type-tag" :class="scheme.type">{{ scheme.type }}</span>
              </div>

              <p class="scheme-desc">{{ scheme.description }}</p>

              <div class="scheme-traits">
                <div class="trait-section">
                  <span class="trait-label">Strengths</span>
                  <div class="trait-tags">
                    <span v-for="str in scheme.strengths" :key="str" class="trait-tag positive">{{ str }}</span>
                  </div>
                </div>
                <div class="trait-section">
                  <span class="trait-label">Weaknesses</span>
                  <div class="trait-tags">
                    <span v-for="weak in scheme.weaknesses" :key="weak" class="trait-tag negative">{{ weak }}</span>
                  </div>
                </div>
              </div>

              <div v-if="updatingScheme && (selectedDefensiveScheme || team?.coaching_scheme?.defensive || 'man') === schemeId" class="scheme-loading">
                <LoadingSpinner size="sm" />
              </div>
            </div>
          </div>
        </GlassCard>

        <!-- Substitution Strategy Selection -->
        <GlassCard padding="lg" :hoverable="false" class="mt-6">
          <div class="scheme-section-header">
            <div class="section-label substitution">ROTATION</div>
          </div>
          <div class="flex items-center justify-between mb-4">
            <h3 class="h4">Substitution Strategy</h3>
          </div>

          <p class="text-secondary text-sm mb-6">
            Control how your team rotates players during simulated games. This affects how minutes are distributed and when substitutions happen.
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
                <span class="scheme-name">{{ strategy.name }}</span>
                <span class="scheme-type-tag" :class="strategy.type">{{ strategy.type }}</span>
              </div>

              <p class="scheme-desc">{{ strategy.description }}</p>

              <div class="scheme-details">
                <div class="scheme-pace">
                  <span class="detail-label">Depth</span>
                  <span class="detail-value">{{ strategy.rotation_depth }}</span>
                </div>
              </div>

              <div class="scheme-traits">
                <div class="trait-section">
                  <span class="trait-label">Strengths</span>
                  <div class="trait-tags">
                    <span v-for="str in strategy.strengths" :key="str" class="trait-tag positive">{{ str }}</span>
                  </div>
                </div>
                <div class="trait-section">
                  <span class="trait-label">Weaknesses</span>
                  <div class="trait-tags">
                    <span v-for="weak in strategy.weaknesses" :key="weak" class="trait-tag negative">{{ weak }}</span>
                  </div>
                </div>
              </div>

              <div v-if="updatingScheme && selectedSubStrategy === strategyId" class="scheme-loading">
                <LoadingSpinner size="sm" />
              </div>
            </div>
          </div>
        </GlassCard>
      </div>

      <!-- Finances View -->
      <div v-else-if="activeTab === 'finances'" class="finances-content">
        <FinancesTab :campaign-id="campaignId" />
      </div>

      <!-- Trades View -->
      <div v-else-if="activeTab === 'trades'" class="trades-content">
        <TradeCenter :campaign-id="campaignId" @trade-completed="activeTab = 'team'" />
      </div>

      <!-- Schedule View -->
      <div v-else-if="activeTab === 'schedule'" class="schedule-content">
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
      @close="closePlayerModal"
      @upgrade-attribute="handleUpgradeAttribute"
    />
  </div>
</template>

<style scoped>
.roster-view {
  padding: 8px 16px;
  padding-bottom: 100px;
  max-width: 1024px;
  margin: 0 auto;
}

.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  opacity: 0.6;
}

/* Team Header - Matching home page */
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
  grid-template-columns: 1fr;
  gap: 12px;
}

@media (min-width: 768px) {
  .players-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .players-grid {
    grid-template-columns: repeat(3, 1fr);
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
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.1);
}

.player-avatar {
  width: 54px;
  height: 54px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
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
  font-size: 0.95rem;
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
  margin-top: 6px;
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
  margin-top: 4px;
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
  gap: 1px;
}

.stat-inline .stat-label {
  display: block;
  font-size: 0.5rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 0;
  line-height: 1;
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
  background: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
  text-align: center;
}

.career-stat-box.highlight {
  background: rgba(232, 90, 79, 0.15);
  border: 1px solid rgba(232, 90, 79, 0.3);
}

.career-stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
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
  background: rgba(0, 0, 0, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.scheme-card:hover {
  background: rgba(0, 0, 0, 0.3);
  border-color: rgba(255, 255, 255, 0.2);
}

.scheme-card.active {
  background: rgba(232, 90, 79, 0.1);
  border-color: var(--color-primary);
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

.scheme-section-header {
  margin-bottom: 12px;
}

.section-label {
  display: inline-block;
  padding: 4px 12px;
  background: rgba(232, 90, 79, 0.15);
  border: 1px solid rgba(232, 90, 79, 0.3);
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--color-primary);
}

.section-label.defense {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
  color: #3B82F6;
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

@media (max-width: 500px) {
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

/* Total Minutes Value (in header) */
.total-minutes-value {
  font-size: 0.8rem;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  color: var(--color-primary);
  position: relative;
  z-index: 1;
}

/* Player Minutes Meter */
.minutes-meter-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.minutes-meter-bar {
  flex: 1;
  height: 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  overflow: visible;
  cursor: pointer;
  position: relative;
}

.minutes-meter-fill {
  height: 100%;
  border-radius: 5px;
  transition: width 0.2s ease, background-color 0.2s ease;
  position: relative;
}

.minutes-meter-bar.dragging .minutes-meter-fill {
  transition: none;
}

.minutes-thumb {
  position: absolute;
  right: -7px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
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
  text-align: right;
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

.section-label.substitution {
  background: linear-gradient(135deg, #8B5CF6, #7C3AED);
  color: white;
  padding: 4px 12px;
  border-radius: var(--radius-md);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}
</style>
