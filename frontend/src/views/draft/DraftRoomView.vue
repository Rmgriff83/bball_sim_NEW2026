<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDraftStore } from '@/stores/draft'
import { useCampaignStore } from '@/stores/campaign'
import { useTeamStore } from '@/stores/team'
import { useToastStore } from '@/stores/toast'
import { useWalkthroughStore } from '@/stores/walkthrough'
import { useAudioStore } from '@/stores/audio'
import { LoadingSpinner } from '@/components/ui'
import DraftCompleteModal from '@/components/draft/DraftCompleteModal.vue'
import PlayerDetailModal from '@/components/team/PlayerDetailModal.vue'
import DraftLastPick from '@/components/draft/DraftLastPick.vue'
import DraftNewsTicker from '@/components/draft/DraftNewsTicker.vue'
import DraftAnnouncer from '@/components/draft/DraftAnnouncer.vue'
import DraftCapReadout from '@/components/draft/DraftCapReadout.vue'
import { onClockLine } from '@/engine/draft/draftCommentary'
import { DRAFT_ATTRIBUTES, getAttrValue, attrLevelColor } from '@/utils/draftAttributes'
import { readableAccent, idealTextOn } from '@/utils/colorContrast'
import { useIsLightTheme } from '@/composables/useTheme'
import { Search, ChevronUp, ChevronDown, FastForward, SkipForward, SkipBack, Users, X, Timer } from 'lucide-vue-next'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { useSyncStore } from '@/stores/sync'
import { computeScoutReveal } from '@/engine/scouting/scoutReveal'
import { generateAndSaveRookieClass } from '@/engine/draft/RookieGenerationService'
import { buildRookieDraftOrder } from '@/engine/draft/DraftOrderService'
import { analyzeTeamDirection, buildContext } from '@/engine/ai/AITradeService'
import { getEffectiveExpectation } from '@/engine/season/OwnerExpectationService'
import { findOwnerForTeam } from '@/engine/data/owners'
import { SCOUTABLE_ATTRIBUTES } from '@/engine/data/attributeSchema'

const route = useRoute()
const router = useRouter()
const draftStore = useDraftStore()
const campaignStore = useCampaignStore()
const teamStore = useTeamStore()
const toastStore = useToastStore()
const walkthroughStore = useWalkthroughStore()
const audio = useAudioStore()

// ESPN-style start-of-draft sting, played once when the draft becomes active.
// (Null-safe: silent until draft-intro.mp3 is added to src/assets/audio/.)
watch(() => draftStore.isDraftActive, (active, prev) => {
  if (active && !prev && !draftStore.isDraftComplete && !draftStore.isSimming) {
    audio.playGameSfx('draftIntro')
  }
}, { immediate: true })

// "On the clock" cue + in-panel transition: whenever a new team comes up, fire
// the sound and pulse the on-the-clock panel. Gated so skip/sim don't spam it.
const clockPulse = ref(false)
let clockPulseTimer = null
const commishLine = computed(() => onClockLine(draftStore.currentPick))
watch(() => draftStore.currentPick?.teamId, (teamId, prev) => {
  if (teamId == null || teamId === prev) return
  if (draftStore.isSimming || draftStore.isDraftComplete) return
  audio.playGameSfx('onTheClock')
  clockPulse.value = false
  requestAnimationFrame(() => { clockPulse.value = true })
  clearTimeout(clockPulseTimer)
  clockPulseTimer = setTimeout(() => { clockPulse.value = false }, 900)
})

watch(() => draftStore.timerSeconds, (secs, prev) => {
  if (!draftStore.isUserPick || draftStore.isDraftComplete || draftStore.timerPaused) return
  // Count down each of the final 10 seconds (skip the auto-pick at 0).
  if (secs >= 1 && secs <= 10 && secs < prev) {
    audio.play('draftTick')
  }
})

// Freeze the draft while the live-draft walkthrough is showing tips: pauseTimer
// halts the user's pick clock AND the AI auto-pick loop (both honor timerPaused).
// On tour end, resume the clock or restart AI picks depending on whose turn it is.
watch(() => walkthroughStore.activeKey === 'liveDraft', (touring) => {
  if (touring) {
    draftStore.pauseTimer()
  } else {
    draftStore.resumeTimer()
    if (!draftStore.isUserPick && !draftStore.isDraftComplete && !draftStore.isSimming) {
      draftStore.autoPlayAIPicks(campaignId.value)
    }
  }
})

const campaignId = computed(() => route.params.id)
const isRookieMode = computed(() => route.query.mode === 'rookie' || draftStore.draftMode === 'rookie')
// Calendar year of the rookie class (rookies first play next season).
const draftYear = computed(() => (campaignStore.currentCampaign?.currentSeasonYear ?? 2025) + 1)
const loading = ref(true)
const error = ref(null)
const showCompleteModal = ref(false)
const tickerRef = ref(null)
const showMobileRoster = ref(false)

// Scouting state — hide unscouted attributes during rookie draft. Scout points +
// the hired-scout context let the user actively reveal attributes mid-draft.
const scoutedPlayers = ref({})
const scoutingPoints = ref(0)
const scoutingInProgress = ref(false)
let scoutRecord = null          // campaign.settings.scout (hired scout w/ perks)
let scoutFacilityLevel = 1      // user team's scouting facility level

// Player detail modal state
const selectedPlayer = ref(null)
const showPlayerModal = ref(false)

const ALL_ATTRIBUTES = SCOUTABLE_ATTRIBUTES

function isAttributeRevealed(playerId, attr) {
  if (!isRookieMode.value) return true
  const revealed = scoutedPlayers.value[playerId]?.revealedAttributes
  return revealed ? revealed.includes(attr) : false
}

function getScoutedDisplay(player, attr) {
  if (isAttributeRevealed(player.id, attr)) return player[attr]
  return '?'
}

// Scouting-aware display for a (nested) attribute key — used by the per-row
// attribute strip on the draft board.
function attrDisplay(player, key) {
  if (!isAttributeRevealed(player.id, key)) return '?'
  const v = getAttrValue(player, key)
  return v == null ? '—' : v
}

// Chip left-border color denoting the attribute's level (high → low), matching
// the player detail modal. Unscouted (rookie) attrs stay neutral.
function attrChipColor(player, key) {
  if (!isAttributeRevealed(player.id, key)) return 'var(--color-text-tertiary)'
  return attrLevelColor(getAttrValue(player, key))
}

