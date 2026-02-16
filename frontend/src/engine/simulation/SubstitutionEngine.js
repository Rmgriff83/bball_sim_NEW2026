/**
 * SubstitutionEngine
 *
 * Manages AI player rotations, fatigue-based substitutions, and minute targets.
 * Translated from backend SubstitutionService.php -- all game logic and math
 * preserved exactly.
 *
 * Player objects expected shape:
 *   { id, position, secondary_position, overall_rating (or overallRating),
 *     is_injured (or isInjured) }
 *
 * BoxScore expected shape:
 *   { [playerId]: { minutes: Number, ... } }
 */

const CHECK_INTERVAL_MINUTES = 2.0;
const VARIANCE_RANGE = 0.15;
const CLOSE_GAME_THRESHOLD = 6;
const TOTAL_GAME_MINUTES = 40.0;

const STRATEGIES = {
  staggered: {
    name: 'Staggered',
    description:
      'Stars rest in shifts. At least one playmaker always on floor. Max 2 subs at a time.',
    type: 'balanced',
    rotation_depth: '8-9 players',
    strengths: ['Continuity', 'Matchup Flexibility'],
    weaknesses: ['Star Fatigue Risk'],
    pace_threshold: 1.5,
    max_subs_per_check: 2,
  },
  platoon: {
    name: 'Platoon',
    description:
      'Swap groups of 2-3 players at defined intervals. Unit chemistry over individual matchups.',
    type: 'balanced',
    rotation_depth: '8-10 players',
    strengths: ['Unit Chemistry', 'Predictable Rhythm'],
    weaknesses: ['Transition Gaps'],
    pace_threshold: 2.0,
    max_subs_per_check: 3,
  },
  tight_rotation: {
    name: 'Tight Rotation',
    description:
      'Lean heavily on top 7 players. Stars play big minutes. Bench only for short rest.',
    type: 'aggressive',
    rotation_depth: '7-8 players',
    strengths: ['Star Maximization', 'Closing Lineup'],
    weaknesses: ['Fatigue Risk', 'Thin Depth'],
    pace_threshold: 2.5,
    max_subs_per_check: 2,
  },
  deep_bench: {
    name: 'Deep Bench',
    description:
      'Spread minutes across 9-10 players. Everyone contributes. Fresh legs all game.',
    type: 'passive',
    rotation_depth: '9-10 players',
    strengths: ['Fresh Legs', 'Injury Insurance'],
    weaknesses: ['Fewer Star Minutes', 'Less Continuity'],
    pace_threshold: 1.0,
    max_subs_per_check: 3,
  },
};

// ============================================================
// Helpers
// ============================================================

function getPlayerRating(player) {
  return player.overall_rating ?? player.overallRating ?? 70;
}

function isPlayerInjured(player) {
  return !!(player.is_injured ?? player.isInjured ?? false);
}

/**
 * Calculate total game minutes elapsed.
 * Uses 10-minute quarters.
 */
function calculateGameElapsed(currentQuarter, timeRemaining) {
  const quarterLength = 10.0;
  const completedQuarters = currentQuarter - 1;
  const elapsedInCurrent = quarterLength - timeRemaining;
  return completedQuarters * quarterLength + elapsedInCurrent;
}

/**
 * For staggered strategy: never sub out both primary ball-handlers at once.
 * sitCandidates must already be sorted by paceDelta descending.
 */
function applyStaggeredConstraint(sitCandidates, currentLineup) {
  // Find ball handlers in current lineup (PG + SG)
  const ballHandlerIds = [];
  for (const player of currentLineup) {
    const pos = player.position ?? '';
    if (pos === 'PG' || pos === 'SG') {
      ballHandlerIds.push(player.id);
    }
  }

  // Count how many ball handlers are in sit candidates
  const bhInSitList = sitCandidates.filter((c) =>
    ballHandlerIds.includes(c.id)
  );

  if (bhInSitList.length > 1) {
    // Keep only the first ball handler (most ahead of pace), remove the rest
    let removedFirst = false;
    sitCandidates = sitCandidates.filter((c) => {
      if (ballHandlerIds.includes(c.id)) {
        if (!removedFirst) {
          removedFirst = true;
          return true; // keep the first (most ahead of pace)
        }
        return false; // remove subsequent
      }
      return true;
    });
  }

  return sitCandidates;
}

/**
 * Find the best bench replacement for a player being subbed out.
 * Returns a player object or null.
 */
