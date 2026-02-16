import { getDB } from './GameDatabase'

export const TeamRepository = {
  async get(campaignId, teamId) {
    const db = await getDB()
    return db.get('teams', [campaignId, teamId])
  },

  async getAllForCampaign(campaignId) {
    const db = await getDB()
    return db.getAllFromIndex('teams', 'campaignId', campaignId)
  },

  async getByConference(campaignId, conference) {
    const db = await getDB()
    return db.getAllFromIndex('teams', 'conference', [campaignId, conference])
  },

  async getByDivision(campaignId, division) {
    const db = await getDB()
    return db.getAllFromIndex('teams', 'division', [campaignId, division])
  },

  async save(team) {
    const db = await getDB()
    if (!team.campaignId) throw new Error('Team must have campaignId')
    team.updatedAt = new Date().toISOString()
    return db.put('teams', team)
  },

  async saveBulk(teams) {
    const db = await getDB()
    const tx = db.transaction('teams', 'readwrite')
    const now = new Date().toISOString()
    for (const team of teams) {
      team.updatedAt = now
      tx.store.put(team)
    }
    await tx.done
  },

  async updateLineup(campaignId, teamId, lineupSettings) {
    const db = await getDB()
    const team = await db.get('teams', [campaignId, teamId])
    if (!team) throw new Error(`Team ${teamId} not found`)
    team.lineup_settings = { ...team.lineup_settings, ...lineupSettings }
    team.updatedAt = new Date().toISOString()
    return db.put('teams', team)
  },

  async updateCoachingScheme(campaignId, teamId, scheme) {
    const db = await getDB()
    const team = await db.get('teams', [campaignId, teamId])
    if (!team) throw new Error(`Team ${teamId} not found`)
    team.coaching_scheme = scheme
    team.updatedAt = new Date().toISOString()
    return db.put('teams', team)
  },

  async updateFinancials(campaignId, teamId, financials) {
    const db = await getDB()
    const team = await db.get('teams', [campaignId, teamId])
    if (!team) throw new Error(`Team ${teamId} not found`)
    Object.assign(team, financials)
    team.updatedAt = new Date().toISOString()
    return db.put('teams', team)
  },
}
