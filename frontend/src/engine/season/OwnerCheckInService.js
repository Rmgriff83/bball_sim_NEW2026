// =============================================================================
// OwnerCheckInService.js
// =============================================================================
// Builds the owner's "check-in" dialogue — the conversation the owner delivers
// at the start of each season (and right after the GM signs on): a greeting, a
// restatement of the mandate, a run through the current sub-goals (with their
// done/not-yet status), and a patience-flavored closer.
//
// Pure and import-free so it's directly node-testable. Dialogue variants are
// picked DETERMINISTICALLY from the season year + owner, so the same season
// always renders the same conversation across reloads (no Math.random, which is
// also unavailable in some engine contexts).
// =============================================================================

const PATIENCE_CLOSERS = {
  1: "I don't do excuses, and I don't do patience. Deliver.",
  2: "I expect results, and soon — don't make me regret this hire.",
  3: "Show me steady, honest progress and we'll get along just fine.",
  4: "Build it the right way. I'll give you the room to work.",
  5: "Take the time to do this properly — I'm in no rush. Just point us in the right direction.",
};

// First-person mandate per expectation. {wins} is replaced with expected wins.
const MANDATES = {
  championship: "This franchise exists to win titles. ~{wins} wins just gets you in the door — I expect a banner.",
  contender: "I want us deep in the playoffs every single year. Somewhere around {wins} wins, and a real run when it counts.",
  playoffs: "The standard is simple: make the postseason. Get us to about {wins} wins and stay in the hunt.",
  develop: "We're building something. I care less about hitting {wins} wins this year and more about our young core taking a real step.",
  rebuild: "We're playing the long game. Wins will come — for now I want assets, growth, and a foundation. Don't chase {wins} at the cost of the future.",
};

const GREETINGS_FIRST = [
  "Welcome aboard. I'm {name} — I own this team, and as of today, you run it.",
  "So you're my new GM. {name}. Let's make sure we're on the same page before tip-off.",
  "Glad to have you. I don't hand these keys to just anyone — let's talk about what I expect.",
];

const GREETINGS_RETURNING = [
  "Another season. Good to have you back in the chair — let's see where we stand.",
  "Here we go again. Before the season tips, let's go over the state of things.",
  "New year, same goal. Let's review where we are.",
];

const SUBTASK_INTROS = [
  "Here's what I'll be keeping an eye on this year:",
  "These are the things I'm tracking — let's see where they sit:",
  "Let's run through what matters to me right now:",
];

function _hash(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

function _pick(arr, seed) {
  if (!arr.length) return '';
  return arr[seed % arr.length];
}

function _clampPatience(p) {
  return Math.max(1, Math.min(5, Math.round(p ?? 3)));
}

/**
 * Build the owner check-in conversation.
 *
 * @param {object} params
 * @param {object} params.owner            - { firstName, lastName, expectation, patience }
 * @param {Array}  [params.subtasks]       - from OwnerSubtaskService ({ label, met, description, global })
 * @param {number} [params.expectedWins]
 * @param {number} [params.seasonYear]     - drives deterministic variant selection
 * @param {boolean}[params.isFirstSeason]
 * @param {number} [params.yearsRemaining] - on the GM contract
 * @returns {{ greetingLines: string[], subtaskIntro: string, subtasks: Array, closingLines: string[] }}
 */
export function buildOwnerCheckIn({
  owner,
  subtasks = [],
  expectedWins = null,
  seasonYear = 0,
  isFirstSeason = false,
  yearsRemaining = null,
} = {}) {
  const name = owner ? `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() : 'the owner';
  const seed = (Number(seasonYear) || 0) + _hash(owner?.lastName ?? name);

  const greeting = _pick(isFirstSeason ? GREETINGS_FIRST : GREETINGS_RETURNING, seed).replace('{name}', name);
  const mandate = (MANDATES[owner?.expectation] ?? MANDATES.playoffs)
    .replace('{wins}', expectedWins != null ? String(expectedWins) : 'a winning record');

  const subtaskIntro = _pick(SUBTASK_INTROS, seed + 1);

  const closer = PATIENCE_CLOSERS[_clampPatience(owner?.patience)];
  const closingLines = [];
  if (!isFirstSeason && yearsRemaining != null && yearsRemaining > 0) {
    closingLines.push(
      yearsRemaining === 1
        ? "Reminder that this is the last year of your current contract."
        : `We've got ${yearsRemaining} years left on our deal.`
    );
  }
  closingLines.push(closer);

  return {
    greetingLines: [greeting, mandate],
    subtaskIntro,
    subtasks: (Array.isArray(subtasks) ? subtasks : []).map((t) => ({
      id: t.id,
      label: t.label,
      met: !!t.met,
      description: t.description,
      global: !!t.global,
      progress: t.progress ?? null,
    })),
    closingLines,
  };
}
