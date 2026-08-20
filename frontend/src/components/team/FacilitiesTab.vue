<script setup>
import { ref, computed, onMounted, markRaw } from 'vue'
import { useTeamStore } from '@/stores/team'
import { useAuthStore } from '@/stores/auth'
import { useCampaignStore } from '@/stores/campaign'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { useSyncStore } from '@/stores/sync'
import api from '@/composables/useApi'
import FacilityUpgradeConfirmModal from '@/components/team/FacilityUpgradeConfirmModal.vue'
import HireScoutModal from '@/components/team/HireScoutModal.vue'
import HireTrainerModal from '@/components/team/HireTrainerModal.vue'
import HireStaffTrainerModal from '@/components/team/HireStaffTrainerModal.vue'
import HireAnalystModal from '@/components/team/HireAnalystModal.vue'
import PersonnelAvatar from '@/components/common/PersonnelAvatar.vue'
import { AlertTriangle, Check, Lock, Binoculars, Heart, Activity, BarChart3 } from 'lucide-vue-next'
import { PERSONNEL_SETTINGS_KEY } from '@/engine/data/personnelTiers'
import { t, tDynamic } from '@wl-i18n/i18n.js'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  }
})

const teamStore = useTeamStore()
const authStore = useAuthStore()
const campaignStore = useCampaignStore()
const toastStore = useToastStore()
const syncStore = useSyncStore()
const audio = useAudioStore()

const activeSubTab = ref('scouting')
const upgrading = ref(false)
const confirmingUpgrade = ref(false)
const showHireModal = ref(false)
const firing = ref(false)

const UPGRADE_COST = 500

// Per-level text states the REAL unlocks: staff perks activate only once the
// matching facility reaches the perk's required level (see personnelTiers.js —
// scout Lv2/Lv3, physician Lv3/Lv4, staff trainer Lv3/Lv4, analyst Lv2/Lv3).
const facilityTypes = {
  scouting: {
    name: 'Scouting',
    description: 'Reveals hidden attributes on draft prospects. Higher levels earn more scouting points every two weeks and activate your hired scout\'s perks.',
    perks: [
      'Level 1: 1 scouting point every two weeks',
      'Level 2: 2 scouting points every two weeks — activates your scout\'s Extra Reveals perk',
      'Level 3: 3 scouting points every two weeks — activates Badge Intel + Personality Intel (4-star scout)',
      'Level 4: 4 scouting points every two weeks',
      'Level 5: 5 scouting points every two weeks',
    ]
  },
  training: {
    name: 'Training',
    description: 'Speeds up coach training sessions and powers player development. Every level shortens the session timer, and higher levels activate your trainer\'s perks.',
    perks: [
      'Level 1: Coach training sessions take 60 minutes',
      'Level 2: Training sessions take 50 minutes',
      'Level 3: Training sessions take 40 minutes — activates your trainer\'s Development perk (5–10% faster growth)',
      'Level 4: Training sessions take 30 minutes — activates the Conditioning Program perk (4-star trainer)',
      'Level 5: Training sessions take just 20 minutes',
    ]
  },
  medical: {
    name: 'Medical',
    description: 'Speeds up injury recovery at lower levels and prevents injuries at higher ones. Also activates your physician\'s perks.',
    perks: [
      'Level 1: Standard medical staff',
      'Level 2: Injured players recover 3% faster',
      'Level 3: Players recover 6% faster — activates your physician\'s Fast Recovery perk (stacks)',
      'Level 4: 5% lower injury risk — activates the Injury Prevention perk (4-star physician, stacks)',
      'Level 5: 10% lower injury risk',
    ]
  },
  analytics: {
    name: 'Analytics',
    description: 'Sharpens the Coach tab\'s scheme intel and powers your analyst department — hire and manage your analyst below.',
    perks: [
      'Level 1: Rough scheme fit ratings on the Coach tab',
      'Level 2: Exact scheme Fit % — unlocks Postgame Analytics (with an analyst hired)',
      'Level 3: Season play analytics on the Coach tab — unlocks the pregame Opponent Scouting Report (with a 4-star analyst)',
      'Level 4: Per-play season efficiency in the playbook viewer',
      'Level 5: Season Proven — highlights your best-performing scheme from live season data',
    ]
  },
}

