<script setup>
import { computed } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  summaryData: { type: Object, default: null },
})

const emit = defineEmits(['close'])

const scoutingPointsEarned = computed(() => props.summaryData?.scoutingPointsEarned ?? 0)

const evolutionChanges = computed(() => {
  const evo = props.summaryData?.evolution
  if (!evo) return []

  const changes = []
  for (const teamKey of ['home', 'away']) {
    const teamEvo = evo[teamKey]
    if (!teamEvo) continue

    // Attribute improvements
    const improvements = teamEvo.improvements || teamEvo.attributeChanges || []
    for (const imp of improvements) {
      changes.push({
        playerName: imp.playerName || imp.player_name || 'Unknown',
        attribute: imp.attribute || imp.attr,
        change: imp.change || imp.amount || 0,
        newValue: imp.newValue || imp.new_value || null,
        type: 'attribute',
      })
    }
  }
  return changes
})

const badgeChanges = computed(() => {
  const evo = props.summaryData?.evolution
  if (!evo) return []

  const changes = []
  for (const teamKey of ['home', 'away']) {
    const teamEvo = evo[teamKey]
    if (!teamEvo) continue

    const badges = teamEvo.badgeChanges || teamEvo.badge_changes || []
    for (const bc of badges) {
      changes.push({
        playerName: bc.playerName || bc.player_name || 'Unknown',
        badgeName: bc.badgeName || bc.badge_name || bc.badge || 'Unknown',
        oldLevel: bc.oldLevel || bc.old_level || 'none',
        newLevel: bc.newLevel || bc.new_level || 'bronze',
        type: 'badge',
      })
    }
  }
  return changes
})

function formatAttribute(attr) {
  if (!attr) return ''
  return attr
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim()
}

function getBadgeLevelColor(level) {
  const colors = {
    bronze: '#CD7F32',
    silver: '#C0C0C0',
    gold: '#FFD700',
    hof: '#FF6B6B',
  }
  return colors[level] || 'var(--color-text-secondary)'
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="emit('close')">
        <div class="modal-container">
          <!-- Header -->
          <header>
            <h2 class="modal-title">Weekly Report</h2>
            <button class="close-btn" @click="emit('close')">
              <X :size="20" />
            </button>
          </header>

          <!-- Content -->
          <main>
            <!-- Scouting Points Section -->
            <section v-if="scoutingPointsEarned > 0" class="summary-section">
              <h3 class="section-title">Scouting Department</h3>
              <div class="scouting-earned">
                <span class="earned-label">Your scouting department earned</span>
                <span class="earned-value">{{ scoutingPointsEarned }}</span>
                <span class="earned-label">scouting point{{ scoutingPointsEarned !== 1 ? 's' : '' }} this week</span>
              </div>
            </section>

            <!-- Player Development Section -->
            <section v-if="evolutionChanges.length > 0" class="summary-section">
              <h3 class="section-title">Player Development</h3>
              <div class="changes-list">
                <div
                  v-for="(change, i) in evolutionChanges"
                  :key="'evo-' + i"
                  class="change-item"
                >
                  <span class="player-name">{{ change.playerName }}</span>
                  <span class="change-detail">
                    {{ formatAttribute(change.attribute) }}
                    <span class="change-value positive">+{{ change.change }}</span>
                    <span v-if="change.newValue" class="new-value">({{ change.newValue }})</span>
                  </span>
                </div>
              </div>
            </section>

            <!-- Badge Changes Section -->
            <section v-if="badgeChanges.length > 0" class="summary-section">
              <h3 class="section-title">Badge Upgrades</h3>
              <div class="changes-list">
                <div
                  v-for="(change, i) in badgeChanges"
                  :key="'badge-' + i"
                  class="change-item"
                >
                  <span class="player-name">{{ change.playerName }}</span>
                  <span class="change-detail">
                    {{ formatAttribute(change.badgeName) }}:
                    <span class="badge-level" :style="{ color: getBadgeLevelColor(change.oldLevel) }">{{ change.oldLevel }}</span>
                    &rarr;
                    <span class="badge-level" :style="{ color: getBadgeLevelColor(change.newLevel) }">{{ change.newLevel }}</span>
                  </span>
                </div>
              </div>
            </section>

            <!-- Empty State -->
            <div v-if="!scoutingPointsEarned && evolutionChanges.length === 0 && badgeChanges.length === 0" class="empty-state">
              <p>No notable events this week.</p>
            </div>
          </main>

          <!-- Footer -->
          <footer>
            <button class="footer-btn action-btn" @click="emit('close')">Continue</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Modal transitions */
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

/* Overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

/* Container */
.modal-container {
  background: var(--color-bg-primary, #1a1520);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  background: var(--gradient-cosmic);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.close-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

/* Content */
main {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.summary-section {
  margin-bottom: 24px;
}

.summary-section:last-child {
  margin-bottom: 0;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  margin-bottom: 12px;
}

/* Scouting */
.scouting-earned {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: rgba(232, 90, 79, 0.08);
  border: 1px solid rgba(232, 90, 79, 0.15);
  border-radius: var(--radius-lg);
}

.earned-label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.earned-value {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.3rem;
  background: var(--gradient-cosmic);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Changes List */
.changes-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.change-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.02);
}

.change-item:nth-child(even) {
  background: rgba(255, 255, 255, 0.04);
}

.player-name {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--color-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-detail {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  margin-left: 12px;
}

.change-value.positive {
  color: #4CAF50;
  font-weight: 600;
}

.new-value {
  color: var(--color-text-tertiary);
  font-size: 0.72rem;
}

.badge-level {
  font-weight: 600;
  text-transform: capitalize;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 32px 0;
  color: var(--color-text-tertiary);
  font-size: 0.85rem;
}

/* Footer */
footer {
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.footer-btn {
  flex: 1;
  padding: 12px;
  border-radius: var(--radius-lg);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn {
  background: var(--gradient-cosmic);
  border: none;
  color: black;
}

.action-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(232, 90, 79, 0.3);
}
</style>
