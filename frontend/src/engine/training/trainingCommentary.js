// =============================================================================
// trainingCommentary.js — flavor lines for the rich "training complete" toast.
// =============================================================================
// Pure, deterministic, template-based (mirrors scoutSynopsis.js). One line per
// claimed training reward, varied by the awarded badge tier, plus an extra
// callout line when the staff trainer's Breakthrough Training perk procced.
//
// Every line is built via T() (commentaryTemplate.js) so callers receive
// { text, tpl, params } and the UI renders via $tDynamic(tpl, params) with
// fallback to the English string. Never persisted (toast-time only).
// The `{badge}` param is the badge's ALREADY-TRANSLATED display name (the
// caller runs it through tDynamic first) — params are interpolated after the
// template lookup, exactly like proper-noun player names. Tier words are
// baked into each pool's complete sentences, never interpolated.
// The `*_TPLS` naming is load-bearing: wl-i18n.config.js regex-extracts the
// quoted strings of these const blocks (closing bracket at column 0).
// =============================================================================

import { T } from '@/engine/simulation/commentaryTemplate'

const BRONZE_TRAIN_TPLS = [
  '{name} put in the reps and picked up the fundamentals of {badge}.',
  'Solid session — {name} has the makings of {badge} in his game now.',
  'The staff drilled it all week and {name} walked away with {badge}.',
  '{name} ground through the session and added {badge} to his toolkit.',
]

const SILVER_TRAIN_TPLS = [
  '{name} sharpened his {badge} skills to a genuinely reliable level.',
  'Strong work — {badge} is becoming second nature for {name}.',
  'The film room paid off: {name} leveled up his {badge} game.',
  '{name} took a real step forward with {badge} this session.',
]

const GOLD_TRAIN_TPLS = [
  'Special session — {badge} is now a genuine weapon for {name}.',
  '{name} mastered the finer points of {badge}. Opponents will notice.',
  'Elite work: {name} pushed his {badge} craft to a gold standard.',
  'The coaches ran out of things to teach — {name} owns {badge} now.',
]

const HOF_TRAIN_TPLS = [
  'Historic session — {name} elevated {badge} to a Hall of Fame level.',
  '{badge} at this level puts {name} in rare company around the league.',
  'The gym went quiet watching {name} perfect {badge}. All-time stuff.',
]

const BREAKTHROUGH_SILVER_TPLS = [
  'A breakthrough in the gym pushed the result straight to Silver.',
  'The training plan clicked — {name} skipped ahead to Silver.',
]

const BREAKTHROUGH_GOLD_TPLS = [
  'A stunning breakthrough sent the result all the way to Gold.',
  'Everything clicked at once — {name} vaulted straight to Gold.',
]

const LEVEL_POOLS = {
  bronze: BRONZE_TRAIN_TPLS,
  silver: SILVER_TRAIN_TPLS,
  gold: GOLD_TRAIN_TPLS,
  hof: HOF_TRAIN_TPLS,
}

const BREAKTHROUGH_POOLS = {
  silver: BREAKTHROUGH_SILVER_TPLS,
  gold: BREAKTHROUGH_GOLD_TPLS,
}

// djb2 hash — same claim always produces the same lines (no Math.random in
// engine code; a re-rendered toast must not reshuffle its copy).
function seedFrom(str) {
  let h = 5381
  const s = String(str ?? '')
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

/**
 * Flavor line for the training-complete toast.
 * @param {Object} p
 * @param {string} p.playerName - trainee's full name (proper noun)
 * @param {string} p.badge      - TRANSLATED badge display name
 * @param {string} p.level      - awarded tier: bronze|silver|gold|hof
 * @param {string} [p.seedKey]  - stable per-claim seed (playerId|badgeId|level)
 * @returns {{ text: string, tpl: string, params: Object }}
 */
export function buildTrainingFlavor({ playerName, badge, level, seedKey = '' }) {
  const pool = LEVEL_POOLS[level] ?? BRONZE_TRAIN_TPLS
  const seed = seedFrom(seedKey || `${playerName}|${level}`)
  return T(pool[seed % pool.length], { name: playerName, badge })
}

/**
 * Extra callout when the Breakthrough Training perk procced.
 * @param {Object} p
 * @param {string} p.playerName
 * @param {string} p.perkProc - 'silver' | 'gold'
 * @param {string} [p.seedKey]
 * @returns {{ text: string, tpl: string, params: Object }|null}
 */
export function buildBreakthroughLine({ playerName, perkProc, seedKey = '' }) {
  const pool = BREAKTHROUGH_POOLS[perkProc]
  if (!pool) return null
  const seed = seedFrom(`${seedKey}|${perkProc}`)
  return T(pool[(seed >> 3) % pool.length], { name: playerName })
}

export default { buildTrainingFlavor, buildBreakthroughLine }
