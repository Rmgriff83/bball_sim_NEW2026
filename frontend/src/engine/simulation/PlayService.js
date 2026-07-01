import { PLAYS } from '../data/plays'

// ---------------------------------------------------------------------------
// Scheme weights
// ---------------------------------------------------------------------------

// Scheme → category multipliers. Selection is CATEGORY-FIRST (see selectPlay):
// we weight categories by these values, pick a category, then pick a play
// within it. That makes a scheme's signature category dominate regardless of
// how many plays each category happens to contain — adding more plays never
// dilutes a scheme's identity. Signature categories are weighted high enough
// that the hero category lands ~45-55% of half-court possessions.
//
// This is the SINGLE SOURCE OF TRUTH for scheme play weighting; CoachingEngine
// re-exports it (do not fork a second copy).
export const SCHEME_WEIGHTS = {
  motion: {
    motion: 3.5,
    cut: 1.5,
    pick_and_roll: 1.2,
    isolation: 0.5,
    post_up: 0.8,
    spot_up: 1.0,
    transition: 1.0,
  },
  iso_heavy: {
    isolation: 4.0,
    pick_and_roll: 1.2,
    post_up: 1.0,
    motion: 0.5,
    cut: 0.6,
    spot_up: 0.8,
    transition: 1.0,
  },
  post_centric: {
    post_up: 4.0,
    pick_and_roll: 1.0,
    cut: 1.2,
    isolation: 0.7,
    motion: 0.8,
    spot_up: 0.8,
    transition: 0.8,
  },
  three_point: {
    spot_up: 3.5,
    pick_and_roll: 1.5,
    motion: 1.3,
    isolation: 0.8,
    post_up: 0.5,
    cut: 1.0,
    transition: 1.2,
  },
  run_and_gun: {
    transition: 4.0,
    pick_and_roll: 1.3,
    spot_up: 1.2,
    isolation: 1.0,
    motion: 0.7,
    post_up: 0.5,
    cut: 0.8,
  },
  balanced: {
    // Truly even — no category emphasised over another. Keeps the Balanced
    // scheme varied in selection AND surfaces the full book in the playbook UI
    // (no above-neutral category → it shows everything).
    pick_and_roll: 1.0,
    isolation: 1.0,
    post_up: 1.0,
    motion: 1.0,
    cut: 1.0,
    spot_up: 1.0,
    transition: 1.0,
  },
}

// ---------------------------------------------------------------------------
// Coaching schemes metadata
// ---------------------------------------------------------------------------

