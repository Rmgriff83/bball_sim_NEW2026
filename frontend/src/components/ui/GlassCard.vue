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
  },
  cosmic: {
    type: Boolean,
    default: false
  },
  nebula: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <div
    :class="[
      cosmic ? 'card-cosmic' : (elevated ? 'glass-card-elevated' : (hoverable ? 'glass-card' : 'glass-card-static')),
      nebula && !cosmic ? 'card-nebula' : '',
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

<style scoped>
/* Nebula effect on glass cards */
.card-nebula {
  position: relative;
  overflow: hidden;
}

.card-nebula::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 85% 95%, rgba(232, 90, 79, 0.08) 0%, transparent 40%),
    radial-gradient(ellipse at 15% 5%, rgba(244, 162, 89, 0.05) 0%, transparent 35%);
  pointer-events: none;
  z-index: 0;
}

.card-nebula > * {
  position: relative;
  z-index: 1;
}

/* Light mode inverted nebula */
[data-theme="light"] .card-nebula::after {
  background:
    radial-gradient(ellipse at 15% 5%, rgba(232, 90, 79, 0.06) 0%, transparent 40%),
    radial-gradient(ellipse at 85% 95%, rgba(244, 162, 89, 0.04) 0%, transparent 35%);
}
</style>
