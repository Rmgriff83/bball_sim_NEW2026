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

  /**
   * Atomically add or replace the user's FA offer for one player. Wraps the
   * read + put in a single IDB readwrite transaction so a concurrent
   * `simFreeAgencyDay` save (which reads the campaign, mutates the offers
   * map, then writes the whole campaign back) cannot clobber the offer
   * mid-write — a production bug where a user FA offer to a former
   * teammate silently vanished traced back to that race.
   */
  async upsertFreeAgencyUserOffer(id, playerId, offer) {
    return withDB(async db => {
      const tx = db.transaction('campaigns', 'readwrite')
      const campaign = await tx.store.get(id)
      if (!campaign) {
        await tx.done
        throw new Error(`Campaign ${id} not found`)
      }
      campaign.settings = campaign.settings ?? {}
      campaign.settings.freeAgencyOffers = campaign.settings.freeAgencyOffers ?? {}
      const key = String(playerId)
      const list = campaign.settings.freeAgencyOffers[key] ?? []
      const idx = list.findIndex(o => o.isUserOffer)
      if (idx >= 0) list[idx] = offer
      else list.push(offer)
      campaign.settings.freeAgencyOffers[key] = list
      campaign.updatedAt = new Date().toISOString()
      await tx.store.put(campaign)
      await tx.done
      return campaign
    })
  },

  /**
   * Atomically remove the user's FA offer for one player. Same rationale as
   * `upsertFreeAgencyUserOffer` — wrap read + put in one transaction.
   */
  async removeFreeAgencyUserOffer(id, playerId) {
    return withDB(async db => {
      const tx = db.transaction('campaigns', 'readwrite')
      const campaign = await tx.store.get(id)
      if (!campaign) {
        await tx.done
        return null
      }
      const map = campaign.settings?.freeAgencyOffers
      const key = String(playerId)
      if (!map || !map[key]) {
        await tx.done
        return campaign
      }
      const remaining = map[key].filter(o => !o.isUserOffer)
      if (remaining.length === 0) delete map[key]
      else map[key] = remaining
      campaign.updatedAt = new Date().toISOString()
      await tx.store.put(campaign)
      await tx.done
      return campaign
    })
  },

  /**
   * Stamp `lastSyncedAt` on a campaign WITHOUT bumping `updatedAt`.
   * `updatedAt` must reflect user-content changes only — sync metadata
   * shouldn't make the local copy look "newer" than what's on the server,
   * or pullChanges will refuse to overwrite stale local data.
   */
  async markSyncedWithServer(id) {
    return withDB(async db => {
      const campaign = await db.get('campaigns', id)
      if (!campaign) return
      campaign.lastSyncedAt = new Date().toISOString()
      return db.put('campaigns', campaign)
    })
  },
}
