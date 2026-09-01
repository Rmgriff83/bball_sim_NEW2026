// =============================================================================
// useTrainingReportToast — fires the rich "training complete" toast (staff
// trainer headshot + badge/tier + flavor line + Breakthrough callout) from a
// claimTrainingReward() result. Returns false on ANY failure so the caller
// can fall back to the legacy minimal toast — old saves and edge cases keep
// a working notification no matter what.
// =============================================================================

import { useToastStore } from '@/stores/toast'
import { tDynamic } from '@wl-i18n/i18n.js'
import { badgeDisplayName } from '@/engine/data/badges'
import { buildTrainingFlavor, buildBreakthroughLine } from '@/engine/training/trainingCommentary'

export function useTrainingReportToast() {
  const toastStore = useToastStore()

  /**
   * @param {Object} p
   * @param {string|number} p.campaignId
   * @param {Object} p.player - the trainee
   * @param {Object} p.result - claimTrainingReward() return value
   * @returns {boolean} true when the rich toast fired
   */
  function notifyTrainingComplete({ campaignId, player, result }) {
    try {
      if (!result?.badge || !result.level) return false
      const first = player.firstName ?? player.first_name ?? ''
      const last = player.lastName ?? player.last_name ?? ''
      const playerName = player.name ?? `${first} ${last}`.trim()
      const badgeName = result.badge?.name ?? badgeDisplayName(result.badgeId)
      const seedKey = `${player.id}|${result.badgeId}|${result.level}`

      const flavor = buildTrainingFlavor({
        playerName,
        // Translated display name as a param — interpolated after tpl lookup.
        badge: tDynamic(badgeName),
        level: result.level,
        seedKey,
      })
      const breakthrough = result.perkProc
        ? { level: result.perkProc, line: buildBreakthroughLine({ playerName, perkProc: result.perkProc, seedKey }) }
        : null

      toastStore.showTrainingReport({
        trainer: result.trainer ?? null,   // already a plain copy from the store
        playerName,
        badgeName,
        level: result.level,
        flavor,
        breakthrough,
        campaignId,
      })
      return true
    } catch (err) {
      console.error('Training report toast failed, falling back to plain toast:', err)
      return false
    }
  }

  return { notifyTrainingComplete }
}
