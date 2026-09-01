<script setup>
import { ref, computed, onMounted, markRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTeamStore } from '@/stores/team'
import { useAuthStore } from '@/stores/auth'
import { useTokensStore } from '@/stores/tokens'
import { useCampaignStore } from '@/stores/campaign'
import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { useSyncStore } from '@/stores/sync'
import FacilityUpgradeConfirmModal from '@/components/team/FacilityUpgradeConfirmModal.vue'
import HireScoutModal from '@/components/team/HireScoutModal.vue'
import HireTrainerModal from '@/components/team/HireTrainerModal.vue'
import HireStaffTrainerModal from '@/components/team/HireStaffTrainerModal.vue'
import HireAnalystModal from '@/components/team/HireAnalystModal.vue'
import HireArenaManagerModal from '@/components/team/HireArenaManagerModal.vue'
import PersonnelAvatar from '@/components/common/PersonnelAvatar.vue'
import { AlertTriangle, Check, Lock, Binoculars, Heart, Activity, BarChart3, Ticket, Megaphone, X, Coins, Plus } from 'lucide-vue-next'
import { PERSONNEL_SETTINGS_KEY } from '@/engine/data/personnelTiers'
import {
  applyFandomDelta, ARENA_UPGRADE_RAW, FANDOM_DEFAULT,
  canRunMarketingEvent, MARKETING_EVENTS_PER_SEASON, MARKETING_BOOST_MULTIPLIER,
} from '@/engine/fandom/FandomService'
import { MARKETING_EVENTS } from '@/engine/data/marketingEvents'
import { t, tDynamic, dateLocale } from '@wl-i18n/i18n.js'

const props = defineProps({
  campaignId: {
    type: [String, Number],
    required: true
  },
  // Optional deep-link target (?tab=facilities&sub=<key>), e.g. from the
  // homepage staff overview card. Invalid/absent → default 'scouting'.
  initialSubTab: {
    type: String,
    default: null
  }
})

const teamStore = useTeamStore()
const authStore = useAuthStore()
const campaignStore = useCampaignStore()
const toastStore = useToastStore()
const syncStore = useSyncStore()
const audio = useAudioStore()

const activeSubTab = ref(
  ['scouting', 'training', 'medical', 'analytics', 'arena'].includes(props.initialSubTab)
    ? props.initialSubTab
    : 'scouting'
)

