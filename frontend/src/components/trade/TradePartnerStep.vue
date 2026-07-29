<script setup>
import { ref, computed } from 'vue'
import { useTradeStore } from '@/stores/trade'
import { StatBadge } from '@/components/ui'
import PlayerAvatar from '@/components/common/PlayerAvatar.vue'
import PlayerDetailModal from '@/components/team/PlayerDetailModal.vue'
import TradePartnerCard from './TradePartnerCard.vue'
import PositionFilterBar from './PositionFilterBar.vue'
import { Check, X, Star, Info, AlertTriangle } from 'lucide-vue-next'
import { getAssetStars, getPositionColor, formatContractYears } from './tradeAssetFormat'

const props = defineProps({
  campaignId: { type: [String, Number], required: true },
})

const tradeStore = useTradeStore()

const partnerTab = ref('teams') // 'teams' | 'block'
const blockPositionFilter = ref('all') // 'all' | 'PG' | 'SG' | 'SF' | 'PF' | 'C'

const tradeableTeams = computed(() => tradeStore.tradeableTeams)
const leagueTradeBlock = computed(() => tradeStore.leagueTradeBlock)
const filteredBlock = computed(() => {
  if (blockPositionFilter.value === 'all') return leagueTradeBlock.value
  return leagueTradeBlock.value.filter(p => p.position === blockPositionFilter.value)
})
const selectedTeam = computed(() => tradeStore.selectedTeam)
const userRequesting = computed(() => tradeStore.userRequesting)

// Set of "type:id" keys for check state on the cards / rows.
const requestingIds = computed(
  () => new Set(userRequesting.value.map(a => `${a.type}:${a.id}`))
)

function isTeamLocked(team) {
  return !!selectedTeam.value
    && String(selectedTeam.value.id) !== String(team.id)
    && userRequesting.value.length > 0
}

function statLineFor(playerId) {
  return tradeStore.getStatLine(playerId)
}

// ---- Asset shape builders (mirror TradeCenter.addPlayerToRequest/addPickToRequest) ----
function buildPlayerAsset(p) {
  return {
    type: 'player',
    id: p.id,
    firstName: p.firstName ?? p.first_name,
    lastName: p.lastName ?? p.last_name,
    position: p.position,
    secondaryPosition: p.secondaryPosition ?? p.secondary_position,
    overallRating: p.overallRating ?? p.overall_rating,
    contractSalary: p.contractSalary ?? p.contract_salary,
    contractYearsRemaining: p.contractYearsRemaining ?? p.contract_years_remaining,
    tradeValue: p.tradeValue ?? p.trade_value,
    age: p.age,
    height: p.height,
    headshot: p.headshot ?? null,
    hasCustomHeadshot: p.hasCustomHeadshot ?? p.has_custom_headshot ?? false,
  }
}
function buildPickAsset(k) {
  return {
    type: 'pick',
    id: k.id,
    year: k.year,
    round: k.round,
    displayName: k.display_name,
    tradeValue: k.trade_value,
    originalTeamAbbreviation: k.original_team_abbreviation,
    projectedPosition: k.projected_position,
  }
}

function addAsset(kind, item) {
  tradeStore.addToUserRequesting(kind === 'player' ? buildPlayerAsset(item) : buildPickAsset(item))
}
function removeAsset(type, id) {
  tradeStore.removeFromUserRequesting({ type, id })
}

// ---- Partner lock + add/remove ----
const pendingSwitch = ref(null) // { team, kind, item }

function handleToggleAsset({ team, kind, item }) {
  const partner = selectedTeam.value
  const same = partner && String(partner.id) === String(team.id)

  if (same) {
    // Same partner → plain toggle (never re-select; that would clear the list).
    if (tradeStore.isInRequesting(kind, item.id)) removeAsset(kind, item.id)
    else addAsset(kind, item)
    return
  }

  // Different team (or none yet). If a partner is locked with a built-up offer,
  // confirm before switching (selectTeam clears the requesting list).
  if (partner && userRequesting.value.length > 0) {
    pendingSwitch.value = { team, kind, item }
    return
  }

  tradeStore.selectTeam(team)
  addAsset(kind, item)
}

