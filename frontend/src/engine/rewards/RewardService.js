// =============================================================================
// RewardService.js
// =============================================================================
// Game reward processing: synergy counting and token awards.
// Translated from PHP: backend/app/Services/RewardService.php
// =============================================================================

import { ACHIEVEMENTS } from '../data/achievements';

// =============================================================================
// CONSTANTS
// =============================================================================

const TOKENS_PER_SYNERGY = 1;
const WIN_MULTIPLIER = 1.5;
const WIN_BONUS_TOKENS = 2;
// Hard ceiling on the TOTAL tokens a single game can award (win bonus
// included) — synergy counts scale with roster construction, and authored
// rosters (roster editor) could otherwise farm outsized per-game payouts.
const MAX_TOKENS_PER_GAME = 21;

// =============================================================================
// SYNERGY COUNTING
// =============================================================================

/**
 * Count synergies activated by the user's team in animation data.
 * @param {object} animationData - Animation data containing possessions
 * @param {string} teamKey - 'home' or 'away'
 * @returns {number} Number of synergies activated
 */
export function countUserTeamSynergies(animationData, teamKey) {
  const possessions = animationData?.possessions ?? [];
  let count = 0;

  for (const possession of possessions) {
    // Only count synergies for the user's team possessions
    if ((possession.team ?? '') !== teamKey) {
      continue;
    }

    // Count activated synergies in this possession
    const activatedSynergies = possession.activated_synergies ?? [];
    if (Array.isArray(activatedSynergies)) {
      count += activatedSynergies.length;
    }
  }

  return count;
}

// =============================================================================
// GAME REWARDS
// =============================================================================

/**
 * Process synergy rewards for the user's team after a game.
 * @param {object} params
 * @param {object} params.animationData - Animation data containing possession info
 * @param {boolean} params.isHome - Whether the user's team was home
 * @param {boolean} params.didWin - Whether the user's team won
 * @param {boolean} params.simReduction - Simmed (non-animated) game: synergy
 *   tokens are reduced to 10% (win bonus stays full). Must happen here, BEFORE
 *   the per-game cap — reducing an already-capped total flattens every payout
 *   to the same few tokens.
 * @returns {{ synergies_activated: number, tokens_awarded: number, win_bonus_applied: boolean }}
 */
export function processGameRewards({ animationData, isHome, didWin, synergiesActivated, simReduction = false }) {
  const teamKey = isHome ? 'home' : 'away';
  // Use animation data if available, otherwise fall back to the simulator's counters
  const synergyCount = synergiesActivated ?? countUserTeamSynergies(animationData, teamKey);

  // Flat win bonus: always awarded for wins regardless of synergies
  const winBonus = didWin ? WIN_BONUS_TOKENS : 0;

  // Calculate synergy tokens with optional win multiplier
  const baseTokens = synergyCount * TOKENS_PER_SYNERGY;
  const synergyTokens = didWin
    ? Math.ceil(baseTokens * WIN_MULTIPLIER)
    : baseTokens;

  const awardedSynergy = simReduction && synergyTokens > 0
    ? Math.max(1, Math.round(synergyTokens * 0.1))
    : synergyTokens;

  return {
    synergies_activated: synergyCount,
    tokens_awarded: Math.min(MAX_TOKENS_PER_GAME, awardedSynergy + winBonus),
    win_bonus: winBonus,
    win_bonus_applied: didWin,
  };
}

// =============================================================================
// ACHIEVEMENT CHECKING
// =============================================================================

/**
 * Check if any achievements have been newly unlocked based on current stats.
 * @param {object} params
 * @param {object} params.careerStats - Cumulative career stats
 * @param {Array} params.unlockedAchievementIds - Already unlocked achievement IDs
 * @returns {Array} Newly unlocked achievement objects
 */
export function checkAchievements({ careerStats, unlockedAchievementIds = [] }) {
  const newlyUnlocked = [];

  for (const achievement of ACHIEVEMENTS) {
    // Skip already unlocked
    if (unlockedAchievementIds.includes(achievement.id)) continue;

    const criteria = achievement.criteria;
    if (!criteria) continue;

    const statValue = careerStats[criteria.type] ?? 0;

    if (statValue >= criteria.value) {
      newlyUnlocked.push(achievement);
    }
  }

  return newlyUnlocked;
}

/**
 * Get all achievements grouped by category.
 * @param {Array} unlockedAchievementIds - Already unlocked achievement IDs
 * @returns {object} Map of category => array of { ...achievement, unlocked: boolean }
 */
export function getAchievementsByCategory(unlockedAchievementIds = []) {
  const categories = {};

  for (const achievement of ACHIEVEMENTS) {
    const category = achievement.category ?? 'other';
    if (!categories[category]) {
      categories[category] = [];
    }

    categories[category].push({
      ...achievement,
      unlocked: unlockedAchievementIds.includes(achievement.id),
    });
  }

  return categories;
}

/**
 * Calculate total achievement points earned.
 * @param {Array} unlockedAchievementIds
 * @returns {number}
 */
export function calculateTotalAchievementPoints(unlockedAchievementIds = []) {
  let total = 0;

  for (const achievement of ACHIEVEMENTS) {
    if (unlockedAchievementIds.includes(achievement.id)) {
      total += achievement.points ?? 0;
    }
  }

  return total;
}

/**
 * Get achievement progress for a specific criteria type.
 * @param {string} criteriaType - e.g. 'wins', 'championships'
 * @param {number} currentValue - Current stat value
 * @returns {Array} Array of { achievement, current, target, percent }
 */
export function getAchievementProgress(criteriaType, currentValue) {
  return ACHIEVEMENTS
    .filter(a => a.criteria?.type === criteriaType)
    .map(achievement => ({
      achievement,
      current: currentValue,
      target: achievement.criteria.value,
      percent: Math.min(100, Math.round((currentValue / achievement.criteria.value) * 100)),
    }))
    .sort((a, b) => a.target - b.target);
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  TOKENS_PER_SYNERGY,
  WIN_MULTIPLIER,
  WIN_BONUS_TOKENS,
  MAX_TOKENS_PER_GAME,
};
