<script setup>
import { getPositionColor } from './tradeAssetFormat'

defineProps({
  modelValue: { type: String, default: 'all' },
})
const emit = defineEmits(['update:modelValue'])

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

function select(value) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="pos-filter">
    <button
      type="button"
      class="pos-btn"
      :class="{ active: modelValue === 'all' }"
      @click="select('all')"
    >All</button>
    <button
      v-for="pos in POSITIONS"
      :key="pos"
      type="button"
      class="pos-btn"
      :class="{ active: modelValue === pos }"
      :style="modelValue === pos ? { backgroundColor: getPositionColor(pos), borderColor: getPositionColor(pos), color: '#fff' } : null"
      @click="select(pos)"
    >{{ pos }}</button>
  </div>
</template>

<style scoped>
.pos-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pos-btn {
  min-width: 40px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.7);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.pos-btn:hover {
  background: rgba(255, 255, 255, 0.09);
}
.pos-btn.active {
  color: #fff;
}
/* "All" active has no position color — give it a neutral accent. */
.pos-btn.active:first-child {
  background: rgba(96, 165, 250, 0.22);
  border-color: rgba(96, 165, 250, 0.6);
}

/* Light mode: the white-alpha pill chrome above vanishes on the cream
   background — swap to dark-alpha. Active POSITION pills keep their inline
   solid colors + white text (readable in both themes); the active "All"
   keeps its light-blue tint, so its text goes dark blue instead of white. */
[data-theme="light"] .pos-btn {
  border-color: rgba(45, 40, 56, 0.2);
  background: rgba(45, 40, 56, 0.05);
  color: var(--color-text-secondary);
}

[data-theme="light"] .pos-btn:hover {
  background: rgba(45, 40, 56, 0.1);
}

[data-theme="light"] .pos-btn.active:first-child {
  color: #1d4ed8;
}
</style>
