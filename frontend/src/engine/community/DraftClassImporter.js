// =============================================================================
// DraftClassImporter — replace a campaign season's rookie class with a
// downloaded community draft-class build.
// =============================================================================
// Build blob format (assembled server-side by RosterBuildController):
//   {
//     format: 1,
//     type: 'draft_class',
//     title, draftYear,               // draftYear is the SOURCE year (informational)
//     prospects: Player[],            // flat — no team buckets
//     headshots: [{ playerId: <original id>, svgContent }],
//   }
//
// Import strategy: delete the campaign's existing prospects for the TARGET
// draft year (never any other rows), then insert the build's prospects with
// fresh UUIDs re-stamped to that year. Scouting reveal state keyed by the
// deleted ids is pruned from campaign.settings so the scouting page doesn't
// carry ghosts. The caller mirrors rosterEditor.applyDownloadedBuild:
// stamp settings.rosterInstalledAt (the sync pull-merge guard that stops the
// cloud snapshot resurrecting the deleted generated class), save the
// campaign, markDirty, and push.

import { CampaignRepository } from '../db/CampaignRepository'
import { PlayerRepository } from '../db/PlayerRepository'
import { PlayerHeadshotRepository } from '../db/PlayerHeadshotRepository'
import { rebindBuildPlayer } from './RosterBuildImporter'
import { stampProspectFlags } from '../draft/RookieGenerationService'

// Mirrors the server's publish bounds (RosterBuildController): the offseason
// draft makes exactly 60 picks and only regenerates an EMPTY class, so a
// short class would strand picks.
export const MIN_CLASS_SIZE = 60
export const MAX_CLASS_SIZE = 120

/**
 * Apply a draft-class blob to a campaign season.
 * Returns { prospectCount, headshotCount }.
 * Caller is responsible for the rosterInstalledAt stamp + campaign save +
 * syncStore.markDirty() afterwards (keeps this module store-free).
 *
 * @param {string} campaignId
 * @param {Object} build - Inflated blob.
 * @param {Object} options
 * @param {number} options.targetDraftYear - The class year being replaced
 *   (currentSeasonYear + 1 for in-campaign use).
 */
export async function importDraftClassBuild(campaignId, build, { targetDraftYear }) {
  if (!build || build.format !== 1 || build.type !== 'draft_class' || !Array.isArray(build.prospects)) {
    throw new Error('Unsupported draft class format')
  }
  if (!Number.isFinite(targetDraftYear)) {
    throw new Error('Missing target draft year')
  }
  if (build.prospects.length < MIN_CLASS_SIZE || build.prospects.length > MAX_CLASS_SIZE) {
    throw new Error(`Draft classes must have ${MIN_CLASS_SIZE}–${MAX_CLASS_SIZE} prospects`)
  }
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error('Campaign not found')

  // Remove ONLY this year's existing prospects — positively identified rows,
  // never anything else in the campaign.
  const existing = await PlayerRepository.getAllForCampaign(campaignId)
  const removed = existing.filter((p) => {
    if (!(p.isDraftProspect || p.is_draft_prospect)) return false
    return (p.draftYear ?? p.draft_year) === targetDraftYear
  })
  if (removed.length) {
    await PlayerRepository.deleteBulk(campaignId, removed.map((p) => p.id))
    // Best-effort headshot cleanup for the deleted generated prospects.
    for (const p of removed) {
      if (p.hasCustomHeadshot || p.has_custom_headshot) {
        try {
          await PlayerHeadshotRepository.delete(campaignId, p.id)
        } catch { /* non-fatal */ }
      }
    }
  }

  // Prune stale scouting reveal state keyed by the removed ids (harmless if
  // absent — legacy saves create scoutedPlayers lazily).
  const scouted = campaign.settings?.scoutedPlayers
  if (scouted && typeof scouted === 'object') {
    for (const p of removed) {
      delete scouted[p.id]
    }
  }

  const idMap = new Map() // original build prospect id -> new player id
  const toSave = []
  for (const raw of build.prospects) {
    if (!raw || typeof raw !== 'object') continue
    const originalId = raw.id
    const player = rebindBuildPlayer(raw, {
      campaignId,
      teamId: null,
      teamAbbreviation: 'FA',
    })
    // Re-stamp the prospect identity onto THIS campaign's class year —
    // whatever year the source campaign used is irrelevant here.
    stampProspectFlags(player, targetDraftYear)
    // Keep the birthday tick from re-aging the prospect before their first
    // season (mirrors generateRookieClass's anchor).
    player._lastBirthdayYear = targetDraftYear
    if (originalId) idMap.set(originalId, player.id)
    toSave.push(player)
  }
  if (!toSave.length) throw new Error('Draft class contains no prospects')

  await PlayerRepository.saveBulk(toSave)

  let headshotCount = 0
  for (const h of build.headshots ?? []) {
    if (h?.kind) continue // personnel entries never belong to a class
    const newId = idMap.get(h?.playerId)
    if (!newId || !h?.svgContent) continue
    await PlayerHeadshotRepository.save(campaignId, newId, h.svgContent)
    const idx = toSave.findIndex((p) => p.id === newId)
    if (idx >= 0) {
      toSave[idx].hasCustomHeadshot = true
      toSave[idx].has_custom_headshot = true
      await PlayerRepository.save(toSave[idx])
    }
    headshotCount++
  }

  return { prospectCount: toSave.length, headshotCount }
}
