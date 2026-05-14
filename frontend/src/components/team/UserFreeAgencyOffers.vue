<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Briefcase, X as XIcon, Heart, AlertTriangle, Users } from 'lucide-vue-next'
import { useFinanceStore } from '@/stores/finance'
import { useToastStore } from '@/stores/toast'
import { useFreeAgentInterest } from '@/composables/useFreeAgentInterest'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'

const props = defineProps({
  campaignId: { type: [String, Number], required: true },
  // 'card' = larger row layout for the roster page; 'compact' = tighter rows
  // for the offseason hub on the home view.
  variant: {
    type: String,
    default: 'card',
    validator: (v) => ['card', 'compact'].includes(v),
  },
})

const financeStore = useFinanceStore()
const toastStore = useToastStore()
const { score: scoreInterest, interestLevelForScore } = useFreeAgentInterest()

// Sourcing from financeStore.freeAgents (not campaign.settings) so the list
// reacts to makeFreeAgentOffer / withdrawFreeAgentOffer mutating the local
// cache — those don't touch campaignStore.currentCampaign.settings directly.
// Each row also carries its computed interest level so the meter re-paints
// the moment the user updates an offer (the offer values come from the same
// reactive cache and the scorer also depends on teamStore.* via the
// composable, so roster / coach changes mid-window flow through too).
const userOffers = computed(() =>
  (financeStore.freeAgents || [])
    .filter(p => p?.userOffer)
    .map(p => {
      const salary = p.userOffer.salary
      const years = p.userOffer.years
      const score = scoreInterest(p, { salary, years })
      // `pendingOfferCount` from the FA cache is total offers on the player
      // (user + AI). Subtract our own to get the count of competing teams.
      const totalOffers = p.pendingOfferCount ?? 1
      const competingOffers = Math.max(0, totalOffers - 1)
      return {
        player: p,
        playerId: p.id,
        salary,
        years,
        interestScore: score,
        interestLevel: score != null ? interestLevelForScore(score) : null,
        totalOffers,
        competingOffers,
      }
    })
)

const totalCommitted = computed(() =>
  userOffers.value.reduce((s, o) => s + (o.salary || 0), 0)
)

onMounted(async () => {
  // The home view never loads the FA cache on its own; do it lazily here so
  // the pending offers section can populate the first time the user lands.
  if ((financeStore.freeAgents?.length ?? 0) === 0) {
    try {
      await financeStore.fetchFreeAgents(props.campaignId)
    } catch (err) {
      console.warn('[UserFreeAgencyOffers] failed to load free agents:', err)
    }
  }
})

// Withdraw flow: clicking X stages a confirmation modal; the actual withdraw
// only fires once the user confirms. Single in-flight ref so the confirm
// button can show a loading state.
const withdrawing = ref({})
const pendingWithdraw = ref(null) // the offer row being confirmed, or null
const showConfirmModal = computed(() => !!pendingWithdraw.value)

function requestWithdraw(offer) {
  if (!offer) return
  if (withdrawing.value[offer.playerId]) return
  pendingWithdraw.value = offer
}

function cancelWithdraw() {
  if (pendingWithdraw.value && withdrawing.value[pendingWithdraw.value.playerId]) return
  pendingWithdraw.value = null
}

async function confirmWithdraw() {
  const offer = pendingWithdraw.value
  if (!offer) return
  if (withdrawing.value[offer.playerId]) return
  withdrawing.value[offer.playerId] = true
  try {
    await financeStore.withdrawFreeAgentOffer(props.campaignId, offer.playerId)
    toastStore.showSuccess('Offer withdrawn')
    pendingWithdraw.value = null
  } catch (err) {
    console.error('Failed to withdraw FA offer:', err)
    toastStore.showError(err.message || 'Failed to withdraw offer')
  } finally {
    delete withdrawing.value[offer.playerId]
  }
}

function handleKeydown(e) {
  if (e.key === 'Escape' && pendingWithdraw.value) cancelWithdraw()
}

