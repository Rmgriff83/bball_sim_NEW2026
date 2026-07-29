<script setup>
// Draft-pick ownership editor (Custom Roster editor) — author which team
// HOLDS each of this team's originating picks (e.g. assign MIL's next two
// firsts to POR). The pick's original_team_abbreviation never changes: it is
// the "via MIL" credit AND the draft-order slot key, so the holder drafts in
// the originator's slot — the engine already honors currentOwnerId.
import { ref, computed, watch } from 'vue'
import { Ticket, Loader2 } from 'lucide-vue-next'
import { pickCalendarYear } from '@/components/trade/tradeAssetFormat'

const props = defineProps({
  show: { type: Boolean, default: false },
  team: { type: Object, default: null },
  teams: { type: Array, default: () => [] },
  campaign: { type: Object, default: null },
})

const emit = defineEmits(['close', 'save'])

const saving = ref(false)

// pickId → selected owner team id (the editable state).
const owners = ref({})

// Silent-discard guard (mirrors the other editor modals).
const confirmDiscard = ref(false)
let _initialSnapshot = ''
function _snapshot() { return JSON.stringify(owners.value) }
function requestClose() {
  if (_snapshot() !== _initialSnapshot) {
    confirmDiscard.value = true
    return
  }
  emit('close')
}

// This team's ORIGINATING picks, wherever they currently live — a pick sits
// on its holder's draftPicks array, so scan the whole league.
const ownPicks = computed(() => {
  if (!props.team) return []
  const out = []
  for (const t of props.teams) {
    for (const p of t.draftPicks ?? []) {
      if (p.original_team_abbreviation === props.team.abbreviation) {
        out.push({ pick: p, holderId: t.id })
      }
    }
  }
  return out.sort((a, b) =>
    (a.pick.year ?? 0) - (b.pick.year ?? 0) || (a.pick.round ?? 0) - (b.pick.round ?? 0))
})

// Picks this team HOLDS that originated elsewhere (read-only context — they
// are edited from the originating team's modal).
const acquiredPicks = computed(() => {
  if (!props.team) return []
  const held = props.teams.find((t) => t.id === props.team.id)?.draftPicks ?? []
  return held
    .filter((p) => p.original_team_abbreviation !== props.team.abbreviation)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.round ?? 0) - (b.round ?? 0))
})

watch(() => props.show, (open) => {
  if (!open || !props.team) return
  const map = {}
  for (const { pick, holderId } of ownPicks.value) map[pick.id] = holderId
  owners.value = map
  confirmDiscard.value = false
  _initialSnapshot = _snapshot()
})

function yearLabel(pick) {
  return pickCalendarYear(pick.year, props.campaign)
}

const sortedTeams = computed(() =>
  [...props.teams].sort((a, b) => (a.abbreviation ?? '').localeCompare(b.abbreviation ?? '')))

