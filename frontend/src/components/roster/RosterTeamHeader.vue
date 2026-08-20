<script setup>
// Team hero header for the Custom Roster editor — shown in a team's roster
// view when NO player row is selected (the player hero's empty state). Logo,
// name, live computed overall ("?" until the roster has rateable players),
// owner snapshot, and the same franchise-totals + season-history info the
// in-game LeagueView team popup renders — with an Edit History entry point.
import { computed } from 'vue'
import { ScrollText, Pencil, Ticket } from 'lucide-vue-next'
import TeamLogo from '@/components/common/TeamLogo.vue'
import OwnerQuickInfo from '@/components/team/OwnerQuickInfo.vue'
import { computeTeamOverall } from '@/utils/teamOverall'
import { t, tDynamic } from '@wl-i18n/i18n.js'

const props = defineProps({
  team: { type: Object, default: null },
  roster: { type: Array, default: () => [] },
  // Current payroll in dollars; null hides the financial line (fantasy mode).
  payroll: { type: Number, default: null },
  salaryCap: { type: Number, default: null },
  // Luxury-tax line: over-cap-but-under-tax is the normal NBA operating band
  // (amber); only above the tax reads as red. Null → legacy 2-tier behavior.
  luxuryTax: { type: Number, default: null },
})

const emit = defineEmits(['edit-history', 'edit-identity', 'edit-draft-picks'])

const overall = computed(() => computeTeamOverall(props.roster))

// Tooltip for the team-overall bubble (computed so it re-renders on locale change).
const ovrTitle = computed(() => overall.value == null
  ? t("Add rated players to compute this team's overall")
  : t('Current team overall'))

const payrollM = computed(() =>
  props.payroll == null ? null : (props.payroll / 1_000_000).toFixed(1))
const capM = computed(() =>
  props.salaryCap == null ? null : `$${Math.round(props.salaryCap / 1_000_000)}M`)
const capTier = computed(() => {
  if (props.payroll == null || props.salaryCap == null) return 'ok'
  if (props.payroll <= props.salaryCap) return 'ok'
  if (props.luxuryTax != null && props.payroll <= props.luxuryTax) return 'warn'
  return 'over'
})
const capTitle = computed(() => ({
  ok: t('Payroll is under the salary cap'),
  warn: t('Payroll is over the cap but under the luxury tax'),
  over: props.luxuryTax != null
    ? t('Payroll is over the luxury tax')
    : t('Payroll is over the salary cap'),
}[capTier.value]))

const franchise = computed(() => props.team?.franchise_history ?? null)

// Read-only facility snapshot (editing lives in-game via token upgrades).
const FACILITY_LABELS = [
  ['training', 'Training'],
  ['medical', 'Medical'],
  ['scouting', 'Scouting'],
  ['analytics', 'Analytics'],
]

const facilities = computed(() => {
  const f = props.team?.facilities ?? {}
  return FACILITY_LABELS.map(([key, label]) => ({ key, label, level: f[key] ?? 1 }))
})

