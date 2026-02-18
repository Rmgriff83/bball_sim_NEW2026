<script setup>
import { computed } from 'vue'
import { Trophy, Award } from 'lucide-vue-next'
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
  userTeamId: {
    type: [Number, String],
    default: null
  }
})

const emit = defineEmits(['close'])

const series = computed(() => props.seriesResult?.series ?? {})
const winner = computed(() => series.value?.winner ?? null)
const seriesMVP = computed(() => series.value?.seriesMVP ?? null)
const isConferenceFinals = computed(() => props.seriesResult?.isConferenceFinals ?? false)

const userWon = computed(() => {
  if (!winner.value || !props.userTeamId) return false
  return winner.value.teamId == props.userTeamId
})

const team1 = computed(() => series.value?.team1 ?? {})
const team2 = computed(() => series.value?.team2 ?? {})
const team1Wins = computed(() => series.value?.team1Wins ?? 0)
const team2Wins = computed(() => series.value?.team2Wins ?? 0)

const winnerName = computed(() => winner.value?.name ?? 'Unknown')
const loserName = computed(() => {
  if (!winner.value) return 'Unknown'
  return winner.value.teamId === team1.value.teamId ? team2.value.name : team1.value.name
})

const seriesScore = computed(() => {
  if (winner.value?.teamId === team1.value.teamId) {
    return `${team1Wins.value}-${team2Wins.value}`
  }
  return `${team2Wins.value}-${team1Wins.value}`
})

const roundLabel = computed(() => {
  const round = props.seriesResult?.round ?? 1
  switch (round) {
    case 1: return 'First Round'
    case 2: return 'Conference Semifinals'
    case 3: return 'Conference Finals'
    case 4: return 'NBA Finals'
    default: return 'Playoffs'
  }
})

function handleClose() {
  emit('close')
}
</script>

<template>
  <BaseModal :show="show" :title="roundLabel" :closable="true" size="md" @close="handleClose">
    <div class="series-result-content">
      <!-- Result Heading -->
      <h2 class="result-title" :class="{ 'text-gradient': userWon }">
        {{ userWon ? 'SERIES VICTORY!' : 'SERIES COMPLETE' }}
      </h2>

      <!-- Series Summary -->
      <div class="series-summary">
        <div class="team-result winner">
          <span class="team-name">{{ winnerName }}</span>
          <span class="result-text">defeat</span>
          <span class="team-name loser">{{ loserName }}</span>
          <span class="series-score">{{ seriesScore }}</span>
        </div>
      </div>

      <!-- Series MVP (Conference Finals) -->
      <div v-if="isConferenceFinals && seriesMVP" class="mvp-section">
        <div class="mvp-header">
          <Trophy :size="24" />
          <span>CONFERENCE FINALS MVP</span>
        </div>
        <div class="mvp-card">
          <span class="mvp-name">{{ seriesMVP.name }}</span>
          <div class="mvp-stats">
            <span>{{ seriesMVP.ppg }} PPG</span>
            <span>{{ seriesMVP.rpg }} RPG</span>
            <span>{{ seriesMVP.apg }} APG</span>
          </div>
        </div>
      </div>

      <!-- Best Performer (non-conference-finals) -->
      <div v-else-if="seriesMVP" class="performers-section">
        <h3 class="section-title">Series Best Performer</h3>
        <div class="performer-card">
          <Award :size="20" />
          <div class="performer-info">
            <span class="performer-name">{{ seriesMVP.name }}</span>
            <span class="performer-stats">
              {{ seriesMVP.ppg }} PPG | {{ seriesMVP.rpg }} RPG | {{ seriesMVP.apg }} APG
            </span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="modal-btn modal-btn-secondary" @click="handleClose">
        Close
      </button>
      <button class="modal-btn modal-btn-primary" @click="handleClose">
        Continue
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.series-result-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0.5rem 0;
  gap: 1.5rem;
}

.result-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 2rem;
  font-weight: 400;
  letter-spacing: 0.05em;
  margin: 0;
}

.series-summary {
  padding: 0.5rem 0;
}

.team-result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 1.125rem;
}

.team-name {
  font-weight: 700;
  color: var(--color-text-primary);
}

.team-name.loser {
  color: var(--color-text-secondary);
}

.result-text {
  color: var(--color-text-tertiary);
  font-style: italic;
}

.series-score {
  font-weight: 700;
  color: var(--color-primary);
  background: rgba(232, 90, 79, 0.12);
  padding: 0.25rem 0.75rem;
  border-radius: var(--radius-full);
  margin-left: 0.5rem;
}

.mvp-section {
  width: 100%;
  max-width: 320px;
}

.mvp-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: gold;
}

.mvp-card {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 140, 0, 0.1));
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: var(--radius-lg);
  padding: 1rem;
}

.mvp-name {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-primary);
  display: block;
  margin-bottom: 0.5rem;
}

.mvp-stats {
  display: flex;
  justify-content: center;
  gap: 1rem;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.performers-section {
  width: 100%;
  max-width: 320px;
}

.section-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-tertiary);
  margin-bottom: 0.75rem;
}

.performer-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

[data-theme="light"] .performer-card {
  background: rgba(0, 0, 0, 0.04);
}

.performer-card svg {
  color: var(--color-primary);
  flex-shrink: 0;
}

.performer-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
}

.performer-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.performer-stats {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

/* Footer buttons (modal standard) */
.modal-btn {
  flex: 1;
  padding: 12px;
  border-radius: var(--radius-md);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.modal-btn-secondary {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
}

.modal-btn-secondary:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.modal-btn-primary {
  background: var(--color-primary);
  color: white;
}

.modal-btn-primary:hover {
  filter: brightness(1.1);
}
</style>