watch(showConfirmModal, (open) => {
  if (open) {
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

function formatSalary(salary) {
  if (!salary) return '$0'
  if (salary >= 1_000_000) return `$${(salary / 1_000_000).toFixed(1)}M`
  return `$${(salary / 1000).toFixed(0)}K`
}

function playerName(p) {
  if (!p) return 'Unknown player'
  if (p.name) return p.name
  return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Unknown player'
}
</script>

<template>
  <section
    v-if="userOffers.length > 0"
    class="fa-offers-section"
    :class="`fa-offers-section--${variant}`"
  >
    <header class="fa-offers-header">
      <Briefcase :size="14" class="fa-offers-icon" />
      <span class="fa-offers-title">Your Pending Offers</span>
      <span class="fa-offers-count">{{ userOffers.length }}</span>
      <span class="fa-offers-spacer"></span>
      <span class="fa-offers-total">{{ formatSalary(totalCommitted) }}/yr committed</span>
    </header>
    <ul class="fa-offers-list">
      <li v-for="offer in userOffers" :key="offer.playerId" class="fa-offer-row">
        <PlayerAvatar
          v-if="offer.player"
          :player="offer.player"
          :size="variant === 'compact' ? 28 : 36"
          class="fa-offer-avatar"
        />
        <div class="fa-offer-info">
          <div class="fa-offer-top">
            <span class="fa-offer-name">{{ playerName(offer.player) }}</span>
            <span v-if="offer.player?.position" class="fa-offer-pos">{{ offer.player.position }}</span>
            <span v-if="offer.player?.overallRating != null" class="fa-offer-ovr">
              {{ offer.player.overallRating }}
            </span>
            <span
              class="fa-offer-competing"
              :class="{ contested: offer.competingOffers > 0 }"
              :title="offer.competingOffers === 0
                ? 'No other teams have offers in on this player'
                : `${offer.competingOffers} other team${offer.competingOffers === 1 ? '' : 's'} ${offer.competingOffers === 1 ? 'has' : 'have'} also bid`"
            >
              <Users :size="10" />
              {{ offer.totalOffers }} {{ offer.totalOffers === 1 ? 'OFFER' : 'OFFERS' }}
            </span>
          </div>
          <div class="fa-offer-terms">
            <span class="fa-offer-salary">{{ formatSalary(offer.salary) }}/yr</span>
            <span class="fa-offer-divider">·</span>
            <span class="fa-offer-years">{{ offer.years }} {{ offer.years === 1 ? 'yr' : 'yrs' }}</span>
            <span class="fa-offer-divider">·</span>
            <span class="fa-offer-total">{{ formatSalary((offer.salary || 0) * (offer.years || 0)) }} total</span>
          </div>
          <div
            v-if="offer.interestLevel"
            class="fa-offer-interest"
            :style="{ '--interest-color': offer.interestLevel.color }"
            :title="`${offer.interestLevel.label} (${offer.interestScore}/100) — ${offer.interestLevel.hint}`"
          >
            <Heart :size="10" class="fa-interest-icon" />
            <span class="fa-interest-label">{{ offer.interestLevel.label }}</span>
            <div class="fa-interest-bar">
              <div class="fa-interest-bar-fill" :style="{ width: offer.interestScore + '%' }"></div>
              <div class="fa-interest-bar-threshold"></div>
            </div>
            <span class="fa-interest-score">{{ offer.interestScore }}</span>
          </div>
        </div>
        <button
          type="button"
          class="fa-offer-withdraw"
          :disabled="!!withdrawing[offer.playerId]"
          title="Withdraw offer"
          @click="requestWithdraw(offer)"
        >
          <XIcon :size="14" />
        </button>
      </li>
    </ul>
  </section>

  <!-- Withdraw confirmation — mirrors SimulateConfirmModal's global pattern -->
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="pendingWithdraw"
        class="modal-overlay"
        @click.self="cancelWithdraw"
      >
        <div class="modal-container">
          <header class="modal-header">
            <h2 class="modal-title">Withdraw Offer</h2>
            <button
              v-if="!withdrawing[pendingWithdraw.playerId]"
              class="btn-close"
              aria-label="Close"
              @click="cancelWithdraw"
            >
              <XIcon :size="20" />
            </button>
          </header>

          <main class="modal-content">
            <div class="withdraw-icon-wrap">
              <AlertTriangle :size="32" class="withdraw-icon" />
            </div>

            <div class="withdraw-player">
              <PlayerAvatar
                v-if="pendingWithdraw.player"
                :player="pendingWithdraw.player"
                :size="48"
              />
              <div class="withdraw-player-info">
                <div class="withdraw-player-name">{{ playerName(pendingWithdraw.player) }}</div>
                <div class="withdraw-player-meta">
                  <span v-if="pendingWithdraw.player?.position">{{ pendingWithdraw.player.position }}</span>
                  <span
                    v-if="pendingWithdraw.player?.overallRating != null"
                    class="withdraw-ovr"
                  >{{ pendingWithdraw.player.overallRating }} OVR</span>
                </div>
              </div>
            </div>

            <div class="withdraw-terms">
              <div class="withdraw-terms-row">
                <span class="withdraw-terms-label">Annual</span>
                <span class="withdraw-terms-value">{{ formatSalary(pendingWithdraw.salary) }}</span>
              </div>
              <div class="withdraw-terms-row">
                <span class="withdraw-terms-label">Years</span>
                <span class="withdraw-terms-value">{{ pendingWithdraw.years }}</span>
              </div>
              <div class="withdraw-terms-row withdraw-terms-total">
                <span class="withdraw-terms-label">Total Value</span>
                <span class="withdraw-terms-value">
                  {{ formatSalary((pendingWithdraw.salary || 0) * (pendingWithdraw.years || 0)) }}
                </span>
              </div>
            </div>

            <p class="withdraw-blurb">
              Are you sure you want to pull your offer? The player can still accept a competing bid from another team, and you can always submit a new offer later in the window.
            </p>
          </main>

          <footer class="modal-footer">
            <button
              class="btn-cancel"
              :disabled="!!withdrawing[pendingWithdraw.playerId]"
              @click="cancelWithdraw"
            >
              Cancel
            </button>
            <button
              class="btn-confirm-danger"
              :disabled="!!withdrawing[pendingWithdraw.playerId]"
              @click="confirmWithdraw"
            >
              <span v-if="withdrawing[pendingWithdraw.playerId]" class="btn-loading"></span>
              <XIcon v-else :size="16" />
              {{ withdrawing[pendingWithdraw.playerId] ? 'Withdrawing…' : 'Withdraw Offer' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fa-offers-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(232, 90, 79, 0.06);
  border: 1px solid rgba(232, 90, 79, 0.2);
  border-radius: var(--radius-lg);
}

.fa-offers-section--compact {
  padding: 10px 12px;
  gap: 8px;
}

.fa-offers-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
}

.fa-offers-icon {
  color: var(--color-primary);
}

.fa-offers-title {
  font-weight: 700;
  color: var(--color-text-primary);
}

.fa-offers-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--color-primary);
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1;
}

.fa-offers-spacer {
  flex: 1;
}

.fa-offers-total {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.7rem;
  letter-spacing: 0;
  color: var(--color-text-primary);
  font-weight: 600;
  text-transform: none;
}

.fa-offers-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fa-offer-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.fa-offers-section--compact .fa-offer-row {
  padding: 6px 8px;
  gap: 8px;
}

.fa-offer-avatar {
  flex-shrink: 0;
}

.fa-offer-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fa-offer-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fa-offer-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.fa-offer-pos {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.07);
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.fa-offer-ovr {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 6px;
  border-radius: 4px;
}

/* Total-offer count badge — neutral when only the user has bid, amber when
   the user is competing with at least one AI team for the same player. */
.fa-offer-competing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.fa-offer-competing.contested {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.12);
  border-color: rgba(251, 191, 36, 0.35);
}

