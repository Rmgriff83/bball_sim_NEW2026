// =============================================================================
// recentColors.js — per-user MRU stack of colors used in the headshot editor
// =============================================================================
// Scoped by user id so each admin's history stays separate on a shared
// device. Token-bound and literal-hex entries both supported — token entries
// re-apply as palette-bound (so the user editor's palette still flexes them),
// literal entries re-apply with their saved hex + label.
//
// Storage shape per user (under localStorage key headshot.recentColors.<userId>):
//   [
//     { mode: 'token', token: 'hair.base', hex: '#5a3d22', label: 'Hair Base' },
//     { mode: 'literal', hex: '#ffd700', label: 'Hair Glow' },
//     ...
//   ]
// `hex` on token entries is a snapshot of the palette value at save time —
// purely for swatch display; the token remains authoritative on re-apply.
// =============================================================================

const MAX_RECENTS = 12

function _key(userId) {
  return `headshot.recentColors.${userId ?? 'anon'}`
}

function _entrySig(entry) {
  // Equal entries (same mode + binding) collapse together when pushed so a
  // re-pick moves them to the front instead of accumulating duplicates.
  return entry?.mode === 'token'
    ? `t:${entry.token}`
    : `l:${(entry?.hex || '').toLowerCase()}:${entry?.label || ''}`
}

export function loadRecentColors(userId) {
  try {
    const raw = localStorage.getItem(_key(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function pushRecentColor(userId, entry) {
  if (!entry || !entry.mode) return loadRecentColors(userId)
  const sig = _entrySig(entry)
  const current = loadRecentColors(userId).filter(e => _entrySig(e) !== sig)
  current.unshift({ ...entry })
  const trimmed = current.slice(0, MAX_RECENTS)
  try {
    localStorage.setItem(_key(userId), JSON.stringify(trimmed))
  } catch {
    /* private mode etc. */
  }
  return trimmed
}
