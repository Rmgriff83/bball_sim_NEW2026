<script setup>
import { computed, ref, onBeforeUnmount } from 'vue'
import { ChevronUp, ChevronDown, X } from 'lucide-vue-next'
import { CANONICAL_ATTRIBUTES } from '@/engine/data/attributeSchema'
import { deriveOverallFromAttributes, derivePotential } from '@/engine/evolution/PlayerEvolution'

// Bulk attribute grid for the Roster Editor. Rows = players; columns = the 40
// canonical attributes grouped by category. Tapping a row selects it (drives
// the hero header) and reveals per-cell up/down chevrons on THAT row only, so
// a whole team can be authored from one view. `mode` switches between editing
// current values and growth ceilings. All edits mutate the shared reactive
// player objects and report dirtiness upward — persistence stays in the store.
const props = defineProps({
  players: { type: Array, required: true },
  selectedId: { type: [String, Number], default: null },
  mode: { type: String, default: 'current' }, // 'current' | 'ceiling'
  removable: { type: Boolean, default: true },
})

const emit = defineEmits(['select', 'edited', 'remove'])

const CATEGORIES = [
  { key: 'offense', label: 'Offense' },
  { key: 'defense', label: 'Defense' },
  { key: 'physical', label: 'Physical' },
  { key: 'mental', label: 'Mental' },
]

// Compact column headers derived from the attribute keys ("threePoint" → "3PT"
// style abbreviations where obvious, else split words).
const SHORT_LABELS = {
  closeShot: 'Close', midRange: 'Mid', threePoint: '3PT', freeThrow: 'FT',
  shotIQ: 'Shot IQ', offensiveConsistency: 'O.Cons', layup: 'Layup',
  standingDunk: 'S.Dunk', drivingDunk: 'D.Dunk', postHook: 'Hook',
  postFade: 'Fade', postControl: 'P.Ctrl', drawFoul: 'Draw', hands: 'Hands',
  ballHandling: 'Handle', speedWithBall: 'SpdBall', passAccuracy: 'P.Acc',
  passVision: 'P.Vis', passIQ: 'P.IQ',
  interiorDefense: 'Int D', perimeterDefense: 'Per D', steal: 'Steal',
  block: 'Block', offensiveRebound: 'OReb', defensiveRebound: 'DReb',
  helpDefenseIQ: 'Help IQ', passPerception: 'P.Perc', defensiveConsistency: 'D.Cons',
  speed: 'Speed', acceleration: 'Accel', strength: 'Str', vertical: 'Vert',
  stamina: 'Stam', hustle: 'Hustle', durability: 'Dur',
  basketballIQ: 'BBIQ', clutch: 'Clutch', workEthic: 'Work', coachability: 'Coach',
  intangibles: 'Intang',
}

function label(key) {
  return SHORT_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').trim()
}

// Full attribute name for the header tooltip ("D.Dunk" → "Driving Dunk").
function fullLabel(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bI Q\b/g, 'IQ')
    .trim()
}

// Tap-to-reveal tooltip on the abbreviated column headers (hover title alone
// doesn't work on touch). Tapping the same header again — or waiting a few
// seconds — dismisses it.
const tipKey = ref(null)
let tipTimer = null

function toggleTip(key) {
  clearTimeout(tipTimer)
  if (tipKey.value === key) {
    tipKey.value = null
    return
  }
  tipKey.value = key
  tipTimer = setTimeout(() => { tipKey.value = null }, 2500)
}

// Press-and-hold on a chevron auto-repeats the tick: one immediate bump on
// press, then after a short delay it repeats — accelerating after the first
// dozen ticks so long ramps (25→99) don't take forever. All pointer-event
// driven (works for touch + mouse); any release/cancel/leave stops it.
const HOLD_DELAY_MS = 400
const HOLD_TICK_MS = 90
const HOLD_FAST_TICK_MS = 35
const HOLD_FAST_AFTER = 12
let holdTimer = null
let holdInterval = null

function clearHold() {
  clearTimeout(holdTimer)
  clearInterval(holdInterval)
  holdTimer = null
  holdInterval = null
}

function startHold(p, cat, key, delta) {
  clearHold()
  bump(p, cat, key, delta) // immediate tick on press
  let ticks = 0
  const startInterval = (ms) => setInterval(() => {
    bump(p, cat, key, delta)
    ticks++
    if (ticks === HOLD_FAST_AFTER && ms === HOLD_TICK_MS) {
      clearInterval(holdInterval)
      holdInterval = startInterval(HOLD_FAST_TICK_MS)
    }
  }, ms)
  holdTimer = setTimeout(() => {
    holdInterval = startInterval(HOLD_TICK_MS)
  }, HOLD_DELAY_MS)
}

