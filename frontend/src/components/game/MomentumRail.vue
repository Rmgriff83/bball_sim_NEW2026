<template>
  <div class="momentum-rail">
    <div
      class="rail-token rail-token-user"
      :style="{ color: userColor, borderColor: userColor }"
    >{{ userAbbr }}</div>
    <div class="rail-track">
      <div class="rail-fill" :style="fillStyle"></div>
      <div class="rail-center"></div>
    </div>
    <div
      class="rail-token rail-token-opp"
      :style="{ background: oppColor }"
    >{{ oppAbbr }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// Vertical momentum rail — user's team is ALWAYS the top token/fill,
// opponent always the bottom (regardless of home/away). The user fill
// grows downward from the top as their share of total momentum rises.
const props = defineProps({
  userMomentum: { type: Number, default: 50 },
  oppMomentum: { type: Number, default: 50 },
  userColor: { type: String, default: '#6B7280' },
  oppColor: { type: String, default: '#6B7280' },
  userAbbr: { type: String, default: '' },
  oppAbbr: { type: String, default: '' },
})

// Positive = user is hotter, negative = the AI opponent is. Capped at ±60
// (the maximum reachable delta given the engine's hard [20, 80] caps),
// mirroring the old horizontal bar's normalization.
const normalized = computed(() => {
  const delta = props.userMomentum - props.oppMomentum
  return Math.max(-1, Math.min(1, delta / 60))
})

// The track stays neutral; only the momentum DELTA is colored. The fill
// grows from the center — up in green (toward the user's token) when the
// user has the run, down in red when the AI does. Even momentum = empty rail.
const fillStyle = computed(() => {
  const n = normalized.value
  const heightPct = `${(Math.abs(n) * 50).toFixed(1)}%`
  if (n >= 0) {
    return {
      bottom: '50%',
      height: heightPct,
      background: 'linear-gradient(#4ade80, #22c55e)',
    }
  }
  return {
    top: '50%',
    height: heightPct,
    background: 'linear-gradient(#f87171, #ef4444)',
  }
})
</script>

<style scoped>
.momentum-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  width: 50px;
  flex-shrink: 0;
}

.rail-token {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 800;
  flex-shrink: 0;
}

/* User: inverted treatment — white token, team-color text + ring
   (same inversion rule as away logos elsewhere in the game UI). */
.rail-token-user {
  background: #fff;
  border: 2px solid currentColor;
}

/* Opponent: filled with their color. */
.rail-token-opp {
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

.rail-track {
  flex: 1;
  width: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  position: relative;
}

.rail-fill {
  position: absolute;
  left: 0;
  right: 0;
  transition: height 0.8s ease;
}

/* Neutral midpoint marker — the fill grows away from this line. */
.rail-center {
  position: absolute;
  top: 50%;
  left: -1px;
  right: -1px;
  height: 2px;
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.35);
}

@media (max-width: 620px) {
  .momentum-rail {
    width: 40px;
    padding-right: 20px;
  }
}

/* Light mode — the white-alpha track is invisible on the light page; flip the
   track/border/center-line to dark alphas. The colored fill + team tokens
   already read fine on light. */
[data-theme="light"] .rail-track {
  background: rgba(45, 40, 56, 0.1);
  border-color: rgba(45, 40, 56, 0.2);
}

[data-theme="light"] .rail-center {
  background: rgba(45, 40, 56, 0.4);
}
</style>
