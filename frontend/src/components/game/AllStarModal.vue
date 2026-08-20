<script setup>
import { ref, watch, onUnmounted, computed } from 'vue'
import { X, Star, Users } from 'lucide-vue-next'
import { t } from '@wl-i18n/i18n.js'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'

// PlayerAvatar expects `player.id`; roster entries carry `playerId` plus the
// headshot pointers forwarded by AllStarService._buildPlayerLookup. Same
// adapter as SimPauseModal so both All-Star surfaces render identical avatars.
function avatarPlayer(player) {
  if (!player) return null
  return {
    id: player.playerId,
    name: player.playerName,
    headshot: player.headshot ?? null,
    hasCustomHeadshot: player.hasCustomHeadshot ?? false,
  }
}

const props = defineProps({
  show: Boolean,
  rosters: Object,
  userTeamId: [Number, String],
})

const emit = defineEmits(['close'])

const activeTab = ref('allStars')

const currentRosters = computed(() => {
  if (!props.rosters) return null
  return activeTab.value === 'allStars' ? props.rosters.allStars : props.rosters.risingStars
})

const tabLabel = computed(() => activeTab.value === 'allStars' ? t('All-Star') : t('Rising Stars'))

const positions = ['PG', 'SG', 'SF', 'PF', 'C']

function isUserPlayer(player) {
  return player != null && props.userTeamId != null && player.teamId == props.userTeamId
}

// All of the user's team players selected in the currently-shown roster (across
// both conferences, starters + reserves) — drives the summary banner.
const userSelections = computed(() => {
  const r = currentRosters.value
  if (!r) return []
  const out = []
  for (const conf of ['east', 'west']) {
    const c = r[conf]
    if (!c) continue
    for (const pos of Object.keys(c.starters || {})) {
      const p = c.starters[pos]
      if (isUserPlayer(p)) out.push(p)
    }
    for (const p of c.reserves || []) {
      if (isUserPlayer(p)) out.push(p)
    }
  }
  return out
})

function close() {
  emit('close')
}

function handleKeydown(e) {
  if (e.key === 'Escape') close()
}

