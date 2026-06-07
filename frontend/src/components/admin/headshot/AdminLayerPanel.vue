<script setup>
import { Eye, EyeOff } from 'lucide-vue-next'

defineProps({
  layers: { type: Array, required: true },
  activeId: { type: String, default: null },
  visibleIds: { type: Set, required: true },
})

const emit = defineEmits(['select', 'toggle-visible'])
</script>

<template>
  <aside class="admin-layer-panel">
    <header class="alp-header">Layers</header>
    <div class="alp-list">
      <div
        v-for="layer in layers"
        :key="layer.id"
        class="alp-row"
        :class="{ active: activeId === layer.id }"
        @click="emit('select', layer.id)"
      >
        <span class="alp-radio" :class="{ checked: activeId === layer.id }"></span>
        <span class="alp-label">{{ layer.label }}</span>
        <button
          type="button"
          class="alp-eye"
          :class="{ off: !visibleIds.has(layer.id) }"
          :title="visibleIds.has(layer.id) ? 'Hide layer' : 'Show layer'"
          @click.stop="emit('toggle-visible', layer.id)"
        >
          <component :is="visibleIds.has(layer.id) ? Eye : EyeOff" :size="14" />
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.admin-layer-panel {
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  min-width: 220px;
}

.alp-header {
  padding: 10px 14px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid var(--glass-border);
}

.alp-list {
  display: flex;
  flex-direction: column;
  padding: 4px;
}

.alp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: background 0.15s ease;
}

.alp-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.alp-row.active {
  background: rgba(168, 85, 247, 0.18);
}

.alp-radio {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--color-text-tertiary);
  flex-shrink: 0;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.alp-radio.checked {
  border-color: #a855f7;
  background: #a855f7;
  box-shadow: inset 0 0 0 2px var(--color-bg-secondary);
}

.alp-label {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.alp-eye {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s ease, background 0.15s ease;
}

.alp-eye:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.alp-eye.off {
  color: var(--color-text-tertiary);
  opacity: 0.6;
}
</style>
