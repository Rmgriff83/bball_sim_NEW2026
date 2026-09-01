// =============================================================================
// scoutSynopsis.js — the hired scout's verbal report on a fully-scouted rookie.
// =============================================================================
// Pure, deterministic, template-based (mirrors draftCommentary.js). Fired from
// the Scouting page when a prospect hits 100% scouted with a scout on staff:
// sentence 1 assesses the player (archetype profile × potential tier, with
// generational / hidden-gem overrides), sentence 2 ties the fit to the team's
// building direction, an optional tail nods to the owner's mandate, and — only
// when the scout's optional `red_flag_intel` perk is active — a separate
// flagged line dredges the worst buried concern out of the revealed stats.
//
// Every line is built via T() (commentaryTemplate.js) so callers receive
// { text, tpl, params } and the UI renders via $tDynamic(tpl, params) with
// fallback to the English string. Never persisted (toast-time only).
// Enumerable labels (profile, tier, direction, flag) are baked into separate
// complete sentences per value — translators never see an English fragment.
// The `*_TPLS` naming is load-bearing: wl-i18n.config.js regex-extracts the
// quoted strings of these const blocks (closing bracket at column 0).
// =============================================================================

import { T } from '@/engine/simulation/commentaryTemplate'
import { detectArchetype } from '@/engine/data/archetypes'

// --- Archetype → assessment profile ------------------------------------------
// 16 archetype ids collapse to 8 voice profiles so each potential tier needs
// only 8 complete sentences (indexed by PROFILE_ORDER, draftCommentary-style).

const PROFILE_ORDER = ['playmaker', 'shooter', 'slasher', 'twoway', 'stretch_big', 'rim_protector', 'interior', 'glue']

const ARCHETYPE_PROFILE = {
  'lead-guard': 'playmaker',
  'point-forward': 'playmaker',
  'point-center': 'playmaker',
  'combo-guard': 'shooter',
  'slasher': 'slasher',
  'slashing-wing': 'slasher',
  'three-and-d-guard': 'twoway',
  'two-way-wing': 'twoway',
  'three-and-d-wing': 'twoway',
  'stretch-4': 'stretch_big',
  'stretch-5': 'stretch_big',
  'drop-big': 'rim_protector',
  'rim-runner': 'interior',
  'power-forward-bruiser': 'interior',
  'old-school-bruiser': 'interior',
  'role-player': 'glue',
}

// --- Sentence 1: player assessment (one sentence per profile, per tier) -------

const SUPERSTAR_ASSESS_TPLS = [
  '{name} is an elite floor general in the making — franchise-cornerstone upside with the ball in his hands.',
  '{name} has franchise-cornerstone upside as a scorer — the shot-making is as pure as it gets.',
  '{name} attacks the rim like a future superstar — franchise-cornerstone upside every time he touches the ball.',
  '{name} projects as a superstar two-way wing — franchise-cornerstone upside on both ends of the floor.',
  '{name} is a floor-spacing big with franchise-cornerstone upside — a matchup nightmare in the making.',
  '{name} is an elite rim protector with franchise-cornerstone upside — he can anchor a defense for a decade.',
  '{name} could own the paint at the next level — franchise-cornerstone upside on the interior.',
  '{name} does everything on a basketball court — franchise-cornerstone upside hiding in a do-it-all game.',
]

const ALLSTAR_ASSESS_TPLS = [
  '{name} is a natural playmaker with All-Star potential — he sees the floor at a different speed.',
  '{name} is a gifted shot-maker with All-Star potential — the scoring will translate from day one.',
  '{name} is a relentless downhill attacker with genuine All-Star potential.',
  '{name} defends and scores at an All-Star level — a true two-way prospect.',
  '{name} is a modern stretch big with All-Star potential — the shooting range is real.',
  '{name} is an excellent rim protector with All-Star potential.',
  '{name} is a powerful interior presence with All-Star potential.',
  '{name} impacts winning all over the floor and carries sneaky All-Star potential.',
]

