<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useTeamStore } from '@/stores/team'
import { useCampaignStore } from '@/stores/campaign'
import { useToastStore } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { useWalkthroughStore } from '@/stores/walkthrough'
import { GlassCard, LoadingSpinner } from '@/components/ui'
import { DollarSign, Users, TrendingUp, Calendar, FileText, ArrowDown, ArrowUp, FastForward } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import ContractCard from './ContractCard.vue'
import ResignModal from './ResignModal.vue'
import SignFreeAgentModal from './SignFreeAgentModal.vue'
import DropPlayerModal from './DropPlayerModal.vue'
import PlayerDetailModal from './PlayerDetailModal.vue'
import EndOfFreeAgencyModal from './EndOfFreeAgencyModal.vue'
import UserFreeAgencyOffers from './UserFreeAgencyOffers.vue'
import { isPastResignDeadline, isInFreeAgencyPeriod, FREE_AGENCY_DURATION_DAYS } from '@/engine/season/SeasonDeadlines'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const financeStore = useFinanceStore()
const teamStore = useTeamStore()
const campaignStore = useCampaignStore()
const toastStore = useToastStore()
const authStore = useAuthStore()
const walkthroughStore = useWalkthroughStore()
const route = useRoute()

const loading = ref(true)
const VALID_SUB_TABS = ['team', 'expiring', 'free-agents', 'picks']
const requestedSubTab = route.query?.sub
const activeSubTab = ref(VALID_SUB_TABS.includes(requestedSubTab) ? requestedSubTab : 'team')

const inFreeAgencyPeriod = computed(() => isInFreeAgencyPeriod(campaignStore.currentCampaign))

// In the offseason (incl. draft / free agency), the "Expiring" sub-tab is
// hidden: the players it lists expire NEXT season, so surfacing it during
// free agency is confusing. Covers 'offseason', 'offseason_draft', and
// 'offseason_free_agency'.
const isOffseason = computed(() =>
  (campaignStore.currentCampaign?.phase ?? '').startsWith('offseason')
)
const signModalMode = computed(() => inFreeAgencyPeriod.value ? 'offer' : 'instant')

// Drives the inline Sim Day / Sim Rest buttons that appear under the sub-tab
// nav. Phase-based (not date-based) so it lines up with the offseason hub's
// own gate on those same controls.
const isFreeAgencyActive = computed(() => campaignStore.currentCampaign?.phase === 'offseason_free_agency')
const freeAgencyDay = computed(() => campaignStore.currentCampaign?.settings?.freeAgencyDay ?? 0)
const simmingFAday = ref(false)
const showEndOfFreeAgencyModal = ref(false)
const endOfFreeAgencyResults = ref(null)

// Free-agents filters (sub-tab on roster page). Position narrows the pool;
// OVR sort orders the results.
const FA_POSITION_OPTIONS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C']
const faPositionFilter = ref('ALL')
const faOvrSortDir = ref('desc') // 'desc' | 'asc'

function getOverall(p) {
  return p?.overallRating ?? p?.overall_rating ?? 0
}

function toggleFaOvrSort() {
  faOvrSortDir.value = faOvrSortDir.value === 'desc' ? 'asc' : 'desc'
}
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

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

const positionCounts = computed(() => {
  const counts = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 }
  for (const p of roster.value) {
    const pos = p?.position
    if (pos && counts[pos] !== undefined) counts[pos]++
  }
  return counts
})

function getPositionColor(pos) {
  const colors = { PG: '#3B82F6', SG: '#10B981', SF: '#F59E0B', PF: '#EF4444', C: '#8B5CF6' }
  return colors[pos] || '#6B7280'
}

// Sorted roster for display
const sortedRoster = computed(() => {
  return [...roster.value].sort((a, b) => b.contractSalary - a.contractSalary)
})

const filteredFreeAgents = computed(() => {
  let list = freeAgents.value
  if (faPositionFilter.value !== 'ALL') {
    list = list.filter(p => {
      const primary = p.position
      const secondary = p.secondaryPosition ?? p.secondary_position
      return primary === faPositionFilter.value || secondary === faPositionFilter.value
    })
  }
  const sorted = [...list].sort((a, b) => {
    const diff = getOverall(b) - getOverall(a)
    return faOvrSortDir.value === 'desc' ? diff : -diff
  })
  return sorted
})

