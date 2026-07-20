<script setup>
import { ref, computed } from 'vue'
import { useTradeStore } from '@/stores/trade'
import { StatBadge } from '@/components/ui'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import { Check, Star, Info, TrendingUp, TrendingDown, Minus, RotateCcw } from 'lucide-vue-next'
import { getAssetStars, getPositionColor, formatContractYears, formatPickYear } from './tradeAssetFormat'

const props = defineProps({
  team: { type: Object, required: true },
  isPartner: { type: Boolean, default: false },
  // Set of "type:id" keys for assets currently in the requesting list.
  requestingIds: { type: Object, default: () => new Set() },
  // A partner is already locked to a DIFFERENT team.
  locked: { type: Boolean, default: false },
  // (playerId) => { ppg, rpg, apg } | null
  statLineFor: { type: Function, default: () => null },
})

const emit = defineEmits(['toggle-asset', 'view-player'])

const tradeStore = useTradeStore()

const isFlipped = ref(false)
const backTab = ref('players')

const topAssets = computed(() => props.team.topAssets ?? [])
const roster = computed(() => props.team.roster ?? [])
const picks = computed(() => props.team.picks ?? [])

function pName(p) {
  const f = p.firstName ?? p.first_name ?? ''
  const l = p.lastName ?? p.last_name ?? ''
  return `${f} ${l}`.trim() || 'Unknown'
}
function pRating(p) { return p.overallRating ?? p.overall_rating ?? 75 }
function pSalary(p) { return tradeStore.formatSalary(p.contractSalary ?? p.contract_salary ?? 0) }
function pYears(p) { return formatContractYears(p.contractYearsRemaining ?? p.contract_years_remaining) }
function pSecondary(p) { return p.secondaryPosition ?? p.secondary_position }

function isPlayerSelected(id) { return props.requestingIds.has(`player:${id}`) }
function isPickSelected(id) { return props.requestingIds.has(`pick:${id}`) }

function directionIcon(direction) {
  if (['title_contender', 'win_now', 'contending', 'ascending'].includes(direction)) return TrendingUp
  if (direction === 'rebuilding') return TrendingDown
  return Minus
}

function togglePlayer(player) {
  emit('toggle-asset', { team: props.team, kind: 'player', item: player })
}
function togglePick(pick) {
  emit('toggle-asset', { team: props.team, kind: 'pick', item: pick })
}
function viewPlayer(player, ev) {
  ev?.stopPropagation?.()
  emit('view-player', player)
}
function flip() { isFlipped.value = !isFlipped.value }
</script>

