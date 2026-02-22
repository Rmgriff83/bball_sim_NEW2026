<script setup>
import { ref, computed, onMounted } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useTradeStore } from '@/stores/trade'
import { GlassCard, LoadingSpinner } from '@/components/ui'
import { DollarSign, Users, TrendingUp } from 'lucide-vue-next'
import TradeCenter from '@/components/trade/TradeCenter.vue'
import TradeOffersTab from '@/components/trade/TradeOffersTab.vue'
import TradingBlockTab from '@/components/trade/TradingBlockTab.vue'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const emit = defineEmits(['trade-completed'])

const financeStore = useFinanceStore()
const tradeStore = useTradeStore()

const activeSubTab = ref('center')
const loading = ref(true)

const summary = computed(() => financeStore.financeSummary)
const salaryCap = computed(() => summary.value?.salary_cap || 0)
const totalPayroll = computed(() => summary.value?.total_payroll || financeStore.totalPayroll)
const capSpace = computed(() => salaryCap.value - totalPayroll.value)
const rosterCount = computed(() => summary.value?.roster_count || 0)
const pendingCount = computed(() => tradeStore.pendingProposals.length)

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

const tradePrefill = ref(null)

function handleTradeCompleted() {
  emit('trade-completed')
}

function handleStartTrade({ player, teamId }) {
  tradePrefill.value = { player, teamId }
  activeSubTab.value = 'center'
}

onMounted(async () => {
  try {
    await Promise.all([
      financeStore.fetchFinanceSummary(props.campaignId),
      tradeStore.fetchPendingProposals(props.campaignId),
      tradeStore.loadUserTradingBlock(props.campaignId),
    ])
  } catch (err) {
    console.warn('TradesTab mount error:', err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="trades-tab">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="lg" />
      <p class="text-secondary mt-4">Loading trades...</p>
    </div>

    <template v-else>
      <!-- Financial Overview Card -->
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
      </GlassCard>

      <!-- Sub-Tab Navigation -->
      <div class="sub-tab-nav">
        <button
          class="sub-tab-btn"
          :class="{ active: activeSubTab === 'center' }"
          @click="activeSubTab = 'center'"
        >
          TRADE CENTER
        </button>
        <button
          class="sub-tab-btn"
          :class="{ active: activeSubTab === 'offers' }"
          @click="activeSubTab = 'offers'"
        >
          OFFERS
          <span v-if="pendingCount > 0" class="badge">{{ pendingCount }}</span>
        </button>
        <button
          class="sub-tab-btn"
          :class="{ active: activeSubTab === 'block' }"
          @click="activeSubTab = 'block'"
        >
          BLOCK
        </button>
      </div>

      <!-- Sub-Tab Content -->
      <TradeCenter
        v-if="activeSubTab === 'center'"
        :campaign-id="campaignId"
        :prefill="tradePrefill"
        @trade-completed="handleTradeCompleted"
        @prefill-consumed="tradePrefill = null"
      />
      <TradeOffersTab
        v-else-if="activeSubTab === 'offers'"
        :campaign-id="campaignId"
        @trade-completed="handleTradeCompleted"
      />
      <TradingBlockTab
        v-else-if="activeSubTab === 'block'"
        :campaign-id="campaignId"
        @start-trade="handleStartTrade"
      />
    </template>
  </div>
</template>

<style scoped>
.trades-tab {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
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

/* Sub-Tab Navigation */
.sub-tab-nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.sub-tab-btn {
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
  display: flex;
  align-items: center;
  gap: 6px;
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

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #E85A4F;
  color: white;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
}

.sub-tab-btn.active .badge {
  background: rgba(0, 0, 0, 0.3);
  color: white;
}
</style>
