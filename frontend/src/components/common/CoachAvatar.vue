<template>
  <img
    v-if="resolvedSrc"
    :src="resolvedSrc"
    :alt="coach?.name || 'Coach'"
    class="coach-headshot"
    :style="{ width: size + 'px', height: size + 'px' }"
    @error="onImageError"
  />
  <UserCog v-else :size="size" />
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { UserCog } from 'lucide-vue-next'

const props = defineProps({
  coach: { type: Object, default: null },
  size: { type: Number, default: 32 },
})

const imageError = ref(false)

// Eager-load every PNG in the coach-headshots folder. The user drops files in
// over time; missing files just fall back to the UserCog icon below.
const headshotModules = import.meta.glob('@/assets/coach-headshots/*.png', { eager: true })

const resolvedSrc = computed(() => {
  if (imageError.value) return null
  const filename = props.coach?.headshot
  if (!filename) return null
  const filenameLower = filename.toLowerCase()
  const match = Object.entries(headshotModules).find(([k]) => {
    const parts = k.split('/')
    return parts[parts.length - 1].toLowerCase() === filenameLower
  })
  return match ? match[1].default : null
})

watch(() => props.coach?.headshot, () => {
  imageError.value = false
})

function onImageError() {
  imageError.value = true
}
</script>

<style scoped>
.coach-headshot {
  object-fit: cover;
  border-radius: 50%;
}
</style>
