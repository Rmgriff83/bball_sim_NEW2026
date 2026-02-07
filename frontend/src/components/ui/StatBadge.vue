<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: {
    type: Number,
    required: true
  },
  showLabel: {
    type: Boolean,
    default: false
  },
  label: {
    type: String,
    default: ''
  }
})

const tierClass = computed(() => {
  if (props.value >= 90) return 'stat-elite'
  if (props.value >= 80) return 'stat-great'
  if (props.value >= 70) return 'stat-good'
  if (props.value >= 60) return 'stat-average'
  return 'stat-below'
})
</script>

<template>
  <div class="inline-flex flex-col items-center gap-1">
    <span :class="['stat-badge', tierClass]">
      {{ value }}
    </span>
    <span v-if="showLabel && label" class="text-xs text-secondary">
      {{ label }}
    </span>
  </div>
</template>
