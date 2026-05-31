<script setup>
import { computed, ref, watch } from 'vue'
import { X, Coins, Star, AlertTriangle, ArrowRight } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { StatBadge } from '@/components/ui'
import CoachAvatar from '@/components/common/CoachAvatar.vue'
import { coachBadges as COACH_BADGE_DEFS } from '@/engine/data/coachBadges'

const COACH_BADGE_TIER_COLORS = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  hof: '#9333EA',
}

const props = defineProps({
  show: { type: Boolean, default: false },
  campaignId: { type: [String, Number], required: true },
})

const emit = defineEmits(['close', 'hired'])

const authStore = useAuthStore()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()
const toastStore = useToastStore()
const audio = useAudioStore()

const hiringId = ref(null) // candidate id currently being hired (disables row)
const pendingHire = ref(null) // candidate awaiting "replace current coach" confirmation

const tokens = computed(() => authStore.profile?.tokens ?? 0)
const currentCoach = computed(() => teamStore.coach)

const candidates = computed(() => {
  return campaignStore.currentCampaign?.settings?.availableCoaches ?? []
})

// Reset the confirmation pane whenever the modal closes so reopening it
// always starts on the candidate list.
watch(() => props.show, (open) => {
  if (!open) pendingHire.value = null
})

function tierLabelFor(cost) {
  if (cost === 0) return 'Free Hire'
  if (cost >= 3500) return 'Premier'
  return 'Established'
}

function badgeName(id) {
  return COACH_BADGE_DEFS.find(b => b.id === id)?.name ?? id
}

function badgeDescription(badge) {
  const def = COACH_BADGE_DEFS.find(b => b.id === badge.id)
  if (!def) return badge.id
  return `${def.description} (${badge.level.toUpperCase()})`
}

function close() {
  if (!hiringId.value) emit('close')
}

function backToCandidates() {
  if (!hiringId.value) pendingHire.value = null
}

// Click on a candidate's "Hire" button. If there's a current coach the user
// is replacing them, so route through a confirmation step. Otherwise hire
// immediately.
function selectCandidate(candidate) {
  if (hiringId.value) return
  if ((candidate.hireCost ?? 0) > tokens.value) return
  if (currentCoach.value) {
    pendingHire.value = candidate
  } else {
    performHire(candidate)
  }
}

async function performHire(candidate) {
  hiringId.value = candidate.id
  audio.suppressClickSound() // cha-ching on success instead of the generic tap
  try {
    // teamStore.hireCoach assigns the new coach to team.coach, which atomically
    // replaces the previous one (no separate fire call needed).
    await teamStore.hireCoach(props.campaignId, candidate.id)
    const verb = currentCoach.value ? 'signed' : 'signed as head coach'
    audio.purchase()
    toastStore.showSuccess(`${candidate.name} ${verb}`)
    pendingHire.value = null
    emit('hired')
    emit('close')
  } catch (err) {
    console.error('Failed to hire coach:', err)
    toastStore.showError(err.message || 'Failed to hire coach')
  } finally {
    hiringId.value = null
  }
}

