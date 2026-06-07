import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useHeadshotEditorReturnStore } from '@/stores/headshotEditorReturn'

/**
 * Wire a host view to auto-reopen its PlayerDetailModal when the user
 * returns from the headshot editor.
 *
 * Usage:
 *   useHeadshotEditorReturn(async (playerId) => {
 *     const player = await findPlayerById(playerId)
 *     if (player) {
 *       selectedPlayer.value = player
 *       showPlayerModal.value = true
 *     }
 *   })
 *
 * The hook only fires if the return store has a pending playerId AND the
 * captured returnRoute name matches the current route. Consumes the entry
 * after dispatch so a refresh doesn't re-fire.
 */
export function useHeadshotEditorReturn(reopenModal) {
  onMounted(async () => {
    const route = useRoute()
    const store = useHeadshotEditorReturnStore()
    const ctx = store.peek()
    if (!ctx.playerId) return
    if (ctx.route?.name && ctx.route.name !== route.name) return
    try {
      await reopenModal(ctx.playerId)
    } catch (err) {
      console.warn('[useHeadshotEditorReturn] reopen failed', err)
    } finally {
      store.consume()
    }
  })
}
