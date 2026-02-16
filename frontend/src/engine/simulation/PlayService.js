import { PLAYS } from '../data/plays'

// ---------------------------------------------------------------------------
// Scheme weights
// ---------------------------------------------------------------------------

const SCHEME_WEIGHTS = {
  motion: {
    motion: 2.0,
    cut: 1.5,
    pick_and_roll: 1.2,
    isolation: 0.5,
    post_up: 0.8,
    spot_up: 1.0,
    transition: 1.0,
  },
  iso_heavy: {
    isolation: 2.5,
    pick_and_roll: 1.2,
    post_up: 1.0,
    motion: 0.5,
    cut: 0.6,
    spot_up: 0.8,
    transition: 1.0,
  },
  post_centric: {
    post_up: 2.5,
    pick_and_roll: 1.0,
    cut: 1.2,
    isolation: 0.7,
    motion: 0.8,
    spot_up: 0.8,
    transition: 0.8,
  },
  three_point: {
    spot_up: 2.0,
    pick_and_roll: 1.5,
    motion: 1.3,
    isolation: 0.8,
    post_up: 0.5,
    cut: 1.0,
    transition: 1.2,
  },
  run_and_gun: {
    transition: 2.5,
    pick_and_roll: 1.3,
    spot_up: 1.2,
    isolation: 1.0,
    motion: 0.7,
    post_up: 0.5,
    cut: 0.8,
  },
  balanced: {
    pick_and_roll: 1.2,
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

  // --- Scheme weights ---
  const schemeWeights = getSchemeWeights(coachingScheme)

  // --- Calculate weighted probabilities ---
  const weightedPlays = []

  for (const play of eligiblePlays) {
    let weight = 1.0

    // Apply scheme weight by category
    if (schemeWeights[play.category] !== undefined) {
      weight *= schemeWeights[play.category]
    }

    // Position fit bonus
    weight *= calculatePositionFit(play, offensiveLineup)

    // Difficulty penalty based on average basketball IQ
    const avgIQ = calculateAverageIQ(offensiveLineup)
    const difficultyPenalty = Math.max(0.5, 1 - (play.difficulty - avgIQ) / 100)
    weight *= difficultyPenalty

    // Late shot clock favours quicker plays
    if (shotClock < 8) {
      if (play.category === 'isolation' || play.category === 'spot_up') {
        weight *= 1.5
      }
    }

    // When behind, favour higher-risk / reward plays
    if (scoreDifferential < -10) {
      if (play.category === 'isolation' || (play.tags && play.tags.includes('three_point'))) {
        weight *= 1.3
      }
    }

    weightedPlays.push({ play, weight })
  }

  // --- Weighted random selection ---
  return weightedRandomSelect(weightedPlays)
}
