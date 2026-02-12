<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useTeamStore } from '@/stores/team'
import { useToastStore } from '@/stores/toast'
import { GlassCard, LoadingSpinner } from '@/components/ui'
import { DollarSign, Users, TrendingUp, Calendar, FileText } from 'lucide-vue-next'
import ContractCard from './ContractCard.vue'
import ResignModal from './ResignModal.vue'
import SignFreeAgentModal from './SignFreeAgentModal.vue'
import DropPlayerModal from './DropPlayerModal.vue'
import PlayerDetailModal from './PlayerDetailModal.vue'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const financeStore = useFinanceStore()
const teamStore = useTeamStore()
const toastStore = useToastStore()

const loading = ref(true)
const activeSubTab = ref('team') // 'team' | 'free-agents'
const resignLoading = ref(false)
const signLoading = ref(false)
const dropLoading = ref(false)

// Player info modal state
const showPlayerInfoModal = ref(false)
const detailPlayer = ref(null)

// Computed values
const roster = computed(() => financeStore.rosterWithContracts)
const freeAgents = computed(() => financeStore.freeAgents)
const summary = computed(() => financeStore.financeSummary)
const selectedPlayer = computed(() => financeStore.selectedPlayer)
const showResignModal = computed(() => financeStore.showResignModal)
const showSignModal = computed(() => financeStore.showSignModal)
const showDropModal = computed(() => financeStore.showDropModal)

const salaryCap = computed(() => summary.value?.salary_cap || 0)
const totalPayroll = computed(() => summary.value?.total_payroll || financeStore.totalPayroll)
const capSpace = computed(() => salaryCap.value - totalPayroll.value)
const rosterCount = computed(() => roster.value.length)

// Sorted roster for display
const sortedRoster = computed(() => {
  return [...roster.value].sort((a, b) => b.contractSalary - a.contractSalary)
})

// Expiring contracts
const expiringContracts = computed(() => {
  return roster.value.filter(p => p.contractYearsRemaining === 1)
})

// Calculate contract years for visualization table
const currentYear = computed(() => {
  if (summary.value?.current_season) {
    return summary.value.current_season
  }
  return new Date().getFullYear()
})

const contractYears = computed(() => {
  const years = []
  for (let i = 0; i < 5; i++) {
    years.push(currentYear.value + i)
  }
  return years
})

// Format utilities
function formatSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1000000) {
    return `$${(salary / 1000000).toFixed(1)}M`
  }
  return `$${(salary / 1000).toFixed(0)}K`
}

function formatLargeSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1000000000) {
    return `$${(salary / 1000000000).toFixed(2)}B`
  }
  if (salary >= 1000000) {
    return `$${(salary / 1000000).toFixed(1)}M`
  }
  return `$${(salary / 1000).toFixed(0)}K`
}

// Check if player has contract in given year
function hasContractInYear(player, year) {
  const yearsFromNow = year - currentYear.value
  return yearsFromNow < player.contractYearsRemaining
}

// Fetch data
async function loadData() {
  loading.value = true
  try {
    await financeStore.fetchRosterContracts(props.campaignId)
  } catch (err) {
    console.error('Failed to load finance data:', err)
  } finally {
    loading.value = false
  }
}

async function loadFreeAgents() {
  try {
    await financeStore.fetchFreeAgents(props.campaignId)
  } catch (err) {
    console.error('Failed to load free agents:', err)
  }
}

// Modal handlers
function handleResign(player) {
  financeStore.openResignModal(player)
}

function handleDrop(player) {
  financeStore.openDropModal(player)
}

function handleSign(player) {
  financeStore.openSignModal(player)
}

function handleInfo(player) {
  detailPlayer.value = player
  showPlayerInfoModal.value = true
}

function closePlayerInfoModal() {
  showPlayerInfoModal.value = false
  detailPlayer.value = null
}

async function handleResignConfirm(data) {
  resignLoading.value = true
  try {
    await financeStore.resignPlayer(props.campaignId, data.playerId, data.years)
    // Refresh roster data
    await financeStore.fetchRosterContracts(props.campaignId, { force: true })
    toastStore.showSuccess('Player re-signed')
  } catch (err) {
    console.error('Failed to re-sign player:', err)
    toastStore.showError('Failed to re-sign player')
  } finally {
    resignLoading.value = false
  }
}

async function handleSignConfirm(data) {
  signLoading.value = true
  try {
    await financeStore.signFreeAgent(props.campaignId, data.playerId)
    // Refresh data
    await Promise.all([
      financeStore.fetchRosterContracts(props.campaignId, { force: true }),
      financeStore.fetchFreeAgents(props.campaignId, { force: true })
    ])
    toastStore.showSuccess('Player signed')
  } catch (err) {
    console.error('Failed to sign free agent:', err)
    toastStore.showError('Failed to sign player')
  } finally {
    signLoading.value = false
  }
}