const seasons = computed(() => {
  const list = props.team?.seasonHistory
  if (!Array.isArray(list) || list.length === 0) return []
  return [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
})

const hasHistory = computed(() => !!franchise.value || seasons.value.length > 0)

function pct(bucket) {
  const w = bucket?.wins ?? 0
  const l = bucket?.losses ?? 0
  const total = w + l
  if (total <= 0) return null
  return (Math.round((w / total) * 1000) / 10).toFixed(1)
}

// Mirrors LeagueView's PLAYOFF_RESULT_LABELS / formatSeasonResult so the
// editor previews exactly what the in-game history tab will show.
const PLAYOFF_RESULT_LABELS = {
  champion: 'Champion',
  finals: 'Conference Champion',
  conf_finals: 'Conference Finals',
  round2: 'Conference Semifinals',
  round1: 'First Round',
}

function seasonResult(entry) {
  if (!entry) return '—'
  if (entry.champion) return t('Champion')
  if (entry.playoffResult) return tDynamic(PLAYOFF_RESULT_LABELS[entry.playoffResult] ?? entry.playoffResult)
  if (entry.playoffSeed) return t('Playoffs · #{seed} seed', { seed: entry.playoffSeed })
  return t('Missed playoffs')
}
</script>

<template>
  <div v-if="team" class="rth">
    <!-- data-tour: rse-team-header spotlights the identity/overall/payroll
         block for the roster-editor walkthrough (not the whole card — the
         history section below has its own tip). -->
    <div class="rth-main" data-tour="rse-team-header">
      <div class="rth-left">
        <TeamLogo
          :abbreviation="team.abbreviation"
          :color="team.primaryColor ?? team.primary_color ?? team.color"
          :size="64"
        />
        <div class="rth-info">
          <h3 class="rth-name">
            {{ team.name }}
            <button
              class="rth-rename-btn"
              type="button"
              :title="$t('Rename this team')"
              @click="emit('edit-identity')"
            >
              <Pencil :size="13" />
            </button>
          </h3>
          <span class="rth-abbr">{{ team.abbreviation }} · {{ team.conference }} · {{ team.division }}</span>
        </div>
      </div>
      <div class="rth-right">
        <div
          class="rth-ovr"
          :title="ovrTitle"
        >
          <span class="rth-ovr-num">{{ overall ?? '?' }}</span>
          <span class="rth-ovr-label">OVR</span>
        </div>
        <span
          v-if="payrollM != null"
          class="rth-payroll"
          :class="capTier"
          :title="capTitle"
        >
          {{ payrollM }}M<em v-if="capM"> / {{ capM }}</em>
        </span>
      </div>
    </div>

    <!-- Owner blurb on its own full-width row: freed from the info column so
         the quote flows into the space under the team logo instead of
         wrapping in the narrow strip beside it. -->
    <div class="rth-owner-row" data-tour="rse-owner-row">
      <OwnerQuickInfo :team-abbreviation="team.abbreviation" />
    </div>

    <div class="rth-facilities" :title="$t('Facility levels (upgraded in-game with tokens)')">
      <span class="rth-fac-label">{{ $t('Facilities') }}</span>
      <span v-for="f in facilities" :key="f.key" class="rth-fac">
        {{ $tDynamic(f.label) }} <strong>{{ f.level }}</strong>
      </span>
    </div>

    <div class="rth-history">
      <div class="rth-history-head" data-tour="rse-history-picks">
        <span class="rth-history-title"><ScrollText :size="13" /> {{ $t('Team History') }}</span>
        <button class="rth-edit-btn" @click="emit('edit-draft-picks')">
          <Ticket :size="12" /> {{ $t('Draft Picks') }}
        </button>
        <button class="rth-edit-btn" @click="emit('edit-history')">
          <Pencil :size="12" /> {{ $t('Edit History') }}
        </button>
      </div>

      <p v-if="!hasHistory" class="rth-empty">{{ $t('No completed seasons yet.') }}</p>

      <template v-else>
        <div v-if="franchise" class="rth-totals">
          <span class="rth-stat rth-stat-champ">{{ $t('🏆 {n} Championships', { n: franchise.championships ?? 0 }) }}</span>
          <span class="rth-stat">{{ $t('{n} Conf. Titles', { n: franchise.conference_titles ?? 0 }) }}</span>
          <span class="rth-stat">
            {{ $t('Reg. {w}-{l}', { w: franchise.regular_season?.wins ?? 0, l: franchise.regular_season?.losses ?? 0 }) }}
            <em v-if="pct(franchise.regular_season) != null">({{ pct(franchise.regular_season) }}%)</em>
          </span>
          <span class="rth-stat">
            {{ $t('Playoffs {w}-{l}', { w: franchise.playoffs?.wins ?? 0, l: franchise.playoffs?.losses ?? 0 }) }}
            <em v-if="pct(franchise.playoffs) != null">({{ pct(franchise.playoffs) }}%)</em>
          </span>
        </div>

        <div v-if="seasons.length" class="rth-seasons">
          <div v-for="s in seasons" :key="s.year" class="rth-season-row">
            <span class="rth-season-year">{{ s.year }}</span>
            <span class="rth-season-record">{{ s.wins ?? 0 }}-{{ s.losses ?? 0 }}</span>
            <span class="rth-season-result">{{ seasonResult(s) }}<template v-if="s.champion"> 🏆</template></span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rth {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: var(--radius-xl, 16px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: var(--gradient-cosmic);
  overflow: hidden;
  margin-bottom: 12px;
}

.rth-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.rth-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}

.rth-info { min-width: 0; }

/* Full-width owner row under the logo/name line — gives the owner blurb the
   whole card width instead of the narrow column beside the logo. */
.rth-owner-row {
  margin-top: 8px;
  min-width: 0;
}

/* Ink palette matches SelectedPlayerHeader: dark text on the bright cosmic
   gradient, dark translucent chips with light text. */
.rth-name {
  margin: 0;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.45rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  line-height: 1.1;
  color: #1a1520;
  display: flex;
  align-items: center;
  gap: 6px;
}

.rth-rename-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 7px;
  background: rgba(26, 21, 32, 0.08);
  border: 1px solid rgba(26, 21, 32, 0.18);
  color: #1a1520;
  cursor: pointer;
  flex-shrink: 0;
}

