<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import {
  findOwnerForTeam,
  PATIENCE_LABEL,
  MONEY_CONSCIOUSNESS_LABEL,
  EXPECTATION_BLURB_DEFAULT,
} from '@/engine/data/owners'
import { combinedSatisfaction, injuryReliefWins, capBreachPenalty } from '@/engine/season/OwnerService'
import { evaluateSubtasks } from '@/engine/season/OwnerSubtaskService'
import { getEffectiveExpectation, effectiveOwner } from '@/engine/season/OwnerExpectationService'
import { capNumbersFor, capLineForExpectation } from '@/engine/data/salaryScale'
import { useAuthStore } from '@/stores/auth'
import { gmLevelLabel, gmLevelColor } from '@/engine/data/gmLevels'
import { Crown, Target, Gauge, FileSignature, Wallet, CheckCircle2, Circle, ListChecks, Medal, Banknote } from 'lucide-vue-next'

const props = defineProps({
  campaignId: { type: [String, Number], required: true },
})

const campaignStore = useCampaignStore()
const teamStore = useTeamStore()
const authStore = useAuthStore()

// GM career level (profile-global). Rendered as a colored badge on the owner card.
const gmLevel = computed(() => authStore.gmLevel)
const gmLabel = computed(() => gmLevelLabel(gmLevel.value))
const gmColor = computed(() => gmLevelColor(gmLevel.value))
// Light tiers (silver/gold/platinum) read better with dark text; darker tiers
// (unranked/bronze) with white.
const gmTextColor = computed(() => (gmLevel.value >= 2 ? '#15171c' : '#ffffff'))

const campaign = computed(() => campaignStore.currentCampaign)
const team = computed(() => teamStore.team)
const teamAbbr = computed(() => campaign.value?.teamAbbreviation ?? team.value?.abbreviation ?? null)
const owner = computed(() => findOwnerForTeam(teamAbbr.value))

// Current season record for the user's team (one read; refreshes if the season
// year changes while the tab is mounted).
const currentRecord = ref({ wins: 0, losses: 0 })
async function loadCurrentRecord() {
  const c = campaign.value
  const year = c?.currentSeasonYear ?? c?.current_season_year ?? null
  if (year == null) return
  try {
    const seasonData = await SeasonRepository.get(props.campaignId, year)
    const standings = [
      ...(seasonData?.standings?.east || []),
      ...(seasonData?.standings?.west || []),
    ]
    const s = standings.find(st =>
      (st.teamId ?? st.team_id) === c?.teamId || st.teamAbbreviation === teamAbbr.value
    )
    currentRecord.value = { wins: s?.wins ?? 0, losses: s?.losses ?? 0 }
  } catch {
    currentRecord.value = { wins: 0, losses: 0 }
  }
}
onMounted(loadCurrentRecord)
watch(() => campaign.value?.currentSeasonYear, loadCurrentRecord)

// Most recent archived season (for the satisfaction blend). Empty in season 1.
const lastSeason = computed(() => {
  const hist = team.value?.seasonHistory
  if (!Array.isArray(hist) || hist.length === 0) return null
  return [...hist].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0]
})

// GM contract progress (sub-task counters seeded at sign; default gracefully for
// pre-feature campaigns).
const progress = computed(() => campaign.value?.settings?.gmContract?.progress ?? {})

// Live (dynamic) expectation — ratchets up across seasons; falls back to the
// owner's static baseline for older saves.
const effectiveExpectation = computed(() =>
  owner.value ? getEffectiveExpectation(campaign.value, owner.value) : null
)

// The owner's mandated payroll line — scales with the live expectation tier
// (rebuild → cap … championship → 2nd apron; stingy owners one level tighter).
const ownerCapLine = computed(() => {
  if (!owner.value) return null
  return capLineForExpectation(
    effectiveExpectation.value?.tier,
    capNumbersFor(campaign.value),
    { moneyConsciousness: owner.value.moneyConsciousness },
  )
})

// Sub-tasks: evaluate the owner's per-expectation checklist against current state.
const subtaskResult = computed(() => {
  if (!owner.value) return { subtasks: [], subtaskScore: 0, metCount: 0, total: 0 }
  const settings = campaign.value?.settings ?? {}
  const payroll = teamStore.totalSalary ?? 0
  return evaluateSubtasks({
    owner: owner.value,
    expectation: effectiveExpectation.value?.tier,
    // Additive: show every tier held during this contract (earliest→latest), so
    // goals from an earlier mandate stay even after the bar rose. Backfill old
    // saves with the current tier.
    expectationTiers: campaign.value?.settings?.gmContract?.expectationTiers
      ?? (effectiveExpectation.value?.tier ? [effectiveExpectation.value.tier] : null),
    roster: teamStore.roster ?? [],
    draftPicks: team.value?.draftPicks ?? [],
    facilities: team.value?.facilities ?? null,
    settings,
    payroll,
    progress: progress.value,
    userTeamId: campaign.value?.teamId ?? team.value?.id ?? null,
    coach: teamStore.coach ?? team.value?.coach ?? null,
    salaryCap: capNumbersFor(campaign.value).salaryCap,
    capLine: ownerCapLine.value,
  })
})

