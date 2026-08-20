<script setup>
import { computed } from 'vue'
import { useDraftStore } from '@/stores/draft'
import { capStatusFor } from '@/engine/data/salaryScale'

// Fantasy-draft salary cap readout. Renders nothing in rookie mode (rookies
// have no contracts). Used in both the desktop roster sidebar and the mobile
// roster drawer.
//
// Apron economy: drafting past the cap is allowed (owner penalties land next
// season); the hard ops lock — minimum-level contracts only — engages above
// the SECOND apron. The readout walks the full ladder so the user always
// knows which band they're in.
const draftStore = useDraftStore()

const show = computed(() => draftStore.draftMode === 'fantasy')

function fmtMillions(n) {
  return `$${((n || 0) / 1_000_000).toFixed(1)}M`
}

const capNumbers = computed(() => draftStore.capNumbers)
const payroll = computed(() => draftStore.userPayroll)

// Shared tiers/palette with FinancesTab + the league team popup.
const capStatus = computed(() => capStatusFor(payroll.value, capNumbers.value))

const ladder = computed(() => [
  { key: 'cap', label: 'Cap', value: capNumbers.value?.salaryCap },
  { key: 'tax', label: 'Tax', value: capNumbers.value?.luxuryTax },
  { key: 'apron1', label: 'Apron 1', value: capNumbers.value?.firstApron },
  { key: 'apron2', label: 'Apron 2', value: capNumbers.value?.secondApron },
].filter(t => t.value > 0))

const TIER_COLORS = {
  under: '#4ade80',
  overcap: '#fbbf24',
  tax: '#fbbf24',
  apron1: '#f97316',
  apron2: '#ef4444',
}
const accentColor = computed(() => TIER_COLORS[capStatus.value.key] ?? '#4ade80')

// Over the cap but the ops lock hasn't engaged — soft heads-up only.
const overCapSoft = computed(() =>
  capStatus.value.key !== 'under' && !draftStore.userCapPenaltyActive
)
</script>

<template>
  <div v-if="show" class="cap-readout" :style="{ '--cap-color': accentColor }">
    <div class="cap-row">
      <span class="cap-label">{{ $t('Payroll') }}</span>
      <span class="cap-chip" :class="capStatus.cls">{{ $tDynamic(capStatus.label) }}</span>
      <span class="cap-value">{{ fmtMillions(payroll) }}</span>
    </div>
    <div class="cap-ladder-mini">
      <div
        v-for="t in ladder"
        :key="t.key"
        class="cap-mini-row"
        :class="{ crossed: payroll > t.value }"
      >
        <span class="cap-mini-label">{{ $tDynamic(t.label) }}</span>
        <span class="cap-mini-value">{{ fmtMillions(t.value) }}</span>
      </div>
    </div>
    <div v-if="draftStore.userCapPenaltyActive" class="cap-warning">
      {{ $t('Over the second apron — only contracts under {amount} can be drafted.', { amount: fmtMillions(draftStore.overCapMaxSalary) }) }}
    </div>
    <div v-else-if="overCapSoft" class="cap-hint">
      {{ $t('Over the cap — you can keep drafting, but owner penalties apply next season.') }}
    </div>
  </div>
</template>

<style scoped>
.cap-readout {
  margin: -6px 0 16px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
  border-left: 3px solid var(--cap-color);
}

.cap-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.cap-label {
  font-size: 0.52rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.cap-chip {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.55rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* Same palette as FinancesTab's status chip */
.cap-chip.status-under { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.cap-chip.status-overcap { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.cap-chip.status-tax { background: rgba(245, 158, 11, 0.22); color: #f59e0b; }
.cap-chip.status-apron1 { background: rgba(249, 115, 22, 0.18); color: #f97316; }
.cap-chip.status-apron2 { background: rgba(239, 68, 68, 0.18); color: #ef4444; }

.cap-value {
  margin-left: auto;
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--cap-color);
  font-variant-numeric: tabular-nums;
}

.cap-ladder-mini {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px solid var(--glass-border);
}

.cap-mini-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.66rem;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.cap-mini-row.crossed {
  opacity: 0.45;
  text-decoration: line-through;
}

.cap-mini-label {
  font-weight: 700;
}

.cap-warning {
  margin-top: 7px;
  font-size: 0.72rem;
  line-height: 1.3;
  color: #ef4444;
}

.cap-hint {
  margin-top: 7px;
  font-size: 0.7rem;
  line-height: 1.3;
  color: var(--color-text-tertiary);
}
</style>
