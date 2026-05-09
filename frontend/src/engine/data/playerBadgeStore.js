// =============================================================================
// Player Badge Store config + eligibility helpers
// =============================================================================
// Backs the user-facing badge purchase / upgrade UI for players. Mirrors the
// coach badge store pattern — premium tokens flow, levels progress
// bronze → silver → gold → HOF — but adds eligibility gating on top so a
// player's badge availability and per-badge max level reflect their position,
// attribute fit, and potential rating.
//
// Costs live here (not on the badge entries in `badges.js`) so the master
// badge list stays portable. Effects + tier scaling already live on each
// badge in `badges.js` and are read at sim time by GameSimulator — that
// pipeline is unchanged.

import { BADGES, BADGES_BY_POSITION } from './badges.js'

export { BADGES_BY_POSITION }

export const PLAYER_BADGE_LEVELS = ['bronze', 'silver', 'gold', 'hof']

// Premium token costs (~2× the coach badge store).
export const PLAYER_BADGE_COSTS = {
  bronze: 1500,
  silver: 3000,
  gold:   5000,
  hof:    10000,
}

// Map a badge's category to the player attribute keys most relevant for
// "attribute fit". We use a category-level default to keep the V1 surface
// small; per-badge overrides can be layered later if needed.
//
// Keys are dotted paths under `player.attributes.{category}` — they line up
// with the canonical schema in `attributeSchema.js`.
export const CATEGORY_KEY_ATTRIBUTES = {
  shooting:   ['offense.threePoint', 'offense.midRange', 'offense.shotIQ'],
  finishing:  ['offense.layup', 'offense.standingDunk', 'offense.drivingDunk', 'offense.postControl'],
  playmaking: ['offense.passAccuracy', 'offense.passVision', 'offense.passIQ', 'offense.ballHandling'],
  defense:    ['defense.perimeterDefense', 'defense.interiorDefense', 'defense.steal', 'defense.block', 'defense.helpDefenseIQ'],
  physical:   ['physical.speed', 'physical.strength', 'physical.stamina', 'physical.vertical'],
}

// Attribute fit floor — below this, the badge isn't even shown in the store
// because the player can't meaningfully execute the skill.
const ATTR_FIT_ELIGIBILITY_FLOOR = 50

/**
 * Return the next level after `current`, or null if already at HOF.
 *   nextPlayerBadgeLevel(null)     → 'bronze' (initial unlock)
 *   nextPlayerBadgeLevel('bronze') → 'silver'
 *   nextPlayerBadgeLevel('hof')    → null
 */
export function nextPlayerBadgeLevel(current) {
  if (!current) return 'bronze'
  const idx = PLAYER_BADGE_LEVELS.indexOf(current)
  if (idx < 0 || idx === PLAYER_BADGE_LEVELS.length - 1) return null
  return PLAYER_BADGE_LEVELS[idx + 1]
}

/**
 * Compare two levels — returns negative if a < b, 0 equal, positive if a > b.
 * Treats null as "below bronze" so callers can compare `currentLevel` (which
 * may be null for unowned badges) against `maxLevel`.
 */
export function compareBadgeLevels(a, b) {
  const ai = a ? PLAYER_BADGE_LEVELS.indexOf(a) : -1
  const bi = b ? PLAYER_BADGE_LEVELS.indexOf(b) : -1
  return ai - bi
}

/**
 * Map a player's potentialRating to the highest tier their badges can reach
 * regardless of attribute fit. A higher potential lifts every badge's ceiling.
 */
export function getPotentialTierMax(potentialRating) {
  const p = Number(potentialRating) || 0
  if (p >= 95) return 'hof'
  if (p >= 85) return 'gold'
  if (p >= 75) return 'silver'
  return 'bronze'
}

/**
 * Compute the badge's attribute fit on this player — the average of the
 * category-mapped attribute values. 0–99. Defaults to 50 when the player has
 * no `attributes` block, so brand-new players still have a sensible baseline.
 */
