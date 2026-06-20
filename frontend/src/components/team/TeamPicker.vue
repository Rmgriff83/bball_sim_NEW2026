<script setup>
// Reusable conference-grid team picker with facilities-tier preview per tile and
// a GM-Level gate: Strong-facility franchises require Silver (2)+, Elite require
// Gold (3)+. Used both for first campaign creation (CampaignsView) and the
// not-extended GM flow (picking a new team to run). Emits the chosen team via
// v-model.
import { computed } from 'vue'
import { Lock } from 'lucide-vue-next'
import { canManageTeamTier, requiredGmLevelForTier, GM_LEVEL_LABEL, GM_LEVEL_SILVER, GM_LEVEL_GOLD } from '@/engine/data/gmLevels'

const props = defineProps({
  modelValue: { type: Object, default: null },
  teams: { type: Array, default: () => [] },
  gmLevel: { type: Number, default: 0 },
  // Hide a team from the grid (e.g. the team the user just left).
  excludeAbbreviation: { type: String, default: null },
})
const emit = defineEmits(['update:modelValue'])

const FACILITY_KEYS = ['training', 'medical', 'scouting', 'analytics']

function facilityAvg(team) {
  const f = team?.facilities
  if (!f) return 0
  return FACILITY_KEYS.reduce((s, k) => s + (f[k] ?? 0), 0) / FACILITY_KEYS.length
}
function facilityStars(team) {
  return Math.max(1, Math.min(5, Math.round(facilityAvg(team))))
}
function facilityTierLabel(team) {
  const avg = facilityAvg(team)
  if (avg >= 4.25) return 'Elite'
  if (avg >= 3.5) return 'Strong'
  if (avg >= 2.75) return 'Average'
  if (avg >= 2.0) return 'Developing'
  return 'Rebuilding'
}

// Strong franchises require Silver+, Elite require Gold+. The required level is
// derived from the team's facility tier; below it, the tile is locked.
function requiredLabel(team) {
  return GM_LEVEL_LABEL[requiredGmLevelForTier(facilityTierLabel(team))]
}
function isLocked(team) {
  return !canManageTeamTier(props.gmLevel, facilityTierLabel(team))
}

const silverLabel = computed(() => GM_LEVEL_LABEL[GM_LEVEL_SILVER])
const goldLabel = computed(() => GM_LEVEL_LABEL[GM_LEVEL_GOLD])

function teamsByConference(conference) {
  return (props.teams || []).filter(
    (t) => t.conference === conference && t.abbreviation !== props.excludeAbbreviation
  )
}

function selectTeam(team) {
  if (isLocked(team)) return
  emit('update:modelValue', team)
}

function isSelected(team) {
  return props.modelValue?.abbreviation === team.abbreviation
}
</script>

<template>
  <div class="team-picker">
    <p v-if="gmLevel < GM_LEVEL_GOLD" class="gate-note">
      <Lock :size="12" /> Strong franchises require GM Level {{ silverLabel }}+, Elite require {{ goldLabel }}+.
    </p>

    <div
      v-for="conf in [{ key: 'east', label: 'Eastern Conference' }, { key: 'west', label: 'Western Conference' }]"
      :key="conf.key"
      class="conference-section"
    >
      <h4 class="conference-title">{{ conf.label }}</h4>
      <div class="teams-grid">
        <button
          v-for="team in teamsByConference(conf.key)"
          :key="team.abbreviation"
          type="button"
          class="team-option"
          :class="{ selected: isSelected(team), locked: isLocked(team) }"
          :disabled="isLocked(team)"
          :title="isLocked(team) ? `Requires GM Level ${requiredLabel(team)}+` : ''"
          @click="selectTeam(team)"
        >
          <div class="team-option-badge" :style="{ backgroundColor: team.primary_color }">
            {{ team.abbreviation }}
          </div>
          <span class="team-option-city">{{ team.city }}</span>
          <span class="team-option-tier">
            <span class="tier-stars" :title="`Facilities: ${facilityTierLabel(team)}`">
              <span
                v-for="i in 5"
                :key="i"
                class="star"
                :class="{ filled: i <= facilityStars(team) }"
              >&#9733;</span>
            </span>
            <span class="tier-label">{{ facilityTierLabel(team) }}</span>
          </span>
          <span v-if="isLocked(team)" class="lock-chip"><Lock :size="10" /> {{ requiredLabel(team) }}+</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gate-note {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0 0 0.85rem;
  font-size: 0.72rem;
  color: var(--color-warning, #f59e0b);
}

.conference-section {
  margin-bottom: 1.25rem;
}
.conference-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}
.teams-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
}
.team-option {
  position: relative;
  padding: 0.5rem;
  background: var(--color-bg-tertiary);
  border: 2px solid transparent;
  border-radius: var(--radius-lg);
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
}
.team-option:hover:not(.locked) {
  border-color: var(--color-primary);
}
.team-option.selected {
  border-color: var(--color-primary);
  background: rgba(232, 90, 79, 0.1);
}
.team-option.locked {
  opacity: 0.45;
  cursor: not-allowed;
}
.team-option-badge {
  width: 32px;
  height: 32px;
  margin: 0 auto 0.35rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: 0.6rem;
  font-weight: 700;
  color: white;
}
.team-option-city {
  display: block;
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.team-option-tier {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  margin-top: 3px;
}
.tier-stars {
  display: inline-flex;
  line-height: 1;
}
.tier-stars .star {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.15);
}
.tier-stars .star.filled {
  color: #ffc72c;
  text-shadow: 0 0 6px rgba(255, 199, 44, 0.4);
}
.tier-label {
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
  font-weight: 700;
}
.lock-chip {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(245, 199, 44, 0.16);
  color: #f5c72c;
  font-size: 0.52rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}
@media (max-width: 560px) {
  .teams-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
