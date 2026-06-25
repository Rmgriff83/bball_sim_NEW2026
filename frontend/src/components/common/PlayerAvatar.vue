<template>
  <img
    v-if="resolvedSrc && !imageError"
    :src="resolvedSrc"
    :alt="player?.name || 'Player'"
    class="player-headshot"
    :style="{ width: size + 'px', height: size + 'px' }"
    loading="lazy"
    decoding="async"
    @error="onImageError"
  />
  <User v-else :size="size" />
</template>

<script setup>
import { ref, watch } from 'vue'
import { User } from 'lucide-vue-next'
import { useSyncStore } from '@/stores/sync'
import { resolveHeadshotSrc } from '@/services/headshotResolver'

const props = defineProps({
  player: { type: Object, default: null },
  size: { type: Number, default: 32 },
  // Optional explicit campaign — falls back to the sync store's active
  // campaign so existing call sites don't need to thread it through.
  campaignId: { type: [String, Number], default: null },
})

const syncStore = useSyncStore()
const imageError = ref(false)
const resolvedSrc = ref(null)

async function refreshSrc() {
  imageError.value = false
  if (!props.player) {
    resolvedSrc.value = null
    return
  }
  const cid = props.campaignId ?? syncStore.activeCampaignId
  resolvedSrc.value = await resolveHeadshotSrc(props.player, cid)
}

watch(
  () => [
    props.player?.id,
    props.player?.headshot,
    props.player?.hasCustomHeadshot ?? props.player?.has_custom_headshot,
    props.campaignId,
  ],
  refreshSrc,
  { immediate: true }
)

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