const STARTER_ASSESS_TPLS = [
  '{name} projects as a long-term starting playmaker who can run an offense.',
  '{name} projects as a starting-caliber scorer who will keep defenses honest.',
  '{name} projects as a starting-caliber slasher who pressures the rim every night.',
  '{name} projects as a reliable starting two-way wing.',
  '{name} projects as a starting-caliber stretch big who spaces the floor.',
  '{name} projects as a long-term starting rim protector.',
  '{name} projects as a starting-caliber interior big who does the dirty work.',
  '{name} projects as a dependable starter who fills every gap you give him.',
]

const DEPTH_ASSESS_TPLS = [
  '{name} can run second units as a backup playmaker, but I would not reach for him early.',
  '{name} can put up points off the bench, but I would not reach for him early.',
  '{name} brings energy and rim pressure off the bench, but I would not reach for him early.',
  '{name} can defend in a bench role, but I would not reach for him early.',
  '{name} offers bench shooting at the big spots, but I would not reach for him early.',
  '{name} can protect the rim in a bench role, but I would not reach for him early.',
  '{name} is a rotation big at best — I would not reach for him early.',
  '{name} is a depth piece — solid habits, limited ceiling.',
]

// Tier-only fallbacks when no archetype pattern matches the prospect.
const GENERIC_ASSESS_TPLS = {
  superstar: '{name} has franchise-cornerstone upside — a potential face of the league.',
  allstar: '{name} has genuine All-Star potential.',
  starter: '{name} projects as a long-term starter at the next level.',
  depth: '{name} projects as a depth piece — useful, but I would not reach for him early.',
}

// Priority overrides — the scout leads with the headline when there is one.
const GENERATIONAL_ASSESS_TPLS = [
  '{name} is a generational talent — prospects like this come along once a decade.',
  'Do whatever it takes to get {name} — he is the kind of prospect careers are built on.',
]

const HIDDEN_GEM_ASSESS_TPLS = [
  'The board is sleeping on {name} — my eye says his ceiling is far beyond the consensus.',
  'Do not let the projections fool you on {name} — there is real star upside buried here.',
]

// --- Sentence 2: team fit by building direction -------------------------------

const FIT_REBUILDING_TPLS = [
  'He would slot right into our rebuild — exactly the kind of piece to grow with our young core.',
  'For where we are as a franchise, he fits the timeline of our rebuild perfectly.',
  'We are building for tomorrow, and he is the type of prospect you rebuild around.',
]

const FIT_ASCENDING_TPLS = [
  'He fits our rising core — the timeline lines up with where this team is headed.',
  'A team on the way up needs prospects like him — he would grow right alongside our core.',
  'He would add another layer to a roster that is already ascending.',
]

const FIT_WIN_NOW_TPLS = [
  'For a win-now roster like ours, the question is how quickly he can contribute.',
  'We need help today — he would have to earn minutes fast to fit our push.',
  'He fits if he can play right away — this roster is built to win now.',
]

const FIT_CONTENDER_TPLS = [
  'On a title contender like us, he would need to step into a role from day one.',
  'We are chasing a championship — he is the kind of piece that rounds out a contender.',
  'For a contender like us, he is depth and insurance for the title push.',
]

// --- Optional tail: owner mandate --------------------------------------------

const OWNER_TAIL_TITLE_TPLS = [
  'And remember — ownership is demanding a title, so we cannot afford a miss.',
  'One more thing: ownership expects a championship, and draft mistakes are not forgiven upstairs.',
]

const OWNER_TAIL_PATIENT_TPLS = [
  'The good news: ownership is preaching patience, so there is room to let him develop.',
  'Ownership is giving us runway, so we can afford to be patient with his development.',
]

// --- Red flags (only with the scout's `red_flag_intel` perk active) -----------

