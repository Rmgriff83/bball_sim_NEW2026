<script setup>
// Banner Night — shown once at the start of the season AFTER a championship
// win (chained after the owner check-in + rookie-class setup). A ceremony
// moment: confetti, a big gold championship pennant raising into place, and a
// single "Raise the Banner" action. Closing hands off to CampaignHomeView,
// which flies the matching mini banner into the record card.
import { computed } from 'vue'
import { Trophy } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  teamName: { type: String, default: '' },
  // Season START year of the championship season (seasonHistory.year) —
  // a 2027 title is the 2027-28 season.
  championshipYear: { type: Number, default: null },
  // Which banner this is for the franchise (1 = first title).
  titleCount: { type: Number, default: 1 },
})

const emit = defineEmits(['close'])

const seasonLabel = computed(() => {
  const y = props.championshipYear
  if (y == null) return ''
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
})

// Light confetti layer (same pattern as ChampionshipModal, fewer pieces).
const CONFETTI_COLORS = ['#ffd700', '#ff6b6b', '#4ecdc4', '#a855f7', '#f97316']
const confetti = Array.from({ length: 24 }, (_, i) => ({
  left: `${(i * 41) % 100}%`,
  delay: `${(i % 8) * 0.35}s`,
  duration: `${2.6 + (i % 5) * 0.5}s`,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
}))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="emit('close')">
        <div class="modal-container">
          <div class="bcm-confetti" aria-hidden="true">
            <span
              v-for="(c, i) in confetti"
              :key="i"
              class="bcm-confetti-piece"
              :style="{ left: c.left, animationDelay: c.delay, animationDuration: c.duration, background: c.color }"
            />
          </div>

          <header>
            <h2 class="bcm-title">Banner Night</h2>
          </header>

          <main>
            <p class="bcm-intro">
              The lights dim. The crowd rises. Tonight, a new banner joins the
              rafters.
            </p>

            <div class="bcm-banner-wrap">
              <div class="bcm-glow" aria-hidden="true"></div>
              <!-- Rafter line the banner hangs from -->
              <div class="bcm-rafter" aria-hidden="true"></div>
              <div class="bcm-banner">
                <span class="bcm-banner-team">{{ teamName }}</span>
                <Trophy :size="34" class="bcm-banner-trophy" />
                <span class="bcm-banner-champs">League<br />Champions</span>
                <span class="bcm-banner-season">{{ seasonLabel }}</span>
              </div>
            </div>

            <p v-if="titleCount > 1" class="bcm-dynasty">
              Banner #{{ titleCount }} — a dynasty grows.
            </p>
          </main>

          <footer>
            <button class="bcm-raise-btn" @click="emit('close')">
              <Trophy :size="15" /> Raise the Banner
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.25s ease;
}
.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-container {
  position: relative;
  background: var(--color-bg-primary, #1a1520);
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: var(--radius-xl);
  width: 100%;
  max-width: 400px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Confetti */
.bcm-confetti {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}
.bcm-confetti-piece {
  position: absolute;
  top: -10px;
  width: 7px;
  height: 11px;
  border-radius: 2px;
  opacity: 0.85;
  animation: bcm-confetti-fall linear infinite;
}
@keyframes bcm-confetti-fall {
  0% { transform: translateY(-12px) rotate(0deg); }
  100% { transform: translateY(560px) rotate(540deg); }
}

header {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
  padding: 20px 24px 4px;
}

.bcm-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.7rem;
  font-weight: 400;
  letter-spacing: 0.08em;
  background: linear-gradient(90deg, #ffd700, #ff8c00, #ffd700);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: bcm-gradient-shift 3s linear infinite;
}
@keyframes bcm-gradient-shift {
  to { background-position: 200% center; }
}

main {
  position: relative;
  z-index: 1;
  flex: 1;
  overflow-y: auto;
  padding: 8px 24px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.bcm-intro {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  text-align: center;
  line-height: 1.45;
  margin-bottom: 14px;
}

.bcm-banner-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
  margin-bottom: 10px;
}

.bcm-glow {
  position: absolute;
  inset: -20px;
  background: radial-gradient(circle at 50% 40%, rgba(255, 215, 0, 0.22), transparent 65%);
  animation: bcm-pulse-glow 2.4s ease-in-out infinite;
  pointer-events: none;
}
@keyframes bcm-pulse-glow {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

.bcm-rafter {
  width: 200px;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0.08));
}

/* The big pennant: raises up into place on open. */
.bcm-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 172px;
  padding: 18px 14px 34px;
  background: linear-gradient(180deg, #ffd700, #ff8c00);
  clip-path: polygon(0 0, 100% 0, 100% 84%, 50% 100%, 0 84%);
  box-shadow: 0 8px 24px rgba(255, 170, 0, 0.35);
  transform-origin: top center;
  animation: bcm-banner-raise 1.4s cubic-bezier(0.22, 0.9, 0.3, 1) both;
}
@keyframes bcm-banner-raise {
  0% { transform: translateY(46px) scale(0.92); opacity: 0; }
  55% { transform: translateY(-4px) scale(1.01); opacity: 1; }
  75% { transform: translateY(0) rotate(1.5deg); }
  100% { transform: translateY(0) rotate(0); }
}

.bcm-banner-team {
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #1a1520;
  text-align: center;
  line-height: 1.2;
}

.bcm-banner-trophy {
  color: #1a1520;
}

.bcm-banner-champs {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.35rem;
  line-height: 1.02;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #1a1520;
  text-align: center;
}

.bcm-banner-season {
  font-family: var(--font-mono, monospace);
  font-size: 0.9rem;
  font-weight: 800;
  color: rgba(26, 21, 32, 0.8);
}

.bcm-dynasty {
  font-size: 0.75rem;
  font-weight: 700;
  color: #c2a2ff;
  margin-bottom: 4px;
}

footer {
  position: relative;
  z-index: 1;
  padding: 14px 24px 20px;
}

.bcm-raise-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 13px;
  background: linear-gradient(90deg, #ffd700, #ff8c00);
  border: none;
  border-radius: var(--radius-lg);
  color: #1a1520;
  font-size: 0.85rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.15s ease;
}
.bcm-raise-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(255, 180, 0, 0.4);
}
</style>
