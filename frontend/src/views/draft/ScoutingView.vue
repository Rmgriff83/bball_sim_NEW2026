<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useLeagueStore } from '@/stores/league'
import { useTeamStore } from '@/stores/team'
import { useToastStore } from '@/stores/toast'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { buildRookieDraftOrder } from '@/engine/draft/DraftOrderService'
import { useSyncStore } from '@/stores/sync'
import { LoadingSpinner, StatBadge } from '@/components/ui'
import { Search, Binoculars, User } from 'lucide-vue-next'
import PlayerDetailModal from '@/components/team/PlayerDetailModal.vue'

const route = useRoute()
const campaignStore = useCampaignStore()
const leagueStore = useLeagueStore()
const teamStore = useTeamStore()
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

// Player detail modal state
const selectedPlayer = ref(null)
const showPlayerModal = ref(false)

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

const BASE_REVEAL_COUNT = 8
const PERK_REVEAL_COUNT = Math.ceil(ALL_ATTRIBUTES.length / 3) // 33% per action = 3 actions to fully scout
const TOTAL_SCOUT_ACTIONS = 4 // base: 4 scout actions x 8 attrs = 32 total

function getRevealedAttributes(playerId) {
  return scoutedPlayers.value[playerId]?.revealedAttributes || []
}

function isAttributeRevealed(playerId, attr) {
  return getRevealedAttributes(playerId).includes(attr)
}

function getScoutProgress(playerId) {
  const revealed = getRevealedAttributes(playerId).length
  const perAction = hasExtraReveals() ? PERK_REVEAL_COUNT : BASE_REVEAL_COUNT
  const total = hasExtraReveals() ? 3 : TOTAL_SCOUT_ACTIONS
  const actions = Math.ceil(revealed / perAction)
  return { actions, total, revealed, totalAttrs: ALL_ATTRIBUTES.length }
}

function hasExtraReveals() {
  const scout = campaign.value?.settings?.scout
  const facilityLevel = teamStore.team?.facilities?.scouting ?? 1
  const perk = scout?.perks?.find(p => p.key === 'extra_reveals')
  return perk && facilityLevel >= perk.requiredLevel
}

function isFullyScouted(playerId) {
  return getRevealedAttributes(playerId).length >= ALL_ATTRIBUTES.length
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
  // Potential rating only visible at 100% scouted
  if (attr === 'potentialRating' && !isFullyScouted(player.id)) return '?'
  if (isAttributeRevealed(player.id, attr)) {
    const val = getPlayerAttributeValue(player, attr)
    return val != null ? val : '?'
  }
  return '?'
}

// Modal animation attrs computed — extracts attrs for the currently selected player
const modalAnimatingAttrs = computed(() => {
  if (!selectedPlayer.value) return {}
  const result = {}
  for (const key in animatingAttrs.value) {
    if (key.startsWith(selectedPlayer.value.id + '-')) {
      const attr = key.split('-').slice(1).join('-')
      result[attr] = true
    }
  }
  return result
})

function openPlayerModal(player) {
  selectedPlayer.value = player
  showPlayerModal.value = true
}

