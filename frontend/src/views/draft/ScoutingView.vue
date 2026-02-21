<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useLeagueStore } from '@/stores/league'
import { useToastStore } from '@/stores/toast'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { buildRookieDraftOrder } from '@/engine/draft/DraftOrderService'
import { useSyncStore } from '@/stores/sync'
import { LoadingSpinner } from '@/components/ui'
import { Search, ChevronUp, ChevronDown, ChevronRight, ArrowLeft, Eye } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const campaignStore = useCampaignStore()
const leagueStore = useLeagueStore()
const toastStore = useToastStore()
const syncStore = useSyncStore()

const campaignId = computed(() => route.params.id)
const loading = ref(true)
const activeTab = ref('rookies')

// Rookies tab state
const rookies = ref([])
const filterPosition = ref('ALL')
const searchQuery = ref('')
const sortColumn = ref('overallRating')
const sortDirection = ref('desc')
const expandedPlayerId = ref(null)

// Scouting state
const scoutedPlayers = ref({})
const scoutingPoints = ref(0)
const scouting = ref(false)
const animatingAttrs = ref({}) // { `${playerId}-${attr}`: true } for stat-pop animation

// Mock draft tab state
const mockDraftOrder = ref([])
const userTeamId = ref(null)

const campaign = computed(() => campaignStore.currentCampaign)
const isOffseason = computed(() => campaign.value?.phase === 'offseason')

// All 32 attributes in the scouting pool
const ALL_ATTRIBUTES = [
  'overallRating', 'potentialRating',
  // Offense (12)
  'threePoint', 'midRange', 'closeShot', 'layup', 'passAccuracy', 'passVision',
  'passIQ', 'ballHandling', 'postControl', 'drivingDunk', 'standingDunk', 'drawFoul',
  // Defense (8)
  'perimeterDefense', 'interiorDefense', 'helpDefenseIQ', 'passPerception',
  'steal', 'block', 'defensiveRebound', 'offensiveRebound',
  // Physical (5)
  'speed', 'acceleration', 'vertical', 'stamina', 'strength',
  // Mental (5)
  'workEthic', 'basketballIQ', 'clutch', 'consistency', 'intangibles',
]

const ATTRIBUTE_CATEGORIES = {
  'Ratings': ['overallRating', 'potentialRating'],
  'Offense': ['threePoint', 'midRange', 'closeShot', 'layup', 'passAccuracy', 'passVision', 'passIQ', 'ballHandling', 'postControl', 'drivingDunk', 'standingDunk', 'drawFoul'],
  'Defense': ['perimeterDefense', 'interiorDefense', 'helpDefenseIQ', 'passPerception', 'steal', 'block', 'defensiveRebound', 'offensiveRebound'],
  'Physical': ['speed', 'acceleration', 'vertical', 'stamina', 'strength'],
  'Mental': ['workEthic', 'basketballIQ', 'clutch', 'consistency', 'intangibles'],
}

const TOTAL_SCOUT_ACTIONS = 4 // 4 scout actions x 8 attrs = 32 total

function getRevealedAttributes(playerId) {
  return scoutedPlayers.value[playerId]?.revealedAttributes || []
}

function isAttributeRevealed(playerId, attr) {
  return getRevealedAttributes(playerId).includes(attr)
}

function getScoutProgress(playerId) {
  const revealed = getRevealedAttributes(playerId).length
  const actions = Math.ceil(revealed / 8)
  return { actions, total: TOTAL_SCOUT_ACTIONS, revealed, totalAttrs: ALL_ATTRIBUTES.length }
}

function isFullyScouted(playerId) {
  return getRevealedAttributes(playerId).length >= ALL_ATTRIBUTES.length
}

function isAttrAnimating(playerId, attr) {
  return !!animatingAttrs.value[`${playerId}-${attr}`]
}

function getScoutPercent(playerId) {
  const revealed = getRevealedAttributes(playerId).length
  return Math.round((revealed / ALL_ATTRIBUTES.length) * 100)
}