const COACHING_SCHEMES = {
  balanced: 'Balanced offense with varied play selection',
  motion: 'Motion-heavy offense emphasizing ball movement and cuts',
  iso_heavy: 'Isolation-focused offense for star players',
  post_centric: 'Post-up heavy offense utilizing big men',
  three_point: 'Perimeter-oriented offense maximizing three-point attempts',
  run_and_gun: 'Fast-paced transition offense',
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the scheme weight map for a given coaching scheme name.
 * Falls back to "balanced" for unrecognised schemes.
 */
function getSchemeWeights(scheme) {
  return SCHEME_WEIGHTS[scheme] || SCHEME_WEIGHTS.balanced
}

/**
 * Calculate how well the lineup fits a play's primary-position requirements.
 * Returns 1.0 if at least one player in the lineup matches a primary position,
 * otherwise 0.5.
 */
function calculatePositionFit(play, lineup) {
  const primaryPositions = play.primaryPositions || []

  for (const player of lineup) {
    const position = player.position ?? 'SF'
    if (primaryPositions.includes(position)) {
      return 1.0
    }
  }

  return 0.5
}

/**
 * Average basketball IQ across a lineup (array of player objects).
 * Expects each player to have attributes.mental.basketballIQ.
 */
function calculateAverageIQ(lineup) {
  let totalIQ = 0
  let count = 0

  for (const player of lineup) {
    const iq = player?.attributes?.mental?.basketballIQ ?? 50
    totalIQ += iq
    count++
  }

  return count > 0 ? totalIQ / count : 50
}

/**
 * Boost play selection weight for big-man plays based on the best big's talent.
 * For facilitator-tagged plays, uses passVision; for scoring plays, uses overall rating.
 */
function calculateBigManBoost(play, lineup) {
  const bigPrimary = (play.primaryPositions || []).some(p => p === 'C' || p === 'PF')
  const bigCategory = play.category === 'post_up'

  if (!bigPrimary && !bigCategory) return 1.0

  const isFacilitatorPlay = (play.tags || []).includes('facilitator')

  let bestValue = 0
  for (const player of lineup) {
    const pos = player.position ?? 'SF'
    if (pos !== 'C' && pos !== 'PF') continue

    if (isFacilitatorPlay) {
      const passVision = player.attributes?.offense?.passVision ?? 50
      if (passVision > bestValue) bestValue = passVision
    } else {
      const rating = player.overall_rating ?? player.overallRating ?? 70
      if (rating > bestValue) bestValue = rating
    }
  }

  if (bestValue === 0) return 1.0

  if (isFacilitatorPlay) {
    // passVision threshold: 75+, scale 0.025 per point (85=1.25x, 95=1.5x)
    if (bestValue < 75) return 1.0
    return 1.0 + (bestValue - 75) * 0.025
  } else {
    // Overall rating threshold: 80+, scale 0.02 per point (90=1.2x, 97=1.34x)
    if (bestValue < 80) return 1.0
    return 1.0 + (bestValue - 80) * 0.02
  }
}

/**
 * Boost play selection weight for guard-oriented plays based on the best guard's talent.
 * Slightly lower coefficient than bigs since guards already benefit from more plays.
 */
function calculateGuardBoost(play, lineup) {
  const guardPrimary = (play.primaryPositions || []).some(p => p === 'PG' || p === 'SG')

  if (!guardPrimary) return 1.0

  let bestGuardRating = 0
  for (const player of lineup) {
    const pos = player.position ?? 'SF'
    if (pos !== 'PG' && pos !== 'SG') continue
    const rating = player.overall_rating ?? player.overallRating ?? 70
    if (rating > bestGuardRating) bestGuardRating = rating
  }

  if (bestGuardRating < 80) return 1.0
  return 1.0 + (bestGuardRating - 80) * 0.015
}

/**
 * Weighted random selection from an array of { play, weight } objects.
 * Returns the selected play object.
 */
function weightedRandomSelect(weightedItems) {
  const totalWeight = weightedItems.reduce((sum, item) => sum + item.weight, 0)

  if (totalWeight <= 0) {
    return weightedItems[0]?.play ?? PLAYS[0]
  }

  const random = Math.random() * totalWeight
  let cumulative = 0

  for (const item of weightedItems) {
    cumulative += item.weight
    if (random <= cumulative) {
      return item.play
    }
  }

  // Fallback – return the last item
  return weightedItems[weightedItems.length - 1].play
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a specific play by its ID.
 * @param {string} playId
 * @returns {object|null}
 */
export function getPlay(playId) {
  return PLAYS.find((p) => p.id === playId) ?? null
}

/**
 * Get all plays matching a category.
 * @param {string} category
 * @returns {object[]}
 */
export function getPlaysByCategory(category) {
  return PLAYS.filter((p) => p.category === category)
}

/**
 * Get plays that contain ALL specified tags.
 * @param {string[]} tags
 * @returns {object[]}
 */
export function getPlaysByTags(tags) {
  return PLAYS.filter((play) => {
    const playTags = play.tags || []
    return tags.every((tag) => playTags.includes(tag))
  })
}

/**
 * Get plays matching a given tempo (halfcourt, transition, fastbreak).
 * @param {string} tempo
 * @returns {object[]}
 */
export function getPlaysByTempo(tempo) {
  return PLAYS.filter((p) => p.tempo === tempo)
}

/**
 * Get an action from a play by action ID.
 * @param {object} play
 * @param {string} actionId
 * @returns {object|null}
 */
export function getAction(play, actionId) {
  if (!play?.actions) return null
  return play.actions.find((a) => a.id === actionId) ?? null
}

/**
 * Return the map of available coaching schemes and their descriptions.
 * @returns {object}
 */
export function getCoachingSchemes() {
  return { ...COACHING_SCHEMES }
}

/**
 * Select a play based on game situation and team composition.
 *
 * @param {object[]} offensiveLineup  – Array of player objects on offense
 * @param {object[]} defensiveLineup  – Array of player objects on defense
 * @param {string}   coachingScheme   – One of the coaching scheme keys
 * @param {object}   [context={}]     – Situational context
 * @param {boolean}  [context.isTransition=false]
 * @param {number}   [context.shotClock=24]
 * @param {number}   [context.scoreDifferential=0]
 * @returns {object} The selected play
 */
export function selectPlay(offensiveLineup, defensiveLineup, coachingScheme, context = {}) {
  const isTransition = context.isTransition ?? false
  const shotClock = context.shotClock ?? 24
  const scoreDifferential = context.scoreDifferential ?? 0

  // --- Filter by tempo ---
  let eligiblePlays
  if (isTransition) {
    eligiblePlays = PLAYS.filter((p) => p.tempo === 'transition' || p.tempo === 'fastbreak')
  } else {
    eligiblePlays = PLAYS.filter((p) => p.tempo === 'halfcourt')
  }

  // If no plays available for the tempo, fall back to all plays
  if (eligiblePlays.length === 0) {
    eligiblePlays = [...PLAYS]
  }

  const schemeWeights = getSchemeWeights(coachingScheme)
  const avgIQ = calculateAverageIQ(offensiveLineup)

  // --- Stage 1: pick a CATEGORY weighted by the scheme ---
  // Group eligible plays by category, weight each category by the scheme
  // multiplier × situational nudges. Category-first keeps a scheme's signature
  // category dominant no matter how many plays it holds.
  const byCategory = {}
  for (const play of eligiblePlays) {
    if (!byCategory[play.category]) byCategory[play.category] = []
    byCategory[play.category].push(play)
  }

  const weightedCategories = []
  for (const [category, plays] of Object.entries(byCategory)) {
    let weight = schemeWeights[category] !== undefined ? schemeWeights[category] : 1.0

    // Late shot clock favours quick-hitter categories
    if (shotClock < 8 && (category === 'isolation' || category === 'spot_up')) {
      weight *= 1.5
    }
    // When behind, lean into iso / three-heavy looks
    if (scoreDifferential < -10 && category === 'isolation') {
      weight *= 1.3
    }

    weightedCategories.push({ category, plays, weight })
  }

  const chosenCategory = weightedRandomSelectBy(weightedCategories, (c) => c.weight)
  const categoryPlays = chosenCategory?.plays ?? eligiblePlays

  // --- Stage 2: pick a PLAY within the category by lineup fit ---
  const weightedPlays = categoryPlays.map((play) => ({
    play,
    weight: playFitWeight(play, offensiveLineup, avgIQ, scoreDifferential),
  }))

  return weightedRandomSelect(weightedPlays)
}

/**
 * Per-play weight from lineup fit only (no scheme-category multiplier) — used
 * to pick within an already-chosen category. Floored so every play is possible.
 */
function playFitWeight(play, offensiveLineup, avgIQ, scoreDifferential = 0) {
  let weight = 1.0
  weight *= calculatePositionFit(play, offensiveLineup)
  weight *= calculateBigManBoost(play, offensiveLineup)
  weight *= calculateGuardBoost(play, offensiveLineup)
  const difficultyPenalty = Math.max(0.5, 1 - (play.difficulty - avgIQ) / 100)
  weight *= difficultyPenalty
  // When trailing, nudge three-point-tagged plays within the category.
  if (scoreDifferential < -10 && play.tags && play.tags.includes('three_point')) {
    weight *= 1.2
  }
  return Math.max(0.05, weight)
}

/**
 * Generic weighted random selection over arbitrary items using a weight accessor.
 */
function weightedRandomSelectBy(items, getWeight) {
  if (!items || items.length === 0) return null
  const total = items.reduce((sum, it) => sum + Math.max(0, getWeight(it)), 0)
  if (total <= 0) return items[0]
  let r = Math.random() * total
  for (const it of items) {
    r -= Math.max(0, getWeight(it))
    if (r <= 0) return it
  }
  return items[items.length - 1]
}

/**
 * Build a scheme's playbook for the UI: the categories the scheme favours
 * (weight > 1, i.e. emphasised) in descending weight order, each with its
 * plays. Shares SCHEME_WEIGHTS with selectPlay so what's shown matches what's
 * run. Categories with no plays are skipped.
 *
 * @param {string} scheme
 * @returns {{ category: string, weight: number, plays: object[] }[]}
 */
export function getSchemePlaybook(scheme) {
  const weights = getSchemeWeights(scheme)
  const byCategory = {}
  for (const play of PLAYS) {
    if (!byCategory[play.category]) byCategory[play.category] = []
    byCategory[play.category].push(play)
  }
  return Object.entries(byCategory)
    .map(([category, plays]) => ({
      category,
      weight: weights[category] ?? 1.0,
      plays,
    }))
    .sort((a, b) => b.weight - a.weight)
}
