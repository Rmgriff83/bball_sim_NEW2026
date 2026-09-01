// Fandom — a per-team 0–100% meter of how energized the fanbase is. Moves
// with on-court results (wins/losses, playoff runs, championships), draft
// lottery luck, Arena facility changes, and token-costing marketing events;
// it scales the home-court advantage and drives threshold news + superfan
// owner subtasks.
//
// Persistence: `team.fandom` is a plain number on the team row. It is an
// ADDITIVE field — old saves don't have it, so every reader must go through
// `?? FANDOM_DEFAULT` (or fandomForFacilities). The backfillFandomArena
// migration heals existing campaigns, but nothing may assume it ran.
//
// This module is deliberately import-free (worker-pure, node-testable —
// same pattern as tradeEligibility.js / salaryScale.js). It must never
// import i18n or Pinia stores.

export const FANDOM_DEFAULT = 50

// ---- Raw event deltas (before the soft-cap scaling in applyFandomDelta) ----
export const REGULAR_WIN_RAW = 1.2
export const REGULAR_LOSS_RAW = -1.0
// Playoff wins scale by round (1 = First Round … 4 = Finals); a playoff loss
// stings the same as a regular-season one.
export const PLAYOFF_WIN_RAW_BY_ROUND = { 1: 2.4, 2: 3.6, 3: 4.8, 4: 6.0 }
export const CHAMPIONSHIP_RAW = 12
// Draft lottery: any team that jumps UP gets a per-slot boost; landing a
// top-4 pick adds a pick-scaled boost multiplied by draft-class strength.
export const LOTTERY_JUMP_RAW_PER_SLOT = 0.75
export const LOTTERY_JUMP_RAW_CAP = 6
export const TOP_PICK_RAW = { 1: 8, 2: 6, 3: 4.5, 4: 3.5 }
// Arena facility level changes move the crowd immediately.
export const ARENA_UPGRADE_RAW = 4
export const ARENA_DOWNGRADE_RAW = -4

// Loss mitigation (user team only): loss raws are multiplied by (1 - m),
// where m = the Arena facility's BASELINE protection (per level, no staff
// needed) PLUS the hired arena manager's Damage Control perk — additive,
// clamped by LOSS_MITIGATION_CAP. Max realistic: Lv5 arena + 4★ manager
// = 20% + 15% = 35% softer losses.
export const ARENA_LOSS_MITIGATION_BY_LEVEL = { 1: 0, 2: 0.05, 3: 0.1, 4: 0.15, 5: 0.2 }
export const LOSS_MITIGATION_BY_TIER = { 3: 0.1, 4: 0.15 }
export const LOSS_MITIGATION_CAP = 0.6

// Marketing events: per-season cap and in-game-day cooldown between uses.
export const MARKETING_EVENTS_PER_SEASON = 3
export const MARKETING_COOLDOWN_DAYS = 7
// Bonus multiplier on marketing raws when the arena manager has the
// marketing_boost perk active.
export const MARKETING_BOOST_MULTIPLIER = 1.25

// User-team news thresholds (checked on downward/upward crossings).
export const FANDOM_NEWS_THRESHOLDS = {
  paperBags: 15, // below → fans wear paper bags
  emptySeats: 30, // below → swaths of empty seats
  believing: 50, // above → the city starts believing
  rocking: 85, // above → arena is rocking / sellout streak
}

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Apply a raw delta to a fandom value with soft-capping: gains shrink as
 * fandom approaches 100, losses shrink as it approaches 0, so the meter
 * never rails and always has somewhere to move. Tolerates missing/invalid
 * current values (old saves) by starting from FANDOM_DEFAULT.
 */
export function applyFandomDelta(current, raw) {
  const n = Number(current)
  const f = _clamp(Number.isFinite(n) ? n : FANDOM_DEFAULT, 0, 100)
  const r = Number(raw)
  if (!Number.isFinite(r) || r === 0) return f
  const scaled = r > 0 ? (r * (100 - f)) / 100 : (r * f) / 100
  return _clamp(f + scaled, 0, 100)
}

/**
 * Starting fandom derived from a team's facility levels (all keys present
 * on the object, arena included when it exists). Missing/empty facilities
 * fall back to level-1 quality rather than throwing.
 * avg 1 → 23, avg 3 → 49, avg 5 → 75; clamped to 5..95.
 */
export function fandomForFacilities(facilities) {
  const levels = Object.values(facilities ?? {})
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0)
  const avg = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 1
  return _clamp(Math.round(10 + 13 * avg), 5, 95)
}

