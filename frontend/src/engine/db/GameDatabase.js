import { openDB } from 'idb'

const DB_NAME = 'bball-sim'
const DB_VERSION = 1

let dbPromise = null

function createDB() {
  return openDB(DB_NAME, DB_VERSION, {
    blocked() {
      // Another tab has an older version open; reset so we retry
      dbPromise = null
    },
    terminated() {
      // Browser abnormally closed the connection; reset so next call reopens
      dbPromise = null
    },
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

export function getDB() {
  if (!dbPromise) {
    dbPromise = createDB()
  }
  return dbPromise
}

/**
 * Reset the cached DB promise so the next getDB() opens a fresh connection.
 */
export function resetDB() {
  dbPromise = null
}

/**
 * Run a DB operation with automatic retry on closed-connection errors.
 * If the first attempt throws InvalidStateError (connection closing/closed),
 * resets the cached connection and retries once with a fresh one.
 */
export async function withDB(fn) {
  try {
    const db = await getDB()
    return await fn(db)
  } catch (err) {
    if (err?.name === 'InvalidStateError') {
      resetDB()
      const db = await getDB()
      return await fn(db)
    }
    throw err
  }
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