.rth-rename-btn:hover { background: rgba(26, 21, 32, 0.16); }

.rth-abbr {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(26, 21, 32, 0.75);
}

/* OwnerQuickInfo is a shared component styled for normal surfaces — re-ink
   it for the gradient background here. */
.rth :deep(.oqi) { border-top-color: rgba(26, 21, 32, 0.3); }
.rth :deep(.oqi-name) { color: #1a1520; }
.rth :deep(.oqi-mandate),
.rth :deep(.oqi-wealth) { color: rgba(26, 21, 32, 0.75); }

.rth-right {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.rth-ovr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: 8px 14px;
  border-radius: var(--radius-lg, 12px);
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid var(--glass-border);
}

.rth-payroll {
  font-size: 0.74rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  padding: 3px 9px;
  border-radius: var(--radius-full, 999px);
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.rth-payroll em {
  font-style: normal;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
}

.rth-payroll.ok { color: var(--color-success, #4ade80); }
.rth-payroll.warn { color: #f59e0b; }
.rth-payroll.over { color: var(--color-error, #ef4444); }

.rth-ovr-num {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.7rem;
  line-height: 1;
  color: var(--color-primary);
}

.rth-ovr-label {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.65);
}

.rth-facilities {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px 8px;
  border-top: 1px dashed rgba(26, 21, 32, 0.3);
  padding-top: 8px;
}

.rth-fac-label {
  font-size: 0.66rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(26, 21, 32, 0.8);
}

.rth-fac {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full, 999px);
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.85);
}

.rth-fac strong { color: #fff; font-weight: 800; }

.rth-history {
  border-top: 1px dashed rgba(26, 21, 32, 0.3);
  padding-top: 8px;
}

.rth-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.rth-history-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(26, 21, 32, 0.8);
}

.rth-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: var(--radius-full, 999px);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 5px 11px;
  cursor: pointer;
}

.rth-edit-btn:hover { border-color: var(--color-primary); }

.rth-empty {
  margin: 0;
  font-size: 0.78rem;
  color: rgba(26, 21, 32, 0.65);
}

.rth-totals {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-bottom: 6px;
}

.rth-stat {
  font-size: 0.74rem;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: var(--radius-full, 999px);
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
}

.rth-stat em { font-style: normal; color: rgba(255, 255, 255, 0.6); }

.rth-stat-champ { color: #ffc72c; }

.rth-seasons {
  max-height: 132px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rth-season-row {
  display: grid;
  grid-template-columns: 52px 56px 1fr;
  gap: 8px;
  font-size: 0.76rem;
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.22);
  color: #fff;
}

.rth-season-year { font-weight: 800; }
.rth-season-record { font-variant-numeric: tabular-nums; }
.rth-season-result { color: rgba(255, 255, 255, 0.7); }
</style>
