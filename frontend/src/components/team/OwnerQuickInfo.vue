<script setup>
// Compact owner snapshot shown in the selected-team preview of the campaign
// create modal and the GM re-hire (team-switch) modal — so the user knows who
// they'd be answering to, and their mandate, before committing to a team.
import { computed } from 'vue'
import { Crown, Banknote } from 'lucide-vue-next'
import { findOwnerForTeam, EXPECTATION_LABEL, expectedWinsForExpectation } from '@/engine/data/owners'

const props = defineProps({
  teamAbbreviation: { type: String, default: null },
})

const owner = computed(() => findOwnerForTeam(props.teamAbbreviation))
const ownerName = computed(() => (owner.value ? `${owner.value.firstName} ${owner.value.lastName}` : ''))
const mandate = computed(() => EXPECTATION_LABEL[owner.value?.expectation] ?? '—')
const expectedWins = computed(() => (owner.value ? expectedWinsForExpectation(owner.value.expectation) : null))
</script>

<template>
  <div v-if="owner" class="oqi">
    <span class="oqi-head">
      <Crown :size="12" />
      <span class="oqi-name">{{ ownerName }}</span>
      <span class="oqi-mandate">{{ mandate }} · ~{{ expectedWins }} wins</span>
    </span>
    <span v-if="owner.wealthSource" class="oqi-wealth">
      <Banknote :size="11" /> {{ owner.wealthSource }}
    </span>
  </div>
</template>

<style scoped>
.oqi {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--glass-border);
}
.oqi-head {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 0.78rem;
}
.oqi-head svg {
  color: #ffc72c;
  flex-shrink: 0;
}
.oqi-name {
  font-weight: 700;
  color: var(--color-text-primary);
}
.oqi-mandate {
  font-size: 0.66rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-tertiary);
}
.oqi-wealth {
  display: inline-flex;
  align-items: flex-start;
  gap: 5px;
  font-size: 0.72rem;
  font-style: italic;
  line-height: 1.3;
  color: var(--color-text-tertiary);
}
.oqi-wealth svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: #84cc16;
}
</style>
