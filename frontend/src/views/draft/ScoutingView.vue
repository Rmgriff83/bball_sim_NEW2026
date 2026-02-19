<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useLeagueStore } from '@/stores/league'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { buildRookieDraftOrder } from '@/engine/draft/DraftOrderService'
import { LoadingSpinner } from '@/components/ui'
import { Search, ChevronUp, ChevronDown, ArrowLeft } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const campaignStore = useCampaignStore()
const leagueStore = useLeagueStore()

const campaignId = computed(() => route.params.id)
const loading = ref(true)
const activeTab = ref('rookies')

// Rookies tab state
const rookies = ref([])
const filterPosition = ref('ALL')
const searchQuery = ref('')
const sortColumn = ref('overallRating')
const sortDirection = ref('desc')

// Mock draft tab state
const mockDraftOrder = ref([])
const userTeamId = ref(null)

const campaign = computed(() => campaignStore.currentCampaign)
const isOffseason = computed(() => campaign.value?.phase === 'offseason')

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
                <th class="stat-col">Country</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(player, i) in filteredRookies"
                :key="player.id"
                class="prospect-row"
              >
                <td class="rank-col">{{ i + 1 }}</td>
                <td class="player-col">
                  <span class="player-name">{{ player.firstName }} {{ player.lastName }}</span>
                </td>
                <td class="stat-col">
                  <span class="pos-badge">{{ player.position }}</span>
                </td>
                <td class="stat-col">{{ player.age }}</td>
                <td class="stat-col highlight">{{ player.overallRating }}</td>
                <td class="stat-col">{{ player.potentialRating }}</td>
                <td class="stat-col">{{ formatHeight(player.heightInches) }}</td>
                <td class="player-col college-col">{{ player.college || '—' }}</td>
                <td class="stat-col">{{ player.country === 'United States' ? 'USA' : player.country }}</td>
              </tr>
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

.rank-col {
  width: 40px;
  color: var(--color-text-tertiary);
  font-weight: 600;
}

.prospect-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.15s ease;
}

.prospect-row:nth-child(even) {
  background: rgba(255, 255, 255, 0.02);
}

.prospect-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.player-name {
  font-weight: 500;
  white-space: nowrap;
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
}
</style>