.fa-offer-terms {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  flex-wrap: wrap;
}

.fa-offer-salary {
  font-weight: 600;
  color: var(--color-success);
}

.fa-offer-divider {
  opacity: 0.4;
}

.fa-offer-withdraw {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.fa-offer-withdraw:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.4);
  color: #ef4444;
}

.fa-offer-withdraw:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Per-row interest meter — same scoring fn as the offer modal, just laid
   out inline. --interest-color is set per-row based on the bucket. */
.fa-offer-interest {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 0.7rem;
}

.fa-interest-icon {
  color: var(--interest-color);
  flex-shrink: 0;
}

.fa-interest-label {
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--interest-color);
  flex-shrink: 0;
  font-size: 0.65rem;
}

.fa-interest-bar {
  position: relative;
  flex: 1;
  min-width: 60px;
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.fa-interest-bar-fill {
  height: 100%;
  background: var(--interest-color);
  transition: width 0.2s ease;
}

/* 30-score "will actually sign" line — same threshold pickBestOffer enforces. */
.fa-interest-bar-threshold {
  position: absolute;
  top: -1px;
  bottom: -1px;
  left: 30%;
  width: 1px;
  background: rgba(255, 255, 255, 0.45);
}

.fa-interest-score {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.65rem;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  min-width: 22px;
  text-align: right;
}

/* ---------------------------------------------------------------------------
   Withdraw confirmation modal — global popup design (mirrors SimulateConfirmModal)
   --------------------------------------------------------------------------- */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.modal-container {
  width: 100%;
  max-width: 440px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
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

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.withdraw-icon-wrap {
  align-self: center;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.withdraw-icon {
  color: #ef4444;
}

.withdraw-player {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.withdraw-player-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.withdraw-player-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.withdraw-player-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.withdraw-ovr {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--color-text-primary);
}

.withdraw-terms {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.withdraw-terms-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.8rem;
}

.withdraw-terms-label {
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.7rem;
  font-weight: 600;
}

.withdraw-terms-value {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--color-text-primary);
  font-weight: 600;
}

.withdraw-terms-total {
  padding-top: 6px;
  border-top: 1px solid var(--glass-border);
}

.withdraw-terms-total .withdraw-terms-value {
  color: var(--color-text-primary);
  font-size: 0.95rem;
}

.withdraw-blurb {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
  text-align: center;
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-cancel,
.btn-confirm-danger {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.btn-cancel:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

.btn-confirm-danger {
  background: #ef4444;
  border: none;
  color: white;
}

.btn-confirm-danger:hover:not(:disabled) {
  background: #dc2626;
  transform: translateY(-1px);
}

.btn-cancel:disabled,
.btn-confirm-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-loading {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: fa-withdraw-spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes fa-withdraw-spin {
  to { transform: rotate(360deg); }
}

/* Modal transition — match SimulateConfirmModal */
.modal-enter-active {
  transition: opacity 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-container {
  animation: fa-withdraw-scale-in 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active .modal-container {
  animation: fa-withdraw-scale-out 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes fa-withdraw-scale-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes fa-withdraw-scale-out {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}
</style>
