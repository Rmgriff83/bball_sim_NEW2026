// =============================================================================
// RosterBuildImporter — apply a downloaded community roster build to a freshly
// created custom campaign (Roster Editor IAP Part B).
// =============================================================================
// Build blob format v1 (assembled server-side by RosterBuildController):
//   {
//     format: 1,
//     players: { [teamAbbreviation]: Player[], fa: Player[] },
//     coaches: { [teamAbbreviation]: Coach },
//     headshots: [{ playerId: <original id>, svgContent }],
//   }
//
// Import strategy: the campaign was created normally (teams, coach pools,
// generated rosters) and is still in roster-setup. For each team matched by
// ABBREVIATION we delete the generated roster and insert the build's players
// with FRESH UUIDs (old→new id map drives the headshot remap); the build's
// coach replaces the team's. The FA pool is replaced likewise. The campaign
// stays un-finalized so the user can inspect/tweak; Finalize's existing
// lineup + payroll rebuild handles the rest.
//
// v1 constraint: standard custom campaigns only (fantasy deferred).

import { CampaignRepository } from '../db/CampaignRepository'
import { TeamRepository } from '../db/TeamRepository'
import { PlayerRepository } from '../db/PlayerRepository'
import { PlayerHeadshotRepository } from '../db/PlayerHeadshotRepository'
import { normalizePlayerAttributes } from '../data/attributeSchema'
import { generateUUID } from '../campaign/CampaignManager'

// Fields that must be re-stamped for the new campaign rather than imported.
function _rebindPlayer(raw, { campaignId, teamId, teamAbbreviation }) {
  const player = { ...raw }
  player.campaignId = campaignId
  player.id = generateUUID()
  player.teamId = teamId
  player.team_id = teamId
  player.teamAbbreviation = teamAbbreviation
  player.team_abbreviation = teamAbbreviation
  player.isFreeAgent = teamId ? 0 : 1
  player.is_free_agent = player.isFreeAgent
  // Fresh campaign — no in-progress state should carry over.
  player.fatigue = 0
  player.isInjured = false
  player.is_injured = false
  player.injuryDetails = null
  player.injury_details = null
  player.gamesPlayedThisSeason = 0
  player.games_played_this_season = 0
  player.minutesPlayedThisSeason = 0
  player.minutes_played_this_season = 0
  player.updatedAt = new Date().toISOString()
  normalizePlayerAttributes(player)
  return player
}

/**
 * Apply a build blob to a campaign. Returns { playerCount, headshotCount }.
 * Caller is responsible for syncStore.markDirty() afterwards (keeps this
 * module store-free / worker-safe).
 */
export async function importRosterBuild(campaignId, build) {
  if (!build || build.format !== 1 || !build.players) {
    throw new Error('Unsupported roster build format')
  }
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error('Campaign not found')
  if ((campaign.draftMode ?? campaign.draft_mode) === 'fantasy') {
    throw new Error('Downloaded rosters are not supported for fantasy draft campaigns yet')
  }

  const teams = await TeamRepository.getAllForCampaign(campaignId)
  const teamByAbbr = new Map(teams.map((t) => [t.abbreviation, t]))

  // Wipe the generated league — the build replaces it wholesale.
  await PlayerRepository.deleteAllForCampaign(campaignId)

  const idMap = new Map() // original build player id -> new player id
  const toSave = []

  for (const [abbr, list] of Object.entries(build.players)) {
    if (!Array.isArray(list)) continue
    const team = abbr === 'fa' ? null : teamByAbbr.get(abbr)
    if (abbr !== 'fa' && !team) continue // build team not in this league — skip
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const originalId = raw.id
      const player = _rebindPlayer(raw, {
        campaignId,
        teamId: team?.id ?? null,
        teamAbbreviation: team?.abbreviation ?? 'FA',
      })
      if (originalId) idMap.set(originalId, player.id)
      toSave.push(player)
    }
  }
  if (!toSave.length) throw new Error('Roster build contains no players')
  await PlayerRepository.saveBulk(toSave)

  // Coaches — replace per team by abbreviation, fresh ids.
  for (const [abbr, coach] of Object.entries(build.coaches ?? {})) {
    const team = teamByAbbr.get(abbr)
    if (!team || !coach || typeof coach !== 'object') continue
    team.coach = { ...coach, id: generateUUID() }
    // Keep the sim-facing scheme mirror aligned with the imported coach.
    const off = coach.offensiveScheme ?? coach.offensive_scheme
    const def = coach.defensiveScheme ?? coach.defensive_scheme
    if (off || def) {
      team.coaching_scheme = {
        ...(team.coaching_scheme ?? {}),
        ...(off ? { offensive: off } : {}),
        ...(def ? { defensive: def } : {}),
        substitution: team.coaching_scheme?.substitution ?? 'staggered',
      }
    }
    await TeamRepository.save(team)
  }

  // Headshots — remap original player ids to the fresh ones.
  let headshotCount = 0
  for (const h of build.headshots ?? []) {
    const newId = idMap.get(h?.playerId)
    if (!newId || !h?.svgContent) continue
    await PlayerHeadshotRepository.save(campaignId, newId, h.svgContent)
    // Flag the player so PlayerAvatar resolves the custom SVG.
    const idx = toSave.findIndex((p) => p.id === newId)
    if (idx >= 0) {
      toSave[idx].hasCustomHeadshot = true
      toSave[idx].has_custom_headshot = true
      await PlayerRepository.save(toSave[idx])
    }
    headshotCount++
  }

  return { playerCount: toSave.length, headshotCount }
}
