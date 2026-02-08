import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const profile = ref(null)
  const token = ref(localStorage.getItem('auth_token') || null)
  const initialized = ref(false)
  const loading = ref(false)

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  async function initialize() {
    if (initialized.value) return

    if (token.value) {
      try {
        await fetchUser()
      } catch (error) {
        // Token is invalid, clear it
        logout()
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
      const response = await api.post('/api/auth/login', credentials)
      token.value = response.data.token
      user.value = response.data.user
      localStorage.setItem('auth_token', token.value)
      return response.data
    } finally {
      loading.value = false
    }
  }

  async function register(data) {
    loading.value = true
    try {
      const response = await api.post('/api/auth/register', data)
      token.value = response.data.token
      user.value = response.data.user
      localStorage.setItem('auth_token', token.value)
      return response.data
    } finally {
      loading.value = false
    }
  }

  async function logout() {
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
      localStorage.removeItem('auth_token')
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