// Expiring contracts
const expiringContracts = computed(() => {
  return roster.value.filter(p => p.contractYearsRemaining === 1)
})

// Owned draft picks — same shape and source as the trade wizard reads from
// (team.draftPicks). Sorted soonest year first, then round ascending.
const userDraftPicks = computed(() => {
  const picks = teamStore.team?.draftPicks ?? []
  return [...picks].sort((a, b) => {
    const ay = a.year ?? 0
    const by = b.year ?? 0
    if (ay !== by) return ay - by
    return (a.round ?? 0) - (b.round ?? 0)
  })
})

function formatPickYear(year) {
  if (year == null) return ''
  return year < 100 ? 2024 + year : year
}

// Re-sign deadline gate. Flipped by _processMidSeasonEvents on Dec 15 alongside
// trade_deadline_passed. When true, ContractCard hides the Re-sign button and
// FinancesTab shows a "Re-signing closed" banner above the expiring list.
const resignDeadlinePassed = computed(() => isPastResignDeadline(campaignStore.currentCampaign))

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
  // Merge with teamStore player data so season_stats and development_history are available
  const teamPlayer = teamStore.roster?.find(p => p.id === player.id)
  if (teamPlayer) {
    // Explicit `season_stats` override: teamStore's `_attachSeasonStats`
    // re-derives this object from SeasonRepository on every force-refresh
    // (after every game), so it's the live source. financeStore's
    // `rosterWithContracts` is hydrated from `PlayerRepository.getByTeam`,
    // and legacy IDB records carry a stale `season_stats` snapshot that was
    // persisted by older teamStore saves — which the regular spread would
    // otherwise let win, freezing the modal's GP at whatever the last
    // mutation (e.g. the trade/resign-deadline cluster) saw.
    detailPlayer.value = {
      ...teamPlayer,
      ...player,
      season_stats: teamPlayer.season_stats ?? null,
    }
  } else {
    detailPlayer.value = player
  }
  showPlayerInfoModal.value = true
}

function closePlayerInfoModal() {
  showPlayerInfoModal.value = false
  detailPlayer.value = null
}

function handleResignFromDetail(player) {
  closePlayerInfoModal()
  financeStore.openResignModal(player)
}

function handleDropFromDetail(player) {
  closePlayerInfoModal()
  financeStore.openDropModal(player)
}

function handleSignFromDetail(player) {
  closePlayerInfoModal()
  financeStore.openSignModal(player)
}

async function handleHoldCoachMeeting({ playerId, purchasedAction }) {
  try {
    const res = await teamStore.holdCoachMeeting(
      props.campaignId, playerId, { purchasedAction }
    )
    const summary = purchasedAction
      ? `Bought a coach meeting · morale +30 (now ${res.morale})`
      : `Coach meeting held · morale +30 (now ${res.morale}) · ${res.actionsRemaining} actions left`
    toastStore.showSuccess(summary)
    // Refresh the modal's player object so morale + action counter update.
    const updated = teamStore.roster?.find(p => p.id === playerId)
    if (updated) detailPlayer.value = { ...detailPlayer.value, ...updated }
  } catch (err) {
    toastStore.showError(err.response?.data?.message || err.message || 'Failed to hold meeting')
  }
}

async function handleResignConfirm(data) {
  resignLoading.value = true
  try {
    await financeStore.resignPlayer(props.campaignId, data.playerId, data.years, data.salary)
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
    if (data.mode === 'offer') {
      await financeStore.makeFreeAgentOffer(props.campaignId, data.playerId, {
        years: data.years,
        salary: data.salary,
      })
      toastStore.showSuccess('Offer submitted')
      return
    }
    await financeStore.signFreeAgent(props.campaignId, data.playerId)
    // Refresh data
    await Promise.all([
      financeStore.fetchRosterContracts(props.campaignId, { force: true }),
      financeStore.fetchFreeAgents(props.campaignId, { force: true })
    ])
    toastStore.showSuccess('Player signed')
  } catch (err) {
    console.error('Failed to sign free agent:', err)
    toastStore.showError(err.message || 'Failed to sign player')
  } finally {
    signLoading.value = false
  }
}

