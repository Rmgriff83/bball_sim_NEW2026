/**
 * CoachingEngine.js
 *
 * Translated from backend CoachingService.php.
 * Handles offensive/defensive coaching schemes, play weight adjustments,
 * tempo modifiers, transition frequency, scheme recommendations, and
 * defensive modifier calculations.
 *
 * All game logic and math preserved exactly from the PHP source.
 */

// import { } from '../config/GameConfig.js'

// ---------------------------------------------------------------------------
// Offensive Schemes
// ---------------------------------------------------------------------------

export const OFFENSIVE_SCHEMES = {
  balanced: {
    name: 'Balanced',
    description: 'Balanced offense with varied play selection based on matchups',
    pace: 'medium',
    strengths: ['versatility', 'adaptability'],
    weaknesses: ['no dominant strategy'],
  },
  motion: {
    name: 'Motion Offense',
    description: 'Motion-heavy offense emphasizing ball movement, screens, and cuts',
    pace: 'medium',
    strengths: ['ball movement', 'open shots', 'team chemistry'],
    weaknesses: ['requires high IQ players', 'takes time to develop'],
  },
  iso_heavy: {
    name: 'Isolation Heavy',
    description: 'Isolation-focused offense maximizing star player usage',
    pace: 'slow',
    strengths: ['star players shine', 'late game execution'],
    weaknesses: ['predictable', 'role players underutilized'],
  },
  post_centric: {
    name: 'Post Centric',
    description: 'Post-up heavy offense utilizing big men as primary scorers',
    pace: 'slow',
    strengths: ['physical play', 'rebounding', 'free throws'],
    weaknesses: ['spacing issues', 'slower pace'],
  },
  three_point: {
    name: 'Three-Point Oriented',
    description: 'Perimeter-oriented offense maximizing three-point attempts',
    pace: 'fast',
    strengths: ['high scoring potential', 'floor spacing'],
    weaknesses: ['variance', 'cold shooting nights'],
  },
  run_and_gun: {
    name: 'Run and Gun',
    description: 'Fast-paced transition offense pushing tempo at every opportunity',
    pace: 'very_fast',
    strengths: ['fast break points', 'tiring opponents'],
    weaknesses: ['turnovers', 'defensive lapses'],
  },
}

// ---------------------------------------------------------------------------
// Defensive Schemes
// Note: Modifiers reduced ~15% from original to favor offense slightly.
// ---------------------------------------------------------------------------

export const DEFENSIVE_SCHEMES = {
  man: {
    name: 'Man-to-Man',
    description: 'Traditional man-to-man defense with strong individual matchups',
    modifiers: {
      iso_defense: 0.10,
      screen_vulnerability: -0.08,
      contest_boost: 0.04,
      steal_boost: 0.025,
    },
    weaknesses: ['pick_and_roll', 'motion'],
    strengths: ['isolation', 'post_up'],
  },
  zone_2_3: {
    name: '2-3 Zone',
    description: 'Zone defense protecting the paint with two guards up top and three bigs below',
    modifiers: {
      paint_protection: 0.12,
      corner_three_weakness: -0.10,
      block_boost: 0.06,
    },
    weaknesses: ['spot_up', 'corner_three'],
    strengths: ['post_up', 'drive'],
  },
  zone_3_2: {
    name: '3-2 Zone',
    description: 'Zone defense with three players up top to contest perimeter shots',
    modifiers: {
      perimeter_protection: 0.08,
      high_post_weakness: -0.08,
    },
    weaknesses: ['high_post', 'cut'],
    strengths: ['three_point', 'spot_up'],
  },
  zone_1_3_1: {
    name: '1-3-1 Zone',
    description: 'Aggressive trapping zone that forces turnovers but vulnerable to skip passes',
    modifiers: {
      turnover_boost: 0.06,
      skip_pass_weakness: -0.12,
      steal_boost: 0.08,
    },
    weaknesses: ['skip_pass', 'wing_three'],
    strengths: ['isolation'],
  },
  press: {
    name: 'Full Court Press',
    description: 'High-pressure full court defense forcing turnovers but risky in transition',
    modifiers: {
      turnover_boost: 0.10,
      transition_weakness: -0.17,
      steal_boost: 0.06,
    },
    weaknesses: ['transition', 'fastbreak'],
    strengths: ['slow_offense'],
  },
  trap: {
    name: 'Trapping Defense',
    description: 'Double-team oriented defense creating steals but leaving shooters open',
    modifiers: {
      steal_boost: 0.10,
      open_shooter_weakness: -0.12,
      turnover_boost: 0.05,
    },
    weaknesses: ['spot_up', 'corner_three'],
    strengths: ['isolation'],
  },
}

