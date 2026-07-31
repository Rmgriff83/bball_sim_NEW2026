// =============================================================================
// ResignValuationService.js
// =============================================================================
// In-season re-signing valuation. A player's re-sign ASK is anchored to their
// OPEN-MARKET value (what other teams would pay), with a motivation-bounded floor
// below which they won't re-sign, an incumbent (Bird-rights) premium that lets
// the current team pay above market + an extra year, and a "walk risk" so an
// unhappy / disloyal player can still decline a fair offer to test free agency.
//
// Reuses the production-adjusted market formula (AITradeService) and the
// motivation engine (MotivationService). vet-min is inlined (rather than imported
// from AIContractService) to keep this dependency one-directional — AIContractService
// imports playerMarketValue from here.
// =============================================================================

import { calculateRetentionScore, recalculateSatisfaction } from './MotivationService';
import { baseSalaryForRating, veteranMinSalary as vetMin, maxSalary } from '../data/salaryScale';

// --- Tunables ---------------------------------------------------------------
export const MAX_DISCOUNT = 0.25;        // most a happy player will shave off market
export const INCUMBENT_PREMIUM = 1.50;   // Bird-rights ceiling above market (league-max capped)
export const INCUMBENT_MAX_YEARS = 5;    // incumbent extra year vs FA's 4

function _num(v, d = 0) {
  return typeof v === 'number' && !Number.isNaN(v) ? v : d;
}
function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// The smooth overall-rating → base-salary curve now lives in data/salaryScale.js
// (imported as baseSalaryForRating) so league generation, aging, and valuation
// all share one calibrated curve.

// Per-game production line (returns null below a trustworthy sample).
function _perGame(stats) {
  if (!stats) return null;
  const gp = _num(stats.gamesPlayed ?? stats.games_played, 0);
  if (gp < 5) return null;
  return {
    ppg: _num(stats.ppg ?? (stats.points != null ? stats.points / gp : 0)),
    rpg: _num(stats.rpg ?? (stats.rebounds != null ? stats.rebounds / gp : 0)),
    apg: _num(stats.apg ?? (stats.assists != null ? stats.assists / gp : 0)),
  };
}

// Production (ppg + 0.6·apg + 0.4·rpg) a player at this rating typically puts up.
// Beating it earns a real raise (up to +45%), falling well short trims pay (to
// -15%). Calibrated to TYPICAL lines so an average season ≈ base salary and only
// genuinely strong play pushes the number up.
function _expectedProduction(overall) {
  if (overall >= 90) return 35;
  if (overall >= 85) return 28;
  if (overall >= 80) return 22;
  if (overall >= 75) return 17;
  if (overall >= 70) return 12;
  return 8;
}

/**
 * Open-market salary other teams would pay this player: a smooth rating-based
 * base, scaled by how well they're ACTUALLY producing this season, then an age
 * factor, floored at the veteran minimum.
 */
export function playerMarketValue(player, stats = null) {
  const overall = _num(player?.overallRating ?? player?.overall_rating, 70);
  const age = _num(player?.age, 27);
  let value = baseSalaryForRating(overall);

  const pg = _perGame(stats ?? player?.stats ?? null);
  if (pg) {
    const production = pg.ppg + pg.apg * 0.6 + pg.rpg * 0.4;
    const ratio = _clamp(production / Math.max(1, _expectedProduction(overall)), 0.85, 1.45);
    value *= ratio;
  }

  if (age <= 25) value *= 1.10;        // youth premium
  else if (age >= 34) value *= 0.72;   // steep late-career discount
  else if (age >= 32) value *= 0.85;
  // No contract exceeds the league max (25/30/35% of cap by experience), so even
  // a player producing well above his rating can't ask beyond it.
  const experience = _num(player?.careerSeasons ?? player?.career_seasons, Math.max(0, age - 19));
  return _clamp(Math.round(value), vetMin(player), maxSalary(experience));
}

