<script setup>
// Medical-staff credit panel for the Injury/Recovery Report modals: the hired
// physician's headshot (HeartPulse fallback when none), plus a delineated
// breakdown of WHERE the recovery-speed bonus comes from — facility level vs
// the physician's Fast Recovery perk — so upgrades feel earned. Renders
// nothing when there is no bonus and no locked perk to tease.
import { computed } from 'vue'
import { AlertTriangle } from 'lucide-vue-next'
import PersonnelAvatar from '@/components/common/PersonnelAvatar.vue'

const props = defineProps({
  // computeMedicalRecoveryBreakdown() output (useMedicalBenefits composable)
  breakdown: { type: Object, required: true },
  campaignId: { type: [String, Number], default: null },
  mode: { type: String, default: 'injury' }, // 'injury' | 'recovery'
})

const visible = computed(() =>
  !!props.breakdown && (props.breakdown.totalBonus > 0 || props.breakdown.perkLocked)
)

const pct = (x) => Math.round((Number(x) || 0) * 100)
</script>

<template>
  <div v-if="visible" class="med-panel">
    <div class="med-staff-row">
      <div class="med-avatar">
        <PersonnelAvatar
          :personnel="breakdown.physician"
          kind="physician"
          :size="40"
          :campaign-id="campaignId"
        />
      </div>
      <div class="med-staff-id">
        <span class="med-staff-name">{{ breakdown.physician?.name ?? $t('Medical Facility') }}</span>
        <span class="med-staff-role">{{ breakdown.physician ? $t('Team Physician') : $t('No physician hired') }}</span>
      </div>
      <!-- i18n-ignore -->
      <span v-if="breakdown.totalBonus > 0" class="med-total-chip">+{{ pct(breakdown.totalBonus) }}%</span>
    </div>

    <div class="med-lines">
      <div v-if="breakdown.facilityBonus > 0" class="med-line">
        <span class="med-line-label">{{ $t('Medical Facility Lv {n}', { n: breakdown.medicalLevel }) }}</span>
        <span class="med-line-value">{{ $t('+{n}% recovery speed', { n: pct(breakdown.facilityBonus) }) }}</span>
      </div>
      <div v-if="breakdown.perkBonus > 0" class="med-line">
        <span class="med-line-label">{{ $t('Fast Recovery perk (physician)') }}</span>
        <span class="med-line-value">{{ $t('+{n}% recovery speed', { n: pct(breakdown.perkBonus) }) }}</span>
      </div>
      <div v-else-if="breakdown.perkLocked" class="med-line med-line--locked">
        <AlertTriangle :size="12" />
        <span>{{ $t('Fast Recovery locked — requires Medical Facility Lv {n}', { n: breakdown.perkRequiredLevel ?? 3 }) }}</span>
      </div>
      <div v-if="breakdown.facilityBonus > 0 && breakdown.perkBonus > 0" class="med-line med-line--total">
        <span class="med-line-label">{{ $t('Total recovery speed') }}</span>
        <!-- i18n-ignore -->
        <span class="med-line-value">+{{ pct(breakdown.totalBonus) }}%</span>
      </div>
    </div>

    <p class="med-caption">{{ mode === 'recovery' ? $t('Your medical staff sped up these recoveries.') : $t('Recovery estimates below include your medical staff bonus.') }}</p>
  </div>
</template>

<style scoped>
.med-panel {
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.med-staff-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.med-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #22c55e;
  background: rgba(34, 197, 94, 0.12);
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.22);
  flex-shrink: 0;
}

.med-staff-id {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.med-staff-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.med-staff-role {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
}

.med-total-chip {
  margin-left: auto;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 700;
  font-size: 0.85rem;
  color: #22c55e;
  background: rgba(34, 197, 94, 0.12);
  padding: 3px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.med-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--glass-border);
}

.med-line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.med-line-value {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 600;
  color: #22c55e;
  flex-shrink: 0;
}

.med-line--locked {
  justify-content: flex-start;
  align-items: center;
  gap: 6px;
  color: #f59e0b;
}

.med-line--total {
  padding-top: 4px;
  border-top: 1px dashed var(--glass-border);
  color: var(--color-text-primary);
  font-weight: 600;
}

.med-caption {
  margin: 8px 0 0;
  font-size: 0.72rem;
  font-style: italic;
  color: var(--color-text-tertiary);
}
</style>
