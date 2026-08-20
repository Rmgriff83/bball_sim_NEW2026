<script setup>
import { computed } from 'vue'
import { Award, Trophy, Star, Shield, Sparkles, X } from 'lucide-vue-next'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  // Shape comes from AwardService.processSeasonAwards:
  //   { mvp, rookieOfTheYear, allNba: { first, second, third },
  //     allDefense: { first, second }, allRookie: { first, second } }
  awards: {
    type: Object,
    default: () => ({})
  },
  year: {
    type: [Number, String],
    default: 2025
  },
  userTeamAbbr: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['close'])

const mvp = computed(() => props.awards?.mvp ?? null)
const roty = computed(() => props.awards?.rookieOfTheYear ?? null)
const dpoy = computed(() => props.awards?.dpoy ?? null)
const allNba = computed(() => props.awards?.allNba ?? null)
const allDefense = computed(() => props.awards?.allDefense ?? null)
const allRookie = computed(() => props.awards?.allRookie ?? null)

const seasonLabel = computed(() => {
  const y = Number(props.year) || 2025
  return `${y}-${String(y + 1).slice(-2)}`
})

const hasAnyAward = computed(() => {
  return !!(mvp.value || roty.value || dpoy.value || allNba.value || allDefense.value || allRookie.value)
})

function isUserPlayer(player) {
  return props.userTeamAbbr && player?.teamAbbr === props.userTeamAbbr
}

function close() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <!-- Header -->
          <header class="modal-header">
            <div class="header-left">
              <Award :size="22" class="header-icon" />
              <div class="header-titles">
                <h2 class="modal-title">{{ $t('Season Awards') }}</h2>
                <span class="modal-subtitle">{{ seasonLabel }}</span>
              </div>
            </div>
            <button class="btn-close" @click="close" aria-label="Close">
              <X :size="20" />
            </button>
          </header>

          <!-- Content -->
          <main class="modal-content">
            <div v-if="!hasAnyAward" class="empty-state">
              {{ $t('No award winners selected for this season.') }}
            </div>

            <!-- MVP -->
            <section v-if="mvp" class="award-section featured">
              <div class="award-section-header">
                <Trophy :size="16" class="award-icon mvp" />
                <span class="award-section-label">{{ $t('League MVP') }}</span>
              </div>
              <div class="award-card mvp-card" :class="{ 'user-card': isUserPlayer(mvp) }">
                <div class="award-card-row">
                  <div
                    class="team-pill"
                    :style="{ backgroundColor: mvp.teamColor || '#666' }"
                  >
                    {{ mvp.teamAbbr }}
                  </div>
                  <div class="player-name-block">
                    <div class="player-name">{{ mvp.playerName }}</div>
                    <div class="player-meta">{{ mvp.position }}</div>
                  </div>
                </div>
                <div v-if="mvp.stats" class="player-stats">
                  <div class="stat-pill">
                    <span class="stat-value">{{ mvp.stats.ppg }}</span>
<!-- i18n-ignore -->
                    <span class="stat-label">PPG</span>
                  </div>
                  <div class="stat-pill">
                    <span class="stat-value">{{ mvp.stats.rpg }}</span>
<!-- i18n-ignore -->
                    <span class="stat-label">RPG</span>
                  </div>
                  <div class="stat-pill">
                    <span class="stat-value">{{ mvp.stats.apg }}</span>
<!-- i18n-ignore -->
                    <span class="stat-label">APG</span>
                  </div>
                </div>
              </div>
            </section>

            <!-- Rookie of the Year -->
            <section v-if="roty" class="award-section featured">
              <div class="award-section-header">
                <Sparkles :size="16" class="award-icon roty" />
                <span class="award-section-label">{{ $t('Rookie of the Year') }}</span>
              </div>
              <div class="award-card roty-card" :class="{ 'user-card': isUserPlayer(roty) }">
                <div class="award-card-row">
                  <div
                    class="team-pill"
                    :style="{ backgroundColor: roty.teamColor || '#666' }"
                  >
                    {{ roty.teamAbbr }}
                  </div>
                  <div class="player-name-block">
                    <div class="player-name">{{ roty.playerName }}</div>
                    <div class="player-meta">{{ roty.position }}</div>
                  </div>
                </div>
                <div v-if="roty.stats" class="player-stats">
                  <div class="stat-pill">
                    <span class="stat-value">{{ roty.stats.ppg }}</span>
