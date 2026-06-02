import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { getToken, setToken, removeToken } from '@/composables/useTokenStorage'
import { clearDatabase } from '@/engine/db/GameDatabase'
import { useSyncStore } from '@/stores/sync'

// Local-only feature unlocks (TEMP — until real IAP fulfillment is live).
// Persisted in localStorage so the user keeps access across reloads. Once
// the RevenueCat / Stripe webhooks populate `profile.unlockedFeatures`
// server-side, this localStorage path can be removed and hasFeature() will
// fall back to the profile-only check below.
const LOCAL_UNLOCKS_KEY = 'localUnlocks'

function _readLocalUnlocks() {
  try {
    const raw = localStorage.getItem(LOCAL_UNLOCKS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function _writeLocalUnlocks(list) {
  try {
    localStorage.setItem(LOCAL_UNLOCKS_KEY, JSON.stringify(list))
  } catch {
    /* private mode etc. */
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const profile = ref(null)
  const token = ref(null)
  const initialized = ref(false)
  const loading = ref(false)

  // Reactive mirror of localStorage. Re-assigned (not mutated) on grant so
  // computed/template consumers of hasFeature() actually re-evaluate.
  const localUnlocks = ref(_readLocalUnlocks())

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  // One-time IAP unlocks (e.g. headshot_editor). The backend mirrors entitled
  // purchases into `profile.unlockedFeatures` after the RevenueCat / Stripe
  // webhook fulfills. Until that's wired, the local fallback below lets the
  // user grant themselves access via the Store's Purchase button.
  // Server-side endpoints that gate on this MUST re-check entitlement
  // independently — the local list is a UI convenience, not a security gate.
  function hasFeature(name) {
    if (localUnlocks.value.includes(name)) return true
    const features = profile.value?.unlockedFeatures ?? profile.value?.unlocked_features
    return Array.isArray(features) && features.includes(name)
  }

  // TEMP: grant a local-only unlock. Called from StoreView when the user
  // taps Purchase on an unlock-kind bundle while real IAP fulfillment is
  // still being wired up.
  function grantLocalUnlock(name) {
    if (localUnlocks.value.includes(name)) return
    const next = [...localUnlocks.value, name]
    localUnlocks.value = next
    _writeLocalUnlocks(next)
  }

  async function initialize() {
    if (initialized.value) return

    token.value = await getToken()

    if (token.value) {
      try {
        await fetchUser()
      } catch (error) {
        // Token is invalid, clear it
        await logout()
      }
    }

    initialized.value = true
  }

  async function fetchUser() {
    const response = await api.get('/api/user')
    user.value = response.data.user
    profile.value = response.data.profile
    return user.value
  }

  async function login(credentials) {
    loading.value = true
    try {
      // Clear any previous user's local data before logging in
      await clearDatabase().catch(() => {})

      const response = await api.post('/api/auth/login', credentials)
      token.value = response.data.token
      user.value = response.data.user
      await setToken(token.value)
      // /api/auth/login returns only { user, token } — pull the full profile
      // so profile.tokens is available immediately for the homepage.
      await fetchUser()
      return response.data
    } finally {
      loading.value = false
    }
  }

  async function register(data) {
    loading.value = true
    try {
      // Clear any previous user's local data before registering
      await clearDatabase().catch(() => {})

      const response = await api.post('/api/auth/register', data)
      token.value = response.data.token
      user.value = response.data.user
      await setToken(token.value)
      // Same as login — /api/auth/register doesn't carry profile.
      await fetchUser()
      return response.data
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    // Flush any pending campaign changes to the cloud BEFORE clearing IndexedDB,
    // otherwise unsynced gameplay (e.g. games played since the last sync) is lost.
    try {
      const syncStore = useSyncStore()
      if (syncStore.activeCampaignId && syncStore.hasPendingChanges) {
        await syncStore.syncNow()
      }
    } catch (e) {
      console.warn('[Auth] Pre-logout sync failed:', e)
    }

    try {
      if (token.value) {
        await api.post('/api/auth/logout')
      }
    } catch (error) {
      // Ignore errors during logout
    } finally {
      token.value = null
      user.value = null
      profile.value = null
      await removeToken()

      // Clear all local campaign data so the next user doesn't see it
      try {
        await clearDatabase()
      } catch (e) {
        console.warn('[Auth] Failed to clear IndexedDB on logout:', e)
      }
    }
  }

  async function updateProfile(data) {
    loading.value = true
    try {
      const response = await api.put('/api/user', data)
      user.value = response.data.user
      return response.data
    } finally {
      loading.value = false
    }
  }

  async function updatePassword(data) {
    loading.value = true
    try {
      const response = await api.put('/api/user/password', data)
      return response.data
    } finally {
      loading.value = false
    }
  }

  async function forgotPassword(email) {
    loading.value = true
    try {
      const response = await api.post('/api/auth/forgot-password', { email })
      return response.data
    } finally {
      loading.value = false
    }
  }

  async function resetPassword(data) {
    loading.value = true
    try {
      const response = await api.post('/api/auth/reset-password', data)
      return response.data
    } finally {
      loading.value = false
    }
  }

  function updateSettings(settings) {
    if (user.value) {
      user.value.settings = { ...user.value.settings, ...settings }
    }
  }

  return {
    user,
    profile,
    token,
    initialized,
    loading,
    isAuthenticated,
    initialize,
    fetchUser,
    login,
    register,
    logout,
    updateProfile,
    updatePassword,
    forgotPassword,
    resetPassword,
    updateSettings,
    hasFeature,
    grantLocalUnlock
  }
})
