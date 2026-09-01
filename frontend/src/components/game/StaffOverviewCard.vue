<script setup>
// 1000-ft staff overview for the campaign homepage: one compact row per
// staff kind showing who's hired and — the key signal — whether a hired
// staffer's perks are actually ACTIVE or locked behind a too-low facility
// level (a hired 4-star scout at Scouting Lv1 runs with zero perks and
// users never noticed). Each row deep-links to that facility's sub-tab on
// the GM view Facilities tab.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { Binoculars, Heart, Activity, BarChart3, Ticket, Check, AlertTriangle, ChevronRight } from 'lucide-vue-next'
import { PERSONNEL_SETTINGS_KEY } from '@/engine/data/personnelTiers'
import PersonnelAvatar from '@/components/common/PersonnelAvatar.vue'

const props = defineProps({
  campaignId: { type: [String, Number], required: true },
})

const router = useRouter()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()

// String values are the SAME canonical (already-translated) keys used on the
// Facilities tab; rendered via $tDynamic. Enumerated in wl-i18n.config.js.
const STAFF_ROWS = [
  { key: 'scouting', kind: 'scout', settingsKey: PERSONNEL_SETTINGS_KEY.scout, label: 'Scout', emptyLabel: 'No Scout Hired', starLabel: '{n}-Star Scout', icon: Binoculars },
  { key: 'medical', kind: 'physician', settingsKey: PERSONNEL_SETTINGS_KEY.physician, label: 'Team Physician', emptyLabel: 'No Team Physician', starLabel: '{n}-Star Physician', icon: Heart },
  { key: 'training', kind: 'staff_trainer', settingsKey: PERSONNEL_SETTINGS_KEY.staff_trainer, label: 'Trainer', emptyLabel: 'No Trainer', starLabel: '{n}-Star Trainer', icon: Activity },
  { key: 'analytics', kind: 'analyst', settingsKey: PERSONNEL_SETTINGS_KEY.analyst, label: 'Analyst', emptyLabel: 'No Analyst Hired', starLabel: '{n}-Star Analyst', icon: BarChart3 },
  { key: 'arena', kind: 'arena_manager', settingsKey: PERSONNEL_SETTINGS_KEY.arena_manager, label: 'Arena Manager', emptyLabel: 'No Arena Manager', starLabel: '{n}-Star Arena Manager', icon: Ticket },
]

const rows = computed(() => {
  const settings = campaignStore.currentCampaign?.settings ?? {}
  const facilities = teamStore.team?.facilities ?? {}
  return STAFF_ROWS.map((row) => {
    const staff = settings[row.settingsKey] ?? null
    const level = facilities[row.key] ?? 1
    // Mirrors FacilitiesTab.isPerkActive — `?? 1` keeps grandfathered staff
    // (hired before facility gating) counting as active.
    const lockedCount = staff
      ? (staff.perks ?? []).filter(p => level < (p.requiredLevel ?? 1)).length
      : 0
    return { ...row, staff, lockedCount }
  })
})

function openFacility(row) {
  router.push(`/campaign/${props.campaignId}/team?tab=facilities&sub=${row.key}`)
}
</script>

<template>
  <section class="staff-overview-card glass-card-nebula" data-tour="home-staff-overview">
    <h3 class="section-header">{{ $t('FRANCHISE STAFF') }}</h3>
    <div class="staff-overview-list">
      <button
        v-for="row in rows"
        :key="row.key"
        type="button"
        class="staff-overview-row"
        :class="{ vacant: !row.staff }"
        @click="openFacility(row)"
      >
        <span class="staff-row-avatar">
          <PersonnelAvatar
            v-if="row.staff"
            :personnel="row.staff"
            :kind="row.kind"
            :size="32"
            :campaign-id="campaignId"
          />
          <span v-else class="staff-row-icon">
            <component :is="row.icon" :size="16" />
          </span>
        </span>
        <span class="staff-row-info">
          <span class="staff-row-role">{{ $tDynamic(row.label) }}</span>
          <span v-if="row.staff" class="staff-row-name">
            {{ row.staff.name }}
            <span class="staff-row-tier">· {{ $tDynamic(row.starLabel, { n: row.staff.tier }) }}</span>
          </span>
          <span v-else class="staff-row-name vacant-name">{{ $tDynamic(row.emptyLabel) }}</span>
        </span>
        <span v-if="row.staff && row.lockedCount > 0" class="staff-row-status locked">
          <AlertTriangle :size="13" />
          {{ row.lockedCount === 1 ? $t('{n} perk locked', { n: row.lockedCount }) : $t('{n} perks locked', { n: row.lockedCount }) }}
        </span>
        <span v-else-if="row.staff" class="staff-row-status active">
          <Check :size="13" />
          {{ $t('All perks active') }}
        </span>
        <span v-else class="staff-row-status vacant-status">{{ $t('Hire') }}</span>
        <ChevronRight :size="16" class="staff-row-chevron" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.staff-overview-card {
  padding: 16px;
}

.staff-overview-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.staff-overview-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.staff-overview-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.staff-overview-row.vacant {
  background: transparent;
  border: 1px dashed var(--glass-border);
}

.staff-row-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.staff-row-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.staff-row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.staff-row-role {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
}

.staff-row-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.staff-row-name.vacant-name {
  color: var(--color-text-secondary);
  font-weight: 500;
}

.staff-row-tier {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.staff-row-status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--radius-full);
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.staff-row-status.active {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.12);
}

.staff-row-status.locked {
  color: #F59E0B;
  background: rgba(245, 158, 11, 0.12);
}

.staff-row-status.vacant-status {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.staff-row-chevron {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}

[data-theme="light"] .staff-overview-row {
  background: rgba(0, 0, 0, 0.03);
}

[data-theme="light"] .staff-overview-row:hover {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .staff-overview-row.vacant {
  background: transparent;
}
</style>