// The staff member who runs each facility, moved here from the old Personnel
// tab. String values are the same literals that used to live in $t() calls in
// TeamManagementView — same keys, already translated. Rendered via $tDynamic
// and enumerated for extraction in wl-i18n.config.js (STAFF_CONFIG block).
// NOTE: strings with apostrophes use double quotes, never escaped quotes —
// the config's block regex doesn't handle escapes.
const STAFF_CONFIG = {
  scouting: {
    kind: 'scout',
    settingsKey: PERSONNEL_SETTINGS_KEY.scout,
    modal: markRaw(HireScoutModal),
    modalLevelProp: 'scoutingFacilityLevel',
    emptyIcon: markRaw(Binoculars),
    starLabel: '{n}-Star Scout',
    emptyTitle: 'No Scout Hired',
    hireLabel: 'Hire Scout',
    releaseLabel: 'Release Scout',
    releasedToast: 'Scout released',
    releaseFailedToast: 'Failed to release scout',
    perkReq: 'Requires Scouting Facility Lv {n}',
    perkLabels: {
      extra_reveals: { label: 'Extra Reveals', description: 'Reveals 33% of attributes per scout action (3 actions to fully scout)' },
      badge_reveal: { label: 'Badge Intel', description: '35% chance per scout action to reveal badges' },
      morale_reveal: { label: 'Personality Intel', description: '35% chance per scout action to reveal morale/personality' },
    },
  },
  medical: {
    kind: 'physician',
    settingsKey: PERSONNEL_SETTINGS_KEY.physician, // legacy 'trainer' key
    modal: markRaw(HireTrainerModal),
    modalLevelProp: 'medicalFacilityLevel',
    emptyIcon: markRaw(Heart),
    starLabel: '{n}-Star Physician',
    emptyTitle: 'No Team Physician',
    hireLabel: 'Hire Physician',
    releaseLabel: 'Release Physician',
    releasedToast: 'Physician released',
    releaseFailedToast: 'Failed to release physician',
    perkReq: 'Requires Medical Facility Lv {n}',
    perkLabels: {
      fast_recovery: { label: 'Fast Recovery', description: 'Players recover from injuries faster' },
      injury_prevention: { label: 'Injury Prevention', description: 'Players have less risk of getting injured' },
    },
  },
  training: {
    kind: 'staff_trainer',
    settingsKey: PERSONNEL_SETTINGS_KEY.staff_trainer,
    modal: markRaw(HireStaffTrainerModal),
    modalLevelProp: 'trainingFacilityLevel',
    emptyIcon: markRaw(Activity),
    starLabel: '{n}-Star Trainer',
    emptyTitle: 'No Trainer',
    hireLabel: 'Hire Trainer',
    releaseLabel: 'Release Trainer',
    releasedToast: 'Trainer released',
    releaseFailedToast: 'Failed to release trainer',
    perkReq: 'Requires Training Facility Lv {n}',
    perkLabels: {
      growth_boost: { label: 'Enhanced Development', description: 'Players develop faster from game performance' },
      fatigue_reduction: { label: 'Conditioning Program', description: 'Players generate less fatigue during games' },
    },
  },
  analytics: {
    kind: 'analyst',
    settingsKey: PERSONNEL_SETTINGS_KEY.analyst,
    modal: markRaw(HireAnalystModal),
    modalLevelProp: 'analyticsFacilityLevel',
    emptyIcon: markRaw(BarChart3),
    starLabel: '{n}-Star Analyst',
    emptyTitle: 'No Analyst Hired',
    hireLabel: 'Hire Analyst',
    releaseLabel: 'Release Analyst',
    releasedToast: 'Analyst released',
    releaseFailedToast: 'Failed to release analyst',
    perkReq: 'Requires Analytics Facility Lv {n}',
    perkLabels: {
      postgame_analytics: { label: 'Postgame Analytics', description: "See your team's efficiency by play set after games." },
      opponent_analytics: { label: 'Opponent Scouting Report', description: "Scout the opponent's play-set tendencies before games." },
    },
  },
}

