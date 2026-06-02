import { defineStore } from 'pinia'
import { ref } from 'vue'

// Tiny return-context store for the headshot editor.
//
// PlayerDetailModal captures { routeName, routeParams, playerId } before
// navigating to /headshot-editor. The editor reads it on exit to know where
// to send the user back. The destination view reads it on mount and auto-
// reopens the modal for that playerId so the user lands exactly where they
// left off — no separate route params or query strings on the host pages.

export const useHeadshotEditorReturnStore = defineStore('headshotEditorReturn', () => {
  const returnRoute = ref(null)   // { name, params }
  const playerId = ref(null)

  function capture({ routeName, routeParams, playerId: pid }) {
    returnRoute.value = { name: routeName, params: routeParams ? { ...routeParams } : {} }
    playerId.value = pid
  }

  function peek() {
    return { route: returnRoute.value, playerId: playerId.value }
  }

  function consume() {
    const snapshot = peek()
    returnRoute.value = null
    playerId.value = null
    return snapshot
  }

  function clear() {
    returnRoute.value = null
    playerId.value = null
  }

  return { returnRoute, playerId, capture, peek, consume, clear }
})
