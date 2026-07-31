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
// Fantasy campaigns: the build's players are all routed into the draftable
// pool (teamId null / FA-flagged) instead of onto team rosters — the fantasy
// draft assigns teams. Coaches, authored pick trades, and headshots apply the
// same as standard campaigns.

import { CampaignRepository } from '../db/CampaignRepository'
import { TeamRepository } from '../db/TeamRepository'
import { PlayerRepository } from '../db/PlayerRepository'
import { PlayerHeadshotRepository } from '../db/PlayerHeadshotRepository'
import { CoachHeadshotRepository } from '../db/CoachHeadshotRepository'
import { hydratePlayerKeys } from '../db/playerKeyHydration'
import { getCoachActionBudget, getCoachTrainBudget } from '../data/coaches'
import { normalizePlayerAttributes } from '../data/attributeSchema'
import { generateUUID } from '../campaign/CampaignManager'

// Fields that must be re-stamped for the new campaign rather than imported.
function _rebindPlayer(raw, { campaignId, teamId, teamAbbreviation }) {
  // Blob players come from the sync snapshot, which strips camelCase
  // duplicates — rebuild them so camelCase-reading UI (trade modals etc.)
  // sees names/contracts.
  const player = hydratePlayerKeys(raw)
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
  // A build is ROSTER data only — scrub every trace of the SOURCE campaign's
  // in-progress season (stat snapshots, evolution logs, earned training
  // points, regression accumulators). Authored flavor (personality, draft
  // history, career seasons, award counts) stays.
  for (const key of [
    'season_stats', 'seasonStats',
    'season_playoff_stats', 'seasonPlayoffStats',
    'recent_performances', 'recentPerformances',
    'streak_data', 'streakData',
    'development_history', 'developmentHistory',
    'upgrade_points', 'upgradePoints',
    'offense_upgrade_points', 'offenseUpgradePoints',
    'defense_upgrade_points', 'defenseUpgradePoints',
    '_overallExact',
    // Single-game highs (feed the record boards), per-season stat archives,
    // career team-result counters, and season-end awards — all accrued by
    // the SOURCE campaign's play, none editor-authorable. Authored history
    // (draft info, careerSeasons, college/country, personality) stays.
    'careerHighs', 'career_highs',
    'seasonHighs', 'season_highs',
    'seasonHistory', 'season_history',
    'playerCareer', 'player_career',
    'awards',
    'all_star_selections', 'allStarSelections',
    'mvp_awards', 'mvpAwards',
    'finals_mvp_awards', 'finalsMvpAwards',
    'rookie_of_the_year', 'rookieOfTheYear',
    'all_nba_selections', 'allNbaSelections',
    'all_nba_first_team', 'allNbaFirstTeam',
    'all_rookie_team', 'allRookieTeam',
    'all_defensive_team', 'allDefensiveTeam',
    'resignedThisSeason', 'resigned_this_season',
    'resignedSeasonYear', 'resigned_season_year',
  ]) {
    delete player[key]
  }
  for (const key of Object.keys(player)) {
    if (key.startsWith('_seasonDrop_')) delete player[key]
  }
  player.updatedAt = new Date().toISOString()
  normalizePlayerAttributes(player)
  // Round attributes + ceilings to integers. The SOURCE campaign's players
  // may have evolved through games (per-game development applies fractional
  // changes by design), but an imported roster is a fresh start and the
  // editor authors in whole numbers.
  for (const group of [player.attributes, player.attributeCaps]) {
    if (!group || typeof group !== 'object') continue
    for (const cat of Object.values(group)) {
      if (!cat || typeof cat !== 'object') continue
      for (const key of Object.keys(cat)) {
        if (typeof cat[key] === 'number') cat[key] = Math.round(cat[key])
      }
    }
  }
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
  // Fantasy campaigns draft their rosters — every build player goes into the
  // draftable pool instead of onto the build's team assignments.
  const isFantasy = (campaign.draftMode ?? campaign.draft_mode) === 'fantasy'

  const teams = await TeamRepository.getAllForCampaign(campaignId)
  const teamByAbbr = new Map(teams.map((t) => [t.abbreviation, t]))

  // Wipe the generated league — the build replaces it wholesale — but KEEP
  // this campaign's own draft-prospect class (generated at creation with the
  // correct year+1 draft year; the scouting tab depends on it). A build is
  // the league ROSTER; prospects are generated scouting content.
  const existing = await PlayerRepository.getAllForCampaign(campaignId)
  const ownProspects = existing.filter((p) => p.isDraftProspect)
  await PlayerRepository.deleteAllForCampaign(campaignId)
  if (ownProspects.length) {
    await PlayerRepository.saveBulk(ownProspects)
  }

  const idMap = new Map() // original build player id -> new player id
  const toSave = []

  for (const [abbr, list] of Object.entries(build.players)) {
    if (!Array.isArray(list)) continue
    // Fantasy: ignore the build's team assignments entirely — every player
    // (rostered or FA) lands in the pool, so no abbreviation matching either.
    const team = isFantasy || abbr === 'fa' ? null : teamByAbbr.get(abbr)
    if (!isFantasy && abbr !== 'fa' && !team) continue // build team not in this league — skip
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      // Blobs published before the server-side filter carry the SOURCE
      // campaign's prospects (wrong draft year for this campaign) — skip
      // them; this campaign's own class was preserved above.
      if (raw.isDraftProspect || raw.is_draft_prospect) continue
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

  // Align draft years with the TARGET campaign's season. Builds published
  // from older campaigns carry their source-era classes (e.g. a 2025-start
  // league's rookies are tagged draftYear 2025) — imported into a 2026
  // campaign, no player matches `draftYear === currentSeasonYear` and the
  // rookie rankings sit empty. Shift the whole timeline forward so the
  // build's NEWEST class becomes the current rookie class and class spacing
  // (sophomores, vets) is preserved. Never shift down (same-year sources are
  // a no-op; authored future classes stay authored), and skip absurd gaps.
  const seasonYear = campaign.currentSeasonYear ?? campaign.current_season_year ?? null
  if (seasonYear != null) {
    let maxDraftYear = null
    for (const p of toSave) {
      const dy = p.draftYear ?? p.draft_year ?? null
      if (typeof dy === 'number' && dy >= 1990 && dy <= 2100) {
        if (maxDraftYear == null || dy > maxDraftYear) maxDraftYear = dy
      }
    }
    const shift = maxDraftYear != null ? seasonYear - maxDraftYear : 0
    if (shift > 0 && shift <= 30) {
      for (const p of toSave) {
        const dy = p.draftYear ?? p.draft_year ?? null
        if (typeof dy !== 'number') continue
        p.draftYear = dy + shift
        p.draft_year = dy + shift
        if (p.draftInfo && typeof p.draftInfo.year === 'number') {
          p.draftInfo = { ...p.draftInfo, year: p.draftInfo.year + shift }
        }
      }
      console.log(`[Import] Shifted draft years +${shift} to align with season ${seasonYear}`)
    }
  }

  await PlayerRepository.saveBulk(toSave)

  // Coaches — replace per team by abbreviation, fresh ids. The original id →
  // new id map drives the coach-headshot remap below (blob coach headshot
  // entries are keyed by the ORIGINAL coach id on their playerId field).
  const coachIdMap = new Map()
  for (const [abbr, coach] of Object.entries(build.coaches ?? {})) {
    const team = teamByAbbr.get(abbr)
    if (!team || !coach || typeof coach !== 'object') continue
    const originalCoachId = coach.id ?? null
    team.coach = { ...coach, id: generateUUID() }
    if (originalCoachId) coachIdMap.set(originalCoachId, team.coach.id)
    // Fresh start — the SOURCE campaign's simmed games accrued onto the
    // coach's record (career_stats + legacy flat fields). A build is roster
    // data; records restart at zero like generation stamps them.
    delete team.coach.career_stats
    team.coach.career_wins = 0
    team.coach.career_losses = 0
    team.coach.playoff_wins = 0
    team.coach.playoff_losses = 0
    team.coach.championships = 0
    team.coach.conference_titles = 0
    team.coach.seasons_coached = 0
    // Per-campaign lifecycle: stamp like a fresh hire (mirrors
    // CampaignManager's hydrateHire) — the source coach's consumed action/
    // training budgets otherwise arrive as 0 for the whole first season.
    team.coach.hiredSeason = campaign.currentSeasonYear ?? campaign.current_season_year ?? 2026
    team.coach.seasonsWithTeam = 0
    team.coach.activeTraining = null
    team.coach.actionsRemaining = getCoachActionBudget(team.coach)
    team.coach.trainActionsRemaining = getCoachTrainBudget(team.coach)
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

  // Authored pick trades — blob `picks` holds TRADED picks only, keyed by
  // abbreviation + the game-year counter (team UUIDs are campaign-specific,
  // so ownership is recreated against THIS campaign's own pick records).
  // Old blobs have no `picks` key → every team keeps its own picks.
  if (Array.isArray(build.picks) && build.picks.length) {
    const touched = new Set()
    for (const entry of build.picks) {
      const destTeam = teamByAbbr.get(entry?.heldBy)
      if (!destTeam || !entry?.original || entry.year == null || entry.round == null) continue
      // Locate the matching pick wherever it currently lives.
      let src = null
      let idx = -1
      for (const t of teams) {
        const i = (t.draftPicks ?? []).findIndex((p) =>
          p.original_team_abbreviation === entry.original
          && p.year === entry.year && p.round === entry.round)
        if (i >= 0) { src = t; idx = i; break }
      }
      if (!src || src.id === destTeam.id) continue
      const [pick] = src.draftPicks.splice(idx, 1)
      pick.currentOwnerId = destTeam.id
      pick.current_owner_id = destTeam.id
      pick.isTraded = true
      pick.is_traded = true
      destTeam.draftPicks = destTeam.draftPicks ?? []
      destTeam.draftPicks.push(pick)
      touched.add(src.id)
      touched.add(destTeam.id)
    }
    for (const t of teams) {
      if (touched.has(t.id)) await TeamRepository.save(t)
    }
  }

  // Headshots — remap original ids to the fresh ones. Entries with
  // kind === 'coach' are coach headshots (playerId carries the original
  // coach id); other personnel kinds aren't part of a roster build. The
  // coach's has_custom_headshot flag already rode in on the coach object.
  let headshotCount = 0
  for (const h of build.headshots ?? []) {
    if (h?.kind === 'coach') {
      const newCoachId = coachIdMap.get(h?.playerId)
      if (!newCoachId || !h?.svgContent) continue
      await CoachHeadshotRepository.save(campaignId, newCoachId, h.svgContent)
      headshotCount++
      continue
    }
    if (h?.kind) continue // non-coach personnel — not applicable to imports
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
