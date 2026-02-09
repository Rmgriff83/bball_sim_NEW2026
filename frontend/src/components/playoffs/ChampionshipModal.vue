<script setup>
import { computed } from 'vue'
import { Trophy, Star, Award, Crown } from 'lucide-vue-next'
import BaseModal from '@/components/ui/BaseModal.vue'

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

const playoffRecord = computed(() => {
  // Approximate from finals series
  // In reality, this should track full playoff record
  const winsInFinals = winner.value?.teamId === series.value?.team1?.teamId ? team1Wins.value : team2Wins.value
  const lossesInFinals = winner.value?.teamId === series.value?.team1?.teamId ? team2Wins.value : team1Wins.value

  // Estimate: 3 prior rounds with average 4-1 per round = 12 wins
  // This is a placeholder - ideally track actual playoff record
  return `${12 + winsInFinals}-${3 + lossesInFinals}`
})

const seasonLabel = computed(() => {
  const year = props.year || 2025
  return `${year}-${String(year + 1).slice(-2)} Season`
})

function handleClose() {
  emit('close')
}
</script>

<template>
  <BaseModal :show="show" :closable="false" size="lg">
    <div class="championship-content">
      <!-- Confetti Animation -->
      <div class="confetti-layer">
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
        <div class="trophy-shine" />
      </div>

      <!-- Title -->
      <div class="title-section">
        <Crown :size="32" class="crown-icon" />
        <h1 class="championship-title">NBA CHAMPIONS!</h1>
      </div>

      <!-- Team Name -->
      <div v-if="winner" class="champion-team">
        <span class="team-city">{{ winner.city }}</span>
        <span class="team-name">{{ winner.name }}</span>
        <span class="season-label">{{ seasonLabel }}</span>
      </div>

      <!-- Finals MVP -->
      <div v-if="finalsMVP" class="mvp-section">
        <div class="mvp-badge">
          <Award :size="24" />
          <span>FINALS MVP</span>
        </div>
        <div class="mvp-card">
          <div class="mvp-name">{{ finalsMVP.name }}</div>
          <div class="mvp-stats">
            <div class="stat">
              <span class="stat-value">{{ finalsMVP.ppg }}</span>
              <span class="stat-label">PPG</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ finalsMVP.rpg }}</span>
              <span class="stat-label">RPG</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ finalsMVP.apg }}</span>
              <span class="stat-label">APG</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Playoff Record -->
      <div class="record-section">
        <span class="record-label">Playoff Record</span>
        <span class="record-value">{{ playoffRecord }}</span>
      </div>

      <!-- Championship Count (if applicable) -->
      <div v-if="winner?.championships > 0" class="dynasty-badge">
        <Star :size="16" />
        <span>{{ winner.championships + 1 }}x Champions</span>
      </div>

      <!-- Action Button -->
      <div class="action-buttons">
        <button class="btn-championship" @click="handleClose">
          <Trophy :size="20" />
          Continue to Offseason
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.championship-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 2rem 1rem;
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
}

.trophy-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle, rgba(255, 215, 0, 0.4) 0%, transparent 70%);
  animation: pulse-glow 2s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.1); }
}

.trophy-icon {
  position: relative;
  z-index: 1;
  color: #ffd700;
  filter: drop-shadow(0 0 20px rgba(255, 215, 0, 0.5));
  animation: trophy-bounce 1.5s ease-in-out infinite;
}

@keyframes trophy-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.trophy-shine {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 200%;
  height: 200%;
  transform: translate(-50%, -50%);
  background: conic-gradient(from 0deg, transparent, rgba(255, 255, 255, 0.3), transparent 30%);
  animation: shine-rotate 3s linear infinite;
}

@keyframes shine-rotate {
  from { transform: translate(-50%, -50%) rotate(0deg); }
  to { transform: translate(-50%, -50%) rotate(360deg); }
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

/* Action Button */
.action-buttons {
  margin-top: 1rem;
}

.btn-championship {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 2rem;
  font-size: 1rem;
  font-weight: 700;
  background: linear-gradient(135deg, #ffd700, #ff8c00);
  color: #000;
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.btn-championship:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 30px rgba(255, 215, 0, 0.4);
}
</style>
