<script setup>
// Career-highs panel — the five tracked single-game bests (PTS/REB/AST/STL/BLK)
// with their context (vs opponent · season year). Used by both the user-player
// detail modal and the league/AI-player modal. Gracefully shows an empty state
// for stats with no recorded high yet (e.g. existing campaigns before tracking).
import { computed } from 'vue'

const props = defineProps({
  careerHighs: { type: Object, default: null },
})

const ROWS = [
  { key: 'points', label: 'PTS' },
  { key: 'rebounds', label: 'REB' },
  { key: 'assists', label: 'AST' },
  { key: 'steals', label: 'STL' },
  { key: 'blocks', label: 'BLK' },
]

const rows = computed(() =>
  ROWS.map((r) => {
    const h = props.careerHighs?.[r.key] ?? null
    return {
      label: r.label,
      value: h?.value ?? null,
      opp: h?.opp ?? null,
      year: h?.year ?? null,
    }
  })
)

const hasAny = computed(() => rows.value.some((r) => r.value != null))
</script>

<template>
  <div class="career-highs">
    <table class="career-highs-table">
      <tbody>
        <tr v-for="row in rows" :key="row.label">
          <td class="ch-stat">{{ row.label }}</td>
          <td class="ch-value">{{ row.value != null ? row.value : '—' }}</td>
          <td class="ch-context">
            <template v-if="row.value != null">
              <span v-if="row.opp">vs {{ row.opp }}</span>
              <span v-if="row.opp && row.year" class="ch-dot">·</span>
              <span v-if="row.year">{{ row.year }}</span>
            </template>
            <span v-else class="ch-empty">{{ $t('No record yet') }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!hasAny" class="ch-hint">
      {{ $t("Career highs are recorded as games are played — they'll start filling in from here.") }}
    </p>
  </div>
</template>

<style scoped>
.career-highs {
  width: 100%;
}
.career-highs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}
.career-highs-table td {
  padding: 7px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.career-highs-table tr:last-child td {
  border-bottom: none;
}
.ch-stat {
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
  width: 48px;
}
.ch-value {
  font-size: 1rem;
  font-weight: 800;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  width: 56px;
  text-align: right;
}
.ch-context {
  color: var(--color-text-secondary);
  text-align: right;
  white-space: nowrap;
}
.ch-dot {
  margin: 0 4px;
  color: var(--color-text-tertiary);
}
.ch-empty {
  color: var(--color-text-tertiary);
  font-style: italic;
}
.ch-hint {
  margin: 10px 2px 0;
  font-size: 0.7rem;
  line-height: 1.35;
  color: var(--color-text-tertiary);
}
</style>