const RED_FLAG_TPLS = {
  work_ethic: [
    'One red flag though: his work ethic is a real concern — do not expect him to outwork this class.',
    'Fair warning: the talent is real, but people around his program question his work ethic.',
  ],
  coachability: [
    'One red flag though: he is hard to coach — his staff had constant run-ins with him.',
    'Fair warning: he has a hothead streak and does not take coaching well.',
  ],
  composure: [
    'One red flag though: the intangibles are shaky — locker rooms have a way of finding that out.',
    'Fair warning: there are character questions here that the tape does not show.',
  ],
  decision_making: [
    'One red flag though: his decision-making lags well behind his physical tools.',
    'Fair warning: the feel for the game is not there yet — expect some rough decisions early.',
  ],
  durability: [
    'One red flag though: his body has a history — durability is a genuine concern.',
    'Fair warning: our medical people flagged his durability — plan his minutes carefully.',
  ],
  consistency: [
    'One red flag though: he runs hot and cold — you never know which version shows up.',
    'Fair warning: the consistency is not there — brilliant one night, invisible the next.',
  ],
  ball_dominant: [
    'One red flag though: he hunts his own shot and rarely moves the ball — a ball hog, plainly put.',
    'Fair warning: he plays with blinders on — teammates end up standing around watching him dribble.',
  ],
}

// --- Helpers ------------------------------------------------------------------

const DIRECTION_FIT = {
  title_contender: FIT_CONTENDER_TPLS,
  win_now: FIT_WIN_NOW_TPLS,
  ascending: FIT_ASCENDING_TPLS,
  rebuilding: FIT_REBUILDING_TPLS,
}

const ASSESS_BY_TIER = {
  superstar: SUPERSTAR_ASSESS_TPLS,
  allstar: ALLSTAR_ASSESS_TPLS,
  starter: STARTER_ASSESS_TPLS,
  depth: DEPTH_ASSESS_TPLS,
}

