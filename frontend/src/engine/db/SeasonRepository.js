import { getDB } from './GameDatabase'

export const SeasonRepository = {
  async get(campaignId, year) {
    const db = await getDB()
    return db.get('seasons', [campaignId, year])
  },

  async getAllForCampaign(campaignId) {
    const db = await getDB()
    return db.getAllFromIndex('seasons', 'campaignId', campaignId)
  },

  async save(season) {
    const db = await getDB()
    if (!season.campaignId) throw new Error('Season must have campaignId')
    season.updatedAt = new Date().toISOString()
    return db.put('seasons', season)
  },

  async updateSchedule(campaignId, year, schedule) {
    const db = await getDB()
    const season = await db.get('seasons', [campaignId, year])
    if (!season) throw new Error(`Season ${year} not found`)
    season.schedule = schedule
    season.updatedAt = new Date().toISOString()
    return db.put('seasons', season)
  },

  async updateStandings(campaignId, year, standings) {
    const db = await getDB()
    const season = await db.get('seasons', [campaignId, year])
    if (!season) throw new Error(`Season ${year} not found`)
    season.standings = standings
    season.updatedAt = new Date().toISOString()
    return db.put('seasons', season)
  },

  async updatePlayerStats(campaignId, year, playerStats) {
    const db = await getDB()
    const season = await db.get('seasons', [campaignId, year])
    if (!season) throw new Error(`Season ${year} not found`)
    season.playerStats = playerStats
    season.updatedAt = new Date().toISOString()
    return db.put('seasons', season)
  },

  async updateGameResult(campaignId, year, gameId, result) {
    const db = await getDB()
    const season = await db.get('seasons', [campaignId, year])
    if (!season) throw new Error(`Season ${year} not found`)
    if (!season.gameResults) season.gameResults = {}
    season.gameResults[gameId] = result
    season.updatedAt = new Date().toISOString()
    return db.put('seasons', season)
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
