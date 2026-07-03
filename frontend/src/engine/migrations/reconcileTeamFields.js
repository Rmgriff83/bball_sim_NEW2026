import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'

/**
 * One-shot migration: reconcile every player's snake_case team fields with the
 * canonical, IndexedDB-indexed `teamId`.
 *
 * Why: the user-trade executor historically wrote only `teamId` on traded
 * players, leaving `team_id`, `teamAbbreviation`, `team_abbreviation` (and
 * sometimes `is_free_agent`) pointing at the OLD team. Those split-field
 * records made snake_case readers misplace the player — most seriously, the
 * weekly AI-to-AI trade engine treated a user's traded-in player as still
 * belonging to his old AI team and could trade him away to a third team
 * (silently removing him from the user's roster). The executor and the AI
 * engine are both fixed; this migration repairs the split-field population
 * already persisted in live campaigns.
 *
 * `teamId` is the source of truth (it's the field the roster index queries and
 * the one every code path reliably writes). Mutates only the mirror fields —
 * never attributes, contracts, or stats. Idempotent; guarded by
 * `campaign.settings.teamFieldsReconciled`.
 *
 * @returns {Promise<number>} number of players repaired
 */
export async function reconcileTeamFields(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return 0
  if (campaign.settings?.teamFieldsReconciled) return 0

  const setDone = async () => {
    campaign.settings = { ...(campaign.settings ?? {}), teamFieldsReconciled: true }
    await CampaignRepository.save(campaign)
  }

  const [players, teams] = await Promise.all([
    PlayerRepository.getAllForCampaign(campaignId),
    TeamRepository.getAllForCampaign(campaignId),
  ])
  if (!players || players.length === 0) {
    await setDone()
    return 0
  }

  const abbrByTeamId = new Map((teams || []).map((t) => [String(t.id), t.abbreviation]))

  const updated = []
  for (const player of players) {
    if (!player || player.teamId == null) continue
    let dirty = false

    if (player.team_id !== player.teamId) {
      player.team_id = player.teamId
      dirty = true
    }

    const abbr = abbrByTeamId.get(String(player.teamId))
    if (abbr) {
      if (player.teamAbbreviation !== abbr) {
        player.teamAbbreviation = abbr
        dirty = true
      }
      if (player.team_abbreviation !== abbr) {
        player.team_abbreviation = abbr
        dirty = true
      }
    }

    // A rostered player (non-null teamId) is not a free agent — normalize both
    // casings if either disagrees.
    if (player.isFreeAgent === 1 || player.is_free_agent === 1) {
      player.isFreeAgent = 0
      player.is_free_agent = 0
      dirty = true
    }

    if (dirty) updated.push(player)
  }

  if (updated.length > 0) {
    await PlayerRepository.saveBulk(updated.map((p) => ({ ...p, campaignId })))
  }

  await setDone()
  return updated.length
}
