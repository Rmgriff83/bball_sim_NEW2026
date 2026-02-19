<script setup>
import { computed, watch, onUnmounted } from 'vue'
import { X, Trophy, Star, Award } from 'lucide-vue-next'

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
  },
  roster: {
    type: Array,
    default: () => []
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
  return conference.value === 'east' ? 'Eastern' : 'Western'
})

// Season Standouts — pts, reb, ast leaders
function getLeader(statKey) {
  const players = props.roster.filter(p => p?.season_stats?.[statKey] > 0)
  if (!players.length) return null
  const best = players.reduce((a, b) =>
    (a.season_stats[statKey] > b.season_stats[statKey]) ? a : b
  )
  return {
    name: best.name || `${best.first_name} ${best.last_name}`,
    value: best.season_stats[statKey],
    position: best.position || best.primary_position || ''
  }
}

const ptsLeader = computed(() => getLeader('ppg'))
const rebLeader = computed(() => getLeader('rpg'))
const astLeader = computed(() => getLeader('apg'))

const hasStandouts = computed(() => ptsLeader.value || rebLeader.value || astLeader.value)

function close() {
  emit('close')
}

function handleContinue() {
  emit('continue')
  emit('close')
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    close()
  }
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
      <div
        v-if="show"
        class="modal-overlay"
        @click.self="close"
      >
        <div class="modal-container">
          <!-- Header -->
          <header class="modal-header">
            <h2 class="modal-title">{{ qualified ? 'Playoff Bound' : 'Season Complete' }}</h2>
            <button
              class="btn-close"
              @click="close"
              aria-label="Close"
            >
              <X :size="20" />
            </button>
          </header>

          <!-- Content -->
          <main class="modal-content">
            <!-- Team Record Card - Cosmic -->
            <div class="record-card card-cosmic">
              <div class="record-card-inner">
                <div
                  class="team-badge"
                  :style="{ backgroundColor: userTeam?.primary_color || '#E85A4F' }"
                >
                  {{ userTeam?.abbreviation }}
                </div>
                <div class="record-info">
                  <span v-if="userTeam" class="team-name-label">{{ userTeam.city }} {{ userTeam.name }}</span>
                  <span class="record-value">{{ record }}</span>
                  <span v-if="qualified" class="seed-info">{{ seedLabel }} seed · {{ conferenceLabel }}</span>
                  <span v-else class="seed-info">Did not qualify</span>
                </div>
              </div>

              <!-- Special Messages -->
              <div v-if="isLegendary" class="special-badge legendary">
                <Star :size="14" />
                <span>LEGENDARY SEASON</span>
                <Star :size="14" />
              </div>
              <div v-else-if="isHistoric" class="special-badge historic">
                <Award :size="14" />
                <span>Historic Season</span>
              </div>
            </div>

            <!-- Season Standouts -->
            <div v-if="hasStandouts" class="standouts-section">
              <h4 class="section-header">SEASON STANDOUTS</h4>
              <div class="standouts-grid">
                <div v-if="ptsLeader" class="standout-card">
                  <span class="standout-label">PTS Leader</span>
                  <span class="standout-value">{{ ptsLeader.value }}</span>
                  <span class="standout-stat-label">PPG</span>
                  <span class="standout-name">{{ ptsLeader.name }}</span>
                  <span class="standout-pos">{{ ptsLeader.position }}</span>
                </div>
                <div v-if="rebLeader" class="standout-card">
                  <span class="standout-label">REB Leader</span>
                  <span class="standout-value">{{ rebLeader.value }}</span>
                  <span class="standout-stat-label">RPG</span>
                  <span class="standout-name">{{ rebLeader.name }}</span>
                  <span class="standout-pos">{{ rebLeader.position }}</span>
                </div>
                <div v-if="astLeader" class="standout-card">
                  <span class="standout-label">AST Leader</span>
                  <span class="standout-value">{{ astLeader.value }}</span>
                  <span class="standout-stat-label">APG</span>
                  <span class="standout-name">{{ astLeader.name }}</span>
                  <span class="standout-pos">{{ astLeader.position }}</span>
                </div>
              </div>
            </div>

            <!-- First Round Opponent -->
            <div v-if="qualified && opponent" class="opponent-section">
              <h4 class="section-header">FIRST ROUND OPPONENT</h4>
              <div class="opponent-card">
                <div
                  class="opponent-badge"
                  :style="{ backgroundColor: opponent.primaryColor || '#6B7280' }"
                >
                  {{ opponent.abbreviation }}
                </div>
                <div class="opponent-info">
                  <span class="opponent-name">{{ opponent.city }} {{ opponent.name }}</span>
                  <span class="opponent-meta">#{{ opponent.seed }} seed · {{ opponent.wins }}-{{ opponent.losses }}</span>
                </div>
              </div>
            </div>

            <!-- Non-qualified message -->
            <p v-if="!qualified" class="eliminated-text">
              Your team finished outside the top 8 in the conference. Better luck next season!
            </p>
          </main>

          <!-- Footer -->
          <footer class="modal-footer">
            <button class="btn-cancel" @click="close">Close</button>
            <button class="btn-confirm" @click="handleContinue">
              <Trophy v-if="qualified" :size="16" class="btn-icon" />
              {{ qualified ? 'Continue to Playoffs' : 'Continue' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
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
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Team Record Card - Cosmic Theme */
.record-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.card-cosmic {
  background: var(--gradient-cosmic);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-xl);
  position: relative;
  overflow: hidden;
}

.card-cosmic::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 10% 20%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 30% 60%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 50% 10%, rgba(255,255,255,0.4), transparent),
    radial-gradient(1px 1px at 70% 40%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 90% 70%, rgba(255,255,255,0.4), transparent);
  pointer-events: none;
}