watch(() => props.show, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
    activeTab.value = 'allStars'
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
      <div v-if="show && rosters" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <!-- Header -->
          <header class="modal-header">
            <div class="header-title">
              <Star :size="20" class="star-icon" />
              <h2>{{ $t('{tab} Selections', { tab: tabLabel }) }}</h2>
            </div>
            <button class="close-btn" @click="close">
              <X :size="20" />
            </button>
          </header>

          <!-- Tab Switcher -->
          <div class="tab-switcher">
            <button
              class="tab-btn"
              :class="{ active: activeTab === 'allStars' }"
              @click="activeTab = 'allStars'"
            >
              <Star :size="14" />
              {{ $t('All-Stars') }}
            </button>
            <button
              class="tab-btn"
              :class="{ active: activeTab === 'risingStars' }"
              @click="activeTab = 'risingStars'"
            >
              <Users :size="14" />
              {{ $t('Rising Stars') }}
            </button>
          </div>

          <!-- Your-team selections summary -->
          <div v-if="userSelections.length" class="user-selections-banner">
            <Star :size="15" class="banner-star" />
            <span class="banner-text">
              {{ $t('{n} of your players made the {tab} team:', { n: userSelections.length, tab: tabLabel }) }}
              <span class="banner-names">{{ userSelections.map(p => p.playerName).join(', ') }}</span>
            </span>
          </div>

          <!-- Content -->
          <div v-if="currentRosters" class="rosters-content">
            <div class="conferences-grid">
              <!-- East -->
              <div class="conference-column">
                <h3 class="conference-title east-title">{{ $t('Eastern Conference') }}</h3>

                <div class="section-label">{{ $t('Starters') }}</div>
                <div class="players-list">
                  <div
                    v-for="pos in positions"
                    :key="'east-starter-' + pos"
                    class="player-card"
                    :class="{ 'user-highlight': currentRosters.east?.starters?.[pos] && isUserPlayer(currentRosters.east.starters[pos]) }"
                  >
                    <template v-if="currentRosters.east?.starters?.[pos]">
                      <div class="player-header">
                        <PlayerAvatar :player="avatarPlayer(currentRosters.east.starters[pos])" :size="38" class="as-avatar" />
                        <span class="position-badge" :style="{ backgroundColor: currentRosters.east.starters[pos].teamColor || '#6B7280' }">
                          {{ pos }}
                        </span>
                        <div class="player-info">
                          <span class="player-name">{{ currentRosters.east.starters[pos].playerName }}</span>
                          <span class="player-team" :style="{ color: currentRosters.east.starters[pos].teamColor }">
                            {{ currentRosters.east.starters[pos].teamAbbr }}
                          </span>
                        </div>
                      </div>
                      <div class="player-stats">
                        <!-- i18n-ignore -->
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.east.starters[pos].stats?.ppg }}</span><span class="stat-label">PPG</span></div>
                        <!-- i18n-ignore -->
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.east.starters[pos].stats?.rpg }}</span><span class="stat-label">RPG</span></div>
                        <!-- i18n-ignore -->
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.east.starters[pos].stats?.apg }}</span><span class="stat-label">APG</span></div>
                        <!-- i18n-ignore -->
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.east.starters[pos].stats?.spg }}</span><span class="stat-label">SPG</span></div>
                        <!-- i18n-ignore -->
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.east.starters[pos].stats?.bpg }}</span><span class="stat-label">BPG</span></div>
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.east.starters[pos].stats?.fgPct }}%</span><span class="stat-label">FG</span></div>
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.east.starters[pos].stats?.threePct }}%</span><span class="stat-label">3PT</span></div>
                      </div>
                    </template>
                    <template v-else>
                      <div class="player-header">
                        <span class="position-badge empty">{{ pos }}</span>
                        <span class="player-name empty-slot">--</span>
                      </div>
                    </template>
                  </div>
                </div>

                <div v-if="currentRosters.east?.reserves?.length" class="section-label">{{ $t('Reserves') }}</div>
                <div class="players-list">
                  <div
                    v-for="(player, idx) in currentRosters.east?.reserves || []"
                    :key="'east-reserve-' + idx"
                    class="player-card reserve"
                    :class="{ 'user-highlight': isUserPlayer(player) }"
                  >
                    <div class="player-header">
                      <PlayerAvatar :player="avatarPlayer(player)" :size="32" class="as-avatar" />
                      <span class="position-badge small" :style="{ backgroundColor: player.teamColor || '#6B7280' }">
                        {{ player.position }}
                      </span>
                      <div class="player-info">
                        <span class="player-name">{{ player.playerName }}</span>
                        <span class="player-team" :style="{ color: player.teamColor }">{{ player.teamAbbr }}</span>
                      </div>
                    </div>
                    <div class="player-stats">
                      <!-- i18n-ignore -->
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.ppg }}</span><span class="stat-label">PPG</span></div>
                      <!-- i18n-ignore -->
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.rpg }}</span><span class="stat-label">RPG</span></div>
                      <!-- i18n-ignore -->
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.apg }}</span><span class="stat-label">APG</span></div>
                      <!-- i18n-ignore -->
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.spg }}</span><span class="stat-label">SPG</span></div>
                      <!-- i18n-ignore -->
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.bpg }}</span><span class="stat-label">BPG</span></div>
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.fgPct }}%</span><span class="stat-label">FG</span></div>
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.threePct }}%</span><span class="stat-label">3PT</span></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- West -->
              <div class="conference-column">
                <h3 class="conference-title west-title">{{ $t('Western Conference') }}</h3>

                <div class="section-label">{{ $t('Starters') }}</div>
                <div class="players-list">
                  <div
                    v-for="pos in positions"
                    :key="'west-starter-' + pos"
                    class="player-card"
                    :class="{ 'user-highlight': currentRosters.west?.starters?.[pos] && isUserPlayer(currentRosters.west.starters[pos]) }"
                  >
                    <template v-if="currentRosters.west?.starters?.[pos]">
                      <div class="player-header">
                        <PlayerAvatar :player="avatarPlayer(currentRosters.west.starters[pos])" :size="38" class="as-avatar" />
                        <span class="position-badge" :style="{ backgroundColor: currentRosters.west.starters[pos].teamColor || '#6B7280' }">
                          {{ pos }}
                        </span>
                        <div class="player-info">
                          <span class="player-name">{{ currentRosters.west.starters[pos].playerName }}</span>
                          <span class="player-team" :style="{ color: currentRosters.west.starters[pos].teamColor }">
                            {{ currentRosters.west.starters[pos].teamAbbr }}
                          </span>
                        </div>
                      </div>
                      <div class="player-stats">
                        <!-- i18n-ignore -->
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.west.starters[pos].stats?.ppg }}</span><span class="stat-label">PPG</span></div>
                        <!-- i18n-ignore -->
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.west.starters[pos].stats?.rpg }}</span><span class="stat-label">RPG</span></div>
                        <!-- i18n-ignore -->
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.west.starters[pos].stats?.apg }}</span><span class="stat-label">APG</span></div>
                        <!-- i18n-ignore -->
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.west.starters[pos].stats?.spg }}</span><span class="stat-label">SPG</span></div>
                        <!-- i18n-ignore -->
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.west.starters[pos].stats?.bpg }}</span><span class="stat-label">BPG</span></div>
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.west.starters[pos].stats?.fgPct }}%</span><span class="stat-label">FG</span></div>
                        <div class="stat-cell"><span class="stat-value">{{ currentRosters.west.starters[pos].stats?.threePct }}%</span><span class="stat-label">3PT</span></div>
                      </div>
                    </template>
                    <template v-else>
                      <div class="player-header">
                        <span class="position-badge empty">{{ pos }}</span>
                        <span class="player-name empty-slot">--</span>
                      </div>
                    </template>
                  </div>
                </div>

                <div v-if="currentRosters.west?.reserves?.length" class="section-label">{{ $t('Reserves') }}</div>
                <div class="players-list">
                  <div
                    v-for="(player, idx) in currentRosters.west?.reserves || []"
                    :key="'west-reserve-' + idx"
                    class="player-card reserve"
                    :class="{ 'user-highlight': isUserPlayer(player) }"
                  >
                    <div class="player-header">
                      <PlayerAvatar :player="avatarPlayer(player)" :size="32" class="as-avatar" />
                      <span class="position-badge small" :style="{ backgroundColor: player.teamColor || '#6B7280' }">
                        {{ player.position }}
                      </span>
                      <div class="player-info">
                        <span class="player-name">{{ player.playerName }}</span>
                        <span class="player-team" :style="{ color: player.teamColor }">{{ player.teamAbbr }}</span>
                      </div>
                    </div>
                    <div class="player-stats">
                      <!-- i18n-ignore -->
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.ppg }}</span><span class="stat-label">PPG</span></div>
                      <!-- i18n-ignore -->
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.rpg }}</span><span class="stat-label">RPG</span></div>
                      <!-- i18n-ignore -->
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.apg }}</span><span class="stat-label">APG</span></div>
                      <!-- i18n-ignore -->
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.spg }}</span><span class="stat-label">SPG</span></div>
                      <!-- i18n-ignore -->
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.bpg }}</span><span class="stat-label">BPG</span></div>
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.fgPct }}%</span><span class="stat-label">FG</span></div>
                      <div class="stat-cell"><span class="stat-value">{{ player.stats?.threePct }}%</span><span class="stat-label">3PT</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="empty-state">
            <p>{{ $t('No selections available yet.') }}</p>
          </div>

          <!-- Footer -->
          <footer class="modal-footer">
            <button class="btn-close-footer" @click="close">
              {{ $t('Close') }}
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
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
}

