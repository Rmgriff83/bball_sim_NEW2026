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
      player.updatedAt = new Date().toISOString()
      return db.put('players', player)
    })
  },

  async saveBulk(players) {
    return withDB(async db => {
      const tx = db.transaction('players', 'readwrite')
      const now = new Date().toISOString()
      for (const player of players) {
        player.updatedAt = now
        tx.store.put(player)
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
