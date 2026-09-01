<script setup>
import { useToastStore } from '@/stores/toast'
import { useRouter } from 'vue-router'
import { X, ExternalLink, Trophy, XCircle, Binoculars, BadgeCheck, Coins, Crown, CalendarCheck, Medal, TrendingUp, Download, Eye, Sparkles } from 'lucide-vue-next'
import PersonnelAvatar from '@/components/common/PersonnelAvatar.vue'

// Badge tier display labels — canonical strings, translated at render via
// $tDynamic (enumerated in wl-i18n.config.js).
const TIER_LABELS = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', hof: 'HOF' }

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

function goToLeagueTrades(toast) {
  if (!toast.campaignId) return
  router.push(`/campaign/${toast.campaignId}/league?tab=trades`)
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
              <div class="game-result-header">{{ $t('FINAL SCORE') }}</div>
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
                  <span>{{ $t('View Box Score') }}</span>
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
              <div class="game-result-header">{{ toast.aiTrades?.length ? $t('WEEKLY REPORT') : $t('SCOUTING REPORT') }}</div>
              <div v-if="toast.scoutingPointsEarned > 0" class="weekly-summary-body">
                <span class="weekly-summary-value">+{{ toast.scoutingPointsEarned }}</span>
                <span class="weekly-summary-label">
                  {{ toast.scoutingPointsEarned === 1 ? $t('scouting point earned') : $t('scouting points earned') }}
                </span>
              </div>
              <template v-if="toast.aiTrades?.length">
                <div
                  v-for="trade in toast.aiTrades.slice(0, 2)"
                  :key="trade.id"
                  class="weekly-trade-line"
                >
                  <span class="weekly-trade-teams">{{ trade.teamA?.abbr }} ⇄ {{ trade.teamB?.abbr }}</span>
                  {{ (trade.receivedA?.[0] ?? '') }} ↔ {{ (trade.receivedB?.[0] ?? '') }}
                </div>
                <div v-if="toast.aiTrades.length > 2" class="weekly-trade-line weekly-trade-more">
                  {{ toast.aiTrades.length - 2 === 1 ? $t('+{n} more league trade', { n: toast.aiTrades.length - 2 }) : $t('+{n} more league trades', { n: toast.aiTrades.length - 2 }) }}
                </div>
              </template>
              <div v-if="toast.campaignId" class="toast-footer weekly-footer">
                <button v-if="toast.aiTrades?.length" class="box-score-link" @click="goToLeagueTrades(toast)">
                  <span>{{ $t('View Trades') }}</span>
                  <ExternalLink :size="14" />
                </button>
                <button v-if="toast.scoutingPointsEarned > 0" class="box-score-link" @click="goToScouting(toast)">
                  <span>{{ $t('Go to Scouting') }}</span>
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
              <div class="game-result-header">{{ $t('PICK #{n}', { n: toast.pickNumber }) }}</div>
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
              <div class="game-result-header token-header">{{ $tDynamic(toast.label) }}</div>
              <div class="token-amount">{{ $t('+{n} tokens', { n: Number(toast.amount || 0).toLocaleString() }) }}</div>
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
              <div class="game-result-header signed-header">{{ $t('Player Signed') }}</div>
              <div class="draft-pick-player">{{ toast.playerName }}</div>
              <div class="draft-pick-meta">
                <span v-if="toast.position" class="draft-pick-pos">{{ toast.position }}</span>
                <span v-if="toast.overallRating != null" class="draft-pick-ovr">{{ toast.overallRating }} OVR</span>
                <span v-if="toast.salary" class="signed-terms">{{ $t('{salary} · {years}yr', { salary: formatSignedSalary(toast.salary), years: toast.years }) }}</span>
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
              <div class="game-result-header achievement-header">{{ toast.header || $t('Achievement Unlocked') }}</div>
              <div class="achievement-label">{{ $tDynamic(toast.label) }}</div>
              <div v-if="toast.subtitle" class="achievement-subtitle">{{ toast.subtitleTpl ? $tDynamic(toast.subtitleTpl, toast.subtitleParams) : $tDynamic(toast.subtitle) }}</div>
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
              <div class="game-result-header achievement-header">{{ $t('Owner Expectations Raised') }}</div>
              <div class="achievement-label">
                <template v-if="toast.fromLabel">{{ $tDynamic(toast.fromLabel) }} → {{ $tDynamic(toast.label) }}</template>
                <template v-else>{{ $t('New target: {label}', { label: $tDynamic(toast.label) }) }}</template>
              </div>
              <div class="achievement-subtitle">{{ $t("Fresh coach goals added — the ones you're chasing stay. Tap to view the Owner.") }}</div>
            </div>
            <button class="toast-close" @click.stop="toastStore.removeToast(toast.id)">
              <X :size="16" />
            </button>
          </template>

          <!-- Scout Report Toast — full-scout milestone with the hired scout's
               headshot and generated synopsis (tpl/params via $tDynamic). -->
          <template v-if="toast.type === 'scout-report'">
            <div class="scout-report-avatar">
              <PersonnelAvatar
                :personnel="toast.scout"
                kind="scout"
                :size="36"
                :campaign-id="toast.campaignId"
              />
            </div>
            <div class="toast-content">
              <div class="game-result-header scout-report-header">{{ $t('SCOUTING REPORT') }}</div>
              <div class="draft-pick-player">{{ toast.playerName }}</div>
              <div class="scout-report-synopsis">
                <template v-for="(line, i) in toast.synopsis?.lines ?? []" :key="i">{{ i > 0 ? ' ' : '' }}{{ line.tpl ? $tDynamic(line.tpl, line.params) : line.text }}</template>
              </div>
              <div v-if="toast.synopsis?.redFlag" class="scout-report-flag">
                <span class="intel-chip">
                  <Eye :size="11" />
                  {{ $tDynamic('Insider Intel') }}
                </span>
                <span class="scout-report-flag-text">{{ toast.synopsis.redFlag.line.tpl ? $tDynamic(toast.synopsis.redFlag.line.tpl, toast.synopsis.redFlag.line.params) : toast.synopsis.redFlag.line.text }}</span>
              </div>
              <div class="scout-report-attribution">— {{ toast.scout?.name }}</div>
            </div>
            <button class="toast-close" @click="toastStore.removeToast(toast.id)">
              <X :size="16" />
            </button>
          </template>

          <!-- Training Report Toast — training-claim milestone with the hired
               staff trainer's headshot (fallback icon when unhired). -->
          <template v-if="toast.type === 'training-report'">
            <div class="scout-report-avatar training-report-avatar">
              <PersonnelAvatar
                :personnel="toast.trainer"
                kind="staff_trainer"
                :size="36"
                :campaign-id="toast.campaignId"
              />
            </div>
            <div class="toast-content">
              <div class="game-result-header training-report-header">{{ $t('TRAINING COMPLETE') }}</div>
              <div class="draft-pick-player">{{ toast.playerName }}</div>
              <div class="training-badge-row">
                <span class="training-badge-name">{{ $tDynamic(toast.badgeName) }}</span>
                <span class="training-tier-chip" :class="`training-tier-chip--${toast.level}`">{{ $tDynamic(TIER_LABELS[toast.level] ?? toast.level) }}</span>
              </div>
              <div v-if="toast.flavor" class="scout-report-synopsis">{{ toast.flavor.tpl ? $tDynamic(toast.flavor.tpl, toast.flavor.params) : toast.flavor.text }}</div>
              <div v-if="toast.breakthrough" class="scout-report-flag">
                <span class="intel-chip breakthrough-chip">
                  <Sparkles :size="11" />
                  {{ $tDynamic('Breakthrough Training') }}
                </span>
                <span v-if="toast.breakthrough.line" class="scout-report-flag-text breakthrough-text">{{ toast.breakthrough.line.tpl ? $tDynamic(toast.breakthrough.line.tpl, toast.breakthrough.line.params) : toast.breakthrough.line.text }}</span>
              </div>
              <div v-if="toast.trainer?.name" class="scout-report-attribution">— {{ toast.trainer.name }}</div>
            </div>
            <button class="toast-close" @click="toastStore.removeToast(toast.id)">
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

.weekly-trade-line {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.weekly-trade-teams {
  font-weight: 700;
  color: var(--color-text-primary);
  margin-right: 6px;
}

.weekly-trade-more {
  font-style: italic;
  color: var(--color-text-tertiary);
}

.weekly-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
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

/* Scout report toast (full-scout milestone) */
.toast-scout-report {
  border-left: 3px solid var(--color-primary);
}
.scout-report-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(232, 90, 79, 0.15);
  box-shadow: 0 0 0 2px rgba(232, 90, 79, 0.25);
}
.scout-report-header {
  color: var(--color-primary);
}
.scout-report-synopsis {
  font-size: 0.8rem;
  font-style: italic;
  line-height: 1.4;
  color: var(--color-text-secondary);
  margin: 4px 0 6px;
}
.scout-report-flag {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 6px;
}
.intel-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.14);
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.3);
}
.scout-report-flag-text {
  font-size: 0.78rem;
  font-style: italic;
  line-height: 1.4;
  color: #f59e0b;
}
.scout-report-attribution {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

/* Training report toast (training-claim milestone) */
.toast-training-report {
  border-left: 3px solid #FFD700;
}
.training-report-avatar {
  background: rgba(255, 215, 0, 0.14);
  box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.28);
}
.training-report-header {
  color: #FFD700;
}
.training-badge-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.training-badge-name {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
.training-tier-chip {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.training-tier-chip--bronze {
  color: #CD7F32;
  background: rgba(205, 127, 50, 0.14);
  box-shadow: 0 0 0 1px rgba(205, 127, 50, 0.3);
}
.training-tier-chip--silver {
  color: #C0C0C0;
  background: rgba(192, 192, 192, 0.14);
  box-shadow: 0 0 0 1px rgba(192, 192, 192, 0.3);
}
.training-tier-chip--gold {
  color: #FFD700;
  background: rgba(255, 215, 0, 0.14);
  box-shadow: 0 0 0 1px rgba(255, 215, 0, 0.35);
}
.training-tier-chip--hof {
  color: #9333EA;
  background: rgba(147, 51, 234, 0.14);
  box-shadow: 0 0 0 1px rgba(147, 51, 234, 0.35);
}
/* Breakthrough proc — gold restyle of the intel-chip amber pill. */
.breakthrough-chip {
  color: #FFD700;
  background: rgba(255, 215, 0, 0.14);
  box-shadow: 0 0 0 1px rgba(255, 215, 0, 0.35);
}
.breakthrough-text {
  color: #FFD700;
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
