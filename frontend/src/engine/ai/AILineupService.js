// =============================================================================
// AILineupService.js
// =============================================================================
// AI lineup selection, fatigue management, and substitution strategy logic.
// Translated from PHP: backend/app/Services/AILineupService.php
// =============================================================================

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// Fatigue thresholds for lineup decisions
const FATIGUE_REST_THRESHOLD = 70;      // Rest player if fatigue >= this
const FATIGUE_CAUTION_THRESHOLD = 50;   // Start considering fatigue at this level
const FATIGUE_RATING_PENALTY = 0.5;     // Rating points to subtract per fatigue point over caution threshold

// =============================================================================
// HELPERS
// =============================================================================

function getPlayerRating(player) {
  return player.overallRating ?? player.overall_rating ?? 70;
}

function getPlayerPosition(player) {
  return player.position ?? null;
}

function getPlayerSecondaryPosition(player) {
  return player.secondaryPosition ?? player.secondary_position ?? null;
}

function isPlayerInjured(player) {
  return player.isInjured ?? player.is_injured ?? false;
}

// =============================================================================
// EFFECTIVE RATING
// =============================================================================

/**
 * Calculate effective rating based on fatigue.
 * Players above the caution threshold have their rating penalized.
 * @param {number} rating
 * @param {number} fatigue
 * @returns {number}
 */
export function calculateEffectiveRating(rating, fatigue) {
  if (fatigue <= FATIGUE_CAUTION_THRESHOLD) {
    return rating;
  }

  const fatigueOverCaution = fatigue - FATIGUE_CAUTION_THRESHOLD;
  const penalty = fatigueOverCaution * FATIGUE_RATING_PENALTY;

  return Math.max(0, rating - penalty);
}

// =============================================================================
// SELECT BEST LINEUP
// =============================================================================

/**
 * Select the best starting lineup from a roster.
 * Returns array of 5 player IDs in position order (PG, SG, SF, PF, C).
 * Factors in fatigue - highly fatigued players are deprioritized or rested.
 * @param {Array} roster - Array of player objects
 * @returns {Array} Array of 5 player IDs (or null for unfilled slots)
 */
export function selectBestLineup(roster) {
  const lineup = {};
  const usedPlayerIds = [];

  // Calculate effective rating for each player (rating adjusted by fatigue)
  const rosterWithEffectiveRating = roster.map(player => {
    const rating = getPlayerRating(player);
    const fatigue = player.fatigue ?? 0;
    const effectiveRating = calculateEffectiveRating(rating, fatigue);

    return {
      ...player,
      effectiveRating,
      shouldRest: fatigue >= FATIGUE_REST_THRESHOLD,
    };
  });

  // Sort by effective rating (highest first)
  rosterWithEffectiveRating.sort((a, b) => (b.effectiveRating ?? 0) - (a.effectiveRating ?? 0));

  // First pass: assign players to their natural positions (skip those who should rest if alternatives exist)
  for (const pos of POSITIONS) {
    let bestCandidate = null;

    for (const player of rosterWithEffectiveRating) {
      const playerId = player.id ?? null;
      if (!playerId) continue;
      if (isPlayerInjured(player)) continue;
      if (usedPlayerIds.includes(playerId)) continue;

      const primaryPos = getPlayerPosition(player);
      const secondaryPos = getPlayerSecondaryPosition(player);

      if (primaryPos === pos || secondaryPos === pos) {
        const shouldRest = player.shouldRest ?? false;

        // If this player should rest but we haven't found anyone yet, save as fallback
        if (shouldRest && !bestCandidate) {
          bestCandidate = player;
          continue;
        }

        // Found a player who doesn't need rest - use them
        if (!shouldRest) {
          bestCandidate = player;
          break;
        }
      }
    }

    if (bestCandidate) {
      lineup[pos] = bestCandidate.id;
      usedPlayerIds.push(bestCandidate.id);
    }
  }

  // Second pass: fill any remaining positions with best available
  for (const pos of POSITIONS) {
    if (!lineup[pos]) {
      for (const player of rosterWithEffectiveRating) {
        const playerId = player.id ?? null;
        if (!playerId) continue;
        if (isPlayerInjured(player)) continue;
        if (usedPlayerIds.includes(playerId)) continue;

        lineup[pos] = playerId;
        usedPlayerIds.push(playerId);
        break;
      }
    }
  }

  // Convert to array in position order
  return POSITIONS.map(pos => lineup[pos] ?? null);
}

// =============================================================================
// SUBSTITUTION STRATEGY
// =============================================================================

/**
 * Auto-select substitution strategy for AI teams based on roster composition.
 * @param {Array} roster - Full roster
 * @param {Array} starterIds - Array of 5 starter IDs
 * @returns {string} 'staggered' | 'platoon' | 'tight_rotation' | 'deep_bench'
 */
