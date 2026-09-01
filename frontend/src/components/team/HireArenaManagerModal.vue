<script setup>
// Hire modal for the Arena facility's staff kind (arena_manager). Direct
// clone of HireAnalystModal — same pool-first candidate sourcing, canonical
// requiredLevel resolution, and offline-capable token spend.
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { X, Star, Lock, Check, Coins, Plus } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useTokensStore } from '@/stores/tokens'
import { useCampaignStore } from '@/stores/campaign'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { useSyncStore } from '@/stores/sync'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { COACH_FIRST_NAMES, COACH_LAST_NAMES } from '@/engine/data/coaches'
import { PERSONNEL_POOL_KEY, ARENA_MANAGER_TIERS, generateCandidatePerks } from '@/engine/data/personnelTiers'
import PersonnelAvatar from '@/components/common/PersonnelAvatar.vue'
import { t } from '@wl-i18n/i18n.js'

const props = defineProps({
  show: { type: Boolean, default: false },
  campaignId: { type: [String, Number], required: true },
  arenaFacilityLevel: { type: Number, default: 1 },
})

const emit = defineEmits(['close', 'hired'])

const router = useRouter()

const authStore = useAuthStore()
const campaignStore = useCampaignStore()
const toastStore = useToastStore()
const syncStore = useSyncStore()
const audio = useAudioStore()

const candidates = ref([])
const hiring = ref(false)

const tokens = computed(() => authStore.profile?.tokens ?? 0)

function generateCandidates() {
  const used = new Set()
  const results = []

  function randomName() {
    let name
    do {
      const first = COACH_FIRST_NAMES[Math.floor(Math.random() * COACH_FIRST_NAMES.length)]
      const last = COACH_LAST_NAMES[Math.floor(Math.random() * COACH_LAST_NAMES.length)]
      name = `${first} ${last}`
    } while (used.has(name))
    used.add(name)
    return name
  }

  // 2x 3-star
  for (let i = 0; i < 2; i++) {
    const tier = ARENA_MANAGER_TIERS[3]
    results.push({ name: randomName(), tier: 3, cost: tier.cost, label: tier.label, rating: tier.rating, perks: generateCandidatePerks('arena_manager', 3) })
  }
  // 1x 4-star
  const tier4 = ARENA_MANAGER_TIERS[4]
  results.push({ name: randomName(), tier: 4, cost: tier4.cost, label: tier4.label, rating: tier4.rating, perks: generateCandidatePerks('arena_manager', 4) })

  candidates.value = results
}

watch(() => props.show, async (val) => {
  if (val) {
    hiring.value = false
    // Prefer the persistent pool (seeded at creation for new campaigns, by
    // the fandom/arena backfill for old ones). Fall back to the on-demand
    // generator if neither ran.
    try {
      const campaign = await CampaignRepository.get(props.campaignId)
      const pool = campaign?.settings?.[PERSONNEL_POOL_KEY.arena_manager]
      if (Array.isArray(pool) && pool.length > 0) {
        candidates.value = pool
        return
      }
    } catch { /* fall through to local generator */ }
    generateCandidates()
  }
})

// Resolve the CANONICAL facility requirement for a candidate's perk (keeps
// display + new hires on current gating regardless of pool vintage). The
// optional Game-Night DJ perk isn't in the tier consts — its stored
// requiredLevel is authoritative.
function requiredLevelFor(candidate, perk) {
  const canonical = ARENA_MANAGER_TIERS[candidate.tier]?.perks?.find((p) => p.key === perk.key)
  return canonical?.requiredLevel ?? perk.requiredLevel ?? 1
}

function isPerkActive(candidate, perk) {
  return props.arenaFacilityLevel >= requiredLevelFor(candidate, perk)
}

function goToStore() {
  emit('close')
  router.push('/store')
}

function close() {
  if (!hiring.value) emit('close')
}

