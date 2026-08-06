// =============================================================================
// WorkshopService — standalone Builder projects (custom_roster IAP)
// =============================================================================
// A "workshop" is a real campaign record flagged settings.workshopMode
// ('roster' | 'draft_class') that is NEVER played: it exists purely as an
// authoring surface. Modeling workshops as campaigns buys the entire existing
// stack for free — the roster/class editors, PlayerRepository persistence,
// cloud sync (WIPs follow the account across devices), and the server's
// snapshot-based community publish endpoint.
//
// Invisibility contract: the campaign store splits workshops out of the
// playable list (settings.workshopMode), and the SERVER excludes them from
// listCampaigns unless ?include_workshop=1 — so old app versions never see
// them (a teams-less draft-class workshop would render as a broken campaign).

import { createCampaign, generateUUID } from './CampaignManager'
import { CampaignRepository } from '../db/CampaignRepository'
import { PlayerRepository } from '../db/PlayerRepository'
import { PlayerHeadshotRepository } from '../db/PlayerHeadshotRepository'
import { TEAMS } from '../data/teams'
import { CAP_SET_2026 } from '../data/salaryScale'
import { cloneForPersist } from '@/utils/cloneForPersist'

export const MAX_WORKSHOP_PROJECTS = 6

/**
 * Roster workshop: a full custom-roster campaign (30 teams, generated league,
 * roster editor) that never finalizes. The RosterSetupView's one-way door
 * stays shut forever — editing is the whole point.
 */
export async function createRosterWorkshop(name) {
  const campaign = await createCampaign({
    name,
    // The editor needs a "user" team for its grid ordering; arbitrary.
    teamAbbreviation: TEAMS[0]?.abbreviation ?? 'ATL',
    difficulty: 'pro',
    draftMode: 'standard',
    customRoster: true,
  })
  const fresh = await CampaignRepository.get(campaign.id)
  fresh.settings = fresh.settings ?? {}
  fresh.settings.workshopMode = 'roster'
  await CampaignRepository.save(cloneForPersist(fresh))
  return fresh
}

/**
 * Draft-class workshop: a MINIMAL campaign record with an EMPTY class. No
 * teams, no schedule, no season rows — it must only ever be loaded through
 * the draftClassEditor store (campaignStore.loadCampaign's migrations assume
 * a full league). The class itself is populated by the editor's start screen
 * (generated / scratch / imported → settings.draftClassStartMode).
 */
export async function createDraftClassWorkshop(name) {
  const campaignId = generateUUID()
  const startYear = 2026
  const campaign = {
    id: campaignId,
    name,
    currentDate: `${startYear}-10-21`,
    gameYear: 1,
    currentSeasonYear: startYear,
    current_season_year: startYear,
    phase: 'workshop',
    difficulty: 'pro',
    draftMode: 'standard',
    customRoster: false,
    custom_roster: false,
    rosterSetupCompleted: true,
    roster_setup_completed: true,
    settings: {
      workshopMode: 'draft_class',
      // Authored data is authoritative — block first-load legacy migrations.
      initialRookiesBackfilled: true,
      salaryCapRebaseDone: true,
      scoutedPlayers: {},
      capNumbers: { ...CAP_SET_2026 },
    },
    lastPlayedAt: new Date().toISOString(),
  }
  await CampaignRepository.create(campaign)
  return campaign
}

function _isProspectFor(p, draftYear) {
  return !!(p.isDraftProspect || p.is_draft_prospect)
    && (p.draftYear ?? p.draft_year) === draftYear
}

function _workshopTargetYear(campaign) {
  return (campaign.currentSeasonYear ?? campaign.current_season_year ?? 2026) + 1
}

/**
 * Local Builder draft-class projects usable as import sources (season-start
 * modal + workshop chooser) — no community publish required. Cloud-only stubs
 * are naturally excluded: their players aren't in local IndexedDB.
 * Returns [{ workshopId, title, prospectCount }].
 */
export async function listDraftClassWorkshopSources({ excludeCampaignId } = {}) {
  const all = await CampaignRepository.getAll()
  const workshops = (all ?? []).filter((c) =>
    c?.settings?.workshopMode === 'draft_class' && c.id !== excludeCampaignId)
  const sources = []
  for (const w of workshops) {
    try {
      const players = await PlayerRepository.getAllForCampaign(w.id)
      const targetYear = _workshopTargetYear(w)
      const prospectCount = players.filter((p) => _isProspectFor(p, targetYear)).length
      if (prospectCount > 0) {
        sources.push({ workshopId: w.id, title: w.name, prospectCount })
      }
    } catch { /* unreadable project — just omit it */ }
  }
  return sources
}

/**
 * Assemble a draft-class blob from a local workshop project — same shape the
 * server builds for community downloads, so importDraftClassBuild handles it
 * identically (rebind, re-year, headshot remap). Source rows are cloned; the
 * workshop is never mutated.
 */
export async function buildWorkshopClassBlob(workshopId) {
  const workshop = await CampaignRepository.get(workshopId)
  if (!workshop) throw new Error('Builder project not found')
  const targetYear = _workshopTargetYear(workshop)
  const players = await PlayerRepository.getAllForCampaign(workshopId)
  const prospects = players.filter((p) => _isProspectFor(p, targetYear))
  const headshots = []
  for (const p of prospects) {
    if (!(p.hasCustomHeadshot || p.has_custom_headshot)) continue
    try {
      const record = await PlayerHeadshotRepository.get(workshopId, p.id)
      if (record?.svgContent) headshots.push({ playerId: p.id, svgContent: record.svgContent })
    } catch { /* non-fatal — prospect just keeps a generated headshot */ }
  }
  return {
    format: 1,
    type: 'draft_class',
    title: workshop.name,
    draftYear: targetYear,
    prospects: prospects.map((p) => cloneForPersist(p)),
    headshots,
  }
}

/** Rename a workshop project (both grid label and community publish name). */
export async function renameWorkshop(campaignId, name) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) throw new Error('Project not found')
  campaign.name = name
  await CampaignRepository.save(cloneForPersist(campaign))
  return campaign
}