/** Raw delta for a playoff win in the given round (1-4). */
export function playoffWinRaw(round) {
  return PLAYOFF_WIN_RAW_BY_ROUND[round] ?? PLAYOFF_WIN_RAW_BY_ROUND[1]
}

/** Raw boost for jumping up `slots` places in the draft lottery. */
export function lotteryJumpRaw(slots) {
  const s = Math.max(0, Number(slots) || 0)
  return Math.min(LOTTERY_JUMP_RAW_CAP, s * LOTTERY_JUMP_RAW_PER_SLOT)
}

/** Raw boost for landing a top-4 pick, scaled by draft-class strength. */
export function topPickRaw(actualPick, classStrength = 1) {
  const base = TOP_PICK_RAW[actualPick]
  if (!base) return 0
  const s = Number(classStrength)
  return base * (Number.isFinite(s) ? _clamp(s, 0.7, 1.3) : 1)
}

/**
 * Draft-class strength multiplier in 0.7..1.3, from the average of the top
 * 10 prospects' (overall + potential) / 2 against a 75 baseline.
 */
export function classStrengthFromProspects(prospects) {
  const rated = (Array.isArray(prospects) ? prospects : [])
    .map((p) => ((Number(p?.overall) || 0) + (Number(p?.potential) || 0)) / 2)
    .filter((v) => v > 0)
    .sort((a, b) => b - a)
    .slice(0, 10)
  if (!rated.length) return 1
  const avg = rated.reduce((a, b) => a + b, 0) / rated.length
  return _clamp(avg / 75, 0.7, 1.3)
}

/**
 * Loss-raw multiplier factor from a hired arena manager (settings staffer
 * object with a numeric `tier`). Returns 0 when nothing mitigates.
 */
export function lossMitigationFactor(arenaManager) {
  return LOSS_MITIGATION_BY_TIER[arenaManager?.tier] ?? 0
}

/**
 * The Arena facility's baseline loss protection — active with no staff
 * hired. Missing/invalid levels (old saves pre-backfill) mitigate nothing.
 */
export function arenaLossMitigation(arenaLevel) {
  return ARENA_LOSS_MITIGATION_BY_LEVEL[arenaLevel] ?? 0
}

/**
 * Combined loss mitigation: facility baseline + manager perk, additive,
 * clamped. This is what the game-result hook applies to the user team.
 */
export function totalLossMitigation(arenaLevel, arenaManager) {
  return Math.min(LOSS_MITIGATION_CAP, arenaLossMitigation(arenaLevel) + lossMitigationFactor(arenaManager))
}

/**
 * Home-court advantage applied to the home team's made-shot probability,
 * scaled by fandom with a small locker-room bump kept from the original
 * morale rule. Band 0.010–0.030; a legacy save (fandom defaults 50) lands
 * at 0.018/0.022 — within a hair of the pre-fandom 0.015/0.025 values.
 */
export function calculateHomeCourtAdvantageFromFandom(homeAvgMorale, homeFandom) {
  const n = Number(homeFandom)
  const f = _clamp(Number.isFinite(n) ? n : FANDOM_DEFAULT, 0, 100)
  return 0.01 + 0.016 * (f / 100) + (homeAvgMorale >= 65 ? 0.004 : 0)
}

/**
 * First in-game date ('YYYY-MM-DD') a marketing event may run again after
 * one used on `lastUsedDate`, or null when no cooldown applies. UTC math so
 * month/year rollovers and DST can't skew the result (same pattern as
 * tradeEligibility.js).
 */
export function marketingEligibleDate(lastUsedDate, days = MARKETING_COOLDOWN_DAYS) {
  const last = typeof lastUsedDate === 'string' ? lastUsedDate.slice(0, 10) : null
  if (!last) return null
  const [y, m, d] = last.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * Whether a marketing event can run now, given the campaign's
 * settings.marketing state ({ usedThisSeason, lastUsedDate }) and the
 * in-game currentDate. Old saves without the state block nothing.
 * Returns { allowed, reason: null | 'season_cap' | 'cooldown', eligibleDate }.
 */
export function canRunMarketingEvent(marketing, currentDate) {
  const used = Number(marketing?.usedThisSeason) || 0
  if (used >= MARKETING_EVENTS_PER_SEASON) {
    return { allowed: false, reason: 'season_cap', eligibleDate: null }
  }
  const eligible = marketingEligibleDate(marketing?.lastUsedDate)
  if (eligible && String(currentDate ?? '').slice(0, 10) < eligible) {
    return { allowed: false, reason: 'cooldown', eligibleDate: eligible }
  }
  return { allowed: true, reason: null, eligibleDate: null }
}