export function selectSubstitutionStrategy(roster, starterIds) {
  let playersRated65Plus = 0;
  const topTwoRatings = [];
  const benchRatings = [];

  for (const player of roster) {
    const rating = getPlayerRating(player);
    const playerId = player.id ?? null;
    const isStarter = starterIds.includes(playerId);

    if (rating >= 65) {
      playersRated65Plus++;
    }

    if (isStarter) {
      topTwoRatings.push(rating);
    } else {
      benchRatings.push(rating);
    }
  }

  // Sort descending
  topTwoRatings.sort((a, b) => b - a);
  benchRatings.sort((a, b) => b - a);

  // If 10+ players rated >= 65 -> deep_bench
  if (playersRated65Plus >= 10) {
    return 'deep_bench';
  }

  // If top 2 players rated >= 85 and gap to bench > 15 -> tight_rotation
  if (topTwoRatings.length >= 2 && topTwoRatings[0] >= 85 && topTwoRatings[1] >= 85) {
    const topBench = benchRatings[0] ?? 0;
    if ((topTwoRatings[1] - topBench) > 15) {
      return 'tight_rotation';
    }
  }

  // Random 30% chance of platoon
  if (Math.random() * 100 <= 30) {
    return 'platoon';
  }

  return 'staggered';
}

// =============================================================================
// FIND REPLACEMENT
// =============================================================================

/**
 * Find a replacement player for a position.
 * Considers fatigue in addition to rating and position fit.
 * @param {Array} roster
 * @param {Array} currentStarters - Array of current starter IDs
 * @param {string} position
 * @returns {string|null} Replacement player ID or null
 */
