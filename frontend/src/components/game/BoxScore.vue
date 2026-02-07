<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  boxScore: {
    type: Object,
    required: true
  },
  homeTeam: {
    type: Object,
    required: true
  },
  awayTeam: {
    type: Object,
    required: true
  },
  activeTab: {
    type: String,
    default: 'home'
  }
})

const emit = defineEmits(['update:activeTab'])

// Sorting state
const sortColumn = ref('points')
const sortDirection = ref('desc')

const homeStats = computed(() => Array.isArray(props.boxScore?.home) ? props.boxScore.home : [])
const awayStats = computed(() => Array.isArray(props.boxScore?.away) ? props.boxScore.away : [])

const rawActiveStats = computed(() =>
  props.activeTab === 'home' ? homeStats.value : awayStats.value
)

// Sorted stats
const activeStats = computed(() => {
  const stats = [...rawActiveStats.value]
  const col = sortColumn.value
  const dir = sortDirection.value === 'desc' ? -1 : 1

  return stats.sort((a, b) => {
    let aVal = a[col] || 0
    let bVal = b[col] || 0

    // Handle string sorting for name
    if (col === 'name') {
      aVal = a.name || ''
      bVal = b.name || ''
      return dir * aVal.localeCompare(bVal)
    }

    return dir * (aVal - bVal)
  })
})

// Column definitions for sortable headers
const columns = [
  { key: 'name', label: 'Player', class: 'player-col' },
  { key: 'minutes', label: 'MIN', class: 'stat-col' },
  { key: 'points', label: 'PTS', class: 'stat-col' },
  { key: 'rebounds', label: 'REB', class: 'stat-col' },
  { key: 'assists', label: 'AST', class: 'stat-col' },
  { key: 'steals', label: 'STL', class: 'stat-col' },
  { key: 'blocks', label: 'BLK', class: 'stat-col' },
  { key: 'turnovers', label: 'TO', class: 'stat-col' },
]

function sortBy(column) {
  if (sortColumn.value === column) {
    // Toggle direction if same column
    sortDirection.value = sortDirection.value === 'desc' ? 'asc' : 'desc'
  } else {
    // New column, default to descending (except for name which defaults to asc)
    sortColumn.value = column
    sortDirection.value = column === 'name' ? 'asc' : 'desc'
  }
}

function getSortIcon(column) {
  if (sortColumn.value !== column) return ''
  return sortDirection.value === 'desc' ? ' ▼' : ' ▲'
}

const activeTeam = computed(() =>
  props.activeTab === 'home' ? props.homeTeam : props.awayTeam
)

// Calculate team totals
function calculateTotals(stats) {
  if (!Array.isArray(stats) || stats.length === 0) {
    return {
      points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0,
      fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0
    }
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
  }, {
    points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0,
    fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0
  })
}

const homeTotals = computed(() => calculateTotals(homeStats.value))
const awayTotals = computed(() => calculateTotals(awayStats.value))
const activeTotals = computed(() =>
  props.activeTab === 'home' ? homeTotals.value : awayTotals.value
)

function formatPercentage(made, attempted) {
  if (!attempted || attempted === 0) return '-'
  return ((made / attempted) * 100).toFixed(1) + '%'
}

function formatShootingLine(made, attempted) {
  return `${made || 0}-${attempted || 0}`
}
</script>

