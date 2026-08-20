<script setup>
import { ref, computed, watch } from 'vue'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import { useDraftStore } from '@/stores/draft'
import { readableAccent, idealTextOn } from '@/utils/colorContrast'
import { useIsLightTheme } from '@/composables/useTheme'

const props = defineProps({
  campaignId: { type: [String, Number], default: null },
})

const draftStore = useDraftStore()

const pick = computed(() => draftStore.lastPickResult)

// Keep team-color theming readable on both themes (e.g. near-black teams).
const isLightTheme = useIsLightTheme()
const teamAccent = computed(() => readableAccent(pick.value?.teamColor, isLightTheme.value) || 'var(--glass-border)')
const pillText = computed(() => idealTextOn(pick.value?.teamColor || '#666'))

// Full player object (for the headshot) resolved from the pool by id; the pick
// result itself is a slimmed record without headshot fields.
const player = computed(() => {
  const id = pick.value?.playerId
  return id ? (draftStore.allPlayers.find(p => p.id === id) || null) : null
})

// Pick # + round shown in the header label (e.g. "#333 R12").
const slotLabel = computed(() => {
  if (!pick.value) return ''
  const parts = []
  if (pick.value.pick != null) parts.push(`#${pick.value.pick}`)
  return parts.join(' ')
})

// Name-row meta is just the position now (pick/round live in the header).
const metaLine = computed(() => pick.value?.position || '')

// Abbreviate the first name (e.g. "Mikal Bridges" → "M. Bridges") so the name
// stays compact in the narrow Last Pick box.
const displayName = computed(() => {
  const full = (pick.value?.playerName || '').trim()
  if (!full) return ''
  const parts = full.split(/\s+/)
  if (parts.length < 2) return full
  const [first, ...rest] = parts
  return `${first[0]}. ${rest.join(' ')}`
})

// Gentle bump when a new pick lands (not a disappearing popup).
const bump = ref(false)
let bumpTimer = null
watch(() => pick.value?.playerId, (id) => {
  if (!id) return
  bump.value = false
  // next tick re-trigger the animation
  requestAnimationFrame(() => { bump.value = true })
  clearTimeout(bumpTimer)
  bumpTimer = setTimeout(() => { bump.value = false }, 600)
})
</script>

<template>
  <div class="last-pick" :class="{ bump }" :style="{ '--team-color': pick?.teamColor || 'var(--glass-border)', '--team-accent': teamAccent }">
    <div class="lp-label">{{ $t('Last Pick') }}<span v-if="slotLabel" class="lp-slot">: {{ slotLabel }}</span></div>

    <div v-if="pick" class="lp-body">
      <div class="lp-avatar">
        <PlayerAvatar :player="player || { id: pick.playerId }" :size="62" :campaignId="campaignId" />
        <span class="lp-team-pill" :style="{ backgroundColor: pick.teamColor || '#666', color: pillText }">{{ pick.teamAbbr }}</span>
      </div>
      <div class="lp-info">
        <div class="lp-top">
          <span class="lp-name">{{ displayName }}</span>
          <span class="lp-meta">{{ metaLine }}</span>
        </div>
      </div>
    </div>

    <div v-else class="lp-empty">{{ $t('Waiting for the first pick…') }}</div>
  </div>
</template>

<style scoped>
.last-pick {
  flex-shrink: 0;
  padding: 12px 16px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
  border-left: 4px solid var(--team-accent);
  transition: box-shadow 0.3s ease, border-color 0.3s ease;
}

.last-pick.bump {
  animation: lp-bump 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.lp-label {
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  margin-bottom: 6px;
}

.lp-slot {
  color: var(--color-text-secondary);
}

.lp-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
  position: relative;
}

.lp-avatar {
  position: relative;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  border: 2px solid var(--team-accent);
  flex-shrink: 0;
  background: var(--gradient-cosmic);
}

.lp-info {
  min-width: 0;
  flex: 1;
}

.lp-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Team badge overlaid on the avatar's bottom-left corner. */
.lp-team-pill {
  position: absolute;
  bottom: -8px;
  left: -8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 5px;
  border-radius: 999px;
  /* text color set inline (auto black/white for the team fill) */
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1.25;
  /* ring to separate the badge from the avatar/photo */
  border: 1.5px solid var(--color-bg-secondary);
  white-space: nowrap;
}

.lp-name {
  font-size: 0.92rem;
  font-weight: 800;
  color: var(--color-text-primary);
  line-height: 1.1;
  /* Always one line — abbreviate (handled in JS) + ellipsis if still too long. */
  display: block;
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lp-meta {
  font-size: 0.7rem;
  font-weight: 700;
  position: absolute;
  top: 0;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: var(--gradient-cosmic);
  padding: 1px 2px;
  border-radius: 1rem;
  color: black;
}

.lp-empty {
  font-size: 0.82rem;
  color: var(--color-text-tertiary);
}

@keyframes lp-bump {
  0% { box-shadow: 0 0 0 0 transparent; transform: translateY(0); }
  30% {
    box-shadow: inset 0 0 30px color-mix(in srgb, var(--team-accent) 22%, transparent);
    transform: translateY(-1px);
  }
  100% { box-shadow: 0 0 0 0 transparent; transform: translateY(0); }
}
</style>
