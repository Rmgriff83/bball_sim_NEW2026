<script setup>
// Team History editor (Custom Roster editor) — authors the two lazy history
// structures the game otherwise builds at season archive time:
//   team.franchise_history  (snake_case totals; CampaignManager shape)
//   team.seasonHistory      (camelCase per-season rows; CampaignManager shape)
// The shapes MUST match archiveSeasonData's exactly so the in-game LeagueView
// History tab (and future archiving, which increments them) work unchanged.
import { ref, watch } from 'vue'
import { ScrollText, Plus, Trash2, Loader2 } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  team: { type: Object, default: null },
  currentSeasonYear: { type: Number, default: null },
})

const emit = defineEmits(['close', 'save'])

// Season result options — mirrors LeagueView's PLAYOFF_RESULT_LABELS plus a
// 'missed' sentinel that stores playoffResult: null.
const RESULT_OPTIONS = [
  { value: 'missed', label: 'Missed playoffs' },
  { value: 'round1', label: 'First Round' },
  { value: 'round2', label: 'Conference Semifinals' },
  { value: 'conf_finals', label: 'Conference Finals' },
  { value: 'finals', label: 'Conference Champion' },
  { value: 'champion', label: 'Champion' },
]

const totals = ref(_emptyTotals())
const seasonRows = ref([])
const saving = ref(false)

// Silent-discard guard (mirrors the player/coach editors): snapshot the
// editable state right after the open-seeding below; any close request with
// changed state asks first.
const confirmDiscard = ref(false)
let _initialSnapshot = ''

function _snapshot() {
  return JSON.stringify({ t: totals.value, s: seasonRows.value })
}

function requestClose() {
  if (_snapshot() !== _initialSnapshot) {
    confirmDiscard.value = true
    return
  }
  emit('close')
}

function _emptyTotals() {
  return {
    championships: 0,
    conference_titles: 0,
    playoff_appearances: 0,
    regWins: 0,
    regLosses: 0,
    poWins: 0,
    poLosses: 0,
  }
}

watch(() => props.show, (open) => {
  if (!open || !props.team) return
  const fh = props.team.franchise_history
  totals.value = {
    championships: fh?.championships ?? 0,
    conference_titles: fh?.conference_titles ?? 0,
    playoff_appearances: fh?.playoff_appearances ?? 0,
    regWins: fh?.regular_season?.wins ?? 0,
    regLosses: fh?.regular_season?.losses ?? 0,
    poWins: fh?.playoffs?.wins ?? 0,
    poLosses: fh?.playoffs?.losses ?? 0,
  }
  const list = Array.isArray(props.team.seasonHistory) ? props.team.seasonHistory : []
  seasonRows.value = [...list]
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .map((s) => ({
      year: s.year ?? null,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      result: s.champion ? 'champion' : (s.playoffResult ?? 'missed'),
      // Preserve archive-written extras so an edit round-trip doesn't drop them.
      conferenceRank: s.conferenceRank ?? null,
      playoffSeed: s.playoffSeed ?? null,
    }))
  confirmDiscard.value = false
  _initialSnapshot = _snapshot()
})

function addSeason() {
  const years = seasonRows.value.map((s) => s.year).filter((y) => Number.isFinite(y))
  const nextYear = years.length
    ? Math.min(...years) - 1
    : (props.currentSeasonYear ?? new Date().getFullYear()) - 1
  seasonRows.value.push({
    year: nextYear, wins: 41, losses: 41, result: 'missed',
    conferenceRank: null, playoffSeed: null,
  })
}

function removeSeason(i) {
  seasonRows.value.splice(i, 1)
}

const clampInt = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)))

