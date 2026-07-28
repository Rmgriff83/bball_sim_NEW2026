<script setup>
import { useToastStore } from '@/stores/toast'
import { useRouter } from 'vue-router'
import { X, ExternalLink, Trophy, XCircle, Binoculars, BadgeCheck, Coins, Crown, CalendarCheck, Medal, TrendingUp, Download } from 'lucide-vue-next'

const toastStore = useToastStore()
const router = useRouter()

// Achievement type → icon. Mirrors the Dashboard Recent Activity mapping.
const ACHIEVEMENT_ICONS = {
  championship: Trophy,
  conference_championship: Crown,
  playoff_berth: CalendarCheck,
  gm_promotion: Medal,
  roster_import: Download,
}
function achievementIcon(type) {
  return ACHIEVEMENT_ICONS[type] || Trophy
}

function formatSignedSalary(salary) {
  if (!salary) return ''
  if (salary >= 1_000_000) return `$${(salary / 1_000_000).toFixed(1)}M`
  return `$${Math.round(salary / 1000)}K`
}

function goToBoxScore(toast) {
  router.push(`/campaign/${toast.campaignId}/game/${toast.gameId}`)
  toastStore.removeToast(toast.id)
}

function goToScouting(toast) {
  if (!toast.campaignId) return
  router.push(`/campaign/${toast.campaignId}/scouting`)
  toastStore.removeToast(toast.id)
}

function goToOwnerTab(toast) {
  if (!toast.campaignId) return
  router.push(`/campaign/${toast.campaignId}/team?tab=owner`)
  toastStore.removeToast(toast.id)
}

