// =============================================================================
// tokens.js — token balance + offline ledger.
// =============================================================================
// Tokens are server-authoritative. This store is the single gateway for every
// in-game earn/spend:
//
//   spendTokens(cost, reason)  — online: legacy POST /api/user/tokens exactly
//                                as before (422 aborts identically). Network
//                                failure/offline: the spend is queued in a
//                                persisted ledger and applied optimistically.
//   earnTokens(amount, reason) — ALWAYS ledger-first (exact-once semantics),
//                                flushed immediately when online. Never throws.
//   flush()                    — batches queued entries to the idempotent
//                                POST /api/user/tokens/ledger endpoint.
//
// Display invariant: authStore.profile.tokens (read by every balance display
// and affordability guard in the app) always equals
//   max(0, serverTokens + pendingNet)
// where serverTokens is the last server-confirmed balance and pendingNet is
// the sum of queued ledger entries. All mutations funnel through
// _recomputeDisplay(), so no display/guard site needed changing.
//
// IAP purchases (StoreView) are entirely webhook-credited server-side and are
// deliberately untouched by this store.
// =============================================================================

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/composables/useApi'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const LEDGER_KEY_PREFIX = 'tokens.ledger.'
const LOCK_KEY_PREFIX = 'tokens.flushLock.'
const BATCH_MAX_ENTRIES = 200
const FLUSH_LOCK_MS = 30 * 1000
const DEFER_COOLDOWN_MS = 6 * 60 * 60 * 1000 // re-try deferred (over-daily-cap) earns every 6h

