<template>
  <div
    class="personnel-avatar-wrap"
    :style="{ width: size + 'px', height: size + 'px' }"
  >
    <img
      v-if="resolvedSrc"
      :src="resolvedSrc"
      :alt="personnel?.name || labelForKind"
      class="personnel-headshot"
      @error="onImageError"
    />
    <component :is="fallbackIcon" v-else :size="size" />

    <!-- Always-visible brush badge — mirrors the player one in
         PlayerDetailModal's header. Shown only when the user has the
         headshot_editor IAP AND this avatar is bound to a real campaign +
         personnel (so we can route). Click navigates to the editor. -->
    <button
      v-if="canEdit"
      type="button"
      class="edit-headshot-overlay"
      title="Edit headshot"
      :aria-label="`Edit ${labelForKind.toLowerCase()} headshot`"
      @click.stop="openEditor"
    >
      <Brush :size="13" />
    </button>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { UserCog, HeartPulse, Dumbbell, Eye, Brush } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { getCoachHeadshotByName } from '@/services/headshotPremades'
import { PersonnelHeadshotRepository } from '@/engine/db/PersonnelHeadshotRepository'

const props = defineProps({
  // The personnel object (coach / scout / physician / staff_trainer).
  // Reads .id, .name, .headshot, .hasCustomHeadshot (or .has_custom_headshot).
  personnel: { type: Object, default: null },
  // Which personnel kind this avatar represents. Drives the fallback icon
  // and the route the brush badge navigates to.
  kind: {
    type: String,
    default: 'coach',
    validator: v => ['coach', 'scout', 'physician', 'staff_trainer'].includes(v),
  },
  size: { type: Number, default: 32 },
  // Required for IDB custom-edit lookup. Passing this alone enables the
  // resolver to read the personnelHeadshots store so saved user edits show up
  // — but does NOT show the edit pencil (that's gated by `editable` below).
  campaignId: { type: [String, Number], default: null },
  // Set true to show the brush edit badge (still gated by the
  // headshot_editor IAP).
  editable: { type: Boolean, default: false },
})

const router = useRouter()
const authStore = useAuthStore()

const imageError = ref(false)
const customSvgUrl = ref(null)

const FALLBACK_ICONS = {
  coach: UserCog,
  scout: Eye,
  physician: HeartPulse,
  staff_trainer: Dumbbell,
}
const KIND_LABELS = {
  coach: 'Coach',
  scout: 'Scout',
  physician: 'Physician',
  staff_trainer: 'Trainer',
}

const fallbackIcon = computed(() => FALLBACK_ICONS[props.kind] || UserCog)
const labelForKind = computed(() => KIND_LABELS[props.kind] || 'Personnel')

// Cache one data: URL per coach-headshot SVG filename so we don't re-encode
// on every render. Bundled SVGs are stable so the cache never invalidates.
const _svgUrlCache = new Map()
function _svgUrlFor(filename, svgContent) {
  if (_svgUrlCache.has(filename)) return _svgUrlCache.get(filename)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`
  _svgUrlCache.set(filename, url)
  return url
}

const resolvedSrc = computed(() => {
  if (imageError.value) return null
  if (customSvgUrl.value) return customSvgUrl.value
  const filename = props.personnel?.headshot
  if (!filename) return null
  // All personnel kinds share the same coach-headshots/ pool of files.
  const entry = getCoachHeadshotByName(filename)
  if (!entry) return null
  if (entry.kind === 'svg') return _svgUrlFor(filename, entry.svgContent)
  return entry.url
})

async function _loadCustomSvg() {
  const cid = props.campaignId
  const id = props.personnel?.id
  const hasCustom = props.personnel?.hasCustomHeadshot ?? props.personnel?.has_custom_headshot
  if (!cid || !id || !hasCustom) {
    customSvgUrl.value = null
    return
  }
  try {
    const record = await PersonnelHeadshotRepository.get(cid, props.kind, id)
    if (record?.svgContent) {
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
  () => [props.campaignId, props.personnel?.id, props.kind,
         props.personnel?.hasCustomHeadshot, props.personnel?.has_custom_headshot],
  () => {
    imageError.value = false
    _loadCustomSvg()
  },
  { immediate: true },
)

watch(() => props.personnel?.headshot, () => {
  imageError.value = false
})

const canEdit = computed(() =>
  Boolean(
    props.editable
    && props.campaignId
    && props.personnel?.id
    && authStore.hasFeature('headshot_editor'),
  )
)

function openEditor() {
  if (!canEdit.value) return
  router.push({
    name: 'personnel-headshot-editor',
    params: {
      id: String(props.campaignId),
      kind: props.kind,
      personnelId: String(props.personnel.id),
    },
  })
}

function onImageError() {
  imageError.value = true
}
</script>

<style scoped>
.personnel-avatar-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.personnel-headshot {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

/* Matches the brush badge on PlayerAvatar in PlayerDetailModal so player,
   coach, and other personnel edit affordances feel identical. */
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
