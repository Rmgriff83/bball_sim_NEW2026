<script setup>
defineProps({
  svgString: { type: String, default: '' },
  size: { type: Number, default: 380 },
})
</script>

<template>
  <div
    class="headshot-preview"
    :style="{ width: size + 'px', height: size + 'px' }"
    v-html="svgString"
  />
</template>

<style scoped>
.headshot-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  max-width: 100%;
}

.headshot-preview :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
