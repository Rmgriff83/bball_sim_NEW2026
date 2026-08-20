<template>
  <div class="coach-overview">
    <!-- Row 1 — the strip. Coach + scheme chips always visible; the
         contextual area is buttons-only (the stoppage reason lives in the
         centered canvas bubble, not here). Coach name yields during breaks
         so everything fits the canvas width. -->
    <div class="co-strip">
      <!-- The whole cluster is the tap target for the coaching panel (same as
           the clipboard button). The clipboard's own click just bubbles here. -->
      <div
        class="co-cluster"
        data-tour="game-live-cluster"
        :class="{ 'is-clickable': allowSubs }"
        role="button"
        :aria-disabled="!allowSubs"
        :title="allowSubs ? 'Subs & adjustments' : null"
        @click="allowSubs && emit('open-adjust')"
      >
        <div class="co-avatar" :style="{ borderColor: teamColor }">
          <CoachAvatar :coach="coach" :size="34" :campaign-id="campaignId" />
          <span v-if="coachOverall != null" class="co-ovr-badge">{{ coachOverall }}</span>
        </div>
        <span class="co-coach-name">{{ coachLastName }}</span>
        <button
          class="co-action-btn co-clipboard-btn"
          data-tour="game-live-clipboard"
          :disabled="!allowSubs"
          :title="$t('Subs & adjustments')"
          aria-label="Subs & adjustments"
        >
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <circle cx="9" cy="14" r="2" />
            <path d="m13.5 12 4 4" />
            <path d="m17.5 12-4 4" />
          </svg>
        </button>
        <span class="co-chip co-chip-offense">{{ $tDynamic(offenseChipLabel) }}</span>
        <span class="co-chip co-chip-defense">{{ $tDynamic(defenseChipLabel) }}</span>
      </div>

      <span class="co-spacer"></span>

      <div class="co-break-actions">
        <button
          class="co-timeout-btn"
          data-tour="game-live-timeout"
          :class="{ 'is-ready': timeoutReady && !timeoutArmed, 'is-armed': timeoutArmed }"
          :disabled="!timeoutReady && !timeoutArmed"
          :title="timeoutTitle"
          @click="emit('toggle-timeout')"
        >
          <span class="co-to-pips" aria-hidden="true">
            <span
              v-for="n in timeoutsTotal"
              :key="n"
              class="co-to-pip"
              :class="{ 'is-lit': n <= timeoutsRemaining }"
            ></span>
          </span>
          <Check v-if="timeoutArmed" :size="11" />
          <!-- i18n-ignore -->
          <span class="co-to-label">TO</span>
          <span class="co-to-count">{{ timeoutsRemaining }}</span>
        </button>
        <button
          class="co-action-btn co-action-continue"
          :disabled="!isStoppage || simulating"
          :title="$t('Continue')"
          aria-label="Continue"
          @click="emit('continue')"
        >
          <span v-if="simulating" class="co-btn-loading"></span>
          <Play v-else :size="14" fill="currentColor" stroke="none" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Check, Play } from 'lucide-vue-next'
import CoachAvatar from '@/components/common/CoachAvatar.vue'
import { t } from '@wl-i18n/i18n.js'

// The live-game "Coach Overview" strip: sits INSIDE the court container,
// spanning only the canvas width — the exact slot the old animation-controls
// bar occupied. One thin contextual row (live ⇄ break states); per-player
// fatigue lives in the live stat cards beside the court, not here. Purely
// presentational — all state lives in GameView, which passes props and
// reacts to the emits.
const props = defineProps({
  coach: { type: Object, default: null },
  campaignId: { type: [String, Number], default: null },
  teamCity: { type: String, default: '' },
  teamName: { type: String, default: '' },
  teamColor: { type: String, default: '#6B7280' },
  offenseLabel: { type: String, default: '—' },
  defenseLabel: { type: String, default: '—' },
  isStoppage: { type: Boolean, default: false },
  timeoutsRemaining: { type: Number, default: 0 },
  timeoutsTotal: { type: Number, default: 4 },
  timeoutArmed: { type: Boolean, default: false },
  allowTimeout: { type: Boolean, default: false },
  allowSubs: { type: Boolean, default: false },
  simulating: { type: Boolean, default: false },
})

const emit = defineEmits(['continue', 'toggle-timeout', 'open-subs', 'open-adjust'])

