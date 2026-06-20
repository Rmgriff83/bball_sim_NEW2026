// =============================================================================
// gmLevels.js
// =============================================================================
// The user-GM's career level — a PROFILE-GLOBAL stat (like tokens) that persists
// across every campaign, not per-campaign. It rises by +1 each time an owner
// extends the GM's contract. Levels gate which franchises the user may take over:
// Strong-facility teams require Silver (2) or higher; Elite-facility teams
// require Gold (3) or higher.
//
// Stored as a 0-4 integer on the user profile (authStore.profile.gmLevel). This
// module is pure data/helpers — no framework or store imports.
// =============================================================================

// Ordered tiers. Index === stored numeric level.
export const GM_LEVELS = ['unranked', 'bronze', 'silver', 'gold', 'platinum'];

export const GM_LEVEL_MAX = GM_LEVELS.length - 1; // 4 (platinum)

// Level at/above which a GM may run a Strong-facility franchise.
export const GM_LEVEL_SILVER = 2;

// Level at/above which a GM may run an Elite-facility franchise.
export const GM_LEVEL_GOLD = 3;

export const GM_LEVEL_LABEL = {
  0: 'Unranked',
  1: 'Bronze',
  2: 'Silver',
  3: 'Gold',
  4: 'Platinum',
};

// Tier accent colors for badges/chips (greys → gold → platinum).
export const GM_LEVEL_COLOR = {
  0: '#94a3b8',
  1: '#b06a3b',
  2: '#9aa6b2',
  3: '#f5c72c',
  4: '#7dd3fc',
};

/** Clamp any value to a valid 0-4 GM level. */
export function clampGmLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(GM_LEVEL_MAX, Math.round(n)));
}

/** Next level after a successful contract extension (capped at platinum). */
export function nextGmLevel(level) {
  return Math.min(GM_LEVEL_MAX, clampGmLevel(level) + 1);
}

export function gmLevelLabel(level) {
  return GM_LEVEL_LABEL[clampGmLevel(level)] ?? 'Unranked';
}

export function gmLevelColor(level) {
  return GM_LEVEL_COLOR[clampGmLevel(level)] ?? GM_LEVEL_COLOR[0];
}

export function gmLevelKey(level) {
  return GM_LEVELS[clampGmLevel(level)] ?? 'unranked';
}

/** Whether this GM level may take over an Elite-facility franchise. */
export function canManageEliteTeam(level) {
  return clampGmLevel(level) >= GM_LEVEL_GOLD;
}

/**
 * Minimum GM level required to take over a franchise of the given facility tier
 * label ('Elite' → Gold, 'Strong' → Silver, anything else → no gate).
 */
export function requiredGmLevelForTier(tierLabel) {
  if (tierLabel === 'Elite') return GM_LEVEL_GOLD;
  if (tierLabel === 'Strong') return GM_LEVEL_SILVER;
  return 0;
}

/** Whether this GM level may take over a franchise of the given facility tier. */
export function canManageTeamTier(level, tierLabel) {
  return clampGmLevel(level) >= requiredGmLevelForTier(tierLabel);
}