const satisfaction = computed(() => {
  if (!owner.value) return null
  return combinedSatisfaction({
    owner: effectiveOwner(owner.value, effectiveExpectation.value?.tier),
    expectedWins: effectiveExpectation.value?.expectedWins,
    currentWins: currentRecord.value.wins,
    currentLosses: currentRecord.value.losses,
    lastSeason: lastSeason.value,
    subtaskScore: subtaskResult.value.subtaskScore,
    contractProgress: contractProgress.value,
    // Owner wrath: live payroll above the mandated line drags the meter now,
    // not just at contract end.
    capBreachPenalty: capBreachPenalty({
      payroll: teamStore.totalSalary ?? 0,
      capLine: ownerCapLine.value,
      capNumbers: capNumbersFor(campaign.value),
      moneyConsciousness: owner.value.moneyConsciousness,
    }),
    // Don't let a star's injury crater the live meter.
    injuryRelief: injuryReliefWins({
      roster: teamStore.roster ?? [],
      teamGames: currentRecord.value.wins + currentRecord.value.losses,
      starPlayerIdsAtSign: progress.value?.starPlayerIdsAtSign ?? [],
      currentYear: campaign.value?.currentSeasonYear ?? campaign.value?.current_season_year ?? null,
    }),
    // Championship goodwill (+15 per title, persisted by the owner congrats).
    bonus: campaign.value?.settings?.ownerSatisfactionBonus ?? 0,
  })
})

const moneyConsciousnessLabel = computed(
  () => MONEY_CONSCIOUSNESS_LABEL[owner.value?.moneyConsciousness] ?? '—'
)

// GM contract — derived years-remaining; falls back gracefully for campaigns
// created before this feature (treat as signed at the current season).
const contract = computed(() => {
  const c = campaign.value
  const gm = c?.settings?.gmContract ?? null
  const year = c?.currentSeasonYear ?? c?.current_season_year ?? null
  const signedYear = gm?.signedSeasonYear ?? year
  const length = gm?.lengthYears ?? 2
  const elapsed = (year != null && signedYear != null) ? Math.max(0, year - signedYear) : 0
  return {
    signedYear,
    length,
    currentYear: year,
    yearsRemaining: Math.max(0, length - elapsed),
    isFinalYear: Math.max(0, length - elapsed) <= 1,
  }
})

// How far through the GM contract we are (0-1): elapsed seasons + this season's
// game fraction, over the contract length. Drives the time-weighting of the
// sub-task contribution to satisfaction so a brand-new contract isn't penalized
// for sub-goals that simply haven't had time to be met yet.
const contractProgress = computed(() => {
  const c = contract.value
  if (!c || !c.length) return 1
  const gp = (currentRecord.value.wins ?? 0) + (currentRecord.value.losses ?? 0)
  const elapsed = (c.currentYear != null && c.signedYear != null)
    ? Math.max(0, c.currentYear - c.signedYear)
    : 0
  const withinSeason = Math.min(1, gp / 82)
  return Math.max(0, Math.min(1, (elapsed + withinSeason) / c.length))
})

const expectationLabel = computed(() => effectiveExpectation.value?.label ?? '—')
// The owner's authored blurb is tied to their ORIGINAL tier. Once expectations
// ratchet up past that tier the bespoke line is stale, so swap to the
// tier-accurate default; while the live tier still matches the baseline, keep
// the flavorful authored text.
const expectationBlurb = computed(() => {
  const o = owner.value
  if (!o) return ''
  const effTier = effectiveExpectation.value?.tier
  if (effTier && effTier !== o.expectation) {
    return EXPECTATION_BLURB_DEFAULT[effTier] ?? o.blurb
  }
  return o.blurb
})
const patienceLabel = computed(() => PATIENCE_LABEL[owner.value?.patience] ?? '—')
const expectedWins = computed(() => effectiveExpectation.value?.expectedWins ?? null)
const ownerName = computed(() => owner.value ? `${owner.value.firstName} ${owner.value.lastName}` : 'Team Owner')
</script>