// Custom attribute tooltip — teleported to <body> so it isn't clipped by the
// attribute strip's overflow (native `title` is slow/unreliable here).
const attrTip = ref({ show: false, text: '', x: 0, y: 0 })
function showAttrTip(e, name) {
  const r = e.currentTarget.getBoundingClientRect()
  attrTip.value = { show: true, text: name, x: r.left + r.width / 2, y: r.top - 8 }
}
function hideAttrTip() {
  attrTip.value.show = false
}

// Compact board name: first initial + last name (e.g. "M. Bridges").
function shortName(player) {
  const first = (player?.firstName || '').trim()
  const last = (player?.lastName || '').trim()
  const initial = first ? `${first[0]}. ` : ''
  return `${initial}${last}`.trim()
}

function getRevealedAttributes(playerId) {
  const raw = scoutedPlayers.value[playerId]?.revealedAttributes || []
  return raw.filter(a => ALL_ATTRIBUTES.includes(a))
}

function isFullyScouted(playerId) {
  return getRevealedAttributes(playerId).length >= ALL_ATTRIBUTES.length
}

function openPlayerModal(player) {
  selectedPlayer.value = player
  showPlayerModal.value = true
}

// Spend a scout point to reveal a rookie's attributes DURING the live draft.
// Uses the exact shared reveal logic as the Scouting screen (incl. scout-tier
// perk bonuses) and persists to the same campaign.settings.{scoutedPlayers,
// scoutingPoints} so points/reveals stay consistent across both surfaces.
async function scoutSelectedPlayer(player) {
  if (!player) return
  if (scoutingInProgress.value || scoutingPoints.value < 1 || isFullyScouted(player.id)) return
  scoutingInProgress.value = true
  try {
    const { toReveal, newRevealed, badgesRevealed, moraleRevealed, badgesJustRevealed, hitFullScout } =
      computeScoutReveal({
        revealedAttributes: getRevealedAttributes(player.id),
        scout: scoutRecord,
        facilityLevel: scoutFacilityLevel,
        existing: scoutedPlayers.value[player.id] || {},
      })
    if (toReveal.length === 0) return

    scoutedPlayers.value = {
      ...scoutedPlayers.value,
      [player.id]: { revealedAttributes: newRevealed, badgesRevealed, moraleRevealed },
    }
    scoutingPoints.value -= 1

    // Persist to campaign settings (shared with the Scouting screen).
    const plain = JSON.parse(JSON.stringify(scoutedPlayers.value))
    await CampaignRepository.updateSettings(campaignId.value, {
      scoutedPlayers: plain,
      scoutingPoints: scoutingPoints.value,
    })
    if (campaignStore.currentCampaign?.id == campaignId.value) {
      campaignStore.currentCampaign.settings = {
        ...campaignStore.currentCampaign.settings,
        scoutedPlayers: plain,
        scoutingPoints: scoutingPoints.value,
      }
    }
    useSyncStore().markDirty()

    // Milestone toast (same gating as the Scouting screen); routine reveals stay quiet.
    if (hitFullScout || badgesJustRevealed) {
      const nm = `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim() || 'Prospect'
      const msg = hitFullScout && badgesJustRevealed
        ? `${nm} fully scouted — badges revealed!`
        : hitFullScout ? `${nm} fully scouted!` : `Badges revealed for ${nm}!`
      audio.affirm()
      toastStore.showSuccess(msg)
    }
  } catch (err) {
    console.error('[DraftRoom] scout failed:', err)
    toastStore.showError('Failed to scout player')
  } finally {
    scoutingInProgress.value = false
  }
}

// The modal shows a "Draft Player" button only when it's the user's live pick
// AND the player is cap-eligible (fantasy over-cap penalty).
const canDraftCurrent = computed(() =>
  draftStore.isUserPick && !draftStore.isSimming && !draftStore.isDraftComplete &&
  draftStore.isPlayerDraftEligible(selectedPlayer.value)
)

// Manual user pick (from the list row or the modal). Plays the affirmation
// sound; the timer-expiry auto-pick stays silent since it isn't a user action.
function handleDraftPick(playerId) {
  if (!playerId) return
  const player = draftStore.allPlayers.find(p => p.id === playerId)
  if (player && ineligible(player)) {
    toastStore.showError('Over the salary cap — only contracts under $5M can be drafted.')
    return
  }
  audio.affirm()
  draftStore.makeUserPick(playerId)
}

function handleDraftFromModal(player) {
  if (!player) return
  handleDraftPick(player.id)
  showPlayerModal.value = false
}

// Computed
// Team-color theming must stay readable on both themes (e.g. Brooklyn's near-
// black on the dark panel). `clockAccent` is a contrast-safe version of the
// current team's color for text/accent lines; the badge fill keeps the raw
// color with an auto black/white label.
const isLightTheme = useIsLightTheme()
const clockColor = computed(() => draftStore.currentPick?.teamColor || null)
const clockAccent = computed(() => readableAccent(clockColor.value, isLightTheme.value))
const clockBadgeText = computed(() => idealTextOn(clockColor.value || '#666'))

const timerProgress = computed(() => draftStore.timerSeconds / 60)

// Unified countdown ring around the team badge — the user's 60s pick clock OR an
// AI team's "deciding" countdown. 0..1, colored by fraction (≈ old 30s/10s).
const clockProgress = computed(() =>
  draftStore.isUserPick ? timerProgress.value : draftStore.aiDecideProgress
)
const showClockRing = computed(() =>
  !draftStore.isSimming && !draftStore.isDraftComplete && clockProgress.value > 0
)
const ringColor = computed(() => {
  const p = clockProgress.value
  if (p > 0.5) return '#4ade80'
  if (p > 0.17) return '#fbbf24'
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

// Ticker marquee — the most recent 50 completed picks, in pick order. Using a
// rolling window (rather than the current round) means it never empties out when
// a new round starts; it just keeps sliding forward as picks come in.
const roundTickerItems = computed(() => {
  return draftStore.draftResults.slice(-50)
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

// Salary + years remaining for the fantasy-draft pool (existing league players
// carry contracts; rookies don't, so this column is hidden in rookie mode).
function formatContract(player) {
  const salary = player.contractSalary ?? player.contract_salary ?? 0
  const years = player.contractYearsRemaining ?? player.contract_years_remaining ?? 0
  if (!salary) return '—'
  const amount = salary >= 1000000
    ? `$${(salary / 1000000).toFixed(1)}M`
    : `$${Math.round(salary / 1000)}K`
  return years ? `${amount} · ${years}y` : amount
}

// Over-cap penalty: a fantasy-draft player the user currently can't draft
// (only meaningful while the user is over the cap; always false otherwise).
function ineligible(player) {
  return !draftStore.isPlayerDraftEligible(player)
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
      current.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
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

// Per-pick / on-the-clock toast notifications were intentionally removed from the
// live draft (both fantasy and rookie): the persistent LAST PICK card and the
// in-panel on-the-clock transition convey the same info without filling the
// toast lane.

async function handleSkipToMyPick() {
  await draftStore.simToNextUserPick(campaignId.value)
}

async function handleSkipEntire() {
  await draftStore.simEntireDraft(campaignId.value)
}

function handleSkipCurrent() {
  draftStore.simCurrentPick()
}

// Confirmation popup for the skip buttons (guards accidental taps, esp. on the
// icon-only mobile footer).
const skipConfirm = ref({ show: false, title: '', message: '', confirmLabel: 'Skip', danger: false, action: null })
function askSkip(type) {
  if (type === 'current') {
    skipConfirm.value = {
      show: true, title: 'Skip Pick', danger: false, confirmLabel: 'Skip Pick',
      message: 'Skip ahead through the current pick?', action: handleSkipCurrent,
    }
  } else if (type === 'mine') {
    skipConfirm.value = {
      show: true, title: 'Skip to My Pick', danger: false, confirmLabel: 'Skip to My Pick',
      message: 'Simulate every pick until your next selection?', action: handleSkipToMyPick,
    }
  } else {
    skipConfirm.value = {
      show: true, title: 'Skip Entire Draft', danger: true, confirmLabel: 'Skip Entire Draft',
      message: 'Auto-draft the rest of the draft? Every remaining pick — including yours — will be filled automatically.',
      action: handleSkipEntire,
    }
  }
}
function confirmSkip() {
  const fn = skipConfirm.value.action
  skipConfirm.value.show = false
  if (fn) fn()
}
function cancelSkip() {
  skipConfirm.value.show = false
}

// Continue-to-Season click handler. Plays the generic tap explicitly + tells
// the global click listener in main.js to skip its own navigate() on this
// event so the sound only fires once.
function onContinueClick() {
  audio.suppressClickSound()
  audio.play('navigate')
  handleFinalize()
}

async function handleFinalize() {
  try {
    if (isRookieMode.value) {
      await draftStore.finalizeRookieDraft(campaignId.value)
    } else {
      await draftStore.finalizeDraft(campaignId.value)
    }
    showCompleteModal.value = false
    await campaignStore.fetchCampaign(campaignId.value)
    await teamStore.fetchTeam(campaignId.value, { force: true })
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

  // The draft room is a fixed-height (100dvh) page that should never scroll. The
  // document/body behind it can still scroll a hair on iOS (body min-height:100vh >
  // the visible viewport, plus rubber-band overscroll), which let the user drag the
  // whole page up/down. Lock the document scroll while this view is mounted.
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'

  try {
    let campaign = campaignStore.currentCampaign
    if (!campaign || campaign.id != campaignId.value) {
      campaign = await campaignStore.fetchCampaign(campaignId.value)
    }

    const rookieMode = route.query.mode === 'rookie'

    if (!rookieMode && campaign?.draft_completed) {
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

    if (rookieMode) {
      // --- ROOKIE DRAFT MODE ---
      // Let the loading view paint a couple of frames FIRST so the iOS WebView
      // settles its safe-area insets / viewport before the heavy rookie-class
      // generation below blocks the main thread. Without this, the generation can
      // starve the layout while env(safe-area-inset-*) is still 0, latching a stale
      // layout that renders the draft room above the top safe area — a rookie-only
      // symptom (fantasy drafts skip generation). Re-entry/relaunch "fixes" it
      // because the insets are already settled by then.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      // Load scouting data so unscouted attributes stay hidden, plus the scout
      // points + hired-scout context so the user can reveal attributes mid-draft.
      scoutedPlayers.value = campaign?.settings?.scoutedPlayers || {}
      scoutingPoints.value = campaign?.settings?.scoutingPoints ?? 0
      scoutRecord = campaign?.settings?.scout ?? null
      scoutFacilityLevel = teamsList.find(t => t.id === campaign.teamId)?.facilities?.scouting ?? 1

      const cacheMode = 'rookie'
      const restored = await draftStore.loadDraftFromCache(campaignId.value, cacheMode)

      if (restored && draftStore.draftOrder.length > 0) {
        // Reload rookies (draft prospects for this year). Funnel through
        // generateAndSaveRookieClass so its repair pass fixes any rookie
        // with overall > potential before the draft list renders.
        // draftYear = season year the rookies will first play (currentSeasonYear + 1).
        const seasonYearForDraft = (campaign.currentSeasonYear ?? 2025) + 1
        const rookies = await generateAndSaveRookieClass(campaignId.value, seasonYearForDraft)
        draftStore.allPlayers = rookies
        draftStore.teams = teamsList

        if (draftStore.isUserPick && !draftStore.isDraftComplete) {
          draftStore.startTimer()
        } else if (!draftStore.isDraftComplete) {
          draftStore.autoPlayAIPicks(campaignId.value)
        }
      } else {
        // Fresh rookie draft
        const gameYear = campaign.gameYear ?? 1
        const seasonYearForDraft = (campaign.currentSeasonYear ?? 2025) + 1

        // Get or generate rookies (also repairs OVR>POT in pre-existing data)
        const rookies = await generateAndSaveRookieClass(campaignId.value, seasonYearForDraft)

        // Load standings for draft order
        const seasonYear = campaign.currentSeasonYear ?? 2025
        const seasonData = await SeasonRepository.get(campaignId.value, seasonYear)
        const standings = seasonData?.standings || { east: [], west: [] }

        // Build draft order from standings. Honor the draft lottery result
        // when one was run earlier in the offseason — without this, the
        // interactive draft fires in pre-lottery reverse-standings order
        // even though the lottery picked a different sequence (and the
        // auto-sim path was already using the lottery, so the two flows
        // would disagree).
        const lotteryResult = campaign?.settings?.draftLottery ?? null
        const draftOrderSlots = buildRookieDraftOrder(teamsList, standings, gameYear, lotteryResult)

        // Compute team directions for AI drafting. The user team carries its LIVE
        // (dynamic) owner expectation so the direction reflects how the franchise
        // is actually trending — not the static preseason mandate.
        const context = buildContext({ standings, teams: teamsList, seasonPhase: 'offseason' })
        const userTeamForDir = teamsList.find(t => t.id === campaign.teamId)
        const userTier = userTeamForDir
          ? getEffectiveExpectation(campaign, findOwnerForTeam(userTeamForDir.abbreviation)).tier
          : null
        const directions = {}
        for (const team of teamsList) {
          const teamRoster = allPlayers.filter(p => p.teamId === team.id)
          const dirTeam = (userTier && team.id === campaign.teamId)
            ? { ...team, effectiveExpectation: userTier }
            : team
          directions[team.id] = analyzeTeamDirection(dirTeam, teamRoster, context)
        }

        draftStore.initializeRookieDraft(campaign, rookies, teamsList, draftOrderSlots, directions)
        draftStore.saveDraftToCache(campaignId.value)

        if (!draftStore.isUserPick) {
          draftStore.autoPlayAIPicks(campaignId.value)
        } else {
          draftStore.startTimer()
        }
      }
    } else {
      // --- FANTASY DRAFT MODE (existing behavior) ---
      // The fantasy draft pools existing league players only. Next year's draft
      // class (generated rookies, isDraftProspect) lives in the same campaign
      // player store but must NOT be draftable here — they belong to the rookie
      // draft. Exclude them so neither the user nor the AI can pick them.
      const fantasyPool = allPlayers.filter(p => !p.isDraftProspect)
      const restored = await draftStore.loadDraftFromCache(campaignId.value)

      if (restored && draftStore.draftOrder.length > 0) {
        draftStore.allPlayers = fantasyPool
        draftStore.teams = teamsList

        if (draftStore.isUserPick && !draftStore.isDraftComplete) {
          draftStore.startTimer()
        } else if (!draftStore.isDraftComplete) {
          draftStore.autoPlayAIPicks(campaignId.value)
        }
      } else {
        draftStore.initializeDraft(campaign, fantasyPool, teamsList)
        draftStore.saveDraftToCache(campaignId.value)

        if (!draftStore.isUserPick) {
          draftStore.autoPlayAIPicks(campaignId.value)
        } else {
          draftStore.startTimer()
        }
      }
    }
  } catch (e) {
    error.value = e.message || 'Failed to load draft'
    console.error('Draft load error:', e)
  } finally {
    loading.value = false
  }

  // First-visit walkthrough for the live draft. The watcher above pauses the
  // pick clock as soon as it starts, so tips never burn the user's timer. Guard
  // against the error / already-completed-redirect paths where no draft renders.
  if (!error.value && !draftStore.isDraftComplete && draftStore.draftOrder.length > 0) {
    walkthroughStore.maybeStart('liveDraft')
  }
})

onUnmounted(() => {
  // Restore document scroll locked in onMounted.
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  draftStore.stopTimer()
  draftStore.skipRequested = true
  // If the user leaves mid-tour, end it and make sure the clock isn't left
  // frozen for a future draft in this session.
  if (walkthroughStore.activeKey === 'liveDraft') walkthroughStore.skip()
  draftStore.timerPaused = false
  // Tear down teleported overlays so they can't orphan in <body> and block taps.
  skipConfirm.value.show = false
  attrTip.value.show = false
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
          <h1 class="draft-title">{{ isRookieMode ? 'ROOKIE DRAFT' : 'FANTASY DRAFT' }}</h1>
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
      <div class="draft-ticker" ref="tickerRef" data-tour="draft-ticker">
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
            <span class="ticker-badge" :class="{ picked: slot.isCompleted && slot.result }">
              {{ slot.isCompleted && slot.result ? slot.result.playerName?.split(' ').pop() : `#${slot.pick}` }}
            </span>
            <div class="ticker-team-badge" :style="{ backgroundColor: slot.teamColor }">
              {{ slot.teamAbbr }}
            </div>
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
              <span class="rt-pick">#{{ pick.pick }}</span>
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
              <span class="rt-pick">#{{ pick.pick }}</span>
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
        <aside class="draft-sidebar roster-panel" data-tour="draft-roster">
          <div class="roster-head-row">
            <h3 class="sidebar-title">YOUR ROSTER</h3>
            <div class="roster-count">{{ isRookieMode ? `${draftStore.userRoster.length} picks made` : `${draftStore.userRoster.length} / 15` }}</div>
          </div>

          <!-- Salary cap (fantasy drafts only) -->
          <DraftCapReadout />

          <!-- Scout points (rookie drafts only) — ticks down as you scout. -->
          <div v-if="isRookieMode" class="scout-readout">
            <span class="scout-readout-label">Scout Points</span>
            <span class="scout-readout-value">{{ scoutingPoints }}</span>
          </div>


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
          <!-- Stage: on the clock (left 70%) merged with last pick (right 30%) -->
          <div class="draft-stage" :class="{ 'stage-complete': draftStore.isDraftComplete }">
          <!-- On The Clock -->
          <div
            class="on-the-clock"
            :class="{ 'user-turn': draftStore.isUserPick, pulse: clockPulse }"
            :style="{
              '--clock-color': draftStore.currentPick?.teamColor || 'var(--color-primary)',
              '--clock-accent': clockAccent || 'var(--color-primary)',
            }"
            data-tour="draft-clock"
          >
            <div v-if="!draftStore.isDraftComplete" class="clock-content">
              <div class="clock-badge-wrap">
                <svg v-if="showClockRing" class="badge-ring" viewBox="0 0 60 60">
                  <circle cx="30" cy="30" r="28" class="badge-ring-track" />
                  <circle
                    cx="30" cy="30" r="28"
                    class="badge-ring-progress"
                    :class="{ 'ring-slow': draftStore.isUserPick }"
                    :stroke="ringColor"
                    stroke-linecap="round"
                    :stroke-dasharray="175.9"
                    :stroke-dashoffset="175.9 * (1 - clockProgress)"
                    transform="rotate(-90 30 30)"
                  />
                </svg>
                <div
                  class="clock-team-badge"
                  :style="{ backgroundColor: draftStore.currentPick?.teamColor || '#666', color: clockBadgeText }"
                >
                  {{ draftStore.currentPick?.teamAbbr }}
                </div>
              </div>
              <div class="clock-info">
                <div class="clock-team-name">{{ draftStore.currentPick?.teamName }}</div>
                <div class="clock-status">
                  <template v-if="draftStore.isSimming">SKIPPING...</template>
                  <template v-else-if="draftStore.isAutoPlaying && !draftStore.isUserPick">DECIDING...</template>
                  <template v-else-if="draftStore.isUserPick">ON THE CLOCK</template>
                  <template v-else>SELECTING...</template>
                </div>
                <div v-if="!draftStore.isSimming" class="clock-commish">
                  <Timer :size="12" />
                  <span>{{ commishLine }}</span>
                </div>
              </div>
            </div>
            <div v-else class="clock-content draft-complete">
              <div class="clock-status">DRAFT COMPLETE</div>
              <!-- Inline continue path. Mirrors the DraftCompleteModal's
                   @continue handler so the user can advance without going
                   through the modal — useful on mobile where the modal can
                   feel like an extra step. -->
              <button
                class="continue-btn"
                :disabled="draftStore.isFinalizing"
                @click="onContinueClick"
              >
                {{ draftStore.isFinalizing ? 'Continuing…' : 'Continue to Season' }}
              </button>
            </div>
          </div>

          <!-- Last Pick (right 35% of the stage) — hidden once the draft is over -->
          <DraftLastPick v-if="!draftStore.isDraftComplete" class="stage-lastpick" :campaign-id="campaignId" />
          </div>

          <!-- Rookie-only announcer line (typewriter), above the news ticker -->
          <DraftAnnouncer :draft-year="draftYear" />

          <!-- Recent picks — minimal vertical news ticker -->
          <DraftNewsTicker />

          <!-- Player Pool -->
          <div class="player-pool" data-tour="draft-pool">
            <!-- Filters -->
            <div class="pool-filters" data-tour="draft-filters">
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

            <!-- Player list: fixed identity (sortable) + per-row horizontally
                 scrollable attribute strip + pinned Draft/Details button. -->
            <div class="pool-list-wrap">
              <div class="pool-head">
                <div class="ph-identity">
                  <button class="ph-sort" @click="draftStore.toggleSort('lastName')">
                    Name
                    <ChevronUp v-if="getSortIcon('lastName') === 'asc'" :size="11" />
                    <ChevronDown v-if="getSortIcon('lastName') === 'desc'" :size="11" />
                  </button>
                  <button class="ph-sort ph-num" @click="draftStore.toggleSort('overallRating')">
                    OVR
                    <ChevronUp v-if="getSortIcon('overallRating') === 'asc'" :size="11" />
                    <ChevronDown v-if="getSortIcon('overallRating') === 'desc'" :size="11" />
                  </button>
                  <button class="ph-sort ph-num" @click="draftStore.toggleSort('potentialRating')">
                    POT
                    <ChevronUp v-if="getSortIcon('potentialRating') === 'asc'" :size="11" />
                    <ChevronDown v-if="getSortIcon('potentialRating') === 'desc'" :size="11" />
                  </button>
                </div>
                <div class="ph-attrs">Attributes →</div>
                <div class="pool-count">{{ draftStore.availablePlayers.length }} players</div>
              </div>

              <div class="pool-list">
                <div
                  v-for="(player, idx) in draftStore.filteredPlayers.slice(0, 100)"
                  :key="player.id"
                  class="pool-item"
                >
                  <div
                    class="player-row"
                    :class="{ 'over-cap': ineligible(player) }"
                    :data-tour="idx === 0 ? 'draft-player-row' : null"
                  >
                    <div class="row-identity" @click="openPlayerModal(player)">
                      <div class="ri-head">
                        <span class="pos-badge">{{ player.position }}</span>
                        <span class="ri-name">{{ shortName(player) }}</span>
                      </div>
                      <div class="ri-stats">
                        <span class="ri-stat" :class="{ unrevealed: !isAttributeRevealed(player.id, 'overallRating') }">OVR {{ getScoutedDisplay(player, 'overallRating') }}</span>
                        <span class="ri-stat" :class="{ unrevealed: !isAttributeRevealed(player.id, 'potentialRating') }">POT {{ getScoutedDisplay(player, 'potentialRating') }}</span>
                      </div>
                      <div v-if="!isRookieMode" class="ri-contract">
                        {{ formatContract(player) }}
                        <span v-if="ineligible(player)" class="overcap-chip">OVER CAP</span>
                      </div>
                    </div>

                    <div class="row-attrs">
                      <span
                        v-for="a in DRAFT_ATTRIBUTES"
                        :key="a.key"
                        class="attr-chip"
                        :class="{ unrevealed: !isAttributeRevealed(player.id, a.key) }"
                        :style="{ '--cat': attrChipColor(player, a.key) }"
                        @mouseenter="showAttrTip($event, a.name)"
                        @mouseleave="hideAttrTip"
                      >
                        <span class="ac-lbl">{{ a.label }}</span>
                        <span class="ac-val">{{ attrDisplay(player, a.key) }}</span>
                      </span>
                    </div>

                    <div class="row-action">
                      <button
                        v-if="draftStore.isUserPick && !draftStore.isSimming && !draftStore.isDraftComplete && !ineligible(player)"
                        class="btn-draft"
                        @click.stop="handleDraftPick(player.id)"
                      >
                        Draft
                      </button>
                      <button
                        v-else-if="draftStore.isUserPick && !draftStore.isSimming && !draftStore.isDraftComplete"
                        class="btn-overcap"
                        disabled
                        title="Over the salary cap — only contracts under $5M can be drafted."
                        @click.stop
                      >
                        Over Cap
                      </button>
                      <button
                        v-else
                        class="btn-details"
                        aria-label="View details"
                        title="View details"
                        @click.stop="openPlayerModal(player)"
                      >
                        <Search :size="14" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
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
          <button class="drawer-handle" aria-label="Close roster" @click="showMobileRoster = false"></button>
          <div class="mobile-roster-header">
            <h3 class="sidebar-title">YOUR ROSTER</h3>
            <button class="mobile-roster-close" @click="showMobileRoster = false">
              <X :size="18" />
            </button>
          </div>
          <!-- Salary cap (fantasy drafts only) -->
          <DraftCapReadout />

          <!-- Scout points (rookie drafts only) — ticks down as you scout. -->
          <div v-if="isRookieMode" class="scout-readout">
            <span class="scout-readout-label">Scout Points</span>
            <span class="scout-readout-value">{{ scoutingPoints }}</span>
          </div>

          <div class="roster-count">{{ isRookieMode ? `${draftStore.userRoster.length} picks made` : `${draftStore.userRoster.length} / 15` }}</div>


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
        <!-- Mobile-only pull-up handle: signals the footer toggles the roster sheet -->
        <button class="footer-handle" aria-label="Toggle roster" @click="showMobileRoster = !showMobileRoster"></button>
        <div class="sim-controls" data-tour="draft-controls">
          <button
            class="sim-btn roster-toggle-btn"
            :class="{ open: showMobileRoster }"
            data-tour="draft-roster-toggle"
            @click="showMobileRoster = !showMobileRoster"
          >
            <Users :size="16" />
            <span class="roster-toggle-label">Roster</span>
            <span class="roster-toggle-count">{{ draftStore.userRoster.length }}</span>
            <ChevronUp :size="14" class="roster-toggle-chev" />
          </button>
          <button
            class="sim-btn"
            :disabled="draftStore.isSimming || draftStore.isDraftComplete || draftStore.isUserPick"
            @click="askSkip('current')"
          >
            <SkipBack :size="16" />
            <span class="sim-label">Skip Pick</span>
          </button>
          <button
            v-if="draftStore.hasUpcomingUserPick"
            class="sim-btn"
            :disabled="draftStore.isSimming || draftStore.isDraftComplete"
            @click="askSkip('mine')"
          >
            <FastForward :size="16" />
            <span class="sim-label">Skip to My Pick</span>
          </button>
          <button
            class="sim-btn sim-all"
            :disabled="draftStore.isSimming || draftStore.isDraftComplete"
            @click="askSkip('all')"
          >
            <SkipForward :size="16" />
            <span class="sim-label">Skip Entire Draft</span>
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
      :draft-mode="draftStore.draftMode"
      @continue="handleFinalize"
      @close="showCompleteModal = false"
    />

    <!-- Prospect Detail Modal (rookie draft — read-only scouting view) -->
    <PlayerDetailModal
      v-if="isRookieMode"
      :show="showPlayerModal"
      :player="selectedPlayer"
      :show-growth="false"
      :show-history="false"
      :scouting-mode="true"
      :revealed-attributes="selectedPlayer ? getRevealedAttributes(selectedPlayer.id) : []"
      :is-fully-scouted="selectedPlayer ? isFullyScouted(selectedPlayer.id) : false"
      :scouting-points="scoutingPoints"
      :scouting-in-progress="scoutingInProgress"
      :badges-revealed="selectedPlayer ? (scoutedPlayers[selectedPlayer.id]?.badgesRevealed || false) : false"
      :morale-revealed="selectedPlayer ? (scoutedPlayers[selectedPlayer.id]?.moraleRevealed || false) : false"
      :can-draft="canDraftCurrent"
      @scout-player="scoutSelectedPlayer"
      @draft-player="handleDraftFromModal"
      @close="showPlayerModal = false"
    />

    <!-- Player Detail Modal (fantasy draft — full profile of an existing player) -->
    <PlayerDetailModal
      v-else
      :show="showPlayerModal"
      :player="selectedPlayer"
      :show-growth="false"
      :show-history="false"
      :can-draft="canDraftCurrent"
      :in-draft="true"
      @draft-player="handleDraftFromModal"
      @close="showPlayerModal = false"
    />

    <!-- Attribute name tooltip (teleported so the scroll strip can't clip it) -->
    <Teleport to="body">
      <div
        v-if="attrTip.show"
        class="attr-tip"
        :style="{ left: attrTip.x + 'px', top: attrTip.y + 'px' }"
      >{{ attrTip.text }}</div>
    </Teleport>

    <!-- Skip confirmation -->
    <Teleport to="body">
      <Transition name="skipm">
        <div v-if="skipConfirm.show" class="skip-overlay" @click.self="cancelSkip">
          <div class="skip-card">
            <header class="skip-header">
              <h2 class="skip-title">{{ skipConfirm.title }}</h2>
              <button class="skip-close" aria-label="Close" @click="cancelSkip">
                <X :size="18" />
              </button>
            </header>
            <p class="skip-message">{{ skipConfirm.message }}</p>
            <div class="skip-actions">
              <button class="skip-cancel" @click="cancelSkip">Cancel</button>
              <button class="skip-confirm" :class="{ danger: skipConfirm.danger }" @click="confirmSkip">
                {{ skipConfirm.confirmLabel }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.draft-room {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  overflow: hidden;
  /* Kill iOS rubber-band/overscroll so the page can't be dragged up/down. */
  overscroll-behavior: none;
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
  /* Matches TeamHeader's .team-name sizing (2.5rem mobile → 3rem desktop)
     so page headers feel consistent across the app. */
  font-size: 2.5rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  line-height: 1;
  background: var(--gradient-cosmic);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Desktop bump — same breakpoint and value used by TeamHeader.vue. */
@media (min-width: 767px) {
  .draft-title {
    font-size: 3rem;
  }
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
  /* Left-aligned current slot sits just inside the track's edge padding. */
  scroll-padding-left: 24px;
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
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 8px;
  min-width: 44px;
  min-height: 44px;
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
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  font-weight: 700;
  color: white;
}

/* Minimal badge in the slot's top-left: pick # → player name once selected. */
.ticker-badge {
  position: absolute;
  top: 0px;
  left: 3px;
  max-width: calc(100% - 6px);
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.75);
  font-size: 0.52rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ticker-badge.picked {
  color: var(--color-text-primary);
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
  /* 120s = ~half the previous speed again (was 60s, originally 30s). */
  animation: marquee 120s linear infinite;
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

.rt-pick {
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
  margin-right: 2px;
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

/* Desktop sidebar: title + count on one row, pushed to opposite edges. */
.roster-head-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.roster-head-row .sidebar-title,
.roster-head-row .roster-count {
  margin-bottom: 0;
}

/* Fantasy-draft salary cap readout lives in components/draft/DraftCapReadout.vue */

/* Rookie-draft scout-points readout (mirrors the cap readout's styling). */
.scout-readout {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
  border-left: 3px solid var(--color-primary);
}

.scout-readout-label {
  font-size: 0.52rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.scout-readout-value {
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--color-primary);
}

/* Over-cap penalty — ineligible player rows */
.overcap-chip {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.35);
  white-space: nowrap;
}

.player-row.over-cap {
  opacity: 0.5;
}

.btn-overcap {
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 0.72rem;
  font-weight: 700;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  cursor: not-allowed;
  white-space: nowrap;
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

/* Merged stage: on-the-clock (70%) + last pick (30%) as one element */
.draft-stage {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.draft-stage > .on-the-clock {
  flex: 0 0 65%;
  min-width: 0;
  border-bottom: none;
}

/* Draft over: last-pick is hidden, so the clock fills the stage (no empty gap). */
.draft-stage.stage-complete > .on-the-clock {
  flex: 1 1 auto;
}

.draft-stage > .stage-lastpick {
  flex: 0 0 35%;
  text-align:center;
  min-width: 0;
  border-bottom: none;
  border-left: 1px solid var(--glass-border);
}

/* On The Clock */
.on-the-clock {
  display:flex;
  padding: 18px 24px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--clock-color) 14%, transparent), transparent 70%),
    var(--color-bg-secondary);
  border-bottom: 1px solid var(--glass-border);
  border-left: 4px solid var(--clock-accent);
  box-shadow: inset 0 0 30px color-mix(in srgb, var(--clock-accent) 10%, transparent);
  flex-shrink: 0;
  transition: border-color 0.3s ease, background 0.3s ease;
}

.on-the-clock.user-turn {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--clock-color) 22%, transparent), transparent 70%),
    var(--color-bg-secondary);
}

.clock-content {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas:
    "clock-team-badge clock-team-name clock-team-name"
    "clock-team-badge clock-team-name clock-team-name"
    "clock-team-badge clock-team-status clock-team-status"
    "clock-commish clock-commish clock-commish";
  align-items: center;
  column-gap: 18px;
  row-gap: 2px;
}

/* The wrapper generates no box so its children (name/status/commish) become
   direct grid items of .clock-content and can land in their template areas. */
.clock-info {
  display: contents;
}

.clock-team-badge {
  /* Fills the wrap; circular so the countdown ring wraps its border cleanly. */
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  /* text color set inline (auto black/white for the team fill) */
  /* soft glow only — the SVG ring now provides the outline */
  box-shadow: 0 0 14px color-mix(in srgb, var(--clock-accent) 30%, transparent);
}

.clock-team-name {
  grid-area: clock-team-name;
  min-width: 0;
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--color-text-primary);
  line-height: 1.1;
}

.clock-status {
  grid-area: clock-team-status;
  min-width: 0;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--clock-accent);
}

