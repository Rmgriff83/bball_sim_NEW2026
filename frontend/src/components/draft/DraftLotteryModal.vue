<script setup>
// Popup modal that shows the rookie draft-lottery results immediately after the
// lottery runs (replacing the old "view results on a separate page" toast link).
// Round-1 order with per-team up/down movement vs the pre-lottery projected pick.
import { computed, watch } from 'vue'
import { X, Star, ArrowUp, ArrowDown, ArrowRightLeft } from 'lucide-vue-next'
import { buildLotteryResultRows } from '@/engine/draft/DraftOrderService'
import TeamLogo from '@/components/common/TeamLogo.vue'
import ApronPickBadge from '@/components/common/ApronPickBadge.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  teams: { type: Array, default: () => [] },
  standings: { type: Object, default: () => ({ east: [], west: [] }) },
  lotteryResult: { type: Object, default: null },
  // Campaign game-year counter — matches the draft picks' `year` so traded picks
  // resolve to their current owner (the draft room uses the same value).
  pickYear: { type: [Number, String], default: null },
})
const emit = defineEmits(['close'])

const rows = computed(() => buildLotteryResultRows(props.teams, props.standings, props.lotteryResult, props.pickYear))
const moversCount = computed(() => rows.value.filter(r => r.deltaDir).length)

function close() {
  emit('close')
}
function handleKeydown(e) {
  if (e.key === 'Escape') close()
}
watch(() => props.show, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) window.addEventListener('keydown', handleKeydown)
  else window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show && lotteryResult" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <header class="modal-header">
            <div class="header-title">
              <Star :size="20" class="title-star" />
              <div>
                <h2>Draft Lottery Results</h2>
                <p class="subtitle">{{ lotteryResult.year }} Rookie Draft</p>
              </div>
            </div>
            <button class="close-btn" @click="close"><X :size="20" /></button>
          </header>

          <p v-if="moversCount" class="movers-line">
            <Star :size="13" />
            {{ moversCount }} {{ moversCount === 1 ? 'team' : 'teams' }} moved from their
            projected slot in the lottery.
          </p>

          <div class="lottery-list">
            <div
              v-for="row in rows"
              :key="row.pick"
              class="lottery-row"
              :class="{ 'lottery-row--in-zone': row.isLotteryTeam }"
            >
              <div class="lottery-row__pick">
                <span class="pick-number">{{ row.pick }}</span>
                <span v-if="row.isLotteryTeam" class="pick-tag">Lottery</span>
                <ApronPickBadge v-if="row.apronFrozen" />
              </div>

              <div class="lottery-row__team">
                <TeamLogo
                  :abbreviation="row.currentOwner?.abbreviation"
                  :color="row.currentOwner?.primary_color"
                  :size="34"
                />
                <div class="team-meta">
                  <span class="team-name">{{ row.currentOwner?.name || row.currentOwner?.abbreviation || '—' }}</span>
                  <span v-if="row.isTraded && row.originalOwner" class="team-via">
                    <ArrowRightLeft :size="11" /> via {{ row.originalOwner.abbreviation }}
                  </span>
                  <span v-else class="team-abbr">{{ row.currentOwner?.abbreviation }}</span>
                </div>
              </div>

              <div class="lottery-row__delta">
                <span
                  v-if="row.deltaLabel"
                  class="delta-badge"
                  :class="row.deltaDir === 'up' ? 'delta-badge--up' : 'delta-badge--down'"
                >
                  <ArrowUp v-if="row.deltaDir === 'up'" :size="14" />
                  <ArrowDown v-else :size="14" />
                  {{ row.deltaLabel }}
                </span>
                <span v-else class="delta-flat">—</span>
              </div>
            </div>
          </div>

          <footer class="modal-footer">
            <button class="btn-confirm" @click="close">Continue</button>
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
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(6px);
}
.modal-container {
  width: 100%;
  max-width: 560px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-secondary, #15171c);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl, 18px);
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px;
  border-bottom: 1px solid var(--glass-border);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(139, 92, 246, 0.04));
}
.header-title {
  display: flex;
  align-items: center;
  gap: 12px;
}
.title-star {
  color: #a78bfa;
  flex-shrink: 0;
}
.header-title h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
.subtitle {
  margin: 2px 0 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}
.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: transparent;
  border: none;
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.close-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}
.movers-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 10px 22px;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--glass-border);
}
.movers-line svg {
  color: #a78bfa;
  flex-shrink: 0;
}
.lottery-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 22px;
  overflow-y: auto;
}
.lottery-row {
  display: grid;
  grid-template-columns: 60px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-md, 8px);
}
.lottery-row--in-zone {
  background: rgba(139, 92, 246, 0.08);
  border-color: rgba(139, 92, 246, 0.2);
}
.lottery-row__pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.pick-number {
  font-size: 1.2rem;
  font-weight: 800;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}
.pick-tag {
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(167, 139, 250, 0.9);
}
.lottery-row__team {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.team-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.team-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.team-abbr {
  font-size: 0.68rem;
  color: var(--color-text-tertiary);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.team-via {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  color: var(--color-text-tertiary);
  font-weight: 600;
  font-style: italic;
}
.lottery-row__delta {
  display: flex;
  justify-content: flex-end;
  min-width: 52px;
}
.delta-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: var(--radius-full, 999px);
  font-variant-numeric: tabular-nums;
}
.delta-badge--up {
  background: rgba(34, 197, 94, 0.16);
  color: #22c55e;
}
.delta-badge--down {
  background: rgba(239, 68, 68, 0.16);
  color: #ef4444;
}
.delta-flat {
  color: var(--color-text-tertiary);
  font-size: 0.85rem;
}
.modal-footer {
  padding: 14px 22px;
  border-top: 1px solid var(--glass-border);
  display: flex;
  justify-content: flex-end;
}
.btn-confirm {
  padding: 10px 24px;
  border-radius: var(--radius-xl);
  font-size: 0.88rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  background: var(--color-primary);
  color: white;
}
.btn-confirm:hover {
  opacity: 0.92;
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
