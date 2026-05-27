import { withDB } from './GameDatabase'

export const SeasonRepository = {
  async get(campaignId, year) {
    return withDB(db => db.get('seasons', [campaignId, year]))
  },

  async getAllForCampaign(campaignId) {
    return withDB(db => db.getAllFromIndex('seasons', 'campaignId', campaignId))
  },

  async save(season) {
    return withDB(db => {
      if (!season.campaignId) throw new Error('Season must have campaignId')
      season.updatedAt = new Date().toISOString()
      return db.put('seasons', season)
    })
  },

  /**
   * Persist a season pulled from the server. Preserves the remote
   * `updatedAt` so the next pull comparison reflects when the data was
   * actually mutated (on whichever device played the games), not when this
   * device happened to write it to IndexedDB.
   */
  async saveFromRemote(season) {
    return withDB(db => {
      if (!season.campaignId) throw new Error('Season must have campaignId')
      if (!season.updatedAt) {
        season.updatedAt = new Date().toISOString()
      }
      return db.put('seasons', season)
    })
  },

  async deleteAllForCampaign(campaignId) {
    return withDB(async db => {
      const tx = db.transaction('seasons', 'readwrite')
      const index = tx.store.index('campaignId')
      let cursor = await index.openCursor(IDBKeyRange.only(campaignId))
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
      await tx.done
    })
  },

  async updateSchedule(campaignId, year, schedule) {
    return withDB(async db => {
      const season = await db.get('seasons', [campaignId, year])
      if (!season) throw new Error(`Season ${year} not found`)
      season.schedule = schedule
      season.updatedAt = new Date().toISOString()
      return db.put('seasons', season)
    })
  },

  async updateStandings(campaignId, year, standings) {
    return withDB(async db => {
      const season = await db.get('seasons', [campaignId, year])
      if (!season) throw new Error(`Season ${year} not found`)
      season.standings = standings
      season.updatedAt = new Date().toISOString()
      return db.put('seasons', season)
    })
  },

  async updatePlayerStats(campaignId, year, playerStats) {
    return withDB(async db => {
      const season = await db.get('seasons', [campaignId, year])
      if (!season) throw new Error(`Season ${year} not found`)
      season.playerStats = playerStats
      season.updatedAt = new Date().toISOString()
      return db.put('seasons', season)
    })
  },

  async updateGameResult(campaignId, year, gameId, result) {
    return withDB(async db => {
      const season = await db.get('seasons', [campaignId, year])
      if (!season) throw new Error(`Season ${year} not found`)
      if (!season.gameResults) season.gameResults = {}
      season.gameResults[gameId] = result
      season.updatedAt = new Date().toISOString()
      return db.put('seasons', season)
    })
  },

  async getStandings(campaignId, year) {
    const season = await this.get(campaignId, year)
    return season?.standings || null
  },

  async getSchedule(campaignId, year) {
    const season = await this.get(campaignId, year)
    return season?.schedule || null
  },

  async getPlayerStats(campaignId, year) {
    const season = await this.get(campaignId, year)
    return season?.playerStats || null
  },
}