async function scoutPlayer(player) {
  if (scouting.value || scoutingPoints.value < 1 || isFullyScouted(player.id)) return
  scouting.value = true

  try {
    const revealed = getRevealedAttributes(player.id)
    const unrevealed = ALL_ATTRIBUTES.filter(a => !revealed.includes(a))

    if (unrevealed.length === 0) return

    // Check scout perks
    const scout = campaign.value?.settings?.scout
    const facilityLevel = teamStore.team?.facilities?.scouting ?? 1

    function isPerkActive(perkKey) {
      const perk = scout?.perks?.find(p => p.key === perkKey)
      return perk && facilityLevel >= perk.requiredLevel
    }

    // Randomly select attributes — 33% if extra_reveals perk is active, else 8
    const revealCount = isPerkActive('extra_reveals') ? PERK_REVEAL_COUNT : BASE_REVEAL_COUNT
    const toReveal = []
    const pool = [...unrevealed]
    const count = Math.min(revealCount, pool.length)
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      toReveal.push(pool.splice(idx, 1)[0])
    }

    // Update local state with attribute reveals + badge/morale perk chances
    const newRevealed = [...revealed, ...toReveal]
    const existing = scoutedPlayers.value[player.id] || {}
    scoutedPlayers.value = {
      ...scoutedPlayers.value,
      [player.id]: {
        revealedAttributes: newRevealed,
        badgesRevealed: existing.badgesRevealed || (isPerkActive('badge_reveal') && Math.random() < 0.35),
        moraleRevealed: existing.moraleRevealed || (isPerkActive('morale_reveal') && Math.random() < 0.35),
      },
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

function formatHeight(inches) {
  if (!inches) return '—'
  const ft = Math.floor(inches / 12)
  const rem = inches % 12
  return `${ft}'${rem}"`
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

function getPotentialColor(val) {
  if (val >= 85) return '#4CAF50'
  if (val >= 75) return '#8BC34A'
  if (val >= 65) return '#FFC107'
  if (val >= 55) return '#FF9800'
  return '#F44336'
}

function badgeLevelColor(level) {
  const colors = { bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700', hof: '#9B59B6' }
  return colors[level] || '#6B7280'
}

function formatBadgeName(badge) {
  if (!badge) return ''
  if (typeof badge === 'object' && badge.name) return badge.name
  const id = typeof badge === 'object' ? badge.id : badge
  if (!id) return ''
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
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
        <h1 class="page-title">SCOUTING</h1>
        <span class="draft-year" v-if="campaign">Year {{ campaign.gameYear }} Draft Class</span>
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
          Draft
        </button>
        <div class="scout-points-display">
          <Binoculars :size="14" />
          <span class="sp-value">{{ scoutingPoints }}</span>
          <span class="sp-label">Scout Points</span>
        </div>
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

        <!-- Player Cards Grid -->
        <div class="players-grid">
          <div
            v-for="player in filteredRookies"
            :key="player.id"
            class="player-card"
            @click="openPlayerModal(player)"
          >
            <div class="card-header">
              <div class="avatar-column">
                <div class="player-avatar">
                  <User class="avatar-icon" :size="32" />
                </div>
                <span class="slot-position-label" :style="{ backgroundColor: getPositionColor(player.position) }">{{ player.position }}</span>
              </div>
              <div class="player-main-info">
                <h4 class="player-name">{{ player.firstName }} {{ player.lastName }}</h4>
                <div class="player-meta">
                  <div class="position-badges">
                    <span
                      class="position-badge"
                      :style="{ backgroundColor: getPositionColor(player.position) }"
                    >
                      {{ player.position }}
                    </span>
                    <span
                      v-if="player.secondaryPosition"
                      class="position-badge secondary"
                      :style="{ backgroundColor: getPositionColor(player.secondaryPosition) }"
                    >
                      {{ player.secondaryPosition }}
                    </span>
                  </div>
                </div>
                <div class="vitals-row">
                  {{ formatHeight(player.heightInches) }} · {{ player.age }} yrs
                  <span v-if="player.college" class="college-label">· {{ player.college }}</span>
                </div>
                <!-- Scout Progress Bar -->
                <div class="scout-progress-row">
                  <label class="meter-label">SCOUTED</label>
                  <div class="scout-meter-bar">
                    <div class="scout-meter-fill" :style="{ width: getScoutPercent(player.id) + '%' }" />
                  </div>
                  <span class="scout-pct-value">{{ getScoutPercent(player.id) }}%</span>
                </div>
              </div>
              <div class="rating-container">
                <!-- OVR -->
                <StatBadge v-if="isAttributeRevealed(player.id, 'overallRating')" :value="player.overallRating" size="md" />
                <div v-else class="unknown-rating">?</div>
                <!-- POT -->
                <div class="pot-badge-row">
                  <span class="pot-label">POT</span>
                  <span v-if="isFullyScouted(player.id)" class="pot-value" :style="{ color: getPotentialColor(player.potentialRating) }">{{ player.potentialRating }}</span>
                  <span v-else class="pot-value hidden-pot">?</span>
                </div>
                <button
                  v-if="!isFullyScouted(player.id)"
                  class="scout-btn-card"
                  :disabled="scoutingPoints < 1 || scouting"
                  @click.stop="scoutPlayer(player)"
                >
                  <Binoculars :size="13" />
                  Scout
                </button>
                <span v-else class="fully-scouted-tag">Full</span>
              </div>
            </div>
            <!-- Badges footer -->
            <div v-if="player.badges?.length > 0" class="card-badges-footer">
              <template v-if="scoutedPlayers[player.id]?.badgesRevealed">
                <div
                  v-for="badge in player.badges.slice(0, 3)"
                  :key="badge.id"
                  class="badge-item"
                >
                  <span class="badge-dot" :style="{ backgroundColor: badgeLevelColor(badge.level) }" />
                  <span class="badge-name revealed">{{ formatBadgeName(badge) }}</span>
                </div>
              </template>
              <template v-else>
                <div
                  v-for="n in Math.min(player.badges.length, 3)"
                  :key="n"
                  class="badge-item"
                >
                  <span class="badge-dot locked-dot" />
                  <span class="badge-name">?</span>
                </div>
              </template>
              <span v-if="player.badges.length > 3" class="badge-more-count">+{{ player.badges.length - 3 }}</span>
            </div>
          </div>
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

    <!-- Player Detail Modal -->
    <PlayerDetailModal
      :show="showPlayerModal"
      :player="selectedPlayer"
      :show-growth="false"
      :show-history="false"
      :scouting-mode="true"
      :revealed-attributes="selectedPlayer ? getRevealedAttributes(selectedPlayer.id) : []"
      :is-fully-scouted="selectedPlayer ? isFullyScouted(selectedPlayer.id) : false"
      :animating-attributes="modalAnimatingAttrs"
      :scouting-points="scoutingPoints"
      :scouting-in-progress="scouting"
      :badges-revealed="selectedPlayer ? (scoutedPlayers[selectedPlayer.id]?.badgesRevealed || false) : false"
      :morale-revealed="selectedPlayer ? (scoutedPlayers[selectedPlayer.id]?.moraleRevealed || false) : false"
      @scout-player="scoutPlayer(selectedPlayer)"
      @close="showPlayerModal = false"
    />
  </div>
</template>

<style scoped>
.scouting-view {
  padding: 20px 24px;
  max-width: 1024px;
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

.scout-points-display {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: rgba(232, 90, 79, 0.1);
  border: 1px solid rgba(232, 90, 79, 0.2);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  margin-left: auto;
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
  align-items: center;
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

/* Player Card Grid */
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

.card-header {
  display: flex;
  align-items: center;
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
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 0.75rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: white;
  padding: 2px 8px;
  border-radius: var(--radius-md);
  line-height: 1.3;
  text-align: center;
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

.player-name {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-primary);
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

.position-badge.secondary {
  opacity: 0.7;
}

.vitals-row {
  font-size: 0.75rem;
  color: var(--color-text-primary);
  margin-top: 6px;
}

.college-label {
  color: var(--color-text-secondary);
}

/* Scout Progress Bar */
.scout-progress-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.meter-label {
  font-size: 0.6rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}

.scout-meter-bar {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.scout-meter-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--color-primary);
  transition: width 0.3s ease;
  opacity: 0.85;
}

.scout-pct-value {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  min-width: 28px;
  text-align: right;
}

/* Badges footer (full-width lighter bg section at card bottom) */
.card-badges-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

[data-theme="light"] .card-badges-footer {
  background: rgba(0, 0, 0, 0.03);
  border-top-color: rgba(0, 0, 0, 0.06);
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

.badge-dot.locked-dot {
  background-color: rgba(255, 255, 255, 0.2);
}

.badge-name {
  color: var(--color-text-tertiary);
}

.badge-name.revealed {
  color: var(--color-text-secondary);
}

.badge-more-count {
  font-size: 0.6rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  align-self: center;
}

/* Rating Container */
.rating-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.unknown-rating {
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

/* Potential Badge */
.pot-badge-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pot-label {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
}

.pot-value {
  font-size: 0.8rem;
  font-weight: 700;
}

.pot-value.hidden-pot {
  color: var(--color-text-tertiary);
}

/* Scout Button on Card */
.scout-btn-card {
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

.scout-btn-card:hover:not(:disabled) {
  background: rgba(232, 90, 79, 0.25);
}

.scout-btn-card:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.fully-scouted-tag {
  font-size: 0.68rem;
  font-weight: 600;
  color: #4CAF50;
  text-transform: uppercase;
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

  .scout-points-display .sp-label {
    display: none;
  }
}
</style>
