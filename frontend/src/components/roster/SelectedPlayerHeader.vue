<script setup>
import { computed, ref, nextTick } from 'vue'
import { Brush, SlidersHorizontal, Pencil, Check } from 'lucide-vue-next'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import { deriveOverallFromAttributes, derivePotential } from '@/engine/evolution/PlayerEvolution'
import { detectArchetype } from '@/engine/data/archetypes'
import { BADGES } from '@/engine/data/badges'

// Hero panel above the roster attribute table — styled after the in-game
// PlayerDetailModal header (gradient-cosmic card + star field). Reads the
// SAME reactive player object the table mutates, so OVR/POT/archetype update
// live as chevrons fire. "Edit Details" opens the tabbed editor modal.
const props = defineProps({
  player: { type: Object, default: null },
  campaignId: { type: [String, Number], default: null },
  canEditHeadshot: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'edit-headshot', 'edited'])

// Inline quick-edit for the player name. Writes both casings + the combined
// `name`, then reports the edit upward so it joins the dirty/save flow.
const editingName = ref(false)
const editFirst = ref('')
const editLast = ref('')
const firstInput = ref(null)

async function startNameEdit() {
  const p = props.player
  if (!p) return
  editFirst.value = p.firstName ?? p.first_name ?? ''
  editLast.value = p.lastName ?? p.last_name ?? ''
  editingName.value = true
  await nextTick()
  firstInput.value?.focus?.()
}

function confirmNameEdit() {
  const p = props.player
  if (!p) { editingName.value = false; return }
  const first = editFirst.value.trim()
  const last = editLast.value.trim()
  if (first || last) {
    p.firstName = first
    p.first_name = first
    p.lastName = last
    p.last_name = last
    p.name = `${first} ${last}`.trim()
    emit('edited', p)
  }
  editingName.value = false
}

const POSITION_COLORS = {
  PG: '#3b82f6', SG: '#8b5cf6', SF: '#22c55e', PF: '#f59e0b', C: '#ef4444',
}

const ovr = computed(() =>
  props.player ? deriveOverallFromAttributes(props.player.attributes, props.player.position ?? 'SF') : null)
const pot = computed(() => (props.player ? derivePotential(props.player) : null))
const archetype = computed(() => (props.player ? (detectArchetype(props.player)?.name ?? 'Role Player') : ''))

const vitals = computed(() => {
  const p = props.player
  if (!p) return ''
  const hi = p.heightInches ?? p.height_inches ?? 78
  const ht = `${Math.floor(hi / 12)}'${hi % 12}"`
  const wt = p.weightLbs ?? p.weight_lbs ?? '—'
  return `${ht} · ${wt} lbs · ${p.age ?? '—'} yrs`
})

const contractLine = computed(() => {
  const p = props.player
  if (!p) return ''
  const sal = Number(p.contractSalary ?? p.contract_salary) || 0
  const yrs = Number(p.contractYearsRemaining ?? p.contract_years_remaining) || 0
  return `$${(sal / 1_000_000).toFixed(1)}M × ${yrs} yr${yrs === 1 ? '' : 's'}`
})

const badgePreview = computed(() => {
  const owned = props.player?.badges ?? []
  return owned.slice(0, 6).map((b) => ({
    ...b,
    name: BADGES.find((d) => d.id === b.id)?.name ?? b.id,
  }))
})

function posColor(pos) {
  return POSITION_COLORS[pos] ?? '#6B7280'
}
</script>

