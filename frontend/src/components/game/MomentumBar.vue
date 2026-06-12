<template>
  <div class="momentum-bar-container">
    <div class="momentum-bar-title">MOMENTUM</div>
    <div class="momentum-bar-wrap">
      <div class="momentum-bar-label momentum-bar-label-away">
        <TeamLogo :abbreviation="awayAbbr" :color="awayColor" :size="18" inverted />
      </div>
      <div
        class="momentum-bar"
        :class="{ 'is-pulsing': isPulsing }"
        :style="trackStyle"
      >
        <div class="momentum-bar-fill" :style="fillStyle"></div>
        <div class="momentum-bar-center"></div>
      </div>
      <div class="momentum-bar-label momentum-bar-label-home">
        <TeamLogo :abbreviation="homeAbbr" :color="homeColor" :size="18" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import TeamLogo from '@/components/common/TeamLogo.vue'

const props = defineProps({
  homeMomentum: { type: Number, default: 50 },
  awayMomentum: { type: Number, default: 50 },
  homeColor: { type: String, default: '#6B7280' },
  awayColor: { type: String, default: '#6B7280' },
  homeAbbr: { type: String, default: '' },
  awayAbbr: { type: String, default: '' },
})

// Positive delta = home is hotter; negative = away is hotter. Capped at ±60
// (the maximum reachable range given hard caps of [20, 80] on both sides).
const delta = computed(() => props.homeMomentum - props.awayMomentum)

// -1 .. +1 normalized fill position.
const normalized = computed(() => {
  const max = 60
  return Math.max(-1, Math.min(1, delta.value / max))
})

const fillStyle = computed(() => {
  const n = normalized.value
  // Fill grows from the center toward the hotter side.
  const widthPct = Math.abs(n) * 50
  if (n >= 0) {
    return {
      left: '50%',
      width: `${widthPct}%`,
      background: props.homeColor,
    }
  }
  return {
    right: '50%',
    width: `${widthPct}%`,
    background: props.awayColor,
  }
})

const trackStyle = computed(() => ({
  '--home-color': props.homeColor,
  '--away-color': props.awayColor,
}))

// Pulse animation fires briefly when delta jumps ≥ 10 in one update — draws
// the user's eye to a big swing.
const isPulsing = ref(false)
let pulseTimer = null

watch(delta, (next, prev) => {
  if (prev == null) return
  if (Math.abs(next - prev) >= 10) {
    isPulsing.value = true
    if (pulseTimer) clearTimeout(pulseTimer)
    pulseTimer = setTimeout(() => { isPulsing.value = false }, 600)
  }
})
</script>

<style scoped>
.momentum-bar-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 12px 8px;
  width: 100%;
  box-sizing: border-box;
}

.momentum-bar-title {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.4px;
  color: rgba(255, 255, 255, 0.55);
  text-transform: uppercase;
}

.momentum-bar-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
}

.momentum-bar-label {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
}

.momentum-bar-label-away {
  justify-content: flex-end;
}

.momentum-bar-label-home {
  justify-content: flex-start;
}

.momentum-bar {
  position: relative;
  flex: 1;
  height: 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  transition: box-shadow 0.3s ease-out;
}

.momentum-bar.is-pulsing {
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.4);
  animation: momentum-pulse 0.6s ease-out;
}

.momentum-bar-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  transition: width 0.55s ease-out, left 0.55s ease-out, right 0.55s ease-out;
}

.momentum-bar-center {
  position: absolute;
  left: 50%;
  top: -1px;
  bottom: -1px;
  width: 2px;
  background: rgba(255, 255, 255, 0.5);
  transform: translateX(-1px);
}

@keyframes momentum-pulse {
  0%   { transform: scaleY(1); }
  40%  { transform: scaleY(1.6); }
  100% { transform: scaleY(1); }
}
</style>
