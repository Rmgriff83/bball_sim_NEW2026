<script setup>
import { computed, ref, watch, onUnmounted } from 'vue'
import { X, AlertTriangle, Calendar, Star, Zap, Users, Pause, Play } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import MedicalStaffPanel from '@/components/game/MedicalStaffPanel.vue'
import { useMedicalBenefits, effectiveDaysOut, daysSaved } from '@/composables/useMedicalBenefits'

// PlayerAvatar expects `player.id` (headshot resolver keys on that). All-Star
// roster entries carry `playerId` instead, so adapt to the avatar's contract.
// Headshot pointers (`headshot` filename + `hasCustomHeadshot` flag) are
// preserved by AllStarService._buildPlayerLookup and forwarded here so the
// resolver can actually find an asset.
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
  'cpu-set-lineup',  // Injury variant: let CPU pick starters, then resume
  'go-to-lineup',    // Injury variant: navigate to lineup editor (cancels run)
])

const titleByReason = {
  trade_deadline: 'Deadlines in One Week',
  all_star: 'All-Star Selections',
  user_injury: 'Player Injured',
}
const title = computed(() => titleByReason[props.reason] || 'Simulation Paused')

const injuries = computed(() => Array.isArray(props.payload?.injuries) ? props.payload.injuries : [])
const allStarRosters = computed(() => props.payload?.allStarRosters || null)

// AllStarService stores the payload as { allStars: { east, west }, risingStars: { east, west } }.
// We render both via a tab switch — no separate "View All-Stars" modal needed.
const allStarTab = ref('allStars') // 'allStars' | 'risingStars'
const activeRosterTree = computed(() => {
  if (allStarTab.value === 'risingStars') return allStarRosters.value?.risingStars || null
  return allStarRosters.value?.allStars || null
})
const risingStarsAvailable = computed(() => {
  const rs = allStarRosters.value?.risingStars
  if (!rs) return false
  for (const conf of ['east', 'west']) {
    if (rs[conf]?.starters && Object.keys(rs[conf].starters).length > 0) return true
    if (Array.isArray(rs[conf]?.reserves) && rs[conf].reserves.length > 0) return true
  }
  return false
})

const STARTER_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

function startersList(conference) {
  const startersMap = activeRosterTree.value?.[conference]?.starters || {}
  return STARTER_POSITIONS
    .map(pos => startersMap[pos])
    .filter(Boolean)
}
function reservesList(conference) {
  const reserves = activeRosterTree.value?.[conference]?.reserves
  return Array.isArray(reserves) ? reserves : []
}
function conferenceCount(conference) {
  return startersList(conference).length + reservesList(conference).length
}

function severityColor(severity) {
  switch (severity) {
    case 'minor': return '#fbbf24'
    case 'moderate': return '#fb923c'
    case 'severe': return '#ef4444'
    case 'season_ending': return '#ef4444'
    default: return '#fbbf24'
  }
}

// Medical staff/facility recovery bonus — same math the sim applies, read
// live from the campaign/team stores (this modal always mounts inside the
// campaign layout, so Pinia state is available without prop changes).
const { medicalBreakdown, campaignId } = useMedicalBenefits()

function injRolledDays(injury) {
  return injury.days_out ?? injury.games_out ?? 0
}

function injEffDays(injury) {
  return effectiveDaysOut(injRolledDays(injury), medicalBreakdown.value.totalBonus)
}

function injSavedDays(injury) {
  return daysSaved(injRolledDays(injury), medicalBreakdown.value.totalBonus)
}

function close() { emit('close') }
function continueSim() { emit('continue') }
function pauseSim() { emit('pause') }
function cpuSetLineup() { emit('cpu-set-lineup') }
function goToLineup() { emit('go-to-lineup') }

