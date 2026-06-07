import { withDB, ensureStoreUpgraded } from './GameDatabase'

// Stores per-player custom headshot overrides as raw SVG strings, keyed by
// [campaignId, playerId]. The sync store serializes the full per-campaign
// set as a sixth push part; the headshot resolver reads from here first
// before falling back to the bundled base SVGs.
//
// Defensive store-presence checks: this store was added in DB v2. A tab
// opened before the bump still holds a v1 connection and naming the store
// in a transaction would throw NotFoundError. All methods early-return safe
// "empty" values when the store isn't on the live connection — once the user
// reloads, the upgrade runs and the methods light up.

function _hasStore(db) {
  return db.objectStoreNames.contains('playerHeadshots')
}

export const PlayerHeadshotRepository = {
  async get(campaignId, playerId) {
    return withDB(db => {
      if (!_hasStore(db)) return null
      return db.get('playerHeadshots', [campaignId, playerId])
    })
  },

  async save(campaignId, playerId, svgContent) {
    // ensureStoreUpgraded transparently closes+reopens the connection if the
    // current one is at an older schema version (no playerHeadshots store).
    // That handles users with a tab that pre-dates the v1→v2 schema bump
    // without making them hard-refresh.
    const db = await ensureStoreUpgraded('playerHeadshots')
    return db.put('playerHeadshots', {
      campaignId,
      playerId,
      svgContent,
      updatedAt: new Date().toISOString(),
    })
  },

  async delete(campaignId, playerId) {
    return withDB(db => {
      if (!_hasStore(db)) return undefined
      return db.delete('playerHeadshots', [campaignId, playerId])
    })
  },

  async getAllByCampaign(campaignId) {
    return withDB(db => {
      if (!_hasStore(db)) return []
      return db.getAllFromIndex('playerHeadshots', 'campaignId', campaignId)
    })
  },

  async deleteAllForCampaign(campaignId) {
    return withDB(async db => {
      if (!_hasStore(db)) return
      const tx = db.transaction('playerHeadshots', 'readwrite')
      const index = tx.store.index('campaignId')
      let cursor = await index.openCursor(IDBKeyRange.only(campaignId))
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
      await tx.done
    })
  },

  // Used by the sync pull path. Preserves the remote `updatedAt` so subsequent
  // pull comparisons see the original mutation time, not the write-to-IDB time.
  async saveBulkFromRemote(records) {
    return withDB(async db => {
      if (!_hasStore(db)) return
      const tx = db.transaction('playerHeadshots', 'readwrite')
      const fallback = new Date().toISOString()
      for (const record of records) {
        if (!record || !record.campaignId || !record.playerId) continue
        const persistable = {
          campaignId: record.campaignId,
          playerId: record.playerId,
          svgContent: record.svgContent,
          updatedAt: record.updatedAt || fallback,
        }
        tx.store.put(persistable)
      }
      await tx.done
    })
  },
}
