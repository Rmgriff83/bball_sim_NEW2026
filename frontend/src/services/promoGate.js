// promoGate.js — per-user cadence gating for upsell popups.
//
// Keys (scoped by user id so a shared device keeps users separate, mirroring
// the walkthrough store's convention):
//   promo.<userId>.<promoKey>.lastShownAt   epoch ms, written at SHOW time
//
// A promo is eligible when it has never been shown to this user or the last
// showing is more than a week old. Storage failures (private mode, quota,
// disabled localStorage) must never throw into page-load code.

const PREFIX = 'promo'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function lsGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function keyFor(userId, promoKey) {
  return `${PREFIX}.${userId ? String(userId) : 'anon'}.${promoKey}.lastShownAt`
}

export function shouldShowPromo(userId, promoKey) {
  const raw = lsGet(keyFor(userId, promoKey))
  if (raw === null) return true
  const ts = Number(raw)
  // Corrupt/non-numeric value: show once — the fresh write repairs the key.
  if (!Number.isFinite(ts)) return true
  return Date.now() - ts > WEEK_MS
}

export function markPromoShown(userId, promoKey) {
  lsSet(keyFor(userId, promoKey), String(Date.now()))
}