<template>
  <div v-if="player" class="sph">
    <div class="sph-left">
      <div class="sph-avatar">
        <PlayerAvatar :player="player" :size="84" :campaign-id="campaignId" />
        <button
          v-if="canEditHeadshot"
          class="sph-edit-headshot"
          title="Edit headshot"
          aria-label="Edit headshot"
          @click.stop="emit('edit-headshot', player)"
        >
          <Brush :size="13" />
        </button>
      </div>

      <div class="sph-info">
        <div v-if="editingName" class="sph-name-edit" @click.stop>
          <input
            ref="firstInput"
            v-model="editFirst"
            class="sph-name-input"
            placeholder="First"
            @keyup.enter="confirmNameEdit"
          />
          <input
            v-model="editLast"
            class="sph-name-input"
            placeholder="Last"
            @keyup.enter="confirmNameEdit"
          />
          <button class="sph-name-confirm" aria-label="Confirm name" @click="confirmNameEdit">
            <Check :size="14" />
          </button>
        </div>
        <h3 v-else class="sph-name">
          {{ player.name ?? ((player.firstName ?? '') + ' ' + (player.lastName ?? '')) }}
          <button class="sph-name-pencil" title="Edit name" aria-label="Edit name" @click.stop="startNameEdit">
            <Pencil :size="12" />
          </button>
        </h3>
        <div class="sph-meta">
          <span class="sph-pos" :style="{ backgroundColor: posColor(player.position) }">{{ player.position }}</span>
          <span
            v-if="player.secondaryPosition ?? player.secondary_position"
            class="sph-pos secondary"
          >{{ player.secondaryPosition ?? player.secondary_position }}</span>
          <span
            v-if="player.tertiaryPosition ?? player.tertiary_position"
            class="sph-pos secondary"
          >{{ player.tertiaryPosition ?? player.tertiary_position }}</span>
          <span class="sph-jersey">#{{ player.jerseyNumber ?? player.jersey_number ?? 0 }}</span>
        </div>
        <div class="sph-bio">{{ vitals }}</div>
        <div class="sph-chips">
          <span class="sph-chip">{{ archetype }}</span>
          <span class="sph-chip contract">{{ contractLine }}</span>
        </div>
        <div v-if="badgePreview.length" class="sph-badges">
          <span
            v-for="b in badgePreview"
            :key="b.id"
            class="sph-badge"
            :class="b.level"
            :title="`${b.name} (${(b.level ?? 'bronze').toUpperCase()})`"
          >{{ b.name }}</span>
        </div>
      </div>
    </div>

    <div class="sph-right">
      <div class="sph-ratings">
        <div class="sph-rating">
          <span class="sph-rating-label">OVR</span>
          <span class="sph-rating-value">{{ ovr }}</span>
        </div>
        <div class="sph-rating pot">
          <span class="sph-rating-label">POT</span>
          <span class="sph-rating-value">{{ pot }}</span>
        </div>
      </div>
      <button class="sph-edit-btn" @click="emit('edit', player)">
        <SlidersHorizontal :size="15" /> Edit Details
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Same recipe as PlayerDetailModal's hero: cosmic gradient + faint star field. */
.sph {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-radius: var(--radius-xl, 16px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: var(--gradient-cosmic);
  overflow: hidden;
  margin-bottom: 12px;
}

.sph::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1px 1px at 15% 25%, rgba(255,255,255,0.7), transparent),
    radial-gradient(1px 1px at 45% 70%, rgba(255,255,255,0.5), transparent),
    radial-gradient(1.5px 1.5px at 70% 20%, rgba(255,255,255,0.6), transparent),
    radial-gradient(1px 1px at 90% 60%, rgba(255,255,255,0.5), transparent);
  pointer-events: none;
}

.sph > * {
  position: relative;
  z-index: 1;
}

.sph-left {
  display: flex;
  gap: 14px;
  min-width: 0;
}

.sph-avatar {
  position: relative;
  flex-shrink: 0;
}

.sph-edit-headshot {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  border: 2px solid var(--color-bg-secondary);
  color: #fff;
  cursor: pointer;
  padding: 0;
}

.sph-info {
  min-width: 0;
}

.sph-name {
  margin: 0 0 4px;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #1a1520;
  line-height: 1.05;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sph-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sph-pos {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.68rem;
  font-weight: 800;
  color: #fff;
}

.sph-pos.secondary {
  background: rgba(26, 21, 32, 0.35);
}

.sph-jersey {
  font-size: 0.78rem;
  font-weight: 800;
  color: rgba(26, 21, 32, 0.75);
}

.sph-bio {
  margin-top: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(26, 21, 32, 0.75);
}

.sph-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.sph-chip {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.66rem;
  font-weight: 800;
  background: rgba(26, 21, 32, 0.28);
  color: #fff;
  white-space: nowrap;
}

.sph-chip.contract {
  font-variant-numeric: tabular-nums;
}

.sph-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

/* Dark chips with bright tier-colored text/borders — legible on the cosmic
   gradient (the old translucent-dark-on-gradient chips washed out). */
.sph-badge {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.6rem;
  font-weight: 700;
  background: rgba(26, 21, 32, 0.8);
  color: #e8a76a;
  border: 1px solid #cd7f32; /* bronze default */
  white-space: nowrap;
}

.sph-badge.silver { border-color: #c0c0c0; color: #e2e2e2; }
.sph-badge.gold { border-color: #ffd700; color: #ffd700; }
.sph-badge.hof { border-color: #a855f7; color: #c084fc; }

.sph-name-edit {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.sph-name-input {
  width: 110px;
  min-width: 0;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid rgba(26, 21, 32, 0.35);
  background: rgba(255, 255, 255, 0.85);
  color: #1a1520;
  font-size: 0.9rem;
  font-weight: 700;
}

.sph-name-confirm {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: rgba(26, 21, 32, 0.85);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
}

.sph-name-pencil {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: 4px;
  border-radius: 50%;
  border: none;
  background: rgba(26, 21, 32, 0.35);
  color: #fff;
  cursor: pointer;
  vertical-align: middle;
}

.sph-name-pencil:hover {
  background: rgba(26, 21, 32, 0.6);
}

.sph-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  flex-shrink: 0;
}

.sph-ratings {
  display: flex;
  gap: 8px;
}

.sph-rating {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5px 12px;
  border-radius: 10px;
  background: rgba(26, 21, 32, 0.75);
}

.sph-rating-label {
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.65);
}

.sph-rating-value {
  font-size: 1.25rem;
  font-weight: 800;
  color: #fff;
  line-height: 1.1;
}

.sph-rating.pot .sph-rating-value {
  color: var(--color-success-light, #4ade80);
}

.sph-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  border: none;
  border-radius: 10px;
  background: rgba(26, 21, 32, 0.85);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;
}

.sph-edit-btn:hover {
  background: #1a1520;
}

@media (max-width: 560px) {
  .sph {
    flex-direction: column;
  }

  .sph-right {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
}
</style>
