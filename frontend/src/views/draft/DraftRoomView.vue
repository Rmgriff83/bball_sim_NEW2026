<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDraftStore } from '@/stores/draft'
import { useCampaignStore } from '@/stores/campaign'
import { useToastStore } from '@/stores/toast'
import { LoadingSpinner } from '@/components/ui'
import DraftCompleteModal from '@/components/draft/DraftCompleteModal.vue'
import { Search, ChevronUp, ChevronDown, FastForward, SkipForward, SkipBack, Users, X } from 'lucide-vue-next'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'

const route = useRoute()
const router = useRouter()
const draftStore = useDraftStore()
const campaignStore = useCampaignStore()
const toastStore = useToastStore()

const campaignId = computed(() => route.params.id)
const loading = ref(true)
const error = ref(null)
const showCompleteModal = ref(false)
const tickerRef = ref(null)
const showMobileRoster = ref(false)

// Computed
const timerProgress = computed(() => draftStore.timerSeconds / 60)
const timerColor = computed(() => {
  if (draftStore.timerSeconds > 30) return '#4ade80'
  if (draftStore.timerSeconds > 10) return '#fbbf24'
  return '#ef4444'
})

const pickProgress = computed(() => {
  const total = draftStore.draftOrder.length
  if (!total) return '0 / 0'
  return `${draftStore.currentPickIndex + (draftStore.isDraftComplete ? 0 : 1)} / ${total}`
})

// Get visible ticker slots centered on current pick
const tickerSlots = computed(() => {
  const order = draftStore.draftOrder
  if (!order.length) return []

  const currentIdx = draftStore.currentPickIndex
  const halfWindow = 7
  let start = Math.max(0, currentIdx - halfWindow)
  let end = Math.min(order.length, currentIdx + halfWindow + 1)

  if (start === 0) end = Math.min(order.length, halfWindow * 2 + 1)
  if (end === order.length) start = Math.max(0, order.length - (halfWindow * 2 + 1))

  return order.slice(start, end).map((slot, i) => {
    const absoluteIdx = start + i
    const result = draftStore.draftResults.find(r => r.pick === slot.pick)
    return {
      ...slot,
      isCurrent: absoluteIdx === currentIdx,
      isCompleted: !!result,
      result,
    }
  })
})

// Round ticker — current round picks for looping marquee
const roundTickerItems = computed(() => {
  return draftStore.currentRoundPicks
})

function getPlayerAge(birthDate) {
  if (!birthDate) return '—'
  const birth = new Date(birthDate)
  const now = new Date('2025-10-21')
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  return age
}

function formatHeight(inches) {
  if (!inches) return '—'
  const ft = Math.floor(inches / 12)
  const rem = inches % 12
  return `${ft}'${rem}"`
}

function getSortIcon(field) {
  if (draftStore.sortField !== field) return null
  return draftStore.sortDir === 'desc' ? 'desc' : 'asc'
}

function getUserRosterByPosition() {
  const positions = ['PG', 'SG', 'SF', 'PF', 'C']
  const roster = draftStore.userRoster
  const grouped = {}
  positions.forEach(p => grouped[p] = [])

  for (const pick of roster) {
    const pos = pick.position
    if (grouped[pos]) grouped[pos].push(pick)
    else grouped['SF'].push(pick)
  }

  return grouped
}

