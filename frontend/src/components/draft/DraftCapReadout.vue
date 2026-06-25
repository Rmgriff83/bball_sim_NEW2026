<script setup>
import { computed } from 'vue'
import { useDraftStore } from '@/stores/draft'

// Fantasy-draft salary cap readout. Renders nothing in rookie mode (rookies
// have no contracts). Used in both the desktop roster sidebar and the mobile
// roster drawer.
const draftStore = useDraftStore()

const show = computed(() => draftStore.draftMode === 'fantasy')

function fmtMillions(n) {
  return `$${((n || 0) / 1_000_000).toFixed(1)}M`
}
const capPct = computed(() =>
  draftStore.salaryCap ? draftStore.userPayroll / draftStore.salaryCap : 0
)
const capStatusColor = computed(() => {
  if (draftStore.userPayroll > draftStore.salaryCap) return '#ef4444' // over → red
  if (capPct.value >= 0.9) return '#fbbf24'                            // 90–100% → yellow
  return '#4ade80'                                                     // under → green
})
</script>

<template>
  <div v-if="show" class="cap-readout" :style="{ '--cap-color': capStatusColor }">
    <div class="cap-row">
      <span class="cap-label">Salary Cap</span>
      <span class="cap-value">{{ fmtMillions(draftStore.userPayroll) }} / {{ fmtMillions(draftStore.salaryCap) }}</span>
    </div>
    <div v-if="draftStore.userCapPenaltyActive" class="cap-warning">
      Over the cap — only contracts under {{ fmtMillions(draftStore.overCapMaxSalary) }} can be drafted.
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
  justify-content: space-between;
  gap: 8px;
}

.cap-label {
  font-size: 0.52rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.cap-value {
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--cap-color);
}

.cap-warning {
  margin-top: 7px;
  font-size: 0.72rem;
  line-height: 1.3;
  color: #ef4444;
}
</style>