<!-- i18n-ignore -->
                    <span class="stat-label">PPG</span>
                  </div>
                  <div class="stat-pill">
                    <span class="stat-value">{{ roty.stats.rpg }}</span>
<!-- i18n-ignore -->
                    <span class="stat-label">RPG</span>
                  </div>
                  <div class="stat-pill">
                    <span class="stat-value">{{ roty.stats.apg }}</span>
<!-- i18n-ignore -->
                    <span class="stat-label">APG</span>
                  </div>
                </div>
              </div>
            </section>

            <!-- Defensive Player of the Year -->
            <section v-if="dpoy" class="award-section featured">
              <div class="award-section-header">
                <Shield :size="16" class="award-icon dpoy" />
                <span class="award-section-label">{{ $t('Defensive Player of the Year') }}</span>
              </div>
              <div class="award-card dpoy-card" :class="{ 'user-card': isUserPlayer(dpoy) }">
                <div class="award-card-row">
                  <div
                    class="team-pill"
                    :style="{ backgroundColor: dpoy.teamColor || '#666' }"
                  >
                    {{ dpoy.teamAbbr }}
                  </div>
                  <div class="player-name-block">
                    <div class="player-name">{{ dpoy.playerName }}</div>
                    <div class="player-meta">{{ dpoy.position }}</div>
                  </div>
                </div>
                <div v-if="dpoy.stats" class="player-stats">
                  <div class="stat-pill">
                    <span class="stat-value">{{ dpoy.stats.spg }}</span>
<!-- i18n-ignore -->
                    <span class="stat-label">SPG</span>
                  </div>
                  <div class="stat-pill">
                    <span class="stat-value">{{ dpoy.stats.bpg }}</span>
<!-- i18n-ignore -->
                    <span class="stat-label">BPG</span>
                  </div>
                  <div class="stat-pill">
                    <span class="stat-value">{{ dpoy.stats.rpg }}</span>
<!-- i18n-ignore -->
                    <span class="stat-label">RPG</span>
                  </div>
                </div>
              </div>
            </section>

            <!-- All-NBA Teams -->
            <section v-if="allNba" class="award-section">
              <div class="award-section-header">
                <Star :size="16" class="award-icon all-nba" />
                <span class="award-section-label">{{ $t('All-League') }}</span>
              </div>
              <div class="team-list">
                <div
                  v-for="tier in ['first', 'second', 'third']"
                  v-show="allNba?.[tier]?.length"
                  :key="`all-nba-${tier}`"
                  class="award-team"
                >
                  <span class="team-tier-label">{{ tier === 'first' ? $t('1st Team') : tier === 'second' ? $t('2nd Team') : $t('3rd Team') }}</span>
                  <div class="player-row">
                    <div
                      v-for="p in allNba[tier]"
                      :key="`all-nba-${tier}-${p.playerId}`"
                      class="player-chip"
                      :class="{ 'user-chip': isUserPlayer(p) }"
                    >
                      <span
                        class="chip-team-pill"
                        :style="{ backgroundColor: p.teamColor || '#666' }"
                      >
                        {{ p.teamAbbr }}
                      </span>
                      <span class="chip-player-name">{{ p.playerName }}</span>
                      <span class="chip-position">{{ p.position }}</span>
                      <span v-if="p.stats" class="chip-stats">
                        {{ p.stats.ppg }}/{{ p.stats.rpg }}/{{ p.stats.apg }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- All-Defense Teams -->
            <section v-if="allDefense?.first?.length || allDefense?.second?.length" class="award-section">
              <div class="award-section-header">
                <Shield :size="16" class="award-icon all-defense" />
                <span class="award-section-label">{{ $t('All-Defense') }}</span>
              </div>
              <div class="team-list">
                <div
                  v-for="tier in ['first', 'second']"
                  v-show="allDefense?.[tier]?.length"
                  :key="`all-def-${tier}`"
                  class="award-team"
                >
                  <span class="team-tier-label">{{ tier === 'first' ? $t('1st Team') : $t('2nd Team') }}</span>
                  <div class="player-row">
                    <div
                      v-for="p in allDefense[tier]"
                      :key="`all-def-${tier}-${p.playerId}`"
                      class="player-chip"
                      :class="{ 'user-chip': isUserPlayer(p) }"
                    >
                      <span
                        class="chip-team-pill"
                        :style="{ backgroundColor: p.teamColor || '#666' }"
                      >
                        {{ p.teamAbbr }}
                      </span>
                      <span class="chip-player-name">{{ p.playerName }}</span>
                      <span class="chip-position">{{ p.position }}</span>
                      <span v-if="p.stats" class="chip-stats">
                        <!-- i18n-ignore -->
                        {{ p.stats.spg }} SPG &middot; {{ p.stats.bpg }} BPG
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- All-Rookie Teams -->
            <section v-if="allRookie?.first?.length || allRookie?.second?.length" class="award-section">
              <div class="award-section-header">
                <Sparkles :size="16" class="award-icon roty" />
                <span class="award-section-label">{{ $t('All-Rookie') }}</span>
              </div>
              <div class="team-list">
                <div
                  v-for="tier in ['first', 'second']"
                  v-show="allRookie?.[tier]?.length"
                  :key="`all-rookie-${tier}`"
                  class="award-team"
                >
                  <span class="team-tier-label">{{ tier === 'first' ? $t('1st Team') : $t('2nd Team') }}</span>
                  <div class="player-row">
                    <div
                      v-for="p in allRookie[tier]"
                      :key="`all-rookie-${tier}-${p.playerId}`"
                      class="player-chip"
                      :class="{ 'user-chip': isUserPlayer(p) }"
                    >
                      <span
                        class="chip-team-pill"
                        :style="{ backgroundColor: p.teamColor || '#666' }"
                      >
                        {{ p.teamAbbr }}
                      </span>
                      <span class="chip-player-name">{{ p.playerName }}</span>
                      <span class="chip-position">{{ p.position }}</span>
                      <span v-if="p.stats" class="chip-stats">
                        {{ p.stats.ppg }}/{{ p.stats.rpg }}/{{ p.stats.apg }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </main>

          <!-- Footer -->
          <footer class="modal-footer">
            <button class="btn-confirm" @click="close">
              {{ $t('Continue') }}
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
  max-width: 540px;
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
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.08), rgba(168, 85, 247, 0.06));
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  color: #ffd700;
  flex-shrink: 0;
}

