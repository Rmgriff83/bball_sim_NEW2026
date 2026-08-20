<template>
  <span>{{ translated }}</span>
</template>

<script>
import { computed } from 'vue'
import { tDynamic } from './i18n.js'

export default {
  name: 'TDynamic',
  props: {
    text: { type: String, required: true },
    params: { type: Object, default: null }
  },
  setup(props) {
    const translated = computed(() => tDynamic(props.text, props.params))
    return { translated }
  }
}
</script>
