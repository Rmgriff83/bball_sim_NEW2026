import { coachBadges } from '@/engine/data/coachBadges'

/**
 * Aggregate every owned coach badge's effects into a single perks object.
 * Each owned entry contributes the effects for its specific level (bronze /
 * silver / gold / hof). Levels are mutually exclusive per badge — upgrading
 * replaces the entry, so the aggregator never double-counts.
 *
 * @param {object|null} coach - The coach record (typically `team.coach`).
 *   `coach.badges` is expected to be an array of
 *   `{ id, level, source, purchasedAt? }`. If missing or shaped legacy-style
 *   without a level, falls back to 'bronze'.
 * @returns {object} Aggregated perks keyed by effect name.
 */
export function getCoachPerks(coach) {
  const owned = coach?.badges ?? []
  const aggregate = {
    developmentBonus: 0,
    clutchShotBonus: 0,
    offensiveIQBoost: 0,
    defensiveIQBoost: 0,
    gameManagementBoost: 0,
    strictnessOffset: 0,
    strictnessSoften: 0,
  }

  for (const entry of owned) {
    if (!entry || !entry.id) continue
    const def = coachBadges.find(b => b.id === entry.id)
    if (!def || !def.effects) continue
    const level = entry.level ?? 'bronze'
    const levelEffects = def.effects[level]
    if (!levelEffects) continue
    for (const [key, val] of Object.entries(levelEffects)) {
      aggregate[key] = (aggregate[key] ?? 0) + val
    }
  }

  return aggregate
}

/**
 * Return a coach attribute value with any badge boosts applied. Engine code
 * should call this instead of reading `coach.attributes[attr]` directly so
 * master-seeded and purchased boosts both flow through automatically.
 *
 * Default of 75 if the coach or attribute is missing keeps simulators safe
 * even when called early in campaign load.
 *
 * @param {object|null} coach
 * @param {string} attr - One of: 'offensiveIQ', 'defensiveIQ',
 *   'playerDevelopment', 'gameManagement', 'strictness'
 * @returns {number} Effective attribute value clamped to 0..99.
 */
export function getEffectiveCoachAttribute(coach, attr) {
  const base = coach?.attributes?.[attr] ?? 75
  const perks = getCoachPerks(coach)
  const boost = perks[`${attr}Boost`] ?? 0
  return Math.max(0, Math.min(99, base + boost))
}
