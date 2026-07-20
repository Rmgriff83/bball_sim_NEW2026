// =============================================================================
// positions.js — shared position helpers for matchups & eligibility
// =============================================================================
// Pure / import-free. The five basketball positions are ordered PG→C; a player's
// eligibility to guard a position is derived from primary/secondary position and
// a coarse position GROUP (guard / wing / big). Used by the defensive-matchup
// system (and available for the future user-matchup-override UI's validation).
// =============================================================================

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

export const POSITION_INDEX = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 }

/**
 * Coarse position group. A defender may guard within their own group:
 *   guard = PG/SG, wing = SF/PF, big = C.
 * (Deliberate game-design simplification — real defenses cross-match more.)
 */
export function positionGroup(pos) {
  if (pos === 'PG' || pos === 'SG') return 'guard'
  if (pos === 'SF' || pos === 'PF') return 'wing'
  if (pos === 'C') return 'big'
  return 'wing'
}

/** Slot distance between two positions (PG↔C = 4). Unknown → midpoint. */
export function positionDistance(a, b) {
  const ia = POSITION_INDEX[a] ?? 2
  const ib = POSITION_INDEX[b] ?? 2
  return Math.abs(ia - ib)
}

function defenderPositions(defender) {
  const primary = defender?.position ?? 'SF'
  const secondary = defender?.secondary_position ?? defender?.secondaryPosition ?? null
  const tertiary = defender?.tertiary_position ?? defender?.tertiaryPosition ?? null
  return { primary, secondary, tertiary }
}

/**
 * Can `defender` guard an offensive player at `offPos`? True if the defender's
 * primary, secondary, OR tertiary position matches exactly, or they share a
 * position group.
 */
export function eligibleToGuard(defender, offPos) {
  const { primary, secondary, tertiary } = defenderPositions(defender)
  if (primary === offPos || secondary === offPos || tertiary === offPos) return true
  return positionGroup(primary) === positionGroup(offPos)
}

export default { POSITIONS, POSITION_INDEX, positionGroup, positionDistance, eligibleToGuard }