onBeforeUnmount(() => {
  clearTimeout(tipTimer)
  clearHold()
})

const isCeiling = computed(() => props.mode === 'ceiling')

function cellValue(p, cat, key) {
  if (isCeiling.value) {
    return p.attributeCaps?.[cat]?.[key] ?? p.attributes?.[cat]?.[key] ?? 0
  }
  return p.attributes?.[cat]?.[key] ?? 0
}

function bump(p, cat, key, delta) {
  if (!p.attributes?.[cat]) return
  p.attributeCaps = p.attributeCaps ?? {}
  p.attributeCaps[cat] = p.attributeCaps[cat] ?? {}
  const cur = p.attributes[cat][key] ?? 25
  const cap = p.attributeCaps[cat][key] ?? cur

  if (isCeiling.value) {
    // Ceilings float in [current, 99].
    p.attributeCaps[cat][key] = Math.max(cur, Math.min(99, cap + delta))
  } else {
    // Current floats in [25, 99]; raising it above its ceiling drags the
    // ceiling up with it (a cap below current is never allowed).
    const next = Math.max(25, Math.min(99, cur + delta))
    p.attributes[cat][key] = next
    if ((p.attributeCaps[cat][key] ?? next) < next) p.attributeCaps[cat][key] = next
  }
  emit('edited', p)
}

function ovr(p) {
  return deriveOverallFromAttributes(p.attributes, p.position ?? 'SF')
}

function pot(p) {
  return derivePotential(p)
}

function money(p) {
  const sal = Number(p.contractSalary ?? p.contract_salary) || 0
  const yrs = Number(p.contractYearsRemaining ?? p.contract_years_remaining) || 0
  return `$${(sal / 1_000_000).toFixed(1)}M ×${yrs}y`
}
</script>

<template>
  <div class="rat-wrap">
    <div class="rat-scroll">
      <table class="rat-table">
        <thead>
          <!-- Category group headers -->
          <tr class="rat-group-row">
            <th class="rat-identity-col rat-sticky" rowspan="2">Player</th>
            <th
              v-for="cat in CATEGORIES"
              :key="cat.key"
              class="rat-group-th"
              :colspan="CANONICAL_ATTRIBUTES[cat.key].length"
            >
              {{ cat.label }}
            </th>
            <th v-if="removable" class="rat-remove-th" rowspan="2"></th>
          </tr>
          <!-- Attribute headers (tap for the full attribute name) -->
          <tr class="rat-attr-row">
            <template v-for="cat in CATEGORIES" :key="cat.key">
              <th
                v-for="key in CANONICAL_ATTRIBUTES[cat.key]"
                :key="key"
                class="rat-attr-th"
                :title="fullLabel(key)"
                @click="toggleTip(key)"
              >
                {{ label(key) }}
                <span v-if="tipKey === key" class="rat-tip">{{ fullLabel(key) }}</span>
              </th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in players"
            :key="p.id"
            class="rat-row"
            :class="{ selected: p.id === selectedId }"
            @click="emit('select', p)"
          >
            <!-- Sticky identity cell -->
            <td class="rat-identity-col rat-sticky">
              <span class="rat-name">{{ p.name ?? ((p.firstName ?? '') + ' ' + (p.lastName ?? '')) }}</span>
              <span class="rat-sub">
                <span class="rat-pos">{{ p.position }}</span>
                <span class="rat-mini">OVR <strong>{{ ovr(p) }}</strong></span>
                <span class="rat-mini pot">POT <strong>{{ pot(p) }}</strong></span>
              </span>
              <span class="rat-money">{{ money(p) }}</span>
            </td>

            <!-- Attribute cells -->
            <template v-for="cat in CATEGORIES" :key="cat.key">
              <td
                v-for="key in CANONICAL_ATTRIBUTES[cat.key]"
                :key="key"
                class="rat-cell"
                :class="{ ceiling: isCeiling }"
              >
                <template v-if="p.id === selectedId">
                  <span class="rat-cell-edit" @click.stop>
                    <button
                      class="rat-chev"
                      @pointerdown.stop.prevent="startHold(p, cat.key, key, 1)"
                      @pointerup="clearHold"
                      @pointerleave="clearHold"
                      @pointercancel="clearHold"
                      @click.stop.prevent
                      @contextmenu.prevent
                    >
                      <ChevronUp :size="12" />
                    </button>
                    <span class="rat-val">{{ cellValue(p, cat.key, key) }}</span>
                    <button
                      class="rat-chev"
                      @pointerdown.stop.prevent="startHold(p, cat.key, key, -1)"
                      @pointerup="clearHold"
                      @pointerleave="clearHold"
                      @pointercancel="clearHold"
                      @click.stop.prevent
                      @contextmenu.prevent
                    >
                      <ChevronDown :size="12" />
                    </button>
                  </span>
                </template>
                <template v-else>
                  <span class="rat-val plain">{{ cellValue(p, cat.key, key) }}</span>
                </template>
              </td>
            </template>

            <td v-if="removable" class="rat-remove-td">
              <button class="rat-remove" title="Remove player" @click.stop="emit('remove', p)">
                <X :size="13" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!players.length" class="rat-empty">No players yet.</p>
  </div>