// djb2 hash — same prospect always gets the same synopsis (no Math.random in
// engine code; re-showing the toast must not reshuffle the scout's opinion).
function seedFromId(id) {
  let h = 5381
  const s = String(id ?? '')
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

// Numeric attribute read tolerant of old prospect shapes: canonical key first,
// then the legacy short-form some pre-schema rookies still carry.
function attrVal(player, category, key, legacyKey = null) {
  const cat = player?.attributes?.[category]
  if (!cat) return null
  const v = cat[key] ?? (legacyKey ? cat[legacyKey] : undefined)
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const RED_FLAG_THRESHOLD = 56
const BALL_DOMINANT_THRESHOLD = 50

// Worst buried concern in the revealed stats, or null when the prospect is
// clean. Deficit = how far below the flag's own threshold the value sits.
function detectWorstRedFlag(player) {
  const flags = []
  const push = (key, v, threshold = RED_FLAG_THRESHOLD) => {
    if (v != null && v <= threshold) flags.push({ key, deficit: threshold - v })
  }

  push('work_ethic', attrVal(player, 'mental', 'workEthic'))
  push('coachability', attrVal(player, 'mental', 'coachability'))
  push('composure', attrVal(player, 'mental', 'intangibles'))
  push('decision_making', attrVal(player, 'mental', 'basketballIQ'))
  push('durability', attrVal(player, 'physical', 'durability'))

  const oc = attrVal(player, 'offense', 'offensiveConsistency', 'consistency')
  const dc = attrVal(player, 'defense', 'defensiveConsistency', 'consistency')
  if (oc != null && dc != null) push('consistency', Math.round((oc + dc) / 2))

  // The "ball hog" read: both passing-feel attributes buried.
  const pv = attrVal(player, 'offense', 'passVision', 'passing')
  const piq = attrVal(player, 'offense', 'passIQ', 'passing')
  if (pv != null && piq != null && pv <= BALL_DOMINANT_THRESHOLD && piq <= BALL_DOMINANT_THRESHOLD) {
    push('ball_dominant', Math.max(pv, piq), BALL_DOMINANT_THRESHOLD)
  }

  if (flags.length === 0) return null
  flags.sort((a, b) => b.deficit - a.deficit)
  return flags[0].key
}

function potentialTier(player) {
  const pot = Number(
    player?.potentialRating ?? player?.potential_rating ?? player?.overallRating ?? player?.overall_rating ?? 70
  )
  if (pot >= 90) return 'superstar'
  if (pot >= 84) return 'allstar'
  if (pot >= 78) return 'starter'
  return 'depth'
}

/**
 * The scout's full report on a 100%-scouted prospect.
 *
 * @param {Object} p
 * @param {Object} p.player      - fully-scouted prospect record
 * @param {string} [p.direction] - title_contender | win_now | ascending | rebuilding
 * @param {string|null} [p.ownerTier] - effective owner expectation tier
 *   (rebuild | develop | playoffs | contender | championship)
 * @param {boolean} [p.includeRedFlags] - true only when the scout's
 *   `red_flag_intel` perk is active (perk present + facility level met)
 * @returns {{
 *   lines: Array<{text: string, tpl: string, params: Object|null}>,
 *   redFlag: {key: string, line: {text: string, tpl: string, params: null}}|null,
 *   text: string
 * }} `lines` = assessment + fit (+ owner tail); `redFlag` renders separately
 *   (badged) in the UI; `text` = full English fallback incl. the flag.
 */
export function buildScoutSynopsis({ player, direction, ownerTier = null, includeRedFlags = false } = {}) {
  const name = player?.firstName && player?.lastName
    ? `${player.firstName} ${player.lastName}`
    : player?.name || player?.playerName || 'This prospect'
  const seed = seedFromId(player?.id ?? name)
  const tier = potentialTier(player)

  // Sentence 1 — assessment (headline overrides first).
  let assessment
  if (player?.isGenerational ?? player?.is_generational) {
    assessment = T(GENERATIONAL_ASSESS_TPLS[seed % GENERATIONAL_ASSESS_TPLS.length], { name })
  } else if (player?.isHiddenGem ?? player?.is_hidden_gem) {
    assessment = T(HIDDEN_GEM_ASSESS_TPLS[seed % HIDDEN_GEM_ASSESS_TPLS.length], { name })
  } else {
    let profile = null
    try {
      const arch = detectArchetype(player)
      profile = arch ? ARCHETYPE_PROFILE[arch.id] : null
    } catch { /* malformed attributes → generic fallback */ }
    const idx = PROFILE_ORDER.indexOf(profile)
    assessment = idx >= 0
      ? T(ASSESS_BY_TIER[tier][idx], { name })
      : T(GENERIC_ASSESS_TPLS[tier], { name })
  }

  // Sentence 2 — team fit by direction (no params; complete sentences).
  const fitPool = DIRECTION_FIT[direction] || FIT_ASCENDING_TPLS
  const fit = T(fitPool[(seed >> 3) % fitPool.length])

  const lines = [assessment, fit]

  // Optional tail — only the loud mandates get a mention.
  if (ownerTier === 'championship') {
    lines.push(T(OWNER_TAIL_TITLE_TPLS[(seed >> 5) % OWNER_TAIL_TITLE_TPLS.length]))
  } else if (ownerTier === 'rebuild' || ownerTier === 'develop') {
    lines.push(T(OWNER_TAIL_PATIENT_TPLS[(seed >> 5) % OWNER_TAIL_PATIENT_TPLS.length]))
  }

  // Insider Intel red flag — separate from `lines` so the UI can badge it.
  let redFlag = null
  if (includeRedFlags) {
    const key = detectWorstRedFlag(player)
    if (key && RED_FLAG_TPLS[key]) {
      redFlag = { key, line: T(RED_FLAG_TPLS[key][(seed >> 7) % RED_FLAG_TPLS[key].length]) }
    }
  }

  const text = [...lines, ...(redFlag ? [redFlag.line] : [])].map((l) => l.text).join(' ')
  return { lines, redFlag, text }
}

export default { buildScoutSynopsis }
