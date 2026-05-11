import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'

/**
 * One-shot migration that fills `birthDate` on legacy players (campaigns
 * created before the birthday-driven aging system) and stamps
 * `_lastBirthdayYear` on every player so the first birthday tick after
 * migration doesn't immediately re-age them.
 *
 * Deterministic month/day from a hash of `player.id` so the same player
 * always gets the same birthday across reloads.
 *
 * Idempotent — guarded by `campaign.settings.birthDateMigrationDone`.
 * Returns the number of players updated.
 */
export async function backfillBirthDates(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return 0
  if (campaign.settings?.birthDateMigrationDone) return 0

  const currentSeasonYear = campaign.currentSeasonYear
    ?? campaign.settings?.currentSeasonYear
    ?? 2025

  const players = await PlayerRepository.getAllForCampaign(campaignId)
  if (!players || players.length === 0) {
    campaign.settings = { ...(campaign.settings ?? {}), birthDateMigrationDone: true }
    await CampaignRepository.save(campaign)
    return 0
  }

  const updated = []
  for (const player of players) {
    let dirty = false

    if (!player.birthDate && !player.birth_date) {
      const age = player.age ?? 25
      const birthYear = currentSeasonYear - age
      const seed = _hashId(String(player.id ?? ''))
      const month = (seed % 12) + 1
      const day = ((seed >> 4) % 28) + 1
      const mm = String(month).padStart(2, '0')
      const dd = String(day).padStart(2, '0')
      const dateStr = `${birthYear}-${mm}-${dd}`
      player.birthDate = dateStr
      player.birth_date = dateStr
      dirty = true
    }

    if (player._lastBirthdayYear == null) {
      player._lastBirthdayYear = currentSeasonYear
      dirty = true
    }

    if (dirty) updated.push(player)
  }

  if (updated.length > 0) {
    await PlayerRepository.saveBulk(
      updated.map(p => ({ ...p, campaignId }))
    )
  }

  campaign.settings = { ...(campaign.settings ?? {}), birthDateMigrationDone: true }
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