// How much of a discount off market the player is willing to take to re-sign:
// driven by how HAPPY they are in the non-money dimensions, gated by how much
// they care about money. Happy + low-money → up to MAX_DISCOUNT; money-motivated → ~0.
function _discountWillingness(player, context, marketValue) {
  const m = player?.motivations;
  if (!m) return 0;
  recalculateSatisfaction(player, { ...context, expectedSalary: marketValue, offerSalary: marketValue });
  const dims = ['winning', 'legacy', 'loyalty', 'role', 'starPairing', 'coaching', 'market'];
  let wsum = 0;
  let w = 0;
  for (const k of dims) {
    if (m[k]) {
      wsum += m[k].weight * m[k].satisfaction;
      w += m[k].weight;
    }
  }
  const happiness = w > 0 ? wsum / w : 0.5; // 0..1
  const moneyWeight = m.money?.weight ?? 0.5;
  const moneyDamp = _clamp(1.2 - moneyWeight, 0, 1); // money-motivated → small damp → ~no discount
  return _clamp(MAX_DISCOUNT * happiness * moneyDamp, 0, MAX_DISCOUNT);
}

// Retention ceiling (<100) for unhappy / disloyal players, so even a maxed offer
// leaves a chance they walk to test free agency.
function _retentionCeiling(player, context, marketValue) {
  const m = player?.motivations;
  if (!m) return 95;
  recalculateSatisfaction(player, { ...context, expectedSalary: marketValue, offerSalary: marketValue });
  const role = m.role?.satisfaction ?? 0.6;
  const winning = m.winning?.satisfaction ?? 0.5;
  const coaching = m.coaching?.satisfaction ?? 0.5;
  const loyaltySat = m.loyalty?.satisfaction ?? 0.5;
  const situation = role * 0.4 + winning * 0.4 + coaching * 0.2; // 0..1
  let ceiling = 55 + situation * 40;       // unhappy ~67, happy ~91
  ceiling += (loyaltySat - 0.5) * 10;      // loyal +, disloyal -
  return _clamp(Math.round(ceiling), 45, 97);
}

/**
 * The player's re-sign ask. Returns the open-market value, the floor they'll
 * accept (requiredSalary), a fair default offer, the incumbent (Bird) ceiling,
 * and the max contract length the incumbent may offer.
 */
export function resignAsk(player, context = {}) {
  const marketValue = playerMarketValue(player, context.stats ?? player?.stats ?? null);
  const discountWillingness = _discountWillingness(player, context, marketValue);
  const requiredSalary = Math.max(vetMin(player), Math.round(marketValue * (1 - discountWillingness)));
  // Bird rights let the incumbent pay a premium, but never past the league max.
  const experience = _num(player?.careerSeasons ?? player?.career_seasons, Math.max(0, _num(player?.age, 27) - 19));
  const incumbentMax = Math.min(maxSalary(experience), Math.round(marketValue * INCUMBENT_PREMIUM));
  return {
    marketValue,
    requiredSalary,
    recommendedSalary: Math.round(marketValue),
    incumbentMax,
    maxYears: INCUMBENT_MAX_YEARS,
    discountWillingness,
  };
}

/**
 * Evaluate a concrete re-sign offer. Returns a retention % (0-100) for the
 * accept/decline roll, plus the ask figures for display.
 *
 * @param {object} player
 * @param {{ salary:number, years:number }} offer
 * @param {object} context - team/season context (+ optional `stats`)
 */
export function evaluateResignOffer(player, offer = {}, context = {}) {
  const ask = resignAsk(player, context);
  const { marketValue, requiredSalary, incumbentMax } = ask;
  const salary = _num(offer.salary, ask.recommendedSalary);

  // Below the floor → won't re-sign. Retention collapses with the shortfall.
  if (salary < requiredSalary) {
    const shortfall = _clamp((requiredSalary - salary) / Math.max(1, requiredSalary), 0, 1);
    const retention = Math.round(Math.max(0, 30 * (1 - shortfall * 2)));
    return { accepts: false, retention, requiredSalary, marketValue, incumbentMax, reason: 'below_ask' };
  }

  // At/above the floor: the happiness blend, with money satisfaction now real.
  let base = calculateRetentionScore(player, { ...context, expectedSalary: marketValue }, salary);
  if (salary > marketValue) {
    const over = _clamp((salary - marketValue) / Math.max(1, incumbentMax - marketValue), 0, 1);
    // Generosity / Bird-premium bump — worth up to +15 at the (now 1.5×
    // market, league-max capped) incumbent ceiling, so a big overpay can
    // genuinely flip an on-the-fence star.
    base += over * 15;
  }

  const ceiling = _retentionCeiling(player, context, marketValue);
  const retention = Math.round(_clamp(base, 0, ceiling));
  return {
    accepts: retention >= 50,
    retention,
    requiredSalary,
    marketValue,
    incumbentMax,
    reason: salary >= marketValue ? 'fair' : 'discount',
  };
}