const facilities = computed(() => {
  return teamStore.team?.facilities || { training: 1, medical: 1, scouting: 1, analytics: 1 }
})

const awardTokens = computed(() => {
  return authStore.profile?.tokens ?? 0
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

// --- Staff (moved from the old Personnel tab) --------------------------------

const staffCfg = computed(() => STAFF_CONFIG[activeSubTab.value])

function hiredStaffFor(key) {
  return campaignStore.currentCampaign?.settings?.[STAFF_CONFIG[key].settingsKey] ?? null
}

const hiredStaff = computed(() => hiredStaffFor(activeSubTab.value))

// Perks gate on the matching facility's level. `?? 1` on requiredLevel keeps
// grandfathered staff (hired before facility gating) permanently active.
function isPerkActive(perk) {
  return (facilities.value[activeSubTab.value] ?? 1) >= (perk.requiredLevel ?? 1)
}

async function fireStaff() {
  if (firing.value) return
  firing.value = true
  const cfg = staffCfg.value
  try {
    const camp = await CampaignRepository.get(props.campaignId)
    if (camp) {
      camp.settings = camp.settings ?? {}
      delete camp.settings[cfg.settingsKey]
      await CampaignRepository.save(camp)
    }
    if (campaignStore.currentCampaign) {
      const settings = { ...campaignStore.currentCampaign.settings }
      delete settings[cfg.settingsKey]
      campaignStore.currentCampaign.settings = settings
    }
    syncStore.markDirty()
    toastStore.showSuccess(tDynamic(cfg.releasedToast))
  } catch (err) {
    console.error(`Failed to fire ${cfg.kind}:`, err)
    toastStore.showError(tDynamic(cfg.releaseFailedToast))
  } finally {
    firing.value = false
  }
}

async function onStaffHired() {
  try {
    await campaignStore.fetchCampaign(props.campaignId)
  } catch (err) {
    console.error('Failed to refresh campaign after hiring staff:', err)
  }
}

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
  audio.suppressClickSound() // cha-ching on success instead of the generic tap

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
    audio.purchase()
    toastStore.showSuccess(t('{name} upgraded to Level {level}!', { name: tDynamic(currentFacility.value.name), level: team.facilities[facilityKey] }))
  } catch (err) {
    console.error('Failed to upgrade facility:', err)
    const msg = err.response?.data?.message || t('Failed to upgrade facility')
    toastStore.showError(msg)
  } finally {
    upgrading.value = false
  }
}
</script>

