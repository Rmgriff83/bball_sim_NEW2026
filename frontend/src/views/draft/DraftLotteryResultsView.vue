<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRightLeft } from 'lucide-vue-next'
import { useCampaignStore } from '@/stores/campaign'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { buildRookieDraftOrder } from '@/engine/draft/DraftOrderService'
import TeamLogo from '@/components/common/TeamLogo.vue'

const route = useRoute()
const router = useRouter()
const campaignStore = useCampaignStore()

const campaignId = computed(() => route.params.id)
const loading = ref(true)
const teams = ref([])
const standings = ref({ east: [], west: [] })
const campaign = ref(null)

onMounted(async () => {
  try {
    campaign.value = await campaignStore.fetchCampaign(campaignId.value)
    teams.value = await TeamRepository.getAllForCampaign(campaignId.value)
    // Pull the same standings the lottery + draft consume so
    // buildRookieDraftOrder resolves identical owners here.
    const seasonYear = campaign.value?.currentSeasonYear ?? 2025
    const seasonData = await SeasonRepository.get(campaignId.value, seasonYear)
    standings.value = seasonData?.standings || { east: [], west: [] }
  } finally {
    loading.value = false
  }
})

const lotteryResult = computed(() => campaign.value?.settings?.draftLottery ?? null)

// Derive row data from buildRookieDraftOrder so each slot carries BOTH the
// current owner (whoever holds the pick today, post-trades) and the
// original team whose record entered the lottery. Mirrors the same
// owner-vs-original split the ScoutingView Draft tab shows.
//
// Lottery deltas (+N / -N) are merged from the persisted lottery result
// by matching on the original team id — the lottery operates on original
// teams (whoever's record finished bottom-14), not on traded-pick owners.
const rows = computed(() => {
  if (!lotteryResult.value || teams.value.length === 0) return []
  const draftYear = lotteryResult.value.year
  const fullOrder = buildRookieDraftOrder(
    teams.value,
    standings.value,
    draftYear,
    lotteryResult.value
  )
  // Round 1 only — round 2 isn't lottery-affected and matches reverse
  // standings, so showing it here would just be noise.
  const round1 = fullOrder.filter(slot => slot.round === 1)

  const deltaByOriginalId = new Map(
    lotteryResult.value.actualOrder.map(s => [s.teamId, s.delta])
  )
  const teamById = new Map(teams.value.map(t => [t.id, t]))

  return round1.map(slot => {
    const currentOwner = teamById.get(slot.teamId)
    const originalOwner = teamById.get(slot.originalTeamId)
    const delta = deltaByOriginalId.get(slot.originalTeamId) ?? 0
    return {
      pick: slot.pick,
      isLotteryTeam: slot.pick <= 14,
      isTraded: slot.isTraded,
      currentOwner,
      originalOwner,
      // Pre-format the delta badge content for the template.
      deltaLabel: delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : null,
      deltaDir: delta > 0 ? 'up' : delta < 0 ? 'down' : null,
    }
  })
})

function goBack() {
  router.push(`/campaign/${campaignId.value}`)
}
</script>

<template>
  <div class="lottery-page">
    <header class="lottery-header">
      <button class="back-btn" @click="goBack">
        <ArrowLeft :size="18" />
        Back
      </button>
      <h1 class="lottery-title">Draft Lottery Results</h1>
      <p v-if="lotteryResult" class="lottery-subtitle">
        {{ lotteryResult.year }} Rookie Draft
      </p>
    </header>

    <div v-if="loading" class="lottery-loading">Loading lottery results…</div>

    <div v-else-if="!lotteryResult" class="lottery-empty">
      <p>No draft lottery has been run for this offseason yet.</p>
      <button class="primary-btn" @click="goBack">Return Home</button>
    </div>

    <div v-else class="lottery-list">
      <div
        v-for="row in rows"
        :key="row.pick"
        class="lottery-row"
        :class="{ 'lottery-row--in-zone': row.isLotteryTeam }"
      >
        <div class="lottery-row__pick">
          <span class="pick-number">{{ row.pick }}</span>
          <span v-if="row.isLotteryTeam" class="pick-tag">Lottery</span>
        </div>

        <div class="lottery-row__team">
          <TeamLogo
            :abbreviation="row.currentOwner?.abbreviation"
            :color="row.currentOwner?.primary_color"
            :size="36"
          />
          <div class="team-meta">
            <span class="team-name">{{ row.currentOwner?.name || row.currentOwner?.abbreviation || '—' }}</span>
            <span v-if="row.isTraded && row.originalOwner" class="team-via">
              <ArrowRightLeft :size="11" />
              via {{ row.originalOwner.abbreviation }}
            </span>
            <span v-else class="team-abbr">{{ row.currentOwner?.abbreviation }}</span>
          </div>
        </div>

        <div class="lottery-row__delta">
          <span
            v-if="row.deltaLabel"
            class="delta-badge"
            :class="row.deltaDir === 'up' ? 'delta-badge--up' : 'delta-badge--down'"
          >
            <ArrowUp v-if="row.deltaDir === 'up'" :size="14" />
            <ArrowDown v-else :size="14" />
            {{ row.deltaLabel }}
          </span>
        </div>
      </div>
    </div>

    <footer v-if="lotteryResult && !loading" class="lottery-footer">
      <button class="primary-btn" @click="goBack">Continue to Free Agency</button>
    </footer>
  </div>
</template>

<style scoped>
.lottery-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 80px;
  color: var(--color-text-primary);
}

.lottery-header {
  margin-bottom: 24px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 6px 0;
}

.back-btn:hover {
  color: var(--color-text-primary);
}

.lottery-title {
  font-size: 1.6rem;
  font-weight: 800;
  margin: 4px 0 2px;
}

.lottery-subtitle {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin: 0;
}

.lottery-loading,
.lottery-empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-secondary);
}

.lottery-empty .primary-btn {
  margin-top: 16px;
}

.lottery-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lottery-row {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-md, 8px);
}

.lottery-row--in-zone {
  background: rgba(139, 92, 246, 0.07);
  border-color: rgba(139, 92, 246, 0.18);
}

.lottery-row__pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.pick-number {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.pick-tag {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(139, 92, 246, 0.85);
}

.lottery-row__team {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.team-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.team-name {
  font-size: 0.95rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.team-abbr {
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  font-weight: 600;
  letter-spacing: 0.04em;
}

.team-via {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  color: var(--color-text-tertiary);
  font-weight: 600;
  letter-spacing: 0.02em;
  font-style: italic;
}

.lottery-row__delta {
  display: flex;
  justify-content: flex-end;
  min-width: 56px;
}

.delta-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: var(--radius-full, 999px);
  font-variant-numeric: tabular-nums;
}

.delta-badge--up {
  background: rgba(34, 197, 94, 0.16);
  color: #22c55e;
}

.delta-badge--down {
  background: rgba(239, 68, 68, 0.16);
  color: #ef4444;
}

.lottery-footer {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

.primary-btn {
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-md, 8px);
  padding: 12px 22px;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  cursor: pointer;
}

.primary-btn:hover {
  opacity: 0.92;
}
</style>
