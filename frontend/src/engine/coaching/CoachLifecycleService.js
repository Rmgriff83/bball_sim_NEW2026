// =============================================================================
// CoachLifecycleService.js
// =============================================================================
// Pure logic for the AI head-coach lifecycle: aging→retirement, the blended
// fire/extend/retain decision, and fit-for-direction hiring. No DB / store /
// framework imports so it stays unit-testable in isolation; the offseason hook
// in CampaignManager wires real data in.
//
// Coaches are persistent objects with a stable `id`. The offseason flow moves a
// coach between exactly one of: a team (`team.coach`) or the unemployed pool
// (`campaign.settings.availableCoaches`). Firing / expiry / a team that retains
// nobody returns the coach to the pool; retirement removes them from the system.
// =============================================================================

const DIRECTIONS = ['title_contender', 'win_now', 'ascending', 'rebuilding'];

// Expected regular-season win totals by competitive window — the baseline the
// "did the coach meet expectations" gap is measured against.
const EXPECTED_WINS = {
  title_contender: 54,
  win_now: 47,
  ascending: 38,
  rebuilding: 24,
};
const DEFAULT_EXPECTED_WINS = 41;

// Playoff-depth → satisfaction bonus (wins-equivalent).
const PLAYOFF_BONUS = {
  champion: 16,
  finals: 10,
  conf_finals: 6,
  round2: 4,
  round1: 2,
};

const BADGE_LEVEL_POINTS = { bronze: 1, silver: 2, gold: 4, hof: 8 };

function _rand(rng) {
  return typeof rng === 'function' ? rng() : Math.random();
}

function _coachAge(coach) {
  return coach?.age ?? 50;
}

// ---------------------------------------------------------------------------
// Aging & retirement
// ---------------------------------------------------------------------------

/**
 * Probability a coach of a given age retires this offseason. ~0 in the prime
 * years, rising from the mid-60s and spiking past 70, certain by 76.
 */
export function retirementChance(age) {
  if (age < 60) return 0.005;
  if (age < 63) return 0.03;
  if (age < 66) return 0.08;
  if (age < 68) return 0.16;
  if (age < 70) return 0.26;
  if (age < 72) return 0.42;
  if (age < 74) return 0.62;
  if (age < 76) return 0.85;
  return 1.0;
}

/**
 * Age every coach by one year and roll retirements. Mutates each coach's `age`.
 * @param {object} params
 * @param {Array<{teamId:*, coach:object}>} params.employed - employed coaches w/ their team
 * @param {Array<object>} params.pooled - unemployed pool coaches
 * @param {function} [params.rng]
 * @returns {{ retiredEmployed: Array<{teamId:*, coach:object}>, retiredPooledIds: Set<string> }}
 */
export function ageCoachesAndRetire({ employed = [], pooled = [], rng } = {}) {
  const retiredEmployed = [];
  const retiredPooledIds = new Set();

  for (const entry of employed) {
    const coach = entry?.coach;
    if (!coach) continue;
    coach.age = _coachAge(coach) + 1;
    if (_rand(rng) < retirementChance(coach.age)) {
      retiredEmployed.push(entry);
    }
  }
  for (const coach of pooled) {
    if (!coach) continue;
    coach.age = _coachAge(coach) + 1;
    // Unemployed coaches retire a touch more readily (no job pulling them back).
    if (_rand(rng) < retirementChance(coach.age) * 1.15) {
      retiredPooledIds.add(coach.id);
    }
  }
  return { retiredEmployed, retiredPooledIds };
}

// ---------------------------------------------------------------------------
// Expectations & the fire/extend/retain decision
// ---------------------------------------------------------------------------

export function expectedWinsForDirection(direction) {
  return EXPECTED_WINS[direction] ?? DEFAULT_EXPECTED_WINS;
}

/**
 * Derive each team's playoff depth from the season's playoff bracket (same
 * shape archiveSeasonData reads: bracket[conf].round1/round2 arrays + confFinals
 * series, bracket.finals series, bracket.champion.teamId). Series carry
 * team1/team2 {teamId}, team1Wins/team2Wins, and optionally winner {teamId}.
 * @returns {{ depthByTeamId: Object<string,string>, playoffTeamIds: Set<string> }}
 */
