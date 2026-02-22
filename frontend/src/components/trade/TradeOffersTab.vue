<script setup>
import { ref, computed } from 'vue'
import { useTradeStore } from '@/stores/trade'
import { useBreakingNewsStore } from '@/stores/breakingNews'
import { BreakingNewsService } from '@/engine/season/BreakingNewsService'
import { GlassCard } from '@/components/ui'
import { Inbox, ArrowLeftRight } from 'lucide-vue-next'
import TradeProposalModal from '@/components/trade/TradeProposalModal.vue'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const emit = defineEmits(['trade-completed'])

const tradeStore = useTradeStore()
const breakingNewsStore = useBreakingNewsStore()

const proposals = computed(() => tradeStore.pendingProposals)
const selectedProposal = ref(null)
const showProposalModal = ref(false)

function openProposal(proposal) {
  selectedProposal.value = proposal
  showProposalModal.value = true
}

function closeProposal() {
  showProposalModal.value = false
  selectedProposal.value = null
}

async function handleAccept(proposal) {
  try {
    const result = await tradeStore.acceptProposal(props.campaignId, proposal.id)
    showProposalModal.value = false
    selectedProposal.value = null

    if (result?.tradeContext) {
      const newsItem = BreakingNewsService.tradeCompleted(result.tradeContext)
      if (newsItem) {
        breakingNewsStore.enqueue(newsItem)
      }
    }

    emit('trade-completed')
  } catch (err) {
    console.error('Failed to accept proposal:', err)
  }
}

async function handleReject(proposal) {
  try {
    await tradeStore.rejectProposal(props.campaignId, proposal.id)
    showProposalModal.value = false
    selectedProposal.value = null
  } catch (err) {
    console.error('Failed to reject proposal:', err)
  }
}

function getTeamColor(proposal) {
  return proposal?.proposing_team?.primary_color || '#E85A4F'
}

function summarizeAssets(assets) {
  if (!assets || assets.length === 0) return 'No assets'
  const parts = []
  for (const a of assets) {
    if (a.type === 'player' && a.player) {
      const name = `${a.player.firstName || a.player.first_name || ''} ${a.player.lastName || a.player.last_name || ''}`.trim()
      parts.push(name || 'Player')
    } else if (a.type === 'pick') {
      parts.push(a.pick?.display_name || 'Draft Pick')
    }
  }
  return parts.join(', ') || 'Assets'
}

function formatExpiration(expiresAt) {
  if (!expiresAt) return ''
  const diff = new Date(expiresAt) - new Date()
  const hours = Math.max(0, Math.floor(diff / (1000 * 60 * 60)))
  if (hours < 24) return `${hours}h left`
  const days = Math.floor(hours / 24)
  return `${days}d left`
}
</script>

<template>
  <div class="trade-offers-tab">
    <!-- Empty State -->
    <GlassCard v-if="proposals.length === 0" padding="xl" :hoverable="false">
      <div class="empty-state">
        <Inbox :size="48" class="empty-icon" />
        <h3>No Trade Offers</h3>
        <p>AI teams will send you proposals as the season progresses. Check back after simulating games.</p>
      </div>
    </GlassCard>

    <!-- Proposal List -->
    <div v-else class="proposals-list">
      <GlassCard
        v-for="proposal in proposals"
        :key="proposal.id"
        padding="md"
        :hoverable="true"
        class="proposal-card"
        @click="openProposal(proposal)"
      >
        <div class="proposal-row">
          <div class="team-badge" :style="{ backgroundColor: getTeamColor(proposal) }">
            {{ proposal.proposing_team?.abbreviation || '???' }}
          </div>
          <div class="proposal-info">
            <div class="proposal-team-name">
              {{ proposal.proposing_team?.city }} {{ proposal.proposing_team?.name }}
            </div>
            <div class="proposal-summary">
              <span class="asset-label">Offering:</span>
              <span class="asset-text">{{ summarizeAssets(proposal.ai_gives) }}</span>
            </div>
            <div class="proposal-summary">
              <span class="asset-label">Wants:</span>
              <span class="asset-text">{{ summarizeAssets(proposal.ai_receives) }}</span>
            </div>
          </div>
          <div class="proposal-meta">
            <span class="expiration">{{ formatExpiration(proposal.expires_at) }}</span>
            <ArrowLeftRight :size="16" class="arrow-icon" />
          </div>
        </div>
      </GlassCard>
    </div>

    <!-- Proposal Modal -->
    <TradeProposalModal
      :show="showProposalModal"
      :proposal="selectedProposal"
      @close="closeProposal"
      @accept="handleAccept"
      @reject="handleReject"
    />
  </div>
</template>

<style scoped>
.trade-offers-tab {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 2rem 1rem;
  gap: 0.75rem;
}

.empty-icon {
  color: var(--color-text-secondary);
  opacity: 0.5;
}

.empty-state h3 {
  font-family: var(--font-display);
  font-size: 1.25rem;
  color: var(--color-text-primary);
  margin: 0;
}

.empty-state p {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  max-width: 400px;
  margin: 0;
}

.proposals-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.proposal-card {
  cursor: pointer;
  transition: transform 0.15s ease;
}

.proposal-card:hover {
  transform: translateY(-1px);
}

.proposal-row {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.team-badge {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 0.75rem;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.proposal-info {
  flex: 1;
  min-width: 0;
}

.proposal-team-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text-primary);
  margin-bottom: 4px;
}

.proposal-summary {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 0.8rem;
  line-height: 1.4;
}

.asset-label {
  color: var(--color-text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.3px;
}

.asset-text {
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.proposal-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.expiration {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  font-weight: 600;
  text-transform: uppercase;
}

.arrow-icon {
  color: var(--color-text-secondary);
  opacity: 0.5;
}
</style>