async function handleDropConfirm(data) {
  dropLoading.value = true
  try {
    await financeStore.dropPlayer(props.campaignId, data.playerId)
    // Refresh roster data
    await financeStore.fetchRosterContracts(props.campaignId, { force: true })
    toastStore.showSuccess('Player released')
  } catch (err) {
    console.error('Failed to drop player:', err)
    toastStore.showError('Failed to release player')
  } finally {
    dropLoading.value = false
  }
}

// Watch for sub-tab changes to load free agents
watch(activeSubTab, async (newTab) => {
  if (newTab === 'free-agents' && freeAgents.value.length === 0) {
    await loadFreeAgents()
  }
})

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="finances-tab">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="lg" />
      <p class="text-secondary mt-4">Loading team finances...</p>
    </div>

    <template v-else>
      <!-- Financial Overview Header -->
      <GlassCard padding="lg" :hoverable="false" class="overview-card">
        <div class="overview-grid">
          <div class="overview-item">
            <div class="overview-icon cap">
              <DollarSign :size="24" />
            </div>
            <div class="overview-content">
              <span class="overview-label">Salary Cap</span>
              <span class="overview-value">{{ formatLargeSalary(salaryCap) }}</span>
            </div>
          </div>

          <div class="overview-item">
            <div class="overview-icon payroll">
              <Users :size="24" />
            </div>
            <div class="overview-content">
              <span class="overview-label">Total Payroll</span>
              <span class="overview-value">{{ formatLargeSalary(totalPayroll) }}</span>
            </div>
          </div>

          <div class="overview-item">
            <div class="overview-icon" :class="capSpace >= 0 ? 'space' : 'over'">
              <TrendingUp :size="24" />
            </div>
            <div class="overview-content">
              <span class="overview-label">Cap Space</span>
              <span class="overview-value" :class="{ negative: capSpace < 0 }">
                {{ capSpace >= 0 ? '' : '-' }}{{ formatLargeSalary(Math.abs(capSpace)) }}
              </span>
            </div>
          </div>

          <div class="overview-item">
            <div class="overview-icon roster">
              <Users :size="24" />
            </div>
            <div class="overview-content">
              <span class="overview-label">Roster</span>
              <span class="overview-value">{{ rosterCount }}/15</span>
            </div>
          </div>
        </div>

        <!-- Expiring Contracts Alert -->
        <div v-if="expiringContracts.length > 0" class="expiring-alert">
          <Calendar :size="18" />
          <span>{{ expiringContracts.length }} expiring contract{{ expiringContracts.length !== 1 ? 's' : '' }} this season</span>
        </div>
      </GlassCard>

      <!-- Sub-Tab Navigation -->
      <div class="sub-tab-nav">
        <button
          class="sub-tab-btn"
          :class="{ active: activeSubTab === 'team' }"
          @click="activeSubTab = 'team'"
        >
          <Users :size="16" />
          Team Contracts
        </button>
        <button
          class="sub-tab-btn"
          :class="{ active: activeSubTab === 'free-agents' }"
          @click="activeSubTab = 'free-agents'"
        >
          <FileText :size="16" />
          Free Agents
        </button>
      </div>

      <!-- Team Contracts View -->
      <div v-if="activeSubTab === 'team'" class="contracts-section">
        <!-- Contract Visualization Table -->
        <GlassCard padding="md" :hoverable="false" class="contract-table-card">
          <h4 class="section-title">Contract Overview</h4>
          <div class="contract-table-wrapper">
            <table class="contract-table">
              <thead>
                <tr>
                  <th class="player-col">Player</th>
                  <th class="pos-col">Pos</th>
                  <th class="salary-col">Salary</th>
                  <th
                    v-for="year in contractYears"
                    :key="year"
                    class="year-col"
                  >
                    {{ year }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="player in sortedRoster"
                  :key="player.id"
                  class="contract-row"
                  :class="{ expiring: player.contractYearsRemaining === 1 }"
                >
                  <td class="player-col">
                    <span class="player-name">{{ player.firstName }} {{ player.lastName }}</span>
                  </td>
                  <td class="pos-col">
                    <span class="pos-badge">{{ player.position }}</span>
                  </td>
                  <td class="salary-col">{{ formatSalary(player.contractSalary) }}</td>
                  <td
                    v-for="year in contractYears"
                    :key="year"
                    class="year-col"
                  >
                    <div
                      class="year-cell"
                      :class="{
                        active: hasContractInYear(player, year),
                        expiring: hasContractInYear(player, year) && year === currentYear + player.contractYearsRemaining - 1
                      }"
                    ></div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </GlassCard>

        <!-- Player Cards Grid -->
        <div class="player-cards-section">
          <h4 class="section-title">Team Roster</h4>
          <div class="player-cards-grid">
            <ContractCard
              v-for="player in sortedRoster"
              :key="player.id"
              :player="player"
              :show-stats="true"
              @resign="handleResign"
              @drop="handleDrop"
              @info="handleInfo"
            />
          </div>
        </div>
      </div>

      <!-- Free Agents View -->
      <div v-else-if="activeSubTab === 'free-agents'" class="free-agents-section">
        <div v-if="freeAgents.length === 0" class="empty-state">
          <Users :size="48" />
          <h4>No Free Agents Available</h4>
          <p>Check back after the season for available free agents.</p>
        </div>

        <div v-else class="player-cards-section">
          <h4 class="section-title">Available Free Agents</h4>
          <div class="player-cards-grid">
            <ContractCard
              v-for="player in freeAgents"
              :key="player.id"
              :player="player"
              :show-attributes="true"
              :is-free-agent="true"
              @sign="handleSign"
              @info="handleInfo"
            />
          </div>
        </div>
      </div>
    </template>

    <!-- Re-sign Modal -->
    <ResignModal
      :show="showResignModal"
      :player="selectedPlayer"
      :cap-space="capSpace"
      :loading="resignLoading"
      @close="financeStore.closeResignModal()"
      @confirm="handleResignConfirm"
    />

    <!-- Sign Free Agent Modal -->
    <SignFreeAgentModal
      :show="showSignModal"
      :player="selectedPlayer"
      :cap-space="capSpace"
      :roster-count="rosterCount"
      :loading="signLoading"
      @close="financeStore.closeSignModal()"
      @confirm="handleSignConfirm"
    />

    <!-- Drop Player Modal -->
    <DropPlayerModal
      :show="showDropModal"
      :player="selectedPlayer"
      :loading="dropLoading"
      @close="financeStore.closeDropModal()"
      @confirm="handleDropConfirm"
    />

    <!-- Player Detail Modal -->
    <PlayerDetailModal
      :show="showPlayerInfoModal"
      :player="detailPlayer"
      @close="closePlayerInfoModal"
    />
  </div>
