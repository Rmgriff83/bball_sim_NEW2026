// Shared archetype/talent application for authored players — used by the
// roster editor's add-player modal AND the player details editor's Archetype
// tab. Lives in its own module (not archetypes.js) so it can import
// deriveOverallFromAttributes without any cycle risk.
import { CANONICAL_ATTRIBUTES } from './attributeSchema'
import { ARCHETYPE_SEEDS, ARCHETYPE_SEED_BASELINE } from './archetypes'
import { deriveOverallFromAttributes } from '../evolution/PlayerEvolution'

export const TALENT_TIERS = [
  { key: 'superstar', label: 'Superstar', target: 92 },
  { key: 'allstar', label: 'All-Star', target: 86 },
  { key: 'starter', label: 'Starter', target: 80 },
  { key: 'role', label: 'Role Player', target: 74 },
  { key: 'bench', label: 'Bench', target: 68 },
]

/**
 * Re-seed a player's attributes + growth ceilings from an archetype template
 * scaled to a talent tier. Mutates `player`.
 *
 * The derived overall is ~linear in a uniform attribute shift (calibration
 * slope 1.0478), so one measured delta plus a couple of ±1 refinement passes
 * (clamping distorts the linearity at the 25/99 edges) lands within a point
 * of the tier target while preserving the archetype's relative shape.
 * Ceilings are re-seeded to attribute + 8.
 *
 * @param {object} player - player-shaped object (attributes/attributeCaps/position)
 * @param {string} archetypeKey - ARCHETYPE_SEEDS key
 * @param {string} talentKey - TALENT_TIERS key (default 'starter')
 * @param {object} [opts]
 * @param {boolean} [opts.preserveVitals=false] - keep the player's authored
 *   position/height instead of the template's (save-time auto-apply path)
 * @returns {{ overall: number, tier: object } | null} achieved overall +
 *   tier, or null when the archetype seed is unknown
 */
export function applyArchetypeToPlayer(player, archetypeKey, talentKey = 'starter', { preserveVitals = false } = {}) {
  const seed = ARCHETYPE_SEEDS[archetypeKey]
  if (!seed || !player) return null

  if (!preserveVitals) {
    if (seed.position) player.position = seed.position
    if (seed.heightInches) {
      player.heightInches = seed.heightInches
      player.height_inches = seed.heightInches
    }
  }

  player.attributes = player.attributes ?? {}
  player.attributeCaps = player.attributeCaps ?? {}
  for (const cat of Object.keys(CANONICAL_ATTRIBUTES)) {
    player.attributes[cat] = player.attributes[cat] ?? {}
    for (const key of CANONICAL_ATTRIBUTES[cat]) {
      player.attributes[cat][key] = ARCHETYPE_SEED_BASELINE
    }
  }
  for (const [cat, map] of Object.entries(seed.attrs ?? {})) {
    for (const [key, val] of Object.entries(map)) {
      if (player.attributes[cat] && key in player.attributes[cat]) player.attributes[cat][key] = val
    }
  }

  const tier = TALENT_TIERS.find((t) => t.key === talentKey) ?? TALENT_TIERS[2]
  const shiftAll = (delta) => {
    if (!delta) return
    for (const cat of Object.keys(CANONICAL_ATTRIBUTES)) {
      for (const key of CANONICAL_ATTRIBUTES[cat]) {
        const v = player.attributes[cat][key] ?? ARCHETYPE_SEED_BASELINE
        player.attributes[cat][key] = Math.max(25, Math.min(99, v + delta))
      }
    }
  }
  const measured = deriveOverallFromAttributes(player.attributes, player.position)
  shiftAll(Math.round((tier.target - measured) / 1.0478))
  for (let i = 0; i < 2; i++) {
    const now = deriveOverallFromAttributes(player.attributes, player.position)
    if (Math.abs(now - tier.target) <= 1) break
    shiftAll(now < tier.target ? 1 : -1)
  }

  for (const cat of Object.keys(CANONICAL_ATTRIBUTES)) {
    player.attributeCaps[cat] = player.attributeCaps[cat] ?? {}
    for (const key of CANONICAL_ATTRIBUTES[cat]) {
      player.attributeCaps[cat][key] = Math.min(99, player.attributes[cat][key] + 8)
    }
  }

  return { overall: deriveOverallFromAttributes(player.attributes, player.position), tier }
}
