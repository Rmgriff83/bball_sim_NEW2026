// =============================================================================
// OwnerCheckInService.js
// =============================================================================
// Builds the owner's "check-in" dialogue — the conversation the owner delivers
// at the start of each season (and right after the GM signs on): a greeting, a
// restatement of the mandate, a run through the current sub-goals (with their
// done/not-yet status), and a patience-flavored closer.
//
// Pure (imports only the pure T helper) so it's directly node-testable — NO
// i18n imports (engine code may run in a worker). Dialogue variants are
// picked DETERMINISTICALLY from the season year + owner, so the same season
// always renders the same conversation across reloads (no Math.random, which is
// also unavailable in some engine contexts).
//
// Every dialogue line is built via T() (commentaryTemplate.js): each line is a
// { text, tpl, params } object whose `text` is the unchanged English string —
// the UI translates via $tDynamic(tpl, params) with fallback to `text`.
// Dialogue is generated on demand and never persisted (only the fire-once
// markers in campaign settings are), so the shape change is render-time only.
// =============================================================================

import { T } from '../simulation/commentaryTemplate'

// --- Dialogue template pools -------------------------------------------------
// Every entry is a translation TEMPLATE ({token} placeholders — owner names
// and win counts are params, never baked in). The `*_TPLS` naming is
// load-bearing: wl-i18n.config.js regex-extracts the quoted strings of these
// const blocks (plus direct quoted first args of T calls).

const PATIENCE_CLOSER_TPLS = {
  1: "I don't do excuses, and I don't do patience. Deliver.",
  2: "I expect results, and soon — don't make me regret this hire.",
  3: "Show me steady, honest progress and we'll get along just fine.",
  4: "Build it the right way. I'll give you the room to work.",
  5: "Take the time to do this properly — I'm in no rush. Just point us in the right direction.",
}

// First-person mandate per expectation. {wins} is the expected-wins number.
const MANDATE_TPLS = {
  championship: "This franchise exists to win titles. ~{wins} wins just gets you in the door — I expect a banner.",
  contender: "I want us deep in the playoffs every single year. Somewhere around {wins} wins, and a real run when it counts.",
  playoffs: "The standard is simple: make the postseason. Get us to about {wins} wins and stay in the hunt.",
  develop: "We're building something. I care less about hitting {wins} wins this year and more about our young core taking a real step.",
  rebuild: "We're playing the long game. Wins will come — for now I want assets, growth, and a foundation. Don't chase {wins} at the cost of the future.",
}

// Fallback mandates when no expected-wins number is available. Separate
// COMPLETE templates (never a spliced English fragment); the wording matches
// the pre-i18n output byte-for-byte ("a winning record" substituted for the
// win count).
const MANDATE_NO_WINS_TPLS = {
  championship: "This franchise exists to win titles. ~a winning record wins just gets you in the door — I expect a banner.",
  contender: "I want us deep in the playoffs every single year. Somewhere around a winning record wins, and a real run when it counts.",
  playoffs: "The standard is simple: make the postseason. Get us to about a winning record wins and stay in the hunt.",
  develop: "We're building something. I care less about hitting a winning record wins this year and more about our young core taking a real step.",
  rebuild: "We're playing the long game. Wins will come — for now I want assets, growth, and a foundation. Don't chase a winning record at the cost of the future.",
}

const GREETING_FIRST_TPLS = [
  "Welcome aboard. I'm {name} — I own this team, and as of today, you run it.",
  "So you're my new GM. {name}. Let's make sure we're on the same page before tip-off.",
  "Glad to have you. I don't hand these keys to just anyone — let's talk about what I expect.",
]

const GREETING_RETURNING_TPLS = [
  "Another season. Good to have you back in the chair — let's see where we stand.",
  "Here we go again. Before the season tips, let's go over the state of things.",
  "New year, same goal. Let's review where we are.",
]

const SUBTASK_INTRO_TPLS = [
  "Here's what I'll be keeping an eye on this year:",
  "These are the things I'm tracking — let's see where they sit:",
  "Let's run through what matters to me right now:",
]

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
 * Every dialogue line is a T object ({ text, tpl, params }) — `text` is the
 * English string (unchanged from the pre-i18n output), `tpl`/`params` let the
 * UI translate at render time.
 *
 * @param {object} params
 * @param {object} params.owner            - { firstName, lastName, expectation, patience }
 * @param {Array}  [params.subtasks]       - from OwnerSubtaskService ({ label, met, description, global })
 * @param {number} [params.expectedWins]
 * @param {number} [params.seasonYear]     - drives deterministic variant selection
 * @param {boolean}[params.isFirstSeason]
 * @param {number} [params.yearsRemaining] - on the GM contract
 * @returns {{ greetingLines: Array<{text:string,tpl:string,params:object|null}>, subtaskIntro: {text:string,tpl:string,params:object|null}, subtasks: Array, closingLines: Array<{text:string,tpl:string,params:object|null}> }}
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

  const greetingTpl = _pick(isFirstSeason ? GREETING_FIRST_TPLS : GREETING_RETURNING_TPLS, seed);
  const greeting = T(greetingTpl, { name });
  const mandate = expectedWins != null
    ? T(MANDATE_TPLS[owner?.expectation] ?? MANDATE_TPLS.playoffs, { wins: expectedWins })
    : T(MANDATE_NO_WINS_TPLS[owner?.expectation] ?? MANDATE_NO_WINS_TPLS.playoffs);

  const subtaskIntro = T(_pick(SUBTASK_INTRO_TPLS, seed + 1));

  const closer = T(PATIENCE_CLOSER_TPLS[_clampPatience(owner?.patience)]);
  const closingLines = [];
  if (!isFirstSeason && yearsRemaining != null && yearsRemaining > 0) {
    closingLines.push(
      yearsRemaining === 1
        ? T("Reminder that this is the last year of your current contract.")
        : T("We've got {n} years left on our deal.", { n: yearsRemaining })
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
