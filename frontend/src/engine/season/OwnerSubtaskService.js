// =============================================================================
// OwnerSubtaskService.js
// =============================================================================
// Pure logic for the owner's per-expectation "sub-tasks" — the concrete,
// checkable conditions that, alongside the win-record, make up how satisfied the
// owner is with the GM. Part 2 of Team Owners.
//
// The owner's retain/fire decision weights overall wins at 60% and these
// sub-tasks at 40% (see OwnerService.combinedSatisfaction). Each sub-task is a
// simple boolean check against the franchise's current state + the GM contract's
// running progress, plus a global salary-cap sub-task whose WEIGHT scales with
// the owner's `moneyConsciousness` (1-5).
//
// Framework-free and import-free so it's directly node-testable. The salary cap
// is injected by callers (from engine/data/teams.js SALARY_CAP); it defaults to
// the league value so the function is safe to call without it.
// =============================================================================

// Mirror of data/salaryScale.js SALARY_CAP — used only as the default when a
// caller doesn't inject the live value (callers pass the live cap). Kept inline
// to preserve this module's import-free, node-testable design.
const DEFAULT_SALARY_CAP = 154600000;

// A "star" is a rostered player at this overall or above. Used by retain_stars
// and the sign-time baseline (starPlayerIdsAtSign).
export const STAR_OVERALL = 80;

// Flat weight for an ordinary sub-task. The global `under_cap` sub-task instead
// carries weight = owner.moneyConsciousness, so a tightfisted owner (5) makes
// going over the cap hurt far more than a spend-happy owner (1) does.
const SUBTASK_WEIGHT = 3;

function _num(v, fallback = 0) {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}

function _tier(settings, key) {
  // hired personnel live at campaign.settings[key] = { tier, ... }
  return _num(settings?.[key]?.tier, 0);
}

function _coachRating(coach) {
  return _num(coach?.overallRating ?? coach?.overall_rating, 0);
}

// Round-1 picks the GM acquired from OTHER teams (originated elsewhere but the
// user team now owns them). draftPicks passed in should be the user team's picks.
function _acquiredFirstRounders(draftPicks, userTeamId) {
  if (!Array.isArray(draftPicks)) return 0;
  return draftPicks.filter((p) => {
    const round = p?.round ?? 1;
    if (round !== 1) return false;
    const origin = p?.originalTeamId ?? null;
    // acquired = originated on a different team (or explicitly flagged traded)
    return (origin != null && userTeamId != null && origin !== userTeamId) || p?.isTraded === true;
  }).length;
}

function _overall(p) {
  return _num(p?.overall ?? p?.overall_rating ?? p?.overallRating, 0);
}

function _potential(p) {
  return _num(p?.potential ?? p?.potentialRating ?? p?.potential_rating, 0);
}

function _hasYoungStud(roster) {
  if (!Array.isArray(roster)) return false;
  return roster.some((p) => _num(p?.age, 99) <= 21 && _potential(p) >= 85);
}

function _playerMorale(p) {
  return _num(p?.personality?.morale ?? p?.morale, 80);
}

/**
 * IDs of the "star" players on a roster (overall >= STAR_OVERALL). Used to seed
 * gmContract.progress.starPlayerIdsAtSign at sign/extend/switch so retain_stars
 * can later check whether the GM kept the core they inherited.
 */
export function starPlayerIds(roster) {
  return (Array.isArray(roster) ? roster : [])
    .filter((p) => _overall(p) >= STAR_OVERALL)
    .map((p) => String(p?.id))
    .filter((id) => id && id !== 'undefined');
}

// retain_stars: every star present when the contract was signed is still on the
// roster, AND the GM's current stars are reasonably happy (avg morale >= 65). If
// there were no stars at sign, the retention clause is trivially satisfied.
function _retainStarsMet(roster, starPlayerIdsAtSign) {
  const rosterIds = new Set(
    (Array.isArray(roster) ? roster : []).map((p) => String(p?.id)).filter(Boolean)
  );
  const signIds = Array.isArray(starPlayerIdsAtSign) ? starPlayerIdsAtSign.map(String) : [];
  const allRetained = signIds.every((id) => rosterIds.has(id));

  const currentStars = (Array.isArray(roster) ? roster : []).filter(
    (p) => _overall(p) >= STAR_OVERALL
  );
  const happy =
    currentStars.length === 0 ||
    currentStars.reduce((s, p) => s + _playerMorale(p), 0) / currentStars.length >= 65;

  return allRetained && happy;
}

