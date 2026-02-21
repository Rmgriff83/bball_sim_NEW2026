<script setup>
import { ref, computed, onMounted } from 'vue'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { useSyncStore } from '@/stores/sync'
import api from '@/composables/useApi'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const campaignStore = useCampaignStore()
const teamStore = useTeamStore()
const authStore = useAuthStore()
const toastStore = useToastStore()
const syncStore = useSyncStore()

const activeSubTab = ref('scouting')
const upgrading = ref(false)
const confirmingUpgrade = ref(false)

const UPGRADE_COST = 1000

const facilityTypes = {
  scouting: {
    name: 'Scouting',
    description: 'Reveals hidden attributes on draft prospects. Higher levels earn more scouting points per week.',
    perks: [
      'Level 1: 1 scouting point per week',
      'Level 2: 2 scouting points per week',
      'Level 3: 3 scouting points per week',
      'Level 4: 4 scouting points per week',
      'Level 5: 5 scouting points per week',
    ]
  },
  training: {
    name: 'Training',
    description: 'Improves player development and attribute growth during the season.',
    perks: [
      'Level 1: Basic training facilities',
      'Level 2: Improved shooting machines',
      'Level 3: Advanced analytics integration',
      'Level 4: Elite training staff',
      'Level 5: World-class development center',
    ]
  },
  medical: {
    name: 'Medical',
    description: 'Reduces injury risk and speeds up player recovery times.',
    perks: [
      'Level 1: Standard medical staff',
      'Level 2: Enhanced injury prevention',
      'Level 3: Advanced rehabilitation center',
      'Level 4: Sports science integration',
      'Level 5: Cutting-edge medical facility',
    ]
  },
  analytics: {
    name: 'Analytics',
    description: 'Provides deeper insights into team performance and opponent tendencies.',
    perks: [
      'Level 1: Basic stat tracking',
      'Level 2: Advanced box score analysis',
      'Level 3: Player tracking data',
      'Level 4: Predictive modeling',
      'Level 5: League-leading analytics department',
    ]
  },
}

const facilities = computed(() => {
  return teamStore.team?.facilities || { training: 1, medical: 1, scouting: 1, analytics: 1 }
})

const awardTokens = computed(() => {
  return authStore.profile?.tokens ?? 0
})

const scoutingPoints = computed(() => {
  return campaignStore.currentCampaign?.settings?.scoutingPoints ?? 0
})

const currentFacility = computed(() => {
  return facilityTypes[activeSubTab.value]
})

const currentLevel = computed(() => {
  return facilities.value[activeSubTab.value] ?? 1
})

const canUpgrade = computed(() => {
  return currentLevel.value < 5 && awardTokens.value >= UPGRADE_COST && !upgrading.value
})

const isMaxLevel = computed(() => {
  return currentLevel.value >= 5
})

function promptUpgrade() {
  if (!canUpgrade.value) return
  confirmingUpgrade.value = true
}

function cancelUpgrade() {
  confirmingUpgrade.value = false
}

async function upgradeFacility() {
  if (!canUpgrade.value) return
  confirmingUpgrade.value = false
  upgrading.value = true

  try {
    // Deduct tokens via backend API
    const response = await api.post('/api/user/tokens', { amount: -UPGRADE_COST })
    if (authStore.profile) {
      authStore.profile.tokens = response.data.tokens
    }

    // Upgrade team facility
    const facilityKey = activeSubTab.value
    const campaign = await CampaignRepository.get(props.campaignId)
    if (!campaign) throw new Error('Campaign not found')

    const userTeamId = campaign.teamId
    const team = await TeamRepository.get(props.campaignId, userTeamId)
    if (!team) throw new Error('Team not found')

    team.facilities = team.facilities ?? {}
    team.facilities[facilityKey] = Math.min(5, (team.facilities[facilityKey] ?? 1) + 1)
    await TeamRepository.save(team)

    // Update local stores
    if (teamStore.team) {
      teamStore.team.facilities = { ...team.facilities }
    }

    syncStore.markDirty()
    toastStore.showSuccess(`${currentFacility.value.name} upgraded to Level ${team.facilities[facilityKey]}!`)
  } catch (err) {
    console.error('Failed to upgrade facility:', err)
    const msg = err.response?.data?.message || 'Failed to upgrade facility'
    toastStore.showError(msg)
  } finally {
    upgrading.value = false
  }
}
</script>