<template>
  <div class="facilities-tab">
    <!-- Facilities Overview — every facility and its current level at a glance -->
    <div class="facilities-overview">
      <div
        v-for="(facility, key) in facilityTypes"
        :key="key"
        class="facility-overview-item"
      >
        <span class="overview-name">{{ $tDynamic(facility.name) }}</span>
        <div class="level-stars">
          <span
            v-for="i in 5"
            :key="i"
            class="star"
            :class="{ filled: i <= (facilities[key] ?? 1) }"
          >&#9733;</span>
        </div>
      </div>
    </div>

    <!-- Sub-Tab Navigation -->
    <div class="facility-tabs" data-tour="gm-facility-tabs">
      <button
        v-for="(facility, key) in facilityTypes"
        :key="key"
        class="facility-tab-btn"
        :class="{ active: activeSubTab === key }"
        @click="activeSubTab = key; confirmingUpgrade = false; showHireModal = false"
      >
        {{ $tDynamic(facility.name) }}
        <span v-if="!hiredStaffFor(key)" class="tab-badge tab-badge-warning">
          <AlertTriangle :size="10" />
        </span>
      </button>
    </div>

    <!-- Facility Detail -->
    <div class="facility-detail">
      <div class="facility-header" data-tour="gm-facility-header">
        <h3 class="facility-name">{{ $tDynamic(currentFacility.name) }}</h3>
        <div class="facility-level">
          <span class="level-label">{{ $t('Level') }}</span>
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

      <p class="facility-description">{{ $tDynamic(currentFacility.description) }}</p>

      <!-- Staff slot — the specialist who runs this facility -->
      <div class="staff-slot" :class="{ empty: !hiredStaff }" data-tour="gm-facility-staff">
        <template v-if="hiredStaff">
          <div class="staff-slot-header">
            <div class="staff-slot-avatar">
              <PersonnelAvatar
                :personnel="hiredStaff"
                :kind="staffCfg.kind"
                :size="44"
                :campaign-id="campaignId"
                :editable="true"
              />
            </div>
            <div class="staff-slot-info">
              <p class="staff-slot-name">{{ hiredStaff.name }}</p>
              <p class="staff-slot-meta">
                <span class="staff-slot-stars">{{ $tDynamic(staffCfg.starLabel, { n: hiredStaff.tier }) }}</span>
                <span class="staff-slot-dot">·</span>
                <span>{{ hiredStaff.contractYears !== 1 ? $t('{n} Seasons Remaining', { n: hiredStaff.contractYears }) : $t('{n} Season Remaining', { n: hiredStaff.contractYears }) }}</span>
              </p>
            </div>
            <button
              class="staff-slot-release"
              :disabled="firing"
              @click="fireStaff"
            >
              {{ firing ? $t('Releasing...') : $tDynamic(staffCfg.releaseLabel) }}
            </button>
          </div>

          <div v-if="hiredStaff.perks?.length" class="staff-slot-perks">
            <div
              v-for="perk in hiredStaff.perks"
              :key="perk.key"
              class="staff-perk-row"
              :class="{ inactive: !isPerkActive(perk) }"
            >
              <span class="staff-perk-icon">
                <Check v-if="isPerkActive(perk)" :size="13" />
                <Lock v-else :size="13" />
              </span>
              <span class="staff-perk-text">
                <span class="staff-perk-label">{{ $tDynamic(staffCfg.perkLabels[perk.key]?.label || perk.key) }}</span>
                <span class="staff-perk-desc">{{ $tDynamic(staffCfg.perkLabels[perk.key]?.description || '') }}</span>
                <span v-if="!isPerkActive(perk)" class="staff-perk-req">
                  {{ $tDynamic(staffCfg.perkReq, { n: perk.requiredLevel }) }}
                </span>
              </span>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="staff-slot-header">
            <div class="staff-slot-avatar empty-icon-wrap">
              <component :is="staffCfg.emptyIcon" :size="22" />
            </div>
            <div class="staff-slot-info">
              <p class="staff-slot-name empty-title">{{ $tDynamic(staffCfg.emptyTitle) }}</p>
            </div>
            <button
              class="staff-slot-hire"
              @click="showHireModal = true"
            >
              {{ $tDynamic(staffCfg.hireLabel) }}
            </button>
          </div>
        </template>
      </div>

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
          <span class="perk-text">{{ $tDynamic(perk) }}</span>
        </div>
      </div>

      <!-- Upgrade Button -->
      <div class="upgrade-section">
        <template v-if="isMaxLevel">
          <div class="max-level-badge">{{ $t('MAX LEVEL') }}</div>
        </template>
        <template v-else>
          <button
            class="upgrade-btn"
            :class="{ disabled: !canUpgrade }"
            :disabled="!canUpgrade"
            @click="promptUpgrade"
          >
            {{ $t('Upgrade to Level {n}', { n: currentLevel + 1 }) }}
            <span class="upgrade-cost">{{ $t('{n} tokens', { n: UPGRADE_COST.toLocaleString() }) }}</span>
          </button>
          <p v-if="awardTokens < UPGRADE_COST" class="insufficient-hint">
            {{ $t('Need {n} more tokens', { n: (UPGRADE_COST - awardTokens).toLocaleString() }) }}
          </p>
        </template>
      </div>

    </div>

    <!-- Upgrade confirmation popup — consistent with other token-spend confirms -->
    <FacilityUpgradeConfirmModal
      :show="confirmingUpgrade"
      :facility-name="currentFacility.name"
      :next-level="currentLevel + 1"
      :cost="UPGRADE_COST"
      :user-tokens="awardTokens"
      :loading="upgrading"
      @close="cancelUpgrade"
      @confirm="upgradeFacility"
    />

    <!-- Hire modal for the active facility's staff kind -->
    <component
      :is="staffCfg.modal"
      :show="showHireModal"
      :campaign-id="campaignId"
      v-bind="{ [staffCfg.modalLevelProp]: currentLevel }"
      @close="showHireModal = false"
      @hired="onStaffHired"
    />
  </div>
