// =============================================================================
// CoachStrategyService
// =============================================================================
// Picks a sensible offensive + defensive + substitution scheme for a team
// based on roster fit. Used by:
//   - CampaignManager.createCampaign    (initial assignment for all 30 teams)
//   - CampaignManager.startNewSeason    (yearly re-evaluation for AI teams,
//                                        and as a fallback for user teams
//                                        whose scheme is missing/invalid)
//   - stores/team.js:hireCoach          (refresh user team after coach change)
//
// All returned scheme keys MUST match the canonical maps in
// `simulation/CoachingEngine.js` — the simulator looks them up directly, so
// any unknown key silently falls back to defaults and the scheme has no
// effect. Previously CampaignManager picked from `data/coaches.js` arrays
// via `pickRandom(Object.keys(arr))`, which returns array INDICES like
// "0", "1" — those never matched a real scheme and the simulator was running
// on defaults regardless of the "Coach Settings" UI.
// =============================================================================

import { OFFENSIVE_SCHEMES, DEFENSIVE_SCHEMES } from '../simulation/CoachingEngine'

const DEFAULT_OFFENSIVE = 'balanced'
const DEFAULT_DEFENSIVE = 'man'
const DEFAULT_SUB_STRATEGY = 'staggered'

// Roster-fit thresholds. Tuned to roughly match how the league looks on
// generated rosters — most teams settle on `motion` or `balanced` offense
// and `man` defense, with the more specialised schemes reserved for teams
// whose personnel clearly fits them. Conservative on purpose: we'd rather
// pick a safe scheme than have every team default to `three_point` because
// one cutoff was a little too low.

function _attr(player, category, key) {
  const v = player?.attributes?.[category]?.[key]
  return typeof v === 'number' ? v : 0
}