export function getAttrFit(player, badge) {
  const keys = CATEGORY_KEY_ATTRIBUTES[badge?.category] ?? []
  if (keys.length === 0 || !player?.attributes) return 50
  let total = 0
  let count = 0
  for (const path of keys) {
    const [cat, attr] = path.split('.')
    const v = player.attributes?.[cat]?.[attr]
    if (typeof v === 'number') {
      total += v
      count++
    }
  }
  return count > 0 ? Math.round(total / count) : 50
}

/**
 * Map a player's attrFit on a given badge to the highest tier the badge
 * itself can reach for this player. A player with weak shooting attributes
 * can't push a shooting badge to HOF even if their potential is elite —
 * the skill needs the underlying tools.
 */
export function getAttrFitMax(attrFit) {
  const f = Number(attrFit) || 0
  if (f >= 80) return 'hof'
  if (f >= 70) return 'gold'
  if (f >= 60) return 'silver'
  return 'bronze'
}

/**
 * Is the badge in the player's primary or secondary position pool?
 */
export function isBadgeInPositionPool(player, badgeId) {
  if (!player) return false
  const primary = BADGES_BY_POSITION[player.position] ?? []
  const secondary = player.secondaryPosition || player.secondary_position
    ? (BADGES_BY_POSITION[player.secondaryPosition || player.secondary_position] ?? [])
    : []
  return primary.includes(badgeId) || secondary.includes(badgeId)
}

/**
 * Per-player max level for a given badge.
 *   - returns null if the player isn't position-eligible OR attr fit < floor
 *   - otherwise returns the lower of potential-tier-max and attr-fit-max
 *
 * The "min of two caps" is the heart of the system — it answers the user's
 * intent that a 95-pot PG with 90 passing maxes Dimer at HOF, while the
 * same PG with 75 passing maxes it at Gold.
 */
export function getMaxBadgeLevel(player, badge) {
  if (!player || !badge) return null
  if (!isBadgeInPositionPool(player, badge.id)) return null
  const fit = getAttrFit(player, badge)
  if (fit < ATTR_FIT_ELIGIBILITY_FLOOR) return null
  const potentialMax = getPotentialTierMax(player.potentialRating ?? player.potential_rating ?? 0)
  const attrMax = getAttrFitMax(fit)
  return compareBadgeLevels(potentialMax, attrMax) <= 0 ? potentialMax : attrMax
}

/**
 * Build the full store entry list for the modal. Returns one entry per
 * eligible badge — non-eligible badges are filtered out entirely. Each entry
 * carries everything the UI needs to render the card and decide whether the
 * purchase button should be enabled.
 *
 * @param {Object} player
 * @returns {Array<{
 *   badge,            // raw entry from BADGES
 *   category,         // e.g. 'shooting'
 *   currentLevel,     // 'bronze' | 'silver' | 'gold' | 'hof' | null
 *   nextLevel,        // next purchasable level, or null if at maxLevel
 *   nextCost,         // tokens for the next purchase, or null
 *   maxLevel,         // ceiling for this player on this badge
 *   isMaxedForPlayer, // true when currentLevel === maxLevel
 *   attrFit,          // 0-99
 * }>}
 */
export function getBadgeStoreEntries(player) {
  if (!player) return []
  const ownedById = new Map()
  for (const entry of player.badges ?? []) {
    if (entry?.id) ownedById.set(entry.id, entry)
  }

  const out = []
  for (const badge of BADGES) {
    const maxLevel = getMaxBadgeLevel(player, badge)
    if (!maxLevel) continue
    const currentLevel = ownedById.get(badge.id)?.level ?? null
    const isMaxedForPlayer = compareBadgeLevels(currentLevel, maxLevel) >= 0
    const next = isMaxedForPlayer ? null : nextPlayerBadgeLevel(currentLevel)
    // If the next would exceed the per-player ceiling, treat as maxed.
    const nextLevel = next && compareBadgeLevels(next, maxLevel) <= 0 ? next : null
    const nextCost = nextLevel ? PLAYER_BADGE_COSTS[nextLevel] : null
    out.push({
      badge,
      category: badge.category,
      currentLevel,
      nextLevel,
      nextCost,
      maxLevel,
      isMaxedForPlayer,
      attrFit: getAttrFit(player, badge),
    })
  }
  return out
}