.clock-commish {
  grid-area: clock-commish;
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  min-width: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.clock-commish svg {
  min-width: 14px;
}

/* Brief pulse when a new team comes on the clock (in-panel, no overlay). */
.on-the-clock.pulse {
  animation: clock-pulse 0.9s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes clock-pulse {
  0% { box-shadow: inset 0 0 0 0 transparent; }
  35% {
    box-shadow: inset 0 0 40px color-mix(in srgb, var(--clock-accent) 28%, transparent),
      0 0 0 1px color-mix(in srgb, var(--clock-accent) 50%, transparent);
  }
  100% { box-shadow: inset 0 0 30px color-mix(in srgb, var(--clock-accent) 10%, transparent); }
}

/* Draft-complete state — replaces the timer with an inline Continue CTA.
   Layout switches to a row with the status + button so the user can
   advance straight from the page without dismissing the modal first. */
.clock-content.draft-complete {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width:100%;
}

.continue-btn {
  padding: 8px 18px;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 0.95rem;
  letter-spacing: 0.06em;
  font-weight: 400;
  text-transform: uppercase;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.1s ease;
}

.continue-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.continue-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.continue-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Countdown ring wrapped around the team badge (user + AI) */
.clock-badge-wrap {
  grid-area: clock-team-badge;
  align-self: center;
  position: relative;
  width: 60px;
  height: 60px;
  flex-shrink: 0;
}

.badge-ring {
  position: absolute;
  inset: 0;
  width: 60px;
  height: 60px;
  pointer-events: none;
}

.badge-ring-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 3;
}

.badge-ring-progress {
  fill: none;
  stroke-width: 3;
  /* AI ring updates ~10x/sec — keep the tween short so it tracks closely. */
  transition: stroke-dashoffset 0.15s linear, stroke 0.3s ease;
}

/* User clock ticks once/sec — a 1s linear sweep reads as a smooth countdown. */
.badge-ring-progress.ring-slow {
  transition: stroke-dashoffset 1s linear, stroke 0.3s ease;
}

/* Player Pool */
.player-pool {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 24px 0;
}

/* Player count — sits in the header row beside "Attributes →", pushed right. */
.pool-count {
  display: flex;
  align-items: center;
  margin-left: auto;
  padding: 8px 10px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* Pool Filters */
.pool-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  /* Keep the position filters + search on one row (incl. mobile). */
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.position-filters {
  flex-shrink: 0;
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
  /* Grow to fill the row, but shrink so it shares the row with the filters. */
  flex: 1 1 auto;
  min-width: 0;
  max-width: 320px;
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

/* Player list (fixed identity + per-row scrollable attribute strip) */
.pool-list-wrap {
  flex: 1;
  overflow-y: auto;
  margin: 0 -24px;
  padding: 0 24px;
  min-height: 0;
  --identity-w: 168px;
}

.pool-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: stretch;
  background: var(--color-bg-primary);
  border-bottom: 1px solid var(--glass-border);
}

.ph-identity {
  flex: 0 0 var(--identity-w);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
}

.ph-attrs {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 8px 10px;
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.ph-sort {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  background: none;
  border: none;
  padding: 0;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.ph-sort:hover {
  color: var(--color-text-primary);
}

.pool-item {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.player-row {
  position: relative;
  display: flex;
  align-items: stretch;
  transition: background 0.15s ease;
}

.player-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.row-identity {
  flex: 0 0 var(--identity-w);
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 8px 10px;
  border-right: 1px solid var(--glass-border);
  cursor: pointer;
}

/* Position badge + player name on one row. */
.ri-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ri-name {
  flex: 1;
  min-width: 0;
  font-size: 0.695rem;
  text-decoration: underline;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* OVR + POT share one row, beneath the name/position. */
.ri-stats {
  display: flex;
  gap: 8px;
  font-size: 0.72rem;
}

.ri-stat {
  font-weight: 700;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* Small gold badge before the player name. */
.pos-badge {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--color-gold, #ffd700);
  color: #000;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.03em;
}

/* Horizontally-scrollable attribute strip — each row scrolls independently. */
.row-attrs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  /* Right padding clears the pinned action button so the last chip is reachable. */
  padding: 6px 100px 6px 10px;
  /* Scrollable, but no visible scrollbar (web + mobile). */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.row-attrs::-webkit-scrollbar {
  display: none;
}

.attr-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
  flex-shrink: 0;
  min-width: 45px;
  max-width: 45px;
  padding: 5px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 2px solid var(--cat);
}

.ac-lbl {
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid var(--color-text-tertiary);
}

.ac-val {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.attr-chip.unrevealed .ac-val {
  color: var(--color-text-tertiary);
  font-style: italic;
}

/* Attribute name tooltip — teleported to <body>, positioned above the chip. */
.attr-tip {
  position: fixed;
  transform: translate(-50%, -100%);
  z-index: 9999;
  padding: 4px 9px;
  background: var(--color-bg-elevated, #1b1e26);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}

/* Skip confirmation popup (compact, teleported to <body>). */
.skip-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.skip-card {
  width: 100%;
  max-width: 380px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl, 16px);
  box-shadow: var(--shadow-xl, 0 20px 50px rgba(0, 0, 0, 0.5));
  overflow: hidden;
}

.skip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--glass-border);
}

.skip-title {
  margin: 0;
  font-family: var(--font-display, 'Bebas Neue', sans-serif);
  font-size: 1.35rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
}

.skip-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: none;
  border-radius: var(--radius-full, 999px);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.skip-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.skip-message {
  margin: 0;
  padding: 16px 18px;
  font-size: 0.9rem;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.skip-actions {
  display: flex;
  gap: 10px;
  padding: 0 18px 16px;
}

.skip-cancel,
.skip-confirm {
  flex: 1;
  padding: 11px 16px;
  border-radius: var(--radius-xl, 12px);
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.15s ease;
}

.skip-cancel {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
}

.skip-cancel:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-secondary);
}

.skip-confirm {
  background: var(--color-primary);
  border: none;
  color: white;
}

.skip-confirm.danger {
  background: var(--color-error, #ef4444);
}

.skip-confirm:hover {
  filter: brightness(1.1);
}

.skipm-enter-active {
  transition: opacity 0.2s ease;
}
.skipm-leave-active {
  transition: opacity 0.15s ease;
}
.skipm-enter-from,
.skipm-leave-to {
  opacity: 0;
}

/* Identity OVR/POT when unscouted (rookie). */
.ri-stat.unrevealed {
  color: var(--color-text-tertiary);
  font-style: italic;
}

/* Pinned action button — attrs scroll beneath it; a fade masks the overlap. */
.row-action {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  padding: 0 10px 0 28px;
  background: linear-gradient(to right, transparent, var(--color-bg-primary) 40%);
  pointer-events: none;
}

.row-action > * {
  pointer-events: auto;
}

.btn-draft {
  padding: 5px 14px;
  font-size: 0.72rem;
  font-weight: 700;
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

/* Lower-emphasis sibling of .btn-draft — shown when the user isn't on the
   clock, so there's still a visible affordance to open the details modal. */
.btn-details {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-details:hover {
  border-color: var(--color-text-secondary);
  color: var(--color-text-primary);
}

/* Contract — folded into the identity column, on its own row under OVR/POT. */
.ri-contract {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--color-text-secondary);
  white-space: nowrap;
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

/* Roster toggle + drawer handles — hidden on desktop, shown on mobile */
.roster-toggle-btn {
  display: none;
}
.footer-handle {
  display: none;
}
.drawer-handle {
  display: none;
}

/* Mobile Roster Drawer */
.mobile-roster-backdrop {
  display: none;
}

.mobile-roster-drawer {
  display: none;
}

@media (max-width: 768px) {
  

  /* Reclaim vertical space on phones — drop the marquee ticker; the rookie
     announcer commentary gets the height instead. */
  .round-ticker {
    display: none;
  }

  .draft-main {
    flex-direction: column;
  }

  /* Stack the merged stage on phones (clock above last pick) */
  
  .draft-stage > .stage-lastpick {
    border-left: none;
    border-top: 1px solid var(--glass-border);
  }

  .clock-team-name {
    font-size: 1.1rem;
  }

  .clock-status {
    font-size: 0.9em;
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
  
  .draft-header {
    display:none;
  }

  .header-left {
    gap: 8px;
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

  .pool-list-wrap {
    margin: 0 -16px;
    padding: 0 16px;
    /* Narrower identity block on phones; each row still scrolls its attrs. */
    --identity-w: 120px;
  }

  /* Bigger tap targets on phones. */
  .btn-draft,
  .btn-details {
    padding: 8px 14px;
    font-size: 0.75rem;
  }

  .row-identity {
    padding: 10px 10px;
  }

  /* Footer reads as a pull-up surface: rounded top + a grab handle. */
  .draft-footer {
    position: relative;
    padding: 28px 16px calc(8px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)));
    flex-wrap: wrap;
    gap: 8px;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.22);
  }

  /* iOS native only (html.platform-ios is set in main.js; getPlatform() === 'web'
     in any browser): the home-indicator inset alone wasn't enough breathing room,
     so floor the footer's bottom padding at 80px. Does NOT affect web/Android. */
  html.platform-ios .draft-footer {
    padding-bottom: max(80px, calc(8px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom))));
  }

  .footer-handle {
    display: block;
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 4px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: var(--color-text-tertiary);
    opacity: 0.5;
    cursor: pointer;
  }

  .sim-controls {
    flex-wrap: wrap;
  }

  /* Icon-only footer buttons on mobile — hide the text labels. */
  .sim-btn {
    padding: 9px 12px;
    font-size: 0.75rem;
  }
  .sim-btn .sim-label,
  .roster-toggle-label {
    display: none;
  }

  .roster-panel {
    display: none;
  }

  /* Show roster toggle button on mobile, styled as a clear toggle */
  .roster-toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(232, 90, 79, 0.1);
    border-color: rgba(232, 90, 79, 0.3);
    color: var(--color-primary);
  }

  .roster-toggle-label {
    font-weight: 700;
    font-size: 0.78rem;
  }

  .roster-toggle-count {
    font-weight: 700;
    font-size: 0.8rem;
    padding: 0 6px;
    border-radius: 999px;
    background: rgba(232, 90, 79, 0.2);
  }

  .roster-toggle-chev {
    transition: transform 0.2s ease;
  }

  .roster-toggle-btn.open .roster-toggle-chev {
    transform: rotate(180deg);
  }

  /* Backdrop */
  .mobile-roster-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    /* Above the toast containers (z-index 100) so toasts don't poke through
       the dim layer when the roster drawer is open. */
    z-index: 105;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(2px);
  }

  /* Bottom-sheet drawer — slides up from the bottom edge. */
  .mobile-roster-drawer {
    display: flex;
    flex-direction: column;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    width: 100%;
    max-width: 100%;
    max-height: 70vh;
    /* Sits above the backdrop (105) and the toast containers (100) so the
       drawer always renders over any toasts while it's open. */
    z-index: 110;
    background: var(--color-bg-secondary);
    border-top: 1px solid var(--glass-border);
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.5);
    overflow-y: auto;
    padding: 8px 16px calc(16px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)));
  }

  /* Grab handle at the top of the sheet */
  .drawer-handle {
    display: block;
    width: 40px;
    height: 4px;
    margin: 4px auto 10px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: var(--color-text-tertiary);
    opacity: 0.5;
    cursor: pointer;
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
    position: absolute;
    top: 5px;
    right: 5px;
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
  transform: translateY(100%);
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