<template>
  <div class="box-score">
    <!-- Team Tabs -->
    <div class="team-tabs">
      <button
        class="team-tab"
        :class="{ active: activeTab === 'home' }"
        @click="emit('update:activeTab', 'home')"
      >
        <div
          class="team-color"
          :style="{ backgroundColor: homeTeam.primary_color || '#3B82F6' }"
        />
        <span>{{ homeTeam.abbreviation || 'HOME' }}</span>
      </button>
      <button
        class="team-tab"
        :class="{ active: activeTab === 'away' }"
        @click="emit('update:activeTab', 'away')"
      >
        <div
          class="team-color"
          :style="{ backgroundColor: awayTeam.primary_color || '#EF4444' }"
        />
        <span>{{ awayTeam.abbreviation || 'AWAY' }}</span>
      </button>
    </div>

    <!-- Stats Table -->
    <div class="table-container">
      <table class="stats-table">
        <thead>
          <tr>
            <th
              v-for="col in columns"
              :key="col.key"
              :class="[col.class, 'sortable', { active: sortColumn === col.key }]"
              @click="sortBy(col.key)"
            >
              {{ col.label }}{{ getSortIcon(col.key) }}
            </th>
            <th class="stat-col shooting">FG</th>
            <th class="stat-col shooting">3PT</th>
            <th class="stat-col shooting">FT</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="player in activeStats"
            :key="player.player_id"
            class="player-row"
          >
            <td class="player-col">
              <div class="player-info">
                <span class="player-name">{{ player.name }}</span>
                <span class="player-pos">{{ player.position }}<template v-if="player.secondary_position">/{{ player.secondary_position }}</template></span>
              </div>
            </td>
            <td class="stat-col">{{ player.minutes || 0 }}</td>
            <td class="stat-col points">{{ player.points || 0 }}</td>
            <td class="stat-col">{{ player.rebounds || 0 }}</td>
            <td class="stat-col">{{ player.assists || 0 }}</td>
            <td class="stat-col">{{ player.steals || 0 }}</td>
            <td class="stat-col">{{ player.blocks || 0 }}</td>
            <td class="stat-col turnovers">{{ player.turnovers || 0 }}</td>
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
        </tbody>
        <tfoot>
          <tr class="totals-row">
            <td class="player-col">TOTALS</td>
            <td class="stat-col">-</td>
            <td class="stat-col points">{{ activeTotals.points }}</td>
            <td class="stat-col">{{ activeTotals.rebounds }}</td>
            <td class="stat-col">{{ activeTotals.assists }}</td>
            <td class="stat-col">{{ activeTotals.steals }}</td>
            <td class="stat-col">{{ activeTotals.blocks }}</td>
            <td class="stat-col turnovers">{{ activeTotals.turnovers }}</td>
            <td class="stat-col shooting">
              <span class="shooting-line">{{ formatShootingLine(activeTotals.fgm, activeTotals.fga) }}</span>
              <span class="shooting-pct">{{ formatPercentage(activeTotals.fgm, activeTotals.fga) }}</span>
            </td>
            <td class="stat-col shooting">
              <span class="shooting-line">{{ formatShootingLine(activeTotals.fg3m, activeTotals.fg3a) }}</span>
              <span class="shooting-pct">{{ formatPercentage(activeTotals.fg3m, activeTotals.fg3a) }}</span>
            </td>
            <td class="stat-col shooting">
              <span class="shooting-line">{{ formatShootingLine(activeTotals.ftm, activeTotals.fta) }}</span>
              <span class="shooting-pct">{{ formatPercentage(activeTotals.ftm, activeTotals.fta) }}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.box-score {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  overflow: hidden;
}

.team-tabs {
  display: flex;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.team-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  background: none;
  border: none;
  color: var(--color-secondary);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.team-tab:hover {
  background: rgba(255, 255, 255, 0.05);
}

.team-tab.active {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.team-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.table-container {
  overflow-x: auto;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.stats-table th,
.stats-table td {
  padding: 10px 8px;
  text-align: center;
}

.stats-table th {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-secondary);
  font-weight: 500;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.stats-table th.sortable {
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.stats-table th.sortable:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.stats-table th.sortable.active {
  color: var(--color-primary);
  background: rgba(124, 58, 237, 0.1);
}

.player-col {
  text-align: left !important;
  min-width: 150px;
}

.stat-col {
  min-width: 40px;
}

.stat-col.shooting {
  min-width: 70px;
}

.player-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.player-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.player-info {
  display: flex;
  flex-direction: column;
}

.player-name {
  font-weight: 500;
  white-space: nowrap;
}

.player-pos {
  font-size: 0.75rem;
  color: var(--color-secondary);
}

.stat-col.points {
  font-weight: 600;
  color: var(--color-primary);
}

.stat-col.turnovers {
  color: var(--color-error);
}

.shooting-line {
  display: block;
  font-weight: 500;
}

.shooting-pct {
  display: block;
  font-size: 0.7rem;
  color: var(--color-secondary);
}

.totals-row {
  background: rgba(255, 255, 255, 0.05);
  font-weight: 600;
}

.totals-row td {
  padding: 12px 8px;
}
</style>