// Scroll ticker to keep current pick visible
watch(() => draftStore.currentPickIndex, () => {
  if (tickerRef.value) {
    const current = tickerRef.value.querySelector('.ticker-slot.current')
    if (current) {
      current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }
})

// Watch for draft completion
watch(() => draftStore.isDraftComplete, (complete) => {
  if (complete) {
    showCompleteModal.value = true
    draftStore.saveDraftToCache(campaignId.value)
  }
})

// Auto-save on pick changes
watch(() => draftStore.draftResults.length, () => {
  if (draftStore.isDraftActive) {
    draftStore.saveDraftToCache(campaignId.value)
  }
})

// Toast: show pick result when a pick is made
watch(() => draftStore.lastPickResult, (result) => {
  if (!result) return
  toastStore.showDraftPick({
    pickNumber: result.pick,
    teamAbbr: result.teamAbbr,
    teamColor: result.teamColor,
    playerName: result.playerName,
    position: result.position,
    overallRating: result.overallRating,
    isUserTeam: result.teamId === draftStore.userTeamId,
  })
})

// Toast: show "on the clock" when team changes
watch(() => draftStore.currentPick, (pick, oldPick) => {
  if (!pick || draftStore.isDraftComplete || draftStore.isSimming) return
  // Don't toast on very first pick or same team
  if (!oldPick) return
  if (pick.teamId === draftStore.userTeamId) {
    toastStore.showSuccess(`You're on the clock!`, 3000)
  } else {
    toastStore.showSuccess(`${pick.teamName} is on the clock`, 2000)
  }
})

async function handleSkipToMyPick() {
  await draftStore.simToNextUserPick(campaignId.value)
}

async function handleSkipEntire() {
  await draftStore.simEntireDraft(campaignId.value)
}

function handleSkipCurrent() {
  draftStore.simCurrentPick()
}

async function handleFinalize() {
  try {
    await draftStore.finalizeDraft(campaignId.value)
    showCompleteModal.value = false
    await campaignStore.fetchCampaign(campaignId.value)
    router.push(`/campaign/${campaignId.value}`)
  } catch (e) {
    console.error('Finalize error:', e)
    toastStore.addToast({
      type: 'error',
      message: `Failed to finalize draft: ${e.message || 'Unknown error'}`,
    })
  }
}

onMounted(async () => {
  loading.value = true
  error.value = null

  try {
    let campaign = campaignStore.currentCampaign
    if (!campaign || campaign.id != campaignId.value) {
      campaign = await campaignStore.fetchCampaign(campaignId.value)
    }

    if (campaign?.draft_completed) {
      router.replace(`/campaign/${campaignId.value}`)
      return
    }

    // Load draft data from IndexedDB
    const [allPlayersRaw, teamsListRaw] = await Promise.all([
      PlayerRepository.getAllForCampaign(campaignId.value),
      TeamRepository.getAllForCampaign(campaignId.value),
    ])
    const allPlayers = allPlayersRaw || []
    const teamsList = teamsListRaw || []

    if (!teamsList.length) {
      throw new Error('No teams found for this campaign. Try recreating the campaign.')
    }

    const restored = await draftStore.loadDraftFromCache(campaignId.value)

    if (restored && draftStore.draftOrder.length > 0) {
      draftStore.allPlayers = allPlayers
      draftStore.teams = teamsList

      // Resume: if user's turn start timer, otherwise autoplay AI picks
      if (draftStore.isUserPick && !draftStore.isDraftComplete) {
        draftStore.startTimer()
      } else if (!draftStore.isDraftComplete) {
        draftStore.autoPlayAIPicks(campaignId.value)
      }
    } else {
      draftStore.initializeDraft(campaign, allPlayers, teamsList)
      draftStore.saveDraftToCache(campaignId.value)

      // Start live draft — AI picks play with realistic delays
      if (!draftStore.isUserPick) {
        draftStore.autoPlayAIPicks(campaignId.value)
      } else {
        draftStore.startTimer()
      }
    }
  } catch (e) {
    error.value = e.message || 'Failed to load draft'
    console.error('Draft load error:', e)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  draftStore.stopTimer()
  draftStore.skipRequested = true
})
</script>

<template>
  <div class="draft-room">
    <!-- Loading State -->
    <div v-if="loading" class="draft-loading">
      <LoadingSpinner size="lg" />
      <p>Setting up the draft room...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="draft-error">
      <p>{{ error }}</p>
      <button @click="router.push('/campaigns')" class="btn-back">Back to Campaigns</button>
    </div>

    <!-- Draft Room -->
    <template v-else>
      <!-- Header Bar -->
      <header class="draft-header">
        <div class="header-left">
          <h1 class="draft-title">FANTASY DRAFT</h1>
          <span class="campaign-label">{{ campaignStore.currentCampaign?.name }}</span>
        </div>
        <div class="header-right">
          <div class="round-indicator">
            <span class="round-label">ROUND</span>
            <span class="round-number">{{ draftStore.currentRound }}</span>
          </div>
        </div>
      </header>

      <!-- Draft Ticker -->
      <div class="draft-ticker" ref="tickerRef">
        <div class="ticker-track">
          <div
            v-for="slot in tickerSlots"
            :key="slot.pick"
            class="ticker-slot"
            :class="{
              current: slot.isCurrent,
              completed: slot.isCompleted,
              'user-team': slot.teamId === draftStore.userTeamId,
            }"
          >
            <div class="ticker-team-badge" :style="{ backgroundColor: slot.teamColor }">
              {{ slot.teamAbbr }}
            </div>
            <div v-if="slot.isCompleted && slot.result" class="ticker-player">
              {{ slot.result.playerName?.split(' ').pop() }}
            </div>
            <div v-else class="ticker-pick-num">#{{ slot.pick }}</div>
          </div>
        </div>
      </div>

      <!-- Round Ticker (marquee of current round picks) -->
      <div v-if="roundTickerItems.length > 0" class="round-ticker">
        <div class="round-ticker-track">
          <div class="round-ticker-content">
            <span
              v-for="(pick, i) in roundTickerItems"
              :key="'a-' + i"
              class="round-ticker-item"
              :class="{ 'user-pick': pick.teamId === draftStore.userTeamId }"
            >
              <span class="rt-badge" :style="{ backgroundColor: pick.teamColor }">{{ pick.teamAbbr }}</span>
              <span class="rt-player">{{ pick.playerName }}</span>
              <span class="rt-pos">{{ pick.position }}</span>
              <span class="rt-divider">|</span>
            </span>
          </div>
          <div class="round-ticker-content" aria-hidden="true">
            <span
              v-for="(pick, i) in roundTickerItems"
              :key="'b-' + i"
              class="round-ticker-item"
              :class="{ 'user-pick': pick.teamId === draftStore.userTeamId }"
            >
              <span class="rt-badge" :style="{ backgroundColor: pick.teamColor }">{{ pick.teamAbbr }}</span>
              <span class="rt-player">{{ pick.playerName }}</span>
              <span class="rt-pos">{{ pick.position }}</span>
              <span class="rt-divider">|</span>
            </span>
          </div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="draft-main">
        <!-- Left Sidebar: User Roster -->
        <aside class="draft-sidebar roster-panel">
          <h3 class="sidebar-title">YOUR ROSTER</h3>
          <div class="roster-count">{{ draftStore.userRoster.length }} / 15</div>

          <div class="roster-positions">
            <div
              v-for="(players, pos) in getUserRosterByPosition()"
              :key="pos"
              class="position-group"
            >
              <div class="position-header">{{ pos }}</div>
              <div
                v-for="player in players"
                :key="player.playerId"
                class="roster-player"
              >
                <span class="roster-player-name">{{ player.playerName }}</span>
                <span class="roster-player-ovr">{{ player.overallRating }}</span>
              </div>
              <div v-if="players.length === 0" class="roster-empty">—</div>
            </div>
          </div>
        </aside>

        <!-- Center: On The Clock + Player Pool -->
        <div class="draft-center">
          <!-- On The Clock -->
          <div class="on-the-clock" :class="{ 'user-turn': draftStore.isUserPick }">
            <div v-if="!draftStore.isDraftComplete" class="clock-content">
              <div
                class="clock-team-badge"
                :style="{ backgroundColor: draftStore.currentPick?.teamColor || '#666' }"
              >
                {{ draftStore.currentPick?.teamAbbr }}
              </div>
              <div class="clock-info">
                <div class="clock-team-name">{{ draftStore.currentPick?.teamName }}</div>
                <div class="clock-status">
                  <template v-if="draftStore.isSimming">SKIPPING...</template>
                  <template v-else-if="draftStore.isAutoPlaying && !draftStore.isUserPick">DECIDING...</template>
                  <template v-else-if="draftStore.isUserPick">ON THE CLOCK</template>
                  <template v-else>SELECTING...</template>
                </div>
              </div>
              <div v-if="draftStore.isUserPick && !draftStore.isSimming" class="clock-timer">
                <svg class="timer-ring" viewBox="0 0 48 48">
                  <circle
                    cx="24" cy="24" r="20"
                    fill="none"
                    stroke="rgba(255,255,255,0.1)"
                    stroke-width="3"
                  />
                  <circle
                    cx="24" cy="24" r="20"
                    fill="none"
                    :stroke="timerColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    :stroke-dasharray="125.66"
                    :stroke-dashoffset="125.66 * (1 - timerProgress)"
                    transform="rotate(-90 24 24)"
                    class="timer-progress"
                  />
                </svg>
                <span class="timer-text">{{ draftStore.timerSeconds }}</span>
              </div>
            </div>
            <div v-else class="clock-content">
              <div class="clock-status">DRAFT COMPLETE</div>
            </div>
          </div>

          <!-- Player Pool -->
          <div class="player-pool">
            <div class="pool-header">
              <h3 class="pool-title">AVAILABLE PLAYERS</h3>
              <div class="pool-count">{{ draftStore.availablePlayers.length }} players</div>
            </div>

            <!-- Filters -->
            <div class="pool-filters">
              <div class="position-filters">
                <button
                  v-for="pos in ['ALL', 'PG', 'SG', 'SF', 'PF', 'C']"
                  :key="pos"
                  class="pos-filter-btn"
                  :class="{ active: draftStore.filterPosition === pos }"
                  @click="draftStore.filterPosition = pos"
                >
                  {{ pos }}
                </button>
              </div>
              <div class="search-box">
                <Search :size="14" />
                <input
                  v-model="draftStore.searchQuery"
                  type="text"
                  placeholder="Search players..."
                  class="search-input"
                />
              </div>
            </div>

            <!-- Player Table -->
            <div class="pool-table-wrap">
              <table class="pool-table">
                <thead>
                  <tr>
                    <th class="col-name" @click="draftStore.toggleSort('lastName')">
                      Name
                      <ChevronUp v-if="getSortIcon('lastName') === 'asc'" :size="12" />
                      <ChevronDown v-if="getSortIcon('lastName') === 'desc'" :size="12" />
                    </th>
                    <th class="col-pos">Pos</th>
                    <th class="col-num" @click="draftStore.toggleSort('overallRating')">
                      OVR
                      <ChevronUp v-if="getSortIcon('overallRating') === 'asc'" :size="12" />
                      <ChevronDown v-if="getSortIcon('overallRating') === 'desc'" :size="12" />
                    </th>
                    <th class="col-num" @click="draftStore.toggleSort('potentialRating')">
                      POT
                      <ChevronUp v-if="getSortIcon('potentialRating') === 'asc'" :size="12" />
                      <ChevronDown v-if="getSortIcon('potentialRating') === 'desc'" :size="12" />
                    </th>
                    <th class="col-num">Age</th>
                    <th class="col-ht">Ht</th>
                    <th class="col-action"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="player in draftStore.filteredPlayers.slice(0, 100)"
                    :key="player.id"
                    class="player-row"
                  >
                    <td class="col-name">
                      <span class="player-name">{{ player.firstName }} {{ player.lastName }}</span>
                    </td>
                    <td class="col-pos">
                      <span class="pos-badge">{{ player.position }}</span>
                    </td>
                    <td class="col-num ovr-cell">{{ player.overallRating }}</td>
                    <td class="col-num pot-cell">{{ player.potentialRating }}</td>
                    <td class="col-num">{{ getPlayerAge(player.birthDate) }}</td>
                    <td class="col-ht">{{ formatHeight(player.heightInches) }}</td>
                    <td class="col-action">
                      <button
                        v-if="draftStore.isUserPick && !draftStore.isSimming && !draftStore.isDraftComplete"
                        class="btn-draft"
                        @click="draftStore.makeUserPick(player.id)"
                      >
                        Draft
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Mobile Roster Slide-out -->
      <Transition name="roster-backdrop">
        <div
          v-if="showMobileRoster"
          class="mobile-roster-backdrop"
          @click="showMobileRoster = false"
        />
      </Transition>
      <Transition name="roster-slide">
        <aside v-if="showMobileRoster" class="mobile-roster-drawer">
          <div class="mobile-roster-header">
            <h3 class="sidebar-title">YOUR ROSTER</h3>
            <button class="mobile-roster-close" @click="showMobileRoster = false">
              <X :size="18" />
            </button>
          </div>
          <div class="roster-count">{{ draftStore.userRoster.length }} / 15</div>

          <div class="roster-positions">
            <div
              v-for="(players, pos) in getUserRosterByPosition()"
              :key="pos"
              class="position-group"
            >
              <div class="position-header">{{ pos }}</div>
              <div
                v-for="player in players"
                :key="player.playerId"
                class="roster-player"
              >
                <span class="roster-player-name">{{ player.playerName }}</span>
                <span class="roster-player-ovr">{{ player.overallRating }}</span>
              </div>
              <div v-if="players.length === 0" class="roster-empty">—</div>
            </div>
          </div>
        </aside>
      </Transition>

      <!-- Bottom Bar: Skip Controls -->
      <footer class="draft-footer">
        <div class="sim-controls">
          <button
            class="sim-btn roster-toggle-btn"
            @click="showMobileRoster = !showMobileRoster"
          >
            <Users :size="16" />
            <span class="roster-toggle-count">{{ draftStore.userRoster.length }}</span>
          </button>
          <button
            class="sim-btn"
            :disabled="draftStore.isSimming || draftStore.isDraftComplete || draftStore.isUserPick"
            @click="handleSkipCurrent"
          >
            <SkipBack :size="16" />
            Skip Pick
          </button>
          <button
            class="sim-btn"
            :disabled="draftStore.isSimming || draftStore.isDraftComplete"
            @click="handleSkipToMyPick"
          >
            <FastForward :size="16" />
            Skip to My Pick
          </button>
          <button
            class="sim-btn sim-all"
            :disabled="draftStore.isSimming || draftStore.isDraftComplete"
            @click="handleSkipEntire"
          >
            <SkipForward :size="16" />
            Skip Entire Draft
          </button>
        </div>
        <div class="pick-counter">
          Pick {{ pickProgress }}
        </div>
      </footer>
    </template>

    <!-- Draft Complete Modal -->
    <DraftCompleteModal
      :show="showCompleteModal"
      :user-roster="draftStore.userRoster"
      :finalizing="draftStore.isFinalizing"
      @continue="handleFinalize"
      @close="showCompleteModal = false"
    />
  </div>
</template>

<style scoped>
.draft-room {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  overflow: hidden;
}

/* Loading / Error */
.draft-loading,
.draft-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--color-text-secondary);
}

