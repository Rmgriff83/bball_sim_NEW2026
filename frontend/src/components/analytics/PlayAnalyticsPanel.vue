<script setup>
import { computed, ref, watch } from 'vue'
import { Lock } from 'lucide-vue-next'
import { GlassCard } from '@/components/ui'

const props = defineProps({
  // A team's playAnalytics: { season, plays: { [playId]: {name, category, poss,
  // fg2m, fg2a, fg3m, fg3a, ftm, fta, tov, pts} } }
  analytics: { type: Object, default: null },
  title: { type: String, default: 'Play Analytics' },
  // When true, render the (real) content blurred behind a lock CTA.
  locked: { type: Boolean, default: false },
  lockedMessage: { type: String, default: 'Hire an analyst to unlock.' },
  // When true, default the filter to the team's most-run category instead of
  // "All Plays" — keeps the pregame preview compact (All Plays is very tall).
  defaultToTopCategory: { type: Boolean, default: false },
})

// Full category names for the group headers + the filter dropdown. Falls back to
// the raw key for anything unmapped.
const CATEGORY_FULL = {
  isolation: 'Isolation', pick_and_roll: 'Pick & Roll', post_up: 'Post-Up',
  motion: 'Motion', spot_up: 'Spot-Up', cut: 'Cuts', transition: 'Transition',
}

const selectedCategory = ref('all')

const pct = (m, a) => (a > 0 ? Math.round((m / a) * 100) : null)

// Group plays by category. Each group carries an aggregate summary (used as the
// group header row) plus its individual plays sorted by possessions desc.
const groups = computed(() => {
  const plays = props.analytics?.plays || {}
  const byCat = new Map()

  for (const [id, e] of Object.entries(plays)) {
    if (!(e.poss > 0)) continue
    const key = e.category || 'other'
    if (!byCat.has(key)) {
      byCat.set(key, {
        key,
        label: CATEGORY_FULL[key] || key,
        plays: [],
        agg: { fg2m: 0, fg2a: 0, fg3m: 0, fg3a: 0, tov: 0, pts: 0, poss: 0 },
      })
    }
    const g = byCat.get(key)
    g.plays.push({
      id,
      name: e.name || id,
      poss: e.poss || 0,
      two: pct(e.fg2m, e.fg2a),
      twoRaw: `${e.fg2m || 0}/${e.fg2a || 0}`,
      three: pct(e.fg3m, e.fg3a),
      threeRaw: `${e.fg3m || 0}/${e.fg3a || 0}`,
      toPct: e.poss > 0 ? Math.round((e.tov / e.poss) * 100) : null,
      ppp: e.poss > 0 ? (e.pts / e.poss).toFixed(2) : null,
    })
    const a = g.agg
    a.fg2m += e.fg2m || 0; a.fg2a += e.fg2a || 0
    a.fg3m += e.fg3m || 0; a.fg3a += e.fg3a || 0
    a.tov += e.tov || 0; a.pts += e.pts || 0; a.poss += e.poss || 0
  }

  return Array.from(byCat.values())
    .map((g) => {
      g.plays.sort((x, y) => y.poss - x.poss)
      const a = g.agg
      return {
        key: g.key,
        label: g.label,
        plays: g.plays,
        poss: a.poss,
        two: pct(a.fg2m, a.fg2a),
        twoRaw: `${a.fg2m}/${a.fg2a}`,
        three: pct(a.fg3m, a.fg3a),
        threeRaw: `${a.fg3m}/${a.fg3a}`,
        toPct: a.poss > 0 ? Math.round((a.tov / a.poss) * 100) : null,
        ppp: a.poss > 0 ? (a.pts / a.poss).toFixed(2) : null,
      }
    })
    .sort((x, y) => y.poss - x.poss)
})

// Dropdown options: "All Plays" + every category present in the data.
const categoryOptions = computed(() => [
  { value: 'all', label: 'All Plays' },
  ...groups.value.map((g) => ({ value: g.key, label: g.label })),
])

const visibleGroups = computed(() =>
  selectedCategory.value === 'all'
    ? groups.value
    : groups.value.filter((g) => g.key === selectedCategory.value)
)

const hasData = computed(() => groups.value.length > 0)
const fmtPct = (v) => (v == null ? '—' : `${v}%`)

// Tracks whether the user has explicitly chosen a filter, so the compact
// top-category default doesn't override their pick.
let userSelected = false

// Keep the selection valid and apply the compact default. Runs immediately and
// whenever the grouped data changes (e.g. the previewed opponent switches).
watch(
  groups,
  (gs) => {
    // Snap back if the current selection no longer has data.
    if (selectedCategory.value !== 'all' && !gs.some((g) => g.key === selectedCategory.value)) {
      selectedCategory.value = 'all'
      userSelected = false
    }
    // Preview panels default to the most-run category (keeps the element short)
    // until the user picks something themselves.
    if (
      props.defaultToTopCategory &&
      !userSelected &&
      gs.length &&
      selectedCategory.value === 'all'
    ) {
      selectedCategory.value = gs[0].key
    }
  },
  { immediate: true }
)
</script>

