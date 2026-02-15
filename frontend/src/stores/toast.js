import { defineStore } from 'pinia'
import { ref } from 'vue'

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

  function showSuccess(message, duration = 2000) {
    return addMinimalToast({
      type: 'success',
      message,
      duration
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
    showDraftPick,
    addMinimalToast,
    removeMinimalToast,
    showLoading,
    showSuccess,
    showError,
    showProgress,
    updateProgress
  }
})
