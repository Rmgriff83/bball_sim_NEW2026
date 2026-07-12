<template>
  <div class="coach-overview">
    <!-- Row 1 — the strip. Coach + scheme chips always visible; the
         contextual area is buttons-only (the stoppage reason lives in the
         centered canvas bubble, not here). Coach name yields during breaks
         so everything fits the canvas width. -->
    <div class="co-strip">
      <div class="co-avatar" :style="{ borderColor: teamColor }">
        <CoachAvatar :coach="coach" :size="20" :campaign-id="campaignId" />
      </div>

      <span v-if="!isStoppage" class="co-coach-name">{{ coachLastName }}</span>
      <span class="co-chip co-chip-offense">
        <span class="co-chip-label">OFF</span>{{ offenseLabel }}
      </span>
      <span class="co-chip co-chip-defense">
        <span class="co-chip-label">DEF</span>{{ defenseLabel }}
      </span>
      <span class="co-spacer"></span>

      <button
        class="co-timeout-btn"
        :class="{ 'is-ready': timeoutReady && !timeoutArmed, 'is-armed': timeoutArmed }"
        :disabled="!timeoutReady && !timeoutArmed"
        :title="timeoutTitle"
        @click="emit('toggle-timeout')"
      >
        <Check v-if="timeoutArmed" :size="11" />
        <span>TO · {{ timeoutsRemaining }}</span>
      </button>

      <div v-if="isStoppage" class="co-break-actions">
        <button v-if="allowSubs" class="co-action-btn" @click="emit('open-subs')">Subs</button>
        <button v-if="allowSubs" class="co-action-btn" @click="emit('open-adjust')">Adjust</button>
        <button class="co-action-btn co-action-continue" :disabled="simulating" @click="emit('continue')">
          <span v-if="simulating" class="co-btn-loading"></span>
          <span v-else>Continue ▸</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import CoachAvatar from '@/components/common/CoachAvatar.vue'

// The live-game "Coach Overview" strip: sits INSIDE the court container,
// spanning only the canvas width — the exact slot the old animation-controls
// bar occupied. One thin contextual row (live ⇄ break states); per-player
// fatigue lives in the live stat cards beside the court, not here. Purely
// presentational — all state lives in GameView, which passes props and
// reacts to the emits.
const props = defineProps({
  coach: { type: Object, default: null },
  campaignId: { type: [String, Number], default: null },
  teamCity: { type: String, default: '' },
  teamName: { type: String, default: '' },
  teamColor: { type: String, default: '#6B7280' },
  offenseLabel: { type: String, default: '—' },
  defenseLabel: { type: String, default: '—' },
  isStoppage: { type: Boolean, default: false },
  timeoutsRemaining: { type: Number, default: 0 },
  timeoutArmed: { type: Boolean, default: false },
  allowTimeout: { type: Boolean, default: false },
  allowSubs: { type: Boolean, default: false },
  simulating: { type: Boolean, default: false },
})

const emit = defineEmits(['continue', 'toggle-timeout', 'open-subs', 'open-adjust'])

const coachLastName = computed(() => {
  const parts = String(props.coach?.name || 'Coach').trim().split(/\s+/)
  return parts[parts.length - 1]
})

// Timeouts can only be taken on dead balls; the pill dims while live.
const timeoutReady = computed(() => props.isStoppage && props.allowTimeout)

const timeoutTitle = computed(() => {
  if (props.timeoutArmed) return 'Timeout armed — applies on continue. Tap to cancel.'
  if (timeoutReady.value) return 'Call a timeout'
  return 'Timeouts can only be called at dead balls'
})
</script>

<style scoped>
.coach-overview {
  width: 100%;
  max-width: 500px;
  border-radius: 10px;
  background: rgba(20, 22, 31, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.07);
  padding: 6px 8px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
}

/* ---- Row 1: contextual strip ---- */
.co-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px; /* pins the row so the live ⇄ break swap doesn't shift the court */
  min-width: 0;
}

.co-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid;
  background: #1a1f2c;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  color: #5a6478; /* UserCog fallback icon tint */
}

.co-coach-name {
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
}

.co-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 9px;
  font-weight: 800;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Chips are always visible — let them give ground to the break
     actions rather than overflowing the canvas width. */
  flex-shrink: 1;
  min-width: 0;
}

.co-chip-label {
  font-size: 7.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.co-chip-offense {
  background: rgba(239, 106, 79, 0.14);
  border: 1px solid rgba(239, 106, 79, 0.4);
}

.co-chip-offense .co-chip-label { color: #f0896f; }

.co-chip-defense {
  background: rgba(47, 128, 237, 0.13);
  border: 1px solid rgba(47, 128, 237, 0.4);
}

.co-chip-defense .co-chip-label { color: #6ba5f5; }

.co-spacer {
  flex: 1;
}

.co-timeout-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 800;
  cursor: pointer;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  color: #565b6b;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

.co-timeout-btn:disabled {
  cursor: default;
}

.co-timeout-btn.is-ready {
  background: #ef6a4f;
  border-color: transparent;
  color: #fff;
  box-shadow: 0 4px 12px -4px rgba(239, 106, 79, 0.7);
}

.co-timeout-btn.is-armed {
  background: #d4502f;
  border-color: rgba(255, 255, 255, 0.35);
  color: #fff;
  box-shadow: 0 4px 14px -3px rgba(239, 106, 79, 0.95);
}

.co-break-actions {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
}

.co-action-btn {
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: #e6e9f0;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease;
}

.co-action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.co-action-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.co-action-continue {
  background: #ef6a4f;
  border-color: transparent;
  color: #fff;
}

.co-action-continue:hover:not(:disabled) {
  background: #f4795f;
}

.co-btn-loading {
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: co-spin 0.7s linear infinite;
  vertical-align: middle;
}

@keyframes co-spin {
  to { transform: rotate(360deg); }
}
</style>
