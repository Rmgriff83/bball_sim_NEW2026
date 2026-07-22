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
  EXPECTATION_ORDER,
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

// -----------------------------------------------------------------------------
// Roster-derived expectations (Custom Roster support, 2026-07). A static
// per-team mandate stops making sense when users author arbitrary rosters —
// a stacked roster on a "rebuild" franchise should carry contender pressure
// and vice versa. Strength = mean overall of the TOP 8 rated players
// (rotation quality; bench fillers don't drag it), thresholds calibrated to
// the same 68–82 avgOverall scale the AI's analyzeTeamDirection uses. A very
// young top-5 core (≤ 23.5 avg age) shifts DOWN one tier — juggernauts still
// developing get a runway instead of an instant 56-win bar; there is no
// upward age shift because the season-end ratchet already rewards success.
// -----------------------------------------------------------------------------

const _rating = (p) => Number(p?.overallRating ?? p?.overall_rating) || 0;
const _age = (p) => Number(p?.age) || 0;

/** Map a roster's strength (+ core age) to an expectation tier. */
export function deriveExpectationTierFromRoster(roster) {
  const rated = (Array.isArray(roster) ? roster : [])
    .filter((p) => p && !(p.isRetired || p.is_retired) && _rating(p) > 0)
    .sort((a, b) => _rating(b) - _rating(a));
  if (!rated.length) return 'rebuild';

  const top8 = rated.slice(0, 8);
  const strength = top8.reduce((s, p) => s + _rating(p), 0) / top8.length;

  let tier;
  if (strength >= 79) tier = 'championship';
  else if (strength >= 76) tier = 'contender';
  else if (strength >= 73) tier = 'playoffs';
  else if (strength >= 70) tier = 'develop';
  else tier = 'rebuild';

  const core = rated.slice(0, 5).filter((p) => _age(p) > 0);
  if (core.length) {
    const coreAge = core.reduce((s, p) => s + _age(p), 0) / core.length;
    if (coreAge <= 23.5) {
      const rank = expectationRank(tier);
      if (rank > 0) tier = EXPECTATION_ORDER[rank - 1];
    }
  }
  return tier;
}

/** Roster-derived expectation in the initOwnerExpectation shape. */
export function deriveOwnerExpectationFromRoster(roster) {
  const tier = deriveExpectationTierFromRoster(roster);
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
