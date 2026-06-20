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

const TOTAL_GAMES = 82;

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

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
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
export function computeOwnerSatisfaction({ owner, currentWins = 0, currentLosses = 0, lastSeason = null, expectedWins = null } = {}) {
  const expected = expectedWins ?? expectedWinsForExpectation(owner?.expectation);
  const patience = _clamp(owner?.patience ?? 3, 1, 5);
  const winNow = ['championship', 'contender', 'playoffs'].includes(owner?.expectation);

  // --- Current season: projected wins vs expectation, ramped to full weight by
  //     mid-season so an early hot/cold streak doesn't whipsaw the meter. ---
  const gp = (currentWins ?? 0) + (currentLosses ?? 0);
  let current = 0;
  if (gp > 0) {
    const projected = (currentWins / gp) * TOTAL_GAMES;
    const weight = Math.min(1, gp / (TOTAL_GAMES / 2));
    current = (projected - expected) * 1.4 * weight;
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
  const value = _clamp(Math.round(50 + raw * damp), 0, 100);

  const { label, color } = satisfactionDisplay(value);
  return { value, label, color, expectedWins: expected };
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
 * @returns {{ value, label, color, winsSatisfaction, subtaskScore, effectiveSubtaskScore, subtaskTimeWeight, contractProgress, expectedWins }}
 */
export function combinedSatisfaction({
  owner,
  currentWins = 0,
  currentLosses = 0,
  lastSeason = null,
  subtaskScore = 0,
  contractProgress = 1,
  expectedWins = null,
} = {}) {
  const wins = computeOwnerSatisfaction({ owner, currentWins, currentLosses, lastSeason, expectedWins });
  const subScore = _clamp(Math.round(subtaskScore || 0), 0, 100);

  // Patience-shaped ramp: gamma < 1 ramps fast (impatient), > 1 ramps slow (patient).
  const patience = _clamp(owner?.patience ?? 3, 1, 5);
  const gamma = 1 + (patience - 3) * 0.3; // p1→0.4, p3→1.0, p5→1.6
  const progress = _clamp(contractProgress ?? 1, 0, 1);
  const subtaskTimeWeight = Math.pow(progress, gamma);

  const effectiveSubtask = NEUTRAL_SATISFACTION + (subScore - NEUTRAL_SATISFACTION) * subtaskTimeWeight;
  const value = _clamp(
    Math.round(wins.value * WINS_WEIGHT + effectiveSubtask * SUBTASK_WEIGHT),
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
  };
}
