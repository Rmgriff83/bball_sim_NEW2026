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
  const returnRoute = ref(null)   // { name, params, query }
  const playerId = ref(null)

  // `routeQuery` keeps tab state alive across the round-trip — views like
  // TeamManagementView drive their active tab/sub-tab entirely from the query
  // (?tab=facilities&sub=scouting), so dropping it would dump the user back
  // on the view's default tab. `playerId` is optional: coach/staff avatar
  // edits capture only the route (no modal to reopen on return).
  function capture({ routeName, routeParams, routeQuery, playerId: pid = null }) {
    returnRoute.value = {
      name: routeName,
      params: routeParams ? { ...routeParams } : {},
      query: routeQuery ? { ...routeQuery } : {},
    }
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
