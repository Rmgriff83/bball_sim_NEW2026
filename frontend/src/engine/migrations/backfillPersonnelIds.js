import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { PERSONNEL_SETTINGS_KEY, PERSONNEL_POOL_KEY } from '@/engine/data/personnelTiers'

// Mirrors generateUUID in CampaignManager.js — migrations don't import it.
function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * One-shot migration: stamp a stable `id` on hired staff (and pool candidates)
 * that predate the id-carrying hire flow.
 *
 * Why: `id: candidate.id` was only added to the hire modals in commit e110092
 * (2026-06-06), the same change that wired the per-staff headshot-edit brush.
 * Staff hired before that were persisted into `campaign.settings` without an
 * `id`, so `PersonnelAvatar.canEdit` (which requires `personnel.id` for a stable
 * `PersonnelHeadshotRepository` key of `[campaignId, kind, id]`) is false and the
 * edit button never renders — the coach's button shows because its id comes from
 * `team.coach.id`, which was always present.
 *
 * Fix: for each personnel kind (scout, physician, staff_trainer, analyst), give
 * the hired singleton and any pool candidate lacking an `id` a durable UUID, so
 * the already-built editor becomes reachable and saved SVGs load back reliably.
 *
 * Idempotent; guarded by `settings.personnelIdsBackfillDone`.
 *
 * @returns {Promise<{ changed: boolean }>}
 */
export async function backfillPersonnelIds(campaignId) {
  const campaign = await CampaignRepository.get(campaignId)
  if (!campaign) return { changed: false }
  if (campaign.settings?.personnelIdsBackfillDone) return { changed: false }

  const settings = campaign.settings ?? {}
  let changed = false

  for (const kind of Object.keys(PERSONNEL_SETTINGS_KEY)) {
    // Hired singleton (e.g. settings.scout, settings.trainer for physician).
    const hired = settings[PERSONNEL_SETTINGS_KEY[kind]]
    if (hired && typeof hired === 'object' && !hired.id) {
      hired.id = genId()
      changed = true
    }

    // Pool candidates — so a legacy candidate hired later carries a stable id too.
    const pool = settings[PERSONNEL_POOL_KEY[kind]]
    if (Array.isArray(pool)) {
      for (const entry of pool) {
        if (entry && typeof entry === 'object' && !entry.id) {
          entry.id = genId()
          changed = true
        }
      }
    }
  }

  settings.personnelIdsBackfillDone = true
  campaign.settings = settings
  await CampaignRepository.save(campaign)
  return { changed }
}
