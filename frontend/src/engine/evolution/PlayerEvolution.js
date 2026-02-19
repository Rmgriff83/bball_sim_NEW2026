// =============================================================================
// PlayerEvolution.js
// =============================================================================
// Master evolution orchestrator - coordinates all player evolution sub-services.
// Translated from: backend/app/Services/PlayerEvolution/PlayerEvolutionService.php
//
// All player data is passed as plain objects and returned as modified copies.
// No database or Laravel dependencies - pure game logic only.
// =============================================================================

import {
  calculateMicroDevelopment,
  calculateMonthlyDevelopment,
  calculateMonthlyRegression,
  getPlayerAge as devGetPlayerAge,
} from './DevelopmentCalculator';
import {
  applySeasonalAging,
  calculateAttributeChange as agingCalculateAttributeChange,
} from './AttributeAging';
import { checkForInjury, processRecovery, isInjured as checkIsInjured } from './InjuryService';
import { updateAfterGame, updateWeekly } from './MoraleService';
import PersonalityEffects from './PersonalityEffects';
import BadgeSynergyService from './BadgeSynergyService';
import EvolutionNewsService from './EvolutionNewsService';
import * as Config from '../config/GameConfig';

// Singleton instances for class-based services
const personalityEffects = new PersonalityEffects();
const badgeSynergyService = new BadgeSynergyService();
const newsService = new EvolutionNewsService();

/**
 * Generate a news event by type, dispatching to the appropriate EvolutionNewsService method.
 * Uses a minimal campaign-like object since we don't have full campaign context here.
 */