function confirmSwitch() {
  const s = pendingSwitch.value
  if (!s) return
  tradeStore.selectTeam(s.team)
  addAsset(s.kind, s.item)
  pendingSwitch.value = null
}
function cancelSwitch() {
  pendingSwitch.value = null
}

// Trade-block row tap → resolve to the enriched team so selectedTeam carries
// roster/picks (used by the execute pre-flight check), then run the same flow.
function handleBlockToggle(player) {
  const team = tradeableTeams.value.find(t => String(t.id) === String(player._teamId))
  if (!team) return
  handleToggleAsset({ team, kind: 'player', item: player })
}

// ---- Player detail modal ----
const modalPlayer = ref(null)
const showPlayerModal = ref(false)
function openPlayer(player) {
  modalPlayer.value = tradeStore.buildModalPlayer(player)
  showPlayerModal.value = true
}
function closePlayer() {
  showPlayerModal.value = false
  modalPlayer.value = null
}

// ---- Requesting summary helpers ----
function assetLabel(a) {
  if (a.type === 'player') return `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || 'Player'
  return a.displayName || `${a.year} R${a.round} Pick`
}
function blockName(p) {
  return `${p.firstName ?? p.first_name ?? ''} ${p.lastName ?? p.last_name ?? ''}`.trim() || 'Unknown'
}
function blockRating(p) { return p.overallRating ?? p.overall_rating ?? 75 }
function blockSalary(p) { return tradeStore.formatSalary(p.contractSalary ?? p.contract_salary ?? 0) }
function blockYears(p) { return formatContractYears(p.contractYearsRemaining ?? p.contract_years_remaining) }
function isBlockSelected(id) { return requestingIds.value.has(`player:${id}`) }
</script>

<template>
  <div class="tp-step">
    <p class="tp-step-desc">
      Browse each team's roster, picks and stars — tap an asset to add it to your offer.
    </p>

    <!-- Requesting summary -->
    <div v-if="userRequesting.length" class="tp-requesting">
      <span class="tp-requesting-label">Requesting{{ selectedTeam ? ` from ${selectedTeam.abbreviation}` : '' }}:</span>
      <span
        v-for="a in userRequesting"
        :key="`${a.type}:${a.id}`"
        class="tp-chip"
      >
        {{ assetLabel(a) }}
        <button type="button" class="tp-chip-x" @click="removeAsset(a.type, a.id)"><X :size="12" /></button>
      </span>
    </div>

    <!-- Top tabs -->
    <div class="tp-tabs">
      <button type="button" class="tp-tab" :class="{ active: partnerTab === 'teams' }" @click="partnerTab = 'teams'">
        Teams
      </button>
      <button type="button" class="tp-tab" :class="{ active: partnerTab === 'block' }" @click="partnerTab = 'block'">
        Trade Block ({{ leagueTradeBlock.length }})
      </button>
    </div>

    <!-- Teams tab -->
    <div v-if="partnerTab === 'teams'" class="tp-teams-grid">
      <TradePartnerCard
        v-for="team in tradeableTeams"
        :key="team.id"
        :team="team"
        :is-partner="selectedTeam && String(selectedTeam.id) === String(team.id)"
        :requesting-ids="requestingIds"
        :locked="isTeamLocked(team)"
        :stat-line-for="statLineFor"
        @toggle-asset="handleToggleAsset"
        @view-player="openPlayer"
      />
    </div>

    <!-- Trade Block tab -->
    <div v-else class="tp-block-list">
      <PositionFilterBar v-model="blockPositionFilter" />
      <div v-if="leagueTradeBlock.length === 0" class="tp-block-empty">
        No players are on the trade block right now.
      </div>
      <div v-else-if="filteredBlock.length === 0" class="tp-block-empty">
        No {{ blockPositionFilter }} players on the trade block.
      </div>
      <div
        v-for="p in filteredBlock"
        :key="p.id"
        class="tp-block-row"
        :class="{ selected: isBlockSelected(p.id) }"
        @click="handleBlockToggle(p)"
      >
        <PlayerAvatar :player="p" :size="36" />
        <div class="tp-block-main">
          <div class="tp-block-line1">
            <span class="tp-block-team">{{ p._teamAbbr }}</span>
            <span class="tp-block-name">{{ blockName(p) }}</span>
            <span class="tp-pos-badge" :style="{ backgroundColor: getPositionColor(p.position) }">{{ p.position }}</span>
          </div>
          <div class="tp-block-line2">
            <span>{{ blockSalary(p) }}</span>
            <span class="tp-dot">·</span>
            <span>{{ blockYears(p) }}</span>
            <template v-if="statLineFor(p.id)">
              <span class="tp-dot">·</span>
              <span class="tp-statline">{{ statLineFor(p.id).ppg }}p / {{ statLineFor(p.id).rpg }}r / {{ statLineFor(p.id).apg }}a</span>
            </template>
          </div>
          <div class="tp-block-stars">
            <Star v-for="s in getAssetStars(p)" :key="`bs${s}`" :size="10" class="star filled" />
            <Star v-for="s in (5 - getAssetStars(p))" :key="`be${s}`" :size="10" class="star empty" />
          </div>
        </div>
        <div class="tp-block-right">
          <StatBadge :value="blockRating(p)" size="sm" />
          <button type="button" class="tp-info-btn" @click.stop="openPlayer(p)" title="Player details"><Info :size="15" /></button>
          <Check v-if="isBlockSelected(p.id)" :size="16" class="tp-asset-check" />
        </div>
      </div>
    </div>

    <!-- Switch-partner confirm -->
    <div v-if="pendingSwitch" class="tp-confirm-overlay" @click.self="cancelSwitch">
      <div class="tp-confirm">
        <AlertTriangle :size="22" class="tp-confirm-icon" />
        <div class="tp-confirm-title">Switch trade partner?</div>
        <p class="tp-confirm-body">
          You're building a trade with <strong>{{ selectedTeam?.abbreviation }}</strong>.
          Switching to <strong>{{ pendingSwitch.team.abbreviation }}</strong> will clear your
          {{ userRequesting.length }} requested asset{{ userRequesting.length === 1 ? '' : 's' }}.
        </p>
        <div class="tp-confirm-actions">
          <button type="button" class="tp-btn ghost" @click="cancelSwitch">Cancel</button>
          <button type="button" class="tp-btn danger" @click="confirmSwitch">Switch</button>
        </div>
      </div>
    </div>

    <PlayerDetailModal
      :show="showPlayerModal"
      :player="modalPlayer"
      :current-season-year="tradeStore.currentSeasonYear"
      :campaign-id="campaignId"
      :is-user-player="false"
      :show-growth="false"
      @close="closePlayer"
    />
  </div>
</template>

<style scoped>
.tp-step {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tp-step-desc {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  margin: 0;
}

.tp-requesting {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(96, 165, 250, 0.08);
  border: 1px solid rgba(96, 165, 250, 0.25);
  border-radius: 8px;
}
.tp-requesting-label {
  font-size: 12px;
  font-weight: 600;
  color: #93c5fd;
}
.tp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px 3px 8px;
  font-size: 11.5px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
}
.tp-chip-x {
  display: inline-flex;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  padding: 0;
}
.tp-chip-x:hover { color: #fff; }

.tp-tabs {
  display: flex;
  gap: 6px;
}
.tp-tab {
  flex: 1;
  padding: 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.tp-tab.active {
  background: rgba(96, 165, 250, 0.18);
  border-color: rgba(96, 165, 250, 0.5);
  color: #cfe4ff;
}

.tp-teams-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.tp-block-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tp-block-empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
}
.tp-block-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
}
.tp-block-row:hover { background: rgba(255, 255, 255, 0.06); }
.tp-block-row.selected {
  background: rgba(96, 165, 250, 0.16);
  border-color: rgba(96, 165, 250, 0.5);
}
.tp-block-main { flex: 1; min-width: 0; }
.tp-block-line1 {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tp-block-team {
  font-size: 11px;
  font-weight: 800;
  color: #93c5fd;
}
.tp-block-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-block-line2 {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 1px;
}
.tp-block-stars { display: flex; gap: 1px; margin-top: 2px; }
.tp-block-right { display: flex; align-items: center; gap: 5px; }

.tp-statline { color: #a7f3d0; }
.tp-dot { opacity: 0.5; }
.tp-pos-badge {
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  padding: 1px 5px;
  border-radius: 4px;
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
.tp-info-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.tp-asset-check { color: #60a5fa; }
.star.filled { color: #fbbf24; fill: #fbbf24; }
.star.empty { color: rgba(255, 255, 255, 0.2); }

.tp-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 20px;
}
.tp-confirm {
  max-width: 360px;
  width: 100%;
  padding: 20px;
  border-radius: 14px;
  background: #1a1f2e;
  border: 1px solid rgba(255, 255, 255, 0.12);
  text-align: center;
}
.tp-confirm-icon { color: #fbbf24; }
.tp-confirm-title {
  font-size: 16px;
  font-weight: 700;
  margin-top: 8px;
}
.tp-confirm-body {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  margin: 8px 0 16px;
}
.tp-confirm-actions {
  display: flex;
  gap: 10px;
}
.tp-btn {
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.tp-btn.ghost {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.8);
}
.tp-btn.danger {
  background: #dc2626;
  color: #fff;
}

/* ---- Light mode ---- */
[data-theme="light"] .tp-step-desc { color: var(--color-text-secondary); }
[data-theme="light"] .tp-requesting-label { color: #1d4ed8; }
[data-theme="light"] .tp-chip { background: rgba(0, 0, 0, 0.06); }
[data-theme="light"] .tp-chip-x { color: rgba(0, 0, 0, 0.45); }
[data-theme="light"] .tp-chip-x:hover { color: #000; }
[data-theme="light"] .tp-tab {
  border-color: rgba(0, 0, 0, 0.15);
  background: rgba(0, 0, 0, 0.04);
  color: var(--color-text-secondary);
}
[data-theme="light"] .tp-tab.active {
  background: rgba(37, 99, 235, 0.12);
  border-color: rgba(37, 99, 235, 0.4);
  color: #1d4ed8;
}
[data-theme="light"] .tp-block-empty { color: var(--color-text-tertiary); }
[data-theme="light"] .tp-block-row {
  border-color: rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.03);
}
[data-theme="light"] .tp-block-row:hover { background: rgba(0, 0, 0, 0.06); }
[data-theme="light"] .tp-block-row.selected {
  background: rgba(37, 99, 235, 0.12);
  border-color: rgba(37, 99, 235, 0.45);
}
[data-theme="light"] .tp-block-team { color: #1d4ed8; }
[data-theme="light"] .tp-block-line2 { color: var(--color-text-secondary); }
[data-theme="light"] .tp-statline { color: #047857; }
[data-theme="light"] .tp-info-btn { color: rgba(0, 0, 0, 0.45); }
[data-theme="light"] .tp-info-btn:hover { background: rgba(0, 0, 0, 0.08); color: #000; }
[data-theme="light"] .tp-asset-check { color: #2563eb; }
[data-theme="light"] .star.empty { color: rgba(0, 0, 0, 0.2); }
[data-theme="light"] .tp-confirm {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.12);
}
[data-theme="light"] .tp-confirm-body { color: var(--color-text-secondary); }
[data-theme="light"] .tp-btn.ghost {
  border-color: rgba(0, 0, 0, 0.25);
  color: var(--color-text-primary);
}
</style>