function getPlayerAttributeValue(player, attr) {
  // Rating attributes are top-level
  if (attr === 'overallRating') return player.overallRating
  if (attr === 'potentialRating') return player.potentialRating

  // Check in attribute sub-objects
  const attrs = player.attributes || {}
  for (const category of ['offense', 'defense', 'physical', 'mental']) {
    if (attrs[category] && attrs[category][attr] !== undefined) {
      return attrs[category][attr]
    }
  }

  // Direct lookup fallback
  return player[attr] ?? null
}

function getDisplayValue(player, attr) {
  if (isAttributeRevealed(player.id, attr)) {
    const val = getPlayerAttributeValue(player, attr)
    return val != null ? val : '?'
  }
  return '?'
}

async function scoutPlayer(player) {
  if (scouting.value || scoutingPoints.value < 1 || isFullyScouted(player.id)) return
  scouting.value = true

  try {
    const revealed = getRevealedAttributes(player.id)
    const unrevealed = ALL_ATTRIBUTES.filter(a => !revealed.includes(a))

    if (unrevealed.length === 0) return

    // Randomly select 8 (or remaining) attributes
    const toReveal = []
    const pool = [...unrevealed]
    const count = Math.min(8, pool.length)
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      toReveal.push(pool.splice(idx, 1)[0])
    }

    // Update local state
    const newRevealed = [...revealed, ...toReveal]
    scoutedPlayers.value = {
      ...scoutedPlayers.value,
      [player.id]: { revealedAttributes: newRevealed },
    }
    scoutingPoints.value -= 1

    // Persist to campaign settings (deep-copy reactive proxy to plain object for IndexedDB)
    const camp = await CampaignRepository.get(campaignId.value)
    if (camp) {
      camp.settings = camp.settings ?? {}
      camp.settings.scoutedPlayers = JSON.parse(JSON.stringify(scoutedPlayers.value))
      camp.settings.scoutingPoints = scoutingPoints.value
      await CampaignRepository.save(camp)
    }

    // Update campaign store
    if (campaignStore.currentCampaign) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        scoutedPlayers: JSON.parse(JSON.stringify(scoutedPlayers.value)),
        scoutingPoints: scoutingPoints.value,
      }
    }

    syncStore.markDirty()

    const playerName = player.firstName + ' ' + player.lastName
    toastStore.showSuccess(`Scouted ${playerName}: ${toReveal.length} attributes revealed!`)

    // Auto-expand the player to show results
    expandedPlayerId.value = player.id

    // Trigger stat-pop animation on newly revealed attributes
    const newAnims = {}
    toReveal.forEach(attr => { newAnims[`${player.id}-${attr}`] = true })
    animatingAttrs.value = { ...animatingAttrs.value, ...newAnims }
    setTimeout(() => {
      const cleared = { ...animatingAttrs.value }
      toReveal.forEach(attr => { delete cleared[`${player.id}-${attr}`] })
      animatingAttrs.value = cleared
    }, 500)
  } catch (err) {
    console.error('Failed to scout player:', err)
    toastStore.showError('Failed to scout player')
  } finally {
    scouting.value = false
  }
}

function toggleExpand(playerId) {
  expandedPlayerId.value = expandedPlayerId.value === playerId ? null : playerId
}

const filteredRookies = computed(() => {
  let players = rookies.value

  if (filterPosition.value !== 'ALL') {
    players = players.filter(p =>
      p.position === filterPosition.value ||
      p.secondaryPosition === filterPosition.value
    )
  }

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase().trim()
    players = players.filter(p =>
      (p.name || `${p.firstName} ${p.lastName}`).toLowerCase().includes(q)
    )
  }

  // Always sort by real values (even if hidden)
  const col = sortColumn.value
  const dir = sortDirection.value === 'desc' ? -1 : 1
  players = [...players].sort((a, b) => {
    const aVal = a[col] ?? 0
    const bVal = b[col] ?? 0
    if (typeof aVal === 'string') return dir * aVal.localeCompare(bVal)
    return dir * (aVal - bVal)
  })

  return players
})