function _avg(values) {
  if (!values || values.length === 0) return 0
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

function _topN(values, n) {
  return [...values].sort((a, b) => b - a).slice(0, n)
}

function _summarizeRoster(roster) {
  // Use a "core" subset (top 10 by overall) so the heuristic isn't dragged
  // around by 14th-man fillers. Falls back to whatever's available for very
  // small rosters.
  const players = (roster || []).filter(Boolean)
  const sorted = [...players].sort((a, b) => {
    const ar = a.overallRating ?? a.overall_rating ?? 0
    const br = b.overallRating ?? b.overall_rating ?? 0
    return br - ar
  })
  const core = sorted.slice(0, Math.min(10, sorted.length))
  if (core.length === 0) return null

  const threePoints = core.map(p => _attr(p, 'offense', 'threePoint'))
  const ballHandlings = core.map(p => _attr(p, 'offense', 'ballHandling'))
  const shotIQs = core.map(p => _attr(p, 'offense', 'shotIQ'))
  const passAccuracies = core.map(p => _attr(p, 'offense', 'passAccuracy'))
  const passVisions = core.map(p => _attr(p, 'offense', 'passVision'))
  const speeds = core.map(p => _attr(p, 'physical', 'speed'))
  const accelerations = core.map(p => _attr(p, 'physical', 'acceleration'))
  const staminas = core.map(p => _attr(p, 'physical', 'stamina'))
  const hustles = core.map(p => _attr(p, 'physical', 'hustle'))
  const postHooks = core.map(p => _attr(p, 'offense', 'postHook'))
  const postControls = core.map(p => _attr(p, 'offense', 'postControl'))
  const interiorDefs = core.map(p => _attr(p, 'defense', 'interiorDefense'))
  const perimeterDefs = core.map(p => _attr(p, 'defense', 'perimeterDefense'))
  const blocks = core.map(p => _attr(p, 'defense', 'block'))
  const steals = core.map(p => _attr(p, 'defense', 'steal'))
  const basketballIQs = core.map(p => _attr(p, 'mental', 'basketballIQ'))

  return {
    threePointAvg: _avg(threePoints),
    threePointShootersCount: threePoints.filter(v => v >= 72).length,
    bestCreator: Math.max(...ballHandlings.map((bh, i) => bh + shotIQs[i])),
    bestPostScorer: Math.max(...postHooks.map((ph, i) => ph + postControls[i])),
    passingAvg: (_avg(passAccuracies) + _avg(passVisions) + _avg(basketballIQs)) / 3,
    speedAvg: _avg(speeds),
    accelerationAvg: _avg(accelerations),
    staminaAvg: _avg(staminas),
    hustleAvg: _avg(hustles),
    interiorDefAvg: _avg(interiorDefs),
    perimeterDefAvg: _avg(perimeterDefs),
    bestBlocker: Math.max(...blocks),
    stealAvg: _avg(steals),
    topStealersCount: _topN(steals, 5).filter(v => v >= 72).length,
  }
}

function _pickOffensive(summary, coach) {
  if (!summary) return DEFAULT_OFFENSIVE

  // Order matters — the first match wins. Pace-driven schemes are checked
  // before pure-attribute schemes because a team that's both fast AND can
  // shoot is usually best served by `run_and_gun`.
  if (summary.speedAvg >= 78 && summary.accelerationAvg >= 76 && summary.staminaAvg >= 75) {
    return 'run_and_gun'
  }
  if (summary.threePointAvg >= 74 && summary.threePointShootersCount >= 4) {
    return 'three_point'
  }
  if (summary.bestPostScorer >= 150) {
    return 'post_centric'
  }
  if (summary.bestCreator >= 165) {
    return 'iso_heavy'
  }
  if (summary.passingAvg >= 72) {
    return 'motion'
  }

  // Coach preference can break ties when none of the personnel cutoffs are
  // strongly met — but only if the coach's stamped preference is a real
  // CoachingEngine key (legacy generated coaches stamped array indices).
  const coachOff = coach?.offensiveScheme ?? coach?.offensive_scheme
  if (coachOff && OFFENSIVE_SCHEMES[coachOff]) return coachOff

  return DEFAULT_OFFENSIVE
}

function _pickDefensive(summary, coach) {
  if (!summary) return DEFAULT_DEFENSIVE

  if (summary.speedAvg >= 78 && summary.staminaAvg >= 76 && summary.topStealersCount >= 3) {
    return 'press'
  }
  if (summary.stealAvg >= 73 && summary.hustleAvg >= 74) {
    return 'trap'
  }
  if (summary.interiorDefAvg >= 75 && summary.bestBlocker >= 78) {
    return 'zone_2_3'
  }
  if (summary.perimeterDefAvg >= 76) {
    return 'zone_3_2'
  }

  const coachDef = coach?.defensiveScheme ?? coach?.defensive_scheme
  if (coachDef && DEFENSIVE_SCHEMES[coachDef]) return coachDef

  return DEFAULT_DEFENSIVE
}

/**
 * True when the scheme keys on a `coaching_scheme` object are recognised by
 * the simulator. Used to skip auto-init when the user has explicitly chosen
 * settings (don't overwrite manual selections) while still fixing teams
 * whose stored scheme is garbage (e.g. legacy "0"/"1" from the broken
 * random-pick in generateCoach).
 */
export function isCoachingSchemeValid(scheme) {
  if (!scheme || typeof scheme !== 'object') return false
  if (!OFFENSIVE_SCHEMES[scheme.offensive]) return false
  if (!DEFENSIVE_SCHEMES[scheme.defensive]) return false
  return true
}

/**
 * Pick a `coaching_scheme` object for a team given its roster and head coach.
 * Returns `{ offensive, defensive, substitution }` with keys that match the
 * canonical maps in `CoachingEngine.js`.
 *
 * Pure function — no IndexedDB writes. Callers are responsible for persisting
 * the result via TeamRepository.
 */
export function selectBestCoachingScheme(roster, coach, existing = null) {
  const summary = _summarizeRoster(roster)
  const offensive = _pickOffensive(summary, coach)
  const defensive = _pickDefensive(summary, coach)
  const substitution = existing?.substitution || DEFAULT_SUB_STRATEGY
  return { offensive, defensive, substitution }
}