const coachLastName = computed(() => {
  const parts = String(props.coach?.name || 'Coach').trim().split(/\s+/)
  return parts[parts.length - 1]
})

// Chip-only label compaction — the strip chips are tiny, so long scheme names
// shorten HERE ONLY (pills elsewhere keep the full labels):
// "Isolation Heavy" → "Iso Heavy", "Post Centric" → "Post"; zone defenses drop
// the word ("Zone 2-3" → "2-3"), "Full Court Press" → "Press", "Man-to-Man" → "Man".
const OFFENSE_CHIP_LABELS = {
  'Isolation Heavy': 'Iso Heavy',
  'Post Centric': 'Post',
}

const offenseChipLabel = computed(() =>
  OFFENSE_CHIP_LABELS[props.offenseLabel] ?? props.offenseLabel
)

const DEFENSE_CHIP_LABELS = {
  'Full Court Press': 'Press',
  'Man-to-Man': 'Man',
}

const defenseChipLabel = computed(() =>
  DEFENSE_CHIP_LABELS[props.defenseLabel] ?? props.defenseLabel.replace(/^Zone\s+/i, '')
)

// Coach overall — tolerate every save shape (snake_case, camelCase, or the
// authored `overall` on data/coaches.js). Null when unknown so we hide the badge.
const coachOverall = computed(() => {
  const c = props.coach
  return c?.overall_rating ?? c?.overallRating ?? c?.overall ?? null
})

// GameView encodes full availability in allowTimeout: at a dead ball it's the
// engine's gate (timeout fires immediately); mid-play it means "can be armed
// to fire at the next dead ball". The pill dims when neither applies.
const timeoutReady = computed(() => props.allowTimeout)

const timeoutTitle = computed(() => {
  if (props.timeoutArmed) return t('Timeout armed — will be called at the next dead ball. Tap to cancel.')
  if (timeoutReady.value && !props.isStoppage) return t('Call a timeout at the next dead ball')
  if (timeoutReady.value) return t('Call a timeout')
  return t('No timeout available right now')
})
</script>

<style scoped>
.coach-overview {
  width: 100%;
  max-width: 500px;
  border-radius: 10px;
  background: rgba(20, 22, 31, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.07);
  padding: 6px 8px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
}

/* ---- Row 1: contextual strip ---- */
.co-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 42px; /* pins the row (cluster height) so the live ⇄ break swap doesn't shift the court */
  min-width: 0;
}

/* ---- Cluster: named grid — avatar spans both rows on the left, name + timeout
   on the top row, OFF/DEF chips on the bottom row. ---- */
.co-cluster {
  display: grid;
  grid-template-columns: auto auto auto;
  grid-template-areas:
    "avatar name to"
    "avatar off  def";
  align-items: center;
  justify-items: start;
  column-gap: 5px;
  row-gap: 3px;
  padding: 3px 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  min-width: 0;
  flex-shrink: 1;
}

/* Whole-cluster tap target for the coaching panel (matches the clipboard btn). */
.co-cluster.is-clickable {
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.co-cluster.is-clickable:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}

.co-avatar {
  grid-area: avatar;
  position: relative; /* anchors the absolute overall badge */
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid;
  background: #1a1f2c;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #5a6478; /* UserCog fallback icon tint */
}

/* Small coach-overall badge pinned to the avatar's bottom-left corner. */
.co-ovr-badge {
  position: absolute;
  bottom: -2px;
  left: -3px;
  min-width: 16px;
  height: 15px;
  padding: 0 3px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: #10131c;
  border: 1.5px solid rgba(255, 255, 255, 0.22);
  color: #fff;
  font-size: 8.5px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.02em;
}

.co-coach-name {
  grid-area: name;
  font-size: 12px;
  margin-top:10px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
}

.co-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 9px;
  font-weight: 800;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Chips are always visible — let them give ground to the break
     actions rather than overflowing the canvas width. */
  flex-shrink: 1;
  min-width: 0;
}

.co-chip-offense {
  grid-area: off;
  background: rgba(239, 106, 79, 0.14);
  border: 1px solid rgba(239, 106, 79, 0.4);
}

.co-chip-defense {
  grid-area: def;
  background: rgba(47, 128, 237, 0.13);
  border: 1px solid rgba(47, 128, 237, 0.4);
}

.co-spacer {
  flex: 1;
}