async function hireArenaManager(candidate) {
  if (hiring.value || tokens.value < candidate.cost) return
  hiring.value = true
  audio.suppressClickSound()

  try {
    // Deduct tokens (offline-capable: queues the spend when unreachable)
    await useTokensStore().spendTokens(candidate.cost, 'staff_hire')

    const campaign = await CampaignRepository.get(props.campaignId)
    if (!campaign) throw new Error('Campaign not found')

    const currentSeason = campaignStore.currentCampaign?.currentSeasonYear ?? 2025
    campaign.settings = campaign.settings ?? {}
    campaign.settings.arena_manager = {
      id: candidate.id,
      name: candidate.name,
      tier: candidate.tier,
      hiredSeason: currentSeason,
      contractYears: 2,
      perks: candidate.perks.map(p => ({ key: p.key, requiredLevel: requiredLevelFor(candidate, p) })),
      headshot: candidate.headshot ?? null,
      hasCustomHeadshot: candidate.hasCustomHeadshot ?? false,
    }
    const poolKey = PERSONNEL_POOL_KEY.arena_manager
    if (Array.isArray(campaign.settings[poolKey])) {
      campaign.settings[poolKey] = campaign.settings[poolKey].filter(p => p.id !== candidate.id)
    }
    await CampaignRepository.save(campaign)

    if (campaignStore.currentCampaign) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        arena_manager: campaign.settings.arena_manager,
      }
    }

    syncStore.markDirty()
    audio.purchase()
    toastStore.showSuccess(t('Arena manager hired successfully!'))
    emit('hired')
    emit('close')
  } catch (err) {
    console.error('Failed to hire arena manager:', err)
    toastStore.showError(t('Failed to hire arena manager'))
  } finally {
    hiring.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <header class="modal-header">
            <h2 class="modal-title">{{ $t('Hire an Arena Manager') }}</h2>
            <button class="btn-close" @click="close" aria-label="Close">
              <X :size="20" />
            </button>
          </header>

          <main class="modal-content">
            <div class="token-group">
              <div class="token-balance">
                <Coins :size="16" />
                <span class="token-amount">{{ tokens.toLocaleString() }}</span>
                <span class="token-label">{{ $t('Award Tokens') }}</span>
              </div>
              <button type="button" class="buy-tokens-btn" @click="goToStore" :title="$t('Get more tokens in the Store')">
                <Plus :size="14" />
                <span>{{ $t('Get Tokens') }}</span>
              </button>
            </div>

            <div class="candidates-list">
              <div
                v-for="(candidate, i) in candidates"
                :key="i"
                class="candidate-card"
                :class="{ 'tier-4': candidate.tier === 4 }"
              >
                <div class="candidate-header">
                  <div class="candidate-avatar-wrap">
                    <PersonnelAvatar :personnel="candidate" kind="arena_manager" :size="48" />
                  </div>
                  <div class="candidate-info">
                    <h4 class="candidate-name">{{ candidate.name }}</h4>
                    <div class="candidate-tier">
                      <span class="star-display" :class="'tier-' + candidate.tier">
                        <Star v-for="s in candidate.tier" :key="s" :size="12" />
                      </span>
                      <span class="tier-label">{{ $tDynamic(candidate.label) }}</span>
                    </div>
                    <span class="contract-length">{{ $t('2-Season Contract') }}</span>
                  </div>
                  <div class="cost-badge">
                    <Coins :size="12" />
                    {{ candidate.cost.toLocaleString() }}
                  </div>
                </div>

                <div class="perks-list">
                  <div
                    v-for="perk in candidate.perks"
                    :key="perk.key"
                    class="perk-row"
                    :class="{ inactive: !isPerkActive(candidate, perk) }"
                  >
                    <div class="perk-icon">
                      <Check v-if="isPerkActive(candidate, perk)" :size="14" />
                      <Lock v-else :size="14" />
                    </div>
                    <div class="perk-text">
                      <span class="perk-label">{{ $tDynamic(perk.label) }}</span>
                      <span class="perk-desc">{{ $tDynamic(perk.description) }}</span>
                      <span v-if="!isPerkActive(candidate, perk)" class="perk-req">
                        {{ $t('Requires Arena Facility Lv {n}', { n: requiredLevelFor(candidate, perk) }) }}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  class="btn-hire"
                  :disabled="tokens < candidate.cost || hiring"
                  @click="hireArenaManager(candidate)"
                >
                  {{ tokens < candidate.cost ? $t('Insufficient Tokens') : $t('Hire Arena Manager') }}
                </button>
              </div>
            </div>
          </main>

          <footer class="modal-footer">
            <button class="btn-cancel" @click="close">{{ $t('Close') }}</button>
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
  max-width: 520px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 90vh;
  max-height: 90vh;
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
  transition: all 0.2s ease;
}

.candidate-card:hover {
  border-color: rgba(255, 255, 255, 0.15);
}

.candidate-card.tier-4 {
  border-color: rgba(232, 90, 79, 0.3);
  background: linear-gradient(135deg, var(--color-bg-tertiary), rgba(232, 90, 79, 0.05));
}

.candidate-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.candidate-info {
  flex: 1;
  min-width: 0;
}

.candidate-name {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: var(--color-text-primary);
}

.candidate-tier {
  display: flex;
  align-items: center;
  gap: 6px;
}

.star-display {
  display: flex;
  gap: 2px;
}

.star-display.tier-3 { color: #F59E0B; }
.star-display.tier-4 { color: #E85A4F; }
.star-display :deep(svg) { fill: currentColor; }

.tier-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-weight: 500;
}

.contract-length {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  opacity: 0.7;
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

.perks-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.perk-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.perk-row.inactive { opacity: 0.5; }

.perk-icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  margin-top: 1px;
}

.perk-row:not(.inactive) .perk-icon { color: #22c55e; }
.perk-row.inactive .perk-icon { color: var(--color-text-secondary); }

.perk-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.perk-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.perk-row.inactive .perk-label { color: var(--color-text-secondary); }

.perk-desc {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  line-height: 1.3;
}

.perk-req {
  font-size: 0.7rem;
  color: #F59E0B;
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

.modal-enter-active { transition: opacity 0.3s cubic-bezier(0, 0, 0.2, 1); }
.modal-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 1, 1); }
.modal-enter-from, .modal-leave-to { opacity: 0; }

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes scaleOut {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.96); }
}

.modal-enter-active .modal-container { animation: scaleIn 0.3s cubic-bezier(0, 0, 0.2, 1); }
.modal-leave-active .modal-container { animation: scaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards; }

@media (max-width: 480px) {
  .modal-container {
    min-height: 85vh;
    max-height: 85vh;
  }
}
.token-group {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.token-group .token-balance {
  flex: 1;
  margin-bottom: 0;
}

.buy-tokens-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 9px 12px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.buy-tokens-btn:hover {
  background: var(--color-bg-hover, rgba(255, 255, 255, 0.06));
  border-color: var(--color-primary);
}
</style>