function _uuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  // RFC4122-ish fallback for ancient webviews.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export const useTokensStore = defineStore('tokens', () => {
  const userId = ref(null)
  // Last server-confirmed balance. null = not yet known this session (seeded
  // from the cached profile on offline cold starts).
  const serverTokens = ref(null)
  const entries = ref([])
  // In-flight batch marker { id, entryIds } — persisted so a retry after a
  // lost response re-sends the IDENTICAL batch id (server replays its stored
  // result; exact-once).
  const batch = ref(null)
  const deferCooldownUntil = ref(null)
  // Entry ids the server deferred (over the daily earn ceiling) — they wait
  // for the cooldown; any NEW entry re-enables flushing immediately.
  const deferredIds = ref(new Set())

  let _flushing = false
  let _onlineListenerRegistered = false

  const pendingNet = computed(() =>
    entries.value.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  )

  function _ledgerKey() {
    return userId.value != null ? `${LEDGER_KEY_PREFIX}${userId.value}` : null
  }

  function _load() {
    const key = _ledgerKey()
    if (!key) return
    try {
      const raw = localStorage.getItem(key)
      const parsed = raw ? JSON.parse(raw) : null
      entries.value = Array.isArray(parsed?.entries) ? parsed.entries : []
      batch.value = parsed?.batch ?? null
      deferCooldownUntil.value = parsed?.deferCooldownUntil ?? null
      deferredIds.value = new Set(Array.isArray(parsed?.deferredIds) ? parsed.deferredIds : [])
    } catch {
      entries.value = []
      batch.value = null
      deferCooldownUntil.value = null
      deferredIds.value = new Set()
    }
  }

  function _persist() {
    const key = _ledgerKey()
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify({
        v: 1,
        entries: entries.value,
        batch: batch.value,
        deferCooldownUntil: deferCooldownUntil.value,
        deferredIds: [...deferredIds.value],
      }))
    } catch { /* storage full/unavailable — in-memory ledger still works this session */ }
  }

  // The single writer of the display balance (see invariant at top).
  function _recomputeDisplay() {
    const authStore = useAuthStore()
    if (!authStore.profile) return
    const base = serverTokens.value ?? Number(authStore.profile.tokens) ?? 0
    if (serverTokens.value == null) serverTokens.value = Number.isFinite(base) ? base : 0
    authStore.profile.tokens = Math.max(0, (serverTokens.value ?? 0) + pendingNet.value)
  }

  function _append(amount, reason) {
    entries.value = [...entries.value, { id: _uuid(), amount, reason, at: new Date().toISOString() }]
    _persist()
    _recomputeDisplay()
  }

  function _isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false
  }

  /**
   * Bind the store to the authenticated user and start the flush machinery.
   * Idempotent; safe to call on every auth transition.
   */
  function init() {
    const authStore = useAuthStore()
    const id = authStore.user?.id
    if (id == null) return
    if (String(userId.value) !== String(id)) {
      userId.value = id
      _load()
    }
    // Seed serverTokens from the profile when unknown — on offline cold
    // starts the cached profile holds SERVER truth (auth caches it before
    // any recompute), so adding pendingNet on top is not a double-add.
    _recomputeDisplay()
    if (!_onlineListenerRegistered) {
      try {
        window.addEventListener('online', () => { flush().catch(() => {}) })
        _onlineListenerRegistered = true
      } catch { /* SSR/odd env */ }
    }
    if (entries.value.length > 0) flush().catch(() => {})
  }

  /**
   * Called by auth.fetchUser with the fresh server profile: record server
   * truth and re-derive the display balance (server value + pending ledger).
   */
  function onServerProfile(profile) {
    serverTokens.value = Number(profile?.tokens) || 0
    _recomputeDisplay()
    if (entries.value.length > 0) flush().catch(() => {})
  }

  /**
   * Spend `cost` tokens. Online behavior is byte-identical to the legacy
   * inline POST (including 422 "Insufficient tokens" aborting the purchase);
   * a NETWORK failure (or being offline) queues the spend and lets the
   * purchase proceed locally.
   * Returns { tokens, offline } — throws exactly where the old code threw.
   */
  async function spendTokens(cost, reason) {
    const authStore = useAuthStore()
    cost = Math.abs(Number(cost) || 0)
    if (cost === 0) return { tokens: authStore.profile?.tokens ?? 0, offline: false }
    // Backstop guard (each call site keeps its own pre-check + toast).
    if ((authStore.profile?.tokens ?? 0) < cost) {
      throw new Error('Insufficient tokens')
    }

    if (_isOffline()) {
      _append(-cost, reason)
      return { tokens: authStore.profile.tokens, offline: true }
    }

    // Flush queued deltas first so the server's balance guard judges the
    // spend against the true balance. Best-effort — a failure falls through
    // to the POST, whose own failure handling covers the offline case.
    if (entries.value.length > 0) {
      try { await flush() } catch { /* handled below */ }
    }

    try {
      const response = await api.post('/api/user/tokens', { amount: -cost }, { skipErrorToast: true })
      serverTokens.value = Number(response.data?.tokens) || 0
      // Keep the offline-login cache holding SERVER truth so a later offline
      // cold start shows the post-spend balance, not the app-open one.
      try { authStore.updateCachedTokens(serverTokens.value) } catch { /* best-effort */ }
      _recomputeDisplay()
      return { tokens: authStore.profile.tokens, offline: false }
    } catch (err) {
      if (err?.response) {
        // HTTP-answered error (e.g. 422 Insufficient): reproduce the axios
        // interceptor's toast (suppressed via skipErrorToast above) and
        // rethrow so every call site's catch behaves exactly as before.
        try { useToastStore().showError(err.message) } catch { /* toast best-effort */ }
        throw err
      }
      // Network-level failure: queue the spend and let the purchase proceed.
      _append(-cost, reason)
      return { tokens: authStore.profile.tokens, offline: true }
    }
  }

  /**
   * Earn `amount` tokens. Always ledger-first (exact-once via the idempotent
   * flush endpoint), flushed immediately when online. Never throws.
   */
  async function earnTokens(amount, reason) {
    const authStore = useAuthStore()
    amount = Math.abs(Number(amount) || 0)
    if (amount === 0) return { tokens: authStore.profile?.tokens ?? 0 }
    _append(amount, reason)
    if (!_isOffline()) flush().catch(() => {})
    return { tokens: authStore.profile?.tokens ?? 0 }
  }

  /**
   * Flush queued entries to the idempotent ledger endpoint. Single-flight;
   * re-sends a persisted in-flight batch verbatim (lost-response retry);
   * keeps server-`deferred` entries queued for a later day.
   */
  async function flush() {
    if (_flushing) return
    if (_isOffline()) return
    if (userId.value == null) return

    // Multi-tab (web) guard: a fresh lock from another tab wins.
    const lockKey = `${LOCK_KEY_PREFIX}${userId.value}`
    try {
      const lock = Number(localStorage.getItem(lockKey))
      if (Number.isFinite(lock) && Date.now() - lock < FLUSH_LOCK_MS) return
      localStorage.setItem(lockKey, String(Date.now()))
    } catch { /* storage unavailable — proceed */ }

    _flushing = true
    try {
      for (let iterations = 0; iterations < 20; iterations++) {
        // Re-read from storage — another tab may have mutated the ledger.
        _load()
        if (entries.value.length === 0) return

        // All remaining entries deferred and cooldown active → wait it out.
        const allDeferred = entries.value.every(e => deferredIds.value.has(e.id))
        if (allDeferred && deferCooldownUntil.value && Date.now() < deferCooldownUntil.value) return

        // Re-send the persisted in-flight batch verbatim; otherwise build a
        // fresh one from the oldest entries.
        let batchId
        let batchEntries
        if (batch.value?.id) {
          const ids = new Set(batch.value.entryIds ?? [])
          batchId = batch.value.id
          batchEntries = entries.value.filter(e => ids.has(e.id))
          if (batchEntries.length === 0) {
            batch.value = null
            _persist()
            continue
          }
        } else {
          batchEntries = entries.value.slice(0, BATCH_MAX_ENTRIES)
          batchId = _uuid()
          batch.value = { id: batchId, entryIds: batchEntries.map(e => e.id) }
          _persist()
        }

        const response = await api.post('/api/user/tokens/ledger', {
          batch_id: batchId,
          entries: batchEntries.map(e => ({ id: e.id, amount: e.amount, reason: e.reason })),
        }, { skipErrorToast: true, timeout: 20000 })

        const { tokens, credited = [], deferred = [], rejected = [] } = response.data ?? {}
        const remove = new Set([...credited, ...rejected])
        if (rejected.length > 0) {
          console.warn('[Tokens] Ledger entries rejected by server:', rejected)
        }
        entries.value = entries.value.filter(e => !remove.has(e.id))
        deferredIds.value = new Set(deferred)
        deferCooldownUntil.value = deferred.length > 0 ? Date.now() + DEFER_COOLDOWN_MS : null
        batch.value = null
        serverTokens.value = Number(tokens) || 0
        // Keep the offline-login cache holding SERVER truth (see spendTokens).
        try { useAuthStore().updateCachedTokens(serverTokens.value) } catch { /* best-effort */ }
        _persist()
        _recomputeDisplay()

        if (entries.value.length === 0) return
      }
    } finally {
      _flushing = false
      try { localStorage.removeItem(lockKey) } catch { /* ignore */ }
    }
  }

  /**
   * Remove every persisted ledger (all users) — called beside clearDatabase
   * on manual logout / different-user login / register / account deletion.
   */
  function clearAllLedgers() {
    try {
      const doomed = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && (key.startsWith(LEDGER_KEY_PREFIX) || key.startsWith(LOCK_KEY_PREFIX))) doomed.push(key)
      }
      doomed.forEach(k => localStorage.removeItem(k))
    } catch { /* best-effort */ }
    userId.value = null
    serverTokens.value = null
    entries.value = []
    batch.value = null
    deferCooldownUntil.value = null
    deferredIds.value = new Set()
  }

  return {
    // State (exposed mainly for devtools/tests)
    pendingNet,
    // Actions
    init,
    onServerProfile,
    spendTokens,
    earnTokens,
    flush,
    clearAllLedgers,
  }
})
