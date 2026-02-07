<script setup>
defineProps({
  variant: {
    type: String,
    default: 'default',
    validator: (value) => [
      'default', 'bronze', 'silver', 'gold', 'hof',
      'success', 'warning', 'error', 'info'
    ].includes(value)
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['sm', 'md'].includes(value)
  }
})
</script>

<template>
  <span
    :class="[
      'badge',
      `badge-${variant}`,
      { 'text-xs py-0.5 px-1.5': size === 'sm' }
    ]"
  >
    <slot />
  </span>
</template>
