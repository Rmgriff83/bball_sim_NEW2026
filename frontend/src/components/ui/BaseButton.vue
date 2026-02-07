<script setup>
defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (value) => ['primary', 'secondary', 'ghost', 'danger'].includes(value)
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['sm', 'md', 'lg'].includes(value)
  },
  disabled: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  },
  type: {
    type: String,
    default: 'button'
  },
  block: {
    type: Boolean,
    default: false
  }
})

defineEmits(['click'])
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :class="[
      'btn',
      `btn-${variant}`,
      {
        'btn-sm': size === 'sm',
        'btn-lg': size === 'lg',
        'w-full': block,
        'opacity-75 cursor-wait': loading
      }
    ]"
    @click="$emit('click', $event)"
  >
    <span v-if="loading" class="animate-spin">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.4-5.4l-2.8 2.8M8.4 15.6l-2.8 2.8m12.8 0l-2.8-2.8M8.4 8.4L5.6 5.6" />
      </svg>
    </span>
    <slot v-else />
  </button>
</template>