function save() {
  if (!props.team || saving.value) return
  saving.value = true
  try {
    const assignments = []
    for (const { pick, holderId } of ownPicks.value) {
      const chosen = owners.value[pick.id]
      if (chosen && chosen !== holderId) {
        assignments.push({ pickId: pick.id, newOwnerId: chosen })
      }
    }
    emit('save', assignments)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show && team" class="tdp-overlay" @click.self="requestClose">
      <div class="tdp-modal">
        <h3><Ticket :size="17" /> {{ team.abbreviation }} — Draft Picks</h3>

        <section class="tdp-section">
          <h4>{{ team.abbreviation }}'s own picks</h4>
          <p v-if="!ownPicks.length" class="tdp-empty">
            No originating picks found for this team.
          </p>
          <div v-for="{ pick } in ownPicks" :key="pick.id" class="tdp-row">
            <span class="tdp-year">{{ yearLabel(pick) }}</span>
            <span class="tdp-round" :class="{ r1: pick.round === 1 }">R{{ pick.round }}</span>
            <span class="tdp-owned-label">owned by</span>
            <select v-model="owners[pick.id]" class="tdp-select">
              <option v-for="t in sortedTeams" :key="t.id" :value="t.id">
                {{ t.abbreviation }}{{ t.id === team.id ? ' (own)' : '' }}
              </option>
            </select>
          </div>
          <p class="tdp-hint">
            Assigning a pick to another team means THEY make that selection in
            the draft — the pick stays credited "via {{ team.abbreviation }}"
            and its slot still follows {{ team.abbreviation }}'s record.
          </p>
        </section>

        <section v-if="acquiredPicks.length" class="tdp-section">
          <h4>Acquired picks</h4>
          <div v-for="pick in acquiredPicks" :key="pick.id" class="tdp-row acquired">
            <span class="tdp-year">{{ yearLabel(pick) }}</span>
            <span class="tdp-round" :class="{ r1: pick.round === 1 }">R{{ pick.round }}</span>
            <span class="tdp-via">via {{ pick.original_team_abbreviation }}</span>
          </div>
          <p class="tdp-hint">
            Edit these from the originating team's Draft Picks panel.
          </p>
        </section>

        <div class="tdp-actions">
          <!-- tdp-cancel: token class for the global dismiss SFX. -->
          <button class="tdp-secondary tdp-cancel" @click="requestClose">Cancel</button>
          <button class="tdp-primary" :disabled="saving" @click="save">
            <Loader2 v-if="saving" :size="15" class="spin" /> Save Picks
          </button>
        </div>
      </div>

      <!-- Unsaved-changes discard confirm -->
      <div v-if="confirmDiscard" class="tdp-discard-overlay">
        <div class="tdp-discard-box">
          <p>Discard unsaved changes to this team's draft picks?</p>
          <div class="tdp-discard-actions">
            <button class="tdp-primary" @click="confirmDiscard = false">Keep editing</button>
            <button class="tdp-secondary tdp-cancel tdp-discard-confirm" @click="confirmDiscard = false; emit('close')">
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tdp-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 20px;
}

.tdp-modal {
  width: 100%;
  max-width: 460px;
  max-height: 86vh;
  overflow-y: auto;
  border-radius: var(--radius-xl, 16px);
  padding: 22px;
  background: var(--glass-bg-elevated, var(--color-bg-secondary));
  border: 1px solid var(--glass-border);
}

.tdp-modal h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  font-size: 1.05rem;
}

.tdp-section { margin-bottom: 16px; }

.tdp-section h4 {
  margin: 0 0 8px;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.tdp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.tdp-year {
  min-width: 46px;
  font-weight: 800;
  font-size: 0.9rem;
}

.tdp-round {
  min-width: 28px;
  text-align: center;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 800;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
}

.tdp-round.r1 {
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.35);
}

.tdp-owned-label {
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
}

.tdp-select {
  flex: 1;
  padding: 6px 9px;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  font-size: 0.85rem;
  min-width: 0;
}

.tdp-via {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.tdp-empty { margin: 0 0 8px; font-size: 0.8rem; color: var(--color-text-tertiary); }

.tdp-hint {
  margin: 8px 0 0;
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--color-text-tertiary);
}

.tdp-actions { display: flex; gap: 10px; justify-content: flex-end; }

.tdp-discard-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  padding: 20px;
}

.tdp-discard-box {
  background: var(--glass-bg-elevated, var(--color-bg-secondary));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl, 16px);
  padding: 20px;
  max-width: 320px;
  text-align: center;
}

.tdp-discard-box p {
  margin: 0 0 14px;
  font-size: 0.92rem;
  color: var(--color-text-primary);
}

.tdp-discard-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.tdp-discard-confirm {
  border-color: rgba(239, 68, 68, 0.5);
  color: var(--color-error, #ef4444);
}

.tdp-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 16px;
  font-weight: 700;
  cursor: pointer;
}

.tdp-primary:disabled { opacity: 0.6; }

.tdp-secondary {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 10px 16px;
  font-weight: 600;
  cursor: pointer;
}

.spin { animation: tdp-spin 0.9s linear infinite; }
@keyframes tdp-spin { to { transform: rotate(360deg); } }
</style>