function save() {
  if (!props.team || saving.value) return
  saving.value = true
  try {
    const t = totals.value
    // Exact archiveSeasonData shapes — see CampaignManager.
    const franchise = {
      championships: clampInt(t.championships, 0, 9999),
      conference_titles: clampInt(t.conference_titles, 0, 9999),
      playoff_appearances: clampInt(t.playoff_appearances, 0, 9999),
      regular_season: { wins: clampInt(t.regWins, 0, 999999), losses: clampInt(t.regLosses, 0, 999999) },
      playoffs: { wins: clampInt(t.poWins, 0, 99999), losses: clampInt(t.poLosses, 0, 99999) },
    }
    const seasons = seasonRows.value
      .filter((s) => Number.isFinite(Number(s.year)))
      .map((s) => ({
        year: clampInt(s.year, 1947, 2200),
        wins: clampInt(s.wins, 0, 82),
        losses: clampInt(s.losses, 0, 82),
        conferenceRank: s.conferenceRank ?? null,
        playoffSeed: s.playoffSeed ?? null,
        playoffResult: s.result === 'missed' ? null : s.result,
        champion: s.result === 'champion',
      }))
      // Stored ascending like the archive writes them; readers sort anyway.
      .sort((a, b) => a.year - b.year)

    const updated = { ...props.team, franchise_history: franchise, seasonHistory: seasons }
    emit('save', updated)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show && team" class="the-overlay" @click.self="requestClose">
      <div class="the-modal">
        <h3><ScrollText :size="17" /> {{ $t('{team} — Team History', { team: team.name }) }}</h3>

        <section class="the-section">
          <h4>{{ $t('Franchise Totals') }}</h4>
          <div class="the-grid">
            <label>{{ $t('Championships') }}
              <input v-model.number="totals.championships" type="number" min="0" max="9999" />
            </label>
            <label>{{ $t('Conference Titles') }}
              <input v-model.number="totals.conference_titles" type="number" min="0" max="9999" />
            </label>
            <label>{{ $t('Playoff Appearances') }}
              <input v-model.number="totals.playoff_appearances" type="number" min="0" max="9999" />
            </label>
          </div>
          <div class="the-grid">
            <label>{{ $t('Reg. Season W') }}
              <input v-model.number="totals.regWins" type="number" min="0" />
            </label>
            <label>{{ $t('Reg. Season L') }}
              <input v-model.number="totals.regLosses" type="number" min="0" />
            </label>
            <label>{{ $t('Playoff W') }}
              <input v-model.number="totals.poWins" type="number" min="0" />
            </label>
            <label>{{ $t('Playoff L') }}
              <input v-model.number="totals.poLosses" type="number" min="0" />
            </label>
          </div>
        </section>

        <section class="the-section">
          <div class="the-seasons-head">
            <h4>{{ $t('Season History') }}</h4>
            <button class="the-add-btn" @click="addSeason"><Plus :size="13" /> {{ $t('Add season') }}</button>
          </div>
          <p v-if="!seasonRows.length" class="the-empty">{{ $t('No seasons recorded.') }}</p>
          <div v-for="(s, i) in seasonRows" :key="i" class="the-season-row">
            <input v-model.number="s.year" type="number" min="1947" max="2200" class="the-year" :title="$t('Year')" />
            <input v-model.number="s.wins" type="number" min="0" max="82" class="the-wl" :title="$t('Wins')" />
            <span class="the-dash">-</span>
            <input v-model.number="s.losses" type="number" min="0" max="82" class="the-wl" :title="$t('Losses')" />
            <select v-model="s.result" class="the-result">
              <option v-for="o in RESULT_OPTIONS" :key="o.value" :value="o.value">{{ $tDynamic(o.label) }}</option>
            </select>
            <button class="the-remove" :title="$t('Remove season')" @click="removeSeason(i)">
              <Trash2 :size="14" />
            </button>
          </div>
          <p class="the-hint">
            {{ $t("Franchise totals and season rows are stored independently — totals aren't auto-summed from the seasons, matching how the game records them at each season's end.") }}
          </p>
        </section>

        <div class="the-actions">
          <!-- the-cancel: token class for the global dismiss SFX. -->
          <button class="the-secondary the-cancel" @click="requestClose">{{ $t('Cancel') }}</button>
          <button class="the-primary" :disabled="saving" @click="save">
            <Loader2 v-if="saving" :size="15" class="spin" /> {{ $t('Save History') }}
          </button>
        </div>
      </div>

      <!-- Unsaved-changes discard confirm -->
      <div v-if="confirmDiscard" class="the-discard-overlay">
        <div class="the-discard-box">
          <p>{{ $t("Discard unsaved changes to this team's history?") }}</p>
          <div class="the-discard-actions">
            <button class="the-primary" @click="confirmDiscard = false">{{ $t('Keep editing') }}</button>
            <button class="the-secondary the-cancel the-discard-confirm" @click="confirmDiscard = false; emit('close')">
              {{ $t('Discard') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.the-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 20px;
}

.the-modal {
  width: 100%;
  max-width: 520px;
  max-height: 86vh;
  overflow-y: auto;
  border-radius: var(--radius-xl, 16px);
  padding: 22px;
  background: var(--glass-bg-elevated, var(--color-bg-secondary));
  border: 1px solid var(--glass-border);
}

.the-modal h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  font-size: 1.05rem;
}

.the-section { margin-bottom: 16px; }

.the-section h4 {
  margin: 0 0 8px;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.the-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.the-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.the-grid input,
.the-year,
.the-wl,
.the-result {
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  font-size: 0.85rem;
  min-width: 0;
}

.the-seasons-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.the-seasons-head h4 { margin: 0; }

.the-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full, 999px);
  color: var(--color-primary);
  font-size: 0.74rem;
  font-weight: 700;
  padding: 5px 11px;
  cursor: pointer;
}

.the-empty { margin: 0 0 8px; font-size: 0.8rem; color: var(--color-text-tertiary); }

.the-season-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.the-year { width: 74px; }
.the-wl { width: 54px; }
.the-dash { color: var(--color-text-tertiary); }
.the-result { flex: 1; }

.the-remove {
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 6px;
  display: inline-flex;
}

.the-remove:hover { color: var(--color-error, #ef4444); }

.the-hint {
  margin: 8px 0 0;
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--color-text-tertiary);
}

.the-actions { display: flex; gap: 10px; justify-content: flex-end; }

.the-discard-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  padding: 20px;
}

.the-discard-box {
  background: var(--glass-bg-elevated, var(--color-bg-secondary));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl, 16px);
  padding: 20px;
  max-width: 320px;
  text-align: center;
}

.the-discard-box p {
  margin: 0 0 14px;
  font-size: 0.92rem;
  color: var(--color-text-primary);
}

.the-discard-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.the-discard-confirm {
  border-color: rgba(239, 68, 68, 0.5);
  color: var(--color-error, #ef4444);
}

.the-primary {
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

.the-primary:disabled { opacity: 0.6; }

.the-secondary {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 10px 16px;
  font-weight: 600;
  cursor: pointer;
}

.spin { animation: the-spin 0.9s linear infinite; }
@keyframes the-spin { to { transform: rotate(360deg); } }
</style>
