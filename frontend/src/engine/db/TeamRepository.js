import { withDB } from './GameDatabase'

export const TeamRepository = {
  async get(campaignId, teamId) {
    return withDB(db => db.get('teams', [campaignId, teamId]))
  },

  async getAllForCampaign(campaignId) {
    return withDB(db => db.getAllFromIndex('teams', 'campaignId', campaignId))
  },

  async getByConference(campaignId, conference) {
    return withDB(db => db.getAllFromIndex('teams', 'conference', [campaignId, conference]))
  },

  async getByDivision(campaignId, division) {
    return withDB(db => db.getAllFromIndex('teams', 'division', [campaignId, division]))
  },

  async save(team) {
    return withDB(db => {
      if (!team.campaignId) throw new Error('Team must have campaignId')
      team.updatedAt = new Date().toISOString()
      return db.put('teams', team)
    })
  },

  async saveBulk(teams) {
    return withDB(async db => {
      const tx = db.transaction('teams', 'readwrite')
      const now = new Date().toISOString()
      for (const team of teams) {
        team.updatedAt = now
        tx.store.put(team)
      }
      await tx.done
    })
  },

  async updateLineup(campaignId, teamId, lineupSettings) {
    return withDB(async db => {
      const team = await db.get('teams', [campaignId, teamId])
      if (!team) throw new Error(`Team ${teamId} not found`)
      team.lineup_settings = { ...team.lineup_settings, ...lineupSettings }
      team.updatedAt = new Date().toISOString()
      return db.put('teams', team)
    })
  },

  async updateCoachingScheme(campaignId, teamId, scheme) {
    return withDB(async db => {
      const team = await db.get('teams', [campaignId, teamId])
      if (!team) throw new Error(`Team ${teamId} not found`)
      team.coaching_scheme = JSON.parse(JSON.stringify(scheme))
      team.updatedAt = new Date().toISOString()
      return db.put('teams', team)
    })
  },

  async updateFinancials(campaignId, teamId, financials) {
    return withDB(async db => {
      const team = await db.get('teams', [campaignId, teamId])
      if (!team) throw new Error(`Team ${teamId} not found`)
      Object.assign(team, financials)
      team.updatedAt = new Date().toISOString()
      return db.put('teams', team)
    })
  },
}
