import { withDB } from './GameDatabase'

export const CampaignRepository = {
  async getAll() {
    return withDB(db => db.getAll('campaigns'))
  },

  async get(id) {
    return withDB(db => db.get('campaigns', id))
  },

  async getByUserId(userId) {
    return withDB(db => db.getAllFromIndex('campaigns', 'userId', userId))
  },

  async save(campaign) {
    return withDB(db => {
      campaign.updatedAt = new Date().toISOString()
      return db.put('campaigns', campaign)
    })
  },

  async create(campaign) {
    return withDB(db => {
      campaign.createdAt = new Date().toISOString()
      campaign.updatedAt = campaign.createdAt
      return db.add('campaigns', campaign)
    })
  },

  async delete(id) {
    return withDB(db => db.delete('campaigns', id))
  },

  async updateSettings(id, settings) {
    return withDB(async db => {
      const campaign = await db.get('campaigns', id)
      if (!campaign) throw new Error(`Campaign ${id} not found`)
      campaign.settings = { ...campaign.settings, ...settings }
      campaign.updatedAt = new Date().toISOString()
      return db.put('campaigns', campaign)
    })
  },
}
