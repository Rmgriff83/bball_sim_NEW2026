import { withDB, ensureStoreUpgraded } from './GameDatabase'

// Stores per-personnel custom headshot overrides as raw SVG strings, keyed
// by [campaignId, kind, id]. Generalized from CoachHeadshotRepository so a
// single store covers every personnel kind:
//   - coach          (team.coach.id)
//   - scout          (campaign.settings.availableScouts[].id once hired)
//   - physician      (campaign.settings.availableTrainers[].id once hired)
//   - staff_trainer  (campaign.settings.availableStaffTrainers[].id once hired)
//
// Defensive store-presence checks mirror the player/coach repos so pre-v5
// connections short-circuit to safe empty values instead of throwing
// NotFoundError on the transaction.

const VALID_KINDS = new Set(['coach', 'scout', 'physician', 'staff_trainer'])

function _hasStore(db) {
  return db.objectStoreNames.contains('personnelHeadshots')
}

function _normalizeKind(kind) {
  return VALID_KINDS.has(kind) ? kind : 'coach'
}

export const PersonnelHeadshotRepository = {
  async get(campaignId, kind, id) {
    return withDB(db => {
      if (!_hasStore(db)) return null
      return db.get('personnelHeadshots', [campaignId, _normalizeKind(kind), id])
    })
  },

  async save(campaignId, kind, id, svgContent) {
    const db = await ensureStoreUpgraded('personnelHeadshots')
    return db.put('personnelHeadshots', {
      campaignId,
      kind: _normalizeKind(kind),
      id,
      svgContent,
      updatedAt: new Date().toISOString(),
    })
  },

  async delete(campaignId, kind, id) {
    return withDB(db => {
      if (!_hasStore(db)) return undefined
      return db.delete('personnelHeadshots', [campaignId, _normalizeKind(kind), id])
    })
  },

  async getAllByCampaign(campaignId) {
    return withDB(db => {
      if (!_hasStore(db)) return []
      return db.getAllFromIndex('personnelHeadshots', 'campaignId', campaignId)
    })
  },

  async getAllByKind(campaignId, kind) {
    return withDB(db => {
      if (!_hasStore(db)) return []
      return db.getAllFromIndex('personnelHeadshots', 'kind', [campaignId, _normalizeKind(kind)])
    })
  },

  async deleteAllForCampaign(campaignId) {
    return withDB(async db => {
      if (!_hasStore(db)) return
      const tx = db.transaction('personnelHeadshots', 'readwrite')
      const index = tx.store.index('campaignId')
      let cursor = await index.openCursor(IDBKeyRange.only(campaignId))
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
      await tx.done
    })
  },
}
