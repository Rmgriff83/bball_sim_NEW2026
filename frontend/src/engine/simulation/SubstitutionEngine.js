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
const TOTAL_GAME_MINUTES = 48.0;

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
  load_management: {
    name: 'Load Management',
    description:
      'Aggressively bench any player at 75%+ fatigue so they fully rest and recover. Stars protected from burnout but the team plays short-handed when key guys are tired.',
    type: 'passive',
    rotation_depth: '9-12 players',
    strengths: ['Star Health', 'Long-term Conditioning'],
    weaknesses: ['Short-handed Stretches', 'Bench-heavy Lineups'],
    pace_threshold: 1.0,
    max_subs_per_check: 3,
    // User-only strategy. selectSubstitutionStrategy (AILineupService) never
    // returns this — AI teams can't get stuck in a "sit stars, never put them
    // back" loop because they never pick it in the first place.
    user_only: true,
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
 * Uses 12-minute quarters.
 */
function calculateGameElapsed(currentQuarter, timeRemaining) {
  const quarterLength = 12.0;
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

    // Effective rating subtracts a fatigue penalty (0.15 per fatigue point)
    // so a fresh 75-rated backup beats a tired 78-rated bench player. At
    // fatigue 80, the penalty is -12 effective rating — enough to swing
    // the ranking against a meaningfully gassed alternative.
    const fatiguePenalty = (player.fatigue ?? 0) * 0.15;
    const effectiveRating = getPlayerRating(player) - fatiguePenalty;

    candidates.push({
      player,
      id: player.id,
      rating: effectiveRating,
      minutesRemaining: remaining,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Prefer highest-rated (now fatigue-adjusted)
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
    // Pulled the top of the rotation down (was [36, 34, 32, 30, 28, 16,
    // 12, 8, 4, 0, ...]) — combined with the +2 quality bonus for 90+
    // starters and the normalize-to-240 step, the previous template
    // produced a 45-minute top starter (93.75% of game). Now lands ~41
    // min and the 6th-9th men get a few more minutes each, which still
    // reads as "tight" relative to staggered / deep_bench while staying
    // within real-NBA top-end-load territory.
    tight_rotation: [32, 30, 28, 26, 24, 18, 14, 10, 6, 0, 0, 0, 0, 0, 0],
    deep_bench: [30, 28, 26, 24, 22, 18, 16, 14, 12, 10, 0, 0, 0, 0, 0],
    platoon: [32, 30, 28, 26, 24, 18, 16, 12, 8, 6, 0, 0, 0, 0, 0],
    // load_management: identical baseline to deep_bench. Actual minutes are
    // dominated by the fatigue-gate in evaluateSubstitutions (any player at
    // ≥75 fatigue gets 0 minutes regardless of template), so this template
    // just shapes the rotation when nobody is gassed yet.
    load_management: [30, 28, 26, 24, 22, 18, 16, 14, 12, 10, 0, 0, 0, 0, 0],
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

  // Q4 close game override - force best available back in (respects minute targets)
  const closeGameLineup = applyCloseGameOverride(
    fullRoster,
    currentQuarter,
    timeRemaining,
    scoreDiff,
    targetMinutes,
    boxScore
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

  // Load Management's load-management threshold. Players at this fatigue
  // level or higher get fully benched until they recover. Both gates the
  // benchPlayers list (can't be subbed in while gassed) and triggers
  // immediate sit on any on-floor player at ≥ threshold.
  const LOAD_MANAGEMENT_FATIGUE_THRESHOLD = 75;
  const isLoadManagement = strategy === 'load_management';

  // Build bench (players not in current lineup, not injured)
  let benchPlayers = [];
  for (const player of fullRoster) {
    if (!currentLineupIds.includes(player.id)) {
      if (!isPlayerInjured(player)) {
        // Load management: never sub in a player whose fatigue is at or above
        // the threshold. Let them sit and recover.
        if (isLoadManagement && (player.fatigue ?? 0) >= LOAD_MANAGEMENT_FATIGUE_THRESHOLD) {
          continue;
        }
        benchPlayers.push(player);
      }
    }
  }

  // --- Pass 1: Find players ahead of pace (candidates to sit) ---
  // The pace threshold is scaled by per-player fatigue so a gassed star
  // gets flagged for sub at a tighter delta than a fresh starter would.
  // Range: fatigue 0 → 1.0× threshold (legacy behavior); fatigue 100 →
  // 0.5× threshold. Linear interpolation in between. Without this, a
  // 90-fatigue star and a fresh backup were weighted identically when
  // deciding who to keep on the floor.
  let sitCandidates = [];
  for (const playerId of currentLineupIds) {
    const actualMinutes = boxScore[playerId]?.minutes ?? 0;
    const targetPct = targetPcts[playerId] ?? 0.5;
    const expectedMinutes = gameElapsed * targetPct;
    const paceDelta = actualMinutes - expectedMinutes;

    const fatigue = playerMap[playerId]?.fatigue ?? 0;

    // Load management: any on-floor player at or above the fatigue
    // threshold gets force-sat regardless of pace. Push with a huge
    // synthetic paceDelta so they sort to the front of the sit list and
    // get pulled first when subs are limited per check.
    if (isLoadManagement && fatigue >= LOAD_MANAGEMENT_FATIGUE_THRESHOLD) {
      sitCandidates.push({
        id: playerId,
        paceDelta: 999,
        position: playerMap[playerId]?.position ?? 'SF',
        secondary_position: playerMap[playerId]?.secondary_position ?? null,
      });
      continue;
    }

    const fatigueFactor = Math.max(0.5, 1.0 - fatigue / 200);
    const effectiveThreshold = strategyData.pace_threshold * fatigueFactor;

    if (paceDelta >= effectiveThreshold) {
      sitCandidates.push({
        id: playerId,
        paceDelta,
        position: playerMap[playerId]?.position ?? 'SF',
        secondary_position: playerMap[playerId]?.secondary_position ?? null,
      });
    }
  }

  // --- Pass 2: Find bench players falling behind pace and force them in ---
  // This ensures players with assigned minutes don't get stranded on the bench
  const BEHIND_PACE_THRESHOLD = 2.0; // minutes behind expected pace to trigger sub-in
  let behindPaceCandidates = [];
  for (const player of benchPlayers) {
    const target = targetMinutes[player.id] ?? 0;
    if (target <= 0) continue;

    const actualMinutes = boxScore[player.id]?.minutes ?? 0;
    const targetPct = target / TOTAL_GAME_MINUTES;
    const expectedMinutes = gameElapsed * targetPct;
    const deficit = expectedMinutes - actualMinutes;

    if (deficit >= BEHIND_PACE_THRESHOLD) {
      behindPaceCandidates.push({
        player,
        id: player.id,
        deficit,
        position: player.position ?? 'SF',
        secondary_position: player.secondary_position ?? null,
      });
    }
  }

  // Sort by most behind pace first
  behindPaceCandidates.sort((a, b) => b.deficit - a.deficit);

  // For each behind-pace bench player, find the best on-court player to swap out
  // (most ahead of pace at a compatible position) even if they haven't hit pace_threshold
  for (const benchCandidate of behindPaceCandidates) {
    // Check if there's already a sit candidate at a compatible position
    const alreadyCovered = sitCandidates.some((c) => {
      const posMatch =
        c.position === benchCandidate.position ||
        c.position === benchCandidate.secondary_position ||
        c.secondary_position === benchCandidate.position;
      return posMatch;
    });

    if (alreadyCovered) continue;

    // Find the on-court player at a compatible position who is most ahead of pace
    let bestSwapOut = null;
    let bestPaceDelta = -Infinity;

    for (const playerId of currentLineupIds) {
      // Skip if already a sit candidate
      if (sitCandidates.some((c) => c.id === playerId)) continue;

      const onCourtPlayer = playerMap[playerId];
      if (!onCourtPlayer) continue;

      // Check position compatibility
      const onCourtPos = onCourtPlayer.position ?? 'SF';
      const onCourtSecondary = onCourtPlayer.secondary_position ?? null;
      const canSwap =
        onCourtPos === benchCandidate.position ||
        onCourtPos === benchCandidate.secondary_position ||
        onCourtSecondary === benchCandidate.position ||
        benchCandidate.position === onCourtPos ||
        benchCandidate.secondary_position === onCourtPos;

      if (!canSwap) continue;

      const actualMinutes = boxScore[playerId]?.minutes ?? 0;
      const targetPct = targetPcts[playerId] ?? 0.5;
      const expectedMinutes = gameElapsed * targetPct;
      const paceDelta = actualMinutes - expectedMinutes;

      // Only swap out players who are at least on pace (not behind themselves)
      if (paceDelta > 0 && paceDelta > bestPaceDelta) {
        bestPaceDelta = paceDelta;
        bestSwapOut = {
          id: playerId,
          paceDelta,
          position: onCourtPos,
          secondary_position: onCourtSecondary,
        };
      }
    }

    if (bestSwapOut) {
      sitCandidates.push(bestSwapOut);
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
 * Force best available players (by overall_rating) back into lineup.
 * Respects target minutes — players who have already exceeded their
 * target are not forced back in.
 *
 * @param {Array}  fullRoster     - Full roster of player objects
 * @param {number} currentQuarter - 1-4
 * @param {number} timeRemaining  - Minutes remaining in current quarter
 * @param {number} scoreDiff      - Team score minus opponent score
 * @param {Object} targetMinutes  - { [playerId]: targetMinutesNumber }
 * @param {Object} boxScore       - { [playerId]: { minutes, ... } }
 * @returns {Array|null} Array of 5 player IDs or null
 */
export function applyCloseGameOverride(
  fullRoster,
  currentQuarter,
  timeRemaining,
  scoreDiff,
  targetMinutes,
  boxScore
) {
  if (
    currentQuarter < 4 ||
    timeRemaining > 5.0 ||
    Math.abs(scoreDiff) > CLOSE_GAME_THRESHOLD
  ) {
    return null;
  }

  // Get healthy players sorted by rating descending
  // Filter out players who have exceeded their target minutes
  const healthy = fullRoster
    .filter((p) => {
      if (isPlayerInjured(p)) return false;
      if (targetMinutes && boxScore) {
        const target = targetMinutes[p.id];
        const actual = boxScore[p.id]?.minutes ?? 0;
        // If player has a target set and has exceeded it, don't force them in
        if (target != null && target > 0 && actual >= target) return false;
      }
      return true;
    })
    .sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  // Fatigue gate — a gassed star is worse on the floor than a fresh backup.
  // Skip anyone whose fatigue is past the threshold so the closeout lineup
  // isn't a tired hero-ball stack. If too few eligible remain to fill 5
  // (deep injury report, etc.), fall back to the legacy "best 5 healthy"
  // selection rather than returning null and stranding the team.
  const FATIGUE_CLOSEOUT_THRESHOLD = 80;
  const fresh = healthy.filter((p) => (p.fatigue ?? 0) < FATIGUE_CLOSEOUT_THRESHOLD);
  const eligible = fresh.length >= 5 ? fresh : healthy;

  const best5 = eligible.slice(0, 5);

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

    targetMinutes[playerId] = Math.max(0, Math.min(48, minuteSlot));
  }

  // Normalize to exactly 240 total (5 players × 48 minute game)
  const total = Object.values(targetMinutes).reduce((sum, m) => sum + m, 0);
  if (total > 0 && total !== 240) {
    const factor = 240 / total;
    for (const id of Object.keys(targetMinutes)) {
      targetMinutes[id] = Math.max(
        0,
        Math.min(48, Math.round(targetMinutes[id] * factor))
      );
    }
    // Fix rounding residual — adjust the highest-minutes player
    const rounded = Object.values(targetMinutes).reduce((s, m) => s + m, 0);
    if (rounded !== 240) {
      const topId = Object.keys(targetMinutes).reduce((a, b) =>
        targetMinutes[a] >= targetMinutes[b] ? a : b
      );
      targetMinutes[topId] = Math.max(0, Math.min(48, targetMinutes[topId] + (240 - rounded)));
    }
  }

  return targetMinutes;
}

/**
 * Role-aware target minutes generator for the USER team's "CPU auto-set"
 * buttons. Differs from generateAITargetMinutes (which assigns by pure
 * rating rank): here, the user's explicitly chosen starters always claim
 * the top 5 template slots — even if a bench player outrates them.
 *
 * Honors the team's substitution strategy (deep_bench gives starters
 * ~26-36 mins, tight_rotation gives ~34-43 mins, etc.) and normalizes
 * to exactly 240 player-minutes per game.
 *
 * @param {Array}  roster     - Full roster of player objects
 * @param {Array}  starterIds - Array of 5 starter player IDs (user-chosen)
 * @param {string} strategy   - 'staggered' | 'platoon' | 'tight_rotation' | 'deep_bench'
 * @returns {Object} { [playerId]: targetMinutesNumber }
 */
export function generateRoleAwareTargetMinutes(roster, starterIds, strategy) {
  const templates = getDistributionTemplate(strategy);
  const targetMinutes = {};
  const starterSet = new Set((starterIds || []).filter((id) => id != null));

  // Load Management: any healthy player whose fatigue is at or above the
  // 75% threshold gets zero pregame minutes regardless of starter/bench
  // status. The in-game SubstitutionEngine already force-sits these
  // players at the first sub-check, but without zeroing their target
  // minutes here, the CPU Adjust button would still assign a fatigued
  // bench player ~18-20 mpg (their template slot's share), giving the
  // user the impression load_management did nothing.
  const LOAD_MANAGEMENT_FATIGUE_THRESHOLD = 75;
  const isLoadManagement = strategy === 'load_management';
  const isFatigueSat = (p) =>
    isLoadManagement && (p?.fatigue ?? 0) >= LOAD_MANAGEMENT_FATIGUE_THRESHOLD;

  // Initialize every player to 0 (injured players stay at 0 since the
  // distribution loops below skip them).
  for (const p of roster) {
    if (p?.id) targetMinutes[p.id] = 0;
  }

  // Healthy starters, sorted by rating descending — highest-rated starter
  // gets template slot 0 (the largest starter share). Load Management
  // filters out gassed players here so the template assigns their slot
  // to the next-best available player instead of stranding it.
  const healthyStarters = roster
    .filter((p) => p?.id && starterSet.has(p.id) && !isPlayerInjured(p) && !isFatigueSat(p))
    .sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  // Healthy bench, sorted by rating descending — highest-rated bench
  // player gets template slot 5 (the 6th man's share). Same Load
  // Management fatigue gate as the starter loop above.
  const healthyBench = roster
    .filter((p) => p?.id && !starterSet.has(p.id) && !isPlayerInjured(p) && !isFatigueSat(p))
    .sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  // Top 5 template slots → starters, with quality bumps for stars.
  for (let i = 0; i < healthyStarters.length && i < 5; i++) {
    let mins = templates[i] ?? 0;
    const rating = getPlayerRating(healthyStarters[i]);
    if (rating >= 90) mins += 2;
    else if (rating >= 80) mins += 1;
    targetMinutes[healthyStarters[i].id] = Math.max(0, Math.min(48, mins));
  }

  // Remaining template slots → bench by rating rank.
  for (let i = 0; i < healthyBench.length; i++) {
    const mins = templates[5 + i] ?? 0;
    targetMinutes[healthyBench[i].id] = Math.max(0, Math.min(48, mins));
  }

  // Normalize to exactly 240 (5 × 48 player-minutes per game).
  const total = Object.values(targetMinutes).reduce((sum, m) => sum + m, 0);
  if (total > 0 && total !== 240) {
    const factor = 240 / total;
    for (const id of Object.keys(targetMinutes)) {
      targetMinutes[id] = Math.max(0, Math.min(48, Math.round(targetMinutes[id] * factor)));
    }
    // Fix rounding residual — adjust the highest-minutes player.
    const rounded = Object.values(targetMinutes).reduce((s, m) => s + m, 0);
    if (rounded !== 240) {
      const topId = Object.keys(targetMinutes).reduce((a, b) =>
        targetMinutes[a] >= targetMinutes[b] ? a : b
      );
      targetMinutes[topId] = Math.max(0, Math.min(48, targetMinutes[topId] + (240 - rounded)));
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

    // Clamp: starters (>= 20 min target) min 8, bench min 0, max 48
    if (mins >= 20) {
      newMins = Math.max(8, Math.min(48, newMins));
    } else {
      newMins = Math.max(0, Math.min(48, newMins));
    }

    varied[playerId] = Math.round(newMins);
  }

  return varied;
}

/**
 * Returns default target minutes based on rating tiers.
 * Starters split 192 minutes, bench gets 19/14/10/5 by rating rank.
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

  // Healthy starters split 192 minutes evenly. 192 / 5 = 38.4 — distribute
  // the remainder across the first N starters so the total lands at 192.
  const baseStarterMins =
    healthyStarterCount > 0 ? Math.floor(192 / healthyStarterCount) : 0;
  const starterRemainder = 192 - baseStarterMins * healthyStarterCount;
  let starterTotal = 0;
  let starterIdx = 0;
  for (const id of Object.keys(targetMinutes)) {
    if (targetMinutes[id] === null) {
      const extra = starterIdx < starterRemainder ? 1 : 0;
      targetMinutes[id] = Math.min(baseStarterMins + extra, 48);
      starterTotal += targetMinutes[id];
      starterIdx++;
    }
  }

  // Sort bench by rating descending
  bench.sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  // Top healthy bench players get remaining minutes: 19, 14, 10, 5
  const benchDistribution = [19, 14, 10, 5];
  let benchBudget = 240 - starterTotal;
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
