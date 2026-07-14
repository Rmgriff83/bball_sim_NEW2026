import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { PlayerHeadshotRepository } from '@/engine/db/PlayerHeadshotRepository'
import { recomputeHighsLeaders, mergeHighsBoards } from '@/engine/stats/careerHighs'

/**
 * One-shot catch-up: delete every retired player accumulated by campaigns
 * from before the offseason retiree prune existed (enterOffseason now prunes
 * each season's retirees itself). Long-running campaigns can shed hundreds
 * of rows here — retirees have no UI surface (the RetirementModal reads the
 * denormalized settings.pendingRetirements snapshot), but they bloat the
 * players_fa sync part, IndexedDB, and every full-pool scan.
 *
 * Records are preserved: each retiree's single-game careerHighs are folded
 * into the persistent `settings.allTimeHighs` board before deletion, and the
 * All-Time records tab unions that board with the live recompute.
 *
 * Idempotent — guarded by `campaign.settings.retireePruneDone`. Only deletes
 * rows positively flagged retired (either casing). Returns the number pruned.
 */
export async function pruneRetiredPlayers(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return 0
  if (campaign.settings?.retireePruneDone) return 0

  const players = await PlayerRepository.getAllForCampaign(campaignId)
  const retirees = (players ?? []).filter(p => p.isRetired || p.is_retired)

  if (retirees.length > 0) {
    const board = mergeHighsBoards(
      campaign.settings?.allTimeHighs ?? {},
      recomputeHighsLeaders(retirees, 'careerHighs'),
    )
    campaign.settings = { ...(campaign.settings ?? {}), allTimeHighs: board }

    await PlayerRepository.deleteBulk(campaignId, retirees.map(p => p.id))
    for (const p of retirees) {
      try {
        await PlayerHeadshotRepository.delete(campaignId, p.id)
      } catch (_) { /* no headshot row — fine */ }
    }
  }

  campaign.settings = { ...(campaign.settings ?? {}), retireePruneDone: true }
  await CampaignRepository.save(campaign)
  return retirees.length
}