function isWin(toast) {
  // Check if user team won based on which side they're on
  if (toast.isUserHome === true) {
    return toast.homeScore > toast.awayScore
  } else if (toast.isUserHome === false) {
    return toast.awayScore > toast.homeScore
  }
  // Fallback: assume home team perspective
  return toast.homeScore > toast.awayScore
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toastStore.toasts"
          :key="toast.id"
          class="toast"
          :class="[
            `toast-${toast.type}`,
            {
              'toast-win': toast.type === 'game-result' && isWin(toast),
              'toast-loss': toast.type === 'game-result' && !isWin(toast),
              'toast-user-pick': toast.type === 'draft-pick' && toast.isUserTeam,
            }
          ]"
        >
          <!-- Game Result Toast -->
          <template v-if="toast.type === 'game-result'">
            <div class="toast-content">
              <div class="game-result-header">FINAL SCORE</div>
              <div class="game-result-score">
                <div class="team-score">
                  <span class="team-name">{{ toast.homeTeam }}</span>
                  <span class="score" :class="{ winner: toast.homeScore > toast.awayScore }">
                    {{ toast.homeScore }}
                  </span>
                </div>
                <span class="score-divider">-</span>
                <div class="team-score">
                  <span class="score" :class="{ winner: toast.awayScore > toast.homeScore }">
                    {{ toast.awayScore }}
                  </span>
                  <span class="team-name">{{ toast.awayTeam }}</span>
                </div>
              </div>
              <div class="toast-footer">
                <button class="box-score-link" @click="goToBoxScore(toast)">
                  <span>View Box Score</span>
                  <ExternalLink :size="14" />
                </button>
                <!-- W/L Indicator -->
                <div class="result-indicator" :class="isWin(toast) ? 'win' : 'loss'">
                  <Trophy v-if="isWin(toast)" :size="14" class="result-icon" />
                  <XCircle v-else :size="14" class="result-icon" />
                  <span class="result-letter">{{ isWin(toast) ? 'W' : 'L' }}</span>
                </div>
              </div>
            </div>
            <button class="toast-close" @click="toastStore.removeToast(toast.id)">
              <X :size="16" />
            </button>
          </template>

          <!-- Weekly Summary Toast -->
          <template v-if="toast.type === 'weekly-summary'">
            <div class="weekly-summary-icon">
              <Binoculars :size="20" />
            </div>
            <div class="toast-content">
              <div class="game-result-header">SCOUTING REPORT</div>
              <div class="weekly-summary-body">
                <span class="weekly-summary-value">+{{ toast.scoutingPointsEarned }}</span>
                <span class="weekly-summary-label">
                  scouting point{{ toast.scoutingPointsEarned !== 1 ? 's' : '' }} earned
                </span>
              </div>
              <div v-if="toast.campaignId" class="toast-footer">
                <button class="box-score-link" @click="goToScouting(toast)">
                  <span>Go to Scouting</span>
                  <ExternalLink :size="14" />
                </button>
              </div>
            </div>
            <button class="toast-close" @click="toastStore.removeToast(toast.id)">
              <X :size="16" />
            </button>
          </template>

          <!-- Draft Pick Toast -->
          <template v-if="toast.type === 'draft-pick'">
            <div
              class="draft-pick-badge"
              :style="{ backgroundColor: toast.teamColor || '#666' }"
            >
              {{ toast.teamAbbr }}
            </div>
            <div class="toast-content">
              <div class="game-result-header">PICK #{{ toast.pickNumber }}</div>
              <div class="draft-pick-player">{{ toast.playerName }}</div>
              <div class="draft-pick-meta">
                <span class="draft-pick-pos">{{ toast.position }}</span>
                <span v-if="toast.overallRating != null" class="draft-pick-ovr">{{ toast.overallRating }} OVR</span>
              </div>
            </div>
            <button class="toast-close" @click="toastStore.removeToast(toast.id)">
              <X :size="16" />
            </button>
          </template>

          <template v-if="toast.type === 'token-award'">
            <div class="token-badge">
              <Coins :size="22" />
            </div>
            <div class="toast-content">
              <div class="game-result-header token-header">{{ toast.label }}</div>
              <div class="token-amount">+{{ Number(toast.amount || 0).toLocaleString() }} tokens</div>
            </div>
            <button class="toast-close" @click="toastStore.removeToast(toast.id)">
              <X :size="16" />
            </button>
          </template>

          <template v-if="toast.type === 'player-signed'">
            <div class="signed-badge">
              <BadgeCheck :size="24" />
            </div>
            <div class="toast-content">
              <div class="game-result-header signed-header">Player Signed</div>
              <div class="draft-pick-player">{{ toast.playerName }}</div>
              <div class="draft-pick-meta">
                <span v-if="toast.position" class="draft-pick-pos">{{ toast.position }}</span>
                <span v-if="toast.overallRating != null" class="draft-pick-ovr">{{ toast.overallRating }} OVR</span>
                <span v-if="toast.salary" class="signed-terms">{{ formatSignedSalary(toast.salary) }} · {{ toast.years }}yr</span>
              </div>
            </div>
            <button class="toast-close" @click="toastStore.removeToast(toast.id)">
              <X :size="16" />
            </button>
          </template>

          <template v-if="toast.type === 'achievement'">
            <div class="achievement-badge" :class="`achievement-badge--${toast.achievementType || 'default'}`">
              <component :is="achievementIcon(toast.achievementType)" :size="22" />
            </div>
            <div class="toast-content">
              <div class="game-result-header achievement-header">{{ toast.header || 'Achievement Unlocked' }}</div>
              <div class="achievement-label">{{ toast.label }}</div>
              <div v-if="toast.subtitle" class="achievement-subtitle">{{ toast.subtitle }}</div>
            </div>
            <button class="toast-close" @click="toastStore.removeToast(toast.id)">
              <X :size="16" />
            </button>
          </template>

          <template v-if="toast.type === 'owner-expectation'">
            <div class="achievement-badge owner-expectation-badge owner-expectation-click" @click="goToOwnerTab(toast)">
              <TrendingUp :size="22" />
            </div>
            <div class="toast-content owner-expectation-click" @click="goToOwnerTab(toast)">
              <div class="game-result-header achievement-header">Owner Expectations Raised</div>
              <div class="achievement-label">
                <template v-if="toast.fromLabel">{{ toast.fromLabel }} → {{ toast.label }}</template>
                <template v-else>New target: {{ toast.label }}</template>
              </div>
              <div class="achievement-subtitle">Fresh coach goals added — the ones you're chasing stay. Tap to view the Owner.</div>
            </div>
            <button class="toast-close" @click.stop="toastStore.removeToast(toast.id)">
              <X :size="16" />
            </button>
          </template>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 90px;
  left: 16px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 360px;
}

@media (min-width: 1024px) {
  .toast-container {
    bottom: 24px;
  }
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
}