function confirmReplace() {
  if (pendingHire.value) performHire(pendingHire.value)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <header class="modal-header">
            <h2 class="modal-title">{{ pendingHire ? 'Confirm Coach Change' : 'Hire a Head Coach' }}</h2>
            <button class="btn-close" @click="close" aria-label="Close" :disabled="hiringId !== null">
              <X :size="20" />
            </button>
          </header>

          <!-- Replacement confirmation pane -->
          <main v-if="pendingHire" class="modal-content">
            <div class="confirm-warning">
              <AlertTriangle :size="18" />
              <span>You're firing your current coach to sign this new one. This can't be undone.</span>
            </div>

            <div class="confirm-comparison">
              <div class="confirm-side leaving">
                <span class="confirm-side-label">Releasing</span>
                <CoachAvatar :coach="currentCoach" :size="56" />
                <p class="confirm-coach-name">{{ currentCoach?.name }}</p>
                <StatBadge :value="currentCoach?.overall_rating || currentCoach?.overallRating" size="sm" />
              </div>

              <ArrowRight :size="20" class="confirm-arrow" />

              <div class="confirm-side joining">
                <span class="confirm-side-label">Signing</span>
                <CoachAvatar :coach="pendingHire" :size="56" />
                <p class="confirm-coach-name">{{ pendingHire.name }}</p>
                <StatBadge :value="pendingHire.overall_rating || pendingHire.overallRating" size="sm" />
              </div>
            </div>

            <div class="confirm-meta">
              <span>2-Season Contract</span>
              <span class="confirm-cost" :class="{ free: (pendingHire.hireCost ?? 0) === 0 }">
                <template v-if="(pendingHire.hireCost ?? 0) === 0">FREE</template>
                <template v-else>
                  <Coins :size="12" />
                  {{ pendingHire.hireCost.toLocaleString() }} tokens
                </template>
              </span>
            </div>
          </main>

          <!-- Candidates list -->
          <main v-else class="modal-content">
            <div class="token-balance">
              <Coins :size="16" />
              <span class="token-amount">{{ tokens.toLocaleString() }}</span>
              <span class="token-label">Award Tokens</span>
            </div>

            <div v-if="candidates.length === 0" class="empty-state">
              No coaches are available right now. Check back at the start of the next season.
            </div>

            <div v-else class="candidates-list">
              <div
                v-for="candidate in candidates"
                :key="candidate.id"
                class="candidate-card"
                :class="{
                  'tier-premier': (candidate.hireCost ?? 0) >= 3500,
                  'tier-established': (candidate.hireCost ?? 0) > 0 && (candidate.hireCost ?? 0) < 3500,
                  'tier-free': (candidate.hireCost ?? 0) === 0,
                }"
              >
                <div class="candidate-header">
                  <div class="candidate-avatar">
                    <CoachAvatar :coach="candidate" :size="48" />
                  </div>
                  <div class="candidate-info">
                    <h4 class="candidate-name">{{ candidate.name }}</h4>
                    <div class="candidate-meta">
                      <StatBadge :value="candidate.overall_rating || candidate.overallRating" size="sm" />
                      <span class="tier-label">{{ tierLabelFor(candidate.hireCost ?? 0) }}</span>
                    </div>
                    <span class="contract-length">2-Season Contract</span>
                  </div>
                  <div class="cost-badge" :class="{ free: (candidate.hireCost ?? 0) === 0 }">
                    <template v-if="(candidate.hireCost ?? 0) === 0">FREE</template>
                    <template v-else>
                      <Coins :size="12" />
                      {{ candidate.hireCost.toLocaleString() }}
                    </template>
                  </div>
                </div>

                <div v-if="candidate.badges?.length > 0" class="candidate-badges">
                  <div
                    v-for="badge in candidate.badges"
                    :key="badge.id"
                    class="badge-chip"
                    :title="badgeDescription(badge)"
                  >
                    <Star
                      :size="11"
                      :style="{ color: COACH_BADGE_TIER_COLORS[badge.level] || 'var(--color-text-secondary)' }"
                      :fill="COACH_BADGE_TIER_COLORS[badge.level] || 'transparent'"
                    />
                    <span class="badge-chip-name">{{ badgeName(badge.id) }}</span>
                  </div>
                </div>

                <button
                  class="btn-hire"
                  :disabled="hiringId !== null || tokens < (candidate.hireCost ?? 0)"
                  @click="selectCandidate(candidate)"
                >
                  <template v-if="hiringId === candidate.id">Signing...</template>
                  <template v-else-if="tokens < (candidate.hireCost ?? 0)">Insufficient Tokens</template>
                  <template v-else-if="currentCoach">Sign (Replaces Current Coach)</template>
                  <template v-else-if="(candidate.hireCost ?? 0) === 0">Hire (Free)</template>
                  <template v-else>Hire ({{ candidate.hireCost.toLocaleString() }} tokens)</template>
                </button>
              </div>
            </div>
          </main>

          <footer class="modal-footer">
            <template v-if="pendingHire">
              <button class="btn-cancel" @click="backToCandidates" :disabled="hiringId !== null">
                Back
              </button>
              <button
                class="btn-confirm-replace"
                :disabled="hiringId !== null || tokens < (pendingHire.hireCost ?? 0)"
                @click="confirmReplace"
              >
                <template v-if="hiringId">Signing...</template>
                <template v-else>Confirm &amp; Sign</template>
              </button>
            </template>
            <button v-else class="btn-cancel" @click="close" :disabled="hiringId !== null">Close</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.modal-container {
  width: 100%;
  max-width: 560px;
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
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-cancel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.btn-cancel:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

.btn-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.token-balance {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-lg);
  margin-bottom: 16px;
  color: var(--color-text-secondary);
}