// Build the (non-global) sub-task list for an expectation tier. Each entry is
// { id, label, description, met, weight }. Count-based goals also carry
// `progress: { current, target }` so the UI can show running tallies (e.g. 2/4).
function _subtasksForExpectation(expectation, ctx) {
  const { roster, draftPicks, facilities, settings, progress, userTeamId, coach } = ctx;
  void facilities; // retained in the context for callers; no longer read here
  const badges = _num(progress?.badgesAdded, 0);
  const allStars = _num(progress?.allStarAppearances, 0);

  const w = SUBTASK_WEIGHT;
  switch (expectation) {
    case 'rebuild':
      return [
        {
          id: 'future_assets',
          label: 'Stockpile future assets',
          description: 'Acquire 2+ first-round picks from other teams, or roster a 21-and-under prospect with 85+ potential.',
          met: _acquiredFirstRounders(draftPicks, userTeamId) >= 2 || _hasYoungStud(roster),
          weight: w,
        },
        {
          id: 'hire_scout',
          label: 'Hire a quality scout',
          description: 'Employ a scout rated 3 stars or better.',
          met: _tier(settings, 'scout') >= 3,
          weight: w,
        },
      ];
    case 'develop':
      return [
        {
          id: 'add_badges',
          label: 'Develop the roster (badges)',
          description: 'Add at least 4 player badges over the contract (training or purchases).',
          met: badges >= 4,
          progress: { current: badges, target: 4 },
          weight: w,
        },
        {
          id: 'hire_trainer',
          label: 'Hire a player development trainer',
          description: 'Employ a development trainer rated 3 stars or better.',
          met: _tier(settings, 'staff_trainer') >= 3,
          weight: w,
        },
        {
          id: 'retain_stars',
          label: 'Retain & keep your stars happy',
          description: 'Keep the star players you had at signing and maintain their morale.',
          met: _retainStarsMet(roster, progress?.starPlayerIdsAtSign),
          weight: w,
        },
      ];
    case 'playoffs':
      return [
        {
          id: 'hire_medical',
          label: 'Hire a quality physician',
          description: 'Employ a team physician rated 3 stars or better.',
          met: _tier(settings, 'trainer') >= 3,
          weight: w,
        },
        {
          id: 'quality_coach',
          label: 'Employ a quality head coach',
          description: 'Have a head coach rated 80 or better.',
          met: _coachRating(coach) >= 80,
          weight: w,
        },
        {
          id: 'all_star_2',
          label: 'Produce All-Stars',
          description: 'Earn at least 2 All-Star selections over the contract.',
          met: allStars >= 2,
          progress: { current: allStars, target: 2 },
          weight: w,
        },
      ];
    case 'contender':
      return [
        {
          id: 'hire_medical',
          label: 'Hire a quality physician',
          description: 'Employ a team physician rated 3 stars or better.',
          met: _tier(settings, 'trainer') >= 3,
          weight: w,
        },
        {
          id: 'quality_coach',
          label: 'Employ a top head coach',
          description: 'Have a head coach rated 85 or better.',
          met: _coachRating(coach) >= 85,
          weight: w,
        },
        {
          id: 'all_star_3',
          label: 'Produce All-Stars',
          description: 'Earn at least 3 All-Star selections over the contract.',
          met: allStars >= 3,
          progress: { current: allStars, target: 3 },
          weight: w,
        },
        {
          id: 'retain_stars',
          label: 'Retain & keep your stars happy',
          description: 'Keep the star players you had at signing and maintain their morale.',
          met: _retainStarsMet(roster, progress?.starPlayerIdsAtSign),
          weight: w,
        },
      ];
    case 'championship':
      return [
        {
          id: 'hire_medical',
          label: 'Hire an elite physician',
          description: 'Employ a team physician rated 4 stars.',
          met: _tier(settings, 'trainer') >= 4,
          weight: w,
        },
        {
          id: 'quality_coach',
          label: 'Employ a top head coach',
          description: 'Have a head coach rated 85 or better.',
          met: _coachRating(coach) >= 85,
          weight: w,
        },
        {
          id: 'all_star_4',
          label: 'Produce All-Stars',
          description: 'Earn at least 4 All-Star selections over the contract.',
          met: allStars >= 4,
          progress: { current: allStars, target: 4 },
          weight: w,
        },
        {
          id: 'retain_stars',
          label: 'Retain & keep your stars happy',
          description: 'Keep the star players you had at signing and maintain their morale.',
          met: _retainStarsMet(roster, progress?.starPlayerIdsAtSign),
          weight: w,
        },
        {
          id: 'add_badges',
          label: 'Develop the roster (badges)',
          description: 'Add at least 6 player badges over the contract (training or purchases).',
          met: badges >= 6,
          progress: { current: badges, target: 6 },
          weight: w,
        },
      ];
    default:
      return [];
  }
}