.modal-container {
  width: 100%;
  max-width: 900px;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  animation: scaleIn 0.2s ease-out;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

/* Header */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.15));
  border-bottom: 1px solid var(--glass-border);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-title h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.star-icon {
  color: #f59e0b;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: transparent;
  border: none;
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

/* Tab Switcher */
.tab-switcher {
  display: flex;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--glass-border);
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.85rem;
  font-weight: 600;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.tab-btn.active {
  background: rgba(99, 102, 241, 0.15);
  color: #818cf8;
  border-color: rgba(99, 102, 241, 0.3);
}

/* Content */
.rosters-content {
  padding: 16px 24px 24px;
  flex: 1;
  overflow-y: auto;
}

.conferences-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.conference-title {
  font-size: 0.9rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 2px solid;
}

.east-title {
  color: #ef4444;
  border-color: #ef4444;
}

.west-title {
  color: #3b82f6;
  border-color: #3b82f6;
}

.section-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  margin: 12px 0 6px;
}

.players-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Player Card */
.player-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
  transition: background 0.15s ease;
}

.player-card:hover {
  background: var(--color-bg-elevated);
}

.player-card.reserve {
  padding: 6px 10px;
}

.player-card.user-highlight {
  position: relative;
  background: rgba(245, 158, 11, 0.14);
  border: 1px solid rgba(245, 158, 11, 0.55);
  border-left: 3px solid #f59e0b;
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
}
/* Reserve room in the name row (only) so the corner badge never overlaps it. */
.player-card.user-highlight .player-header {
  padding-right: 72px;
}
.player-card.user-highlight::after {
  content: 'YOUR PLAYER';
  position: absolute;
  top: 7px;
  right: 8px;
  font-size: 0.5rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.16);
  border: 1px solid rgba(245, 158, 11, 0.45);
  border-radius: 4px;
  padding: 2px 5px;
  pointer-events: none;
}

