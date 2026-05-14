/**
 * MoraleService.js
 *
 * Handles player morale updates, trade requests, team chemistry, and morale effects.
 * Translated from backend/app/Services/PlayerEvolution/MoraleService.php
 */

import { MORALE, PERSONALITY_TRAITS } from '../config/GameConfig.js';
import { strictnessWeeklyMoraleShift } from '@/engine/coaching/CoachStrictnessService';

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

function getMentalAttr(player, name) {
  return player.attributes?.mental?.[name] ?? 50;
}

/**
 * Multiplier for the `playing_time_unmet` morale penalty. Role-accepting
 * bench players (team_player / quiet / mentor, high coachability + work
 * ethic) shrug off short minutes; ball-hogs, media darlings, and high-OVR
 * players who think they should be starting feel it more.
 *
 * `hot_head` is intentionally not boosted here — it already amplifies the
 * full morale delta via the volatility multiplier at the end of
 * `updateAfterGame`, so layering on top would double-count.
 *
 * Clamped to [0.1, 2.0] so the floor is "barely a nudge" and the ceiling is
 * "2× the original sting."
 */
function roleAcceptanceUnmetMultiplier(player) {
  const traits = player.personality?.traits ?? [];
  let mult = 1.0;

  // Role-accepting traits soften the penalty
  if (traits.includes('team_player')) mult -= 0.5;
  if (traits.includes('mentor')) mult -= 0.4;
  if (traits.includes('quiet')) mult -= 0.3;
  if (traits.includes('joker')) mult -= 0.15;

  // Role-rejecting traits sharpen it
  if (traits.includes('ball_hog')) mult += 0.5;
  if (traits.includes('media_darling')) mult += 0.25;

  // Mental attributes — coachability is the big one (buying into the role),
  // work ethic is the secondary signal (grinder mindset over playing-time
  // grievance). Centered at 50 so average attributes are neutral.
  const coachability = getMentalAttr(player, 'coachability');
  const workEthic = getMentalAttr(player, 'workEthic');
  mult -= ((coachability - 50) / 100) * 0.6;
  mult -= ((workEthic - 50) / 100) * 0.4;

  // Top-tier players who get benched still chafe — acceptance traits can
  // dampen, but not erase, the "I should be starting" reality.
  const overall = player.overallRating ?? player.overall_rating ?? 70;
  if (overall >= 80) mult += 0.3;
  else if (overall >= 75) mult += 0.15;

  return Math.max(0.1, Math.min(2.0, mult));
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
    morale += factors.playing_time_unmet * roleAcceptanceUnmetMultiplier(player);
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
 * @param {object|null} coach - Head coach (for strictness fit). Optional.
 * @returns {object} Updated player object
 */
function updateWeekly(player, teamRecord, coach = null) {
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

  // Coach strictness fit — small weekly shift that compounds over a season.
  // High-impact stars with low work ethic drift down under a strict coach;
  // high-WE / winning-motivated grinders drift up.
  if (coach) {
    morale += strictnessWeeklyMoraleShift(player, coach);
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

/**
 * Compute the morale penalty a single player takes when their head coach is
 * fired or replaced mid-season. Returns a NEGATIVE integer (or 0).
 *
 * Scaling — base is -5 ("mild"), then:
 *   - bonded vs resilient: (coachability - workEthic) on a ±0.3 axis. High
 *     coachability and low workEthic = player took the firing harder; the
 *     opposite = shrugs it off.
 *   - personality stability: team_player / quiet players hold steady (×0.5);
 *     leaders are stoic (×0.7); hot_heads erupt (×1.6). Mirrors the
 *     `morale_stability` / `morale_volatility` weights used elsewhere in
 *     this file.
 *
 * The result is clamped to [-12, -1] so even a hot-head superfan of the old
 * coach can't lose more than a dozen morale points from a single firing.
 *
 * @param {object} player - Player object (expects player.attributes.mental.* and player.personality.traits[])
 * @returns {number} integer in [-12, -1] (or 0 if the player has no mental block)
 */
function computeCoachChangeMoralePenalty(player) {
  if (!player || !player.attributes?.mental) return 0
  const base = -5
  const coachability = player.attributes.mental.coachability ?? 70
  const workEthic = player.attributes.mental.workEthic ?? 70

  // Bond vs resilience: centered at 0 when both equal. ±30pt swing → ±0.3 scale.
  const bondVsResilience = (coachability - workEthic) / 100
  const attrScale = 1 + bondVsResilience  // typical 0.7 .. 1.3

  const traits = player.personality?.traits ?? []
  let traitMult = 1
  if (traits.includes('team_player') || traits.includes('quiet')) traitMult = 0.5
  else if (traits.includes('leader')) traitMult = 0.7
  if (traits.includes('hot_head')) traitMult *= 1.6

  const raw = Math.round(base * attrScale * traitMult)
  return Math.max(-12, Math.min(-1, raw))
}

/**
 * Apply a coach-change morale penalty across a roster. Mutates each player's
 * `personality.morale` in place AND returns the list of mutated players (so
 * the caller can persist them via PlayerRepository.saveBulk).
 *
 * Skipped entirely when the average roster morale is already below 50 — the
 * firing is welcomed, no further hit. Also skipped when `phase` indicates
 * offseason; coach contract expiry is expected and there's a buffer.
 *
 * @param {Array} roster - array of player objects
 * @param {{ phase?: string }} options
 * @returns {{ updated: Array, skippedReason?: string }}
 */
function applyCoachChangePenalty(roster, { phase = 'regular_season' } = {}) {
  if (phase === 'offseason') return { updated: [], skippedReason: 'offseason' }
  const players = (roster || []).filter(p => p)
  if (players.length === 0) return { updated: [], skippedReason: 'empty_roster' }

  const total = players.reduce((s, p) => s + (p.personality?.morale ?? 80), 0)
  const avg = total / players.length
  if (avg < 50) return { updated: [], skippedReason: 'team_morale_below_50' }

  const updated = []
  for (const player of players) {
    const penalty = computeCoachChangeMoralePenalty(player)
    if (penalty === 0) continue
    if (!player.personality) player.personality = { morale: 80 }
    const current = player.personality.morale ?? 80
    player.personality.morale = clamp(current + penalty)
    updated.push(player)
  }
  return { updated }
}

export {
  updateAfterGame,
  updateWeekly,
  checkForTradeRequest,
  calculateTeamChemistry,
  getMoraleLevel,
  getPerformanceModifier,
  getDevelopmentModifier,
  computeCoachChangeMoralePenalty,
  applyCoachChangePenalty,
};