// ---------------------------------------------------------------------------
// Play-weight maps per offensive scheme
// ---------------------------------------------------------------------------

const SCHEME_PLAY_WEIGHTS = {
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
// Tempo modifiers (affects pace of play)
// ---------------------------------------------------------------------------

const TEMPO_MODIFIERS = {
  run_and_gun: 1.3,    // Faster possessions
  three_point: 1.1,    // Slightly faster
  balanced: 1.0,       // Normal pace
  motion: 0.95,        // Slightly slower (more passes)
  iso_heavy: 0.9,      // Slower (work the clock)
  post_centric: 0.85,  // Slowest (feed the post)
}

// ---------------------------------------------------------------------------
// Transition frequencies
// ---------------------------------------------------------------------------

const TRANSITION_FREQUENCIES = {
  run_and_gun: 0.4,    // Push frequently
  three_point: 0.25,   // Sometimes push
  balanced: 0.2,       // Normal
  motion: 0.15,        // Prefer halfcourt
  iso_heavy: 0.15,     // Prefer halfcourt
  post_centric: 0.1,   // Rarely push
}

// ---------------------------------------------------------------------------
// CoachingEngine class
// ---------------------------------------------------------------------------

export class CoachingEngine {

  // -----------------------------------------------------------------------
  // Offensive scheme queries
  // -----------------------------------------------------------------------

  /**
   * Get all available offensive coaching schemes.
   * @returns {Object} Map of scheme id -> scheme data
   */
  getSchemes() {
    return OFFENSIVE_SCHEMES
  }

  /**
   * Get a specific offensive scheme by ID.
   * @param {string} schemeId
   * @returns {Object|null}
   */
  getScheme(schemeId) {
    return OFFENSIVE_SCHEMES[schemeId] ?? null
  }

  // -----------------------------------------------------------------------
  // Play-weight helpers
  // -----------------------------------------------------------------------

  /**
   * Get play-category weights for a given offensive scheme.
   * @param {string} scheme
   * @returns {Object} category -> weight
   */
  getSchemePlayWeights(scheme) {
    return SCHEME_PLAY_WEIGHTS[scheme] ?? SCHEME_PLAY_WEIGHTS.balanced
  }

  /**
   * Attach scheme-adjusted weights to an array of plays.
   * @param {Array} plays  - array of play objects (each must have a `category`)
   * @param {string} scheme
   * @returns {Array} array of { play, weight }
   */
  adjustPlayProbabilities(plays, scheme) {
    const weights = this.getSchemePlayWeights(scheme)
    return plays.map(play => {
      const category = play.category ?? 'motion'
      const weight = weights[category] ?? 1.0
      return { play, weight }
    })
  }

  /**
   * Check whether a scheme favors a certain play category (weight >= 1.5).
   * @param {string} scheme
   * @param {string} category
   * @returns {boolean}
   */
  schemeFavorsCategory(scheme, category) {
    const weights = this.getSchemePlayWeights(scheme)
    return (weights[category] ?? 1.0) >= 1.5
  }

  // -----------------------------------------------------------------------
  // Tempo & transition
  // -----------------------------------------------------------------------

  /**
   * Get the tempo modifier for a scheme (multiplier on possession pace).
   * @param {string} scheme
   * @returns {number}
   */
  getTempoModifier(scheme) {
    return TEMPO_MODIFIERS[scheme] ?? 1.0
  }

  /**
   * Get the transition play frequency for a scheme (0-1 probability).
   * @param {string} scheme
   * @returns {number}
   */
  getTransitionFrequency(scheme) {
    return TRANSITION_FREQUENCIES[scheme] ?? 0.2
  }

  // -----------------------------------------------------------------------
  // Defensive scheme queries
  // -----------------------------------------------------------------------

  /**
   * Get all available defensive schemes.
   * @returns {Object}
   */
  getDefensiveSchemes() {
    return DEFENSIVE_SCHEMES
  }

  /**
   * Get a specific defensive scheme by ID.
   * @param {string} schemeId
   * @returns {Object|null}
   */
  getDefensiveScheme(schemeId) {
    return DEFENSIVE_SCHEMES[schemeId] ?? null
  }

  // -----------------------------------------------------------------------
  // Defensive modifier calculation
  // -----------------------------------------------------------------------

  /**
   * Calculate defensive modifiers based on scheme and the play being run.
   *
   * Returns an object with:
   *   shotModifier      - applied to made-shot probability (negative = harder to score)
   *   turnoverModifier  - applied to turnover probability  (positive = more turnovers)
   *   blockModifier     - applied to block probability      (positive = more blocks)
   *   stealModifier     - applied to steal probability      (positive = more steals)
   *
   * @param {string} scheme  - defensive scheme ID
   * @param {Object} play    - the offensive play object (needs at least `category`)
   * @returns {{ shotModifier: number, turnoverModifier: number, blockModifier: number, stealModifier: number }}
   */
  calculateDefensiveModifiers(scheme, play) {
    const schemeData = DEFENSIVE_SCHEMES[scheme] ?? DEFENSIVE_SCHEMES.man
    const playCategory = play.category ?? 'motion'

    const modifiers = {
      shotModifier: 0.0,
      turnoverModifier: 0.0,
      blockModifier: 0.0,
      stealModifier: 0.0,
    }

    const sm = schemeData.modifiers ?? {}

    // Apply base modifiers from scheme
    if (sm.block_boost !== undefined) {
      modifiers.blockModifier += sm.block_boost
    }
    if (sm.steal_boost !== undefined) {
      modifiers.stealModifier += sm.steal_boost
    }
    if (sm.turnover_boost !== undefined) {
      modifiers.turnoverModifier += sm.turnover_boost
    }

    // Check if play exploits scheme weakness
    const weaknesses = schemeData.weaknesses ?? []
    const strengths = schemeData.strengths ?? []

    if (weaknesses.includes(playCategory)) {
      // Play is strong against this defense
      modifiers.shotModifier += 0.10       // +10% shooting (boosted for offense)
      modifiers.turnoverModifier -= 0.06   // -6% turnovers
    }

    if (strengths.includes(playCategory)) {
      // Defense is strong against this play (reduced impact for offense)
      modifiers.shotModifier -= 0.07       // -7% shooting (was -10%)
      modifiers.turnoverModifier += 0.04   // +4% turnovers (was +5%)
    }

    // Apply specific modifiers based on play type
    if (playCategory === 'isolation' && sm.iso_defense !== undefined) {
      modifiers.shotModifier -= sm.iso_defense
    }

    if (
      (playCategory === 'pick_and_roll' || playCategory === 'motion') &&
      sm.screen_vulnerability !== undefined
    ) {
      modifiers.shotModifier -= sm.screen_vulnerability
    }

    if (playCategory === 'post_up' && sm.paint_protection !== undefined) {
      modifiers.shotModifier -= sm.paint_protection
      modifiers.blockModifier += 0.05
    }

    if (
      (playCategory === 'spot_up' || playCategory === 'three_point') &&
      sm.corner_three_weakness !== undefined
    ) {
      modifiers.shotModifier -= sm.corner_three_weakness
    }

    if (playCategory === 'transition' && sm.transition_weakness !== undefined) {
      modifiers.shotModifier -= sm.transition_weakness
    }

    // Contest boost applies to all shots
    if (sm.contest_boost !== undefined) {
      modifiers.shotModifier -= sm.contest_boost
    }

    return modifiers
  }

  // -----------------------------------------------------------------------
  // Roster-based helpers
  // -----------------------------------------------------------------------

  /**
   * Recommend an offensive scheme based on roster composition.
   *
   * @param {Array} roster - array of player objects with `attributes` and `overallRating`
   * @returns {string} scheme ID
   */
  recommendScheme(roster) {
    let avgThreePoint = 0
    let avgPostControl = 0
    let avgSpeed = 0
    let avgBasketballIQ = 0
    let hasStarPlayer = false
    const count = Math.min(roster.length, 8) // Consider top 8 players

    for (let i = 0; i < count; i++) {
      const player = roster[i]
      const attrs = player.attributes ?? {}

      avgThreePoint += attrs?.offense?.threePoint ?? 50
      avgPostControl += attrs?.offense?.postControl ?? 50
      avgSpeed += attrs?.physical?.speed ?? 50
      avgBasketballIQ += attrs?.mental?.basketballIQ ?? 50

      if ((player.overallRating ?? 0) >= 85) {
        hasStarPlayer = true
      }
    }

    if (count > 0) {
      avgThreePoint /= count
      avgPostControl /= count
      avgSpeed /= count
      avgBasketballIQ /= count
    }

    // Determine best fit
    if (avgSpeed >= 80 && avgThreePoint >= 70) {
      return 'run_and_gun'
    }
    if (avgThreePoint >= 75) {
      return 'three_point'
    }
    if (avgPostControl >= 75) {
      return 'post_centric'
    }
    if (hasStarPlayer && avgBasketballIQ < 65) {
      return 'iso_heavy'
    }
    if (avgBasketballIQ >= 70) {
      return 'motion'
    }

    return 'balanced'
  }

  /**
   * Calculate how effective a scheme is for a given roster (30-100 scale).
   *
   * @param {string} scheme  - offensive scheme ID
   * @param {Array}  roster  - array of player objects
   * @returns {number} effectiveness rating 30-100
   */
  calculateSchemeEffectiveness(scheme, roster) {
    let effectiveness = 50.0 // Base

    let avgRating = 0
    let count = 0
    for (const player of roster) {
      avgRating += player.overallRating ?? 70
      count++
    }
    avgRating = count > 0 ? avgRating / count : 70

    // Base effectiveness from talent
    effectiveness += (avgRating - 70) * 0.5

    // Scheme-specific adjustments
    switch (scheme) {
      case 'three_point': {
        const avgThree = this._getRosterAverage(roster, 'offense', 'threePoint')
        effectiveness += (avgThree - 60) * 0.3
        break
      }
      case 'post_centric': {
        const avgPost = this._getRosterAverage(roster, 'offense', 'postControl')
        effectiveness += (avgPost - 60) * 0.3
        break
      }
      case 'motion': {
        const avgIQ = this._getRosterAverage(roster, 'mental', 'basketballIQ')
        effectiveness += (avgIQ - 60) * 0.3
        break
      }
      case 'run_and_gun': {
        const avgSpd = this._getRosterAverage(roster, 'physical', 'speed')
        effectiveness += (avgSpd - 60) * 0.3
        break
      }
      case 'iso_heavy': {
        let maxRating = 0
        for (const player of roster) {
          maxRating = Math.max(maxRating, player.overallRating ?? 0)
        }
        effectiveness += (maxRating - 80) * 0.5
        break
      }
      // 'balanced' and any unknown scheme: no extra adjustment
    }

    return Math.max(30, Math.min(100, effectiveness))
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Compute the average of a nested attribute across a roster.
   * e.g. _getRosterAverage(roster, 'offense', 'threePoint')
   *
   * @param {Array}  roster
   * @param {string} category   - top-level attribute category (offense, defense, physical, mental)
   * @param {string} attribute  - specific attribute within the category
   * @returns {number} average value, defaults to 50 if no data
   * @private
   */
  _getRosterAverage(roster, category, attribute) {
    let total = 0
    let count = 0

    for (const player of roster) {
      const value = player.attributes?.[category]?.[attribute] ?? null
      if (value !== null) {
        total += value
        count++
      }
    }

    return count > 0 ? total / count : 50
  }
}

// ---------------------------------------------------------------------------
// Default singleton instance for convenience
// ---------------------------------------------------------------------------

export const coachingEngine = new CoachingEngine()

export default CoachingEngine
