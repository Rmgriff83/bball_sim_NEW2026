<script setup>
import { Loader2 } from 'lucide-vue-next'

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
    <Loader2 v-if="loading" :size="16" class="animate-spin" />
    <slot v-else />
  </button>
</template>