.toast-win {
  border-left: 3px solid var(--color-success);
}

.toast-loss {
  border-left: 3px solid var(--color-error);
}

.result-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.result-indicator.win {
  background: rgba(34, 197, 94, 0.15);
  color: var(--color-success);
}

.result-indicator.loss {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-error);
}

.result-icon {
  stroke-width: 2.5;
}

.result-letter {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
}

.toast-content {
  flex: 1;
  min-width: 0;
}

.game-result-header {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}

.game-result-score {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.toast-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.team-score {
  display: flex;
  align-items: center;
  gap: 8px;
}

.team-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.score {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-secondary);
}

.score.winner {
  color: var(--color-text-primary);
}

.score-divider {
  font-size: 1rem;
  color: var(--color-text-tertiary);
}

.box-score-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.box-score-link:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

.toast-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.toast-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

/* Weekly Summary Toast */
.toast-weekly-summary {
  border-left: 3px solid var(--color-primary);
}

.weekly-summary-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(232, 90, 79, 0.15);
  color: var(--color-primary);
  flex-shrink: 0;
}

.weekly-summary-body {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}

.weekly-summary-value {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.4rem;
  font-weight: 700;
  background: var(--gradient-cosmic);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
}

.weekly-summary-label {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

/* Draft Pick Toast */
.toast-draft-pick {
  border-left: 3px solid var(--color-primary);
}

.toast-user-pick {
  border-left: 3px solid var(--color-success);
}

.draft-pick-badge {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.draft-pick-player {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.draft-pick-meta {
  display: flex;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.draft-pick-pos {
  font-weight: 600;
}

/* Token award toast (playoff payouts, etc.) */
.toast-token-award {
  border-left: 3px solid #f5c72c;
}
.token-badge {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f5c72c;
  background: rgba(245, 199, 44, 0.16);
  box-shadow: 0 0 0 2px rgba(245, 199, 44, 0.25);
  flex-shrink: 0;
}
.token-header {
  color: #f5c72c;
}
.token-amount {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

/* Achievement-unlocked toast (championships, playoff berths, GM promotions) */
.toast-achievement {
  border-left: 3px solid #facc15;
}
.achievement-badge {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #facc15;
  background: rgba(250, 204, 21, 0.16);
  box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.25);
  flex-shrink: 0;
}
/* Owner-expectation raise — green "trending up" accent + clickable card. */
.owner-expectation-badge {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.16);
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.25);
}
.owner-expectation-click {
  cursor: pointer;
}
/* Per-type accents, matching the Dashboard Recent Activity colors. */
.achievement-badge--conference_championship {
  color: #a855f7;
  background: rgba(168, 85, 247, 0.16);
  box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.25);
}
.achievement-badge--playoff_berth {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.16);
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25);
}
.achievement-badge--gm_promotion {
  color: #34d399;
  background: rgba(52, 211, 153, 0.16);
  box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.25);
}
.achievement-badge--roster_import {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.16);
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.25);
}
.achievement-header {
  color: #facc15;
}
.achievement-label {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
.achievement-subtitle {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

/* Verified "Player Signed" toast */
.toast-player-signed {
  border-left: 3px solid var(--color-success);
}
.signed-badge {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #22c55e;
  background: rgba(34, 197, 94, 0.16);
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.25);
  flex-shrink: 0;
}
.signed-header {
  color: #22c55e;
}
.signed-terms {
  font-weight: 600;
  color: var(--color-text-secondary);
}

/* Animations */
.toast-enter-active {
  animation: slideIn 0.3s ease-out;
}

.toast-leave-active {
  animation: slideOut 0.3s ease-in;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(-100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideOut {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(-100%);
  }
}
</style>

<!-- Native override: the floating glass bottom nav sits at
     `bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom))` and is 70px tall, so its top
     edge is calc(70px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom))) above the viewport
     bottom. Push toasts above that with a 12px breathing gap. Applies to BOTH
     native platforms (the nav renders on Android too). Non-scoped block so the
     global `html.platform-*` selectors match. Browser (platform-web) keeps the
     existing 90px bottom. -->
<style>
@media (max-width: 1023px) {
  html.platform-ios .toast-container,
  html.platform-android .toast-container {
    bottom: calc(70px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 12px);
  }
}
</style>