export function derivePlayoffDepth(bracket) {
  const depthByTeamId = {};
  const playoffTeamIds = new Set();
  if (!bracket) return { depthByTeamId, playoffTeamIds };

  const seriesLoserWinner = (series) => {
    const t1 = series?.team1?.teamId ?? null;
    const t2 = series?.team2?.teamId ?? null;
    let winner = series?.winner?.teamId ?? null;
    if (!winner && t1 && t2) {
      winner = (series.team1Wins ?? 0) >= (series.team2Wins ?? 0) ? t1 : t2;
    }
    const loser = winner === t1 ? t2 : t1;
    return { winner, loser };
  };
  const mark = (teamId, depth) => {
    if (!teamId) return;
    playoffTeamIds.add(teamId);
    // Keep the deepest result if a team somehow appears twice.
    if (depthByTeamId[teamId] == null) depthByTeamId[teamId] = depth;
  };

  // Champion first (deepest), then finals/conf/round losers, then round1 entrants.
  const championId = bracket.champion?.teamId ?? null;
  if (championId) mark(championId, 'champion');

  if (bracket.finals) {
    const { loser } = seriesLoserWinner(bracket.finals);
    if (loser) mark(loser, 'finals');
    if (bracket.finals.team1?.teamId) playoffTeamIds.add(bracket.finals.team1.teamId);
    if (bracket.finals.team2?.teamId) playoffTeamIds.add(bracket.finals.team2.teamId);
  }

  for (const conf of ['east', 'west']) {
    const confData = bracket[conf];
    if (!confData) continue;
    if (confData.confFinals) {
      const { loser } = seriesLoserWinner(confData.confFinals);
      if (loser) mark(loser, 'conf_finals');
    }
    for (const round of ['round2', 'round1']) {
      const depth = round === 'round2' ? 'round2' : 'round1';
      const list = Array.isArray(confData[round]) ? confData[round] : [];
      for (const series of list) {
        const t1 = series?.team1?.teamId ?? null;
        const t2 = series?.team2?.teamId ?? null;
        if (t1) playoffTeamIds.add(t1);
        if (t2) playoffTeamIds.add(t2);
        const { loser } = seriesLoserWinner(series);
        if (loser) mark(loser, depth);
      }
    }
  }
  return { depthByTeamId, playoffTeamIds };
}

/**
 * Decide what an AI team does with its head coach this offseason.
 * @param {object} params
 * @param {string} params.direction - competitive window from analyzeTeamDirection
 * @param {number} params.actualWins
 * @param {number} params.expectedWins
 * @param {Array} [params.seasonHistory] - team.seasonHistory ({year,wins,...}), oldest→newest
 * @param {boolean} params.madePlayoffs
 * @param {string|null} params.playoffResult - 'champion'|'finals'|'conf_finals'|'round2'|'round1'|null
 * @param {number} params.contractYearsLeft - AFTER this season's decrement
 * @param {number} [params.seasonsWithTeam] - tenure (for first-year patience)
 * @param {function} [params.rng]
 * @returns {{ decision: 'extend'|'retain'|'fire', score: number, reason: string }}
 */
