import { TeamRepository } from '@/engine/db/TeamRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { fandomForFacilities } from '@/engine/fandom/FandomService'
import { PERSONNEL_POOL_KEY, PERSONNEL_POOL_COUNTS } from '@/engine/data/personnelTiers'

/**
 * One-shot migration for the Fandom + Arena facility feature.
 *
 * Existing campaigns predate both `team.facilities.arena` and `team.fandom`.
 * Per team this backfill (additive only, never overwrites a present value):
 *   - facilities.arena ??= round(avg of the other facility levels), clamped 1-5
 *   - fandom ??= fandomForFacilities(facilities)  (arena included)
 * It also seeds the arena-manager hire pool into campaign.settings so old
 * saves can hire one mid-season instead of waiting for the next rollover
 * top-up.
 *
 * Idempotent: guarded by `campaign.settings.fandomArenaBackfilled` plus `??=`
 * semantics on every write. Readers never assume this ran — they all fall
 * back with `?? FANDOM_DEFAULT` / `?? 1`.
 *
 * @returns {Promise<number>} number of teams repaired
 */
export async function backfillFandomArena(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return 0
  if (campaign.settings?.fandomArenaBackfilled) return 0

  const teams = await TeamRepository.getAllForCampaign(campaignId)

  const updated = []
  for (const team of teams || []) {
    if (!team) continue
    let dirty = false

    team.facilities = team.facilities ?? {}
    if (team.facilities.arena == null) {
      const levels = ['training', 'medical', 'scouting', 'analytics']
        .map((k) => Number(team.facilities[k]))
        .filter((v) => Number.isFinite(v) && v > 0)
      const avg = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 1
      team.facilities.arena = Math.max(1, Math.min(5, Math.round(avg)))
      dirty = true
    }

    if (team.fandom == null) {
      team.fandom = fandomForFacilities(team.facilities)
      dirty = true
    }

    if (dirty) updated.push(team)
  }

  if (updated.length > 0) {
    await TeamRepository.saveBulk(updated)
  }

  // Seed the arena-manager hire pool (same lazy shape the rollover top-up
  // fills). The hire modal also has an on-demand fallback, but a persisted
  // pool gives candidates stable ids + headshot-editor targeting. Generated
  // via a dynamic import so this module stays cheap when the guard flag is
  // already set.
  campaign.settings = campaign.settings ?? {}
  const poolKey = PERSONNEL_POOL_KEY.arena_manager
  if (!Array.isArray(campaign.settings[poolKey]) || campaign.settings[poolKey].length === 0) {
    try {
      const { generatePersonnelPool } = await import('@/engine/campaign/CampaignManager')
      campaign.settings[poolKey] = generatePersonnelPool('arena_manager')
    } catch {
      // Pool seeding is best-effort — the hire modal's local generator and
      // the season-rollover top-up (keyed off PERSONNEL_POOL_COUNTS) both
      // cover a missing pool.
      void PERSONNEL_POOL_COUNTS
    }
  }

  campaign.settings = { ...(campaign.settings ?? {}), fandomArenaBackfilled: true }
  await CampaignRepository.save(campaign)
  return updated.length
}
