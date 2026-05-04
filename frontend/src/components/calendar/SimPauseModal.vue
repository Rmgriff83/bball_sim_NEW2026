<script setup>
import { computed, watch, onUnmounted } from 'vue'
import { X, AlertTriangle, Calendar, Star, Zap, Users, Pause, Play } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  // 'trade_deadline' | 'all_star' | 'user_injury'
  reason: { type: String, default: '' },
  // Shape varies by reason — see useGameStore.simulateToGame for what each variant carries.
  payload: { type: Object, default: () => ({}) },
})

const emit = defineEmits([
  'close',           // X / overlay click → cancel sim
  'continue',        // Continue Sim → resume the run
  'pause',           // Pause Sim → cancel the run, leave campaign at current date
  'view-all-star',   // All-Star variant: open AllStarModal then resume
  'cpu-set-lineup',  // Injury variant: let CPU pick starters, then resume
  'go-to-lineup',    // Injury variant: navigate to lineup editor (cancels run)
])

const titleByReason = {
  trade_deadline: 'Trade Deadline Tomorrow',
  all_star: 'All-Star Selections',
  user_injury: 'Player Injured',
}
const title = computed(() => titleByReason[props.reason] || 'Simulation Paused')

const injuries = computed(() => Array.isArray(props.payload?.injuries) ? props.payload.injuries : [])
const allStarRosters = computed(() => props.payload?.allStarRosters || null)

function severityColor(severity) {
  switch (severity) {
    case 'minor': return '#fbbf24'
    case 'moderate': return '#fb923c'
    case 'severe': return '#ef4444'
    case 'season_ending': return '#ef4444'
    default: return '#fbbf24'
  }
}

function close() { emit('close') }
function continueSim() { emit('continue') }
function pauseSim() { emit('pause') }
function viewAllStar() { emit('view-all-star') }
function cpuSetLineup() { emit('cpu-set-lineup') }
function goToLineup() { emit('go-to-lineup') }

