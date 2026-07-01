import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'

/**
 * One-shot migration: tag season-1 rookies for campaigns whose initial league
 * was never rookie-tagged — i.e. fantasy-draft campaigns (the fantasy pool
 * generator historically skipped tagging) and campaigns created before
 * `tagInitialRookies` existed. Without `draftYear === currentSeasonYear` on any
 * player, `AwardService` finds zero Rookie of the Year / All-Rookie candidates
 * in the first season.
 *
 * Self-limiting to "season-1, untagged" campaigns: if ANY player already carries
 * `draftYear === currentSeasonYear` we no-op. That's true for standard season-1
 * leagues (already tagged) AND every season >= 2 (the latest rookie draft stamps
 * current-year rookies) — so this only ever fires for an untagged first season.
 *
 * Mirrors LeagueRosterGenerator.tagInitialRookies: stamps the youngest players
 * (age <= 22, up to 60, tiebreak overall desc) with `draftYear = currentSeasonYear`
 * and `careerSeasons = 0`. Mutates only those two fields — no attributes,
 * contracts, salaries, or badges. Idempotent; guarded by
 * `campaign.settings.initialRookiesBackfilled`.
 *
 * @returns {Promise<number>} number of players tagged
 */
const ROOKIE_TARGET = 60
const MAX_ROOKIE_AGE = 22

export async function backfillInitialRookies(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return 0
  if (campaign.settings?.initialRookiesBackfilled) return 0

  const currentSeasonYear = campaign.currentSeasonYear
    ?? campaign.settings?.currentSeasonYear
    ?? 2025

  const setDone = async () => {
    campaign.settings = { ...(campaign.settings ?? {}), initialRookiesBackfilled: true }
    await CampaignRepository.save(campaign)
  }

  const players = await PlayerRepository.getAllForCampaign(campaignId)
  if (!players || players.length === 0) {
    await setDone()
    return 0
  }

  // Already have current-year rookies? Then this is a standard season-1 league
  // (already tagged) or a season >= 2 campaign (drafted rookies present) — no-op.
  const hasCurrentRookies = players.some(
    (p) => (p.draftYear ?? p.draft_year) === currentSeasonYear
  )
  if (hasCurrentRookies) {
    await setDone()
    return 0
  }

  // Tag the youngest players as this season's rookies (same heuristic as
  // tagInitialRookies): age asc, tiebreak overall desc.
  const eligible = players
    .filter((p) => (p?.age ?? 99) <= MAX_ROOKIE_AGE)
    .sort((a, b) => {
      const ageDelta = (a.age ?? 99) - (b.age ?? 99)
      if (ageDelta !== 0) return ageDelta
      return (b.overallRating ?? b.overall_rating ?? 0) - (a.overallRating ?? a.overall_rating ?? 0)
    })
    .slice(0, ROOKIE_TARGET)

  for (const p of eligible) {
    p.draftYear = currentSeasonYear
    p.draft_year = currentSeasonYear
    p.careerSeasons = 0
    p.career_seasons = 0
  }

  if (eligible.length > 0) {
    await PlayerRepository.saveBulk(eligible.map((p) => ({ ...p, campaignId })))
  }

  await setDone()
  return eligible.length
}
