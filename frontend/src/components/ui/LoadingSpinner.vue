<script setup>
defineProps({
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['sm', 'md', 'lg'].includes(value)
  }
})
</script>

<template>
  <div :class="['loading-spinner', `size-${size}`]">
    <svg viewBox="0 0 24 24" fill="none">
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke-width="2.5"
        stroke-linecap="round"
        class="spinner-track"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke-width="2.5"
        stroke-linecap="round"
        class="spinner-arc"
      />
    </svg>
  </div>
</template>

<style scoped>
.loading-spinner {
  animation: spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.loading-spinner svg {
  width: 100%;
  height: 100%;
}

.size-sm {
  width: 16px;
  height: 16px;
}

.size-md {
  width: 24px;
  height: 24px;
}

.size-lg {
  width: 32px;
  height: 32px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spinner-track {
  stroke: var(--color-text-tertiary);
  opacity: 0.15;
}

.spinner-arc {
  stroke: var(--color-primary);
  opacity: 0.85;
}
</style>
