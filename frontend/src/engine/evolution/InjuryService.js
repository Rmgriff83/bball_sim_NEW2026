/**
 * InjuryService.js
 *
 * Handles injury checks, generation, recovery processing, and permanent impact.
 * Translated from backend/app/Services/PlayerEvolution/InjuryService.php
 */

import { INJURY_TYPES, INJURY_BASE_CHANCE } from '../config/GameConfig.js';
import { applyInjuryImpact } from './AttributeAging.js';

const injuryConfig = {
  base_chance: INJURY_BASE_CHANCE,
  types: INJURY_TYPES,
};

/**
 * Calculate player age from birth date.
 *
 * @param {object} player - Player data object
 * @returns {number} Age in years, defaults to 25
 */
function calculateAge(player) {
  const birthDate = player.birthDate ?? player.birth_date ?? null;
  if (!birthDate) return 25;

  try {
    const birth = new Date(birthDate);
    if (isNaN(birth.getTime())) return 25;

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  } catch {
    return 25;
  }
}

/**
 * Calculate injury chance based on player attributes and context.
 *
 * @param {object} player - Player data object
 * @param {number} minutesPlayed - Minutes played in the game
 * @param {boolean} isPlayoff - Whether this is a playoff game
 * @returns {number} Injury probability (0 to 0.05)
 */
function calculateInjuryChance(player, minutesPlayed, isPlayoff = false) {
  const durability = player.attributes?.physical?.durability ?? 75;
  const age = calculateAge(player);
  const fatigue = player.fatigue ?? 0;
  const injuryRisk = (player.injuryRisk ?? player.injury_risk ?? 'M').toUpperCase();

  const base = injuryConfig.base_chance;

  // Injury risk factor from CSV data (L=Low, M=Medium, H=High)
  let riskMultiplier;
  switch (injuryRisk) {
    case 'L': riskMultiplier = 0.5; break;   // Low risk: 50% of normal chance
    case 'H': riskMultiplier = 2.0; break;   // High risk: 2x normal chance
    case 'M': default: riskMultiplier = 1.0; break; // Medium risk: normal chance
  }

  // Durability factor: lower durability = higher chance
  const durabilityFactor = ((100 - durability) / 100) * 0.005;

  // Age factor: older players get injured more
  const ageFactor = Math.max(0, (age - 30) * 0.0005);

  // Fatigue factor: tired players get injured more
  const fatigueFactor = (fatigue / 100) * 0.002;

  // Minutes factor: more minutes = more exposure
  const minutesFactor = (minutesPlayed / 36) * 0.001;

  // Apply injury risk multiplier to the base calculation
  let chance = (base + durabilityFactor + ageFactor + fatigueFactor + minutesFactor) * riskMultiplier;

  // Playoffs are more intense
  if (isPlayoff) {
    chance *= 1.2;
  }

  // Cap at 5%
  return Math.min(0.05, chance);
}

/**
 * Roll for injury severity based on weighted probabilities.
 *
 * @returns {string} Severity key (e.g., 'minor', 'moderate', 'severe', 'season_ending')
 */
function rollInjurySeverity() {
  const roll = Math.floor(Math.random() * 100) + 1; // 1 to 100
  let cumulative = 0;

  for (const [severity, config] of Object.entries(injuryConfig.types)) {
    cumulative += config.weight;
    if (roll <= cumulative) {
      return severity;
    }
  }

  return 'minor';
}

/**
 * Generate a random injury based on weighted probabilities.
 *
 * @param {object} player - Player data object (unused currently, available for future extensions)
 * @returns {object} Injury details object
 */
function generateInjury(player) {
  const severity = rollInjurySeverity();
  const injuryTypeConfig = injuryConfig.types[severity];

  const injuryEntries = Object.entries(injuryTypeConfig.injuries);
  const randomIndex = Math.floor(Math.random() * injuryEntries.length);
  const [injuryKey, injuryName] = injuryEntries[randomIndex];

  const [minDuration, maxDuration] = injuryTypeConfig.duration;
  const duration = Math.floor(Math.random() * (maxDuration - minDuration + 1)) + minDuration;

  return {
    type: injuryKey,
    name: injuryName,
    severity: severity,
    games_remaining: duration,
    occurred_date: new Date().toISOString().split('T')[0],
    permanent_impact: injuryTypeConfig.permanent_impact ?? 0,
    permanent_impact_applied: false,
  };
}