.record-card-inner {
  display: flex;
  align-items: center;
  gap: 16px;
  position: relative;
  z-index: 1;
  width: 100%;
}

.team-badge {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.8rem;
  font-weight: 700;
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  border: 3px solid rgba(255, 255, 255, 0.3);
}

.record-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.team-name-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: rgba(26, 21, 32, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.record-value {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 2rem;
  font-weight: 700;
  color: #1a1520;
  line-height: 1;
}

.seed-info {
  font-size: 0.85rem;
  font-weight: 500;
  color: rgba(26, 21, 32, 0.6);
}

.special-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-radius: var(--radius-full);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  position: relative;
  z-index: 1;
}

.special-badge.legendary {
  background: linear-gradient(135deg, #ffd700, #ff8c00);
  color: #000;
  animation: glow 1.5s ease-in-out infinite alternate;
}

.special-badge.historic {
  background: rgba(255, 255, 255, 0.3);
  color: #1a1520;
}

@keyframes glow {
  from { box-shadow: 0 0 8px rgba(255, 215, 0, 0.4); }
  to { box-shadow: 0 0 16px rgba(255, 215, 0, 0.7); }
}

/* Season Standouts */
.section-header {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin: 0 0 12px 0;
}

.standouts-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.standout-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 14px 8px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  text-align: center;
}

.standout-label {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-primary);
}

.standout-value {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.standout-stat-label {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
}

.standout-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.standout-pos {
  font-size: 0.6rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}

/* Opponent Section */
.opponent-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.opponent-badge {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  border: 2px solid var(--glass-border);
}

.opponent-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.opponent-name {
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.opponent-meta {
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
}

.eliminated-text {
  text-align: center;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.6;
  margin: 0;
}

/* Footer */
.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-cancel,
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
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.btn-cancel:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

.btn-confirm {
  background: var(--color-primary);
  border: none;
  color: white;
}

.btn-confirm:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
}

.btn-icon {
  fill: currentColor;
}

/* Modal transition */
@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

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

@keyframes scaleOut {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}
</style>
