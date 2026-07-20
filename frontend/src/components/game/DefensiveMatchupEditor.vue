<script setup>
import { ref, computed } from 'vue'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'

const props = defineProps({
  // Opponent's 5 offensive starters (PG→C order), each { id, slotPosition, ... }.
  opponentStarters: { type: Array, default: () => [] },
  // The user's 5 defenders (PG→C order), same shape.
  defenders: { type: Array, default: () => [] },
  // Matchup map: { opponentOffId: userDefenderId } — a full 5-way permutation.
  modelValue: { type: Object, default: () => ({}) },
  // Denser single-column layout for the quarter-break overlay.
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const POS_COLORS = { PG: '#3B82F6', SG: '#8B5CF6', SF: '#10B981', PF: '#F59E0B', C: '#EF4444' }
const posColor = (pos) => POS_COLORS[pos] || '#6B7280'

const idOf = (p) => String(p?.id ?? '')
const lastNameOf = (p) =>
  p?.lastName || p?.last_name || (p?.name ? String(p.name).split(' ').pop() : '') || 'Player'
const ovrOf = (p) => p?.overall_rating ?? p?.overallRating ?? '—'

const defenderById = computed(() => {
  const m = {}
  for (const d of props.defenders) m[idOf(d)] = d
  return m
})

// The defender currently assigned to an opponent (falls back to positional).
function assignedDefender(opponent, index) {
  const map = props.modelValue || {}
  const defId = map[idOf(opponent)]
  if (defId && defenderById.value[String(defId)]) return defenderById.value[String(defId)]
  return props.defenders[index] ?? null
}

const expandedOpp = ref(null)
function toggleRow(oppId) {
  expandedOpp.value = expandedOpp.value === oppId ? null : oppId
}

// Reassign `newDefId` to guard `opponentId`, swapping with whoever currently has
// it so the assignment stays a complete permutation (a swap, not a one-way set).
function pickDefender(opponentId, newDefId) {
  const map = {}
  // Start from the current resolved assignment for every opponent so the map is
  // always complete even if modelValue had gaps.
  props.opponentStarters.forEach((opp, i) => {
    map[idOf(opp)] = idOf(assignedDefender(opp, i))
  })
  const oid = String(opponentId)
  const nid = String(newDefId)
  const prev = map[oid]
  if (prev !== nid) {
    const other = Object.keys(map).find((k) => map[k] === nid)
    if (other) map[other] = prev
    map[oid] = nid
  }
  emit('update:modelValue', map)
  expandedOpp.value = null
}

function isDefault(opponent, index) {
  // True when the assigned defender is the positional default for this slot.
  return idOf(assignedDefender(opponent, index)) === idOf(props.defenders[index])
}
</script>

<template>
  <div class="matchup-editor" :class="{ compact }">
    <div class="me-headers">
      <span class="me-head">Their Offense</span>
      <span class="me-head me-head-right">Your Defender</span>
    </div>

    <div
      v-for="(opp, i) in opponentStarters"
      :key="idOf(opp)"
      class="me-row-wrap"
    >
      <button type="button" class="me-row" @click="toggleRow(idOf(opp))">
        <!-- Opponent (offense) -->
        <span class="me-side">
          <span class="me-avatar-wrap">
            <PlayerAvatar :player="opp" :size="34" />
            <span class="me-pos" :style="{ backgroundColor: posColor(opp.slotPosition) }">{{ opp.slotPosition }}</span>
          </span>
          <span class="me-name">{{ lastNameOf(opp) }}</span>
        </span>

        <span class="me-vs">›</span>

        <!-- Assigned defender -->
        <span class="me-side me-side-right" :class="{ custom: !isDefault(opp, i) }">
          <span class="me-name">{{ lastNameOf(assignedDefender(opp, i)) }}</span>
          <span class="me-avatar-wrap">
            <PlayerAvatar :player="assignedDefender(opp, i)" :size="34" />
            <span class="me-pos" :style="{ backgroundColor: posColor(assignedDefender(opp, i)?.slotPosition || assignedDefender(opp, i)?.position) }">
              {{ assignedDefender(opp, i)?.slotPosition || assignedDefender(opp, i)?.position }}
            </span>
          </span>
        </span>
      </button>

      <!-- Defender picker (swap) -->
      <div v-if="expandedOpp === idOf(opp)" class="me-picker">
        <button
          v-for="d in defenders"
          :key="idOf(d)"
          type="button"
          class="me-pick"
          :class="{ active: idOf(d) === idOf(assignedDefender(opp, i)) }"
          @click="pickDefender(idOf(opp), idOf(d))"
        >
          <PlayerAvatar :player="d" :size="24" />
          <span class="me-pick-name">{{ lastNameOf(d) }}</span>
          <span class="me-pick-pos" :style="{ backgroundColor: posColor(d.slotPosition || d.position) }">
            {{ d.slotPosition || d.position }}
          </span>
          <span class="me-pick-ovr">{{ ovrOf(d) }}</span>
        </button>
      </div>
    </div>

    <p class="me-hint">Tap a row to swap which of your players guards each opponent. Applies on man-to-man defense.</p>
  </div>
</template>

<style scoped>
.matchup-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.me-headers {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-secondary);
  padding: 0 4px;
}
.me-head-right { text-align: right; }

.me-row-wrap {
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.me-row {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text-primary);
}

.me-side {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.me-side-right {
  justify-content: flex-end;
}
.me-side-right.custom .me-name {
  color: #ffd24a;
  font-weight: 700;
}

.me-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}
.me-pos {
  position: absolute;
  bottom: -3px;
  left: -3px;
  font-size: 0.55rem;
  font-weight: 700;
  color: #fff;
  border-radius: 4px;
  padding: 0 3px;
  line-height: 1.2;
}
.me-name {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.me-vs {
  color: var(--color-text-secondary);
  font-size: 1rem;
  font-weight: 700;
}

.me-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.18);
}
.me-pick {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px 4px 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 0.78rem;
}
.me-pick.active {
  border-color: var(--color-primary, #e85a4f);
  background: rgba(232, 90, 79, 0.18);
}
.me-pick-name { font-weight: 600; }
.me-pick-pos {
  font-size: 0.55rem;
  font-weight: 700;
  color: #fff;
  border-radius: 4px;
  padding: 0 3px;
}
.me-pick-ovr {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-text-secondary);
}

.me-hint {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  padding: 2px 4px 0;
  line-height: 1.3;
}

/* Compact (quarter-break) tweaks */
.compact .me-row { padding: 6px 8px; }
.compact .me-name { font-size: 0.78rem; }
.compact .me-hint { display: none; }

/* Light-mode restyle applies only to the standalone (pre-game) instance —
   the compact instance lives inside the dark coaches overlay and must keep
   the dark-mode look in both themes. */
[data-theme='light'] .matchup-editor:not(.compact) .me-row-wrap {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.1);
}
[data-theme='light'] .matchup-editor:not(.compact) .me-picker { background: rgba(0, 0, 0, 0.04); }
[data-theme='light'] .matchup-editor:not(.compact) .me-pick {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.12);
}
</style>
