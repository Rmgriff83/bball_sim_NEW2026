<script setup>
defineProps({
  layers: { type: Array, required: true },
  activeId: { type: String, default: null },
})

const emit = defineEmits(['select'])

function select(id) {
  emit('select', id)
}
</script>

<template>
  <aside class="layer-sidebar">
    <button
      v-for="layer in layers"
      :key="layer.id"
      type="button"
      class="layer-btn"
      :class="{ active: activeId === layer.id }"
      :data-tour="`editor-layer-${layer.id}`"
      @click="select(layer.id)"
    >
      {{ $tDynamic(layer.label) }}
    </button>
  </aside>
</template>

<style scoped>
.layer-sidebar {
  position: fixed;
  top: 50%;
  right: 24px;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  backdrop-filter: saturate(180%) blur(20px);
  z-index: 40;
}

.layer-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 96px;
  padding: 10px 14px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-text-secondary);
  border-radius: var(--radius-lg);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.layer-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.04);
}

.layer-btn.active {
  color: var(--color-text-primary);
  background: rgba(168, 85, 247, 0.18);
  border-color: rgba(168, 85, 247, 0.4);
}
</style>