// Mirror the active facility sub-tab into the URL query (replace — no history
// spam) so refreshes and the headshot-editor round trip land back on the same
// department. Guarded to the team view's facilities tab so this component
// never rewrites another host's query.
const route = useRoute()
const router = useRouter()
watch(activeSubTab, (sub) => {
  if (route.query.tab !== 'facilities' || route.query.sub === sub) return
  router.replace({ query: { ...route.query, sub } }).catch(() => {})
})
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
      'Level 3: 3 scouting points every two weeks — activates Badge Intel + Personality Intel (4-star scout) and Insider Intel (select scouts)',
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
  arena: {
    name: 'Arena',
    description: 'Your home floor and everything around it. Every upgrade gives fandom an immediate boost and softens how much losses hurt it, and an energized fanbase amplifies your home-court advantage — hire an arena manager to protect fandom even further.',
    perks: [
      'Level 1: A rundown arena — flickering scoreboard, stale popcorn, and rows of empty seats',
      'Level 2: Losses hurt your fandom 5% less — activates your arena manager\'s Promo Machine perk',
      'Level 3: Losses hurt your fandom 10% less — activates the Game-Night DJ perk (select arena managers)',
      'Level 4: Losses hurt your fandom 15% less — a destination arena that keeps casual fans coming back',
      'Level 5: Losses hurt your fandom 20% less — a league-famous cathedral of basketball',
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
    releasedToast: 'Scout released',
    releaseFailedToast: 'Failed to release scout',
    perkReq: 'Requires Scouting Facility Lv {n}',
    perkLabels: {
      extra_reveals: { label: 'Extra Reveals', description: 'Reveals 33% of attributes per scout action (3 actions to fully scout)' },
      badge_reveal: { label: 'Badge Intel', description: '35% chance per scout action to reveal badges' },
      morale_reveal: { label: 'Personality Intel', description: '35% chance per scout action to reveal morale/personality' },
      red_flag_intel: { label: 'Insider Intel', description: 'Full scouting reports call out character and durability red flags buried in the numbers' },
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
    releasedToast: 'Trainer released',
    releaseFailedToast: 'Failed to release trainer',
    perkReq: 'Requires Training Facility Lv {n}',
    perkLabels: {
      growth_boost: { label: 'Enhanced Development', description: 'Players develop faster from game performance' },
      fatigue_reduction: { label: 'Conditioning Program', description: 'Players generate less fatigue during games' },
      badge_breakthrough: { label: 'Breakthrough Training', description: 'Training rewards can break through straight to Silver or Gold' },
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
    releasedToast: 'Analyst released',
    releaseFailedToast: 'Failed to release analyst',
    perkReq: 'Requires Analytics Facility Lv {n}',
    perkLabels: {
      postgame_analytics: { label: 'Postgame Analytics', description: "See your team's efficiency by play set after games." },
      opponent_analytics: { label: 'Opponent Scouting Report', description: "Scout the opponent's play-set tendencies before games." },
    },
  },
  arena: {
    kind: 'arena_manager',
    settingsKey: PERSONNEL_SETTINGS_KEY.arena_manager,
    modal: markRaw(HireArenaManagerModal),
    modalLevelProp: 'arenaFacilityLevel',
    emptyIcon: markRaw(Ticket),
    starLabel: '{n}-Star Arena Manager',
    emptyTitle: 'No Arena Manager',
    hireLabel: 'Hire Arena Manager',
    releasedToast: 'Arena manager released',
    releaseFailedToast: 'Failed to release arena manager',
    perkReq: 'Requires Arena Facility Lv {n}',
    perkLabels: {
      arena_loss_mitigation: { label: 'Damage Control', description: "Losses drag your fandom down less (stacks with your arena's built-in protection)" },
      marketing_boost: { label: 'Promo Machine', description: 'Marketing events boost fandom 25% more' },
      song_picker: { label: 'Game-Night DJ', description: 'Pick the song that plays during your timeouts from the pregame screen' },
    },
  },
}

const facilities = computed(() => {
  return teamStore.team?.facilities || { training: 1, medical: 1, scouting: 1, analytics: 1, arena: 1 }
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

// Perks the hired staff member carries that the facility level can't
// activate yet — drives the amber notice + slot tint so a hired-but-gated
// staffer is impossible to miss.
const lockedPerks = computed(() =>
  (hiredStaff.value?.perks ?? []).filter(p => !isPerkActive(p))
)

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
    // Deduct tokens (offline-capable: queues the spend when unreachable)
    await useTokensStore().spendTokens(UPGRADE_COST, 'facility_upgrade')

    // Upgrade team facility
    const facilityKey = activeSubTab.value
    const campaign = await CampaignRepository.get(props.campaignId)
    if (!campaign) throw new Error('Campaign not found')

    const userTeamId = campaign.teamId
    const team = await TeamRepository.get(props.campaignId, userTeamId)
    if (!team) throw new Error('Team not found')

    team.facilities = team.facilities ?? {}
    team.facilities[facilityKey] = Math.min(5, (team.facilities[facilityKey] ?? 1) + 1)
    // An arena upgrade energizes the fanbase immediately (mirrored by the
    // -4 hit when an unstaffed arena degrades at season rollover).
    if (facilityKey === 'arena') {
      team.fandom = applyFandomDelta(team.fandom, ARENA_UPGRADE_RAW)
    }
    await TeamRepository.save(team)

    // Update local stores
    if (teamStore.team) {
      teamStore.team.facilities = { ...team.facilities }
      if (facilityKey === 'arena') teamStore.team.fandom = team.fandom
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

// --- Arena sub-tab: fandom meter + marketing events --------------------------

const teamFandom = computed(() => {
  const v = Number(teamStore.team?.fandom ?? FANDOM_DEFAULT)
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : FANDOM_DEFAULT
})

// Same bands as the home-view fandom chip (aligned with news thresholds).
const fandomColor = computed(() => {
  const pct = teamFandom.value
  if (pct >= 85) return '#22c55e'
  if (pct >= 50) return '#f59e0b'
  if (pct >= 15) return '#f97316'
  return '#ef4444'
})

const _gameDate = computed(() =>
  campaignStore.currentCampaign?.currentDate ?? campaignStore.currentCampaign?.current_date ?? null
)

const marketingState = computed(() => campaignStore.currentCampaign?.settings?.marketing ?? null)

const marketingCheck = computed(() => canRunMarketingEvent(marketingState.value, _gameDate.value))

const marketingUsed = computed(() =>
  Math.min(MARKETING_EVENTS_PER_SEASON, Number(marketingState.value?.usedThisSeason) || 0)
)

// Promo Machine (marketing_boost) perk: hired arena manager + arena level
// meeting the perk's stored requiredLevel (grandfather rule `?? 1`).
const marketingBoostActive = computed(() => {
  const mgr = campaignStore.currentCampaign?.settings?.arena_manager
  const perk = (mgr?.perks ?? []).find(p => p.key === 'marketing_boost')
  if (!perk) return false
  return (facilities.value.arena ?? 1) >= (perk.requiredLevel ?? 1)
})

const marketingCooldownLabel = computed(() => {
  const iso = marketingCheck.value.eligibleDate
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })
})

const runningEventId = ref(null)
const showMarketingModal = ref(false)

// Confirm step before the token spend — mirrors the facility-upgrade
// confirm pattern, rendered as an overlay inside the marketing popup.
const confirmingEvent = ref(null)
watch(showMarketingModal, (open) => {
  if (!open) confirmingEvent.value = null
})

async function confirmMarketingEvent() {
  const event = confirmingEvent.value
  if (!event) return
  await runMarketingEvent(event)
  confirmingEvent.value = null
}

function goToStore() {
  showMarketingModal.value = false
  router.push('/store')
}

async function runMarketingEvent(event) {
  if (runningEventId.value) return
  if (!marketingCheck.value.allowed || awardTokens.value < event.cost) return
  runningEventId.value = event.id
  audio.suppressClickSound()

  try {
    // Deduct tokens (offline-capable: queues the spend when unreachable)
    await useTokensStore().spendTokens(event.cost, 'marketing_event')

    const campaign = await CampaignRepository.get(props.campaignId)
    if (!campaign) throw new Error('Campaign not found')
    const team = await TeamRepository.get(props.campaignId, campaign.teamId)
    if (!team) throw new Error('Team not found')

    const raw = event.raw * (marketingBoostActive.value ? MARKETING_BOOST_MULTIPLIER : 1)
    team.fandom = applyFandomDelta(team.fandom, raw)
    await TeamRepository.save(team)

    campaign.settings = campaign.settings ?? {}
    const prev = campaign.settings.marketing ?? {}
    campaign.settings.marketing = {
      ...prev,
      usedThisSeason: (Number(prev.usedThisSeason) || 0) + 1,
      lastUsedDate: _gameDate.value,
    }
    await CampaignRepository.save(campaign)

    // Mirror into the live stores
    if (teamStore.team) teamStore.team.fandom = team.fandom
    if (campaignStore.currentCampaign) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        marketing: campaign.settings.marketing,
      }
    }

    syncStore.markDirty()
    audio.purchase()
    toastStore.showSuccess(t('{name} boosted your fandom to {pct}%!', { name: tDynamic(event.name), pct: Math.round(team.fandom) }))
  } catch (err) {
    console.error('Failed to run marketing event:', err)
    toastStore.showError(t('Failed to run marketing event'))
  } finally {
    runningEventId.value = null
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
        @click="activeSubTab = key; confirmingUpgrade = false; showHireModal = false; showMarketingModal = false"
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

      <!-- Arena-only: marketing events live in a popup — trigger sits under
           the description, above the staff slot. -->
      <button
        v-if="activeSubTab === 'arena'"
        class="marketing-open-btn"
        data-tour="arena-marketing"
        @click="showMarketingModal = true"
      >
        <Megaphone :size="14" />
        <span>{{ $t('Marketing Events') }}</span>
        <span class="marketing-open-count">{{ marketingUsed }}/3</span>
      </button>

      <!-- Staff slot — the specialist who runs this facility -->
      <div class="staff-slot" :class="{ empty: !hiredStaff, 'perks-locked': lockedPerks.length > 0 }" data-tour="gm-facility-staff">
        <template v-if="hiredStaff">
          <div class="staff-slot-header">
            <div class="staff-slot-avatar">
              <PersonnelAvatar
                :personnel="hiredStaff"
                :kind="staffCfg.kind"
                :size="64"
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
              {{ firing ? $t('Releasing...') : $t('Release') }}
            </button>
          </div>

          <div v-if="lockedPerks.length > 0" class="staff-perks-notice">
            <AlertTriangle :size="14" />
            <span>{{ lockedPerks.length === 1 ? $t('{n} perk is locked — upgrade this facility to activate it', { n: lockedPerks.length }) : $t('{n} perks are locked — upgrade this facility to activate them', { n: lockedPerks.length }) }}</span>
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
              <component :is="staffCfg.emptyIcon" :size="62" />
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

    <!-- Marketing events popup (arena) -->
    <Teleport to="body">
      <Transition name="marketing-modal">
        <div v-if="showMarketingModal" class="marketing-modal-overlay" @click.self="showMarketingModal = false">
          <div class="marketing-modal">
            <header class="marketing-modal-header">
              <h3 class="marketing-modal-title">
                <Megaphone :size="16" />
                {{ $t('Marketing Events') }}
              </h3>
              <button class="marketing-modal-close" aria-label="Close" @click="showMarketingModal = false">
                <X :size="18" />
              </button>
            </header>

            <main class="marketing-modal-body">
              <!-- Fandom meter — the campaign's live meter, shown here where
                   the actions that move it live. -->
              <div class="fandom-section" data-tour="arena-fandom">
                <div class="fandom-header">
                  <span class="fandom-title">{{ $t('Fandom') }}</span>
                  <span class="fandom-pct" :style="{ color: fandomColor }">{{ teamFandom }}%</span>
                </div>
                <div class="fandom-bar">
                  <div class="fandom-bar-fill" :style="{ width: teamFandom + '%', background: fandomColor }"></div>
                </div>
                <p class="fandom-hint">{{ $t('Winning, playoff runs, and arena upgrades grow your fanbase — losing shrinks it. High fandom amplifies your home-court advantage.') }}</p>
              </div>

              <div class="marketing-header">
                <span class="marketing-usage">{{ $t('{used} of {max} used this season', { used: marketingUsed, max: 3 }) }}</span>
                <span class="marketing-token-group">
                  <span class="marketing-tokens">
                    <Coins :size="12" />
                    {{ awardTokens.toLocaleString() }}
                  </span>
                  <button type="button" class="buy-tokens-btn" @click="goToStore" :title="$t('Get more tokens in the Store')">
                    <Plus :size="12" />
                    <span>{{ $t('Get Tokens') }}</span>
                  </button>
                </span>
              </div>
              <p v-if="!marketingCheck.allowed && marketingCheck.reason === 'cooldown'" class="marketing-notice">
                {{ $t('Next event available {date}', { date: marketingCooldownLabel }) }}
              </p>
              <p v-else-if="!marketingCheck.allowed && marketingCheck.reason === 'season_cap'" class="marketing-notice">
                {{ $t('No marketing events left this season') }}
              </p>
              <p v-if="marketingBoostActive" class="marketing-boost-note">
                {{ $t('Promo Machine active — events boost fandom 25% more') }}
              </p>

              <div class="marketing-list">
                <div
                  v-for="event in MARKETING_EVENTS"
                  :key="event.id"
                  class="marketing-event"
                  :class="{ unavailable: !marketingCheck.allowed || awardTokens < event.cost }"
                >
                  <div class="marketing-event-info">
                    <span class="marketing-event-name">{{ $tDynamic(event.name) }}</span>
                    <span class="marketing-event-desc">{{ $tDynamic(event.description) }}</span>
                    <span class="marketing-event-gain">{{ $t('+{n} fandom', { n: event.raw }) }}</span>
                  </div>
                  <button
                    class="marketing-event-btn"
                    :disabled="!marketingCheck.allowed || awardTokens < event.cost || runningEventId !== null"
                    @click="confirmingEvent = event"
                  >
                    {{ runningEventId === event.id ? $t('Running...') : $t('{n} tokens', { n: event.cost.toLocaleString() }) }}
                  </button>
                </div>
              </div>
            </main>

            <!-- Confirm step before the token spend -->
            <div v-if="confirmingEvent" class="marketing-confirm-overlay">
              <div class="marketing-confirm-box">
                <p class="marketing-confirm-name">{{ $tDynamic(confirmingEvent.name) }}</p>
                <p class="marketing-confirm-text">
                  {{ $t('Spend {n} tokens to boost your fandom by {gain}?', { n: confirmingEvent.cost.toLocaleString(), gain: confirmingEvent.raw }) }}
                </p>
                <div class="marketing-confirm-actions">
                  <button class="marketing-confirm-cancel" :disabled="runningEventId !== null" @click="confirmingEvent = null">
                    {{ $t('Cancel') }}
                  </button>
                  <button class="marketing-confirm-btn" :disabled="runningEventId !== null" @click="confirmMarketingEvent">
                    {{ runningEventId !== null ? $t('Running...') : $t('Confirm') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

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

/* --- Arena: fandom meter (top of the marketing popup) ---------------------- */
.fandom-section {
  margin-bottom: 16px;
  padding: 14px 16px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.fandom-header,
.marketing-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}

.fandom-title {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

/* Trigger button — sits under the arena description, above the staff slot. */
.marketing-open-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 9px 14px;
  border-radius: var(--radius-lg);
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #F59E0B;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s ease;
}

.marketing-open-btn:hover {
  background: rgba(245, 158, 11, 0.22);
}

.marketing-open-count {
  padding: 1px 7px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.18);
  font-size: 0.7rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* Popup chrome (Teleported — scoped attrs still apply). */
.marketing-modal-overlay {
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

.marketing-modal {
  position: relative;
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

/* Spend-confirm overlay inside the popup (mirrors the discard-confirm
   pattern used by the roster-editor modals). */
.marketing-confirm-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.55);
}

.marketing-confirm-box {
  width: 100%;
  max-width: 320px;
  padding: 20px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  text-align: center;
}

.marketing-confirm-name {
  margin: 0 0 6px;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.marketing-confirm-text {
  margin: 0 0 16px;
  font-size: 0.82rem;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.marketing-confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.marketing-confirm-cancel {
  padding: 9px 16px;
  border-radius: var(--radius-lg);
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.marketing-confirm-cancel:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
}

.marketing-confirm-btn {
  padding: 9px 18px;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  border: none;
  color: white;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.marketing-confirm-btn:disabled,
.marketing-confirm-cancel:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.marketing-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--glass-border);
}

.marketing-modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.marketing-modal-title svg { color: #F59E0B; }

.marketing-modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.marketing-modal-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.marketing-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
}

.marketing-token-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.marketing-tokens {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  font-weight: 700;
  color: #F59E0B;
}

.buy-tokens-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-size: 0.68rem;
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

.marketing-modal-enter-active { transition: opacity 0.25s ease; }
.marketing-modal-leave-active { transition: opacity 0.2s ease; }
.marketing-modal-enter-from,
.marketing-modal-leave-to { opacity: 0; }

.fandom-pct {
  font-size: 1.2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.fandom-bar {
  height: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.fandom-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.fandom-hint {
  margin: 10px 0 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.marketing-usage {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.marketing-notice {
  margin: 0 0 10px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #f59e0b;
}

.marketing-boost-note {
  margin: 0 0 10px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #22c55e;
}

.marketing-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.marketing-event {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-lg);
}

.marketing-event.unavailable {
  opacity: 0.6;
}

.marketing-event-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.marketing-event-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.marketing-event-desc {
  font-size: 0.72rem;
  line-height: 1.3;
  color: var(--color-text-secondary);
}

.marketing-event-gain {
  font-size: 0.7rem;
  font-weight: 700;
  color: #22c55e;
}

.marketing-event-btn {
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #F59E0B;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.marketing-event-btn:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.25);
}

.marketing-event-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
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

.staff-slot.perks-locked {
  border-color: rgba(245, 158, 11, 0.45);
}

.staff-perks-notice {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 10px;
  padding: 7px 10px;
  border-radius: var(--radius-md);
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #F59E0B;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.3;
}

.staff-perks-notice svg {
  flex-shrink: 0;
}

.staff-slot-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.staff-slot-avatar {
  width: 64px;
  height: 64px;
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
