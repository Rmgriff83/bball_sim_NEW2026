import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useAudioStore } from '@/stores/audio'

export const useToastStore = defineStore('toast', () => {
  const toasts = ref([])
  const minimalToasts = ref([])
  let nextId = 0

  function addToast(toast) {
    const id = nextId++
    const duration = toast.duration ?? 5000

    toasts.value.push({
      id,
      ...toast
    })

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id)
      }, duration)
    }

    return id
  }

  function removeToast(id) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index !== -1) {
      toasts.value.splice(index, 1)
    }
  }

  function showGameResult({ homeTeam, awayTeam, homeScore, awayScore, gameId, campaignId, isUserHome }) {
    // Play a result sound as the toast appears: affirmation on a user win,
    // the cancellation blip on a loss. Mirrors isWin() in ToastContainer.vue.
    const userWon = isUserHome === false
      ? awayScore > homeScore
      : homeScore > awayScore
    try {
      const audio = useAudioStore()
      audio.play(userWon ? 'affirm' : 'cancel')
    } catch { /* audio is best-effort */ }

    return addToast({
      type: 'game-result',
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      gameId,
      campaignId,
      isUserHome,
      duration: 8000
    })
  }

  function showWeeklySummary({ scoutingPointsEarned = 0, aiTrades = [], campaignId = null } = {}) {
    // Surface the weekly report when there's anything to report — scouting
    // points AND/OR league (AI-to-AI) trades that fired on the week boundary.
    if (scoutingPointsEarned <= 0 && !(Array.isArray(aiTrades) && aiTrades.length)) return null
    return addToast({
      type: 'weekly-summary',
      scoutingPointsEarned,
      aiTrades: Array.isArray(aiTrades) ? aiTrades : [],
      campaignId,
      duration: 6000
    })
  }

  // Verified "Player Signed" confirmation — a richer element than the minimal
  // success toast, with an affirmation chime on appearance.
  function showPlayerSigned({ playerName, position, overallRating, salary, years }) {
    try {
      const audio = useAudioStore()
      audio.play('affirm')
    } catch { /* audio is best-effort */ }

    return addToast({
      type: 'player-signed',
      playerName,
      position,
      overallRating,
      salary,
      years,
      duration: 5000,
    })
  }

  // Token reward (playoff payouts, etc.) — a richer element than the minimal
  // success toast, with an affirmation chime on appearance.
  function showTokenAward({ label, amount }) {
    try {
      const audio = useAudioStore()
      audio.play('affirm')
    } catch { /* audio is best-effort */ }

    return addToast({
      type: 'token-award',
      label,
      amount,
      duration: 6000,
    })
  }

  // Achievement unlocked (championship, conference title, playoff berth, GM
  // promotion, …) — a rich callout mirroring the token-award toast, with an
  // affirmation chime. `type` drives the icon/accent in ToastContainer.
  function showAchievement({ label, subtitle = '', subtitleTpl = '', subtitleParams = null, type = '', header = '' }) {
    try {
      const audio = useAudioStore()
      audio.play('affirm')
    } catch { /* audio is best-effort */ }

    return addToast({
      type: 'achievement',
      label,
      subtitle,
      subtitleTpl,
      subtitleParams,
      achievementType: type,
      // Optional header override — the rich callout is reused for non-award
      // notices (e.g. roster imports); default stays "Achievement Unlocked".
      header,
      duration: 6000,
    })
  }

  // Owner raised their season expectation mid-season — a rich, clickable
  // callout (routes to the Owner tab). `fromLabel`/`label` = tier names.
  function showOwnerExpectation({ label, fromLabel = '', campaignId = null }) {
    try {
      const audio = useAudioStore()
      audio.play('affirm')
    } catch { /* audio is best-effort */ }

    return addToast({
      type: 'owner-expectation',
      label,
      fromLabel,
      campaignId,
      duration: 8000,
    })
  }

  function showDraftPick({ pickNumber, teamAbbr, teamColor, playerName, position, overallRating, isUserTeam }) {
    return addToast({
      type: 'draft-pick',
      pickNumber,
      teamAbbr,
      teamColor,
      playerName,
      position,
      overallRating,
      isUserTeam,
      duration: 4000
    })
  }

  // Minimal toast functions
  function addMinimalToast(toast) {
    const id = nextId++
    const duration = toast.duration ?? (toast.type === 'loading' ? 0 : 4000)

    minimalToasts.value.push({
      id,
      ...toast
    })

    // Auto-remove after duration (0 = no auto-remove, for loading states)
    if (duration > 0) {
      setTimeout(() => {
        removeMinimalToast(id)
      }, duration)
    }

    return id
  }

  function removeMinimalToast(id) {
    const index = minimalToasts.value.findIndex(t => t.id === id)
    if (index !== -1) {
      minimalToasts.value.splice(index, 1)
    }
  }

  function showLoading(message) {
    return addMinimalToast({
      type: 'loading',
      message,
      duration: 0
    })
  }

  // Accepts either a duration number (legacy) or an options object with
  // { duration, link: { to, label } }. Backward-compatible — all existing
  // showSuccess('msg') and showSuccess('msg', 3000) calls keep working.
  function showSuccess(message, durationOrOpts = 2000) {
    const opts = typeof durationOrOpts === 'object' && durationOrOpts !== null
      ? durationOrOpts
      : { duration: durationOrOpts }
    return addMinimalToast({
      type: 'success',
      message,
      link: opts.link ?? null,
      duration: opts.duration ?? 2000
    })
  }

  function showError(message, duration = 4000) {
    return addMinimalToast({
      type: 'error',
      message,
      duration
    })
  }

  function showProgress(message, completed = 0, total = 0) {
    return addMinimalToast({
      type: 'progress',
      message,
      completed,
      total,
      duration: 0
    })
  }

  function updateProgress(id, completed, total) {
    const toast = minimalToasts.value.find(t => t.id === id)
    if (toast) {
      toast.completed = completed
      toast.total = total
    }
  }

  return {
    toasts,
    minimalToasts,
    addToast,
    removeToast,
    showGameResult,
    showWeeklySummary,
    showDraftPick,
    showPlayerSigned,
    showTokenAward,
    showAchievement,
    showOwnerExpectation,
    addMinimalToast,
    removeMinimalToast,
    showLoading,
    showSuccess,
    showError,
    showProgress,
    updateProgress
  }
})
