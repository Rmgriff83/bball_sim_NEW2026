import { openDB } from 'idb'

const DB_NAME = 'bball-sim'
const DB_VERSION = 1

let dbPromise = null

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          // Campaigns store
          const campaigns = db.createObjectStore('campaigns', { keyPath: 'id' })
          campaigns.createIndex('userId', 'userId')

          // Teams store - compound key [campaignId, id]
          const teams = db.createObjectStore('teams', { keyPath: ['campaignId', 'id'] })
          teams.createIndex('campaignId', 'campaignId')
          teams.createIndex('conference', ['campaignId', 'conference'])
          teams.createIndex('division', ['campaignId', 'division'])

          // Players store - compound key [campaignId, id]
          const players = db.createObjectStore('players', { keyPath: ['campaignId', 'id'] })
          players.createIndex('campaignId', 'campaignId')
          players.createIndex('teamId', ['campaignId', 'teamId'])
          players.createIndex('position', ['campaignId', 'position'])
          players.createIndex('freeAgent', ['campaignId', 'isFreeAgent'])

          // Seasons store
          const seasons = db.createObjectStore('seasons', { keyPath: ['campaignId', 'year'] })
          seasons.createIndex('campaignId', 'campaignId')

          // News store
          const news = db.createObjectStore('news', { keyPath: 'id', autoIncrement: true })
          news.createIndex('campaignId', 'campaignId')
          news.createIndex('campaignWeek', ['campaignId', 'week'])
          news.createIndex('type', ['campaignId', 'type'])

          // Trades store
          const trades = db.createObjectStore('trades', { keyPath: 'id', autoIncrement: true })
          trades.createIndex('campaignId', 'campaignId')
          trades.createIndex('status', ['campaignId', 'status'])

          // Reference data stores (populated from bundled JS modules)
          db.createObjectStore('badges', { keyPath: 'id' })
          db.createObjectStore('synergies', { keyPath: 'id', autoIncrement: true })
          db.createObjectStore('achievements', { keyPath: 'id' })
          db.createObjectStore('plays', { keyPath: 'id' })

          // Sync metadata store
          db.createObjectStore('syncMeta', { keyPath: 'key' })
        }
      },
    })
  }
  return dbPromise
}

export async function clearDatabase() {
  const db = await getDB()
  const storeNames = [...db.objectStoreNames]
  const tx = db.transaction(storeNames, 'readwrite')
  await Promise.all(storeNames.map(name => tx.objectStore(name).clear()))
  await tx.done
}

export async function clearCampaignData(campaignId) {
  const db = await getDB()
  const campaignStores = ['teams', 'players', 'seasons', 'news', 'trades']
  const tx = db.transaction(campaignStores, 'readwrite')

  for (const storeName of campaignStores) {
    const store = tx.objectStore(storeName)
    const index = store.index('campaignId')
    let cursor = await index.openCursor(IDBKeyRange.only(campaignId))
    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }
  }

  await tx.done
}