function toggleSort(col) {
  if (sortColumn.value === col) {
    sortDirection.value = sortDirection.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortColumn.value = col
    sortDirection.value = 'desc'
  }
}

function getSortIcon(col) {
  if (sortColumn.value !== col) return null
  return sortDirection.value === 'desc' ? 'desc' : 'asc'
}

function formatHeight(inches) {
  if (!inches) return '—'
  const ft = Math.floor(inches / 12)
  const rem = inches % 12
  return `${ft}'${rem}"`
}

function formatAttrName(attr) {
  const nameMap = {
    overallRating: 'Overall',
    potentialRating: 'Potential',
    threePoint: '3PT Shot',
    midRange: 'Mid-Range',
    closeShot: 'Close Shot',
    layup: 'Layup',
    passAccuracy: 'Pass Accuracy',
    passVision: 'Pass Vision',
    passIQ: 'Pass IQ',
    ballHandling: 'Ball Handling',
    postControl: 'Post Control',
    drivingDunk: 'Driving Dunk',
    standingDunk: 'Standing Dunk',
    drawFoul: 'Draw Foul',
    perimeterDefense: 'Perimeter D',
    interiorDefense: 'Interior D',
    helpDefenseIQ: 'Help Defense IQ',
    passPerception: 'Pass Perception',
    steal: 'Steal',
    block: 'Block',
    defensiveRebound: 'Def. Rebound',
    offensiveRebound: 'Off. Rebound',
    speed: 'Speed',
    acceleration: 'Acceleration',
    vertical: 'Vertical',
    stamina: 'Stamina',
    strength: 'Strength',
    workEthic: 'Work Ethic',
    basketballIQ: 'Basketball IQ',
    clutch: 'Clutch',
    consistency: 'Consistency',
    intangibles: 'Intangibles',
  }
  return nameMap[attr] || attr
}

function getAttrColor(val) {
  if (val == null || val === '?') return 'var(--color-text-tertiary)'
  if (val >= 85) return '#4CAF50'
  if (val >= 75) return '#8BC34A'
  if (val >= 65) return '#FFC107'
  if (val >= 55) return '#FF9800'
  return '#F44336'
}

// Mock Draft tab — round grouping
const mockRound1 = computed(() => mockDraftOrder.value.filter(s => s.round === 1))
const mockRound2 = computed(() => mockDraftOrder.value.filter(s => s.round === 2))

