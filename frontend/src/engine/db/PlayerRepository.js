import { getDB } from './GameDatabase'

export const PlayerRepository = {
  async get(campaignId, playerId) {
    const db = await getDB()
    return db.get('players', [campaignId, playerId])
  },

  async getAllForCampaign(campaignId) {
    const db = await getDB()
    return db.getAllFromIndex('players', 'campaignId', campaignId)
  },

  async getByTeam(campaignId, teamId) {
    const db = await getDB()
    return db.getAllFromIndex('players', 'teamId', [campaignId, teamId])
  },

  async getFreeAgents(campaignId) {
    const db = await getDB()
    return db.getAllFromIndex('players', 'freeAgent', [campaignId, 1])
  },

  async getByPosition(campaignId, position) {
    const db = await getDB()
    return db.getAllFromIndex('players', 'position', [campaignId, position])
  },

  async save(player) {
    const db = await getDB()
    if (!player.campaignId) throw new Error('Player must have campaignId')
    player.updatedAt = new Date().toISOString()
    return db.put('players', player)
  },

  async saveBulk(players) {
    const db = await getDB()
    const tx = db.transaction('players', 'readwrite')
    const now = new Date().toISOString()
    for (const player of players) {
      player.updatedAt = now
      tx.store.put(player)
    }
    await tx.done
  },

  async delete(campaignId, playerId) {
    const db = await getDB()
    return db.delete('players', [campaignId, playerId])
  },

  async deleteAllForCampaign(campaignId) {
    const db = await getDB()
    const tx = db.transaction('players', 'readwrite')
    const index = tx.store.index('campaignId')
    let cursor = await index.openCursor(IDBKeyRange.only(campaignId))
    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }
    await tx.done
  },

  async updateAttributes(campaignId, playerId, attributes) {
    const db = await getDB()
    const player = await db.get('players', [campaignId, playerId])
    if (!player) throw new Error(`Player ${playerId} not found`)
    player.attributes = { ...player.attributes, ...attributes }
    player.updatedAt = new Date().toISOString()
    return db.put('players', player)
  },

  async transferPlayer(campaignId, playerId, newTeamId) {
    const db = await getDB()
    const player = await db.get('players', [campaignId, playerId])
    if (!player) throw new Error(`Player ${playerId} not found`)
    player.teamId = newTeamId
    player.isFreeAgent = newTeamId ? 0 : 1
    player.updatedAt = new Date().toISOString()
    return db.put('players', player)
  },
}