<template>
  <div class="tp-card" :class="{ 'is-flipped': isFlipped, 'is-partner': isPartner }">
    <div class="tp-card-inner">
      <!-- FRONT -->
      <div class="tp-face tp-front">
        <div class="tp-header">
          <div class="tp-header-top">
            <span class="tp-abbr">{{ team.abbreviation }}</span>
            <Check v-if="isPartner" :size="16" class="tp-partner-check" />
          </div>
          <span class="tp-name">{{ team.name }}</span>
          <div class="tp-meta">
            <span class="tp-record">{{ team.record?.wins ?? 0 }}-{{ team.record?.losses ?? 0 }}</span>
            <span
              class="tp-direction"
              :style="{ color: tradeStore.getDirectionColor(team.direction) }"
            >
              <component :is="directionIcon(team.direction)" :size="12" />
              {{ tradeStore.getDirectionLabel(team.direction) }}
            </span>
          </div>
          <div class="tp-cap">Cap space: {{ tradeStore.formatSalary(team.cap_space ?? 0) }}</div>
        </div>

        <div class="tp-topassets">
          <div class="tp-topassets-label">Top assets</div>
          <div v-if="topAssets.length === 0" class="tp-empty">No assets</div>
          <div
            v-for="a in topAssets"
            :key="`${a.kind}:${a.item.id}`"
            class="tp-top-row"
          >
            <template v-if="a.kind === 'player'">
              <PlayerAvatar :player="a.item" :size="26" />
              <span class="tp-top-name">{{ pName(a.item) }}</span>
              <span
                class="tp-pos-badge"
                :style="{ backgroundColor: getPositionColor(a.item.position) }"
              >{{ a.item.position }}</span>
              <span class="tp-top-stars">
                <Star v-for="s in getAssetStars(a.item)" :key="`s${s}`" :size="9" class="star filled" />
              </span>
              <StatBadge :value="pRating(a.item)" size="sm" />
            </template>
            <template v-else>
              <span class="tp-top-pick">{{ formatPickYear(a.item.year) }}</span>
              <span class="tp-top-name">
                R{{ a.item.round }}
                <span v-if="a.item.original_team_abbreviation" class="tp-pick-via">via {{ a.item.original_team_abbreviation }}</span>
              </span>
              <span class="tp-top-stars">
                <Star v-for="s in getAssetStars(a.item)" :key="`ps${s}`" :size="9" class="star filled" />
              </span>
            </template>
          </div>
        </div>

        <button type="button" class="tp-flip-btn" @click="flip">
          Select Assets →
        </button>
      </div>

      <!-- BACK -->
      <div class="tp-face tp-back">
        <div class="tp-back-header">
          <button type="button" class="tp-back-btn" @click="flip">
            <RotateCcw :size="13" /> Back
          </button>
          <span class="tp-back-title">{{ team.abbreviation }} assets</span>
        </div>

        <div class="tp-back-tabs">
          <button
            type="button"
            class="tp-back-tab"
            :class="{ active: backTab === 'players' }"
            @click="backTab = 'players'"
          >Players ({{ roster.length }})</button>
          <button
            type="button"
            class="tp-back-tab"
            :class="{ active: backTab === 'picks' }"
            @click="backTab = 'picks'"
          >Picks ({{ picks.length }})</button>
        </div>

        <div class="tp-back-list">
          <!-- Players -->
          <template v-if="backTab === 'players'">
            <div
              v-for="p in roster"
              :key="p.id"
              class="tp-asset-row"
              :class="{ selected: isPlayerSelected(p.id), locked }"
              @click="togglePlayer(p)"
            >
              <PlayerAvatar :player="p" :size="34" />
              <div class="tp-asset-main">
                <div class="tp-asset-line1">
                  <span class="tp-asset-name">{{ pName(p) }}</span>
                  <span
                    class="tp-pos-badge"
                    :style="{ backgroundColor: getPositionColor(p.position) }"
                  >{{ p.position }}</span>
                  <span
                    v-if="pSecondary(p)"
                    class="tp-pos-badge secondary"
                    :style="{ backgroundColor: getPositionColor(pSecondary(p)) }"
                  >{{ pSecondary(p) }}</span>
                </div>
                <div class="tp-asset-line2">
                  <span>{{ pSalary(p) }}</span>
                  <span class="tp-dot">·</span>
                  <span>{{ pYears(p) }}</span>
                  <template v-if="statLineFor(p.id)">
                    <span class="tp-dot">·</span>
                    <span class="tp-statline">
                      {{ statLineFor(p.id).ppg }}p / {{ statLineFor(p.id).rpg }}r / {{ statLineFor(p.id).apg }}a
                    </span>
                  </template>
                </div>
                <div class="tp-asset-stars">
                  <Star v-for="s in getAssetStars(p)" :key="`fs${s}`" :size="10" class="star filled" />
                  <Star v-for="s in (5 - getAssetStars(p))" :key="`es${s}`" :size="10" class="star empty" />
                </div>
              </div>
              <div class="tp-asset-right">
                <StatBadge :value="pRating(p)" size="sm" />
                <button type="button" class="tp-info-btn" @click="viewPlayer(p, $event)" title="Player details">
                  <Info :size="15" />
                </button>
                <Check v-if="isPlayerSelected(p.id)" :size="16" class="tp-asset-check" />
              </div>
            </div>
            <div v-if="roster.length === 0" class="tp-empty">No players</div>
          </template>

          <!-- Picks -->
          <template v-else>
            <div
              v-for="pick in picks"
              :key="pick.id"
              class="tp-asset-row pick"
              :class="{ selected: isPickSelected(pick.id), locked }"
              @click="togglePick(pick)"
            >
              <div class="tp-pick-year">{{ formatPickYear(pick.year) }}</div>
              <div class="tp-asset-main">
                <div class="tp-asset-line1">
                  <span class="tp-asset-name">Round {{ pick.round }}</span>
                  <span v-if="pick.original_team_abbreviation" class="tp-pick-via">
                    (via {{ pick.original_team_abbreviation }})
                  </span>
                </div>
                <div v-if="pick.projected_position" class="tp-asset-line2">
                  Projected #{{ pick.projected_position }}
                </div>
              </div>
              <div class="tp-asset-right">
                <Check v-if="isPickSelected(pick.id)" :size="18" class="tp-asset-check" />
              </div>
            </div>
            <div v-if="picks.length === 0" class="tp-empty">No draft picks</div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tp-card {
  perspective: 1200px;
  height: 340px;
}
.tp-card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.5s;
  transform-style: preserve-3d;
}
.tp-card.is-flipped .tp-card-inner {
  transform: rotateY(180deg);
}
.tp-face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  overflow: hidden;
}
.tp-card.is-partner .tp-face {
  border-color: rgba(96, 165, 250, 0.6);
  background: rgba(96, 165, 250, 0.08);
}
.tp-back {
  transform: rotateY(180deg);
}