.header-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.modal-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: 0.02em;
  line-height: 1;
}

.modal-subtitle {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
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
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.empty-state {
  text-align: center;
  padding: 24px 12px;
  color: var(--color-text-tertiary);
  font-size: 0.85rem;
}

.award-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.award-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.award-section-label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
}

.award-icon {
  color: var(--color-text-secondary);
}

.award-icon.mvp { color: #ffd700; }
.award-icon.roty { color: #a855f7; }
.award-icon.dpoy { color: #38bdf8; }
.award-icon.all-nba { color: #fb923c; }
.award-icon.all-defense { color: #38bdf8; }

/* Featured cards (MVP + ROTY) */
.award-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
}

.award-card.mvp-card {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.12), rgba(255, 140, 0, 0.05));
  border-color: rgba(255, 215, 0, 0.3);
}

.award-card.roty-card {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(139, 92, 246, 0.05));
  border-color: rgba(168, 85, 247, 0.3);
}

.award-card.dpoy-card {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(14, 165, 233, 0.05));
  border-color: rgba(56, 189, 248, 0.3);
}

.award-card.user-card {
  box-shadow: 0 0 0 1px var(--color-primary), 0 0 16px rgba(232, 90, 79, 0.18);
}

.award-card-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.team-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-md);
  color: white;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.player-name-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.player-name {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.1;
}

.player-meta {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.player-stats {
  display: flex;
  gap: 8px;
}

.stat-pill {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}

.stat-value {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.stat-label {
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

/* Team lists (All-NBA / All-Defense / All-Rookie) */
.team-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.award-team {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.team-tier-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.player-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.player-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.02);
}

.player-chip.user-chip {
  background: rgba(232, 90, 79, 0.12);
  border: 1px solid rgba(232, 90, 79, 0.3);
}

.chip-team-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 22px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.chip-player-name {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.chip-position {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.chip-stats {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.02em;
  white-space: nowrap;
  margin-left: auto;
}

/* Footer */
.modal-footer {
  display: flex;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--glass-border);
}

.btn-confirm {
  flex: 1;
  padding: 11px 14px;
  border-radius: var(--radius-xl);
  background: var(--color-primary);
  border: none;
  color: white;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-confirm:hover {
  background: var(--color-primary-dark);
  transform: translateY(-1px);
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