async function handleSignWithdraw(data) {
  signLoading.value = true
  try {
    await financeStore.withdrawFreeAgentOffer(props.campaignId, data.playerId)
    financeStore.closeSignModal()
    toastStore.showSuccess('Offer withdrawn')
  } catch (err) {
    console.error('Failed to withdraw offer:', err)
    toastStore.showError(err.message || 'Failed to withdraw offer')
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

async function handleSimFreeAgencyDay() {
  if (simmingFAday.value) return
  simmingFAday.value = true
  const loadingToastId = toastStore.showLoading('Simulating free-agency day...')
  try {
    const result = await financeStore.simFreeAgencyDay(props.campaignId)
    await Promise.all([
      campaignStore.fetchCampaign(props.campaignId, true),
      financeStore.fetchRosterContracts(props.campaignId, { force: true }),
      financeStore.fetchFreeAgents(props.campaignId, { force: true }),
    ])
    toastStore.removeMinimalToast(loadingToastId)
    if (result.resolved) {
      const fas = await financeStore.consumeFreeAgencyResults(props.campaignId)
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
  if (simmingFAday.value) return
  simmingFAday.value = true
  const loadingToastId = toastStore.showLoading('Simulating remainder of free agency...')
  try {
    await financeStore.simRestOfFreeAgency(props.campaignId)
    await Promise.all([
      campaignStore.fetchCampaign(props.campaignId, true),
      financeStore.fetchRosterContracts(props.campaignId, { force: true }),
      financeStore.fetchFreeAgents(props.campaignId, { force: true }),
    ])
    toastStore.removeMinimalToast(loadingToastId)
    const fas = await financeStore.consumeFreeAgencyResults(props.campaignId)
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
async function handleConfirmChoices(selectedIds) {
  if (finalizingChoices.value) return
  const pending = endOfFreeAgencyResults.value?.pendingChoice
  if (!pending) return
  finalizingChoices.value = true
  try {
    const { accepted: newAccepted, declined: newDeclined } =
      await financeStore.finalizeFreeAgencyUserChoices(
        props.campaignId,
        pending.offers,
        selectedIds
      )
    // Merge the freshly-decided rows into the existing wrap-up so the user
    // sees their final outcome in the same modal, then clear pendingChoice.
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

// Watch for sub-tab changes to load free agents
watch(activeSubTab, async (newTab) => {
  if (newTab === 'free-agents' && freeAgents.value.length === 0) {
    await loadFreeAgents()
  }
  // First-visit walkthrough for the Expiring sub-tab — only when the user
  // actually has an expiring contract to point at.
  if (newTab === 'expiring' && expiringContracts.value.length > 0) {
    walkthroughStore.maybeStart('gmFinancesExpiring')
  }
})

// If we slip into the offseason while the Expiring view is open (or arrive via
// a ?sub=expiring deep link), fall back to Contracts so we're not stranded on a
// view whose tab is now hidden.
watch(isOffseason, (offseason) => {
  if (offseason && activeSubTab.value === 'expiring') {
    activeSubTab.value = 'team'
  }
}, { immediate: true })

onMounted(() => {
  loadData()
  // Deep-link case: activeSubTab can start as 'free-agents' (from ?sub=...),
  // so the watch above never fires. Kick the FA load here too.
  if (activeSubTab.value === 'free-agents') {
    loadFreeAgents()
  }
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
      <GlassCard padding="lg" :hoverable="false" class="overview-card" data-tour="gm-finances-overview">
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

        <!-- Roster Position Breakdown -->
        <div class="position-counts">
          <div
            v-for="pos in POSITIONS"
            :key="pos"
            class="position-count-item"
          >
            <span
              class="position-count-pill"
              :style="{ backgroundColor: getPositionColor(pos) }"
            >{{ pos }}</span>
            <span class="position-count-value">{{ positionCounts[pos] }}</span>
          </div>
        </div>

        <!-- Expiring Contracts Alert -->
        <div v-if="expiringContracts.length > 0" class="expiring-alert">
          <Calendar :size="18" />
          <span>{{ expiringContracts.length }} expiring contract{{ expiringContracts.length !== 1 ? 's' : '' }} this season</span>
        </div>
      </GlassCard>

      <!-- Sub-Tab Navigation -->
      <div class="sub-tab-nav" data-tour="gm-finances-subtabs">
        <button
          class="sub-tab-btn"
          :class="{ active: activeSubTab === 'team' }"
          @click="activeSubTab = 'team'"
        >
          Contracts
        </button>
        <button
          v-if="!isOffseason"
          class="sub-tab-btn"
          :class="{ active: activeSubTab === 'expiring' }"
          @click="activeSubTab = 'expiring'"
        >
          Expiring
          <span v-if="expiringContracts.length > 0" class="sub-tab-badge">{{ expiringContracts.length }}</span>
        </button>
        <button
          class="sub-tab-btn"
          :class="{ active: activeSubTab === 'free-agents' }"
          @click="activeSubTab = 'free-agents'"
        >
          Free Agents
        </button>
        <button
          class="sub-tab-btn"
          :class="{ active: activeSubTab === 'picks' }"
          @click="activeSubTab = 'picks'"
        >
          Picks
          <span v-if="userDraftPicks.length > 0" class="sub-tab-badge">{{ userDraftPicks.length }}</span>
        </button>
      </div>

      <!-- Free Agency control strip — only while the FA window is open. -->
      <div v-if="isFreeAgencyActive" class="fa-control-strip">
        <div class="fa-control-meta">
          <span class="fa-control-label">FREE AGENCY</span>
          <span class="fa-control-day">Day {{ freeAgencyDay }} / {{ FREE_AGENCY_DURATION_DAYS }}</span>
          <div class="fa-control-progress">
            <div
              class="fa-control-progress-bar"
              :style="{ width: (freeAgencyDay / FREE_AGENCY_DURATION_DAYS * 100) + '%' }"
            ></div>
          </div>
        </div>
        <div class="fa-control-buttons">
          <button
            type="button"
            class="fa-control-btn fa-control-btn-secondary"
            :disabled="simmingFAday"
            @click="handleSimFreeAgencyDay"
          >
            <FastForward :size="14" />
            <span>{{ simmingFAday ? 'Simulating…' : 'Sim FA Day' }}</span>
          </button>
          <button
            type="button"
            class="fa-control-btn fa-control-btn-primary"
            :disabled="simmingFAday"
            @click="handleSimRestOfFreeAgency"
          >
            <FastForward :size="14" />
            <span>Sim Rest of FA</span>
          </button>
        </div>
      </div>

      <UserFreeAgencyOffers
        v-if="isFreeAgencyActive"
        :campaign-id="campaignId"
        variant="card"
      />

      <!-- Team Contracts View -->
      <div v-if="activeSubTab === 'team'" class="contracts-section">
        <!-- Player Cards Grid -->
        <div class="player-cards-section">
          <h4 class="section-title">Team Roster</h4>
          <div class="player-cards-grid">
            <ContractCard
              v-for="(player, idx) in sortedRoster"
              :key="player.id"
              :player="player"
              :show-stats="true"
              :resign-disabled="resignDeadlinePassed"
              :data-tour="idx === 0 ? 'gm-roster-card' : null"
              @resign="handleResign"
              @drop="handleDrop"
              @info="handleInfo"
            />
          </div>
        </div>
      </div>

      <!-- Expiring Contracts View -->
      <div v-else-if="activeSubTab === 'expiring'" class="expiring-section">
        <!-- Re-sign deadline banner — shown after the in-season deadline passes (Dec 15) -->
        <div v-if="resignDeadlinePassed" class="resign-closed-banner">
          <Calendar :size="16" />
          <span>Re-signing is closed for this season — the deadline has passed. Expiring players will hit free agency at season end.</span>
        </div>

        <div v-if="expiringContracts.length === 0" class="empty-state">
          <Calendar :size="48" />
          <h4>No Expiring Contracts</h4>
          <p>None of your players have contracts ending this season.</p>
        </div>

        <div v-else class="player-cards-section">
          <h4 class="section-title">
            <Calendar :size="16" />
            Expiring Contracts
          </h4>
          <div class="player-cards-grid">
            <ContractCard
              v-for="(player, idx) in expiringContracts"
              :key="player.id"
              :player="player"
              :show-stats="true"
              :resign-disabled="resignDeadlinePassed"
              :data-tour="idx === 0 ? 'gm-expiring-card' : null"
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
          <div class="fa-filters">
            <div class="fa-filter-group">
              <span class="fa-filter-label">Position</span>
              <div class="fa-filter-chips">
                <button
                  v-for="pos in FA_POSITION_OPTIONS"
                  :key="pos"
                  class="fa-chip"
                  :class="{ active: faPositionFilter === pos }"
                  type="button"
                  @click="faPositionFilter = pos"
                >
                  {{ pos }}
                </button>
              </div>
            </div>
            <div class="fa-filter-group">
              <span class="fa-filter-label">Overall</span>
              <button
                class="fa-chip fa-sort-chip active"
                type="button"
                :title="faOvrSortDir === 'desc' ? 'Highest first — click to reverse' : 'Lowest first — click to reverse'"
                @click="toggleFaOvrSort"
              >
                <component :is="faOvrSortDir === 'desc' ? ArrowDown : ArrowUp" :size="13" />
                <span>OVR {{ faOvrSortDir === 'desc' ? 'High → Low' : 'Low → High' }}</span>
              </button>
            </div>
          </div>

          <h4 class="section-title">
            Available Free Agents
            <span v-if="filteredFreeAgents.length !== freeAgents.length" class="fa-filter-count">
              {{ filteredFreeAgents.length }} of {{ freeAgents.length }}
            </span>
          </h4>

          <div v-if="filteredFreeAgents.length === 0" class="empty-state empty-state-inline">
            <p>No free agents match these filters.</p>
          </div>
          <div v-else class="player-cards-grid">
            <ContractCard
              v-for="player in filteredFreeAgents"
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

      <!-- Owned Draft Picks View -->
      <div v-else-if="activeSubTab === 'picks'" class="picks-section">
        <div v-if="userDraftPicks.length === 0" class="empty-state">
          <FileText :size="48" />
          <h4>No Draft Picks</h4>
          <p>Your team doesn't currently own any future draft picks.</p>
        </div>

        <div v-else class="player-cards-section">
          <h4 class="section-title">
            <FileText :size="16" />
            Owned Draft Picks
            <span class="fa-filter-count">{{ userDraftPicks.length }}</span>
          </h4>

          <div class="picks-grid">
            <div
              v-for="pick in userDraftPicks"
              :key="pick.id"
              class="pick-asset-card"
            >
              <div class="pick-asset-content">
                <div class="pick-asset-year">{{ formatPickYear(pick.year) }}</div>
                <div class="pick-asset-info">
                  <span class="pick-asset-name">Round {{ pick.round }}</span>
                  <span v-if="pick.original_team_abbreviation" class="pick-asset-team">({{ pick.original_team_abbreviation }})</span>
                  <div v-if="pick.projected_position" class="pick-asset-projection">
                    Projected #{{ pick.projected_position }}
                  </div>
                </div>
              </div>
            </div>
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
      :mode="signModalMode"
      @close="financeStore.closeSignModal()"
      @confirm="handleSignConfirm"
      @withdraw="handleSignWithdraw"
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
      :show-growth="true"
      :is-user-player="true"
      :campaign-id="campaignId"
      :current-season-year="campaignStore.currentCampaign?.currentSeasonYear"
      :show-contract-actions="true"
      :is-expiring-contract="detailPlayer?.contractYearsRemaining === 1"
      :coach="teamStore.coach"
      :user-tokens="authStore.profile?.tokens ?? 0"
      @close="closePlayerInfoModal"
      @resign-player="handleResignFromDetail"
      @drop-player="handleDropFromDetail"
      @sign-player="handleSignFromDetail"
      @hold-coach-meeting="handleHoldCoachMeeting"
    />

    <EndOfFreeAgencyModal
      :show="showEndOfFreeAgencyModal"
      :results="endOfFreeAgencyResults"
      :finalizing="finalizingChoices"
      @close="closeEndOfFreeAgencyModal"
      @confirm-choices="handleConfirmChoices"
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
  color: var(--color-text-primary);
}

.overview-icon.over {
  color: var(--color-error);
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

/* Roster Position Breakdown */
.position-counts {
  display: flex;
  justify-content: space-around;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.6rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
}

.position-count-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex: 1;
  justify-content: center;
}

.position-count-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 22px;
  padding: 0 6px;
  border-radius: 11px;
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.position-count-value {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

[data-theme="light"] .position-counts {
  background: rgba(0, 0, 0, 0.03);
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

.resign-closed-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 8px;
  color: #ef4444;
  font-size: 0.85rem;
  font-weight: 500;
  line-height: 1.4;
}

/* Sub-Tab Navigation */
.sub-tab-nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.sub-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.sub-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(245, 158, 11, 0.85);
  color: black;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1;
}

.sub-tab-btn.active .sub-tab-badge {
  background: black;
  color: #fff;
}

.sub-tab-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.sub-tab-btn.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
  box-shadow: 0 2px 8px rgba(232, 90, 79, 0.3);
}

/* Free Agency control strip — sits between sub-tab nav and sub-tab content
   whenever the FA window is open. Mirrors the offseason hub controls. */
.fa-control-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: rgba(232, 90, 79, 0.08);
  border: 1px solid rgba(232, 90, 79, 0.25);
  border-radius: var(--radius-lg);
  flex-wrap: wrap;
}

.fa-control-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 220px;
  flex-wrap: wrap;
}

.fa-control-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-primary);
}

.fa-control-day {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.fa-control-progress {
  flex: 1;
  min-width: 120px;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.fa-control-progress-bar {
  height: 100%;
  background: var(--gradient-cosmic);
  transition: width 0.3s ease;
}

.fa-control-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.fa-control-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-md);
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.fa-control-btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}

.fa-control-btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.fa-control-btn-primary {
  background: var(--color-primary);
  color: white;
  border-color: transparent;
}

.fa-control-btn-primary:hover:not(:disabled) {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.fa-control-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Free-agents filters */
.fa-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
  align-items: center;
  margin-bottom: 0.85rem;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-lg);
}

.fa-filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fa-filter-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.fa-filter-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.fa-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary);
  font-weight: 600;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
}

.fa-chip:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--color-text-primary);
}

