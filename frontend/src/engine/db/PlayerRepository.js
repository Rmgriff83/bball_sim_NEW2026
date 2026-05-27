import { withDB } from './GameDatabase'
import { normalizePlayerAttributes } from '../data/attributeSchema'

// Defensive read-side migration. Older saves carry hybrid legacy + canonical
// attribute keys on rookies (`dunk`, `passing`, `perimeterD`, etc.); the
// scouting UI iterates whatever keys are present and never reveals the
// legacy duplicates, leaving '?' visible at 100% scouted. Normalizing on
// read converges every player onto the canonical schema in-memory; the next
// save flushes the migration to IndexedDB.
function _normalize(player) {
  if (player) normalizePlayerAttributes(player)
  return player
}

function _normalizeAll(players) {
  if (Array.isArray(players)) {
    for (const p of players) _normalize(p)
  }
  return players
}

// `season_stats` is a UI-only derivation that teamStore re-attaches from
// SeasonRepository on every fetchTeam. Persisting it would freeze whatever
// snapshot happened to be on the in-memory roster object at save time —
// downstream readers (financeStore.rosterWithContracts) would then carry
// that stale snapshot back to the modal, contradicting the live value
// teamStore re-derives. Strip it at the storage boundary so no caller
// accidentally pickles a snapshot.
function _stripTransient(player) {
  if (!player || typeof player !== 'object') return player
  if (!('season_stats' in player) && !('seasonStats' in player)) return player
  const { season_stats: _s1, seasonStats: _s2, ...rest } = player
  return rest
}

export const PlayerRepository = {
  async get(campaignId, playerId) {
    return withDB(async db => _normalize(await db.get('players', [campaignId, playerId])))
  },

  async getAllForCampaign(campaignId) {
    return withDB(async db => _normalizeAll(await db.getAllFromIndex('players', 'campaignId', campaignId)))
  },

  async getByTeam(campaignId, teamId) {
    return withDB(async db => _normalizeAll(await db.getAllFromIndex('players', 'teamId', [campaignId, teamId])))
  },

  async getFreeAgents(campaignId) {
    return withDB(async db => {
      const list = _normalizeAll(await db.getAllFromIndex('players', 'freeAgent', [campaignId, 1]))
      // Defensive — retirees are explicitly stamped `isFreeAgent: 0` in
      // processRetirements, but legacy rows or interrupted writes could
      // leave a retiree on the FA index. Filter them out here.
      return list.filter(p => !p.isRetired && !p.is_retired)
    })
  },

  async getByPosition(campaignId, position) {
    return withDB(async db => _normalizeAll(await db.getAllFromIndex('players', 'position', [campaignId, position])))
  },

  async save(player) {
    return withDB(db => {
      if (!player.campaignId) throw new Error('Player must have campaignId')
      const persistable = _stripTransient(player)
      persistable.updatedAt = new Date().toISOString()
      return db.put('players', persistable)
    })
  },

  async saveBulk(players) {
    return withDB(async db => {
      const tx = db.transaction('players', 'readwrite')
      const now = new Date().toISOString()
      for (const player of players) {
        const persistable = _stripTransient(player)
        persistable.updatedAt = now
        tx.store.put(persistable)
      }
      await tx.done
    })
  },

  /**
   * Persist players pulled from the server. Preserves each record's
   * existing `updatedAt` so subsequent pull comparisons see the original
   * mutation time, not the write-to-IDB time.
   */
  async saveBulkFromRemote(players) {
    return withDB(async db => {
      const tx = db.transaction('players', 'readwrite')
      const fallback = new Date().toISOString()
      for (const player of players) {
        const persistable = _stripTransient(player)
        if (!persistable.updatedAt) persistable.updatedAt = fallback
        tx.store.put(persistable)
      }
      await tx.done
    })
  },

  async delete(campaignId, playerId) {
    return withDB(db => db.delete('players', [campaignId, playerId]))
  },

  async deleteAllForCampaign(campaignId) {
    return withDB(async db => {
      const tx = db.transaction('players', 'readwrite')
      const index = tx.store.index('campaignId')
      let cursor = await index.openCursor(IDBKeyRange.only(campaignId))
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
      await tx.done
    })
  },

  async updateAttributes(campaignId, playerId, attributes) {
    return withDB(async db => {
      const player = await db.get('players', [campaignId, playerId])
      if (!player) throw new Error(`Player ${playerId} not found`)
      player.attributes = { ...player.attributes, ...attributes }
      player.updatedAt = new Date().toISOString()
      return db.put('players', player)
    })
  },

  async transferPlayer(campaignId, playerId, newTeamId) {
    return withDB(async db => {
      const player = await db.get('players', [campaignId, playerId])
      if (!player) throw new Error(`Player ${playerId} not found`)
      player.teamId = newTeamId
      player.isFreeAgent = newTeamId ? 0 : 1
      player.updatedAt = new Date().toISOString()
      return db.put('players', player)
    })
  },
}
