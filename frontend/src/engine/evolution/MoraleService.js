/**
 * MoraleService.js
 *
 * Handles player morale updates, trade requests, team chemistry, and morale effects.
 * Translated from backend/app/Services/PlayerEvolution/MoraleService.php
 */

import { MORALE, PERSONALITY_TRAITS } from '../config/GameConfig.js';

const moraleConfig = MORALE;

/**
 * Clamp morale between min and max.
 *
 * @param {number} value - Raw morale value
 * @returns {number} Clamped integer morale
 */
function clamp(value) {
  return Math.round(Math.max(moraleConfig.min, Math.min(moraleConfig.max, value)));
}

/**
 * Get expected minutes based on overall rating and difficulty.
 *
 * @param {object} player - Player data object
 * @param {string} difficulty - Difficulty level
 * @returns {number} Expected minutes per game
 */
function getExpectedMinutes(player, difficulty = 'pro') {
  const overall = player.overallRating ?? player.overall_rating ?? 70;

  if (overall >= 85) {
    switch (difficulty) {
      case 'rookie': return 27;
      case 'pro': return 28;
      case 'all_star':
      case 'all-star': return 29;
      case 'hall_of_fame':
      case 'hall-of-fame': return 31;
      default: return 28;
    }
  }
  if (overall >= 80) return 28;
  if (overall >= 75) return 24;
  if (overall >= 70) return 18;
  if (overall >= 65) return 12;
  return 6;
}

/**
 * Update player morale after a game.
 * Returns a new player object with updated morale.
 *
 * @param {object} player - Player data object
 * @param {object} gameResult - { won: boolean, streak: number }
 * @param {object} boxScore - Game box score stats
 * @param {string} difficulty - Difficulty level
 * @returns {object} Updated player object
 */
function updateAfterGame(player, gameResult, boxScore, difficulty = 'pro') {
  // Clone to avoid mutation
  player = { ...player, personality: { ...player.personality } };

  let morale = player.personality.morale ?? moraleConfig.starting;
  const factors = moraleConfig.factors;

  // Win/loss impact
  const isWin = gameResult.won ?? false;
  morale += isWin ? factors.win : factors.loss;

  // Streak bonus/penalty
  const streak = gameResult.streak ?? 0;
  if (Math.abs(streak) >= 3) {
    morale += streak > 0 ? factors.winning_streak_bonus : factors.losing_streak_penalty;
  }

  // Playing time expectations
  const minutes = boxScore.minutes ?? 0;
  const expectedMinutes = getExpectedMinutes(player, difficulty);

  if (minutes >= expectedMinutes * 1.2) {
    morale += factors.playing_time_exceeded;
  } else if (minutes >= expectedMinutes * 0.8) {
    morale += factors.playing_time_met;
  } else {
    morale += factors.playing_time_unmet;
  }

  // Apply personality volatility
  const traits = player.personality.traits ?? [];
  if (traits.includes('hot_head')) {
    const volatility = PERSONALITY_TRAITS.hot_head?.morale_volatility ?? 2.0;
    // Hot heads have amplified morale changes
    const change = morale - (player.personality.morale ?? moraleConfig.starting);
    morale = (player.personality.morale ?? moraleConfig.starting) + (change * volatility);
  }

  // Clamp morale
  player.personality.morale = clamp(morale);

  return player;
}

/**
 * Update morale based on weekly team performance.
 * Returns a new player object with updated morale.
 *
 * @param {object} player - Player data object
 * @param {object} teamRecord - { wins: number, losses: number }
 * @returns {object} Updated player object
 */