onMounted(async () => {
  loading.value = true
  try {
    let camp = campaignStore.currentCampaign
    if (!camp || camp.id !== campaignId.value) {
      camp = await campaignStore.fetchCampaign(campaignId.value)
    }

    userTeamId.value = camp?.teamId

    // Load scouting data from campaign settings
    scoutedPlayers.value = camp?.settings?.scoutedPlayers || {}
    scoutingPoints.value = camp?.settings?.scoutingPoints ?? 0

    const gameYear = camp?.gameYear ?? 1
    const allPlayers = await PlayerRepository.getAllForCampaign(campaignId.value)

    // Filter draft prospects for this year
    rookies.value = allPlayers.filter(p => p.isDraftProspect && p.draftYear === gameYear)

    // Build mock draft order
    const teams = await TeamRepository.getAllForCampaign(campaignId.value)
    const seasonYear = camp?.currentSeasonYear ?? 2025
    const seasonData = await SeasonRepository.get(campaignId.value, seasonYear)
    const standings = seasonData?.standings || { east: [], west: [] }

    if (teams.length > 0) {
      mockDraftOrder.value = buildRookieDraftOrder(teams, standings, gameYear)
    }
  } catch (e) {
    console.error('Failed to load scouting data:', e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="scouting-view">
    <!-- Header -->
    <div class="scouting-header">
      <div class="header-left">
        <button class="back-btn" @click="router.push(`/campaign/${campaignId}`)">
          <ArrowLeft :size="18" />
        </button>
        <h1 class="page-title">SCOUTING</h1>
        <span class="draft-year" v-if="campaign">Year {{ campaign.gameYear }} Draft Class</span>
      </div>
      <div class="header-right">
        <div class="scout-points-display">
          <Eye :size="14" />
          <span class="sp-value">{{ scoutingPoints }}</span>
          <span class="sp-label">Scout Points</span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="lg" />
      <p>Loading scouting data...</p>
    </div>

    <template v-else>
      <!-- Tabs -->
      <div class="tab-nav">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'rookies' }"
          @click="activeTab = 'rookies'"
        >
          Rookies
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'mock-draft' }"
          @click="activeTab = 'mock-draft'"
        >
          Mock Draft
        </button>
      </div>

      <!-- Rookies Tab -->
      <div v-if="activeTab === 'rookies'" class="tab-content">
        <!-- Filters -->
        <div class="filters-row">
          <div class="position-filters">
            <button
              v-for="pos in ['ALL', 'PG', 'SG', 'SF', 'PF', 'C']"
              :key="pos"
              class="pos-filter-btn"
              :class="{ active: filterPosition === pos }"
              @click="filterPosition = pos"
            >
              {{ pos }}
            </button>
          </div>
          <div class="search-box">
            <Search :size="14" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search rookies..."
              class="search-input"
            />
          </div>
          <div class="player-count">{{ filteredRookies.length }} prospects</div>
        </div>

        <!-- Rookies Table -->
        <div class="table-wrap">
          <table class="scouting-table">
            <thead>
              <tr>
                <th class="caret-col"></th>
                <th class="rank-col">#</th>
                <th class="player-col sortable" :class="{ active: sortColumn === 'name' }" @click="toggleSort('name')">
                  Name
                  <ChevronUp v-if="getSortIcon('name') === 'asc'" :size="12" />
                  <ChevronDown v-if="getSortIcon('name') === 'desc'" :size="12" />
                </th>
                <th class="stat-col">Pos</th>
                <th class="stat-col sortable" :class="{ active: sortColumn === 'age' }" @click="toggleSort('age')">
                  Age
                  <ChevronUp v-if="getSortIcon('age') === 'asc'" :size="12" />
                  <ChevronDown v-if="getSortIcon('age') === 'desc'" :size="12" />
                </th>
                <th class="stat-col sortable highlight" :class="{ active: sortColumn === 'overallRating' }" @click="toggleSort('overallRating')">
                  OVR
                  <ChevronUp v-if="getSortIcon('overallRating') === 'asc'" :size="12" />
                  <ChevronDown v-if="getSortIcon('overallRating') === 'desc'" :size="12" />
                </th>
                <th class="stat-col sortable" :class="{ active: sortColumn === 'potentialRating' }" @click="toggleSort('potentialRating')">
                  POT
                  <ChevronUp v-if="getSortIcon('potentialRating') === 'asc'" :size="12" />
                  <ChevronDown v-if="getSortIcon('potentialRating') === 'desc'" :size="12" />
                </th>
                <th class="stat-col sortable" :class="{ active: sortColumn === 'heightInches' }" @click="toggleSort('heightInches')">
                  Height
                  <ChevronUp v-if="getSortIcon('heightInches') === 'asc'" :size="12" />
                  <ChevronDown v-if="getSortIcon('heightInches') === 'desc'" :size="12" />
                </th>
                <th class="player-col">College</th>
                <th class="stat-col">Scouted</th>
                <th class="action-col"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(player, i) in filteredRookies" :key="player.id">
                <tr
                  class="prospect-row"
                  :class="{ expanded: expandedPlayerId === player.id }"
                  @click="toggleExpand(player.id)"
                >
                  <td class="caret-col">
                    <ChevronRight :size="14" class="row-caret" :class="{ open: expandedPlayerId === player.id }" />
                  </td>
                  <td class="rank-col">{{ i + 1 }}</td>
                  <td class="player-col">
                    <span class="player-name">{{ player.firstName }} {{ player.lastName }}</span>
                    <span v-if="getScoutPercent(player.id) > 0" class="scout-pct">{{ getScoutPercent(player.id) }}%</span>
                  </td>
                  <td class="stat-col">
                    <span class="pos-badge">{{ player.position }}</span>
                  </td>
                  <td class="stat-col">{{ player.age }}</td>
                  <td class="stat-col highlight">
                    <span :class="{ hidden: !isAttributeRevealed(player.id, 'overallRating') }">
                      {{ getDisplayValue(player, 'overallRating') }}
                    </span>
                  </td>
                  <td class="stat-col">
                    <span :class="{ hidden: !isAttributeRevealed(player.id, 'potentialRating') }">
                      {{ getDisplayValue(player, 'potentialRating') }}
                    </span>
                  </td>
                  <td class="stat-col">{{ formatHeight(player.heightInches) }}</td>
                  <td class="player-col college-col">{{ player.college || '—' }}</td>
                  <td class="stat-col">
                    <span class="scout-progress" :class="{ complete: isFullyScouted(player.id) }">
                      {{ getScoutProgress(player.id).actions }}/{{ TOTAL_SCOUT_ACTIONS }}
                    </span>
                  </td>
                  <td class="action-col" @click.stop>
                    <button
                      v-if="!isFullyScouted(player.id)"
                      class="scout-btn"
                      :class="{ disabled: scoutingPoints < 1 || scouting }"
                      :disabled="scoutingPoints < 1 || scouting"
                      @click="scoutPlayer(player)"
                    >
                      <Eye :size="13" />
                      Scout
                    </button>
                    <span v-else class="fully-scouted-tag">Full</span>
                  </td>
                </tr>
                <!-- Expanded Detail Panel -->
                <Transition name="dropdown-slide">
                  <tr v-if="expandedPlayerId === player.id" class="detail-row">
                    <td :colspan="11">
                      <div class="detail-panel">
                        <div
                          v-for="(attrs, category) in ATTRIBUTE_CATEGORIES"
                          :key="category"
                          class="attr-category"
                        >
                          <h4 class="category-title">{{ category }}</h4>
                          <div class="attr-grid">
                            <div
                              v-for="attr in attrs"
                              :key="attr"
                              class="attr-item"
                              :class="{ revealed: isAttributeRevealed(player.id, attr) }"
                            >
                              <span class="attr-name">{{ formatAttrName(attr) }}</span>
                              <span
                                class="attr-value"
                                :class="{ 'stat-pop': isAttrAnimating(player.id, attr) }"
                                :style="{ color: isAttributeRevealed(player.id, attr) ? getAttrColor(getPlayerAttributeValue(player, attr)) : 'var(--color-text-tertiary)' }"
                              >
                                {{ getDisplayValue(player, attr) }}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </Transition>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Mock Draft Tab -->
      <div v-if="activeTab === 'mock-draft'" class="tab-content">
        <div class="mock-draft-label">
          {{ isOffseason ? 'Final Draft Order' : 'Projected Draft Order' }}
        </div>

        <!-- Round 1 -->
        <div class="mock-round">
          <h3 class="round-title">Round 1</h3>
          <div class="mock-picks">
            <div
              v-for="slot in mockRound1"
              :key="slot.pick"
              class="mock-pick-row"
              :class="{
                'user-team': slot.teamId === userTeamId,
                'is-traded': slot.isTraded
              }"
            >
              <span class="pick-number">{{ slot.pickInRound }}</span>
              <div class="pick-team-info">
                <div class="pick-owner">
                  <div class="team-logo" :style="{ backgroundColor: slot.teamColor }">
                    {{ slot.teamAbbr }}
                  </div>
                  <span class="team-name">{{ slot.teamName }}</span>
                </div>
                <div v-if="slot.isTraded" class="pick-origin">
                  <span class="traded-badge">TRADED</span>
                  <span class="origin-text">
                    Originally
                    <span class="origin-team-abbr" :style="{ color: slot.originalTeamColor }">{{ slot.originalTeamAbbr }}</span>
                    pick ({{ slot.originalTeamName }})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Round 2 -->
        <div class="mock-round">
          <h3 class="round-title">Round 2</h3>
          <div class="mock-picks">
            <div
              v-for="slot in mockRound2"
              :key="slot.pick"
              class="mock-pick-row"
              :class="{
                'user-team': slot.teamId === userTeamId,
                'is-traded': slot.isTraded
              }"
            >
              <span class="pick-number">{{ slot.pickInRound }}</span>
              <div class="pick-team-info">
                <div class="pick-owner">
                  <div class="team-logo" :style="{ backgroundColor: slot.teamColor }">
                    {{ slot.teamAbbr }}
                  </div>
                  <span class="team-name">{{ slot.teamName }}</span>
                </div>
                <div v-if="slot.isTraded" class="pick-origin">
                  <span class="traded-badge">TRADED</span>
                  <span class="origin-text">
                    Originally
                    <span class="origin-team-abbr" :style="{ color: slot.originalTeamColor }">{{ slot.originalTeamAbbr }}</span>
                    pick ({{ slot.originalTeamName }})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.scouting-view {
  padding: 20px 24px;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header */
.scouting-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.scout-points-display {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: rgba(232, 90, 79, 0.1);
  border: 1px solid rgba(232, 90, 79, 0.2);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
}

.scout-points-display svg {
  color: var(--color-primary);
}

.sp-value {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.2rem;
  color: var(--color-text-primary);
}

.sp-label {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-tertiary);
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.page-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.8rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  background: var(--gradient-cosmic);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.draft-year {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 60px 0;
  color: var(--color-text-secondary);
}

/* Tabs */
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

/* Filters */
.filters-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.position-filters {
  display: flex;
  gap: 4px;
}

.pos-filter-btn {
  padding: 6px 14px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.pos-filter-btn.active {
  background: var(--gradient-cosmic);
  color: black;
  border-color: transparent;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  flex: 1;
  max-width: 220px;
}

.search-box svg {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.search-input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-text-primary);
  font-size: 0.8rem;
  width: 100%;
}

.search-input::placeholder {
  color: var(--color-text-tertiary);
}

.player-count {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-left: auto;
}

/* Table */
.table-wrap {
  overflow-x: auto;
  border-radius: var(--radius-xl);
  border: 1px solid var(--glass-border);
  background: var(--color-bg-secondary);
}

.scouting-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.scouting-table th,
.scouting-table td {
  padding: 8px 6px;
  text-align: center;
}

.scouting-table th {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.scouting-table th.sortable {
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.scouting-table th.sortable:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.scouting-table th.sortable.active {
  color: var(--color-primary);
  background: rgba(232, 90, 79, 0.1);
}

.scouting-table th svg {
  vertical-align: middle;
  margin-left: 2px;
}

.scouting-table .player-col {
  text-align: left !important;
  min-width: 130px;
}

.scouting-table .stat-col {
  min-width: 45px;
}

.scouting-table .stat-col.highlight {
  color: var(--color-primary);
  font-weight: 600;
}

.action-col {
  width: 80px;
  min-width: 80px;
}

/* Caret Column */
.caret-col {
  width: 28px;
  min-width: 28px;
  padding-left: 10px !important;
  padding-right: 0 !important;
}

.row-caret {
  color: var(--color-text-tertiary);
  transition: transform 0.25s ease;
  flex-shrink: 0;
}

.row-caret.open {
  transform: rotate(90deg);
  color: var(--color-primary);
}

.rank-col {
  width: 40px;
  color: var(--color-text-tertiary);
  font-weight: 600;
}

.prospect-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.15s ease;
  cursor: pointer;
}

.prospect-row:nth-child(even) {
  background: rgba(255, 255, 255, 0.02);
}

.prospect-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.prospect-row.expanded {
  background: rgba(232, 90, 79, 0.06);
}

.player-name {
  font-weight: 500;
  white-space: nowrap;
}

.scout-pct {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-primary);
  margin-left: 6px;
  opacity: 0.7;
}

.pos-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.college-col {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

/* Hidden attribute value */
.hidden {
  color: var(--color-text-tertiary);
  font-style: italic;
}

/* Scout Progress */
.scout-progress {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.scout-progress.complete {
  color: #4CAF50;
}

/* Scout Button */
.scout-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  background: rgba(232, 90, 79, 0.15);
  border: 1px solid rgba(232, 90, 79, 0.3);
  border-radius: var(--radius-md);
  color: var(--color-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.scout-btn:hover:not(.disabled) {
  background: rgba(232, 90, 79, 0.25);
}

.scout-btn.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.fully-scouted-tag {
  font-size: 0.68rem;
  font-weight: 600;
  color: #4CAF50;
  text-transform: uppercase;
}

/* Detail Panel */
.detail-row {
  background: rgba(255, 255, 255, 0.01);
}

.detail-row td {
  padding: 0 !important;
}

.detail-panel {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-top: 1px solid rgba(232, 90, 79, 0.15);
  border-bottom: 1px solid rgba(232, 90, 79, 0.15);
}

.attr-category {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-title {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.attr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 4px 12px;
}

.attr-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.78rem;
}

.attr-item.revealed {
  background: rgba(255, 255, 255, 0.03);
}

.attr-name {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

.attr-value {
  display: inline-block;
  font-weight: 600;
  font-size: 0.8rem;
  min-width: 24px;
  text-align: right;
  transition: color 0.3s ease;
}

/* Mock Draft Tab */
.mock-draft-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
  margin-bottom: 16px;
  padding: 8px 12px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
  display: inline-block;
}

.mock-round {
  margin-bottom: 24px;
}

.round-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.2rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--color-text-primary);
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--glass-border);
}

.mock-picks {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mock-pick-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  transition: background 0.15s ease;
}

.mock-pick-row:nth-child(even) {
  background: rgba(255, 255, 255, 0.02);
}

.mock-pick-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.mock-pick-row.user-team {
  background: rgba(232, 90, 79, 0.1);
}

.mock-pick-row.user-team:hover {
  background: rgba(232, 90, 79, 0.15);
}

.mock-pick-row.is-traded {
  padding: 10px 12px;
}

.pick-number {
  width: 32px;
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  text-align: center;
  flex-shrink: 0;
}

.pick-team-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.pick-owner {
  display: flex;
  align-items: center;
  gap: 10px;
}

.team-logo {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.55rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.team-name {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.pick-origin {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 42px;
}

.traded-badge {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(244, 162, 89, 0.15);
  color: #F4A259;
  flex-shrink: 0;
}

.origin-text {
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
}

.origin-team-abbr {
  font-weight: 700;
}

/* Dropdown slide animation */
.dropdown-slide-enter-active,
.dropdown-slide-leave-active {
  transition: all 0.25s ease;
  max-height: 600px;
  overflow: hidden;
}

.dropdown-slide-enter-from,
.dropdown-slide-leave-to {
  max-height: 0;
  opacity: 0;
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

/* Responsive */
@media (max-width: 768px) {
  .scouting-view {
    padding: 16px;
  }

  .page-title {
    font-size: 1.4rem;
  }

  .draft-year {
    display: none;
  }

  .filters-row {
    flex-direction: column;
    align-items: stretch;
  }

  .search-box {
    max-width: none;
  }

  .player-count {
    margin-left: 0;
  }

  .attr-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .scout-points-display .sp-label {
    display: none;
  }
}
</style>
