import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { starPlayerIds } from '@/engine/season/OwnerSubtaskService'
import { GM_LEVEL_SILVER, GM_LEVEL_GOLD } from '@/engine/data/gmLevels'

// Facility-tier averages that gate a franchise — must match TeamPicker's
// facilityTierLabel thresholds. Strong (>= 3.5) needs Silver; Elite (>= 4.25)
// needs Gold.
const STRONG_TIER_AVG = 3.5
const ELITE_TIER_AVG = 4.25

function facilityAvg(facilities) {
  if (!facilities || typeof facilities !== 'object') return 0
  const keys = ['training', 'medical', 'scouting', 'analytics']
  return keys.reduce((s, k) => s + (facilities[k] ?? 0), 0) / keys.length
}

// Minimum GM level the user's current team requires (0 if ungated).
function requiredGmLevelForAvg(avg) {
  if (avg >= ELITE_TIER_AVG) return GM_LEVEL_GOLD
  if (avg >= STRONG_TIER_AVG) return GM_LEVEL_SILVER
  return 0
}

/**
 * One-shot migration for Team Owners Part 2. Active campaigns created before the
 * GM-contract lifecycle existed (or before the sub-task `progress` tracker) need
 * their `campaign.settings.gmContract` backfilled so the Owner tab, the contract
 * sub-tasks, and the contract-end decision all work without throwing.
 *
 * What it does (idempotent; guarded by `settings.gmContractBackfillDone`):
 *   • No gmContract at all (pre-Part-1 campaigns) → create a fresh active 2-year
 *     contract dated to the CURRENT season, seeding `starPlayerIdsAtSign` from the
 *     current roster (best-effort baseline for retain_stars).
 *   • gmContract present but missing `progress` → add the progress counters.
 *   • gmContract that is ALREADY past term under the new expiry rule → reset its
 *     `signedSeasonYear` to the current season so an established campaign doesn't
 *     get unexpectedly hit with a "contract expired" decision on its very next
 *     offseason. Mid-contract campaigns keep their real sign year.
 *
 * Separately (every load, NOT guarded — so it survives a profile refetch): reports
 * the minimum GM level the user's CURRENT team requires (Silver for Strong, Gold
 * for Elite, 0 otherwise), so the caller can grandfather a legacy GM who's already
 * running a gated franchise up to that floor (otherwise an unranked legacy GM
 * would look out of place under the new gate — they've already earned the seat).
 *
 * @returns {Promise<{ changed: boolean, requiredGmLevel: number }>}
 */
export async function backfillGmContract(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return { changed: false, requiredGmLevel: 0 }

  const currentYear = campaign.currentSeasonYear ?? campaign.current_season_year ?? 2025
  const userTeamId = campaign.teamId ?? campaign.userTeamId ?? campaign.team_id ?? null

  // Current-team tier requirement (computed every load so the grandfather floor
  // can re-apply even if the one-shot data backfill already ran).
  let userTeam = null
  try {
    userTeam = userTeamId ? await TeamRepository.get(campaignId, userTeamId) : null
  } catch {
    userTeam = null
  }
  const requiredGmLevel = userTeam ? requiredGmLevelForAvg(facilityAvg(userTeam.facilities)) : 0

  if (campaign.settings?.gmContractBackfillDone) {
    return { changed: false, requiredGmLevel }
  }

  const settings = campaign.settings ?? {}
  let roster = []
  if (userTeamId) {
    try {
      roster = (await PlayerRepository.getByTeam(campaignId, userTeamId)) ?? []
    } catch {
      roster = []
    }
  }

  const freshProgress = () => ({
    allStarAppearances: 0,
    badgesAdded: 0,
    starPlayerIdsAtSign: starPlayerIds(roster),
    allStarCountedSeasons: [],
  })

  const gmc = settings.gmContract
  if (!gmc) {
    // Pre-Part-1 campaign: synthesize a fresh contract from now.
    settings.gmContract = {
      teamId: userTeamId,
      teamAbbreviation: userTeam?.abbreviation ?? campaign.teamAbbreviation ?? campaign.team_abbreviation ?? null,
      signedSeasonYear: currentYear,
      lengthYears: 2,
      status: 'active',
      progress: freshProgress(),
    }
  } else {
    // Part-1 contract: fill any missing fields.
    if (gmc.lengthYears == null) gmc.lengthYears = 2
    if (!gmc.status) gmc.status = 'active'
    if (gmc.signedSeasonYear == null) gmc.signedSeasonYear = currentYear
    if (!gmc.progress) gmc.progress = freshProgress()
    else {
      if (gmc.progress.allStarAppearances == null) gmc.progress.allStarAppearances = 0
      if (gmc.progress.badgesAdded == null) gmc.progress.badgesAdded = 0
      if (!Array.isArray(gmc.progress.starPlayerIdsAtSign)) {
        gmc.progress.starPlayerIdsAtSign = starPlayerIds(roster)
      }
    }
    // If the existing contract is already PAST term (strictly overdue — it would
    // have fired a decision in an earlier offseason that predated this feature),
    // hand the user a fresh window instead of a surprise "expired" on their next
    // offseason. A contract sitting exactly AT natural term is left alone so it
    // fires the decision normally on the upcoming offseason.
    const overdue =
      gmc.status === 'active' &&
      (currentYear - gmc.signedSeasonYear + 1) > (gmc.lengthYears ?? 2)
    if (overdue) {
      gmc.signedSeasonYear = currentYear
      gmc.progress = freshProgress()
    }
  }

  settings.gmContractBackfillDone = true
  campaign.settings = settings
  await CampaignRepository.save(campaign)
  return { changed: true, requiredGmLevel }
}