.co-timeout-btn {
  position: relative; /* anchors the left-border pip strip */
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 3px 9px 3px 14px; /* extra left room for the pip strip */
  border-radius: 7px;
  font-size: 11.5px;
  font-weight: 800;
  line-height: 1.05;
  cursor: pointer;
  flex-shrink: 0;
  color: gray;
  background: rgba(255, 255, 255, 0.08);
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

/* Left-border tally of timeouts left — one pip per timeout, lit while
   available and dimmed once spent. Illumination tracks the button's text
   color so it reads correctly in ready/armed/disabled states. */
.co-to-pips {
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.co-to-pip {
  width: 3px;
  height: 4px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.16);
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.co-to-pip.is-lit {
  background: currentColor;
  box-shadow: 0 0 4px -1px currentColor;
}

.co-to-label {
  font-size: 0.85em;
  letter-spacing: 0.04em;
}

.co-to-count {
  font-size: 1.15em;
}

.co-timeout-btn:disabled {
  cursor: default;
}

.co-timeout-btn.is-ready {
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #e6e9f0;
}

.co-timeout-btn.is-armed {
  background: #d4502f!important;
  border-color: rgba(255, 255, 255, 0.35);
  color: #fff;
  box-shadow: 0 4px 14px -3px rgba(239, 106, 79, 0.95);
}

.co-break-actions {
  display: flex;
  align-self: stretch;   /* fill the strip's full height */
  align-items: stretch;  /* both buttons take that full height */
  flex-direction: row;
  gap: 5px;
  flex-shrink: 0;
}

/* Single clipboard (X's & O's) button — opens subs/adjustments.
   Lives in the cluster's `to` slot (top row, right of the coach name). */
.co-clipboard-btn {
  grid-area: to;
  justify-self: flex-end;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 9px;
}

.co-action-btn {
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: #e6e9f0;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease;
}

.co-action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.co-action-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.co-action-continue {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 54px;
  background: #ef6a4f;
  border-color: transparent;
  color: #fff;
}

.co-action-continue:hover:not(:disabled) {
  background: #f4795f;
}

.co-btn-loading {
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: co-spin 0.7s linear infinite;
  vertical-align: middle;
}

@keyframes co-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 620px){
  .co-coach-name {
    margin-top: 0;
  }
}

/* ── Light mode ──────────────────────────────────────────────────────────
   The strip sits on the page background (above the canvas), so unlike the
   coaches overlay it adapts: light glass shell, dark text, dark-alpha
   borders. The coral armed/continue accents work in both themes. */
[data-theme="light"] .coach-overview {
  background: rgba(0, 0, 0, 0.05);
  border-color: rgba(45, 40, 56, 0.12);
}

[data-theme="light"] .co-cluster {
  background: rgba(45, 40, 56, 0.04);
  border-color: rgba(45, 40, 56, 0.1);
}

[data-theme="light"] .co-cluster.is-clickable:hover {
  background: rgba(45, 40, 56, 0.08);
  border-color: rgba(45, 40, 56, 0.18);
}

[data-theme="light"] .co-avatar {
  background: #f3ece4;
}

[data-theme="light"] .co-ovr-badge {
  border-color: rgba(255, 255, 255, 0.7);
}

[data-theme="light"] .co-coach-name {
  color: #2d2838;
}

[data-theme="light"] .co-chip-offense {
  color: #b3402c;
  background: rgba(239, 106, 79, 0.12);
}

[data-theme="light"] .co-chip-defense {
  color: #1d5cb5;
  background: rgba(47, 128, 237, 0.1);
}

[data-theme="light"] .co-timeout-btn {
  background: rgba(45, 40, 56, 0.06);
}

[data-theme="light"] .co-timeout-btn.is-ready {
  border-color: rgba(45, 40, 56, 0.2);
  color: #2d2838;
}

[data-theme="light"] .co-to-pip {
  background: rgba(45, 40, 56, 0.18);
}

[data-theme="light"] .co-action-btn {
  border-color: rgba(45, 40, 56, 0.18);
  background: rgba(45, 40, 56, 0.05);
  color: #2d2838;
}

[data-theme="light"] .co-action-btn:hover:not(:disabled) {
  background: rgba(45, 40, 56, 0.1);
}

/* Keep the coral fills (armed timeout / continue) — they read well on light. */
[data-theme="light"] .co-action-continue {
  background: #ef6a4f;
  border-color: transparent;
  color: #fff;
}
</style>