</template>

<style scoped>
.rat-wrap {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--glass-bg);
  overflow: hidden;
}

.rat-scroll {
  overflow-x: auto;
  max-height: 62vh;
  overflow-y: auto;
}

.rat-table {
  border-collapse: separate;
  border-spacing: 0;
  width: max-content;
  min-width: 100%;
  font-size: 0.78rem;
}

thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--color-bg-secondary);
}

.rat-group-row .rat-group-th {
  padding: 6px 8px;
  font-size: 0.66rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--glass-border);
  border-left: 2px solid var(--glass-border);
  text-align: left;
}

.rat-attr-row .rat-attr-th {
  position: sticky;
  padding: 4px 6px;
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid var(--glass-border);
  white-space: nowrap;
  top: 25px; /* below the group row */
  cursor: pointer;
}

/* Tap tooltip: full attribute name pinned under its header cell. */
.rat-tip {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  padding: 4px 9px;
  border-radius: 6px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-primary);
  color: var(--color-text-primary);
  font-size: 0.68rem;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: var(--shadow-md);
  pointer-events: none;
}

.rat-identity-col {
  min-width: 148px;
  max-width: 172px;
  text-align: left;
  padding: 6px 10px;
  vertical-align: middle;
}

.rat-sticky {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--glass-border);
}

thead .rat-sticky {
  z-index: 4; /* above both axes */
}

.rat-row {
  cursor: pointer;
  transition: background 0.15s ease;
}

.rat-row td {
  border-bottom: 1px solid var(--glass-border);
  transition: padding 0.18s ease;
}

.rat-row:hover td {
  background: rgba(232, 90, 79, 0.05);
}

.rat-row:hover .rat-sticky {
  background: var(--color-bg-tertiary);
}

/* Selected row: grows via vertical padding (pushes neighbors — never
   overlaps) with a subtle accent ring drawn by borders. */
.rat-row.selected td {
  padding-top: 8px;
  padding-bottom: 8px;
  background: rgba(232, 90, 79, 0.09);
  border-top: 1px solid var(--color-primary);
  border-bottom: 1px solid var(--color-primary);
}

.rat-row.selected .rat-sticky {
  background: var(--color-bg-tertiary);
  border-right-color: var(--color-primary);
}

.rat-name {
  display: block;
  font-weight: 700;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rat-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.rat-pos {
  font-size: 0.62rem;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
}

.rat-mini {
  font-size: 0.62rem;
  color: var(--color-text-secondary);
}

.rat-mini strong {
  color: var(--color-text-primary);
}

.rat-mini.pot strong {
  color: var(--color-success);
}

.rat-money {
  display: block;
  margin-top: 2px;
  font-size: 0.6rem;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.rat-cell {
  padding: 4px 6px;
  text-align: center;
  min-width: 42px;
}

.rat-cell.ceiling .rat-val {
  color: var(--color-success);
}

.rat-val {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--color-text-primary);
}

.rat-val.plain {
  font-weight: 500;
  color: var(--color-text-secondary);
}

.rat-cell-edit {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.rat-chev {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 15px;
  padding: 0;
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  /* Hold-to-repeat: don't let a long-press start a scroll, select text, or
     pop the iOS callout. */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.rat-chev:hover {
  background: var(--color-primary);
  color: #fff;
}

.rat-remove-th,
.rat-remove-td {
  min-width: 34px;
  text-align: center;
}

.rat-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error);
  cursor: pointer;
}

.rat-empty {
  padding: 18px;
  text-align: center;
  color: var(--color-text-secondary);
  margin: 0;
}
</style>