function updateWeekly(player, teamRecord) {
  // Clone to avoid mutation
  player = { ...player, personality: { ...player.personality } };

  let morale = player.personality.morale ?? moraleConfig.starting;
  const factors = moraleConfig.factors;

  // Contract situation
  const contractYears = player.contract_years_remaining ?? player.contractYearsRemaining ?? 2;
  if (contractYears <= 1) {
    morale += factors.final_contract_year;
  }

  // Team success matters
  const winPct = teamRecord.wins / Math.max(1, teamRecord.wins + teamRecord.losses);
  if (winPct >= 0.6) {
    morale += 1; // Winning team bonus
  } else if (winPct <= 0.3) {
    morale -= 1; // Losing team penalty
  }

  // Stability from personality
  const traits = player.personality.traits ?? [];
  if (traits.includes('team_player') || traits.includes('quiet')) {
    // More stable morale
    const target = moraleConfig.starting;
    morale = morale + (target - morale) * 0.1;
  }

  player.personality.morale = clamp(morale);

  return player;
}

/**
 * Check if player wants to request a trade.
 *
 * @param {object} player - Player data object
 * @returns {boolean}
 */
function checkForTradeRequest(player) {
  const morale = player.personality?.morale ?? moraleConfig.starting;

  if (morale < moraleConfig.trade_request_threshold) {
    // Random chance based on how low morale is
    const chance = (moraleConfig.trade_request_threshold - morale) / 100;
    return (Math.floor(Math.random() * 100) + 1) / 100 <= chance;
  }

  return false;
}

/**
 * Calculate team chemistry based on roster personalities.
 *
 * @param {object[]} roster - Array of player data objects
 * @returns {number} Team chemistry value (0-100)
 */
function calculateTeamChemistry(roster) {
  let chemistry = 70; // Base chemistry

  let leaderCount = 0;
  let ballHogCount = 0;
  let teamPlayerCount = 0;

  for (const player of roster) {
    const traits = player.personality?.traits ?? [];

    for (const trait of traits) {
      const traitConfig = PERSONALITY_TRAITS[trait];
      if (!traitConfig) continue;

      if (traitConfig.chemistry_boost != null) {
        chemistry += traitConfig.chemistry_boost;
      }
      if (traitConfig.chemistry_penalty != null) {
        chemistry += traitConfig.chemistry_penalty;
      }
    }

    if (traits.includes('leader')) leaderCount++;
    if (traits.includes('ball_hog')) ballHogCount++;
    if (traits.includes('team_player')) teamPlayerCount++;
  }

  // Synergy bonuses
  if (leaderCount >= 1 && leaderCount <= 2) {
    chemistry += 5; // Good leadership
  } else if (leaderCount > 3) {
    chemistry -= 5; // Too many cooks
  }

  if (ballHogCount >= 3) {
    chemistry -= 10; // Too many ball hogs
  }

  if (teamPlayerCount >= 5) {
    chemistry += 5; // Unselfish team
  }

  return clamp(chemistry);
}

/**
 * Get morale effect level (high, normal, low, critical).
 *
 * @param {number} morale - Current morale value
 * @returns {string} Level key
 */
function getMoraleLevel(morale) {
  const effects = moraleConfig.effects;

  if (morale >= effects.high.threshold) return 'high';
  if (morale >= effects.normal.threshold) return 'normal';
  if (morale >= effects.low.threshold) return 'low';
  return 'critical';
}

/**
 * Get performance modifier based on morale.
 *
 * @param {number} morale - Current morale value
 * @returns {number} Performance modifier
 */
function getPerformanceModifier(morale) {
  const level = getMoraleLevel(morale);
  return moraleConfig.effects[level]?.performance_modifier ?? 0.0;
}

/**
 * Get development modifier based on morale.
 *
 * @param {number} morale - Current morale value
 * @returns {number} Development modifier
 */
function getDevelopmentModifier(morale) {
  const level = getMoraleLevel(morale);
  return moraleConfig.effects[level]?.development_modifier ?? 0.0;
}

export {
  updateAfterGame,
  updateWeekly,
  checkForTradeRequest,
  calculateTeamChemistry,
  getMoraleLevel,
  getPerformanceModifier,
  getDevelopmentModifier,
};
