<script setup>
import { Snowflake } from 'lucide-vue-next'

// Apron-penalty marker for draft picks — one shared chip so every surface
// (scout draft tab, lottery results, draft room ticker, pick lists, trade
// wizard) renders the penalty identically. `compact` = icon-only for tight
// spots like the draft ticker.
defineProps({
  compact: { type: Boolean, default: false },
})
</script>

<template>
  <span
    class="apron-badge"
    :class="{ compact }"
    title="Apron penalty — this first-round pick drops to the end of round 1."
  >
    <Snowflake :size="compact ? 10 : 9" />
    <template v-if="!compact">APRON</template>
  </span>
</template>

<style scoped>
.apron-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.16);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #ef4444;
  font-size: 0.56rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  line-height: 1.4;
  white-space: nowrap;
  vertical-align: middle;
  cursor: help;
}

.apron-badge.compact {
  padding: 1px 3px;
  gap: 0;
}
</style>
