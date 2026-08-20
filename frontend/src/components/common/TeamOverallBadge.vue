<script setup>
const props = defineProps({
  overall: { type: Number, default: null },
  // 'sm' (default), 'md' — controls font/padding for tighter contexts
  size: { type: String, default: 'sm' },
})
</script>

<template>
  <span
    v-if="overall != null"
    class="team-overall-badge"
    :class="`team-overall-badge--${size}`"
    :title="$t('Team Overall (healthy roster): {n}', { n: overall })"
  >
    {{ overall }}
  </span>
</template>

<style scoped>
/* Minimal pill anchored to the bottom-left of any logo container with
   `position: relative`. Dark glass aesthetic so it reads against both
   light and dark team colors. */
.team-overall-badge {
  position: absolute;
  bottom: -4px;
  left: -4px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(15, 12, 20, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}

.team-overall-badge--md {
  min-width: 26px;
  height: 22px;
  padding: 0 7px;
  font-size: 0.78rem;
  border-radius: 11px;
  bottom: -5px;
  left: -5px;
}
</style>