<template>
  <GlassCard padding="lg" :hoverable="false" class="analytics-card">
    <h3 class="h4 mb-3">{{ $tDynamic(title) }}</h3>

    <div class="analytics-body" :class="{ blurred: locked }">
      <div v-if="!hasData" class="analytics-empty">
        {{ $t('No data yet — play some games this season.') }}
      </div>
      <template v-else>
        <div class="filter-row">
          <label class="filter-label" for="cat-filter">{{ $t('Group') }}</label>
          <select
            id="cat-filter"
            v-model="selectedCategory"
            class="cat-filter"
            @change="userSelected = true"
          >
            <option v-for="o in categoryOptions" :key="o.value" :value="o.value">
              {{ $tDynamic(o.label) }}
            </option>
          </select>
        </div>

        <!-- Six columns don't fit narrow phones at intrinsic width — the
             table keeps a readable min-width and scrolls inside this wrapper
             instead of overflowing the page horizontally. -->
        <div class="table-scroll">
        <table class="analytics-table">
          <thead>
            <tr>
              <th class="col-play">{{ $t('Play') }}</th>
              <!-- i18n-ignore -->
              <th>POSS</th>
              <th>2P%</th>
              <th>3P%</th>
              <!-- i18n-ignore -->
              <th>TO%</th>
              <!-- i18n-ignore -->
              <th>PPP</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in visibleGroups" :key="g.key">
              <tr class="group-header">
                <td class="col-play">{{ $tDynamic(g.label) }}</td>
                <td>{{ g.poss }}</td>
                <td :title="g.twoRaw">{{ fmtPct(g.two) }}</td>
                <td :title="g.threeRaw">{{ fmtPct(g.three) }}</td>
                <td>{{ fmtPct(g.toPct) }}</td>
                <td>{{ g.ppp ?? '—' }}</td>
              </tr>
              <tr v-for="r in g.plays" :key="r.id" class="play-row">
                <td class="col-play">
                  <span class="play-name">{{ $tDynamic(r.name) }}</span>
                </td>
                <td>{{ r.poss }}</td>
                <td :title="r.twoRaw">{{ fmtPct(r.two) }}</td>
                <td :title="r.threeRaw">{{ fmtPct(r.three) }}</td>
                <td>{{ fmtPct(r.toPct) }}</td>
                <td>{{ r.ppp ?? '—' }}</td>
              </tr>
            </template>
          </tbody>
        </table>
        </div>
      </template>
    </div>

    <div v-if="locked" class="analytics-lock">
      <Lock :size="26" />
      <p class="lock-msg">{{ $tDynamic(lockedMessage) }}</p>
    </div>
  </GlassCard>
</template>

<style scoped>
.analytics-card {
  position: relative;
  margin-bottom: 1.5rem;
}

.analytics-body.blurred {
  filter: blur(6px);
  pointer-events: none;
  user-select: none;
}

.analytics-empty {
  padding: 1.25rem 0.5rem;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.filter-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 0.5rem;
}
.filter-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-secondary);
}
.cat-filter {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
}
.cat-filter:focus { outline: none; border-color: rgba(168, 85, 247, 0.6); }

.table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  /* Flex/grid ancestors must not force the card wider than the viewport. */
  min-width: 0;
  max-width: 100%;
}

.analytics-table {
  width: 100%;
  min-width: 420px;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.analytics-table th {
  text-align: right;
  padding: 6px 8px;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-secondary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.analytics-table th.col-play { text-align: left; }
.analytics-table td {
  text-align: right;
  padding: 7px 8px;
  color: var(--color-text-primary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.analytics-table td.col-play {
  text-align: left;
}

/* Category summary row — the group's aggregate, visually distinct from its plays. */
.group-header td {
  font-weight: 700;
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.03em;
  color: var(--color-text-primary);
  background: rgba(168, 85, 247, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

/* Individual plays sit indented under their category header. */
.play-row td.col-play { padding-left: 20px; }
.play-name { font-weight: 600; }

.analytics-lock {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  padding: 1rem;
  color: var(--color-text-primary);
  background: rgba(0, 0, 0, 0.25);
  border-radius: inherit;
}
.lock-msg {
  font-size: 0.85rem;
  font-weight: 600;
  max-width: 280px;
  line-height: 1.35;
}

[data-theme='light'] .analytics-lock { background: rgba(255, 255, 255, 0.35); }
[data-theme='light'] .group-header td { background: rgba(168, 85, 247, 0.14); }
[data-theme='light'] .cat-filter { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.15); }
</style>