.fa-chip.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
  box-shadow: 0 2px 8px rgba(232, 90, 79, 0.25);
}

.fa-sort-chip {
  padding-left: 9px;
}

.fa-filter-count {
  margin-left: 8px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  letter-spacing: normal;
  text-transform: none;
}

.empty-state-inline {
  padding: 24px 12px;
}

/* Contracts Section */
.contracts-section {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* Expiring Contracts */
.expiring-card {
  border: 1px solid rgba(245, 158, 11, 0.15);
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

.expiring-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.expiring-row {
  display: flex;
  align-items: center;
  padding: 0.625rem 0.75rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.expiring-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.expiring-player-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.expiring-player-details {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.expiring-player-name {
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.expiring-player-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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

.expiring-salary {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-warning);
}

/* Player Cards Grid */
.player-cards-section {
  margin-top: 0.5rem;
}

.player-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 1rem;
}

@media (max-width: 415px) {
  .player-cards-grid {
    grid-template-columns: 1fr;
  }
}

/* Free Agents Section */
.free-agents-section {
  min-height: 300px;
}

/* Owned Draft Picks Section — mirrors the trade wizard's pick card style */
.picks-section {
  min-height: 300px;
}

.picks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
  padding: 0.25rem;
}

@media (max-width: 415px) {
  .picks-grid {
    grid-template-columns: 1fr;
  }
}

.pick-asset-card {
  background: rgba(30, 35, 45, 0.95);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.pick-asset-card:hover {
  border-color: #8B5CF6;
  transform: translateY(-2px);
}

.pick-asset-content {
  display: flex;
  align-items: flex-start;
  padding: 0.875rem;
  gap: 0.75rem;
}

.pick-asset-year {
  width: 48px;
  height: 42px;
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.pick-asset-info {
  flex: 1;
  min-width: 0;
}

.pick-asset-name {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: #F3F4F6;
  margin-bottom: 0.25rem;
}

.pick-asset-team {
  display: block;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 0.15rem;
}

.pick-asset-projection {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.4);
}

[data-theme="light"] .pick-asset-card {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .pick-asset-name {
  color: var(--color-text-primary);
}

[data-theme="light"] .pick-asset-team {
  color: var(--color-text-secondary);
}

[data-theme="light"] .pick-asset-projection {
  color: var(--color-text-secondary);
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
[data-theme="light"] .expiring-row:hover {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .pos-badge {
  background: rgba(59, 130, 246, 0.15);
}

[data-theme="light"] .sub-tab-btn {
  background: rgba(0, 0, 0, 0.05);
  border-color: rgba(0, 0, 0, 0.12);
  color: var(--color-text-secondary);
}

[data-theme="light"] .sub-tab-btn:hover {
  background: rgba(0, 0, 0, 0.1);
  color: var(--color-text-primary);
}

[data-theme="light"] .sub-tab-btn.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
  box-shadow: 0 2px 8px rgba(232, 90, 79, 0.2);
}
</style>