</template>

<style scoped>
.facilities-tab {
  padding: 0;
}

.facilities-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px 24px;
  padding: 16px 20px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  margin-bottom: 20px;
}

.facility-overview-item {
  display: flex;
  align-items: center;
}

.overview-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

/* Sub-tab navigation - standard pill style */
.facility-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.facility-tab-btn {
  position: relative;
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

/* Unhired-staff warning badge on the facility sub-tabs (mirrors the GM-view
   top-level tab badge) */
.tab-badge-warning {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  background: #F59E0B;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
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

/* Responsive */
@media (max-width: 768px) {
  .facility-detail {
    padding: 16px;
  }
}

[data-theme="light"] .facility-tab-btn {
  background: rgba(0, 0, 0, 0.05);
  border-color: rgba(0, 0, 0, 0.12);
  color: var(--color-text-secondary);
}

[data-theme="light"] .facility-tab-btn:hover {
  background: rgba(0, 0, 0, 0.1);
  color: var(--color-text-primary);
}

[data-theme="light"] .facility-tab-btn.active {
  background: var(--gradient-cosmic);
  border-color: transparent;
  color: black;
  box-shadow: 0 2px 8px rgba(232, 90, 79, 0.2);
}

/* --- Staff slot — the specialist who runs the facility, embedded right
   under the facility description --- */

.staff-slot {
  margin: 14px 0 16px;
  padding: 12px 14px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.02);
}

.staff-slot.empty {
  border-style: dashed;
  background: transparent;
}

.staff-slot-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.staff-slot-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  flex-shrink: 0;
  /* No overflow clipping — the brush edit badge sits at the corner and gets
     cut off when this wrapper has `overflow: hidden`. */
  overflow: visible;
}

.staff-slot-avatar.empty-icon-wrap {
  color: var(--color-text-secondary);
  opacity: 0.5;
}

.staff-slot-info {
  flex: 1;
  min-width: 0;
}

.staff-slot-name {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.staff-slot-name.empty-title {
  color: var(--color-text-secondary);
  font-weight: 500;
}

.staff-slot-meta {
  margin: 2px 0 0;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.staff-slot-stars {
  color: #F59E0B;
  font-weight: 600;
}

.staff-slot-dot {
  opacity: 0.5;
}

.staff-slot-release {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #ef4444;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.staff-slot-release:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
}

.staff-slot-release:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.staff-slot-hire {
  flex-shrink: 0;
  padding: 7px 14px;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  border: none;
  color: white;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.staff-slot-hire:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.staff-slot-perks {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.staff-perk-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.staff-perk-row.inactive {
  opacity: 0.55;
}

.staff-perk-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.staff-perk-row:not(.inactive) .staff-perk-icon {
  color: #22c55e;
}

.staff-perk-row.inactive .staff-perk-icon {
  color: var(--color-text-secondary);
}

.staff-perk-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.staff-perk-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.staff-perk-row.inactive .staff-perk-label {
  color: var(--color-text-secondary);
}

.staff-perk-desc {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  line-height: 1.3;
}

.staff-perk-req {
  font-size: 0.68rem;
  color: #F59E0B;
  font-weight: 500;
}

[data-theme="light"] .staff-slot {
  background: rgba(0, 0, 0, 0.02);
}

[data-theme="light"] .staff-slot.empty {
  background: transparent;
}
</style>
