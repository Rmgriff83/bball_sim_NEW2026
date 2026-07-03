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
  <nav class="layer-bottom-nav">
    <div class="layer-track">
      <button
        v-for="layer in layers"
        :key="layer.id"
        type="button"
        class="layer-chip"
        :class="{ active: activeId === layer.id }"
        :data-tour="`editor-layer-${layer.id}`"
        @click="select(layer.id)"
      >
        {{ layer.label }}
      </button>
    </div>
  </nav>
</template>

<style scoped>
.layer-bottom-nav {
  position: fixed;
  left: 50%;
  bottom: calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 12px);
  transform: translateX(-50%);
  width: 92%;
  max-width: 720px;
  padding: 10px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  backdrop-filter: saturate(180%) blur(20px);
  z-index: 40;
}

.layer-track {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.layer-track::-webkit-scrollbar {
  display: none;
}

/* Pills match the admin variant strip's layer picker so the visual
   language stays consistent across both editors. Inactive pills get a
   subtle border + low-opacity background so they read as buttons. */
.layer-chip {
  flex: 0 0 auto;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-full);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.layer-chip:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.layer-chip.active {
  color: var(--color-text-primary);
  background: rgba(168, 85, 247, 0.22);
  border-color: rgba(168, 85, 247, 0.55);
}
</style>
