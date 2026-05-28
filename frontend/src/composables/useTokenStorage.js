import { Preferences } from '@capacitor/preferences'

// Auth token persistence.
// - On native iOS this is backed by Keychain (via @capacitor/preferences),
//   surviving aggressive cache eviction.
// - On web it falls back to localStorage internally.
// One-time migration moves any pre-existing `auth_token` from the legacy
// localStorage key into the Preferences-managed key so existing web users
// are not forced to log in again.

const KEY = 'auth_token'
const LEGACY_KEY = 'auth_token'
const MIGRATION_MARK = 'auth_token_migrated_v1'
let migrated = false

async function migrateLegacyToken() {
  if (migrated) return
  migrated = true

  if (typeof localStorage === 'undefined') return

  try {
    if (localStorage.getItem(MIGRATION_MARK)) return

    const existing = await Preferences.get({ key: KEY })
    if (existing.value) {
      localStorage.setItem(MIGRATION_MARK, '1')
      return
    }

    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      await Preferences.set({ key: KEY, value: legacy })
      localStorage.removeItem(LEGACY_KEY)
    }
    localStorage.setItem(MIGRATION_MARK, '1')
  } catch {
    // best-effort; on failure the user just re-logs in
  }
}

export async function getToken() {
  await migrateLegacyToken()
  const { value } = await Preferences.get({ key: KEY })
  return value || null
}

export async function setToken(token) {
  await Preferences.set({ key: KEY, value: token })
}

export async function removeToken() {
  await Preferences.remove({ key: KEY })
}
