<template>
  <img
    v-if="resolvedSrc"
    :src="resolvedSrc"
    :alt="player?.name || 'Player'"
    class="player-headshot"
    :style="{ width: size + 'px', height: size + 'px' }"
    @error="onImageError"
  />
  <User v-else :size="size" />
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { User } from 'lucide-vue-next'

const props = defineProps({
  player: { type: Object, default: null },
  size: { type: Number, default: 32 },
})

const imageError = ref(false)

const headshotModules = import.meta.glob('@/assets/headshots/*.png', { eager: true })

const resolvedSrc = computed(() => {
  if (imageError.value) return null
  const filename = props.player?.headshot
  if (!filename) return null
  const filenameLower = filename.toLowerCase()
  const match = Object.entries(headshotModules).find(([k]) => {
    const parts = k.split('/')
    return parts[parts.length - 1].toLowerCase() === filenameLower
  })
  return match ? match[1].default : null
})

watch(() => props.player?.headshot, () => {
  imageError.value = false
})

function onImageError() {
  imageError.value = true
}
</script>

<style scoped>
.player-headshot {
  object-fit: cover;
  border-radius: 50%;
}
</style>
