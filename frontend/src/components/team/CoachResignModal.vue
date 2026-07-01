<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Coins } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { BaseModal, BaseButton } from '@/components/ui'
import CoachAvatar from '@/components/common/CoachAvatar.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  // { coach, resignCost } stashed on campaign.settings.pendingCoachDecision
  decision: { type: Object, default: null },
  campaignId: { type: [String, Number], default: null },
  // disables the action buttons while the parent runs the re-sign request
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'resigned', 'hire-new'])

const router = useRouter()
const authStore = useAuthStore()

const coach = computed(() => props.decision?.coach ?? null)
const coachName = computed(() => coach.value?.name ?? 'Your head coach')
const coachOverall = computed(() => coach.value?.overall_rating ?? coach.value?.overallRating ?? null)
const resignCost = computed(() => props.decision?.resignCost ?? 0)
const balance = computed(() => authStore.profile?.tokens ?? 0)
const canAfford = computed(() => balance.value >= resignCost.value)
const costLabel = computed(() => (resignCost.value > 0 ? `${resignCost.value}` : 'Free'))

function goToStore() {
  emit('close')
  router.push('/store')
}
</script>

<template>
  <BaseModal :show="show" title="Your Head Coach's Contract Is Up" @close="emit('close')">
    <div class="coach-resign">
      <div class="cr-summary">
        <CoachAvatar v-if="coach" :coach="coach" :size="56" :campaign-id="campaignId" />
        <div>
          <p class="cr-name">{{ coachName }}</p>
          <p v-if="coachOverall != null" class="cr-meta">Overall {{ coachOverall }}</p>
        </div>
      </div>

      <p class="cr-text">
        {{ coachName }}'s deal has expired. Re-sign them to a fresh
        <strong>2-season</strong> contract, or bring in a new coach.
      </p>

      <div class="cr-cost-row">
        <span>Re-sign cost</span>
        <span class="cr-cost-value" :class="{ insufficient: !canAfford && resignCost > 0 }">
          <template v-if="resignCost > 0">{{ costLabel }} <Coins :size="14" /></template>
          <template v-else>Free</template>
        </span>
      </div>
      <div class="cr-balance-row">
        <span>Your balance</span>
        <span>{{ balance }} <Coins :size="14" /></span>
      </div>

      <p v-if="!canAfford && resignCost > 0" class="cr-warning">
        You don't have enough tokens to re-sign this coach.
      </p>

      <div class="cr-actions">
        <BaseButton variant="ghost" :disabled="busy" @click="emit('hire-new')">
          Sign a New Coach
        </BaseButton>
        <BaseButton
          v-if="canAfford || resignCost === 0"
          variant="primary"
          :loading="busy"
          @click="emit('resigned')"
        >
          Re-sign · {{ costLabel }}<template v-if="resignCost > 0"> tokens</template>
        </BaseButton>
        <BaseButton
          v-else
          variant="primary"
          :disabled="busy"
          @click="goToStore"
        >
          Buy Tokens
        </BaseButton>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.coach-resign {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.cr-summary {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.cr-name {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.cr-meta {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.cr-text {
  font-size: 0.9rem;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.cr-cost-row,
.cr-balance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.9rem;
}

.cr-cost-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.cr-cost-value.insufficient {
  color: var(--color-error, #ef4444);
}

.cr-balance-row {
  color: var(--color-text-secondary);
}

.cr-warning {
  font-size: 0.82rem;
  color: var(--color-error, #ef4444);
}

.cr-actions {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
  flex-wrap: wrap;
}
</style>
