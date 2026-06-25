// =============================================================================
// OwnerExpectationService.js
// =============================================================================
// The owner's expectation is no longer static — it RATCHETS UP after a season
// the team exceeds it. This service owns that per-campaign state
// (`campaign.settings.ownerExpectation = { tier, expectedWins, lastEvaluatedYear }`)
// and the season-end update rule:
//
//   • Met or under-performed   → no change (expectations only ever go up).
//   • Mildly exceeded          → nudge the WIN TARGET up a few, same tier.
//   • Blew past it (reached a   → promote the TIER to match the actual result
//     higher tier's threshold)    (possibly multiple levels in one offseason).
//
// `getEffectiveExpectation` is the single accessor every consumer uses; it falls
// back to the owner's static baseline when no stored value exists, so existing
// campaigns work with no migration.
// =============================================================================

import {
  EXPECTATION_WINS,
  EXPECTATION_LABEL,
  expectationRank,
  nextExpectationTier,
  tierForWins,
} from '../data/owners';

// Hard ceiling on the expected-win target at the top tier so a fluke 70-win
// season doesn't saddle the GM with an impossible bar. Tunable.
const MAX_EXPECTED = 62;

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Baseline expectation from the owner's static data. */
export function initOwnerExpectation(owner) {
  const tier = owner?.expectation ?? 'playoffs';
  return { tier, expectedWins: EXPECTATION_WINS[tier] ?? EXPECTATION_WINS.playoffs };
}

/**
 * The live expectation for a campaign: the stored dynamic value if present, else
 * the owner's static baseline. Always returns { tier, expectedWins, label }.
 */
export function getEffectiveExpectation(campaign, owner) {
  const stored = campaign?.settings?.ownerExpectation;
  const base = stored && stored.tier
    ? { tier: stored.tier, expectedWins: stored.expectedWins ?? EXPECTATION_WINS[stored.tier] }
    : initOwnerExpectation(owner);
  return { ...base, label: EXPECTATION_LABEL[base.tier] ?? base.tier };
}

/**
 * An owner object with its `expectation` tier overridden to the live tier, so
 * tier-keyed consumers (sub-task switch, mandate map, win-now check) read the
 * dynamic value transparently.
 */
export function effectiveOwner(owner, tier) {
  return { ...owner, expectation: tier };
}

/**
 * Raise the bar after a season. Pure.
 *
 * @param {{tier:string, expectedWins:number}} current
 * @param {number} actualWins
 * @param {{ maxExpected?: number }} [opts]
 * @returns {{ tier:string, expectedWins:number, raised:boolean }}
 */
export function updateOwnerExpectation(current, actualWins, opts = {}) {
  const maxExpected = opts.maxExpected ?? MAX_EXPECTED;
  const tier = current?.tier ?? 'playoffs';
  const expectedWins = current?.expectedWins ?? (EXPECTATION_WINS[tier] ?? EXPECTATION_WINS.playoffs);
  const wins = actualWins ?? 0;

  const over = wins - expectedWins;
  // Ratchet up only — meeting or missing the bar leaves it untouched.
  if (over <= 0) return { tier, expectedWins, raised: false };

  const resultTier = tierForWins(wins);
  const promoted = expectationRank(resultTier) > expectationRank(tier);
  const newTier = promoted ? resultTier : tier;

  const next = nextExpectationTier(newTier);
  const ceiling = next ? EXPECTATION_WINS[next] - 1 : maxExpected;

  // Promotion matches the result (capped just below the next tier); an in-tier
  // overachievement nudges the target up gently (a 1-win beat is a no-op).
  const target = promoted ? Math.min(wins, ceiling) : expectedWins + Math.floor(over / 2);

  const floor = Math.max(EXPECTATION_WINS[newTier] ?? 0, expectedWins);
  const newExpectedWins = _clamp(target, floor, ceiling);

  return {
    tier: newTier,
    expectedWins: newExpectedWins,
    raised: newTier !== tier || newExpectedWins !== expectedWins,
  };
}

/**
 * Raise the bar DURING a season based on projected pace. Pure, promote-only:
 * once enough games are in, project the full-season win total and bump the TIER
 * if that projection clears a higher one. Never nudges within a tier and never
 * lowers — those stay the season-end concern of updateOwnerExpectation.
 *
 * @param {{tier:string, expectedWins:number}} current
 * @param {{ wins:number, losses:number, totalGames?:number, minGp?:number, maxExpected?:number }} opts
 * @returns {{ tier:string, expectedWins:number, raised:boolean }}
 */
export function maybeRaiseExpectationMidSeason(current, opts = {}) {
  const totalGames = opts.totalGames ?? 82;
  const minGp = opts.minGp ?? 20;
  const maxExpected = opts.maxExpected ?? MAX_EXPECTED;

  const tier = current?.tier ?? 'playoffs';
  const expectedWins = current?.expectedWins ?? (EXPECTATION_WINS[tier] ?? EXPECTATION_WINS.playoffs);

  const wins = opts.wins ?? 0;
  const losses = opts.losses ?? 0;
  const gp = wins + losses;
  if (gp < minGp) return { tier, expectedWins, raised: false };

  const projected = _clamp(Math.round((wins / gp) * totalGames), 0, totalGames);
  const resultTier = tierForWins(projected);
  if (expectationRank(resultTier) <= expectationRank(tier)) {
    return { tier, expectedWins, raised: false };
  }

  const next = nextExpectationTier(resultTier);
  const ceiling = next ? EXPECTATION_WINS[next] - 1 : maxExpected;
  const floor = Math.max(EXPECTATION_WINS[resultTier] ?? 0, expectedWins);
  const newExpectedWins = _clamp(Math.min(projected, ceiling), floor, ceiling);

  return { tier: resultTier, expectedWins: newExpectedWins, raised: true };
}
