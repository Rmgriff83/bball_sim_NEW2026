<script setup>
defineProps({
  elevated: {
    type: Boolean,
    default: false
  },
  hoverable: {
    type: Boolean,
    default: true
  },
  padding: {
    type: String,
    default: 'md',
    validator: (value) => ['none', 'sm', 'md', 'lg'].includes(value)
  }
})
</script>

<template>
  <div
    :class="[
      elevated ? 'glass-card-elevated' : (hoverable ? 'glass-card' : 'glass-card-static'),
      {
        'p-3': padding === 'sm',
        'p-4': padding === 'md',
        'p-6': padding === 'lg'
      }
    ]"
  >
    <slot />
  </div>
</template>