function findBenchReplacement(
  benchPlayers,
  sitCandidate,
  boxScore,
  targetMinutes,
  gameElapsed,
  currentLineupIds
) {
  const position = sitCandidate.position;
  const secondaryPosition = sitCandidate.secondary_position;

  const candidates = [];

  for (const player of benchPlayers) {
    // Skip if already in lineup
    if (currentLineupIds.includes(player.id)) {
      continue;
    }

    // Must be able to play the position
    const playerPos = player.position ?? '';
    const playerSecondary = player.secondary_position ?? null;
    const canPlay =
      playerPos === position ||
      playerSecondary === position ||
      playerPos === secondaryPosition ||
      playerSecondary === secondaryPosition;

    if (!canPlay) {
      continue;
    }

    // Must have minutes remaining in budget
    const actualMinutes = boxScore[player.id]?.minutes ?? 0;
    const target = targetMinutes[player.id] ?? 0;
    const remaining = target - actualMinutes;

    if (remaining <= 0) {
      continue;
    }

    candidates.push({
      player,
      id: player.id,
      rating: getPlayerRating(player),
      minutesRemaining: remaining,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Prefer highest-rated
  candidates.sort((a, b) => b.rating - a.rating);

  return candidates[0].player;
}

/**
 * Get minute distribution template per strategy.
 * Index 0 = best player, index 1 = 2nd best, etc.
 */
function getDistributionTemplate(strategy) {
  const templates = {
    staggered: [34, 32, 30, 28, 26, 18, 14, 10, 8, 0, 0, 0, 0, 0, 0],
    tight_rotation: [36, 34, 32, 30, 28, 16, 12, 8, 4, 0, 0, 0, 0, 0, 0],
    deep_bench: [30, 28, 26, 24, 22, 18, 16, 14, 12, 10, 0, 0, 0, 0, 0],
    platoon: [32, 30, 28, 26, 24, 18, 16, 12, 8, 6, 0, 0, 0, 0, 0],
  };

  return (
    templates[strategy] ||
    templates.staggered // default fallback
  );
}

// ============================================================
// Public API
// ============================================================

/**
 * Entry point called by GameSimulator's rotation logic.
 * Returns a new array of lineup player IDs, or null if no substitution needed.
 *
 * @param {Array}  currentLineup   - Array of player objects currently on court (length 5)
 * @param {Array}  fullRoster      - Full roster of player objects (starters + bench)
 * @param {Object} boxScore        - { [playerId]: { minutes, ... } }
 * @param {Object} targetMinutes   - { [playerId]: targetMinutesNumber }
 * @param {string} strategy        - One of: 'staggered', 'platoon', 'tight_rotation', 'deep_bench'
 * @param {number} currentQuarter  - 1-4
 * @param {number} timeRemaining   - Minutes remaining in current quarter (0-10)
 * @param {number} scoreDiff       - Team score minus opponent score
 * @param {boolean} isUserTeamLive - Whether this is the user's team during a live game
 * @returns {Array|null} New lineup IDs or null
 */
export function evaluateSubstitutions(
  currentLineup,
  fullRoster,
  boxScore,
  targetMinutes,
  strategy,
  currentQuarter,
  timeRemaining,
  scoreDiff,
  isUserTeamLive
) {
  // User controls subs during live games
  if (isUserTeamLive) {
    return null;
  }

  const strategyData = STRATEGIES[strategy] ?? STRATEGIES.staggered;

  // Calculate game minutes elapsed
  const gameElapsed = calculateGameElapsed(currentQuarter, timeRemaining);

  // Q4 close game override - force best 5 back in
  const closeGameLineup = applyCloseGameOverride(
    fullRoster,
    currentQuarter,
    timeRemaining,
    scoreDiff
  );
  if (closeGameLineup !== null) {
    return closeGameLineup;
  }

  // Get current lineup IDs
  const currentLineupIds = currentLineup.map((p) => p.id);

  // Build player map for quick lookup
  const playerMap = {};
  for (const player of fullRoster) {
    playerMap[player.id] = player;
  }

  // Calculate target percentage for each player
  const targetPcts = {};
  for (const [playerId, mins] of Object.entries(targetMinutes)) {
    targetPcts[playerId] = mins / TOTAL_GAME_MINUTES;
  }

  // Find players ahead of pace (candidates to sit)
  let sitCandidates = [];
  for (const playerId of currentLineupIds) {
    const actualMinutes = boxScore[playerId]?.minutes ?? 0;
    const targetPct = targetPcts[playerId] ?? 0.5;
    const expectedMinutes = gameElapsed * targetPct;
    const paceDelta = actualMinutes - expectedMinutes;

    if (paceDelta >= strategyData.pace_threshold) {
      sitCandidates.push({
        id: playerId,
        paceDelta,
        position: playerMap[playerId]?.position ?? 'SF',
        secondary_position: playerMap[playerId]?.secondary_position ?? null,
      });
    }
  }

  if (sitCandidates.length === 0) {
    return null;
  }

  // Sort by most ahead of pace first
  sitCandidates.sort((a, b) => b.paceDelta - a.paceDelta);

  // Staggered extra rule: never sub out both primary ball-handlers simultaneously
  if (strategy === 'staggered') {
    sitCandidates = applyStaggeredConstraint(sitCandidates, currentLineup);
  }

  // Limit subs per check
  const maxSubs = strategyData.max_subs_per_check;
  sitCandidates = sitCandidates.slice(0, maxSubs);

  // Build bench (players not in current lineup, not injured)
  let benchPlayers = [];
  for (const player of fullRoster) {
    if (!currentLineupIds.includes(player.id)) {
      if (!isPlayerInjured(player)) {
        benchPlayers.push(player);
      }
    }
  }

  // Find replacements for each sit candidate
  const newLineupIds = [...currentLineupIds];
  let subsApplied = 0;

  for (const candidate of sitCandidates) {
    const replacement = findBenchReplacement(
      benchPlayers,
      candidate,
      boxScore,
      targetMinutes,
      gameElapsed,
      newLineupIds
    );

    if (replacement) {
      // Swap in the lineup
      const lineupIndex = newLineupIds.indexOf(candidate.id);
      if (lineupIndex !== -1) {
        newLineupIds[lineupIndex] = replacement.id;
        // Remove replacement from bench candidates
        benchPlayers = benchPlayers.filter((p) => p.id !== replacement.id);
        subsApplied++;
      }
    }
  }

  if (subsApplied === 0) {
    return null;
  }

  return newLineupIds;
}

/**
 * If Q4, timeRemaining <= 5.0, scoreDiff <= CLOSE_GAME_THRESHOLD:
 * Force best 5 players (by overall_rating) back into lineup.
 *
 * @param {Array}  fullRoster     - Full roster of player objects
 * @param {number} currentQuarter - 1-4
 * @param {number} timeRemaining  - Minutes remaining in current quarter
 * @param {number} scoreDiff      - Team score minus opponent score
 * @returns {Array|null} Array of 5 player IDs or null
 */
export function applyCloseGameOverride(
  fullRoster,
  currentQuarter,
  timeRemaining,
  scoreDiff
) {
  if (
    currentQuarter < 4 ||
    timeRemaining > 5.0 ||
    Math.abs(scoreDiff) > CLOSE_GAME_THRESHOLD
  ) {
    return null;
  }

  // Get healthy players sorted by rating descending
  const healthy = fullRoster
    .filter((p) => !isPlayerInjured(p))
    .sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  // Take best 5
  const best5 = healthy.slice(0, 5);

  if (best5.length < 5) {
    return null;
  }

  return best5.map((p) => p.id);
}

/**
 * Auto-calculate target minutes for AI teams based on strategy.
 * Players are ranked by overall rating; starters get quality bonuses.
 *
 * @param {Array}  roster     - Full roster of player objects
 * @param {Array}  starterIds - Array of 5 starter player IDs
 * @param {string} strategy   - Substitution strategy key
 * @returns {Object} { [playerId]: targetMinutes }
 */
export function generateAITargetMinutes(roster, starterIds, strategy) {
  // Sort roster by overall rating descending
  const sorted = [...roster].sort(
    (a, b) => getPlayerRating(b) - getPlayerRating(a)
  );

  const templates = getDistributionTemplate(strategy);
  const targetMinutes = {};

  // Assign minutes by rank
  for (let index = 0; index < sorted.length; index++) {
    const player = sorted[index];
    const playerId = player.id ?? null;
    if (!playerId) continue;

    const isStarter = starterIds.includes(playerId);
    let minuteSlot = templates[index] ?? 0;

    // Quality adjustment
    const rating = getPlayerRating(player);
    if (rating >= 90 && isStarter) {
      minuteSlot += 2;
    } else if (rating >= 80 && isStarter) {
      minuteSlot += 1;
    }

    targetMinutes[playerId] = Math.max(0, Math.min(40, minuteSlot));
  }

  // Normalize to exactly 200 total (5 players × 40 minute game)
  const total = Object.values(targetMinutes).reduce((sum, m) => sum + m, 0);
  if (total > 0 && total !== 200) {
    const factor = 200 / total;
    for (const id of Object.keys(targetMinutes)) {
      targetMinutes[id] = Math.max(
        0,
        Math.min(40, Math.round(targetMinutes[id] * factor))
      );
    }
    // Fix rounding residual — adjust the highest-minutes player
    const rounded = Object.values(targetMinutes).reduce((s, m) => s + m, 0);
    if (rounded !== 200) {
      const topId = Object.keys(targetMinutes).reduce((a, b) =>
        targetMinutes[a] >= targetMinutes[b] ? a : b
      );
      targetMinutes[topId] = Math.max(0, Math.min(40, targetMinutes[topId] + (200 - rounded)));
    }
  }

  return targetMinutes;
}

/**
 * Apply +/-15% random variance to each player's target minutes.
 * Called once at game initialization.
 *
 * @param {Object} targetMinutes - { [playerId]: minutesNumber }
 * @returns {Object} Varied target minutes
 */
export function applyVariance(targetMinutes) {
  const varied = {};

  for (const [playerId, mins] of Object.entries(targetMinutes)) {
    if (mins <= 0) {
      varied[playerId] = 0;
      continue;
    }

    // Random between -1.0 and 1.0, scaled by VARIANCE_RANGE (0.15)
    const randomFactor = (Math.random() * 2 - 1) * VARIANCE_RANGE;
    const variance = 1.0 + randomFactor;
    let newMins = mins * variance;

    // Clamp: starters (>= 20 min target) min 8, bench min 0, max 40
    if (mins >= 20) {
      newMins = Math.max(8, Math.min(40, newMins));
    } else {
      newMins = Math.max(0, Math.min(40, newMins));
    }

    varied[playerId] = Math.round(newMins);
  }

  return varied;
}

/**
 * Returns default target minutes based on rating tiers.
 * Starters split 160 minutes, bench gets 16/12/8/4 by rating rank.
 *
 * @param {Array} roster     - Full roster of player objects
 * @param {Array} starterIds - Array of starter player IDs
 * @returns {Object} { [playerId]: targetMinutes }
 */
export function getDefaultTargetMinutes(roster, starterIds) {
  const targetMinutes = {};
  const bench = [];

  // Identify healthy starters and bench
  let healthyStarterCount = 0;
  for (const player of roster) {
    const playerId = player.id ?? null;
    if (!playerId) continue;

    const injured = isPlayerInjured(player);

    if (starterIds.includes(playerId)) {
      if (injured) {
        targetMinutes[playerId] = 0;
      } else {
        healthyStarterCount++;
        targetMinutes[playerId] = null; // placeholder, set below
      }
    } else {
      bench.push(player);
    }
  }

  // Healthy starters split 160 minutes evenly
  const starterMins =
    healthyStarterCount > 0
      ? Math.min(Math.floor(160 / healthyStarterCount), 40)
      : 0;
  let starterTotal = 0;
  for (const id of Object.keys(targetMinutes)) {
    if (targetMinutes[id] === null) {
      targetMinutes[id] = starterMins;
      starterTotal += starterMins;
    }
  }

  // Sort bench by rating descending
  bench.sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  // Top healthy bench players get remaining minutes: 16, 12, 8, 4
  const benchDistribution = [16, 12, 8, 4];
  let benchBudget = 200 - starterTotal;
  let benchSlot = 0;

  for (const player of bench) {
    const playerId = player.id ?? null;
    if (!playerId) continue;

    const injured = isPlayerInjured(player);

    if (injured || benchSlot >= benchDistribution.length || benchBudget <= 0) {
      targetMinutes[playerId] = 0;
    } else {
      const mins = Math.min(benchDistribution[benchSlot], benchBudget);
      targetMinutes[playerId] = mins;
      benchBudget -= mins;
      benchSlot++;
    }
  }

  return targetMinutes;
}

/**
 * Get strategy display info for UI (without internal thresholds).
 *
 * @returns {Object} { [strategyId]: { name, description, type, rotation_depth, strengths, weaknesses } }
 */
export function getStrategyDisplayInfo() {
  const result = {};
  for (const [id, strategy] of Object.entries(STRATEGIES)) {
    result[id] = {
      name: strategy.name,
      description: strategy.description,
      type: strategy.type,
      rotation_depth: strategy.rotation_depth,
      strengths: [...strategy.strengths],
      weaknesses: [...strategy.weaknesses],
    };
  }
  return result;
}

// ============================================================
// Exported constants for external use
// ============================================================

export {
  CHECK_INTERVAL_MINUTES,
  VARIANCE_RANGE,
  CLOSE_GAME_THRESHOLD,
  TOTAL_GAME_MINUTES,
  STRATEGIES,
};
