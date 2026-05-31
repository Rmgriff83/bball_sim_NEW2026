import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { getToken, setToken, removeToken } from '@/composables/useTokenStorage'
import { clearDatabase } from '@/engine/db/GameDatabase'
import { useSyncStore } from '@/stores/sync'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const profile = ref(null)
  const token = ref(null)
  const initialized = ref(false)
  const loading = ref(false)

  const isAuthenticated = computed(() => !!token.value && !!user.value)

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
    updateSettings
  }
})
