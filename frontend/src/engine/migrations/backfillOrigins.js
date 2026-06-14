import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { US_COLLEGES, INTERNATIONAL_ORIGINS } from '@/engine/draft/RookieGenerationService'

/**
 * One-shot migration that fills `country` + `college` on legacy players —
 * campaigns created before the origin field was added to generatePlayer
 * have neither value. Without this, those players' History tab shows no
 * Origin card until they're regenerated.
 *
 * Per-player deterministic pick: a hash of `player.id` decides both the
 * international-vs-US bucket (25% international, matching the live
 * generation rate) and the specific college/club within the bucket.
 * Determinism means a future re-run for any reason produces the same
 * origin per player — so the field can't churn across reloads.
 *
 * Idempotent — guarded by `campaign.settings.originsBackfillDone` AND
 * by per-player skip when both fields are already populated.
 * Returns the number of players updated.
 */
export async function backfillOrigins(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return 0
  if (campaign.settings?.originsBackfillDone) return 0

  const players = await PlayerRepository.getAllForCampaign(campaignId)
  if (!players || players.length === 0) {
    campaign.settings = { ...(campaign.settings ?? {}), originsBackfillDone: true }
    await CampaignRepository.save(campaign)
    return 0
  }

  const updated = []
  for (const player of players) {
    const hasCollege = !!(player.college ?? player.school)
    const hasCountry = !!player.country
    if (hasCollege && hasCountry) continue

    const seed = _hashId(String(player.id ?? ''))
    // 25% international — same ratio as the live generation paths
    // (CampaignManager.generatePlayer and RookieGenerationService).
    const isInternational = (seed % 100) < 25

    let country
    let college
    if (isInternational) {
      const origin = INTERNATIONAL_ORIGINS[seed % INTERNATIONAL_ORIGINS.length]
      country = origin.country
      college = origin.clubs[(seed >> 8) % origin.clubs.length]
    } else {
      country = 'United States'
      college = US_COLLEGES[seed % US_COLLEGES.length]
    }

    if (!hasCollege) player.college = college
    if (!hasCountry) player.country = country
    updated.push({ ...player, campaignId })
  }

  if (updated.length > 0) {
    await PlayerRepository.saveBulk(updated)
  }

  campaign.settings = { ...(campaign.settings ?? {}), originsBackfillDone: true }
  await CampaignRepository.save(campaign)
  return updated.length
}

function _hashId(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h | 0)
}