.token-amount {
  font-weight: 700;
  color: var(--color-text-primary);
  font-size: 1.1rem;
}

.token-label {
  font-size: 0.8rem;
}

.empty-state {
  padding: 32px 16px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  background: var(--color-bg-tertiary);
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius-lg);
}

.candidates-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.candidate-card {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  padding: 16px;
  transition: border-color 0.2s ease;
}

.candidate-card:hover {
  border-color: rgba(255, 255, 255, 0.15);
}

.candidate-card.tier-premier {
  border-color: rgba(232, 90, 79, 0.35);
  background: linear-gradient(135deg, var(--color-bg-tertiary), rgba(232, 90, 79, 0.05));
}

.candidate-card.tier-established {
  border-color: rgba(34, 211, 238, 0.25);
}

.candidate-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.candidate-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--color-bg-elevated);
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.candidate-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.candidate-name {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
}

.candidate-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tier-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.contract-length {
  font-size: 0.7rem;
  color: var(--color-text-tertiary, var(--color-text-secondary));
  opacity: 0.75;
}

.cost-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 20px;
  background: rgba(245, 158, 11, 0.15);
  color: #F59E0B;
  font-size: 0.8rem;
  font-weight: 700;
  flex-shrink: 0;
}

.cost-badge.free {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  letter-spacing: 0.05em;
}

.candidate-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.badge-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  font-size: 0.7rem;
  color: var(--color-text-primary);
}

.badge-chip-name {
  font-weight: 500;
}

.btn-hire {
  width: 100%;
  padding: 10px 16px;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  border: none;
  color: white;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-hire:hover:not(:disabled) {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.btn-hire:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Replacement confirmation pane */
.confirm-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  margin-bottom: 18px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-lg);
  color: #fca5a5;
  font-size: 0.85rem;
  line-height: 1.4;
}

.confirm-warning :deep(svg) {
  flex-shrink: 0;
  margin-top: 1px;
  color: #ef4444;
}

.confirm-comparison {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  margin-bottom: 14px;
}

.confirm-side {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.confirm-side-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  color: var(--color-text-secondary);
}

.confirm-side.leaving .confirm-side-label {
  color: #ef4444;
}

.confirm-side.joining .confirm-side-label {
  color: #22c55e;
}

.confirm-coach-name {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.confirm-arrow {
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.confirm-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.confirm-cost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 20px;
  background: rgba(245, 158, 11, 0.15);
  color: #F59E0B;
  font-weight: 700;
}

.confirm-cost.free {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.btn-confirm-replace {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--color-primary);
  border: none;
  color: white;
}

.btn-confirm-replace:hover:not(:disabled) {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.btn-confirm-replace:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

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

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes scaleOut {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.96); }
}

.modal-enter-active .modal-container {
  animation: scaleIn 0.3s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active .modal-container {
  animation: scaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

/* Standardized modal heights (90vh desktop, 85vh mobile) */
.modal-container {
  min-height: 90vh;
  max-height: 90vh;
}

@media (max-width: 480px) {
  .modal-container {
    min-height: 85vh;
    max-height: 85vh;
  }
}
</style>
