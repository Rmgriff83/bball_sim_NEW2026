import { getDB } from './GameDatabase'

export const CampaignRepository = {
  async getAll() {
    const db = await getDB()
    return db.getAll('campaigns')
  },

  async get(id) {
    const db = await getDB()
    return db.get('campaigns', id)
  },

  async getByUserId(userId) {
    const db = await getDB()
    return db.getAllFromIndex('campaigns', 'userId', userId)
  },

  async save(campaign) {
    const db = await getDB()
    campaign.updatedAt = new Date().toISOString()
    return db.put('campaigns', campaign)
  },

  async create(campaign) {
    const db = await getDB()
    campaign.createdAt = new Date().toISOString()
    campaign.updatedAt = campaign.createdAt
    return db.add('campaigns', campaign)
  },

  async delete(id) {
    const db = await getDB()
    return db.delete('campaigns', id)
  },

  async updateSettings(id, settings) {
    const db = await getDB()
    const campaign = await db.get('campaigns', id)
    if (!campaign) throw new Error(`Campaign ${id} not found`)
    campaign.settings = { ...campaign.settings, ...settings }
    campaign.updatedAt = new Date().toISOString()
    return db.put('campaigns', campaign)
  },
}