function handleKeydown(e) {
  if (e.key === 'Escape') close()
}
watch(() => props.show, (open) => {
  if (open) {
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
      <div v-if="show" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <!-- Header -->
          <header class="modal-header">
            <div class="header-left">
              <div class="header-icon" :class="`icon-${reason}`">
                <AlertTriangle v-if="reason === 'user_injury'" :size="18" />
                <Star v-else-if="reason === 'all_star'" :size="18" />
                <Calendar v-else :size="18" />
              </div>
              <h2 class="modal-title">{{ title }}</h2>
            </div>
            <button class="btn-close" @click="close" aria-label="Close">
              <X :size="20" />
            </button>
          </header>

          <!-- Content -->
          <main class="modal-content">
            <!-- Trade Deadline variant -->
            <template v-if="reason === 'trade_deadline'">
              <p class="body-text">
                The <strong>trade deadline</strong> closes tomorrow. After it passes, no
                more trades can be proposed for the rest of the season.
              </p>
              <p class="body-text">
                The <strong>re-signing deadline</strong> also closes tomorrow — any
                player on the final year of their contract must be re-signed before then,
                or they'll hit free agency at season end.
              </p>
              <p class="body-hint">Pause now to make trades or re-sign players, or continue simming and skip the deadline.</p>
            </template>

            <!-- All-Star variant -->
            <template v-else-if="reason === 'all_star'">
              <p class="body-text">All-Star rosters have been announced.</p>
              <div v-if="allStarRosters" class="all-star-summary">
                <div v-if="Array.isArray(allStarRosters?.east?.starters) || Array.isArray(allStarRosters?.east?.reserves)" class="conf-summary">
                  <span class="conf-label">East</span>
                  <span class="conf-count">{{ (allStarRosters.east.starters?.length || 0) + (allStarRosters.east.reserves?.length || 0) }} selections</span>
                </div>
                <div v-if="Array.isArray(allStarRosters?.west?.starters) || Array.isArray(allStarRosters?.west?.reserves)" class="conf-summary">
                  <span class="conf-label">West</span>
                  <span class="conf-count">{{ (allStarRosters.west.starters?.length || 0) + (allStarRosters.west.reserves?.length || 0) }} selections</span>
                </div>
              </div>
              <p class="body-hint">View the full rosters before continuing the simulation.</p>
            </template>

            <!-- User Injury variant -->
            <template v-else-if="reason === 'user_injury'">
              <p class="body-text">
                <template v-if="injuries.length === 1">A player on your team was injured during the last game.</template>
                <template v-else>{{ injuries.length }} players on your team were injured during the last game.</template>
              </p>
              <div class="inj-list">
                <div
                  v-for="injury in injuries"
                  :key="injury.player_id"
                  class="inj-card"
                  :style="{ '--severity-color': severityColor(injury.severity) }"
                >
                  <div class="inj-severity-bar"></div>
                  <div class="inj-card-body">
                    <div class="inj-player-row">
                      <span class="inj-player-name">{{ injury.name }}</span>
                      <span class="inj-severity-tag">{{ injury.severity }}</span>
                    </div>
                    <div class="inj-detail-row">
                      <span class="inj-type">{{ injury.injury_type }}</span>
                      <span class="inj-duration">{{ injury.games_out }} {{ injury.games_out === 1 ? 'game' : 'games' }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <p class="body-hint">Choose how to handle your lineup before the simulation continues.</p>
            </template>
          </main>

          <!-- Footer -->
          <footer class="modal-footer">
            <!-- Trade Deadline footer -->
            <template v-if="reason === 'trade_deadline'">
              <button class="btn-cancel" @click="pauseSim">
                <Pause :size="14" />
                Pause Sim
              </button>
              <button class="btn-confirm" @click="continueSim">
                <Play :size="14" fill="currentColor" />
                Continue Sim
              </button>
            </template>

            <!-- All-Star footer -->
            <template v-else-if="reason === 'all_star'">
              <button class="btn-cancel" @click="continueSim">
                Continue Sim
              </button>
              <button class="btn-confirm" @click="viewAllStar">
                <Star :size="14" />
                View All-Stars
              </button>
            </template>

            <!-- Injury footer -->
            <template v-else-if="reason === 'user_injury'">
              <button class="btn-cancel injury-pause" @click="pauseSim">
                <Pause :size="14" />
                Pause Sim
              </button>
              <button class="btn-cpu" @click="cpuSetLineup">
                <Zap :size="14" />
                CPU Lineup
              </button>
              <button class="btn-confirm" @click="goToLineup">
                <Users :size="14" />
                Adjust Lineup
              </button>
            </template>
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
  z-index: 60;
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

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-lg);
}

.icon-trade_deadline {
  background: rgba(232, 90, 79, 0.18);
  color: var(--color-primary, #E85A4F);
}

.icon-all_star {
  background: rgba(168, 85, 247, 0.18);
  color: #a855f7;
}

.icon-user_injury {
  background: rgba(239, 68, 68, 0.18);
  color: #ef4444;
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
  gap: 12px;
}

.body-text {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-primary);
  margin: 0;
}

.body-text strong {
  color: var(--color-text-primary);
  font-weight: 600;
}

.body-hint {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin: 0;
  font-style: italic;
}

/* All-Star summary */
.all-star-summary {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.conf-summary {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
}

.conf-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
}

.conf-count {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Injury list — mirrors styling of inline injury modal in CampaignHomeView */
.inj-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inj-card {
  position: relative;
  display: flex;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.inj-severity-bar {
  width: 4px;
  background: var(--severity-color, #fbbf24);
  flex-shrink: 0;
}

.inj-card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
}

.inj-player-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.inj-player-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.inj-severity-tag {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--severity-color, #fbbf24);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--severity-color, #fbbf24) 15%, transparent);
}

.inj-detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.inj-duration {
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Footer */
.modal-footer {
  display: flex;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-cancel,
.btn-confirm,
.btn-cpu {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 11px 14px;
  border-radius: var(--radius-xl);
  font-size: 0.8rem;
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

.btn-cpu {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
}

.btn-cpu:hover {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

/* Modal transition */
.modal-enter-active {
  transition: opacity 0.25s cubic-bezier(0, 0, 0.2, 1);
}

.modal-leave-active {
  transition: opacity 0.18s cubic-bezier(0.4, 0, 1, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.25s cubic-bezier(0, 0, 0.2, 1), opacity 0.25s ease;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}
</style>