/**
 * Check if a player gets injured during a game.
 *
 * @param {object} player - Player data object
 * @param {number} minutesPlayed - Minutes played in the game
 * @param {boolean} isPlayoff - Whether this is a playoff game
 * @returns {object|null} Injury details object or null if no injury
 */
function checkForInjury(player, minutesPlayed, isPlayoff = false) {
  const chance = calculateInjuryChance(player, minutesPlayed, isPlayoff);
  const roll = (Math.floor(Math.random() * 10000) + 1) / 10000; // 0.0001 to 1.0000

  if (roll <= chance) {
    return generateInjury(player);
  }

  return null;
}

/**
 * Check if player is currently injured.
 *
 * @param {object} player - Player data object
 * @returns {boolean}
 */
function isInjured(player) {
  return (player.is_injured ?? player.isInjured ?? false) === true;
}

/**
 * Get games remaining for injury recovery.
 *
 * @param {object} player - Player data object
 * @returns {number}
 */
function getGamesRemaining(player) {
  const injury = player.injury_details ?? player.injuryDetails ?? null;
  return injury?.games_remaining ?? 0;
}

/**
 * Process injury recovery (decrement games remaining).
 * Returns a new player object with updated injury state.
 *
 * @param {object} player - Player data object
 * @returns {object} Updated player object
 */
function processRecovery(player) {
  if (!isInjured(player)) {
    return player;
  }

  let injury = player.injury_details ?? player.injuryDetails ?? null;
  if (!injury) {
    return player;
  }

  // Clone to avoid mutation
  player = { ...player };
  injury = { ...injury };

  injury.games_remaining = Math.max(0, (injury.games_remaining ?? 0) - 1);

  // Check if recovered
  if (injury.games_remaining <= 0) {
    player.is_injured = false;
    player.isInjured = false;
    player.injury_details = null;
    player.injuryDetails = null;

    // Apply permanent impact if not already applied
    if (!(injury.permanent_impact_applied ?? false) && (injury.permanent_impact ?? 0) > 0) {
      player.attributes = applyInjuryImpact(
        player.attributes,
        injury.permanent_impact
      );
    }
  } else {
    player.injury_details = injury;
    player.injuryDetails = injury;
  }

  return player;
}

/**
 * Apply permanent impact from a severe injury.
 * Returns a new player object with updated attributes.
 *
 * @param {object} player - Player data object
 * @param {object} injury - Injury details object
 * @returns {object} Updated player object
 */
function applyPermanentImpact(player, injury) {
  if ((injury.permanent_impact ?? 0) <= 0) {
    return player;
  }

  // Clone to avoid mutation
  player = { ...player };

  player.attributes = applyInjuryImpact(
    player.attributes,
    injury.permanent_impact
  );

  // Mark as applied
  if (player.injury_details) {
    player.injury_details = { ...player.injury_details, permanent_impact_applied: true };
  }
  if (player.injuryDetails) {
    player.injuryDetails = { ...player.injuryDetails, permanent_impact_applied: true };
  }

  return player;
}

/**
 * Get human-readable injury duration estimate.
 *
 * @param {object} injury - Injury details object
 * @returns {string} Human-readable recovery estimate
 */
function getRecoveryEstimate(injury) {
  const games = injury.games_remaining ?? 0;

  if (games <= 5) {
    return 'day-to-day';
  } else if (games <= 14) {
    return '1-2 weeks';
  } else if (games <= 28) {
    return '2-4 weeks';
  } else if (games <= 42) {
    return '4-6 weeks';
  } else if (games <= 60) {
    return '6-8 weeks';
  } else {
    return 'out for season';
  }
}

export {
  checkForInjury,
  calculateInjuryChance,
  generateInjury,
  rollInjurySeverity,
  processRecovery,
  applyPermanentImpact,
  isInjured,
  getGamesRemaining,
  getRecoveryEstimate,
};
