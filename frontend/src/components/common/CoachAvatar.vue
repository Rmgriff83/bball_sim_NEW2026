<template>
  <div
    class="coach-avatar-wrap"
    :style="{ width: size + 'px', height: size + 'px' }"
  >
    <img
      v-if="resolvedSrc"
      :src="resolvedSrc"
      :alt="coach?.name || 'Coach'"
      class="coach-headshot"
      @error="onImageError"
    />
    <UserCog v-else :size="size" />

    <!-- Always-visible brush badge — mirrors the player one in
         PlayerDetailModal's header. Shown only when the user has the
         headshot_editor IAP AND this avatar is bound to a real campaign +
         coach (so we can route). Click navigates to the coach editor. -->
    <button
      v-if="canEdit"
      type="button"
      class="edit-headshot-overlay"
      title="Edit headshot"
      aria-label="Edit coach headshot"
      @click.stop="openEditor"
    >
      <Brush :size="13" />
    </button>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { UserCog, Brush } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { getCoachHeadshotByName } from '@/services/headshotPremades'
import { CoachHeadshotRepository } from '@/engine/db/CoachHeadshotRepository'

const props = defineProps({
  coach: { type: Object, default: null },
  size: { type: Number, default: 32 },
  // Required for IDB custom-edit lookup. Passing this alone enables the
  // resolver to read CoachHeadshotRepository so saved user edits show up
  // — but does NOT show the edit pencil (that's gated by `editable` below).
  // Pass campaignId everywhere a coach is rendered in an active campaign
  // so edits stay live; opt into the pencil only where editing is intended.
  campaignId: { type: [String, Number], default: null },
  // Set true to show the brush edit badge (still gated by the
  // headshot_editor IAP). Defaults false so game/league/modal surfaces
  // render the fresh headshot without offering an out-of-context action.
  editable: { type: Boolean, default: false },
})

const router = useRouter()
const authStore = useAuthStore()

const imageError = ref(false)
const customSvgUrl = ref(null)

// Cache one data: URL per coach-headshot SVG filename so we don't re-encode
// on every render. Bundled SVGs are stable so the cache never invalidates.
const _svgUrlCache = new Map()
function _svgUrlFor(filename, svgContent) {
  if (_svgUrlCache.has(filename)) return _svgUrlCache.get(filename)
  // encodeURIComponent + data:image/svg+xml works for all reasonable SVG sizes
  // (browsers cap data URLs around the multi-MB range; coach SVGs are
  // ~70-150KB). Avoids blob URL lifecycle complexity.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`
  _svgUrlCache.set(filename, url)
  return url
}

const resolvedSrc = computed(() => {
  if (imageError.value) return null
  // 1) Custom IDB override wins (user-edited coach headshot).
  if (customSvgUrl.value) return customSvgUrl.value
  const filename = props.coach?.headshot
  if (!filename) return null
  // 2) Look in coach-headshots/ — both admin-authored SVGs (coach_NNN.svg)
  //    and legacy master-coach PNGs (e.g. gregg_popovich.png) live there.
  const entry = getCoachHeadshotByName(filename)
  if (!entry) return null
  if (entry.kind === 'svg') return _svgUrlFor(filename, entry.svgContent)
  return entry.url
})

// Custom IDB lookup. Only runs when we have both campaignId + coachId AND
// the coach has been marked has_custom_headshot. Mirrors the player resolver
// pattern.
async function _loadCustomSvg() {
  const cid = props.campaignId
  const coachId = props.coach?.id
  const hasCustom = props.coach?.hasCustomHeadshot ?? props.coach?.has_custom_headshot
  if (!cid || !coachId || !hasCustom) {
    customSvgUrl.value = null
    return
  }
  try {
    const record = await CoachHeadshotRepository.get(cid, coachId)
    if (record?.svgContent) {
      // Revoke previous URL if any to avoid leaking blob handles across loads.
      if (customSvgUrl.value && customSvgUrl.value.startsWith('blob:')) {
        URL.revokeObjectURL(customSvgUrl.value)
      }
      const blob = new Blob([record.svgContent], { type: 'image/svg+xml' })
      customSvgUrl.value = URL.createObjectURL(blob)
    } else {
      customSvgUrl.value = null
    }
  } catch {
    customSvgUrl.value = null
  }
}

watch(
  () => [props.campaignId, props.coach?.id, props.coach?.hasCustomHeadshot, props.coach?.has_custom_headshot],
  () => {
    imageError.value = false
    _loadCustomSvg()
  },
  { immediate: true },
)

watch(() => props.coach?.headshot, () => {
  imageError.value = false
})

const canEdit = computed(() =>
  Boolean(
    props.editable
    && props.campaignId
    && props.coach?.id
    && authStore.hasFeature('headshot_editor'),
  )
)

function openEditor() {
  if (!canEdit.value) return
  router.push({
    name: 'coach-headshot-editor',
    params: { id: String(props.campaignId), coachId: String(props.coach.id) },
  })
}

function onImageError() {
  imageError.value = true
}
</script>

<style scoped>
.coach-avatar-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.coach-headshot {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

/* Matches the brush badge on PlayerAvatar in PlayerDetailModal so player
   and coach edit affordances feel identical. */
.edit-headshot-overlay {
  position: absolute;
  bottom: -10px;
  left: -5px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border: 2px solid var(--color-bg-secondary, #1a1520);
  color: white;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  transition: filter 0.15s ease, transform 0.15s ease;
  padding: 0;
}

.edit-headshot-overlay:hover {
  filter: brightness(1.1);
  transform: scale(1.05);
}
</style>
