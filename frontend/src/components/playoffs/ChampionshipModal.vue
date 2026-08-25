<script setup>
import { computed, watch, onUnmounted } from 'vue'
import { Trophy, Star, Award, Crown, X } from 'lucide-vue-next'
import TeamLogo from '@/components/common/TeamLogo.vue'
import { t } from '@wl-i18n/i18n.js'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  seriesResult: {
    type: Object,
    default: () => ({})
  },
  year: {
    type: [Number, String],
    default: 2025
  },
  userTeamId: {
    type: [Number, String],
    default: null
  }
})

const emit = defineEmits(['close'])

const series = computed(() => props.seriesResult?.series ?? {})
const winner = computed(() => series.value?.winner ?? null)
const finalsMVP = computed(() => series.value?.seriesMVP ?? null)

const userWon = computed(() => {
  if (!winner.value || !props.userTeamId) return false
  return winner.value.teamId == props.userTeamId
})

const team1Wins = computed(() => series.value?.team1Wins ?? 0)
const team2Wins = computed(() => series.value?.team2Wins ?? 0)

const runnerUp = computed(() => {
  const s = series.value
  if (!s?.team1 || !s?.team2 || !winner.value) return null
  return winner.value.teamId === s.team1.teamId ? s.team2 : s.team1
})

// Real finals outcome, winner's wins first (e.g. "4-2").
const seriesScore = computed(() => {
  const a = team1Wins.value
  const b = team2Wins.value
  return `${Math.max(a, b)}-${Math.min(a, b)}`
})

const outcomeLine = computed(() => {
  if (!winner.value || !runnerUp.value) return ''
  const w = `${winner.value.city} ${winner.value.name}`
  const r = `${runnerUp.value.city} ${runnerUp.value.name}`
  return userWon.value
    ? t('Your {w} defeated the {r} {score} to claim the title.', { w, r, score: seriesScore.value })
    : t('The {w} defeat the {r} {score} for the title.', { w, r, score: seriesScore.value })
})

const seasonLabel = computed(() => {
  const year = props.year || 2025
  return t('{years} Season', { years: `${year}-${String(year + 1).slice(-2)}` })
})

function handleClose() {
  emit('close')
}

// Standard modal-shell behavior (SimulateConfirmModal pattern): lock body
// scroll while open, Escape closes.
function handleKeydown(e) {
  if (e.key === 'Escape') handleClose()
}

watch(() => props.show, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="handleClose">
        <div class="modal-container">
          <!-- Header -->
          <header class="modal-header">
            <h2 class="modal-title">{{ $t('Championship') }}</h2>
            <button class="btn-close" aria-label="Close" @click="handleClose">
              <X :size="20" />
            </button>
          </header>

          <!-- Content -->
          <main class="modal-content">
            <div class="championship-content">
      <!-- Confetti Animation — only when the USER won the title; an AI
           champion shouldn't look like the user's celebration -->
      <div v-if="userWon" class="confetti-layer">
        <div v-for="i in 50" :key="i" class="confetti-piece" :style="{
          '--delay': `${Math.random() * 3}s`,
          '--x': `${Math.random() * 100}%`,
          '--rotation': `${Math.random() * 360}deg`,
          '--size': `${6 + Math.random() * 8}px`
        }" />
      </div>

      <!-- Trophy Animation -->
      <div class="trophy-section">
        <div class="trophy-glow" />
        <Trophy :size="80" class="trophy-icon" />
      </div>

      <!-- Title -->
      <div class="title-section">
        <Crown :size="32" class="crown-icon" />
        <h1 class="championship-title">{{ userWon ? $t("YOU'RE THE CHAMPIONS!") : $t('LEAGUE CHAMPIONS!') }}</h1>
      </div>

      <!-- Team Name -->
      <div v-if="winner" class="champion-team">
        <div class="champion-team-identity">
          <TeamLogo
            :abbreviation="winner.abbreviation"
            :color="winner.primaryColor"
            :size="44"
            class="champion-team-logo"
          />
          <div class="champion-team-names">
            <span class="team-city">{{ winner.city }}</span>
            <span class="team-name">{{ winner.name }}</span>
          </div>
        </div>
        <span class="season-label">{{ seasonLabel }}</span>
      </div>

      <!-- Series outcome -->
      <p v-if="outcomeLine" class="outcome-line">{{ outcomeLine }}</p>

      <!-- Finals MVP -->
      <div v-if="finalsMVP" class="mvp-section">
        <div class="mvp-badge">
          <Award :size="24" />
          <span>{{ $t('FINALS MVP') }}</span>
        </div>
        <div class="mvp-card">
          <div class="mvp-name">{{ finalsMVP.name }}</div>
          <div class="mvp-stats">
            <div class="stat">
              <span class="stat-value">{{ finalsMVP.ppg }}</span>
              <!-- i18n-ignore -->
              <span class="stat-label">PPG</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ finalsMVP.rpg }}</span>
              <!-- i18n-ignore -->
              <span class="stat-label">RPG</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ finalsMVP.apg }}</span>
              <!-- i18n-ignore -->
              <span class="stat-label">APG</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Finals result -->
      <div class="record-section">
        <span class="record-label">{{ $t('Finals Result') }}</span>
        <span class="record-value">{{ seriesScore }}<template v-if="runnerUp"> vs {{ runnerUp.abbreviation ?? runnerUp.name }}</template></span>
      </div>

      <!-- Championship Count (if applicable) -->
      <div v-if="winner?.championships > 0" class="dynasty-badge">
        <Star :size="16" />
        <span>{{ $t('{n}x Champions', { n: winner.championships + 1 }) }}</span>
      </div>
            </div>
          </main>

          <!-- Footer -->
          <footer class="modal-footer">
            <button class="btn-championship" @click="handleClose">
              <Trophy :size="18" />
              <span>{{ $t('Continue') }}</span>
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Global modal shell — mirrors SimulateConfirmModal (the app's popup-modal
   design standard): dimmed blurred overlay, glass container, Bebas header
   with X close, scrollable content, bordered footer. */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.modal-container {
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.btn-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

/* Modal transition (standard scale-in/out) */
.modal-enter-active {
  transition: opacity 0.3s cubic-bezier(0, 0, 0.2, 1);
}
.modal-leave-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 1, 1);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-active .modal-container {
  animation: scaleIn 0.3s cubic-bezier(0, 0, 0.2, 1);
}
.modal-leave-active .modal-container {
  animation: scaleOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes scaleOut {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.95); }
}

