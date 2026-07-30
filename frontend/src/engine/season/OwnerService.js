// =============================================================================
// OwnerService.js
// =============================================================================
// Pure logic for the team owner's satisfaction with the user-GM. Part 1 gauges
// satisfaction from the team's record vs the owner's expected wins, blending the
// current season with last season and dampening swings by the owner's patience.
// No DB/store imports — unit-testable in isolation; the Owner tab wires real
// data in. Part 2 will drive the contract-end evaluation from this.
// =============================================================================

import { expectedWinsForExpectation } from '../data/owners';
import { STAR_OVERALL } from './OwnerSubtaskService';

const TOTAL_GAMES = 82;

// Injury relief: losing a star (overall ≥ STAR_OVERALL, or a contract-signing star)
// for a big chunk of the season softens — never raises — the owner's win bar that
// year. Tunable.
const INJURY_RELIEF_PER_STAR = 8;
const INJURY_RELIEF_CAP = 16;
const INJURY_MISSED_THRESHOLD = 0.4; // a star must miss ~40%+ of the season to count

function _overallOf(p) {
  return p?.overallRating ?? p?.overall ?? p?.rating ?? 0;
}

// Last-season playoff depth -> satisfaction bonus (wins-equivalent). seasonHistory
// may not always carry `playoffResult`; the caller can also pass `champion` /
// `playoffSeed` / `madePlayoffs` which we fall back to.
const PLAYOFF_ADJ = {
  champion: 18,
  finals: 12,
  conf_finals: 7,
  round2: 4,
  round1: 1,
};

// A championship fully satisfies the record/wins category regardless of the
// regular-season win total — a title trumps the win count.
const CHAMPION_FLOOR = 100;

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Wins-equivalent relief for losing star talent to injury. Returns a number of
 * "expected wins" to discount from the CURRENT-season bar (>= 0, capped). Only ever
 * helps the GM. Detects a long absence from the current-year seasonHistory games
 * played and/or a live season-ending injury (so it also works mid-season before the
 * season is archived).
 *
 * @param {object} params
 * @param {Array}  params.roster - current user roster (player objects)
 * @param {number} params.teamGames - games the team has played this season (≈82 at end)
 * @param {string[]} [params.starPlayerIdsAtSign] - stars the GM had at contract sign
 * @param {number|null} [params.currentYear] - season year (to read the right history entry)
 * @param {number} [params.starThreshold] - overall rating that defines a "star"
 * @returns {number} wins-equivalent relief, 0..INJURY_RELIEF_CAP
 */
export function injuryReliefWins({ roster = [], teamGames = 0, starPlayerIdsAtSign = [], currentYear = null, starThreshold = STAR_OVERALL } = {}) {
  const games = teamGames > 0 ? teamGames : TOTAL_GAMES;
  const signSet = new Set((Array.isArray(starPlayerIdsAtSign) ? starPlayerIdsAtSign : []).map(String));
  let relief = 0;

  for (const p of (Array.isArray(roster) ? roster : [])) {
    const isStar = _overallOf(p) >= starThreshold || signSet.has(String(p?.id));
    if (!isStar) continue;

    // Games played this season (from the current-year seasonHistory entry, if any).
    const hist = Array.isArray(p?.seasonHistory) ? p.seasonHistory : [];
    const entry = currentYear != null ? hist.find((h) => (h.year ?? null) === currentYear) : null;
    const gp = entry?.stats?.gamesPlayed;

    const injured = p?.isInjured === true || p?.is_injured === true;
    const sev = p?.injuryDetails?.severity ?? p?.injury_details?.severity ?? null;
    const daysOut = p?.injuryDetails?.days_remaining ?? p?.injury_details?.days_remaining ?? 0;
    const longInjury = injured && (sev === 'season_ending' || daysOut > 120);

    let missedFrac = 0;
    if (gp != null) {
      missedFrac = _clamp(1 - gp / games, 0, 1);
    } else if (injured) {
      // No recorded games this season and currently hurt → treat as a big absence.
      missedFrac = longInjury ? 1 : 0.6;
    }
    // A live season-ending injury floors the miss so the meter reacts mid-season too.
    if (longInjury) missedFrac = Math.max(missedFrac, 0.5);

    if (missedFrac >= INJURY_MISSED_THRESHOLD) {
      relief += Math.round(INJURY_RELIEF_PER_STAR * missedFrac);
    }
  }

  return Math.min(INJURY_RELIEF_CAP, relief);
}

/**
 * Map a 0-100 satisfaction value to a label + color (green→red bands, same
 * spirit as the fatigue/attribute color helpers).
 */
export function satisfactionDisplay(value) {
  if (value >= 75) return { label: 'Thrilled', color: '#22c55e' };
  if (value >= 58) return { label: 'Pleased', color: '#84cc16' };
  if (value >= 42) return { label: 'Content', color: '#f59e0b' };
  if (value >= 25) return { label: 'Concerned', color: '#f97316' };
  return { label: 'On the hot seat', color: '#ef4444' };
}

