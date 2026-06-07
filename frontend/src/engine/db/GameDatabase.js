import { openDB } from 'idb'

const DB_NAME = 'bball-sim'
// v3 bump exists purely to re-run the headshot-store creation for any user
// whose DB ended up at version 2 with `playerHeadshots` missing (an upgrade
// transaction that committed the version bump but not the store). The v3
// block is idempotent and will no-op if the store is already there.
// v4 adds a parallel `coachHeadshots` store keyed by [campaignId, coachId]
// for the coach customize flow (Phase 3 of the headshot project).
// v5 generalizes coach storage to all personnel kinds: new
// `personnelHeadshots` store keyed by [campaignId, kind, id] (kind ∈
// 'coach' | 'scout' | 'physician' | 'staff_trainer'), with a migration
// that copies existing coachHeadshots rows over with kind='coach'.
const DB_VERSION = 5

let dbPromise = null

function createDB() {
  return openDB(DB_NAME, DB_VERSION, {
    blocked() {
      // Another tab has an older version open; reset so we retry
      dbPromise = null
    },
    blocking() {
      // Another instance (another tab, or the same tab requesting a higher
      // version) is trying to upgrade. Close THIS connection so the upgrade
      // can proceed instead of staying open and blocking it forever.
      dbPromise?.then(db => { try { db.close() } catch {} }).catch(() => {})
      dbPromise = null
    },
    terminated() {
      // Browser abnormally closed the connection; reset so next call reopens
      dbPromise = null
    },
    upgrade(db, oldVersion, _newVersion, transaction) {
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

      if (oldVersion < 2 && !db.objectStoreNames.contains('playerHeadshots')) {
        // Per-player custom headshot overrides (SVG strings). Keyed by
        // [campaignId, playerId] so they ride along with their owning
        // player. Sync pushes the full per-campaign set as a single chunk.
        const headshots = db.createObjectStore('playerHeadshots', { keyPath: ['campaignId', 'playerId'] })
        headshots.createIndex('campaignId', 'campaignId')
      }

      if (oldVersion < 3 && !db.objectStoreNames.contains('playerHeadshots')) {
        // Recovery: if a prior v1→v2 upgrade landed the version bump but
        // never created the store (observed in dev), this rerun creates it.
        const headshots = db.createObjectStore('playerHeadshots', { keyPath: ['campaignId', 'playerId'] })
        headshots.createIndex('campaignId', 'campaignId')
      }

      if (oldVersion < 4 && !db.objectStoreNames.contains('coachHeadshots')) {
        // Phase 3 of the headshot project: parallel store for coach custom
        // edits. Mirrors playerHeadshots in shape — compound key by
        // [campaignId, coachId], one row per coach with an `svgContent`
        // string. Reads/writes go through CoachHeadshotRepository.
        const coachHeadshots = db.createObjectStore('coachHeadshots', { keyPath: ['campaignId', 'coachId'] })
        coachHeadshots.createIndex('campaignId', 'campaignId')
      }

      if (oldVersion < 5 && !db.objectStoreNames.contains('personnelHeadshots')) {
        // Phase 4: generalize headshot storage to all personnel kinds.
        // Compound key [campaignId, kind, id] so a single store covers
        // coach / scout / physician / staff_trainer without naming
        // collisions. Reads/writes go through PersonnelHeadshotRepository.
        const personnel = db.createObjectStore('personnelHeadshots', { keyPath: ['campaignId', 'kind', 'id'] })
        personnel.createIndex('campaignId', 'campaignId')
        personnel.createIndex('kind', ['campaignId', 'kind'])

        // Migrate existing coachHeadshots rows over with kind='coach'. Uses
        // the upgrade transaction so the copy commits atomically with the
        // store creation. If the source store doesn't exist (v4 was never
        // reached, e.g. a fresh install), the migration silently no-ops.
        if (db.objectStoreNames.contains('coachHeadshots')) {
          const src = transaction.objectStore('coachHeadshots')
          const dst = transaction.objectStore('personnelHeadshots')
          src.openCursor().then(async function walk(cursor) {
            while (cursor) {
              const row = cursor.value
              if (row && row.campaignId && row.coachId) {
                dst.put({
                  campaignId: row.campaignId,
                  kind: 'coach',
                  id: row.coachId,
                  svgContent: row.svgContent,
                  updatedAt: row.updatedAt || new Date().toISOString(),
                })
              }
              cursor = await cursor.continue()
            }
          }).catch(err => {
            // Migration is best-effort. Don't block the upgrade — users
            // re-saving a coach headshot rewrites it into the new store
            // on next edit.
            console.warn('[GameDatabase v5] coachHeadshots → personnelHeadshots migration failed', err)
          })
        }
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
 * Wait until a connection exists that contains the named store. If the
 * current connection is stale (still at an older schema version because the
 * upgrade was blocked), close it and reopen so the upgrade callback runs.
 * Throws if the store still isn't present after a fresh open — the caller
 * should treat that as "schema migration didn't run, the user needs to
 * close other tabs of the app and reload."
 */
export async function ensureStoreUpgraded(storeName) {
  let db = await getDB()
  if (db.objectStoreNames.contains(storeName)) return db
  try { db.close() } catch { /* ignore */ }
  resetDB()
  db = await getDB()
  if (!db.objectStoreNames.contains(storeName)) {
    throw new Error(
      `IDB schema is out of date — '${storeName}' is missing. ` +
      `Close other tabs of this app and reload.`
    )
  }
  return db
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
  // Filter out any stores the live connection doesn't have. Belt-and-suspenders
  // against an in-flight schema upgrade — if a tab opened pre-bump still holds
  // a v1 connection, `playerHeadshots` won't exist yet and naming it in the
  // transaction would throw NotFoundError. Skipping it is safe: there can't be
  // headshot rows in a v1 store that doesn't exist.
  const campaignStores = ['teams', 'players', 'seasons', 'news', 'trades', 'playerHeadshots', 'coachHeadshots', 'personnelHeadshots']
    .filter(name => db.objectStoreNames.contains(name))
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
