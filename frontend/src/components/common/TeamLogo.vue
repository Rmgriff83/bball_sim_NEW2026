<template>
  <img
    v-if="resolvedSrc"
    :src="resolvedSrc"
    :alt="abbreviation || 'Team'"
    class="team-logo-img"
    :style="{ width: size + 'px', height: size + 'px' }"
    @error="onImageError"
  />
  <div
    v-else
    class="team-badge-fallback"
    :style="{
      width: size + 'px',
      height: size + 'px',
      backgroundColor: color || '#666',
      fontSize: (size * 0.32) + 'px',
    }"
  >
    {{ abbreviation || '?' }}
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  abbreviation: { type: String, default: null },
  color: { type: String, default: '#666' },
  size: { type: Number, default: 40 },
})

const imageError = ref(false)

const logoModules = import.meta.glob('@/assets/logos/*.png', { eager: true })

const resolvedSrc = computed(() => {
  if (imageError.value) return null
  if (!props.abbreviation) return null
  const abbrevLower = props.abbreviation.toLowerCase()
  const match = Object.entries(logoModules).find(([k]) => {
    const parts = k.split('/')
    return parts[parts.length - 1].toLowerCase() === `${abbrevLower}.png`
  })
  return match ? match[1].default : null
})

watch(() => props.abbreviation, () => {
  imageError.value = false
})

function onImageError() {
  imageError.value = true
}
</script>

<style scoped>
.team-logo-img {
  object-fit: contain;
  border-radius: 50%;
}

.team-badge-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: white;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}
</style>