/* ---- Front ---- */
.tp-header {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.tp-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tp-abbr {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.5px;
}
.tp-partner-check {
  color: #60a5fa;
}
.tp-name {
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 1px;
}
.tp-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 5px;
  font-size: 12px;
}
.tp-record {
  font-weight: 700;
}
.tp-direction {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-weight: 600;
}
.tp-cap {
  margin-top: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}

.tp-topassets {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
}
.tp-topassets-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 6px;
}
.tp-top-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}
.tp-top-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-top-stars {
  display: inline-flex;
  gap: 1px;
}
.tp-top-pick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 4px;
  border-radius: 6px;
  background: rgba(96, 165, 250, 0.15);
  color: #93c5fd;
  font-size: 11px;
  font-weight: 800;
}

.tp-flip-btn {
  margin: 8px;
  padding: 8px;
  border: 1px solid rgba(96, 165, 250, 0.4);
  border-radius: 8px;
  background: rgba(96, 165, 250, 0.12);
  color: #93c5fd;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.tp-flip-btn:hover {
  background: rgba(96, 165, 250, 0.2);
}

/* ---- Back ---- */
.tp-back-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.tp-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  cursor: pointer;
}
.tp-back-title {
  font-size: 12px;
  font-weight: 700;
}
.tp-back-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 8px 0;
}
.tp-back-tab {
  flex: 1;
  padding: 6px;
  border: none;
  border-radius: 6px 6px 0 0;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.tp-back-tab.active {
  background: rgba(96, 165, 250, 0.18);
  color: #cfe4ff;
}
.tp-back-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.tp-asset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.tp-asset-row:hover {
  background: rgba(255, 255, 255, 0.05);
}
.tp-asset-row.selected {
  background: rgba(96, 165, 250, 0.16);
}
.tp-asset-row.locked {
  opacity: 0.72;
}
.tp-asset-main {
  flex: 1;
  min-width: 0;
}
.tp-asset-line1 {
  display: flex;
  align-items: center;
  gap: 5px;
}
.tp-asset-name {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-asset-line2 {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 1px;
}
.tp-statline {
  color: #a7f3d0;
}
.tp-dot {
  opacity: 0.5;
}
.tp-asset-stars {
  display: flex;
  gap: 1px;
  margin-top: 2px;
}
.tp-asset-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tp-info-btn {
  display: inline-flex;
  padding: 3px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
}
.tp-info-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.tp-asset-check {
  color: #60a5fa;
}
.tp-pos-badge {
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  padding: 1px 5px;
  border-radius: 4px;
}
.tp-pos-badge.secondary {
  opacity: 0.75;
}
.tp-pick-year {
  font-size: 15px;
  font-weight: 800;
  min-width: 44px;
  text-align: center;
}
.tp-pick-via {
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.5);
}
.star.filled {
  color: #fbbf24;
  fill: #fbbf24;
}
.star.empty {
  color: rgba(255, 255, 255, 0.2);
}
.tp-empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}
</style>