.btn-back {
  padding: 8px 20px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  cursor: pointer;
}

/* Header */
.draft-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 24px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 16px;
}

.draft-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.6rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  background: var(--gradient-cosmic);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.campaign-label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.round-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.round-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
}

.round-number {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.3rem;
  line-height: 1;
  color: var(--color-primary);
}

/* Draft Ticker */
.draft-ticker {
  overflow-x: auto;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
  scrollbar-width: none;
  flex-shrink: 0;
}

.draft-ticker::-webkit-scrollbar {
  display: none;
}

.ticker-track {
  display: flex;
  gap: 4px;
  padding: 8px 24px;
  min-width: max-content;
}

.ticker-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  min-width: 64px;
  border-radius: var(--radius-md);
  background: var(--color-bg-tertiary);
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.ticker-slot.current {
  border-color: var(--color-primary);
  background: rgba(232, 90, 79, 0.15);
  animation: pulse-border 1.5s ease-in-out infinite;
}

.ticker-slot.completed {
  opacity: 0.6;
}

.ticker-slot.user-team {
  border-color: var(--color-primary);
}

.ticker-slot.user-team.completed {
  opacity: 0.8;
}

@keyframes pulse-border {
  0%, 100% { box-shadow: 0 0 0 0 rgba(232, 90, 79, 0.3); }
  50% { box-shadow: 0 0 0 4px rgba(232, 90, 79, 0.1); }
}

