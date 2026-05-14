// =============================================================================
// freeAgentInterest.js
// =============================================================================
// Thin UI-side wrapper over FreeAgentDecisionService.scoreOfferForPlayer so
// the offer modal / FA cards can show the user's current standing with a
// prospect as they tweak salary and years. Same scoring math the engine
// uses at resolution time — keeps preview parity with the real outcome.
// =============================================================================

import { scoreOfferForPlayer } from '@/engine/ai/FreeAgentDecisionService'

// Score buckets, ordered high → low. The 30 cutoff matches the engine's
// "below this the player just won't sign" threshold in pickBestOffer.
const INTEREST_LEVELS = [
  { min: 75, label: 'EAGER', color: '#10b981', hint: 'Strong fit — likely to sign here over any competing offer at these terms.' },
  { min: 60, label: 'INTERESTED', color: '#22c55e', hint: 'Solid offer. You\'re a real option for this player.' },
  { min: 45, label: 'OPEN', color: '#eab308', hint: 'On the radar. A small bump in salary or a fit upgrade could close it.' },
  { min: 30, label: 'LUKEWARM', color: '#f97316', hint: 'In play but unlikely. Boost the offer to move the needle.' },
  { min: 0, label: 'NOT INTERESTED', color: '#ef4444', hint: 'Below the player\'s minimum threshold — they\'ll pass at these terms.' },
]

export function interestLevelForScore(score) {
  if (score == null) return null
  for (const level of INTEREST_LEVELS) {
    if (score >= level.min) return level
  }
  return INTEREST_LEVELS[INTEREST_LEVELS.length - 1]
}

/**
 * Score a hypothetical user offer against a player using the exact same
 * function the engine calls at FA resolution. Returns 0–100, or null if the
 * inputs aren't ready yet.
 *
 * @param {object} player - full player record (must include motivations)
 * @param {{ salary: number, years: number }} offer
 * @param {object} userContext - { team, roster, coach, isIncumbent, hasChampionship }
 */
export function scoreUserOffer(player, { salary, years }, userContext) {
  if (!player || !salary || !years || !userContext?.team) return null
  return scoreOfferForPlayer(
    player,
    { teamId: userContext.team.id, salary, years, isUserOffer: true },
    {
      team: userContext.team,
      teamRoster: userContext.roster ?? [],
      coach: userContext.coach ?? null,
      isIncumbent: !!userContext.isIncumbent,
      hasChampionship: !!userContext.hasChampionship,
    }
  )
}