/* Your-team selections summary banner */
.user-selections-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 24px;
  padding: 9px 13px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--radius-lg);
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}
.banner-star {
  color: #f59e0b;
  flex-shrink: 0;
}
.banner-text strong {
  color: #f59e0b;
}
.banner-names {
  color: var(--color-text-primary);
  font-weight: 600;
}

.player-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Headshot avatar — matches the SimPauseModal all-star rows. */
.as-avatar {
  flex-shrink: 0;
}

.position-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.position-badge.small {
  width: 28px;
  height: 28px;
  font-size: 0.65rem;
}

.position-badge.empty {
  background: var(--color-bg-elevated);
  color: var(--color-text-tertiary);
}

.player-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.player-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-name.empty-slot {
  color: var(--color-text-tertiary);
}

.player-team {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.player-stats {
  display: flex;
  gap: 2px;
  padding-left: 40px;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
}

.stat-label {
  font-size: 0.55rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.empty-state {
  padding: 48px 24px;
  text-align: center;
  color: var(--color-text-tertiary);
}

/* Footer */
.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--glass-border);
}

.btn-close-footer {
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
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.btn-close-footer:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

/* Transitions */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

/* Mobile */
@media (max-width: 640px) {
  .conferences-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .rosters-content {
    padding: 12px 16px 16px;
  }

  .modal-header {
    padding: 16px;
  }

  .tab-switcher {
    padding: 8px 16px;
  }

  .player-stats {
    display: none;
  }

  .player-card {
    padding: 6px 8px;
    gap: 2px;
  }
}

/* Standardized modal heights (90vh desktop, 85vh mobile) */
.modal-container {
  min-height: 90vh;
  max-height: 90vh;
}

@media (max-width: 480px) {
  .modal-container {
    min-height: 85vh;
    max-height: 85vh;
  }
}
</style>