<template>
  <div class="owner-tab">
    <div v-if="!owner" class="owner-empty">{{ $t('Owner information unavailable for this team.') }}</div>

    <template v-else>
      <!-- Owner identity + satisfaction -->
      <div class="owner-card">
        <div class="owner-head" data-tour="owner-identity">
          <div class="owner-avatar"><Crown :size="26" /></div>
          <div class="owner-id">
            <span class="owner-name">{{ ownerName }}</span>
            <span class="owner-role">{{ $t('Owner · {team}', { team: team?.name }) }}</span>
            <span v-if="owner.wealthSource" class="owner-wealth">
              <Banknote :size="11" /> {{ $tDynamic(owner.wealthSource) }}
            </span>
          </div>
        </div>

        <div v-if="satisfaction" class="sat-block" data-tour="owner-satisfaction">
          <div class="sat-top">
            <span class="sat-title"><Gauge :size="14" /> {{ $t('Owner Satisfaction') }}</span>
            <span class="sat-label" :style="{ color: satisfaction.color }">
              {{ $tDynamic(satisfaction.label) }} · {{ satisfaction.value }}%
            </span>
          </div>
          <div class="sat-meter-bar">
            <div
              class="sat-meter-fill"
              :style="{ width: satisfaction.value + '%', backgroundColor: satisfaction.color }"
            />
          </div>
          <div class="sat-breakdown">
            <span class="sat-chip">{{ $t('Wins {n}%', { n: satisfaction.winsSatisfaction }) }} <em>×60%</em></span>
            <span class="sat-chip">
              {{ $t('Sub-tasks {n}%', { n: satisfaction.subtaskScore }) }}
              <em v-if="satisfaction.subtaskTimeWeight >= 0.999">×40%</em>
              <em v-else>{{ $t('phasing in') }}</em>
            </span>
          </div>
          <p class="sat-hint">
            {{ $t("Blends your record vs the owner's expectations (60%) with the sub-tasks below (40%). Early in your contract the owner gives the sub-tasks time — they weigh in more as the contract progresses, and count in full when your contract is up for review.") }}
          </p>
        </div>
      </div>

      <!-- Expectations -->
      <div class="owner-card" data-tour="owner-expectations">
        <h4 class="section-title"><Target :size="14" /> {{ $t('Expectations') }}</h4>
        <p class="owner-blurb">"{{ $tDynamic(expectationBlurb) }}"</p>
        <div class="exp-grid">
          <div class="exp-item">
            <span class="exp-label">{{ $t('Mandate') }}</span>
            <span class="exp-value">{{ $tDynamic(expectationLabel) }}</span>
          </div>
          <div class="exp-item">
            <span class="exp-label">{{ $t('Expected Wins') }}</span>
            <span class="exp-value">~{{ expectedWins }}</span>
          </div>
          <div class="exp-item">
            <span class="exp-label">{{ $t('Patience') }}</span>
            <span class="exp-value">
              <span class="patience-dots">
                <span
                  v-for="i in 5"
                  :key="i"
                  class="pdot"
                  :class="{ filled: i <= owner.patience }"
                />
              </span>
              {{ $tDynamic(patienceLabel) }}
            </span>
          </div>
          <div class="exp-item">
            <span class="exp-label"><Wallet :size="11" /> {{ $t('Money Consciousness') }}</span>
            <span class="exp-value">
              <span class="patience-dots">
                <span
                  v-for="i in 5"
                  :key="i"
                  class="pdot money"
                  :class="{ filled: i <= (owner.moneyConsciousness || 0) }"
                />
              </span>
              {{ $tDynamic(moneyConsciousnessLabel) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Owner sub-tasks -->
      <div class="owner-card" data-tour="owner-subtasks">
        <h4 class="section-title">
          <ListChecks :size="14" /> {{ $t('Owner Sub-Tasks') }}
          <span class="subtask-count">{{ subtaskResult.metCount }}/{{ subtaskResult.total }}</span>
        </h4>
        <p class="subtask-intro">
          {{ $t("Concrete goals your owner tracks across the whole contract. These make up 40% of the owner's evaluation.") }}
        </p>
        <ul class="subtask-list">
          <li
            v-for="t in subtaskResult.subtasks"
            :key="t.id"
            class="subtask-row"
            :class="{ met: t.met }"
          >
            <span class="subtask-icon">
              <CheckCircle2 v-if="t.met" :size="18" />
              <Circle v-else :size="18" />
            </span>
            <span class="subtask-text">
              <span class="subtask-label">
                {{ $tDynamic(t.label) }}
                <span
                  v-if="t.progress"
                  class="subtask-progress"
                  :class="{ met: t.met }"
                >{{ t.progress.current }}/{{ t.progress.target }}</span>
                <span v-if="t.global" class="subtask-tag">{{ $t('Global') }}</span>
              </span>
              <span class="subtask-desc">{{ $tDynamic(t.description) }}</span>
            </span>
          </li>
        </ul>
      </div>

      <!-- GM contract -->
      <div class="owner-card" data-tour="owner-contract">
        <h4 class="section-title">
          <FileSignature :size="14" /> {{ $t('Your GM Contract') }}
          <div
            class="gm-badge"
            data-tour="owner-gm-level"
            :style="{ backgroundColor: gmColor, color: gmTextColor }"
            :title="$t('Your GM career level: {level}', { level: $tDynamic(gmLabel) })"
          >
            <Medal :size="13" />
            <span class="gm-badge-text">
              <span class="gm-badge-cap">{{ $t('GM Level') }}</span>
              <span class="gm-badge-level">{{ $tDynamic(gmLabel) }}</span>
            </span>
          </div>
        </h4>
        <div class="exp-grid">
          <div class="exp-item">
            <span class="exp-label">{{ $t('Signed') }}</span>
            <span class="exp-value">{{ contract.signedYear }}</span>
          </div>
          <div class="exp-item">
            <span class="exp-label">{{ $t('Length') }}</span>
            <span class="exp-value">{{ $t('{n} years', { n: contract.length }) }}</span>
          </div>
          <div class="exp-item">
            <span class="exp-label">{{ $t('Years Remaining') }}</span>
            <span class="exp-value" :class="{ 'final-year': contract.isFinalYear }">
              {{ contract.yearsRemaining }}
            </span>
          </div>
        </div>
        <p v-if="contract.isFinalYear" class="contract-note">
          {{ $t("You're in the final stretch of your contract — keep the owner happy.") }}
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.owner-tab {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.owner-empty {
  color: var(--color-text-secondary);
  padding: 1rem;
}
.owner-card {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 1rem 1.25rem;
}
.owner-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.gm-badge {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: var(--radius-full, 999px);
  font-weight: 700;
  letter-spacing: normal;
  text-transform: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  flex-shrink: 0;
}
.gm-badge-level {
  text-transform: none;
}
.gm-badge-text {
  display: flex;
  flex-direction: column;
  line-height: 1.05;
}
.gm-badge-cap {
  font-size: 0.54rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.82;
}
.gm-badge-level {
  font-size: 0.84rem;
  letter-spacing: 0.01em;
}
.owner-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(245, 199, 44, 0.25), rgba(245, 158, 11, 0.15));
  color: #FFC72C;
  flex-shrink: 0;
}
.owner-id {
  display: flex;
  flex-direction: column;
}
.owner-name {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
.owner-role {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}
.owner-wealth {
  display: inline-flex;
  align-items: flex-start;
  gap: 5px;
  margin-top: 4px;
  font-size: 0.74rem;
  font-style: italic;
  line-height: 1.35;
  color: var(--color-text-tertiary);
}
.owner-wealth svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: #84cc16;
}

.sat-block {
  margin-top: 1rem;
}
.sat-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.sat-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}
.sat-label {
  font-size: 0.85rem;
  font-weight: 700;
}
.sat-meter-bar {
  height: 12px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  overflow: hidden;
  position: relative;
}
.sat-meter-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.4s ease, background-color 0.4s ease;
}
.sat-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.sat-chip {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  padding: 2px 10px;
}
.sat-chip em {
  font-style: normal;
  color: var(--color-text-tertiary);
  font-weight: 500;
}
.sat-hint {
  margin: 8px 0 0;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.subtask-count {
  margin-left: auto;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  padding: 1px 9px;
  text-transform: none;
  letter-spacing: 0;
}
.subtask-intro {
  margin: 0 0 0.85rem;
  font-size: 0.78rem;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}
.subtask-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.subtask-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.subtask-icon {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--color-text-tertiary);
  display: inline-flex;
}
.subtask-row.met .subtask-icon {
  color: #22c55e;
}
.subtask-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.subtask-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.subtask-row.met .subtask-label {
  color: var(--color-text-primary);
}
.subtask-tag {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #f5c72c;
  background: rgba(245, 199, 44, 0.14);
  border-radius: 4px;
  padding: 1px 5px;
}
/* Running tally (e.g. 2/4) for count-based goals. Neutral until met, green once
   the target is reached. */
.subtask-progress {
  font-size: 0.62rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  padding: 1px 7px;
}
.subtask-progress.met {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.16);
}
.subtask-desc {
  font-size: 0.74rem;
  color: var(--color-text-tertiary);
  line-height: 1.35;
}
.pdot.money.filled {
  background: #f5c72c;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin: 0 0 0.6rem;
}
.owner-blurb {
  margin: 0 0 0.85rem;
  font-style: italic;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}
.exp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.85rem;
}
.exp-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.exp-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-tertiary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.exp-value {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.exp-value.final-year {
  color: var(--color-warning, #f59e0b);
}
.patience-dots {
  display: inline-flex;
  gap: 3px;
}
.pdot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
}
.pdot.filled {
  background: var(--color-primary);
}
.contract-note {
  margin: 0.75rem 0 0;
  font-size: 0.78rem;
  color: var(--color-warning, #f59e0b);
}
</style>