export function findReplacement(roster, currentStarters, position) {
  let candidates = [];

  for (const player of roster) {
    const playerId = player.id ?? null;
    if (!playerId) continue;
    if (currentStarters.includes(playerId)) continue;
    if (isPlayerInjured(player)) continue;

    const rating = getPlayerRating(player);
    const fatigue = player.fatigue ?? 0;
    const effectiveRating = calculateEffectiveRating(rating, fatigue);

    const primaryPos = getPlayerPosition(player);
    const secondaryPos = getPlayerSecondaryPosition(player);

    if (primaryPos === position || secondaryPos === position) {
      candidates.push({
        id: playerId,
        rating,
        effectiveRating,
        fatigue,
        isPrimary: primaryPos === position,
        shouldRest: fatigue >= FATIGUE_REST_THRESHOLD,
      });
    }
  }

  if (candidates.length === 0) {
    // No position match, just get best available player
    for (const player of roster) {
      const playerId = player.id ?? null;
      if (!playerId) continue;
      if (currentStarters.includes(playerId)) continue;
      if (isPlayerInjured(player)) continue;

      const rating = getPlayerRating(player);
      const fatigue = player.fatigue ?? 0;
      const effectiveRating = calculateEffectiveRating(rating, fatigue);

      candidates.push({
        id: playerId,
        rating,
        effectiveRating,
        fatigue,
        isPrimary: false,
        shouldRest: fatigue >= FATIGUE_REST_THRESHOLD,
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Sort by: not needing rest first, then primary position, then by effective rating
  candidates.sort((a, b) => {
    // Prefer players who don't need rest
    if (a.shouldRest !== b.shouldRest) {
      return (a.shouldRest ? 1 : 0) - (b.shouldRest ? 1 : 0);
    }
    // Then prefer primary position
    if (a.isPrimary !== b.isPrimary) {
      return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0);
    }
    // Then by effective rating
    return b.effectiveRating - a.effectiveRating;
  });

  return candidates[0].id;
}

// =============================================================================
// HANDLE INJURED STARTER
// =============================================================================

/**
 * Handle an injured starter by finding a replacement.
 * Returns updated lineup settings or null if no change needed.
 * @param {object} params
 * @param {Array} params.starters - Current starter IDs (5 elements)
 * @param {string} params.injuredPlayerId
 * @param {Array} params.roster - Full team roster
 * @returns {{ starters: Array, changed: boolean }}
 */
export function handleInjuredStarter({ starters, injuredPlayerId, roster }) {
  if (!starters || starters.length === 0) {
    // No lineup settings, initialize from scratch
    const newStarters = selectBestLineup(roster);
    return { starters: newStarters, changed: true };
  }

  const starterIndex = starters.indexOf(injuredPlayerId);
  if (starterIndex === -1) {
    return { starters, changed: false }; // Not a starter, no swap needed
  }

  const positionNeeded = POSITIONS[starterIndex];
  const replacement = findReplacement(roster, starters, positionNeeded);

  if (replacement) {
    const newStarters = [...starters];
    newStarters[starterIndex] = replacement;
    return { starters: newStarters, changed: true };
  }

  return { starters, changed: false };
}

// =============================================================================
// INITIALIZE TEAM LINEUP
// =============================================================================

/**
 * Initialize lineup for a single AI team.
 * @param {Array} roster - Team's roster
 * @returns {{ starters: Array, subStrategy: string }}
 */
export function initializeTeamLineup(roster) {
  if (!roster || roster.length === 0) {
    return { starters: [null, null, null, null, null], subStrategy: 'staggered' };
  }

  // Sort by overall rating (highest first)
  const sorted = [...roster].sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  // Select best lineup by position
  const starters = selectBestLineup(sorted);

  // Auto-select substitution strategy
  const subStrategy = selectSubstitutionStrategy(sorted, starters);

  return { starters, subStrategy };
}

// =============================================================================
// INITIALIZE ALL TEAM LINEUPS
// =============================================================================

/**
 * Initialize lineups for all AI teams.
 * @param {object} params
 * @param {Array} params.aiTeams - AI team objects
 * @param {function} params.getTeamRosterFn - (teamAbbr) => roster array
 * @returns {object} Map of teamId => { starters, subStrategy }
 */
export function initializeAllTeamLineups({ aiTeams, getTeamRosterFn }) {
  const results = {};

  for (const team of aiTeams) {
    const roster = getTeamRosterFn(team.abbreviation);
    results[team.id ?? team.abbreviation] = initializeTeamLineup(roster);
  }

  return results;
}

// =============================================================================
// REFRESH TEAM LINEUP
// =============================================================================

/**
 * Refresh a single AI team's lineup based on current fatigue levels.
 * Returns updated lineup or null if no changes.
 * @param {object} params
 * @param {Array} params.currentStarters - Current starter IDs (5 elements)
 * @param {Array} params.roster - Full team roster
 * @param {string} [params.subStrategy] - Substitution strategy
 * @returns {{ starters: Array, changed: boolean }}
 */
export function refreshTeamLineup({ currentStarters, roster, subStrategy = 'staggered' }) {
  if (!currentStarters || currentStarters.length === 0) {
    const initialized = initializeTeamLineup(roster);
    return { starters: initialized.starters, changed: true };
  }

  if (!roster || roster.length === 0) {
    return { starters: currentStarters, changed: false };
  }

  // Build player lookup map
  const playerMap = {};
  for (const player of roster) {
    const playerId = player.id ?? null;
    if (playerId) {
      playerMap[playerId] = player;
    }
  }

  const newStarters = [...currentStarters];
  let changed = false;

  // Check each starter position
  for (let index = 0; index < POSITIONS.length; index++) {
    const pos = POSITIONS[index];
    const starterId = currentStarters[index];
    if (!starterId) continue;

    const starter = playerMap[starterId];
    if (!starter) continue;

    const starterFatigue = starter.fatigue ?? 0;
    const starterInjured = isPlayerInjured(starter);

    // Check if starter should be rested or is injured
    if (starterInjured || starterFatigue >= FATIGUE_REST_THRESHOLD) {
      const replacement = findReplacement(roster, newStarters, pos);

      if (replacement && replacement !== starterId) {
        const replacementPlayer = playerMap[replacement];
        if (replacementPlayer) {
          const replacementFatigue = replacementPlayer.fatigue ?? 0;

          // Only swap if replacement is significantly fresher
          if (replacementFatigue < starterFatigue - 20 || starterInjured) {
            newStarters[index] = replacement;
            changed = true;
          }
        }
      }
    }
  }

  return { starters: newStarters, changed };
}

// =============================================================================
// REFRESH ALL TEAM LINEUPS
// =============================================================================

/**
 * Refresh all AI team lineups before a game day.
 * @param {object} params
 * @param {Array} params.aiTeams - AI team objects
 * @param {function} params.getTeamRosterFn - (teamAbbr) => roster array
 * @param {function} params.getTeamStartersFn - (teamId) => current starter IDs or null
 * @param {function} params.getSubStrategyFn - (teamId) => sub strategy string
 * @returns {object} Map of teamId => { starters, changed }
 */
export function refreshAllTeamLineups({
  aiTeams,
  getTeamRosterFn,
  getTeamStartersFn,
  getSubStrategyFn = () => 'staggered',
}) {
  const results = {};

  for (const team of aiTeams) {
    const teamId = team.id ?? team.abbreviation;
    const roster = getTeamRosterFn(team.abbreviation);
    const currentStarters = getTeamStartersFn(teamId);
    const subStrategy = getSubStrategyFn(teamId);

    results[teamId] = refreshTeamLineup({
      currentStarters,
      roster,
      subStrategy,
    });
  }

  return results;
}

// =============================================================================
// INITIALIZE USER TEAM LINEUP
// =============================================================================

/**
 * Initialize lineup for the user's team.
 * @param {Array} roster - User's team roster
 * @returns {Array} Array of 5 starter IDs in position order
 */
export function initializeUserTeamLineup(roster) {
  if (!roster || roster.length === 0) {
    return [];
  }

  // Sort by overall rating (highest first)
  const sorted = [...roster].sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  return selectBestLineup(sorted);
}