/**
 * Evaluate the owner's sub-tasks against the franchise's current state.
 *
 * @param {object} params
 * @param {object} params.owner            - { expectation, moneyConsciousness }
 * @param {string} [params.expectation]    - override (defaults to owner.expectation)
 * @param {Array}  [params.roster]         - user team players ({ id, age, overall, potential, personality.morale })
 * @param {Array}  [params.draftPicks]     - user team's draft picks
 * @param {object} [params.facilities]     - team.facilities { training, medical, scouting, analytics }
 * @param {object} [params.settings]       - campaign.settings (scout/trainer/staff_trainer with .tier)
 * @param {number} [params.payroll]        - current team payroll
 * @param {object} [params.progress]       - gmContract.progress { allStarAppearances, badgesAdded, starPlayerIdsAtSign }
 * @param {string|number} [params.userTeamId]
 * @param {number} [params.salaryCap]      - injected SALARY_CAP (defaults to league value)
 * @returns {{ subtasks: Array<{id,label,description,met,weight}>, subtaskScore: number, metCount: number, total: number }}
 */
export function evaluateSubtasks({
  owner,
  expectation = owner?.expectation,
  expectationTiers = null,
  roster = [],
  draftPicks = [],
  facilities = null,
  settings = {},
  payroll = 0,
  progress = {},
  userTeamId = null,
  coach = null,
  salaryCap = DEFAULT_SALARY_CAP,
} = {}) {
  const moneyConsciousness = Math.max(1, Math.min(5, _num(owner?.moneyConsciousness, 3)));

  // Expectations are ADDITIVE across a contract: if the owner's bar rose, the new
  // tier's goals are appended without dropping the ones the GM already invested in.
  // `expectationTiers` is the ordered history (earliest→latest); fall back to the
  // single current tier for legacy callers / older saves.
  const tiers = (Array.isArray(expectationTiers) && expectationTiers.length)
    ? expectationTiers
    : [expectation];

  const ctx = { roster, draftPicks, facilities, settings, progress, userTeamId, coach };
  // Merge tier sub-tasks, deduping by id and KEEPING THE FIRST occurrence — so an
  // earlier/easier target (e.g. "2 All-Stars", a 3★ physician) is never silently
  // made harder by a later tier; genuinely new goals from higher tiers get appended.
  const list = [];
  const seen = new Set();
  for (const tier of tiers) {
    for (const task of _subtasksForExpectation(tier, ctx)) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      list.push(task);
    }
  }

  // Global salary-cap sub-task, weighted by money-consciousness.
  list.push({
    id: 'under_cap',
    label: 'Stay under the salary cap',
    description: 'Keep total payroll at or below the salary cap.',
    met: _num(payroll, 0) <= salaryCap,
    weight: moneyConsciousness,
    global: true,
  });

  const totalWeight = list.reduce((s, t) => s + (t.weight || 0), 0);
  const metWeight = list.reduce((s, t) => s + (t.met ? t.weight || 0 : 0), 0);
  const subtaskScore = totalWeight > 0 ? Math.round((metWeight / totalWeight) * 100) : 0;
  const metCount = list.filter((t) => t.met).length;

  return { subtasks: list, subtaskScore, metCount, total: list.length };
}
