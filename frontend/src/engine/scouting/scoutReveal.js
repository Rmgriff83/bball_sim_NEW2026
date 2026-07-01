// =============================================================================
// scoutReveal.js — the pure "spend one scout action → reveal" computation.
// =============================================================================
// Extracted verbatim from ScoutingView.scoutPlayer so the Scouting screen AND the
// live rookie draft reveal rookie attributes with IDENTICAL logic, including the
// hired-scout perk bonuses (extra reveals, badge reveal, morale reveal) gated by
// the scouting-facility level.
//
// Pure (no I/O / no Vue). Uses Math.random() — same as before; only ever called
// from a user click on the main thread.
// =============================================================================

import { SCOUTABLE_ATTRIBUTES } from '@/engine/data/attributeSchema'

const TOTAL_SCOUT_ACTIONS = 4 // 4 scout actions to fully reveal a player
export const BASE_REVEAL_COUNT = Math.ceil(SCOUTABLE_ATTRIBUTES.length / TOTAL_SCOUT_ACTIONS)
export const PERK_REVEAL_COUNT = Math.ceil(SCOUTABLE_ATTRIBUTES.length / 3) // 33% per action

/** True when the hired scout has `perkKey` AND the scouting facility meets its level gate. */
export function isScoutPerkActive(scout, facilityLevel, perkKey) {
  const perk = scout?.perks?.find((p) => p.key === perkKey)
  return !!perk && (facilityLevel ?? 1) >= perk.requiredLevel
}

/**
 * Compute the result of one scout action against a prospect's current reveal state.
 *
 * @param {object} params
 * @param {string[]} [params.revealedAttributes] - already-revealed attr keys
 * @param {object|null} [params.scout] - hired scout record (campaign.settings.scout)
 * @param {number} [params.facilityLevel] - scouting facility level (team.facilities.scouting)
 * @param {object} [params.existing] - existing scoutedPlayers[id] ({ badgesRevealed, moraleRevealed })
 * @param {string[]} [params.attributes] - the canonical attribute list (defaults to SCOUTABLE)
 * @returns {{ toReveal, newRevealed, badgesRevealed, moraleRevealed, badgesJustRevealed, hitFullScout }}
 *   `toReveal` is empty when there's nothing left to reveal.
 */
export function computeScoutReveal({
  revealedAttributes = [],
  scout = null,
  facilityLevel = 1,
  existing = {},
  attributes = SCOUTABLE_ATTRIBUTES,
} = {}) {
  const revealed = Array.isArray(revealedAttributes) ? revealedAttributes : []
  const unrevealed = attributes.filter((a) => !revealed.includes(a))

  if (unrevealed.length === 0) {
    return {
      toReveal: [],
      newRevealed: revealed,
      badgesRevealed: existing.badgesRevealed === true,
      moraleRevealed: existing.moraleRevealed === true,
      badgesJustRevealed: false,
      hitFullScout: true,
    }
  }

  // Randomly select attributes — 33% per action with extra_reveals, else 25%.
  const revealCount = isScoutPerkActive(scout, facilityLevel, 'extra_reveals')
    ? PERK_REVEAL_COUNT
    : BASE_REVEAL_COUNT
  const toReveal = []
  const pool = [...unrevealed]
  const count = Math.min(revealCount, pool.length)
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * pool.length)
    toReveal.push(pool.splice(idx, 1)[0])
  }

  const newRevealed = [...revealed, ...toReveal]
  const hadBadgesRevealed = existing.badgesRevealed === true
  const badgesRevealed =
    hadBadgesRevealed || (isScoutPerkActive(scout, facilityLevel, 'badge_reveal') && Math.random() < 0.35)
  const moraleRevealed =
    existing.moraleRevealed === true ||
    (isScoutPerkActive(scout, facilityLevel, 'morale_reveal') && Math.random() < 0.35)

  return {
    toReveal,
    newRevealed,
    badgesRevealed,
    moraleRevealed,
    badgesJustRevealed: !hadBadgesRevealed && badgesRevealed,
    hitFullScout: newRevealed.length >= attributes.length,
  }
}