.ticker-team-badge {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.55rem;
  font-weight: 700;
  color: white;
}

.ticker-player {
  font-size: 0.6rem;
  color: var(--color-text-secondary);
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ticker-pick-num {
  font-size: 0.6rem;
  color: var(--color-text-tertiary);
}

/* Round Ticker (marquee) */
.round-ticker {
  overflow: hidden;
  background: var(--color-bg-tertiary);
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
  height: 30px;
}

.round-ticker-track {
  display: flex;
  width: max-content;
  animation: marquee 30s linear infinite;
}

.round-ticker-content {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 8px;
}

.round-ticker-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  white-space: nowrap;
}

.round-ticker-item.user-pick .rt-player {
  color: var(--color-primary);
}

.rt-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  font-size: 0.5rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.rt-player {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.rt-pos {
  font-size: 0.6rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.rt-divider {
  color: rgba(255, 255, 255, 0.1);
  margin: 0 8px;
  font-size: 0.7rem;
}

@keyframes marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

/* Main Content */
.draft-main {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

/* Sidebar */
.draft-sidebar {
  width: 250px;
  flex-shrink: 0;
  padding: 16px;
  overflow-y: auto;
  border-right: 1px solid var(--glass-border);
  background: var(--color-bg-secondary);
}

.sidebar-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1rem;
  font-weight: 400;
  letter-spacing: 0.06em;
  color: var(--color-text-primary);
  margin-bottom: 8px;
}

/* Roster Panel */
.roster-count {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-bottom: 16px;
}

.position-group {
  margin-bottom: 12px;
}

.position-header {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--glass-border);
  margin-bottom: 4px;
}

.roster-player {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.roster-player-name {
  font-size: 0.8rem;
  color: var(--color-text-primary);
}

.roster-player-ovr {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-primary);
}

.roster-empty {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  padding: 2px 0;
}

/* Center Panel */
.draft-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* On The Clock */
.on-the-clock {
  padding: 14px 24px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.on-the-clock.user-turn {
  background: linear-gradient(135deg, rgba(232, 90, 79, 0.08), rgba(244, 162, 89, 0.05));
}

.clock-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.clock-team-badge {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.clock-info {
  flex: 1;
}

.clock-team-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.clock-status {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 0.9rem;
  letter-spacing: 0.06em;
  color: var(--color-primary);
}

/* Timer Ring */
.clock-timer {
  position: relative;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.timer-ring {
  width: 48px;
  height: 48px;
}

.timer-progress {
  transition: stroke-dashoffset 1s linear, stroke 0.3s ease;
}

.timer-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

/* Player Pool */
.player-pool {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 24px 0;
}

.pool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.pool-title {
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1rem;
  font-weight: 400;
  letter-spacing: 0.06em;
}

.pool-count {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

/* Pool Filters */
.pool-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.position-filters {
  display: flex;
  gap: 4px;
}

.pos-filter-btn {
  padding: 4px 10px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.pos-filter-btn.active {
  background: var(--gradient-cosmic);
  color: black;
  border-color: transparent;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  flex: 1;
  max-width: 220px;
}

.search-box svg {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.search-input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-text-primary);
  font-size: 0.8rem;
  width: 100%;
}

.search-input::placeholder {
  color: var(--color-text-tertiary);
}

/* Player Table */
.pool-table-wrap {
  flex: 1;
  overflow-y: auto;
  margin: 0 -24px;
  padding: 0 24px;
  min-height: 0;
}

.pool-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.pool-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--color-bg-primary);
}

.pool-table th {
  padding: 8px 10px;
  text-align: left;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--glass-border);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.pool-table th svg {
  vertical-align: middle;
  margin-left: 2px;
}

.pool-table td {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}

.player-row {
  transition: background 0.15s ease;
}

.player-row:hover {
  background: rgba(255,255,255,0.03);
}

.col-name {
  min-width: 140px;
}

.col-pos {
  width: 50px;
}

.col-num {
  width: 50px;
  text-align: center;
}

.col-ht {
  width: 50px;
  text-align: center;
}

.col-action {
  width: 70px;
  text-align: right;
}

.player-name {
  font-weight: 500;
}

.pos-badge {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.ovr-cell {
  font-weight: 600;
  color: var(--color-text-primary);
}

.pot-cell {
  color: var(--color-text-secondary);
}

.btn-draft {
  padding: 4px 12px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-draft:hover {
  filter: brightness(1.1);
}

/* Footer / Skip Controls */
.draft-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 24px;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.sim-controls {
  display: flex;
  gap: 8px;
}

.sim-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.8rem;
  font-weight: 600;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.sim-btn:hover:not(:disabled) {
  background: var(--color-bg-elevated, var(--color-bg-tertiary));
  border-color: var(--color-primary);
}

.sim-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sim-btn.sim-all {
  background: rgba(232, 90, 79, 0.1);
  border-color: rgba(232, 90, 79, 0.3);
  color: var(--color-primary);
}

.pick-counter {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

/* Responsive */
@media (max-width: 1024px) {
  .draft-main {
    flex-direction: column;
  }

  .draft-sidebar {
    width: 100%;
    max-height: 180px;
    border-right: none;
    border-bottom: 1px solid var(--glass-border);
  }

  .roster-positions {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .position-group {
    margin-bottom: 0;
    min-width: 100px;
  }
}

/* Roster toggle — hidden on desktop */
.roster-toggle-btn {
  display: none;
}

/* Mobile Roster Drawer */
.mobile-roster-backdrop {
  display: none;
}

.mobile-roster-drawer {
  display: none;
}

@media (max-width: 640px) {
  .draft-header {
    padding: 8px 16px;
  }

  .header-left {
    gap: 8px;
  }

  .draft-title {
    font-size: 1.2rem;
  }

  .campaign-label {
    display: none;
  }

  .ticker-track {
    padding: 8px 16px;
  }

  .player-pool {
    padding: 12px 16px 0;
  }

  .pool-table-wrap {
    margin: 0 -16px;
    padding: 0 16px;
  }

  .draft-footer {
    padding: 8px 16px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .sim-controls {
    flex-wrap: wrap;
  }

  .sim-btn {
    padding: 6px 12px;
    font-size: 0.75rem;
  }

  .roster-panel {
    display: none;
  }

  /* Show roster toggle button on mobile */
  .roster-toggle-btn {
    display: flex;
    background: rgba(232, 90, 79, 0.1);
    border-color: rgba(232, 90, 79, 0.3);
    color: var(--color-primary);
  }

  .roster-toggle-count {
    font-weight: 700;
    font-size: 0.8rem;
  }

  /* Backdrop */
  .mobile-roster-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(2px);
  }

  /* Slide-out drawer */
  .mobile-roster-drawer {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 280px;
    max-width: 85vw;
    z-index: 50;
    background: var(--color-bg-secondary);
    border-right: 1px solid var(--glass-border);
    box-shadow: var(--shadow-xl);
    overflow-y: auto;
    padding: 16px;
  }

  .mobile-roster-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .mobile-roster-header .sidebar-title {
    margin-bottom: 0;
  }

  .mobile-roster-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .mobile-roster-close:hover {
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
  }
}

/* Roster drawer transitions */
.roster-slide-enter-active {
  transition: transform 0.25s cubic-bezier(0, 0, 0.2, 1);
}

.roster-slide-leave-active {
  transition: transform 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.roster-slide-enter-from,
.roster-slide-leave-to {
  transform: translateX(-100%);
}

.roster-backdrop-enter-active {
  transition: opacity 0.25s ease;
}

.roster-backdrop-leave-active {
  transition: opacity 0.2s ease;
}

.roster-backdrop-enter-from,
.roster-backdrop-leave-to {
  opacity: 0;
}
</style>