export function evaluateCoachDecision({
  direction,
  actualWins,
  expectedWins,
  seasonHistory = [],
  madePlayoffs = false,
  playoffResult = null,
  contractYearsLeft = 1,
  seasonsWithTeam = 1,
  rng,
}) {
  const isContender = direction === 'title_contender' || direction === 'win_now';
  const isRebuild = direction === 'rebuilding' || direction === 'ascending';

  // Base satisfaction = how far actual wins beat the expectation.
  let score = (actualWins ?? 0) - (expectedWins ?? DEFAULT_EXPECTED_WINS);

  // Playoff depth bonus.
  score += PLAYOFF_BONUS[playoffResult] ?? 0;

  // Contender accountability: built to win, didn't → strong negative.
  if (isContender && !madePlayoffs) score -= 12;
  else if (isContender && playoffResult === 'round1') score -= 5;

  // Young-team improvement credit (year-over-year wins).
  if (isRebuild && seasonHistory.length >= 2) {
    const prev = seasonHistory[seasonHistory.length - 2];
    const improvement = (actualWins ?? 0) - (prev?.wins ?? actualWins ?? 0);
    if (improvement > 0) score += Math.min(8, improvement * 0.6);
    else score += Math.max(-5, improvement * 0.4);
  }

  // First-year patience: new coaches rarely get one-and-done'd.
  const firstYear = (seasonsWithTeam ?? 1) <= 1;

  let reason;
  // --- Extend: clear overachievement, or secure a valued coach before a
  //     lame-duck final year. ---
  if (score >= 10 || playoffResult === 'champion' || playoffResult === 'finals') {
    if (contractYearsLeft <= 1) {
      return { decision: 'extend', score, reason: playoffResult === 'champion' ? 'championship' : 'overachieved' };
    }
    // Already has runway; keep them happily under contract.
    return { decision: 'retain', score, reason: 'overachieved' };
  }

  // --- Fire: meaningful underperformance, probabilistic so the carousel is
  //     ~6–10 of 30 per year rather than every bad team firing. ---
  if (score <= -7) {
    // Fire probability scales from ~0.30 at the threshold to ~0.85 for disasters.
    let fireProb = Math.min(0.85, 0.30 + (-7 - score) * 0.04);
    if (firstYear) fireProb *= 0.5; // patience for a first-year coach
    if (_rand(rng) < fireProb) {
      reason = (isContender && !madePlayoffs) ? 'missed_playoffs' : 'underperformed';
      return { decision: 'fire', score, reason };
    }
  }

  // --- Otherwise retain. If the contract expired and we're keeping them, that's
  //     an extension (avoid lame-duck); if it expired and standing is poor, let
  //     them walk (treated as a fire → back to pool). ---
  if (contractYearsLeft <= 0) {
    if (score >= -3) return { decision: 'extend', score, reason: 'retained_expiring' };
    return { decision: 'fire', score, reason: 'contract_expired' };
  }
  return { decision: 'retain', score, reason: 'met_expectations' };
}

// ---------------------------------------------------------------------------
// Hiring — fit for the team's direction
// ---------------------------------------------------------------------------

function _attr(coach, key) {
  return coach?.attributes?.[key] ?? 75;
}

function _badgePoints(coach, ids) {
  const badges = Array.isArray(coach?.badges) ? coach.badges : [];
  let pts = 0;
  for (const b of badges) {
    if (ids.includes(b?.id)) pts += BADGE_LEVEL_POINTS[b?.level ?? 'bronze'] ?? 1;
  }
  return pts;
}

/**
 * Score a candidate coach for a team's competitive window. Rebuilders weight
 * player development; contenders weight game management + scheme mastery.
 */
export function scoreCoachForDirection(coach, direction) {
  if (!coach) return -Infinity;
  const overall = coach.overallRating ?? coach.overall_rating ?? 70;
  const dev = _attr(coach, 'playerDevelopment') + _badgePoints(coach, ['player_whisperer']) * 3;
  const mgmt = _attr(coach, 'gameManagement')
    + _badgePoints(coach, ['late_game_genius', 'offensive_mastermind', 'defensive_mastermind']) * 2;
  const iq = (_attr(coach, 'offensiveIQ') + _attr(coach, 'defensiveIQ')) / 2;

  switch (direction) {
    case 'rebuilding':
      return overall * 0.35 + dev * 0.90 + iq * 0.20 + mgmt * 0.10;
    case 'ascending':
      return overall * 0.45 + dev * 0.55 + iq * 0.25 + mgmt * 0.25;
    case 'win_now':
      return overall * 0.60 + mgmt * 0.55 + iq * 0.30 + dev * 0.10;
    case 'title_contender':
      return overall * 0.65 + mgmt * 0.65 + iq * 0.30 + dev * 0.05;
    default:
      return overall * 0.55 + dev * 0.35 + mgmt * 0.35 + iq * 0.25;
  }
}

/**
 * Pick the best-fit coach from the pool for a vacancy. Slight randomness among
 * the top candidates so the same coach isn't deterministically grabbed and the
 * carousel feels organic. Returns the chosen coach (NOT removed — caller splices
 * it out of the pool) or null if the pool is empty.
 */
export function selectCoachForVacancy({ direction, pool = [], rng } = {}) {
  if (!pool.length) return null;
  const ranked = pool
    .map((coach) => ({ coach, score: scoreCoachForDirection(coach, direction) }))
    .sort((a, b) => b.score - a.score);

  // Choose from the top 3 with a bias toward the best fit.
  const topN = Math.min(3, ranked.length);
  const weights = [0.6, 0.3, 0.1].slice(0, topN);
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = _rand(rng) * total;
  for (let i = 0; i < topN; i++) {
    roll -= weights[i];
    if (roll <= 0) return ranked[i].coach;
  }
  return ranked[0].coach;
}

export { DIRECTIONS };
