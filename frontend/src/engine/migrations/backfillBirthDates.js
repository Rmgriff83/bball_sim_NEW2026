import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { applySeasonalAging } from '@/engine/evolution/AttributeAging'
import { recalculateOverall } from '@/engine/evolution/PlayerEvolution'

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

/**
 * Bring every player's `age` in line with what their `birthDate` + the
 * campaign's `currentDate` say it should be. Catches up campaigns that ran
 * under the earlier birthday-tick code (which used `currentSeasonYear` as
 * the candidate year and so silently skipped January–October birthdays —
 * see the fix in `_tickPlayerBirthdays`). Also self-corrects any drift from
 * sync round-trips or partial saves.
 *
 * Idempotent — only ages a player when their stored `age` is strictly less
 * than what the cursor implies. Stamps `_lastBirthdayYear` to the prior
 * season-start year so the LIVE tick can still fire for any birthday that
 * remains ahead of the cursor in the current season.
 *
 * Returns the number of players updated.
 */
export async function catchUpPlayerAging(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return 0
  const cursorDate = campaign.currentDate
  if (!cursorDate || cursorDate.length < 10) return 0
  const cursorYear = parseInt(cursorDate.slice(0, 4), 10)
  const cursorMmDd = cursorDate.slice(5, 10) // "MM-DD"
  if (!Number.isFinite(cursorYear)) return 0

  const currentSeasonYear = campaign.currentSeasonYear
    ?? campaign.settings?.currentSeasonYear
    ?? cursorYear
  // Stamp slightly behind the current season so the live tick can still fire
  // for upcoming birthdays in this season. The tick's guard
  // (`lastAgedYear >= currentSeasonYear`) skips already-stamped seasons; we
  // leave room for one more tick to land within this season if needed.
  const safeStamp = currentSeasonYear - 1

  const players = await PlayerRepository.getAllForCampaign(campaignId)
  if (!players || players.length === 0) return 0

  const updated = []
  for (const player of players) {
    if (player.isRetired || player.is_retired) continue
    const birth = player.birthDate || player.birth_date
    if (!birth || birth.length < 10) continue
    const birthYear = parseInt(birth.slice(0, 4), 10)
    const birthMmDd = birth.slice(5, 10)
    if (!Number.isFinite(birthYear)) continue

    // Expected age = years between birth and cursor, minus one if the
    // player's birthday hasn't yet occurred in the cursor's calendar year.
    let expectedAge = cursorYear - birthYear
    if (cursorMmDd < birthMmDd) expectedAge -= 1
    if (expectedAge < 0) continue

    const storedAge = player.age ?? 0
    if (expectedAge <= storedAge) continue

    const yearsBehind = expectedAge - storedAge
    let attrs = player.attributes
    let age = storedAge
    for (let i = 0; i < yearsBehind; i++) {
      age += 1
      if (attrs) attrs = applySeasonalAging(attrs, age)
    }
    player.age = age
    if (attrs) player.attributes = attrs
    try { recalculateOverall(player) } catch (_) { /* non-fatal */ }

    // Conservative stamp: lets the live tick still fire later this season
    // for any player whose actual birthday is ahead of the cursor. For
    // players whose birthday already passed this season, the tick window
    // (prevDate, newDate] won't include their date again so no double-age.
    if ((player._lastBirthdayYear ?? 0) < safeStamp) {
      player._lastBirthdayYear = safeStamp
    }
    updated.push({ ...player, campaignId })
  }

  if (updated.length > 0) {
    await PlayerRepository.saveBulk(updated)
  }
  return updated.length
}