</template>

<style scoped>
.finances-tab {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
}

/* Overview Card */
.overview-card {
  margin-bottom: 0.5rem;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.5rem;
}

@media (max-width: 768px) {
  .overview-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.overview-item {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.overview-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: white;
}

.overview-icon.cap {
  background: linear-gradient(135deg, #3B82F6, #1D4ED8);
}

.overview-icon.payroll {
  background: linear-gradient(135deg, #8B5CF6, #6D28D9);
}

.overview-icon.space {
  background: linear-gradient(135deg, #10B981, #059669);
}

.overview-icon.over {
  background: linear-gradient(135deg, #EF4444, #DC2626);
}

.overview-icon.roster {
  background: linear-gradient(135deg, #F59E0B, #D97706);
}

.overview-content {
  display: flex;
  flex-direction: column;
}

.overview-label {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.overview-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.overview-value.negative {
  color: var(--color-error);
}

/* Expiring Alert */
.expiring-alert {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  color: var(--color-warning);
  font-size: 0.9rem;
  font-weight: 500;
}

/* Sub-Tab Navigation */
.sub-tab-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.sub-tab-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sub-tab-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.sub-tab-btn.active {
  background: var(--color-primary);
  border-color: rgba(255, 255, 255, 0.2);
  color: white;
  font-weight: 700;
}

/* Contracts Section */
.contracts-section {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* Contract Table */
.contract-table-card {
  overflow: hidden;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.title-hint {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--color-text-tertiary);
}

.contract-table-wrapper {
  overflow-x: auto;
}

.contract-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.contract-table th {
  text-align: left;
  padding: 0.75rem 0.5rem;
  color: var(--color-text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.contract-table td {
  padding: 0.625rem 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.contract-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.contract-row.expiring {
  background: rgba(245, 158, 11, 0.05);
}

.player-col {
  min-width: 150px;
}

.player-name {
  font-weight: 500;
  color: var(--color-text-primary);
}

.pos-col {
  width: 50px;
}

.pos-badge {
  display: inline-block;
  padding: 0.125rem 0.375rem;
  background: rgba(59, 130, 246, 0.2);
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-primary);
}

.salary-col {
  min-width: 80px;
  color: var(--color-success);
  font-weight: 600;
}

.year-col {
  width: 60px;
  text-align: center;
}

.year-cell {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.year-cell.active {
  background: linear-gradient(90deg, var(--color-primary), var(--color-tertiary));
}

.year-cell.expiring {
  background: linear-gradient(90deg, #F59E0B, #EF4444);
}

/* Player Cards Grid */
.player-cards-section {
  margin-top: 0.5rem;
}

.player-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}

/* Free Agents Section */
.free-agents-section {
  min-height: 300px;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

.empty-state h4 {
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  color: var(--color-text-primary);
}

.empty-state p {
  font-size: 0.9rem;
}

/* Light Mode Overrides */
[data-theme="light"] .contract-table th {
  border-bottom-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .contract-table td {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .contract-row:hover {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .contract-row.expiring {
  background: rgba(245, 158, 11, 0.08);
}

[data-theme="light"] .pos-badge {
  background: rgba(59, 130, 246, 0.15);
}

[data-theme="light"] .year-cell {
  background: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .year-cell.active {
  background: linear-gradient(90deg, var(--color-primary), var(--color-tertiary));
}

[data-theme="light"] .year-cell.expiring {
  background: linear-gradient(90deg, #F59E0B, #EF4444);
}
</style>