function handleKeydown(e) {
  if (e.key === 'Escape') close()
}
watch(() => props.show, (open) => {
  if (open) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
    // Reset the All-Star tab so subsequent pause events start on All-Stars,
    // not whichever tab the user left it on last.
    allStarTab.value = 'allStars'
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
        <div class="modal-container" :class="{ wide: reason === 'all_star' }">
          <!-- Header -->
          <header class="modal-header">
            <div class="header-left">
              <div class="header-icon" :class="`icon-${reason}`">
                <AlertTriangle v-if="reason === 'user_injury'" :size="18" />
                <Star v-else-if="reason === 'all_star'" :size="18" />
                <Calendar v-else :size="18" />
              </div>
              <h2 class="modal-title">{{ $tDynamic(title) }}</h2>
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
                {{ $t('The trade deadline closes in one week. After it passes, no more trades can be proposed for the rest of the season.') }}
              </p>
              <p class="body-text">
                {{ $t("The contract extension deadline also closes in one week — any player on the final year of their contract must be re-signed before then, or they'll hit free agency at season end.") }}
              </p>
              <p class="body-hint">{{ $t('Pause now to plan trades or re-sign players, or continue simming.') }}</p>
            </template>

            <!-- All-Star variant -->
            <template v-else-if="reason === 'all_star'">
              <p class="body-text">
                <template v-if="allStarTab === 'risingStars'">{{ $t('Rising Stars rosters have been announced.') }}</template>
                <template v-else>{{ $t('All-Star rosters have been announced.') }}</template>
              </p>

              <!-- Tab switcher: All-Stars / Rising Stars. Lives inside the
                   pause modal so we don't need a separate "View All-Stars"
                   secondary modal anymore. -->
              <div class="roster-tabs">
                <button
                  type="button"
                  class="roster-tab"
                  :class="{ active: allStarTab === 'allStars' }"
                  @click="allStarTab = 'allStars'"
                >
                  <Star :size="14" />
                  {{ $t('All-Stars') }}
                </button>
                <button
                  type="button"
                  class="roster-tab"
                  :class="{ active: allStarTab === 'risingStars' }"
                  :disabled="!risingStarsAvailable"
                  @click="allStarTab = 'risingStars'"
                >
                  <Users :size="14" />
                  {{ $t('Rising Stars') }}
                </button>
              </div>

              <div v-if="activeRosterTree" class="all-star-rosters">
                <div v-for="conf in ['east', 'west']" :key="conf" class="conf-section">
                  <div class="conf-header">
                    <span class="conf-name">{{ conf === 'east' ? $t('Eastern Conference') : $t('Western Conference') }}</span>
                    <span class="conf-count">{{ $t('{n} selections', { n: conferenceCount(conf) }) }}</span>
                  </div>

                  <div v-if="startersList(conf).length > 0" class="player-group">
                    <div class="group-label">{{ $t('Starters') }}</div>
                    <div
                      v-for="player in startersList(conf)"
                      :key="`${allStarTab}-${conf}-s-${player.playerId ?? player.playerName}`"
                      class="player-row"
                    >
                      <div class="p-avatar-wrap">
                        <PlayerAvatar :player="avatarPlayer(player)" :size="42" class="p-avatar-icon" />
                        <span class="p-pos-label card-cosmic">{{ player.position }}</span>
                      </div>
                      <div class="player-id">
                        <span class="p-name">{{ player.playerName }}</span>
                        <span class="p-team-pill" :style="{ background: player.teamColor || 'var(--color-bg-tertiary)' }">{{ player.teamAbbr }}</span>
                      </div>
                      <div class="p-stats">
                        <span><b>{{ player.stats?.ppg ?? 0 }}</b> PTS</span>
                        <span><b>{{ player.stats?.rpg ?? 0 }}</b> REB</span>
                        <span><b>{{ player.stats?.apg ?? 0 }}</b> AST</span>
                        <span><b>{{ player.stats?.fgPct ?? 0 }}%</b> FG</span>
                        <span><b>{{ player.stats?.threePct ?? 0 }}%</b> 3P</span>
                      </div>
                    </div>
                  </div>

                  <div v-if="reservesList(conf).length > 0" class="player-group">
                    <div class="group-label">{{ $t('Reserves') }}</div>
                    <div
                      v-for="player in reservesList(conf)"
                      :key="`${allStarTab}-${conf}-r-${player.playerId ?? player.playerName}`"
                      class="player-row reserve"
                    >
                      <div class="p-avatar-wrap small">
                        <PlayerAvatar :player="avatarPlayer(player)" :size="36" class="p-avatar-icon" />
                        <span class="p-pos-label card-cosmic">{{ player.position }}</span>
                      </div>
                      <div class="player-id">
                        <span class="p-name">{{ player.playerName }}</span>
                        <span class="p-team-pill" :style="{ background: player.teamColor || 'var(--color-bg-tertiary)' }">{{ player.teamAbbr }}</span>
                      </div>
                      <div class="p-stats">
                        <span><b>{{ player.stats?.ppg ?? 0 }}</b> PTS</span>
                        <span><b>{{ player.stats?.rpg ?? 0 }}</b> REB</span>
                        <span><b>{{ player.stats?.apg ?? 0 }}</b> AST</span>
                        <span><b>{{ player.stats?.fgPct ?? 0 }}%</b> FG</span>
                        <span><b>{{ player.stats?.threePct ?? 0 }}%</b> 3P</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- User Injury variant -->
            <template v-else-if="reason === 'user_injury'">
              <p class="body-text">
                <template v-if="injuries.length === 1">{{ $t('A player on your team was injured during the last game.') }}</template>
                <template v-else>{{ $t('{n} players on your team were injured during the last game.', { n: injuries.length }) }}</template>
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
                      <span class="inj-severity-tag">{{ $tDynamic(injury.severity) }}</span>
                    </div>
                    <div class="inj-detail-row">
                      <span class="inj-type">{{ $tDynamic(injury.injury_type) }}</span>
                      <span v-if="injSavedDays(injury) >= 1" class="inj-duration">
                        {{ injEffDays(injury) === 1 ? $t('~{n} day', { n: injEffDays(injury) }) : $t('~{n} days', { n: injEffDays(injury) }) }}
                        <span class="inj-saved">{{ injSavedDays(injury) === 1 ? $t('{n} day saved', { n: injSavedDays(injury) }) : $t('{n} days saved', { n: injSavedDays(injury) }) }}</span>
                      </span>
                      <span v-else class="inj-duration">{{ (injury.days_out ?? injury.games_out ?? 0) === 1 ? $t('{n} day', { n: injury.days_out ?? injury.games_out ?? 0 }) : $t('{n} days', { n: injury.days_out ?? injury.games_out ?? 0 }) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <MedicalStaffPanel :breakdown="medicalBreakdown" :campaign-id="campaignId" mode="injury" />

              <p class="body-hint">{{ $t('Choose how to handle your lineup before the simulation continues.') }}</p>
            </template>
          </main>

          <!-- Footer -->
          <footer
            class="modal-footer"
            :class="{ 'modal-footer--injury': reason === 'user_injury' }"
          >
            <!-- Trade Deadline footer -->
            <template v-if="reason === 'trade_deadline'">
              <button class="btn-cancel" @click="pauseSim">
                <Pause :size="14" />
                {{ $t('Pause Sim') }}
              </button>
              <button class="btn-confirm" @click="continueSim">
                <Play :size="14" fill="currentColor" />
                {{ $t('Continue Sim') }}
              </button>
            </template>

            <!-- All-Star footer -->
            <template v-else-if="reason === 'all_star'">
              <button class="btn-confirm" @click="continueSim">
                <Play :size="14" fill="currentColor" />
                {{ $t('Continue Sim') }}
              </button>
            </template>

            <!-- Injury footer -->
            <template v-else-if="reason === 'user_injury'">
              <button class="btn-cancel injury-pause" @click="pauseSim">
                <Pause :size="14" />
                {{ $t('Pause Sim') }}
              </button>
              <button class="btn-cpu" @click="cpuSetLineup">
                <Zap :size="14" />
                {{ $t('CPU Lineup') }}
              </button>
              <button class="btn-confirm" @click="goToLineup">
                <Users :size="14" />
                {{ $t('Adjust Lineup') }}
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

/* All-Star variant needs more horizontal room for the per-player stats row. */
.modal-container.wide {
  max-width: 720px;
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

/* Tab switcher between the All-Star and Rising Stars roster trees. Sits
   above the rosters list in the all_star variant. */
.roster-tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.roster-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.roster-tab:hover:not(:disabled):not(.active) {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.04);
}

.roster-tab.active {
  background: var(--color-primary);
  color: white;
}

.roster-tab:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* All-Star rosters list */
.all-star-rosters {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.conf-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.conf-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.conf-name {
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-primary);
}

.conf-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.player-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-tertiary);
  padding: 4px 0 2px;
}

.player-row {
  display: grid;
  grid-template-columns: 52px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.02);
}

.player-row.reserve {
  background: transparent;
}

/* Avatar block — mirrors the lineup tab starter card: circular headshot with
   a gold cosmic position label overlaid at the bottom-left. */
.p-avatar-wrap {
  position: relative;
  width: 44px;
  height: 44px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.p-avatar-wrap.small {
  width: 38px;
  height: 38px;
}

.p-avatar-icon {
  stroke-width: 1.5;
}

/* Cosmic-gradient position label — same vocab as .slot-position-label on
   the starter cards. Positioned at the bottom-left corner of the avatar
   so it reads as a flag on the player. */
.p-pos-label {
  position: absolute;
  bottom: -6px;
  left: -2px;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 0.7rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: #1a1520;
  padding: 1px 6px;
  border-radius: var(--radius-md);
  line-height: 1.25;
  text-align: center;
  z-index: 1;
}

.p-avatar-wrap.small .p-pos-label {
  font-size: 0.62rem;
  padding: 1px 5px;
  bottom: -5px;
}

.player-id {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.p-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Team abbreviation as a pill with the team color as background and white
   text — guarantees contrast on both dark backgrounds (modal default) and
   the light-mode newspaper texture, regardless of how dark the team color
   itself is. Replaces the old tinted-text approach that disappeared on
   teams with near-black primary colors. */
.p-team-pill {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: white;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.p-stats {
  display: flex;
  gap: 10px;
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.p-stats b {
  color: var(--color-text-primary);
  font-weight: 600;
}

@media (max-width: 560px) {
  .player-row {
    grid-template-columns: 48px 1fr;
    grid-template-rows: auto auto;
  }
  .p-stats {
    grid-column: 1 / -1;
    flex-wrap: wrap;
    gap: 8px;
    padding-left: 56px;
  }
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

/* Green medical-staff affordance: days shaved off the estimate. */
.inj-saved {
  display: block;
  font-size: 0.68rem;
  font-weight: 700;
  color: #22c55e;
  text-align: right;
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

/* Cap the modal so it stays inside the viewport, but let it size down to
   whatever its content actually needs (no fixed min-height floor). */
.modal-container {
  max-height: 90vh;
}

@media (max-width: 480px) {
  .modal-container {
    max-height: 85vh;
  }
  /* Injury footer has 3 actions (Pause / CPU / Adjust) which is too tight
     for a single horizontal row on phones — labels truncate and the icons
     start fighting for breathing room. Stack them so each action gets the
     full row width. Trade-deadline (2 buttons) and All-Star (1 button)
     footers stay horizontal. */
  .modal-footer--injury {
    flex-direction: column;
  }
  .modal-footer--injury > button {
    width: 100%;
  }
}
</style>