<template>
  <div class="facilities-tab">
    <!-- Token Balance -->
    <div class="token-balance-bar">
      <div class="token-info">
        <span class="token-label">Award Tokens</span>
        <span class="token-value">{{ awardTokens.toLocaleString() }}</span>
      </div>
      <div class="token-info">
        <span class="token-label">Scout Points</span>
        <span class="token-value scout">{{ scoutingPoints }}</span>
      </div>
    </div>

    <!-- Sub-Tab Navigation -->
    <div class="facility-tabs">
      <button
        v-for="(facility, key) in facilityTypes"
        :key="key"
        class="facility-tab-btn"
        :class="{ active: activeSubTab === key }"
        @click="activeSubTab = key; confirmingUpgrade = false"
      >
        {{ facility.name }}
      </button>
    </div>

    <!-- Facility Detail -->
    <div class="facility-detail">
      <div class="facility-header">
        <h3 class="facility-name">{{ currentFacility.name }}</h3>
        <div class="facility-level">
          <span class="level-label">Level</span>
          <div class="level-stars">
            <span
              v-for="i in 5"
              :key="i"
              class="star"
              :class="{ filled: i <= currentLevel }"
            >&#9733;</span>
          </div>
        </div>
      </div>

      <p class="facility-description">{{ currentFacility.description }}</p>

      <!-- Level Perks -->
      <div class="perks-list">
        <div
          v-for="(perk, i) in currentFacility.perks"
          :key="i"
          class="perk-item"
          :class="{ active: i < currentLevel, current: i === currentLevel - 1 }"
        >
          <span class="perk-indicator" :class="{ unlocked: i < currentLevel }">
            {{ i < currentLevel ? '&#10003;' : '&#8226;' }}
          </span>
          <span class="perk-text">{{ perk }}</span>
        </div>
      </div>

      <!-- Upgrade Button -->
      <div class="upgrade-section">
        <template v-if="isMaxLevel">
          <div class="max-level-badge">MAX LEVEL</div>
        </template>
        <template v-else-if="confirmingUpgrade">
          <div class="confirm-prompt">
            <p class="confirm-text">Spend <strong>{{ UPGRADE_COST.toLocaleString() }}</strong> tokens to upgrade {{ currentFacility.name }} to Level {{ currentLevel + 1 }}?</p>
            <div class="confirm-actions">
              <button class="confirm-cancel-btn" @click="cancelUpgrade">Cancel</button>
              <button class="confirm-yes-btn" :disabled="upgrading" @click="upgradeFacility">
                {{ upgrading ? 'Upgrading...' : 'Confirm' }}
              </button>
            </div>
          </div>
        </template>
        <template v-else>
          <button
            class="upgrade-btn"
            :class="{ disabled: !canUpgrade }"
            :disabled="!canUpgrade"
            @click="promptUpgrade"
          >
            Upgrade to Level {{ currentLevel + 1 }}
            <span class="upgrade-cost">{{ UPGRADE_COST.toLocaleString() }} tokens</span>
          </button>
          <p v-if="awardTokens < UPGRADE_COST" class="insufficient-hint">
            Need {{ (UPGRADE_COST - awardTokens).toLocaleString() }} more tokens
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.facilities-tab {
  padding: 0;
}

.token-balance-bar {
  display: flex;
  gap: 24px;
  padding: 16px 20px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  margin-bottom: 20px;
}

.token-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.token-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
}

.token-value {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.6rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
}

.token-value.scout {
  background: var(--gradient-cosmic);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Sub-tab navigation - standard pill style */
.facility-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.facility-tab-btn {
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

.facility-tab-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.facility-tab-btn.active {
  background: var(--gradient-cosmic);
  color: black;
  border-color: transparent;
  box-shadow: 0 0 12px rgba(232, 90, 79, 0.3);
}

/* Facility Detail */
.facility-detail {
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  padding: 24px;
}

.facility-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.facility-name {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.4rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--color-text-primary);
}

.facility-level {
  display: flex;
  align-items: center;
  gap: 8px;
}

.level-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
}

.level-stars {
  display: flex;
  gap: 2px;
}

.star {
  font-size: 1.2rem;
  color: rgba(255, 255, 255, 0.15);
  transition: color 0.2s ease;
}

.star.filled {
  color: #FFC72C;
  text-shadow: 0 0 6px rgba(255, 199, 44, 0.4);
}

.facility-description {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-bottom: 20px;
}

/* Perks List */
.perks-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 24px;
}

.perk-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  transition: background 0.15s ease;
}

.perk-item.active {
  background: rgba(255, 255, 255, 0.03);
}

.perk-item.current {
  background: rgba(232, 90, 79, 0.08);
  border: 1px solid rgba(232, 90, 79, 0.2);
}

.perk-indicator {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.perk-indicator.unlocked {
  color: #4CAF50;
  font-weight: 700;
}

.perk-text {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}

.perk-item.active .perk-text {
  color: var(--color-text-primary);
}

/* Upgrade Section */
.upgrade-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.upgrade-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  max-width: 320px;
  padding: 14px 24px;
  background: var(--gradient-cosmic);
  border: none;
  border-radius: var(--radius-lg);
  color: black;
  font-weight: 700;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.upgrade-btn:hover:not(.disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(232, 90, 79, 0.4);
}

.upgrade-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.upgrade-cost {
  font-size: 0.72rem;
  font-weight: 500;
  opacity: 0.7;
}

.max-level-badge {
  padding: 12px 32px;
  background: rgba(76, 175, 80, 0.15);
  border: 1px solid rgba(76, 175, 80, 0.3);
  border-radius: var(--radius-lg);
  color: #4CAF50;
  font-weight: 700;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.insufficient-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

/* Confirm Prompt */
.confirm-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 320px;
  padding: 16px 20px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.confirm-text {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  text-align: center;
  line-height: 1.4;
}

.confirm-text strong {
  color: var(--color-text-primary);
}

.confirm-actions {
  display: flex;
  gap: 8px;
  width: 100%;
}

.confirm-cancel-btn,
.confirm-yes-btn {
  flex: 1;
  padding: 10px 16px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
}

.confirm-cancel-btn {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
}

.confirm-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}

.confirm-yes-btn {
  background: var(--gradient-cosmic);
  border: none;
  color: black;
}

.confirm-yes-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(232, 90, 79, 0.4);
}

.confirm-yes-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Responsive */
@media (max-width: 768px) {
  .token-balance-bar {
    flex-wrap: wrap;
  }

  .facility-detail {
    padding: 16px;
  }
}
</style>
