import { withDB } from './GameDatabase'

export const PlayerRepository = {
  async get(campaignId, playerId) {
    return withDB(db => db.get('players', [campaignId, playerId]))
  },

  async getAllForCampaign(campaignId) {
    return withDB(db => db.getAllFromIndex('players', 'campaignId', campaignId))
  },

  async getByTeam(campaignId, teamId) {
    return withDB(db => db.getAllFromIndex('players', 'teamId', [campaignId, teamId]))
  },

  async getFreeAgents(campaignId) {
    return withDB(db => db.getAllFromIndex('players', 'freeAgent', [campaignId, 1]))
  },

  async getByPosition(campaignId, position) {
    return withDB(db => db.getAllFromIndex('players', 'position', [campaignId, position]))
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
