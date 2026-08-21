import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { getToken, setToken, removeToken } from '@/composables/useTokenStorage'
import { clearDatabase } from '@/engine/db/GameDatabase'
import { useSyncStore } from '@/stores/sync'
import { useTokensStore } from '@/stores/tokens'
import { clampGmLevel, nextGmLevel } from '@/engine/data/gmLevels'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const profile = ref(null)
  const token = ref(null)
  const initialized = ref(false)
  const loading = ref(false)

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  // GM career level (0-4 → unranked/bronze/silver/gold/platinum). Profile-global
  // like tokens; rises +1 when an owner extends the GM's contract. Reads tolerate
  // pre-feature profiles (defaults to 0/unranked).
  const gmLevel = computed(() => clampGmLevel(profile.value?.gmLevel ?? profile.value?.gm_level ?? 0))

  // Admin-only routes (e.g. /admin/headshots) gate on this flag, mirrored
  // from the users.global_admin DB column. Set manually via tinker; no UI
  // for granting since admin status is implicitly the project owner.
  const isGlobalAdmin = computed(() => !!user.value?.global_admin)

  // Connected sign-in identities + whether a real password is set. Drives the
  // Connected Accounts settings UI (and its "set a password first" guard).
  const linkedProviders = computed(() => user.value?.linked_providers ?? [])
  const hasPassword = computed(() => user.value?.has_password !== false)

  // One-time IAP unlocks (e.g. headshot_editor). Server-of-record:
  // RevenueCat / Stripe webhooks mirror fulfilled purchases into
  // `profile.unlockedFeatures` so this client check matches what the
  // backend grants. Server-side endpoints that gate on this MUST also
  // re-check entitlement independently — the client check is a UI
  // convenience, not a security gate.
  function hasFeature(name) {
    const features = profile.value?.unlockedFeatures ?? profile.value?.unlocked_features
    return Array.isArray(features) && features.includes(name)
  }

  // --- Cached session (offline login) ----------------------------------------
  // The token is persisted (Keychain/Preferences) but `user`/`profile` only
  // exist after a successful /api/user fetch — without this cache, a cold
  // start with no network leaves isAuthenticated false and the router guard
  // strands an already-logged-in user on the login screen. The cache holds
  // the last known identity so offline cold starts reach the (fully local)
  // campaigns. It can never bypass the backend: every online request is
  // validated server-side, and a 401 still tears the session down.
  const CACHED_SESSION_KEY = 'auth.cachedSession'

  function _writeCachedSession() {
    try {
      localStorage.setItem(CACHED_SESSION_KEY, JSON.stringify({ user: user.value, profile: profile.value }))
    } catch { /* best-effort */ }
  }

  function _readCachedSession() {
    try {
      const raw = localStorage.getItem(CACHED_SESSION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  function _clearCachedSession() {
    try { localStorage.removeItem(CACHED_SESSION_KEY) } catch { /* best-effort */ }
  }

  async function initialize() {
    if (initialized.value) return

    token.value = await getToken()

    if (token.value) {
      try {
        // Tighter bound than the 25s global so a slow cold-launch isn't a long blank.
        await fetchUser({ timeout: 12000 })
      } catch (error) {
        // ONLY a real auth failure (invalid/expired token) clears the session. A
        // network/timeout error on a poor connection must NOT log the user out —
        // keep the token and retry the profile fetch in the background.
        if (error?.response?.status === 401) {
          // Keep IndexedDB + cached session: a same-account re-login (token
          // revoked by a password reset etc.) preserves unsynced progress.
          await logout({ preserveLocalData: true })
        } else {
          console.warn('[Auth] initialize: profile fetch failed, keeping session:', error?.message || error)
          // Offline cold start: hydrate identity from the cached session so
          // the router guard passes and the user reaches their local
          // campaigns. Refreshed for real when connectivity returns.
          const cached = _readCachedSession()
          if (cached?.user && !user.value) {
            user.value = cached.user
            profile.value = cached.profile ?? null
            try {
              window.addEventListener('online', () => { fetchUser().catch(() => {}) }, { once: true })
            } catch { /* SSR/odd env */ }
          }
          fetchUser().catch(() => {})
        }
      }
    }

    // Bind the offline token ledger to the (possibly cache-hydrated) user so
    // pending offline earns/spends show in the balance and flush when online.
    if (user.value) {
      try { useTokensStore().init() } catch { /* best-effort */ }
    }

    initialized.value = true
  }

  async function fetchUser(opts = {}) {
    const response = await api.get('/api/user', opts)
    user.value = response.data.user
    profile.value = response.data.profile
    // Cache stores SERVER truth (written before the tokens store re-derives
    // the display balance as serverTokens + pending offline ledger).
    _writeCachedSession()
    try {
      const tokensStore = useTokensStore()
      tokensStore.init()
      tokensStore.onServerProfile(response.data.profile)
    } catch { /* tokens store is best-effort here */ }
    return user.value
  }

  async function login(credentials) {
    loading.value = true
    try {
      const response = await api.post('/api/auth/login', credentials)
      // Clear the previous account's local data ONLY when a DIFFERENT user
      // signs in. Same-account re-login (e.g. after a 401-forced logout from
      // a token revocation) keeps unsynced local campaigns so they can still
      // push to the cloud. No cached session (fresh device / manual logout,
      // where the DB was already wiped) → clear, preserving old behavior.
      const cachedId = _readCachedSession()?.user?.id
      if (cachedId == null || String(cachedId) !== String(response.data.user?.id)) {
        await clearDatabase().catch(() => {})
        try { useTokensStore().clearAllLedgers() } catch { /* best-effort */ }
      }
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
      try { useTokensStore().clearAllLedgers() } catch { /* best-effort */ }

      const response = await api.post('/api/auth/register', data)
      token.value = response.data.token
      user.value = response.data.user
      await setToken(token.value)
      // Same as login — /api/auth/register doesn't carry profile.
      await fetchUser()
      _stampFreshAccount()
      return response.data
    } finally {
      loading.value = false
    }
  }

  // Sign in / sign up via a verified social identity token (Apple/Google).
  // Mirrors login(): the backend create-or-links the account and returns the
  // same { user, token } shape. `payload` = { provider, credential, name?, email? }.
  async function loginWithSocial(payload) {
    loading.value = true
    try {
      const response = await api.post('/api/auth/social/token', payload)
      // Same-account guard as login(): only wipe local data for a DIFFERENT
      // authenticated user.
      const cachedId = _readCachedSession()?.user?.id
      if (cachedId == null || String(cachedId) !== String(response.data.user?.id)) {
        await clearDatabase().catch(() => {})
        try { useTokensStore().clearAllLedgers() } catch { /* best-effort */ }
      }
      token.value = response.data.token
      user.value = response.data.user
      await setToken(token.value)
      await fetchUser()
      // Social create-or-links silently; the server flags brand-new accounts
      // (absent on old servers → no stamp → returning-user greeting).
      if (response.data.user?.is_new === true) _stampFreshAccount()
      return response.data
    } finally {
      loading.value = false
    }
  }

  // --- First-visit greeting flag ---------------------------------------------
  // Stamped at account creation, consumed by the dashboard's first render so
  // a brand-new user gets "Welcome" instead of "Welcome back". One-shot and
  // best-effort: any storage failure just falls back to returning-user copy.
  const FRESH_ACCOUNT_KEY = 'auth.freshAccount'

  function _stampFreshAccount() {
    try { localStorage.setItem(FRESH_ACCOUNT_KEY, '1') } catch { /* best-effort */ }
  }

  function consumeFreshAccountFlag() {
    try {
      const fresh = localStorage.getItem(FRESH_ACCOUNT_KEY) === '1'
      if (fresh) localStorage.removeItem(FRESH_ACCOUNT_KEY)
      return fresh
    } catch {
      return false
    }
  }

  // Exchange a one-time app→web handoff nonce for a session (Community flow).
  // Mirrors loginWithSocial minus clearDatabase — the handoff lands the SAME
  // user on web, so local web data (if any) belongs to them already.
  async function loginWithHandoff(nonce) {
    loading.value = true
    try {
      const response = await api.post('/api/auth/handoff/exchange', { nonce }, { skipErrorToast: true })
      token.value = response.data.token
      user.value = response.data.user
      await setToken(token.value)
      await fetchUser()
      return response.data
    } finally {
      loading.value = false
    }
  }

  // Link a verified social identity (Apple/Google) to the CURRENT account.
  // Unlike loginWithSocial: no clearDatabase, no token swap — the session is
  // unchanged. payload = { provider, credential, name?, email? }.
  async function linkSocial(payload) {
    const response = await api.post('/api/user/social/link', payload)
    if (user.value) {
      user.value.linked_providers = response.data.linked_providers
      user.value.has_password = response.data.has_password
    }
    return response.data
  }

  async function unlinkSocial(provider) {
    const response = await api.delete(`/api/user/social/${provider}`)
    if (user.value) {
      user.value.linked_providers = response.data.linked_providers
      user.value.has_password = response.data.has_password
    }
    return response.data
  }

  // `preserveLocalData` is set by the 401-forced logout path (revoked token):
  // it keeps IndexedDB and the cached session so a same-account re-login can
  // preserve — and then cloud-push — unsynced progress. A user-initiated
  // logout always wipes both (the next user must not see this data).
  async function logout({ preserveLocalData = false } = {}) {
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

    // Same for queued offline token deltas — best-effort flush before the
    // ledger is wiped below (no-op when offline or empty).
    try {
      await useTokensStore().flush()
    } catch (e) {
      console.warn('[Auth] Pre-logout token flush failed:', e)
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

      if (!preserveLocalData) {
        _clearCachedSession()
        try { useTokensStore().clearAllLedgers() } catch { /* best-effort */ }
        // Clear all local campaign data so the next user doesn't see it
        try {
          await clearDatabase()
        } catch (e) {
          console.warn('[Auth] Failed to clear IndexedDB on logout:', e)
        }
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

  async function deleteAccount(password) {
    loading.value = true
    try {
      // DELETE with a body — axios requires the payload under `data`.
      // Backend validates `password` (current_password), revokes all tokens,
      // and cascade-deletes the user's profile, campaigns, and achievements.
      await api.delete('/api/user', { data: { password } })

      // Account is gone server-side; tear down all local state. Mirror logout's
      // cleanup but skip the /api/auth/logout call (token is already revoked).
      token.value = null
      user.value = null
      profile.value = null
      await removeToken()
      _clearCachedSession()
      try { useTokensStore().clearAllLedgers() } catch { /* best-effort */ }
      try {
        await clearDatabase()
      } catch (e) {
        console.warn('[Auth] Failed to clear IndexedDB on account deletion:', e)
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * Promote the GM one level (capped at platinum) after an owner extends the
   * contract. Optimistic local set + best-effort server persist, mirroring the
   * token flow. The server endpoint (`POST /api/user/gm-level { level }`) is
   * wired separately; if it isn't present yet this still updates the client so
   * the feature works end-to-end and reconciles on next `/api/user` fetch.
   *
   * @returns {{ previous: number, level: number, promoted: boolean }}
   */
  async function promoteGmLevel() {
    if (!profile.value) return { previous: 0, level: 0, promoted: false }
    const previous = clampGmLevel(profile.value.gmLevel ?? profile.value.gm_level ?? 0)
    const level = nextGmLevel(previous)
    // Optimistic local update (write both casings for safety).
    profile.value.gmLevel = level
    profile.value.gm_level = level
    if (level !== previous) {
      try {
        const response = await api.post('/api/user/gm-level', { level })
        const serverLevel = response?.data?.gmLevel ?? response?.data?.gm_level
        if (serverLevel != null) {
          const clamped = clampGmLevel(serverLevel)
          profile.value.gmLevel = clamped
          profile.value.gm_level = clamped
        }
      } catch (err) {
        // Non-fatal: backend endpoint may not exist yet. Keep the optimistic
        // value so the GM Level feature is fully functional client-side.
        console.warn('[Auth] Failed to persist GM level to backend:', err?.message || err)
      }
    }
    return { previous, level: clampGmLevel(profile.value.gmLevel), promoted: level !== previous }
  }

  /**
   * Raise the GM level to at least `minLevel` if currently below it (a floor —
   * never lowers). Used to grandfather legacy GMs who are already running a
   * gated Strong/Elite franchise from before the GM-Level gate existed, so the
   * gate stays consistent with the seat they already hold. Optimistic +
   * best-effort persist, same as promoteGmLevel.
   *
   * @returns {Promise<{ raised: boolean, level: number }>}
   */
  async function ensureGmLevelAtLeast(minLevel) {
    if (!profile.value) return { raised: false, level: 0 }
    const current = clampGmLevel(profile.value.gmLevel ?? profile.value.gm_level ?? 0)
    const target = clampGmLevel(minLevel)
    if (current >= target) return { raised: false, level: current }
    profile.value.gmLevel = target
    profile.value.gm_level = target
    try {
      const response = await api.post('/api/user/gm-level', { level: target }, { skipErrorToast: true })
      const serverLevel = response?.data?.gmLevel ?? response?.data?.gm_level
      if (serverLevel != null) {
        const clamped = clampGmLevel(serverLevel)
        profile.value.gmLevel = clamped
        profile.value.gm_level = clamped
      }
    } catch (err) {
      console.warn('[Auth] Failed to persist GM level floor to backend:', err?.message || err)
    }
    return { raised: true, level: clampGmLevel(profile.value.gmLevel) }
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
    isGlobalAdmin,
    linkedProviders,
    consumeFreshAccountFlag,
    hasPassword,
    gmLevel,
    promoteGmLevel,
    ensureGmLevelAtLeast,
    initialize,
    fetchUser,
    login,
    register,
    loginWithSocial,
    loginWithHandoff,
    linkSocial,
    unlinkSocial,
    logout,
    updateProfile,
    updatePassword,
    forgotPassword,
    resetPassword,
    deleteAccount,
    updateSettings,
    hasFeature
  }
})
