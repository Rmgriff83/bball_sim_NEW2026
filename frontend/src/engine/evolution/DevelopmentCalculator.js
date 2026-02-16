/**
 * DevelopmentCalculator.js
 *
 * Calculates player development, regression, and per-game micro-development.
 * Translated from backend/app/Services/PlayerEvolution/DevelopmentCalculator.php
 */

import {
  AGE_BRACKETS,
  DEVELOPMENT,
  DIFFICULTY_SETTINGS,
  MORALE,
} from '../config/GameConfig.js';

/**
 * Generate a random float between min and max (inclusive).
 */
function randomFloat(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Calculate age from a birth date string.
 * Defaults to 25 if birthDate is empty, null, or invalid.
 */
function calculateAge(birthDate) {
  if (!birthDate) {
    return 25;
  }

  try {
    const birth = new Date(birthDate);
    if (isNaN(birth.getTime())) {
      return 25;
    }

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    // Sanity check
    if (age < 0 || age > 50) {
      return 25;
    }

    return age;
  } catch {
    return 25;
  }
}

/**
 * Get birth date from player object, handling both camelCase and snake_case.
 */
function getPlayerBirthDate(player) {
  const birthDate = player.birthDate ?? player.birth_date ?? null;
  return birthDate || null;
}

/**
 * Get player age with safe default of 25.
 */
function getPlayerAge(player) {
  return calculateAge(getPlayerBirthDate(player));
}

/**
 * Get the age bracket key for a player's age.
 */
function getAgeBracket(age) {
  for (const [bracket, range] of Object.entries(AGE_BRACKETS)) {
    if (age >= range.min && age <= range.max) {
      return bracket;
    }
  }
  return 'veteran';
}

/**
 * Get difficulty-specific settings.
 * @param {string} difficulty - One of 'rookie', 'pro', 'all_star', 'hall_of_fame'
 * @returns {object}
 */
function getDifficultySettings(difficulty = 'pro') {
  const defaultSettings = {
    micro_dev_threshold_high: 14,
    micro_dev_threshold_low: 6,
    micro_dev_gain_min: 0.1,
    micro_dev_gain_max: 0.3,
    micro_dev_loss_min: 0.08,
    micro_dev_loss_max: 0.15,
    stat_thresholds: {
      points: 15,
      assists: 5,
      rebounds: 6,
      steals: 2,
      blocks: 2,
      threes: 2,
    },
    development_multiplier: 1.0,
    regression_multiplier: 1.0,
  };

  return DIFFICULTY_SETTINGS[difficulty]
    ?? DIFFICULTY_SETTINGS.pro
    ?? defaultSettings;
}

/**
 * Get development multiplier for an age (adjusted by difficulty).
 */
function getDevelopmentMultiplier(age, difficulty = 'pro') {
  const bracket = getAgeBracket(age);
  const baseMult = AGE_BRACKETS[bracket]?.development ?? 0.0;
  const diffSettings = getDifficultySettings(difficulty);
  return baseMult * (diffSettings.development_multiplier ?? 1.0);
}

/**
 * Get regression multiplier for an age (adjusted by difficulty).
 */
function getRegressionMultiplier(age, difficulty = 'pro') {
  const bracket = getAgeBracket(age);
  const baseMult = AGE_BRACKETS[bracket]?.regression ?? 0.0;
  const diffSettings = getDifficultySettings(difficulty);
  return baseMult * (diffSettings.regression_multiplier ?? 1.0);
}

/**
 * Get morale modifier for development.
 */
function getMoraleModifier(morale) {
  const effects = MORALE.effects;

  if (morale >= effects.high.threshold) {
    return effects.high.development_modifier;
  } else if (morale >= effects.normal.threshold) {
    return effects.normal.development_modifier;
  } else if (morale >= effects.low.threshold) {
    return effects.low.development_modifier;
  } else {
    return effects.critical.development_modifier;
  }
}

/**
 * Calculate monthly development points for a player.
 *
 * @param {object} player - Player data object
 * @param {object} context - Optional context: { avgMinutesPerGame, hasMentor, badgeSynergyBoost, dynamicDuoBoost }
 * @param {string} difficulty - Difficulty level
 * @returns {number} Development points for this month
 */
function calculateMonthlyDevelopment(player, context = {}, difficulty = 'pro') {
  const age = getPlayerAge(player);
  const current = player.overallRating ?? player.overall_rating ?? 70;
  const potential = player.potentialRating ?? player.potential_rating ?? 75;
  const workEthic = player.attributes?.mental?.workEthic ?? 70;

  // Can't develop past potential
  if (current >= potential) {
    return 0.0;
  }

  const ageMultiplier = getDevelopmentMultiplier(age, difficulty);

  // Base development (divided by 12 for monthly)
  const base = (potential - current) * DEVELOPMENT.base_rate * ageMultiplier / 12;

  // Work ethic bonus
  const workEthicBonus = base * (workEthic / 100) * DEVELOPMENT.work_ethic_factor;

  // Playing time bonus
  const avgMinutes = context.avgMinutesPerGame ?? 20;
  const playingTimeBonus = base * (avgMinutes / 36) * DEVELOPMENT.playing_time_factor;

  // Mentor bonus
  const mentorBonus = (context.hasMentor ?? false) ? base * DEVELOPMENT.mentor_factor : 0;

  // Badge synergy bonus
  const synergyBonus = (context.badgeSynergyBoost ?? 0) * base;

  // Dynamic Duo bonus
  const duoBonus = (context.dynamicDuoBoost ?? 0) * base;

  // Morale modifier
  const morale = player.personality?.morale ?? 80;
  const moraleModifier = getMoraleModifier(morale);

  let total = base + workEthicBonus + playingTimeBonus + mentorBonus + synergyBonus + duoBonus;
  total *= (1 + moraleModifier);

  return Math.max(0, total);
}

/**
 * Calculate monthly regression points for a player.
 *
 * @param {object} player - Player data object
 * @param {string} difficulty - Difficulty level
 * @returns {number} Regression points for this month
 */
function calculateMonthlyRegression(player, difficulty = 'pro') {
  const age = getPlayerAge(player);
  const ageMultiplier = getRegressionMultiplier(age, difficulty);

  if (ageMultiplier <= 0) {
    return 0.0;
  }

  // Base regression (divided by 12 for monthly)
  const baseRegression = ageMultiplier * 0.5 / 12;

  return baseRegression;
}

/**
 * Calculate performance rating from box score.
 * Formula: (Points + Rebounds + Assists*1.5 + Steals*2 + Blocks*2 - Turnovers) / Minutes * 10
 *
 * @param {object} boxScore - Game box score stats
 * @returns {number} Performance rating
 */
function calculatePerformanceRating(boxScore) {
  const minutes = Math.max(1, boxScore.minutes ?? 1);
  const points = boxScore.points ?? 0;
  const rebounds = (boxScore.offensiveRebounds ?? 0) + (boxScore.defensiveRebounds ?? 0);
  const assists = boxScore.assists ?? 0;
  const steals = boxScore.steals ?? 0;
  const blocks = boxScore.blocks ?? 0;
  const turnovers = boxScore.turnovers ?? 0;

  const raw = (points + rebounds + assists * 1.5 + steals * 2 + blocks * 2 - turnovers) / minutes * 10;

  return Math.round(raw * 100) / 100;
}

/**
 * Determine which attributes to boost/regress based on box score stats.
 * Uses difficulty-specific stat thresholds.
 *
 * @param {object} boxScore - Game box score stats
 * @param {number} change - Amount of change (positive for gains, negative for losses)
 * @param {object} diffSettings - Difficulty settings containing stat_thresholds
 * @returns {object} Map of attribute paths to change amounts
 */
function getAttributeChangesFromStats(boxScore, change, diffSettings = {}) {
  const changes = {};

  // Get stat thresholds from difficulty settings, with fallbacks
  const thresholds = diffSettings.stat_thresholds ?? {
    points: 15,
    assists: 5,
    rebounds: 6,
    steals: 2,
    blocks: 2,
    threes: 2,
  };

  const points = boxScore.points ?? 0;
  const assists = boxScore.assists ?? 0;
  const rebounds = (boxScore.offensiveRebounds ?? 0) + (boxScore.defensiveRebounds ?? 0);
  const steals = boxScore.steals ?? 0;
  const blocks = boxScore.blocks ?? 0;
  const threes = boxScore.threePointersMade ?? 0;

  // Scoring - if points threshold met
  if (points >= thresholds.points) {
    if (threes >= thresholds.threes) {
      changes['offense.threePoint'] = change;
    } else {
      changes['offense.midRange'] = change * 0.5;
      changes['offense.layup'] = change * 0.5;
    }
  } else if (points >= thresholds.points * 0.6) {
    // Partial scoring bonus for decent scoring (60% of threshold)
    changes['offense.closeShot'] = change * 0.3;
  }

  // Playmaking
  if (assists >= thresholds.assists) {
    changes['offense.passAccuracy'] = change;
    changes['offense.passVision'] = change * 0.5;
  } else if (assists >= thresholds.assists * 0.6) {
    // Partial assist bonus
    changes['offense.passAccuracy'] = change * 0.3;
  }

  // Rebounding
  if (rebounds >= thresholds.rebounds) {
    changes['defense.defensiveRebound'] = change * 0.7;
    changes['defense.offensiveRebound'] = change * 0.3;
  } else if (rebounds >= thresholds.rebounds * 0.6) {
    // Partial rebound bonus
    changes['defense.defensiveRebound'] = change * 0.3;
  }

  // Defense
  if (steals >= thresholds.steals) {
    changes['defense.steal'] = change;
    changes['defense.perimeterDefense'] = change * 0.3;
  }
  if (blocks >= thresholds.blocks) {
    changes['defense.block'] = change;
    changes['defense.interiorDefense'] = change * 0.3;
  }

  return changes;
}

/**
 * Calculate per-game micro-development based on performance.
 * Uses difficulty-specific thresholds and gains.
 *
 * @param {object} player - Player data object
 * @param {object} boxScore - Game box score stats
 * @param {string} difficulty - Difficulty level
 * @returns {object} { performanceRating, attributeChanges, type }
 */
function calculateMicroDevelopment(player, boxScore, difficulty = 'pro') {
  const diffSettings = getDifficultySettings(difficulty);
  const performance = calculatePerformanceRating(boxScore);

  const result = {
    performanceRating: performance,
    attributeChanges: {},
    type: 'none',
  };

  if (performance >= diffSettings.micro_dev_threshold_high) {
    // Good performance - development
    result.type = 'development';
    const gain = randomFloat(
      diffSettings.micro_dev_gain_min,
      diffSettings.micro_dev_gain_max
    );
    result.attributeChanges = getAttributeChangesFromStats(boxScore, gain, diffSettings);
  } else if (performance <= diffSettings.micro_dev_threshold_low && (boxScore.minutes ?? 0) >= 15) {
    // Poor performance with significant minutes - slight regression
    result.type = 'regression';
    const loss = randomFloat(
      diffSettings.micro_dev_loss_min,
      diffSettings.micro_dev_loss_max
    );
    result.attributeChanges = getAttributeChangesFromStats(boxScore, -loss, diffSettings);
  }

  return result;
}

/**
 * Check if player can still develop towards potential.
 *
 * @param {object} player - Player data object
 * @param {string} difficulty - Difficulty level
 * @returns {boolean}
 */
function canReachPotential(player, difficulty = 'pro') {
  const current = player.overallRating ?? player.overall_rating ?? 70;
  const potential = player.potentialRating ?? player.potential_rating ?? 75;
  const age = getPlayerAge(player);

  return current < potential && getDevelopmentMultiplier(age, difficulty) > 0;
}

export {
  calculateAge,
  getPlayerBirthDate,
  getPlayerAge,
  getAgeBracket,
  getDifficultySettings,
  getDevelopmentMultiplier,
  getRegressionMultiplier,
  getMoraleModifier,
  calculateMonthlyDevelopment,
  calculateMonthlyRegression,
  calculatePerformanceRating,
  calculateMicroDevelopment,
  canReachPotential,
};