@media (max-width: 480px) {
  .modal-container {
    max-height: 85vh;
  }
}

.championship-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0.5rem 0;
  gap: 1.5rem;
  position: relative;
  overflow: hidden;
}

/* Confetti */
.confetti-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
}

.confetti-piece {
  position: absolute;
  width: var(--size);
  height: var(--size);
  left: var(--x);
  top: -20px;
  animation: confetti-fall 4s ease-out infinite;
  animation-delay: var(--delay);
  transform: rotate(var(--rotation));
}

.confetti-piece:nth-child(5n + 1) { background: #ffd700; }
.confetti-piece:nth-child(5n + 2) { background: #ff6b6b; }
.confetti-piece:nth-child(5n + 3) { background: #4ecdc4; }
.confetti-piece:nth-child(5n + 4) { background: #a855f7; }
.confetti-piece:nth-child(5n + 5) { background: #f97316; }

@keyframes confetti-fall {
  0% {
    transform: translateY(0) rotate(0deg);
    opacity: 1;
  }
  100% {
    transform: translateY(500px) rotate(720deg);
    opacity: 0;
  }
}

/* Trophy */
.trophy-section {
  position: relative;
  padding: 2rem;
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.trophy-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle, rgba(255, 215, 0, 0.4) 0%, transparent 70%);
  animation: pulse-glow 2s ease-in-out infinite;
  pointer-events: none;
}

@keyframes pulse-glow {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.1); }
}

.trophy-icon {
  position: relative;
  z-index: 2;
  color: #ffd700;
  filter: drop-shadow(0 0 20px rgba(255, 215, 0, 0.5));
  animation: trophy-bounce 1.5s ease-in-out infinite;
}

@keyframes trophy-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

/* Title */
.title-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.crown-icon {
  color: #ffd700;
  animation: crown-float 2s ease-in-out infinite;
}

@keyframes crown-float {
  0%, 100% { transform: translateY(0) rotate(-5deg); }
  50% { transform: translateY(-5px) rotate(5deg); }
}

.championship-title {
  font-size: 2.5rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  background: linear-gradient(135deg, #ffd700, #ff8c00, #ffd700);
  background-size: 200% 200%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: gradient-shift 2s ease-in-out infinite;
}

@keyframes gradient-shift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

/* Champion Team */
.champion-team {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.champion-team-identity {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.champion-team-logo {
  flex-shrink: 0;
}

.champion-team-names {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: flex-start;
  text-align: left;
}

.team-city {
  font-size: 1rem;
  color: var(--color-text-secondary);
  font-weight: 500;
}

.team-name {
  font-size: 1.75rem;
  font-weight: 800;
  color: var(--color-text-primary);
}

.season-label {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
}

.outcome-line {
  max-width: 340px;
  margin: 0.35rem 0 1rem;
  font-size: 0.85rem;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

/* Finals MVP */
.mvp-section {
  width: 100%;
  max-width: 320px;
}

.mvp-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #ffd700;
}

.mvp-card {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 140, 0, 0.15));
  border: 2px solid rgba(255, 215, 0, 0.4);
  border-radius: var(--radius-xl);
  padding: 1.25rem;
  box-shadow: 0 0 30px rgba(255, 215, 0, 0.2);
}

.mvp-name {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 0.75rem;
}

.mvp-stats {
  display: flex;
  justify-content: center;
  gap: 2rem;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}

/* Record */
.record-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.record-label {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.record-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text-secondary);
}

/* Dynasty Badge */
.dynasty-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(139, 92, 246, 0.15));
  border: 1px solid rgba(168, 85, 247, 0.3);
  border-radius: var(--radius-full);
  font-size: 0.875rem;
  font-weight: 600;
  color: #a855f7;
}

.dynasty-badge svg {
  color: #ffd700;
}

/* Footer action button — matches the modal-design standard (flex:1, uppercase,
   0.85rem, font-weight 600) but keeps the championship gold gradient since the
   modal is a victory celebration. */
.btn-championship {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 12px 20px;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: linear-gradient(135deg, #ffd700, #ff8c00);
  color: #000;
  border: none;
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.btn-championship:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 30px rgba(255, 215, 0, 0.4);
}
</style>