function generateEvolutionNews(type, player, context = {}) {
  const campaign = { id: null, current_date: context.gameDate || new Date().toISOString().split('T')[0] };
  switch (type) {
    case 'injury':
      return newsService.createInjuryNews(campaign, player, context.injury || {});
    case 'recovery':
      return newsService.createRecoveryNews(campaign, player, context.injury || {});
    case 'breakout':
      return newsService.createBreakoutNews(campaign, player, context.change || 0);
    case 'decline':
      return newsService.createDeclineNews(campaign, player, context.change || 0);
    case 'retirement':
      return newsService.createRetirementNews(campaign, player, context.careerSeasons || 0);
    case 'hot_streak':
      return newsService.createHotStreakNews(campaign, player, context.games || 0, context.boosts || {});
    case 'cold_streak':
      return newsService.createColdStreakNews(campaign, player, context.games || 0);
    default:
      return null;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get player name from a player object, handling both camelCase and snake_case.
 */
function getPlayerName(player) {
  const first = player.firstName ?? player.first_name ?? '';
  const last = player.lastName ?? player.last_name ?? '';
  return `${first} ${last}`.trim();
}

/**
 * Find a player in a roster array by ID.
 */
function findPlayerInRoster(roster, playerId) {
  return roster.find(p => (p.id ?? '') == playerId) ?? null;
}

/**
 * Group an array of players by their team abbreviation.
 */
function groupPlayersByTeam(players) {
  const teams = {};
  for (const player of players) {
    const abbr = player.teamAbbreviation ?? 'FA';
    if (!teams[abbr]) {
      teams[abbr] = [];
    }
    teams[abbr].push(player);
  }
  return teams;
}

/**
 * Deep clone a player object to avoid mutating the original.
 */
function clonePlayer(player) {
  return JSON.parse(JSON.stringify(player));
}

/**
 * Calculate attribute-weighted recovery with ~15% natural variance.
 * Higher stamina/durability = faster recovery.
 */
function getAttributeWeightedRecovery(player, baseRecovery) {
  const stamina = player.attributes?.physical?.stamina ?? 70;
  const durability = player.attributes?.physical?.durability ?? 70;
  const athleticAvg = (stamina * 0.6 + durability * 0.4) / 100; // 0.0 - 1.0

  // High attributes recover faster: 100-rated player gets ~20% more recovery, 50-rated gets ~10% less
  const attrModifier = 0.8 + athleticAvg * 0.4;

  // Add ~15% random variance (0.85 to 1.15)
  const variance = 0.85 + (Math.floor(Math.random() * 31) / 100);

  return baseRecovery * attrModifier * variance;
}

// =============================================================================
// POSITION ATTRIBUTE WEIGHTS
// =============================================================================

/**
 * Get attribute weights based on position.
 * Higher weight = more important for that position.
 */
function getPositionAttributeWeights(position) {
  const weights = {
    PG: {
      offense: {
        ballHandling: 1.0, passAccuracy: 1.0, passVision: 0.9, passIQ: 0.9,
        threePoint: 0.8, midRange: 0.7, layup: 0.7, closeShot: 0.5,
        freeThrow: 0.6, postControl: 0.2, drawFoul: 0.6,
        standingDunk: 0.1, drivingDunk: 0.4,
      },
      defense: {
        perimeterDefense: 1.0, steal: 0.9, passPerception: 0.8,
        helpDefenseIQ: 0.7, interiorDefense: 0.3, block: 0.2,
        offensiveRebound: 0.2, defensiveRebound: 0.4,
      },
      physical: {
        speed: 1.0, acceleration: 0.9, stamina: 0.8,
        vertical: 0.5, strength: 0.4,
      },
    },
    SG: {
      offense: {
        threePoint: 1.0, midRange: 0.9, ballHandling: 0.7, layup: 0.8,
        closeShot: 0.6, freeThrow: 0.7, passAccuracy: 0.6, passVision: 0.5,
        passIQ: 0.5, drawFoul: 0.7, drivingDunk: 0.6,
        standingDunk: 0.3, postControl: 0.2,
      },
      defense: {
        perimeterDefense: 1.0, steal: 0.8, passPerception: 0.7,
        helpDefenseIQ: 0.6, interiorDefense: 0.3, block: 0.3,
        offensiveRebound: 0.3, defensiveRebound: 0.5,
      },
      physical: {
        speed: 0.9, acceleration: 0.8, stamina: 0.8,
        vertical: 0.7, strength: 0.5,
      },
    },
    SF: {
      offense: {
        threePoint: 0.8, midRange: 0.8, layup: 0.8, closeShot: 0.7,
        ballHandling: 0.6, passAccuracy: 0.5, passVision: 0.4, passIQ: 0.4,
        freeThrow: 0.6, drawFoul: 0.7, drivingDunk: 0.7,
        standingDunk: 0.5, postControl: 0.4,
      },
      defense: {
        perimeterDefense: 0.8, interiorDefense: 0.6, steal: 0.7,
        block: 0.5, helpDefenseIQ: 0.7, passPerception: 0.6,
        offensiveRebound: 0.5, defensiveRebound: 0.7,
      },
      physical: {
        speed: 0.7, acceleration: 0.7, stamina: 0.8,
        vertical: 0.7, strength: 0.7,
      },
    },
    PF: {
      offense: {
        postControl: 0.8, closeShot: 0.9, midRange: 0.7, layup: 0.8,
        standingDunk: 0.8, drivingDunk: 0.6, threePoint: 0.5,
        freeThrow: 0.6, drawFoul: 0.7, ballHandling: 0.3,
        passAccuracy: 0.4, passVision: 0.3, passIQ: 0.4,
      },
      defense: {
        interiorDefense: 0.9, block: 0.8, defensiveRebound: 0.9,
        offensiveRebound: 0.8, helpDefenseIQ: 0.7, perimeterDefense: 0.5,
        steal: 0.4, passPerception: 0.5,
      },
      physical: {
        strength: 0.9, vertical: 0.7, stamina: 0.7,
        speed: 0.5, acceleration: 0.5,
      },
    },
    C: {
      offense: {
        postControl: 1.0, closeShot: 0.9, standingDunk: 0.9, layup: 0.7,
        freeThrow: 0.5, drawFoul: 0.6, midRange: 0.4, drivingDunk: 0.4,
        threePoint: 0.2, ballHandling: 0.2, passAccuracy: 0.4,
        passVision: 0.3, passIQ: 0.4,
      },
      defense: {
        interiorDefense: 1.0, block: 1.0, defensiveRebound: 1.0,
        offensiveRebound: 0.9, helpDefenseIQ: 0.7, perimeterDefense: 0.3,
        steal: 0.3, passPerception: 0.4,
      },
      physical: {
        strength: 1.0, vertical: 0.6, stamina: 0.6,
        speed: 0.3, acceleration: 0.3,
      },
    },
  };

  return weights[position] ?? weights.SF;
}

// =============================================================================
// FATIGUE
// =============================================================================

/**
 * Update player fatigue based on minutes played.
 * Stamina and durability reduce fatigue accumulation.
 * If player plays 0 minutes, they get rest recovery instead.
 */
function updateFatigue(player, minutes) {
  const config = Config.FATIGUE;
  const current = player.fatigue ?? 0;

  // If player didn't play at all, they get full rest day recovery
  if (minutes === 0) {
    const recovery = getAttributeWeightedRecovery(player, config.rest_day_recovery);
    player.fatigue = Math.max(0, current - recovery);
    return player;
  }

  // Find the matching minute threshold bracket
  const thresholds = config.minute_thresholds;
  let bracket = null;
  for (const t of thresholds) {
    if (minutes >= t.min && minutes <= t.max) {
      bracket = t;
      break;
    }
  }

  // Fallback to last bracket if minutes exceed all ranges
  if (!bracket) {
    bracket = thresholds[thresholds.length - 1];
  }

  // Calculate stamina/durability modifier
  const stamina = player.attributes?.physical?.stamina ?? 70;
  const durability = player.attributes?.physical?.durability ?? 70;
  const athleticAvg = (stamina * 0.6 + durability * 0.4) / 100;

  if (bracket.type === 'recovery') {
    // Light minutes: player RECOVERS fatigue (attribute-weighted like rest recovery)
    const recovery = getAttributeWeightedRecovery(player, bracket.base);
    player.fatigue = Math.max(0, current - recovery);
  } else {
    // Moderate/heavy minutes: player GAINS fatigue (high attributes reduce gain)
    let gain = bracket.base * (1.2 - athleticAvg * 0.4);

    // Rookie wall penalty
    const gamesPlayed = player.games_played_this_season ?? player.gamesPlayedThisSeason ?? 0;
    const careerSeasons = player.career_seasons ?? player.careerSeasons ?? 0;
    const rookieConfig = Config.ROOKIE_WALL;

    if (careerSeasons === 0 && gamesPlayed >= rookieConfig.game_threshold) {
      if (gamesPlayed < rookieConfig.game_threshold + rookieConfig.duration_games) {
        gain *= rookieConfig.fatigue_multiplier;
      }
    }

    player.fatigue = Math.min(config.max_fatigue, current + gain);
  }

  return player;
}

/**
 * Recover fatigue during rest.
 * Recovery rate varies by ~15% and is weighted by stamina/durability.
 */
function recoverFatigue(player) {
  const config = Config.FATIGUE;
  const current = player.fatigue ?? 0;
  const recovery = getAttributeWeightedRecovery(player, config.weekly_recovery);
  player.fatigue = Math.max(0, current - recovery);
  return player;
}

// =============================================================================
// ATTRIBUTE CHANGES
// =============================================================================

/**
 * Apply attribute changes from micro-development and record to history.
 */
function applyAttributeChanges(player, changes, gameDate = null) {
  // Initialize development_history if not exists
  if (!player.development_history) {
    player.development_history = [];
  }

  const today = gameDate ?? new Date().toISOString().split('T')[0];

  for (const [path, change] of Object.entries(changes)) {
    const parts = path.split('.');
    if (parts.length === 2) {
      const category = parts[0];
      const attr = parts[1];
      if (player.attributes?.[category]?.[attr] !== undefined) {
        const current = player.attributes[category][attr];
        const newValue = Math.max(25, Math.min(99, current + change));
        player.attributes[category][attr] = newValue;

        // Record to development history
        player.development_history.push({
          date: today,
          category,
          attribute: attr,
          change: Math.round(change * 100) / 100,
          old_value: current,
          new_value: newValue,
        });
      }
    }
  }

  // Limit history to last 200 entries to prevent bloat
  if (player.development_history.length > 200) {
    player.development_history = player.development_history.slice(-200);
  }

  // Keep both key formats in sync
  player.developmentHistory = player.development_history;

  return player;
}

/**
 * Apply monthly attribute changes considering aging.
 */
function applyMonthlyAttributeChanges(player, devPoints, regPoints) {
  const age = devGetPlayerAge(player);
  const potential = player.potentialRating ?? player.potential_rating ?? 75;

  for (const category of Object.keys(player.attributes)) {
    const attrs = player.attributes[category];
    if (!attrs || typeof attrs !== 'object') continue;

    for (const attrName of Object.keys(attrs)) {
      const change = agingCalculateAttributeChange(attrName, age, devPoints, regPoints);

      // Can't exceed potential
      const newValue = attrs[attrName] + change;
      attrs[attrName] = Math.max(25, Math.min(potential, Math.round(newValue * 10) / 10));
    }
  }

  return player;
}

/**
 * Fallback: get player age from birth year or age field.
 */
function getPlayerAge(player) {
  if (player.age) return player.age;
  if (player.birthYear) return new Date().getFullYear() - player.birthYear;
  if (player.birth_year) return new Date().getFullYear() - player.birth_year;
  return 25; // Default
}

/**
 * Fallback: calculate attribute change for monthly updates.
 * Used only if applyAgingEffects doesn't expose calculateAttributeChange.
 */
function calculateAttributeChange(attrName, age, devPoints, regPoints) {
  // Find which profile this attribute belongs to
  for (const [, profile] of Object.entries(Config.ATTRIBUTE_PROFILES)) {
    if (profile.attributes.includes(attrName)) {
      let change = 0;
      if (age < profile.decline_start) {
        change = devPoints * 0.1;
      } else {
        change = -regPoints * profile.decline_rate * 0.1;
      }
      return change;
    }
  }
  return 0;
}

// =============================================================================
// OVERALL RATING
// =============================================================================

/**
 * Recalculate player's overall rating from attributes.
 */
function recalculateOverall(player) {
  const weights = Config.OVERALL_WEIGHTS;
  const attrs = player.attributes;

  const categoryAverages = {};
  for (const [category, categoryAttrs] of Object.entries(attrs)) {
    if (!categoryAttrs || typeof categoryAttrs !== 'object') continue;
    const values = Object.values(categoryAttrs);
    if (values.length === 0) continue;
    categoryAverages[category] = values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  let overall = 0;
  for (const [category, weight] of Object.entries(weights)) {
    overall += (categoryAverages[category] ?? 75) * weight;
  }

  overall = Math.round(Math.min(99, Math.max(40, overall)));

  player.overallRating = overall;
  player.overall_rating = overall;

  return player;
}

// =============================================================================
// PERFORMANCE TRACKING & STREAKS
// =============================================================================

/**
 * Track performance for streak detection.
 * Stores full game log entry with box score stats.
 */
function trackPerformance(player, rating, stats = {}, date = '', opponent = '', won = false) {
  const performances = player.recent_performances ?? player.recentPerformances ?? [];

  // Dedup: skip if this game was already tracked (same date + opponent)
  if (date && opponent) {
    for (const existing of performances) {
      if (Array.isArray(existing) === false && existing && existing.date === date && existing.opponent === opponent) {
        return player;
      }
    }
  }

  const entry = {
    rating: Math.round(rating * 10) / 10,
    date,
    opponent,
    won,
    min: parseInt(stats.minutes ?? 0, 10),
    pts: parseInt(stats.points ?? 0, 10),
    reb: parseInt((stats.offensiveRebounds ?? stats.offensive_rebounds ?? 0), 10) +
         parseInt((stats.defensiveRebounds ?? stats.defensive_rebounds ?? 0), 10),
    ast: parseInt(stats.assists ?? 0, 10),
    stl: parseInt(stats.steals ?? 0, 10),
    blk: parseInt(stats.blocks ?? 0, 10),
    to: parseInt(stats.turnovers ?? 0, 10),
    fgm: parseInt(stats.fieldGoalsMade ?? stats.fgm ?? 0, 10),
    fga: parseInt(stats.fieldGoalsAttempted ?? stats.fga ?? 0, 10),
    tpm: parseInt(stats.threePointersMade ?? stats.tpm ?? stats.fg3m ?? 0, 10),
    tpa: parseInt(stats.threePointersAttempted ?? stats.tpa ?? stats.fg3a ?? 0, 10),
    ftm: parseInt(stats.freeThrowsMade ?? stats.ftm ?? 0, 10),
    fta: parseInt(stats.freeThrowsAttempted ?? stats.fta ?? 0, 10),
  };

  performances.push(entry);

  // Keep last 10 performances
  const trimmed = performances.length > 10 ? performances.slice(-10) : performances;

  player.recent_performances = trimmed;
  player.recentPerformances = trimmed;

  return player;
}

/**
 * Count consecutive games meeting streak threshold.
 * Handles both old float entries and new object entries.
 */
function countStreak(performances, threshold, above) {
  let count = 0;
  for (let i = performances.length - 1; i >= 0; i--) {
    const val = (typeof performances[i] === 'object' && performances[i] !== null)
      ? (performances[i].rating ?? 0)
      : performances[i];
    const meetsThreshold = above ? val >= threshold : val <= threshold;
    if (meetsThreshold) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Process hot/cold streaks.
 */
function processStreaks(player) {
  const performances = player.recent_performances ?? player.recentPerformances ?? [];
  const streakConfig = Config.STREAKS;

  if (performances.length < streakConfig.hot_streak_games) {
    return player;
  }

  // Extract ratings from objects (with backwards compat for old float entries)
  const ratings = performances.map(p =>
    (typeof p === 'object' && p !== null) ? (p.rating ?? 0) : p
  );

  const recent = ratings.slice(-streakConfig.hot_streak_games);

  // Check for hot streak
  const allHot = recent.every(p => p >= streakConfig.hot_streak_threshold);
  if (allHot) {
    const streakLength = countStreak(performances, streakConfig.hot_streak_threshold, true);
    player.streak_data = {
      type: 'hot',
      games: Math.min(streakLength, streakConfig.max_streak_length),
    };
    player.streakData = player.streak_data;
  }

  // Check for cold streak
  const allCold = recent.every(p => p <= streakConfig.cold_streak_threshold);
  if (allCold) {
    const streakLength = countStreak(performances, streakConfig.cold_streak_threshold, false);
    player.streak_data = {
      type: 'cold',
      games: Math.min(streakLength, streakConfig.max_streak_length),
    };
    player.streakData = player.streak_data;
  }

  return player;
}

// =============================================================================
// RETIREMENT
// =============================================================================

/**
 * Check if player should retire.
 */
function shouldRetire(player, age) {
  const config = Config.RETIREMENT;

  if (age < config.min_age) {
    return false;
  }

  let chance = config.base_chance;
  chance += (age - config.min_age) * config.age_factor;

  const overall = player.overallRating ?? player.overall_rating ?? 70;
  if (overall < config.low_rating_threshold) {
    chance += config.low_rating_bonus;
  }

  return (Math.floor(Math.random() * 100) + 1) / 100 <= chance;
}

// =============================================================================
// UPGRADE POINTS
// =============================================================================

/**
 * Calculate upgrade points earned from recent attribute growth.
 * Higher potential players have slightly better point generation.
 */
function calculateUpgradePointsFromGrowth(player, sinceDate) {
  const config = Config.UPGRADE_POINTS;
  if (!config.enabled) {
    return 0;
  }

  const history = player.development_history ?? player.developmentHistory ?? [];

  // Sum positive changes from this week
  let totalGrowth = 0;
  for (const entry of history) {
    const entryDate = entry.date ?? null;
    const change = entry.change ?? 0;
    if (entryDate && entryDate >= sinceDate && change > 0) {
      totalGrowth += change;
    }
  }

  if (totalGrowth < config.min_growth_threshold) {
    return 0;
  }

  // Get player's potential rating for scaling
  const potential = player.potentialRating ?? player.potential_rating ?? 75;

  // Scale points_per_growth by potential (75 is baseline = 1.0x, 99 = ~1.32x, 60 = ~0.8x)
  const potentialMultiplier = potential / 75;
  const adjustedPointsPerGrowth = config.points_per_growth * potentialMultiplier;

  // Calculate base points
  let points = Math.floor(totalGrowth * adjustedPointsPerGrowth);

  // Determine max weekly points - elite potential (90+) gets +1 bonus cap
  let maxWeekly = config.max_weekly_points;
  if (potential >= 90) {
    maxWeekly += 1;
  }

  return Math.min(points, maxWeekly);
}

// =============================================================================
// AI UPGRADES
// =============================================================================

/**
 * Select which attribute the AI should upgrade.
 * Balances between improving weaknesses and enhancing strengths.
 */
function selectAIUpgrade(player, position, potential) {
  const attributes = player.attributes ?? {};
  const upgradeableCategories = ['offense', 'defense', 'physical']; // Mental cannot be upgraded

  // Get position-relevant attribute weights
  const positionWeights = getPositionAttributeWeights(position);

  // Collect all upgradeable attributes with their scores
  const candidates = [];

  for (const category of upgradeableCategories) {
    if (!attributes[category] || typeof attributes[category] !== 'object') {
      continue;
    }

    for (const [attrName, value] of Object.entries(attributes[category])) {
      // Skip if already at potential cap
      if (value >= potential) {
        continue;
      }

      // Calculate priority score
      const positionRelevance = positionWeights[category]?.[attrName] ?? 0.5;

      // Determine if this is a weakness or strength relative to category average
      const categoryValues = Object.values(attributes[category]);
      const categoryAvg = categoryValues.length > 0
        ? categoryValues.reduce((sum, v) => sum + v, 0) / categoryValues.length
        : 70;

      const isWeakness = value < categoryAvg - 3;
      const isStrength = value > categoryAvg + 3;

      // Base score from position relevance (0-1)
      let score = positionRelevance;

      // 60% chance to prioritize weaknesses, 40% strengths
      const prioritizeWeakness = Math.floor(Math.random() * 100) + 1 <= 60;

      if (prioritizeWeakness && isWeakness) {
        // Boost score for weaknesses (bigger gap = higher priority)
        const gap = categoryAvg - value;
        score += 0.3 + (gap / 30); // Up to +0.6 bonus for big gaps
      } else if (!prioritizeWeakness && isStrength) {
        // Boost score for strengths (already good, make better)
        score += 0.25;
      } else if (isWeakness) {
        // Still give some bonus to weaknesses even when not prioritizing
        score += 0.1;
      }

      // Small random factor for variety
      score += Math.floor(Math.random() * 21) / 100;

      candidates.push({
        category,
        attribute: attrName,
        value,
        score,
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Sort by score descending and pick the best
  candidates.sort((a, b) => b.score - a.score);

  return candidates[0];
}

/**
 * Process AI auto-upgrades for a player.
 * AI spends all available upgrade points intelligently.
 */
function processAIUpgrades(player, upgradeDate = null) {
  let points = player.upgrade_points ?? player.upgradePoints ?? 0;
  if (points <= 0) {
    return player;
  }

  const potential = player.potentialRating ?? player.potential_rating ?? 99;
  const position = player.position ?? 'SF';
  const date = upgradeDate ?? new Date().toISOString().split('T')[0];

  // Spend all available points
  while (points > 0) {
    const upgrade = selectAIUpgrade(player, position, potential);
    if (!upgrade) {
      break; // No valid upgrades available (all at cap)
    }

    // Apply the upgrade
    const { category, attribute } = upgrade;
    const currentValue = player.attributes[category][attribute];
    const newValue = Math.min(potential, currentValue + 1);

    player.attributes[category][attribute] = newValue;

    // Record in development history
    const history = player.development_history ?? player.developmentHistory ?? [];
    history.push({
      date,
      category,
      attribute,
      change: 1,
      old_value: currentValue,
      new_value: newValue,
      source: 'ai_upgrade',
    });
    player.development_history = history.slice(-200);
    player.developmentHistory = player.development_history;

    points--;
  }

  player.upgrade_points = points;
  player.upgradePoints = points;

  return player;
}

// =============================================================================
// POST-GAME PROCESSING (per-team)
// =============================================================================

/**
 * Process a single team's players after a game.
 * Returns { players, summary } with modified player data and evolution summary.
 *
 * @param {Array} roster - Team roster (array of player objects)
 * @param {Array} boxScores - Box score stats for each player
 * @param {boolean} won - Whether this team won
 * @param {boolean} isPlayoff - Whether this is a playoff game
 * @param {string} difficulty - Campaign difficulty
 * @param {string} gameDate - Date of the game (YYYY-MM-DD)
 * @param {string} opponentAbbr - Opposing team abbreviation
 * @param {number} teamScore - This team's score
 * @param {number} opponentScore - Opponent's score
 * @param {number} streak - Current team win/loss streak
 * @returns {{ players: Object, summary: Object }}
 */
function processTeamPostGame(
  roster,
  boxScores,
  won,
  isPlayoff,
  difficulty = 'pro',
  gameDate = null,
  opponentAbbr = '',
  teamScore = 0,
  opponentScore = 0,
  streak = 0
) {
  const evolutionSummary = {
    injuries: [],
    recoveries: [],
    development: [],
    regression: [],
    fatigue_warnings: [],
    morale_changes: [],
    hot_streaks: [],
    cold_streaks: [],
  };

  const newsEvents = [];
  const updatedPlayers = {};

  for (const stats of boxScores) {
    // Handle both keyed (by player_id) and indexed arrays
    const playerId = stats.player_id ?? stats.playerId ?? null;
    if (!playerId) continue;

    let player = findPlayerInRoster(roster, playerId);
    if (!player) continue;

    // Clone to avoid mutating original
    player = clonePlayer(player);

    const playerName = getPlayerName(player);

    // Process injury recovery for already-injured players FIRST
    if (checkIsInjured(player)) {
      const existingInjury = player.injury_details ?? player.injuryDetails ?? null;
      player = processRecovery(player);

      // Check if just recovered
      const stillInjured = checkIsInjured(player);

      if (existingInjury && !stillInjured) {
        newsEvents.push(generateEvolutionNews('recovery', player, { injury: existingInjury, gameDate }));

        evolutionSummary.recoveries.push({
          player_id: playerId,
          name: playerName,
          injury_type: existingInjury.name ?? existingInjury.injury_type ?? 'Injury',
        });
      }
    }

    const oldMorale = player.personality?.morale ?? 80;

    // Update fatigue
    const oldFatigue = player.fatigue ?? 0;
    player = updateFatigue(player, stats.minutes ?? 0);
    const newFatigue = player.fatigue ?? 0;

    // Fatigue warning if getting high
    if (newFatigue >= 70 && oldFatigue < 70) {
      evolutionSummary.fatigue_warnings.push({
        player_id: playerId,
        name: playerName,
        fatigue: Math.round(newFatigue),
      });
    }

    // Check for NEW injury (only for players who actually played minutes)
    const minutesPlayed = stats.minutes ?? 0;
    const isCurrentlyInjured = checkIsInjured(player);

    let injury = null;
    if (minutesPlayed > 0 && !isCurrentlyInjured) {
      injury = checkForInjury(player, minutesPlayed, isPlayoff);
    }

    if (injury) {
      player.is_injured = true;
      player.isInjured = true;
      player.injury_details = injury;
      player.injuryDetails = injury;

      // Create injury news
      newsEvents.push(generateEvolutionNews('injury', player, { injury, gameDate }));

      // Add to summary
      evolutionSummary.injuries.push({
        player_id: playerId,
        name: playerName,
        injury_type: injury.name ?? 'Unknown',
        games_out: injury.games_remaining ?? injury.gamesRemaining ?? 0,
        severity: injury.severity ?? 'minor',
      });
    }

    // Update morale
    const gameResult = { won, streak };
    player = updateAfterGame(player, gameResult, stats, difficulty);
    const newMorale = player.personality?.morale ?? 80;

    // Track significant morale changes
    const moraleDiff = newMorale - oldMorale;
    if (Math.abs(moraleDiff) >= 3) {
      evolutionSummary.morale_changes.push({
        player_id: playerId,
        name: playerName,
        change: moraleDiff,
        new_morale: newMorale,
      });
    }

    // Apply micro-development (if not injured)
    const isInjuredNow = checkIsInjured(player);

    if (!isInjuredNow) {
      const microDev = calculateMicroDevelopment(player, stats, difficulty);
      if (microDev && microDev.attributeChanges && Object.keys(microDev.attributeChanges).length > 0) {
        player = applyAttributeChanges(player, microDev.attributeChanges, gameDate);

        // Add to development or regression summary
        if (microDev.type === 'development') {
          evolutionSummary.development.push({
            player_id: playerId,
            name: playerName,
            performance_rating: Math.round(microDev.performanceRating * 10) / 10,
            attributes_improved: Object.keys(microDev.attributeChanges),
          });
        } else if (microDev.type === 'regression') {
          evolutionSummary.regression.push({
            player_id: playerId,
            name: playerName,
            performance_rating: Math.round(microDev.performanceRating * 10) / 10,
            attributes_declined: Object.keys(microDev.attributeChanges),
          });
        }
      }

      // Track performance for streaks
      const performanceRating = microDev?.performanceRating ?? 0;
      const oldStreakData = player.streak_data ?? player.streakData ?? null;
      player = trackPerformance(
        player,
        performanceRating,
        stats,
        gameDate ?? new Date().toISOString().split('T')[0],
        opponentAbbr,
        won
      );

      // Check for new streak
      const newStreakData = player.streak_data ?? player.streakData ?? null;
      if (newStreakData && (!oldStreakData || newStreakData.games > (oldStreakData.games ?? 0))) {
        if (newStreakData.type === 'hot') {
          evolutionSummary.hot_streaks.push({
            player_id: playerId,
            name: playerName,
            games: newStreakData.games,
          });
        } else if (newStreakData.type === 'cold') {
          evolutionSummary.cold_streaks.push({
            player_id: playerId,
            name: playerName,
            games: newStreakData.games,
          });
        }
      }
    }

    // Update season stats - only count as game played if player had minutes
    if (minutesPlayed > 0) {
      player.games_played_this_season = (player.games_played_this_season ?? player.gamesPlayedThisSeason ?? 0) + 1;
      player.gamesPlayedThisSeason = player.games_played_this_season;
    }
    player.minutes_played_this_season = (player.minutes_played_this_season ?? player.minutesPlayedThisSeason ?? 0) + minutesPlayed;
    player.minutesPlayedThisSeason = player.minutes_played_this_season;

    updatedPlayers[player.id] = player;
  }

  // Filter out empty arrays from summary
  const filteredSummary = {};
  for (const [key, arr] of Object.entries(evolutionSummary)) {
    if (arr.length > 0) {
      filteredSummary[key] = arr;
    }
  }

  return {
    players: updatedPlayers,
    ...filteredSummary,
    news: newsEvents.filter(Boolean),
  };
}

// =============================================================================
// MAIN EXPORTED FUNCTIONS
// =============================================================================

/**
 * Process evolution after a game is completed for both teams.
 * Called for ALL players who participated.
 *
 * @param {Object} gameData - Game data including team abbreviations
 * @param {number} homeScore - Home team score
 * @param {number} awayScore - Away team score
 * @param {Object} boxScores - { home: [...], away: [...] }
 * @param {Array} homeRoster - Home team roster
 * @param {Array} awayRoster - Away team roster
 * @param {string} difficulty - Campaign difficulty setting
 * @param {boolean} isPlayoff - Whether this is a playoff game
 * @param {string} gameDate - Date of the game (YYYY-MM-DD)
 * @returns {{ home: Object, away: Object }} - Evolution results per team
 */
export function processPostGame(
  gameData,
  homeScore,
  awayScore,
  boxScores,
  homeRoster,
  awayRoster,
  difficulty = 'pro',
  isPlayoff = false,
  gameDate = null
) {
  const date = gameDate ?? new Date().toISOString().split('T')[0];

  // Process home team
  const homeResult = processTeamPostGame(
    homeRoster,
    boxScores.home ?? [],
    homeScore > awayScore,
    isPlayoff,
    difficulty,
    date,
    gameData.awayTeamAbbreviation ?? '',
    homeScore,
    awayScore,
    0 // streak - caller can provide via gameData if available
  );

  // Process away team
  const awayResult = processTeamPostGame(
    awayRoster,
    boxScores.away ?? [],
    awayScore > homeScore,
    isPlayoff,
    difficulty,
    date,
    gameData.homeTeamAbbreviation ?? '',
    awayScore,
    homeScore,
    0
  );

  return {
    home: homeResult,
    away: awayResult,
  };
}

/**
 * Process per-game micro-development for a single player.
 * Lightweight version for when you only need to process one player's game stats.
 *
 * @param {Object} player - Player data object
 * @param {Object} gameStats - Box score stats for the game
 * @param {string} difficulty - Campaign difficulty
 * @returns {{ player: Object, news: Array }} - Modified player + generated news
 */
export function processGameDevelopment(player, gameStats, difficulty = 'pro') {
  let p = clonePlayer(player);
  const newsEvents = [];

  // Skip injured players
  const isInjured = p.is_injured ?? p.isInjured ?? false;
  if (isInjured) {
    return { player: p, news: [] };
  }

  const microDev = calculateMicroDevelopment(p, gameStats, difficulty);
  if (microDev && microDev.attributeChanges && Object.keys(microDev.attributeChanges).length > 0) {
    p = applyAttributeChanges(p, microDev.attributeChanges);
  }

  // Recalculate overall
  p = recalculateOverall(p);

  return {
    player: p,
    news: newsEvents,
    development: microDev,
  };
}

/**
 * Process weekly evolution updates for an array of players.
 * Handles injury recovery, fatigue recovery, morale, streaks, and upgrade points.
 *
 * @param {Array} players - Array of player objects
 * @param {Object} gameResults - { teamRecords: { [abbr]: { wins, losses } } }
 * @param {string} difficulty - Campaign difficulty
 * @param {number} week - Current week number
 * @param {Object} options - Additional options
 * @param {string} options.currentDate - Campaign current date (YYYY-MM-DD)
 * @param {boolean} options.isAI - Whether these are AI-controlled players
 * @returns {{ players: Array, upgradePointsAwarded: Array, news: Array }}
 */
export function processWeeklyEvolution(players, gameResults = {}, difficulty = 'pro', week = 0, options = {}) {
  const { currentDate = null, isAI = false } = options;
  const teamRecords = gameResults.teamRecords ?? {};
  const upgradePointsAwarded = [];
  const newsEvents = [];

  const date = currentDate ?? new Date().toISOString().split('T')[0];
  // Calculate a week ago for upgrade point growth window
  const weekAgoDate = (() => {
    const d = new Date(date);
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  })();

  const updatedPlayers = players.map(rawPlayer => {
    let player = clonePlayer(rawPlayer);

    // Process injury recovery
    const wasInjured = player.is_injured ?? player.isInjured ?? false;
    if (wasInjured) {
      const injury = player.injury_details ?? player.injuryDetails ?? null;
      player = processRecovery(player);

      // Check if just recovered
      const stillInjured = player.is_injured ?? player.isInjured ?? false;
      if (wasInjured && !stillInjured && injury) {
        newsEvents.push(generateEvolutionNews('recovery', player, { injury }));
      }
    }

    // Natural fatigue recovery
    player = recoverFatigue(player);

    // Update morale based on team performance
    const teamAbbr = player.teamAbbreviation ?? '';
    const record = teamRecords[teamAbbr] ?? { wins: 0, losses: 0 };
    player = updateWeekly(player, record, null, difficulty);

    // Check for hot/cold streaks
    player = processStreaks(player);

    // Award upgrade points based on weekly growth
    const earnedPoints = calculateUpgradePointsFromGrowth(player, weekAgoDate);
    if (earnedPoints > 0) {
      const maxPoints = Config.UPGRADE_POINTS.max_stored_points;
      const currentPoints = player.upgrade_points ?? player.upgradePoints ?? 0;
      player.upgrade_points = Math.min(maxPoints, currentPoints + earnedPoints);
      player.upgradePoints = player.upgrade_points;

      upgradePointsAwarded.push({
        player_id: player.id,
        name: getPlayerName(player),
        points_earned: earnedPoints,
        total_points: player.upgrade_points,
      });
    }

    // AI teams automatically spend upgrade points
    if (isAI) {
      player = processAIUpgrades(player, date);
    }

    // Recalculate overall rating
    player = recalculateOverall(player);

    return player;
  });

  return {
    players: updatedPlayers,
    upgradePointsAwarded,
    news: newsEvents.filter(Boolean),
  };
}

/**
 * Process monthly development checkpoint for an array of players.
 *
 * @param {Array} players - Array of player objects
 * @param {string} difficulty - Campaign difficulty
 * @param {Object} options - Additional options
 * @param {Array} options.fullRoster - Full team roster for mentor/synergy calculations
 * @returns {{ players: Array, news: Array }}
 */
export function processMonthlyDevelopment(players, difficulty = 'pro', options = {}) {
  const { fullRoster = null } = options;
  const newsEvents = [];

  const updatedPlayers = players.map(rawPlayer => {
    let player = clonePlayer(rawPlayer);

    // No development while injured
    const isInjured = player.is_injured ?? player.isInjured ?? false;
    if (isInjured) {
      return player;
    }

    // Calculate context
    const gamesPlayed = player.games_played_this_season ?? player.gamesPlayedThisSeason ?? 0;
    const minutesPlayed = player.minutes_played_this_season ?? player.minutesPlayedThisSeason ?? 0;
    const avgMinutes = gamesPlayed > 0 ? minutesPlayed / gamesPlayed : 0;

    // Check for mentors
    const roster = fullRoster ?? players;
    const mentors = personalityEffects.findMentorsForPlayer(player, roster);
    const hasMentor = mentors.length > 0;

    // Calculate badge synergy boost
    const synergyBoost = badgeSynergyService.calculateDevelopmentBoost(player, roster);

    // Calculate Dynamic Duo boost
    const duoBoost = badgeSynergyService.getDynamicDuoBoost(player, roster);

    const context = {
      avgMinutesPerGame: avgMinutes,
      hasMentor,
      badgeSynergyBoost: synergyBoost,
      dynamicDuoBoost: duoBoost,
    };

    // Calculate development and regression
    const devPoints = calculateMonthlyDevelopment(player, context);
    const regPoints = calculateMonthlyRegression(player);

    // Apply personality modifiers
    const personalityMod = personalityEffects.getDevelopmentModifier(player);
    const adjustedDevPoints = devPoints * (1 + personalityMod);

    // Apply to attributes
    if (adjustedDevPoints > 0 || regPoints > 0) {
      player = applyMonthlyAttributeChanges(player, adjustedDevPoints, regPoints);
    }

    // Recalculate overall
    const oldOverall = player.overallRating ?? player.overall_rating ?? 70;
    player = recalculateOverall(player);
    const newOverall = player.overallRating ?? player.overall_rating ?? 70;

    // Generate news for significant changes
    const change = newOverall - oldOverall;
    if (change >= 3) {
      newsEvents.push(generateEvolutionNews('breakout', player, { change }));
    } else if (change <= -2) {
      newsEvents.push(generateEvolutionNews('decline', player, { change: Math.abs(change) }));
    }

    return player;
  });

  return {
    players: updatedPlayers,
    news: newsEvents.filter(Boolean),
  };
}

/**
 * Process end-of-season (offseason) progression for all players.
 * Handles aging, retirement checks, injury healing, contract decrements, and stat resets.
 *
 * @param {Array} players - Array of player objects
 * @param {Object} seasonStats - Season statistics (unused currently, reserved for future)
 * @param {string} difficulty - Campaign difficulty
 * @returns {{ players: Array, results: Object, news: Array }}
 */
export function processSeasonEnd(players, seasonStats = {}, difficulty = 'pro') {
  const results = {
    developed: [],
    regressed: [],
    retired: [],
  };
  const newsEvents = [];
  const activePlayers = [];

  for (const rawPlayer of players) {
    let player = clonePlayer(rawPlayer);
    const oldOverall = player.overallRating ?? player.overall_rating ?? 70;

    // Injuries carry over — heal game-by-game next season via processRecovery()

    // Reset fatigue
    player.fatigue = 0;

    // Increment career seasons
    player.career_seasons = (player.career_seasons ?? player.careerSeasons ?? 0) + 1;
    player.careerSeasons = player.career_seasons;

    // Apply seasonal aging
    const age = getPlayerAge(player);
    if (player.attributes) {
      player.attributes = applySeasonalAging(player.attributes, age);
    }

    // Check for retirement
    if (shouldRetire(player, age)) {
      player.is_retired = true;
      player.isRetired = true;
      results.retired.push(getPlayerName(player));
      newsEvents.push(generateEvolutionNews('retirement', player, {
        careerSeasons: player.career_seasons ?? 1,
      }));
      // Don't add retired players to active roster
      continue;
    }

    // Reset season stats
    player.games_played_this_season = 0;
    player.gamesPlayedThisSeason = 0;
    player.minutes_played_this_season = 0;
    player.minutesPlayedThisSeason = 0;
    player.recent_performances = [];
    player.recentPerformances = [];
    player.streak_data = null;
    player.streakData = null;

    // Decrement contract
    const yearsRemaining = player.contract_years_remaining ?? player.contractYearsRemaining ?? 1;
    player.contract_years_remaining = Math.max(0, yearsRemaining - 1);
    player.contractYearsRemaining = player.contract_years_remaining;

    // Recalculate overall
    player = recalculateOverall(player);
    const newOverall = player.overallRating ?? player.overall_rating ?? 70;
    const change = newOverall - oldOverall;

    if (newOverall > oldOverall) {
      results.developed.push(`${getPlayerName(player)} (+${change})`);
    } else if (newOverall < oldOverall) {
      results.regressed.push(`${getPlayerName(player)} (${change})`);
    }

    activePlayers.push(player);
  }

  return {
    players: activePlayers,
    results,
    news: newsEvents.filter(Boolean),
  };
}

/**
 * Process rest day recovery for players on teams that did not play.
 *
 * @param {Array} players - Array of player objects
 * @param {Array} teamsWithGames - Array of team abbreviations that had games today
 * @returns {Array} - Updated player array
 */
export function processRestDayRecovery(players, teamsWithGames = []) {
  const restRecovery = Config.FATIGUE.rest_day_recovery;

  return players.map(rawPlayer => {
    const teamAbbr = rawPlayer.teamAbbreviation ?? '';
    if (teamsWithGames.includes(teamAbbr)) {
      return rawPlayer; // Team played today, skip rest recovery
    }

    const currentFatigue = rawPlayer.fatigue ?? 0;
    if (currentFatigue <= 0) {
      return rawPlayer; // Already fully rested
    }

    const player = clonePlayer(rawPlayer);
    const recovery = getAttributeWeightedRecovery(player, restRecovery);
    player.fatigue = Math.max(0, currentFatigue - recovery);
    return player;
  });
}

/**
 * Process multi-day rest recovery for players.
 * For each team, applies rest recovery for each day they did not have a game.
 *
 * @param {Array} players - Array of player objects
 * @param {Array} teamsPerDay - Array of arrays, each containing team abbreviations that played on that day
 * @returns {Array} - Updated player array
 */
export function processMultiDayRestRecovery(players, teamsPerDay = []) {
  const totalDays = teamsPerDay.length;
  if (totalDays === 0) return players;

  const restRecovery = Config.FATIGUE.rest_day_recovery;

  // Count games per team
  const gamesPerTeam = {};
  for (const dayTeams of teamsPerDay) {
    for (const teamAbbr of dayTeams) {
      gamesPerTeam[teamAbbr] = (gamesPerTeam[teamAbbr] ?? 0) + 1;
    }
  }

  return players.map(rawPlayer => {
    const teamAbbr = rawPlayer.teamAbbreviation ?? '';
    const games = gamesPerTeam[teamAbbr] ?? 0;
    const restDays = totalDays - games;

    if (restDays <= 0) return rawPlayer;

    const currentFatigue = rawPlayer.fatigue ?? 0;
    if (currentFatigue <= 0) return rawPlayer;

    const player = clonePlayer(rawPlayer);
    let totalRecovery = 0;
    for (let i = 0; i < restDays; i++) {
      totalRecovery += getAttributeWeightedRecovery(player, restRecovery);
    }
    player.fatigue = Math.max(0, currentFatigue - totalRecovery);
    return player;
  });
}

// =============================================================================
// ADDITIONAL EXPORTS (for use by other modules)
// =============================================================================

export {
  recalculateOverall,
  getPlayerName,
  findPlayerInRoster,
  groupPlayersByTeam,
  updateFatigue,
  recoverFatigue,
  applyAttributeChanges,
  trackPerformance,
  processStreaks,
  shouldRetire,
  processAIUpgrades,
  selectAIUpgrade,
  getPositionAttributeWeights,
  calculateUpgradePointsFromGrowth,
  getAttributeWeightedRecovery,
};
