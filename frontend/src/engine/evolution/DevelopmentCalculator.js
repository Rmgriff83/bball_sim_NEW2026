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
    micro_dev_threshold_high: 16,
    micro_dev_threshold_low: 8,
    micro_dev_gain_min: 0.1,
    micro_dev_gain_max: 0.3,
    micro_dev_loss_min: 0.05,
    micro_dev_loss_max: 0.1,
    min_minutes_for_regression: 10,
    stat_thresholds: {
      points: 14,
      assists: 4,
      rebounds: 5,
      steals: 1,
      blocks: 1,
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
 * Calculate PER-inspired performance rating from box score.
 * Accounts for scoring, efficiency (missed shots), playmaking, rebounding, and defense.
 * Normalized so average performance ≈ 15 (matching real PER scale).
 * Handles both camelCase and snake_case box score property names.
 *
 * @param {object} boxScore - Game box score stats
 * @returns {number} Performance rating (~15 avg, ~22+ great, ~8- poor)
 */
function calculatePerformanceRating(boxScore) {
  const min = Math.max(1, boxScore.minutes ?? 1);
  const pts = boxScore.points ?? 0;
  const oreb = boxScore.offensiveRebounds ?? boxScore.offensive_rebounds ?? 0;
  const dreb = boxScore.defensiveRebounds ?? boxScore.defensive_rebounds ?? 0;
  const reb = (oreb + dreb) || (boxScore.rebounds ?? 0);
  const ast = boxScore.assists ?? 0;
  const stl = boxScore.steals ?? 0;
  const blk = boxScore.blocks ?? 0;
  const to = boxScore.turnovers ?? 0;
  const fgm = boxScore.fieldGoalsMade ?? boxScore.fgm ?? 0;
  const fga = boxScore.fieldGoalsAttempted ?? boxScore.fga ?? 0;
  const tpm = boxScore.threePointersMade ?? boxScore.fg3m ?? boxScore.tpm ?? 0;
  const ftm = boxScore.freeThrowsMade ?? boxScore.ftm ?? 0;
  const fta = boxScore.freeThrowsAttempted ?? boxScore.fta ?? 0;

  const missedFG = Math.max(0, fga - fgm);
  const missedFT = Math.max(0, fta - ftm);

  // PER-inspired per-minute efficiency:
  // - Rewards scoring, rebounds, assists, steals, blocks
  // - Rewards made shots (efficiency bonus) and 3-pointers
  // - Penalizes missed shots, missed FTs, and turnovers
  const raw = (
    pts
    + oreb * 1.5
    + (reb - oreb) * 0.8
    + ast * 1.5
    + stl * 2.0
    + blk * 2.0
    + tpm * 0.5
    - missedFG * 0.7
    - missedFT * 0.35
    - to * 1.5
  ) / min * 20;

  return Math.round(raw * 100) / 100;
}

/**
 * Determine which attributes to boost or regress based on box score stats.
 * Stat thresholds are per-36-minute baselines, auto-scaled by actual minutes played.
 *
 * For development (change > 0): boost attributes where player exceeded scaled thresholds.
 * For regression (change < 0): regress attributes where player fell below scaled thresholds.
 *
 * @param {object} boxScore - Game box score stats
 * @param {number} change - Amount of change (positive for gains, negative for losses)
 * @param {object} diffSettings - Difficulty settings containing stat_thresholds
 * @param {number} minutes - Actual minutes played (used for per-36 scaling)
 * @returns {object} Map of attribute paths to change amounts
 */
function getAttributeChangesFromStats(boxScore, change, diffSettings = {}, minutes = 0) {
  const changes = {};

  // Get stat thresholds from difficulty settings (per-36-minute baselines)
  const thresholds = diffSettings.stat_thresholds ?? {
    points: 14,
    assists: 4,
    rebounds: 5,
    steals: 1,
    blocks: 1,
    threes: 2,
  };

  // Scale thresholds by actual minutes (per-36 normalization)
  const min = minutes > 0 ? minutes : (boxScore.minutes ?? 36);
  const minuteScale = Math.min(min / 36, 1.0);

  const points = boxScore.points ?? 0;
  const assists = boxScore.assists ?? 0;
  const oreb = boxScore.offensiveRebounds ?? boxScore.offensive_rebounds ?? 0;
  const dreb = boxScore.defensiveRebounds ?? boxScore.defensive_rebounds ?? 0;
  const rebounds = (oreb + dreb) || (boxScore.rebounds ?? 0);
  const steals = boxScore.steals ?? 0;
  const blocks = boxScore.blocks ?? 0;
  const threes = boxScore.threePointersMade ?? boxScore.fg3m ?? boxScore.tpm ?? 0;

  const isDevelopment = change > 0;

  if (isDevelopment) {
    // --- DEVELOPMENT: boost attributes where player exceeded scaled thresholds ---
    const scaledPts = thresholds.points * minuteScale;
    if (points >= scaledPts) {
      if (threes >= thresholds.threes * minuteScale) {
        changes['offense.threePoint'] = change;
      } else {
        changes['offense.midRange'] = change * 0.5;
        changes['offense.layup'] = change * 0.5;
      }
    } else if (points >= scaledPts * 0.6) {
      changes['offense.closeShot'] = change * 0.3;
    }

    const scaledAst = thresholds.assists * minuteScale;
    if (assists >= scaledAst) {
      changes['offense.passAccuracy'] = change;
      changes['offense.passVision'] = change * 0.5;
    } else if (assists >= scaledAst * 0.6) {
      changes['offense.passAccuracy'] = change * 0.3;
    }

    const scaledReb = thresholds.rebounds * minuteScale;
    if (rebounds >= scaledReb) {
      changes['defense.defensiveRebound'] = change * 0.7;
      changes['defense.offensiveRebound'] = change * 0.3;
    } else if (rebounds >= scaledReb * 0.6) {
      changes['defense.defensiveRebound'] = change * 0.3;
    }

    if (steals >= thresholds.steals * minuteScale) {
      changes['defense.steal'] = change;
      changes['defense.perimeterDefense'] = change * 0.3;
    }
    if (blocks >= thresholds.blocks * minuteScale) {
      changes['defense.block'] = change;
      changes['defense.interiorDefense'] = change * 0.3;
    }
  } else {
    // --- REGRESSION: regress attributes in areas where player underperformed ---
    const absChange = Math.abs(change);
    let regressionCount = 0;
    const MAX_REGRESSIONS = 2; // Cap regression to 2 stat categories per game

    // Regress scoring if well below threshold
    const scaledPts = thresholds.points * minuteScale;
    if (points < scaledPts * 0.4 && regressionCount < MAX_REGRESSIONS) {
      changes['offense.midRange'] = -absChange * 0.5;
      changes['offense.closeShot'] = -absChange * 0.5;
      regressionCount++;
    }

    // Regress playmaking if well below threshold
    const scaledAst = thresholds.assists * minuteScale;
    if (assists < scaledAst * 0.4 && regressionCount < MAX_REGRESSIONS) {
      changes['offense.passAccuracy'] = -absChange * 0.5;
      regressionCount++;
    }

    // Regress rebounding if well below threshold
    const scaledReb = thresholds.rebounds * minuteScale;
    if (rebounds < scaledReb * 0.4 && regressionCount < MAX_REGRESSIONS) {
      changes['defense.defensiveRebound'] = -absChange * 0.5;
      regressionCount++;
    }

    // Regress defense if no defensive contributions at all
    if (steals === 0 && blocks === 0 && regressionCount < MAX_REGRESSIONS) {
      changes['defense.perimeterDefense'] = -absChange * 0.3;
      regressionCount++;
    }
  }

  return changes;
}

/**
 * Calculate per-game micro-development based on PER-inspired performance rating.
 * Uses difficulty-specific thresholds and gains, scaled by minutes played.
 *
 * Minutes factor: players who play more minutes get proportionally more
 * development (or regression) per game, reflecting more reps and opportunity.
 *
 * @param {object} player - Player data object
 * @param {object} boxScore - Game box score stats
 * @param {string} difficulty - Difficulty level
 * @returns {object} { performanceRating, attributeChanges, type }
 */
function calculateMicroDevelopment(player, boxScore, difficulty = 'pro') {
  const diffSettings = getDifficultySettings(difficulty);
  const performance = calculatePerformanceRating(boxScore);
  const minutes = boxScore.minutes ?? 0;
  const minMinutes = diffSettings.min_minutes_for_regression ?? 10;

  const result = {
    performanceRating: performance,
    attributeChanges: {},
    type: 'none',
  };

  // Minutes factor: scales gain/loss amount by playing time
  // 28 min = baseline (1.0x), max 1.3x for heavy minutes, min 0.5x for low minutes
  const minutesFactor = Math.max(0.5, Math.min(minutes / 28, 1.3));

  if (performance >= diffSettings.micro_dev_threshold_high) {
    // Good performance - development (scaled by minutes played)
    result.type = 'development';
    const baseGain = randomFloat(
      diffSettings.micro_dev_gain_min,
      diffSettings.micro_dev_gain_max
    );
    const gain = baseGain * minutesFactor;
    result.attributeChanges = getAttributeChangesFromStats(boxScore, gain, diffSettings, minutes);
  } else if (performance <= diffSettings.micro_dev_threshold_low && minutes >= minMinutes) {
    // Poor performance with significant minutes - slight regression
    result.type = 'regression';
    const baseLoss = randomFloat(
      diffSettings.micro_dev_loss_min,
      diffSettings.micro_dev_loss_max
    );
    // Gentler minutes scaling for regression (don't over-punish high-minutes players)
    const regMinFactor = Math.max(0.6, Math.min(minutes / 30, 1.15));
    const loss = baseLoss * regMinFactor;
    result.attributeChanges = getAttributeChangesFromStats(boxScore, -loss, diffSettings, minutes);
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