/**
 * Compute owner satisfaction (0-100) with the GM's job.
 * @param {object} params
 * @param {object} params.owner - { expectation, patience }
 * @param {number} [params.currentWins]
 * @param {number} [params.currentLosses]
 * @param {object|null} [params.lastSeason] - most recent team.seasonHistory entry:
 *   { wins, losses, playoffResult?, champion?, playoffSeed?, madePlayoffs? }
 * @param {number} [params.expectedWins] - live expected-win target (defaults to the
 *   owner's static tier baseline; callers pass the dynamic value when available)
 * @returns {{ value: number, label: string, color: string, expectedWins: number }}
 */
export function computeOwnerSatisfaction({ owner, currentWins = 0, currentLosses = 0, lastSeason = null, expectedWins = null, currentPlayoff = null, injuryRelief = 0 } = {}) {
  const expected = expectedWins ?? expectedWinsForExpectation(owner?.expectation);
  const patience = _clamp(owner?.patience ?? 3, 1, 5);
  const winNow = ['championship', 'contender', 'playoffs'].includes(owner?.expectation);

  // Lower THIS season's win bar when stars were lost to injury — the owner judges a
  // depleted roster more forgivingly. Only softens (never raises) the bar, and only
  // the current season (the displayed mandate `expected` is unchanged).
  const expectedCurrent = Math.max(0, expected - Math.max(0, injuryRelief || 0));

  // --- Current season: projected wins vs expectation, ramped to full weight by
  //     mid-season so an early hot/cold streak doesn't whipsaw the meter. ---
  const gp = (currentWins ?? 0) + (currentLosses ?? 0);
  let current = 0;
  if (gp > 0) {
    const projected = (currentWins / gp) * TOTAL_GAMES;
    const weight = Math.min(1, gp / (TOTAL_GAMES / 2));
    current = (projected - expectedCurrent) * 1.4 * weight;

    // Current-season playoff outcome (known once the postseason is done) lifts the
    // record component the same way last season's does — deep runs offset a soft
    // regular-season win total in the very year they happen.
    if (currentPlayoff) {
      if (currentPlayoff.champion) {
        current += PLAYOFF_ADJ.champion;
      } else if (currentPlayoff.playoffResult && PLAYOFF_ADJ[currentPlayoff.playoffResult] != null) {
        current += PLAYOFF_ADJ[currentPlayoff.playoffResult];
      } else {
        const made = currentPlayoff.playoffSeed != null || currentPlayoff.madePlayoffs === true;
        if (made) current += 3;
        else if (winNow) current -= 10;
      }
    }
  }

  // --- Last season: record vs expectation + playoff outcome. ---
  let last = 0;
  if (lastSeason) {
    last = ((lastSeason.wins ?? 0) - expected) * 1.0;
    if (lastSeason.champion) {
      last += PLAYOFF_ADJ.champion;
    } else if (lastSeason.playoffResult && PLAYOFF_ADJ[lastSeason.playoffResult] != null) {
      last += PLAYOFF_ADJ[lastSeason.playoffResult];
    } else {
      const made = lastSeason.playoffSeed != null || lastSeason.madePlayoffs === true;
      if (made) last += 3;
      else if (winNow) last -= 10; // a win-now owner hates missing the playoffs
    }
  }

  // Blend, recency-weighted toward the current season, renormalized to whichever
  // components exist — so a first-season campaign (no last season) judges the
  // current season at full weight rather than diluting it. Then dampen by
  // patience: patient owners swing less from neutral, impatient owners more.
  const hasCurrent = gp > 0;
  const hasLast = !!lastSeason;
  let raw = 0;
  if (hasCurrent && hasLast) raw = current * 0.6 + last * 0.4;
  else if (hasCurrent) raw = current;
  else if (hasLast) raw = last;
  const damp = 1 - (patience - 3) * 0.12; // p1→1.24, p3→1.0, p5→0.76
  let value = _clamp(Math.round(50 + raw * damp), 0, 100);

  // Winning it all fully satisfies the wins category — applies to the title season
  // itself (currentPlayoff) and the immediate post-title window before the next
  // season tips off (reigning champ, no games yet). Once the defense season starts,
  // the floor lifts and the normal blend (with last season's +18 bonus) governs.
  const reigningPreSeason = gp === 0 && lastSeason?.champion === true;
  if (currentPlayoff?.champion === true || reigningPreSeason) {
    value = Math.max(value, CHAMPION_FLOOR);
  }

  const { label, color } = satisfactionDisplay(value);
  return { value, label, color, expectedWins: expected };
}

// --- Cap-mandate breach wrath (apron economy) --------------------------------
// Spending past the owner's mandated payroll line is allowed, but it directly
// angers the owner beyond the failed under_cap sub-task. Scaled by severity and
// by how money-conscious the owner is.
const CAP_BREACH_BASE = 8;

