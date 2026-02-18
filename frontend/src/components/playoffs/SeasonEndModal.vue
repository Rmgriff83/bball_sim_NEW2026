<script setup>
import { computed } from 'vue'
import { Trophy, CloudRain, Star, Award } from 'lucide-vue-next'
import BaseModal from '@/components/ui/BaseModal.vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  userStatus: {
    type: Object,
    default: () => ({})
  },
  userTeam: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['close', 'continue'])

const qualified = computed(() => props.userStatus?.qualified ?? false)
const seed = computed(() => props.userStatus?.seed ?? null)
const wins = computed(() => props.userStatus?.wins ?? 0)
const losses = computed(() => props.userStatus?.losses ?? 0)
const conference = computed(() => props.userStatus?.conference ?? '')
const opponent = computed(() => props.userStatus?.opponent ?? null)

const record = computed(() => `${wins.value}-${losses.value}`)

const isHistoric = computed(() => wins.value >= 60)
const isLegendary = computed(() => wins.value >= 70)

const seedLabel = computed(() => {
  if (!seed.value) return ''
  const suffix = seed.value === 1 ? 'st' : seed.value === 2 ? 'nd' : seed.value === 3 ? 'rd' : 'th'
  return `${seed.value}${suffix}`
})

const conferenceLabel = computed(() => {
  return conference.value === 'east' ? 'Eastern Conference' : 'Western Conference'
})

function handleContinue() {
  emit('continue')
  emit('close')
}
</script>

<template>
  <BaseModal :show="show" :title="qualified ? 'Playoff Bound!' : 'Season Complete'" @close="emit('close')" size="md">
    <div class="season-end-content">
      <!-- Animation Area -->
      <div class="animation-area">
        <div v-if="qualified" class="celebration-animation">
          <Trophy :size="64" class="trophy-icon" />
          <div class="confetti-container">
            <div v-for="i in 20" :key="i" class="confetti" :style="{ '--delay': `${i * 0.1}s`, '--x': `${Math.random() * 100}%` }" />
          </div>
        </div>
        <div v-else class="elimination-animation">
          <CloudRain :size="64" class="rain-icon" />
        </div>
      </div>

      <!-- Team Info -->
      <div v-if="userTeam" class="team-info">
        <span class="team-name">{{ userTeam.city }} {{ userTeam.name }}</span>
      </div>

      <!-- Record -->
      <div class="record-display">
        <span class="record-label">Your Record</span>
        <span class="record-value">{{ record }}</span>
        <span v-if="qualified" class="seed-info">({{ seedLabel }} in {{ conferenceLabel }})</span>
      </div>

      <!-- Special Messages -->
      <div v-if="isLegendary" class="special-message legendary">
        <Star :size="20" />
        <span>LEGENDARY SEASON!</span>
        <Star :size="20" />
      </div>
      <div v-else-if="isHistoric" class="special-message historic">
        <Award :size="20" />
        <span>Historic Season!</span>
      </div>

      <!-- Opponent Info -->
      <div v-if="qualified && opponent" class="opponent-section">
        <span class="opponent-label">First Round Opponent</span>
        <div class="opponent-card">
          <span class="opponent-seed">#{{ opponent.seed }}</span>
          <span class="opponent-name">{{ opponent.name }}</span>
          <span class="opponent-record">({{ opponent.wins }}-{{ opponent.losses }})</span>
        </div>
      </div>

      <!-- Non-qualified message -->
      <div v-if="!qualified" class="eliminated-message">
        <p>Your team finished outside the top 8 in the conference.</p>
        <p>Better luck next season!</p>
      </div>
    </div>

    <template #footer>
      <div class="modal-footer-buttons">
        <button class="btn-cancel" @click="emit('close')">Close</button>
        <button class="btn-confirm" @click="handleContinue">
          <Trophy v-if="qualified" :size="16" />
          {{ qualified ? 'Continue to Playoffs' : 'Continue to Offseason' }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.season-end-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1rem;
  gap: 1.5rem;
}

.animation-area {
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  width: 100%;
}

.celebration-animation {
  position: relative;
}

.trophy-icon {
  color: var(--color-primary);
  animation: bounce 1s ease-in-out infinite;
}

.rain-icon {
  color: var(--color-text-tertiary);
  animation: sway 2s ease-in-out infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

@keyframes sway {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(5px); }
}

.confetti-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.confetti {
  position: absolute;
  width: 8px;
  height: 8px;
  background: var(--color-primary);
  left: var(--x);
  top: -10px;
  animation: confetti-fall 2s ease-in-out infinite;
  animation-delay: var(--delay);
  opacity: 0;
}

.confetti:nth-child(odd) {
  background: var(--color-secondary, gold);
}

.confetti:nth-child(3n) {
  background: var(--color-accent, #ff6b6b);
}

@keyframes confetti-fall {
  0% {
    transform: translateY(0) rotate(0deg);
    opacity: 1;
  }
  100% {
    transform: translateY(120px) rotate(360deg);
    opacity: 0;
  }
}

/* Footer Buttons */
.modal-footer-buttons {
  display: flex;
  gap: 12px;
}

.btn-cancel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
}

.btn-cancel:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}

.btn-confirm {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--radius-xl);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--color-primary);
  border: none;
  color: white;
}

.btn-confirm:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.team-info {
  opacity: 0.8;
}

.team-name {
  font-size: 1.25rem;
  font-weight: 600;
}

.record-display {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.record-label {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.record-value {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.seed-info {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.special-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-full);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.special-message.legendary {
  background: linear-gradient(135deg, #ffd700, #ff8c00);
  color: #000;
  animation: glow 1.5s ease-in-out infinite alternate;
}

.special-message.historic {
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  color: white;
}

@keyframes glow {
  from { box-shadow: 0 0 10px rgba(255, 215, 0, 0.5); }
  to { box-shadow: 0 0 20px rgba(255, 215, 0, 0.8); }
}

.opponent-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 280px;
}

.opponent-label {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.opponent-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.opponent-seed {
  font-weight: 700;
  color: var(--color-text-secondary);
}

.opponent-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.opponent-record {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
}

.eliminated-message {
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.eliminated-message p {
  margin: 0;
}

</style>