/**
 * Satisfaction penalty (a NEGATIVE number, or 0) for payroll above the owner's
 * mandated line. Severity 1 = over the mandate; severity 2 = ALSO over the
 * second apron when the mandate sits below it. Scaled by moneyConsciousness/3,
 * so a tightfisted owner (5) breached past apron 2 costs ~27 points while a
 * spend-happy title owner (1) barely over loses ~3.
 *
 * @param {object} params
 * @param {number} params.payroll
 * @param {object} params.capLine - { amount } from capLineForExpectation
 * @param {object} [params.capNumbers] - { secondApron } for the severity-2 check
 * @param {number} [params.moneyConsciousness] - owner 1-5 (default 3)
 * @returns {number} 0 or a negative penalty
 */
export function capBreachPenalty({ payroll = 0, capLine = null, capNumbers = null, moneyConsciousness = 3 } = {}) {
  const line = capLine?.amount ?? 0;
  if (!(line > 0) || !(payroll > line)) return 0;
  const secondApron = capNumbers?.secondApron ?? 0;
  const severity = secondApron > line && payroll > secondApron ? 2 : 1;
  const mc = _clamp(moneyConsciousness ?? 3, 1, 5);
  return -Math.round(CAP_BREACH_BASE * severity * (mc / 3));
}

// The owner judges the GM on overall wins (60%) and concrete sub-tasks (40%).
export const WINS_WEIGHT = 0.6;
export const SUBTASK_WEIGHT = 0.4;

// Combined score at/above this means the owner extends the contract at term-end.
export const EXTEND_THRESHOLD = 50;

// Neutral baseline the sub-task contribution starts from early in a contract.
const NEUTRAL_SATISFACTION = 50;

/**
 * Combine the record-based satisfaction (Part 1) with the sub-task score into the
 * single 0-100 value the Owner tab meter and the contract-end decision use.
 *
 * The sub-task contribution is TIME-WEIGHTED by how far into the GM contract we
 * are: at the start of a contract the time-needing sub-tasks (acquire picks, hire
 * staff, add badges, produce All-Stars) are all unmet through no fault of the GM,
 * so we hold the sub-task contribution at neutral (50) and let it ease toward the
 * real score as the contract progresses. Patience controls how fast it ramps — a
 * patient owner stays lenient longer, a ruthless owner starts judging sooner. At
 * `contractProgress = 1` (the contract-end evaluation, which omits the param) the
 * full real sub-task score applies.
 *
 * @param {object} params
 * @param {object} params.owner
 * @param {number} [params.currentWins]
 * @param {number} [params.currentLosses]
 * @param {object|null} [params.lastSeason]
 * @param {number} [params.subtaskScore] - 0-100 from OwnerSubtaskService.evaluateSubtasks
 * @param {number} [params.contractProgress] - 0-1 through the contract (default 1 = full weight)
 * @param {number} [params.capBreachPenalty] - 0 or negative, from capBreachPenalty() — the
 *   owner's wrath for payroll above their mandated line, applied to the blended value
 * @returns {{ value, label, color, winsSatisfaction, subtaskScore, effectiveSubtaskScore, subtaskTimeWeight, contractProgress, expectedWins, capBreachPenalty }}
 */
export function combinedSatisfaction({
  owner,
  currentWins = 0,
  currentLosses = 0,
  lastSeason = null,
  subtaskScore = 0,
  contractProgress = 1,
  expectedWins = null,
  currentPlayoff = null,
  injuryRelief = 0,
  capBreachPenalty: breachPenalty = 0,
} = {}) {
  const wins = computeOwnerSatisfaction({ owner, currentWins, currentLosses, lastSeason, expectedWins, currentPlayoff, injuryRelief });
  const subScore = _clamp(Math.round(subtaskScore || 0), 0, 100);

  // Patience-shaped ramp: gamma < 1 ramps fast (impatient), > 1 ramps slow (patient).
  const patience = _clamp(owner?.patience ?? 3, 1, 5);
  const gamma = 1 + (patience - 3) * 0.3; // p1→0.4, p3→1.0, p5→1.6
  const progress = _clamp(contractProgress ?? 1, 0, 1);
  const subtaskTimeWeight = Math.pow(progress, gamma);

  const effectiveSubtask = NEUTRAL_SATISFACTION + (subScore - NEUTRAL_SATISFACTION) * subtaskTimeWeight;
  const wrath = Math.min(0, Math.round(breachPenalty || 0));
  const value = _clamp(
    Math.round(wins.value * WINS_WEIGHT + effectiveSubtask * SUBTASK_WEIGHT) + wrath,
    0,
    100
  );
  const { label, color } = satisfactionDisplay(value);
  return {
    value,
    label,
    color,
    winsSatisfaction: wins.value,
    subtaskScore: subScore,
    effectiveSubtaskScore: _clamp(Math.round(effectiveSubtask), 0, 100),
    subtaskTimeWeight,
    contractProgress: progress,
    expectedWins: wins.expectedWins,
    capBreachPenalty: wrath,
  };
}
