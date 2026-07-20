/**
 * SubstitutionEngine
 *
 * Manages AI player rotations, fatigue-based substitutions, and minute targets.
 * Translated from backend SubstitutionService.php -- all game logic and math
 * preserved exactly.
 *
 * Player objects expected shape:
 *   { id, position, secondary_position, tertiary_position (both optional),
 *     overall_rating (or overallRating), is_injured (or isInjured) }
 *
 * BoxScore expected shape:
 *   { [playerId]: { minutes: Number, ... } }
 */

// All positions a player (or sit/bench candidate projection) can play:
// primary + optional secondary/tertiary. Tolerates either casing and absent
// fields (legacy saves have no tertiary).
function playablePositions(p) {
  return [
    p?.position,
    p?.secondary_position ?? p?.secondaryPosition ?? null,
    p?.tertiary_position ?? p?.tertiaryPosition ?? null,
  ].filter(Boolean);
}

// Do two players/candidates share ANY playable position? Generalizes the old
// hand-enumerated primary/secondary cross-checks (and closes their missing
// secondary-vs-secondary combinations) while adding tertiary support.
function sharesPlayablePosition(a, b) {
  const bp = playablePositions(b);
  return playablePositions(a).some((pos) => bp.includes(pos));
}

const CHECK_INTERVAL_MINUTES = 2.0;
const VARIANCE_RANGE = 0.15;
const CLOSE_GAME_THRESHOLD = 6;
const TOTAL_GAME_MINUTES = 48.0;

// Strategy-specific per-starter MPG caps. Single source of truth for the
// AI minute-allocation ceiling. Real NBA distributions:
//   tight_rotation (Warriors '17, Celtics '24): top star 36-38 MPG
//   staggered (Heat-Spo): top star 34-36 MPG
//   platoon (Stevens-era Celtics): top star 32-34 MPG
//   deep_bench (Pacers '23): top star 30-32 MPG
//   load_management (Spurs/Kawhi): top star 28-30 MPG (user-only strategy)
// The cap is applied EVERYWHERE a per-player clamp is needed — no more
// scattered Math.min(48, ...) sites that bypass the cap.
export const AI_STARTER_MPG_CAPS = {
  tight_rotation:  34,
  staggered:       32,
  platoon:         31,
  deep_bench:      30,
  load_management: 28,
};

export function aiStarterCapFor(strategy) {
  return AI_STARTER_MPG_CAPS[strategy] ?? 38;
}

// FEATURE FLAG — in-game energy metric kill switch.
//
// When false (default for now): every energy-driven sub gate is
// disabled — energy doesn't tick, force-sits at energy<40 don't
// fire, bench re-entry isn't gated by energy<70, close-game
// override doesn't check energy. The engine falls back to pure
// pace-delta + fatigue-based subs, and the user team's manually-set
// target minutes are honored without an energy override stripping
// minutes from a star whose energy dipped mid-game.
//
// Flip to `true` to re-enable the full energy model (~8-min stints,
// energy depletes on floor, regenerates on bench). All the code is
// still in place; just gated behind this flag.
const ENERGY_GATES_ENABLED = true;

const STRATEGIES = {
  staggered: {
    name: 'Staggered',
    description:
      'Stars rest in shifts. At least one playmaker always on floor. Max 2 subs at a time.',
    type: 'balanced',
    rotation_depth: '9-10 players',
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
    rotation_depth: '9-11 players',
    strengths: ['Unit Chemistry', 'Predictable Rhythm'],
    weaknesses: ['Transition Gaps'],
    pace_threshold: 2.0,
    max_subs_per_check: 3,
  },
  tight_rotation: {
    name: 'Tight Rotation',
    description:
      'Lean heavily on top 8 players. Stars play big minutes. Bench only for short rest.',
    type: 'aggressive',
    rotation_depth: '8-9 players',
    strengths: ['Star Maximization', 'Closing Lineup'],
    weaknesses: ['Fatigue Risk', 'Thin Depth'],
    pace_threshold: 2.5,
    max_subs_per_check: 2,
  },
  deep_bench: {
    name: 'Deep Bench',
    description:
      'Spread minutes across 10-11 players. Everyone contributes. Fresh legs all game.',
    type: 'passive',
    rotation_depth: '10-11 players',
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
    rotation_depth: '10-13 players',
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
  const candidates = [];

  for (const player of benchPlayers) {
    // Skip if already in lineup
    if (currentLineupIds.includes(player.id)) {
      continue;
    }

    // Must be able to play the position (any of primary/secondary/tertiary
    // on either side)
    if (!sharesPlayablePosition(player, sitCandidate)) {
      continue;
    }

    // Bench eligibility — tiered to respect rotation depth in normal
    // play while still preventing 48-min-starter games when the
    // in-rotation bench is fully exhausted (e.g. when many bench
    // players are sitting due to restMode → target=0 for them).
    //
    //   Tier 1 (preferred): in-rotation players (target > 0) with
    //     minutes remaining. Used in any sub.
    //   Tier 2: in-rotation players who've hit their own target.
    //     Eligible ONLY on force-sit (paceDelta 999 from
    //     load_management, fatigue ≥85, or energy < 40).
    //   Tier 3 (last resort): deep-bench players (target === 0).
    //     Eligible ONLY on force-sit AND only after both higher tiers
    //     are exhausted — handled by the post-loop fallback below.
    //
    // This main loop builds Tier 1 + Tier 2 candidates. Tier 3 only
    // gets considered if this loop produces zero candidates.
    const actualMinutes = boxScore[player.id]?.minutes ?? 0;
    const target = targetMinutes[player.id] ?? 0;
    const remaining = target - actualMinutes;
    const isForceSit = sitCandidate.paceDelta >= 999;

    if (target <= 0) {
      continue;   // Tier 3 — handled separately as a fallback
    }
    if (remaining <= 0 && !isForceSit) {
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

  // Tier 3 fallback: if force-sit found zero in-rotation candidates
  // (every rotation player at this position is gassed / has target 0
  // because they're in restMode), reach into the deep bench rather than
  // leaving a depleted starter on the floor through the rest of the
  // game. Real coaches do the same — when the rotation is exhausted,
  // someone unexpected steps up. Only fires on force-sits to preserve
  // strategy depth in normal play.
  const isForceSit = sitCandidate.paceDelta >= 999;
  if (candidates.length === 0 && isForceSit) {
    for (const player of benchPlayers) {
      if (currentLineupIds.includes(player.id)) continue;
      const target = targetMinutes[player.id] ?? 0;
      if (target > 0) continue;   // already handled by Tier 1/2 above
      if (!sharesPlayablePosition(player, sitCandidate)) continue;
      const fatiguePenalty = (player.fatigue ?? 0) * 0.15;
      candidates.push({
        player,
        id: player.id,
        rating: getPlayerRating(player) - fatiguePenalty,
        minutesRemaining: 0,
      });
    }
  }

  // Tier 4 (last resort, force-sit only): any healthy bench player
  // regardless of position. Real coaches go "small ball" (PG/SG/SF
  // covering for fouled-out center) or "big ball" (PF covering for
  // an injured PG) when a position is exhausted. Better to put a
  // wrong-position backup on the floor than leave a depleted starter
  // playing through. Position-flex backups are used as the absolute
  // last resort — Tier 1/2/3 already cover position-matched options.
  if (candidates.length === 0 && isForceSit) {
    for (const player of benchPlayers) {
      if (currentLineupIds.includes(player.id)) continue;
      // benchPlayers list was already filtered for injury/fatigue/energy
      // gates earlier in evaluateSubstitutions, so any survivor here is
      // game-eligible — we just need to ignore the position constraint.
      const fatiguePenalty = (player.fatigue ?? 0) * 0.15;
      candidates.push({
        player,
        id: player.id,
        rating: getPlayerRating(player) - fatiguePenalty,
        minutesRemaining: 0,
      });
    }
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
    // Each strategy was extended by one rotation slot in 2026 so a team's
    // 9th/10th/11th man gets meaningful run (~4-5 min after normalize-to-
    // 240) instead of being a pure DNP. Top slots aren't reshaped — the
    // normalize step in generateRoleAwareTargetMinutes spreads the slight
    // extra budget across all slots, so top starters lose ~1 min to give
    // the new last rotation slot 4-6 min of game time.
    staggered: [34, 32, 30, 28, 26, 18, 14, 10, 8, 5, 0, 0, 0, 0, 0],
    // Pulled the top of the rotation down (was [36, 34, 32, 30, 28, 16,
    // 12, 8, 4, 0, ...]) — combined with the +2 quality bonus for 90+
    // starters and the normalize-to-240 step, the previous template
    // produced a 45-minute top starter (93.75% of game). Now lands ~41
    // min and the 6th-9th men get a few more minutes each, which still
    // reads as "tight" relative to staggered / deep_bench while staying
    // within real-NBA top-end-load territory.
    tight_rotation: [32, 30, 28, 26, 24, 18, 14, 10, 6, 4, 0, 0, 0, 0, 0],
    deep_bench: [30, 28, 26, 24, 22, 18, 16, 14, 12, 10, 5, 0, 0, 0, 0],
    platoon: [32, 30, 28, 26, 24, 18, 16, 12, 8, 6, 4, 0, 0, 0, 0],
    // load_management: identical baseline to deep_bench. Actual minutes are
    // dominated by the fatigue-gate in evaluateSubstitutions (any player at
    // ≥75 fatigue gets 0 minutes regardless of template), so this template
    // just shapes the rotation when nobody is gassed yet.
    load_management: [30, 28, 26, 24, 22, 18, 16, 14, 12, 10, 5, 0, 0, 0, 0],
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
  isUserTeamLive,
  isPlayoff = false
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

  // In-game hard fatigue cap, applied any time the engine is making
  // sub decisions — both AI teams AND the user's own team when they
  // fast-sim a game (vs playing it live). The only case this skips is
  // user-live games (`isUserTeamLive`), where the user manually controls
  // subs. Pregame minute haircuts in computeAITargetMinutes already reduce
  // a fatigued starter's target, but a close-game stretch or a behind-pace
  // bench can still drift them into the deep-red zone mid-game. This gate is
  // the safety net: a player at/above the cap gets force-sat and can't be
  // subbed back in until they recover below it.
  //
  // Regular season sits at 80; playoffs/OT ride stars HARD but still cap at
  // 92 so no one is pinned literally to 100. (Energy gates below stay fully
  // gloves-off in the playoffs — only this hard fatigue ceiling applies.)
  const AI_HARD_FATIGUE_CAP = 80;
  const HIGH_STAKES_FATIGUE_CAP = 92;
  const hardFatigueCap = isPlayoff ? HIGH_STAKES_FATIGUE_CAP : AI_HARD_FATIGUE_CAP;
  // Engine-controlled = the simulator decides subs (AI teams + user fast-sim),
  // i.e. any game except a user-live one. The hard fatigue cap applies here in
  // ALL games (at the stakes-scaled threshold above).
  const isEngineControlled = !isUserTeamLive;
  // The ENERGY gates below remain regular-season-only (gloves off on energy in
  // the playoffs); the hard fatigue cap is what protects high-stakes games.
  const isEngineControlledRegularSeason = !isUserTeamLive && !isPlayoff;

  // In-game energy: depletes while a player is on the floor and
  // regenerates while on the bench. Drives natural ~8-min stint
  // pattern instead of the previous "play 48 min unbroken" behavior
  // that the pure pace-delta sub trigger couldn't prevent. Energy is
  // initialized at game start (GameSimulator.initializeGameFromData)
  // and lives on the player object for the duration of the game only
  // — not persisted to disk. Whole block gated by the
  // ENERGY_GATES_ENABLED feature flag so the user can disable the
  // energy model without removing any of the code.
  const ENERGY_DEPLETION_BASE = 2.5;   // per game-minute on floor (2/3 lower than original 7.5)
  const ENERGY_REGEN_BASE = 4.5;       // per game-minute on bench
  const ENERGY_FORCE_SIT_THRESHOLD = 20;
  const ENERGY_REENTRY_THRESHOLD = 45;

  if (ENERGY_GATES_ENABLED) {
    for (const player of fullRoster) {
      if (!player?.id) continue;
      const lastTick = player.lastEnergyTickGameMinutes ?? 0;
      const deltaMinutes = Math.max(0, gameElapsed - lastTick);
      if (deltaMinutes <= 0) continue;
      const stam = player.attributes?.physical?.stamina ?? player.attributes?.stamina ?? 75;
      const fat = player.fatigue ?? 0;
      const onFloor = currentLineupIds.includes(player.id);
      if (onFloor) {
        // Drain rate redesigned for much wider stamina/fatigue variance.
        // Base lowered by 2/3 (7.5 → 2.5) so stamina + fatigue swings
        // matter more relative to the base. Stamina modifier triple the
        // previous spread (0.5 → 1.0), and fatigue penalty doubled
        // (×1.25 → ×2.0) — a low-stamina gassed star now drains ~6×
        // faster than a high-stamina fresh star.
        const drainRate = ENERGY_DEPLETION_BASE
          * (1.5 - (stam / 100) * 1.0)
          * (1 + Math.max(0, fat - 50) / 100 * 2.0);
        player.energy = Math.max(0, (player.energy ?? 100) - drainRate * deltaMinutes);
      } else {
        // Regen modifier doubled in spread (0.375 → 0.75) for the same
        // reason — high-stamina players recover noticeably faster than
        // low-stamina ones. Combined with the wider drain variance, an
        // 8-stamina-point gap between two players now produces visibly
        // different stint/rest patterns.
        const regenRate = ENERGY_REGEN_BASE * (0.75 + (stam / 100) * 0.75);
        player.energy = Math.min(100, (player.energy ?? 0) + regenRate * deltaMinutes);
      }
      player.lastEnergyTickGameMinutes = gameElapsed;
    }
  }

  // Build bench (players not in current lineup, not injured)
  let benchPlayers = [];
  for (const player of fullRoster) {
    if (!currentLineupIds.includes(player.id)) {
      if (!isPlayerInjured(player)) {
        // Fouled-out players (6 personals) can never re-enter.
        if ((boxScore[player.id]?.fouls ?? 0) >= 6) {
          continue;
        }
        // Load management: never sub in a player whose fatigue is at or above
        // the threshold. Let them sit and recover.
        if (isLoadManagement && (player.fatigue ?? 0) >= LOAD_MANAGEMENT_FATIGUE_THRESHOLD) {
          continue;
        }
        // Hard fatigue cap: don't sub in any player at/above the (stakes-
        // scaled) cap, regardless of which team they're on. Applies to AI
        // teams AND user teams when the user is fast-simming (the engine, not
        // the user, is making sub decisions). Skipped only when the user is
        // playing live (manual control).
        if (isEngineControlled && (player.fatigue ?? 0) >= hardFatigueCap) {
          continue;
        }
        // Energy re-entry gate: a player whose energy hasn't recovered
        // to 70 yet is still catching their breath. Don't bring them
        // back in even if pace-delta would suggest it. Same scope as
        // the fatigue cap above — applies during any engine-controlled
        // sim (AI teams or user fast-sim), skipped on user-live games.
        // Wrapped in the ENERGY_GATES_ENABLED feature flag so the user
        // can disable energy enforcement and have their stored target
        // minutes honored without an energy override.
        if (ENERGY_GATES_ENABLED && isEngineControlledRegularSeason && (player.energy ?? 100) < ENERGY_REENTRY_THRESHOLD) {
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
        tertiary_position: playerMap[playerId]?.tertiary_position ?? null,
      });
      continue;
    }

    // Hard fatigue cap: same force-sit treatment as load_management but
    // always-on regardless of chosen strategy. Applies to AI teams AND user
    // teams during fast-sim (any time the engine is making sub decisions).
    // Triggers at the stakes-scaled cap (80 regular / 92 playoffs) so it's a
    // safety net — computeAITargetMinutes handles the bulk of fatigue
    // management pregame.
    if (isEngineControlled && fatigue >= hardFatigueCap) {
      sitCandidates.push({
        id: playerId,
        paceDelta: 999,
        position: playerMap[playerId]?.position ?? 'SF',
        secondary_position: playerMap[playerId]?.secondary_position ?? null,
        tertiary_position: playerMap[playerId]?.tertiary_position ?? null,
      });
      continue;
    }

    // Energy force-sit: a player whose energy has dropped below 40
    // needs a breather — real NBA stars don't play unbroken 24-min
    // halves. Mirrors the load_management / fatigue-cap force-sit
    // pattern (paceDelta 999 sorts them to the front of the sit
    // list so they get pulled first). Applies on AI-team games AND
    // user-team fast-sim games (any time the engine is doing the
    // subbing). Skipped in playoffs and on user-live games. Wrapped
    // in the ENERGY_GATES_ENABLED feature flag.
    const energy = playerMap[playerId]?.energy ?? 100;
    if (ENERGY_GATES_ENABLED && isEngineControlledRegularSeason && energy < ENERGY_FORCE_SIT_THRESHOLD) {
      sitCandidates.push({
        id: playerId,
        paceDelta: 999,
        position: playerMap[playerId]?.position ?? 'SF',
        secondary_position: playerMap[playerId]?.secondary_position ?? null,
        tertiary_position: playerMap[playerId]?.tertiary_position ?? null,
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
        tertiary_position: playerMap[playerId]?.tertiary_position ?? null,
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
        tertiary_position: player.tertiary_position ?? null,
      });
    }
  }

  // Sort by most behind pace first
  behindPaceCandidates.sort((a, b) => b.deficit - a.deficit);

  // For each behind-pace bench player, find the best on-court player to swap out
  // (most ahead of pace at a compatible position) even if they haven't hit pace_threshold
  for (const benchCandidate of behindPaceCandidates) {
    // Check if there's already a sit candidate at a compatible position
    const alreadyCovered = sitCandidates.some((c) => sharesPlayablePosition(c, benchCandidate));

    if (alreadyCovered) continue;

    // Find the on-court player at a compatible position who is most ahead of pace
    let bestSwapOut = null;
    let bestPaceDelta = -Infinity;

    for (const playerId of currentLineupIds) {
      // Skip if already a sit candidate
      if (sitCandidates.some((c) => c.id === playerId)) continue;

      const onCourtPlayer = playerMap[playerId];
      if (!onCourtPlayer) continue;

      // Check position compatibility (primary/secondary/tertiary, both sides)
      if (!sharesPlayablePosition(onCourtPlayer, benchCandidate)) continue;

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
          position: onCourtPlayer.position ?? 'SF',
          secondary_position: onCourtPlayer.secondary_position ?? null,
          tertiary_position: onCourtPlayer.tertiary_position ?? null,
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
    let replacement = findBenchReplacement(
      benchPlayers,
      candidate,
      boxScore,
      targetMinutes,
      gameElapsed,
      newLineupIds
    );

    // Last-resort safety valve for force-sits: if Tier 1-4 in
    // findBenchReplacement all came up empty (e.g. every bench player
    // is gassed under the energy gate so benchPlayers is itself empty),
    // grab the highest-energy player from the full roster (including
    // injury-skipped + gate-filtered) and force them in. This is the
    // hard rule: a force-sit MUST result in the depleted player coming
    // off the floor. Without this valve, a fully-exhausted-bench
    // scenario silently no-ops and the gassed star stays on through
    // the remainder of the game.
    const isForceSit = candidate.paceDelta >= 999;
    if (!replacement && isForceSit) {
      let bestEnergy = -Infinity;
      let bestPlayer = null;
      for (const p of fullRoster) {
        if (!p?.id) continue;
        if (newLineupIds.includes(p.id)) continue;
        if (isPlayerInjured(p)) continue;
        const e = p.energy ?? 100;
        if (e > bestEnergy) {
          bestEnergy = e;
          bestPlayer = p;
        }
      }
      if (bestPlayer) {
        replacement = bestPlayer;
      }
    }

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
      // Fouled-out players (6 personals) can never re-enter.
      if (boxScore && (boxScore[p.id]?.fouls ?? 0) >= 6) return false;
      if (targetMinutes && boxScore) {
        const target = targetMinutes[p.id];
        const actual = boxScore[p.id]?.minutes ?? 0;
        // If player has a target set and has exceeded it, don't force them in
        if (target != null && target > 0 && actual >= target) return false;
      }
      return true;
    })
    .sort((a, b) => getPlayerRating(b) - getPlayerRating(a));

  // Fatigue + energy gate — a gassed star is worse on the floor than a
  // fresh backup, so we filter both depleted-fatigue (≥80) and
  // depleted-energy (<40, mid-game burst exhausted) players out of the
  // closeout lineup. Without the energy gate, the close-game override
  // would force gassed stars back into the last 5 minutes regardless
  // of how depleted they were, which is the main reason starters were
  // still hitting 46-48 minute totals after the energy-driven sub
  // engine was wired in. If too few eligible remain to fill 5 (deep
  // injury report, etc.), fall back to the legacy "best 5 healthy"
  // selection rather than returning null and stranding the team.
  const FATIGUE_CLOSEOUT_THRESHOLD = 80;
  const ENERGY_CLOSEOUT_THRESHOLD = 25;
  const fresh = healthy.filter((p) => {
    if ((p.fatigue ?? 0) >= FATIGUE_CLOSEOUT_THRESHOLD) return false;
    // Energy filter only applies when the energy model is enabled.
    if (ENERGY_GATES_ENABLED && (p.energy ?? 100) < ENERGY_CLOSEOUT_THRESHOLD) return false;
    return true;
  });
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

  // Strategy-specific per-starter cap. Used at every clamp site so the
  // renormalize step can't push a starter above the ceiling. Bench
  // slots have their own (looser) cap that just prevents nonsense
  // values — bench players never hit the starter cap anyway.
  const STARTER_CAP = aiStarterCapFor(strategy);
  const BENCH_CAP = 28; // generous bench ceiling; real-NBA 6th men hit ~28-30

  // Top 5 template slots → starters, with quality bumps for stars.
  for (let i = 0; i < healthyStarters.length && i < 5; i++) {
    let mins = templates[i] ?? 0;
    const rating = getPlayerRating(healthyStarters[i]);
    if (rating >= 90) mins += 2;
    else if (rating >= 80) mins += 1;
    targetMinutes[healthyStarters[i].id] = Math.max(0, Math.min(STARTER_CAP, mins));
  }

  // Remaining template slots → bench by rating rank.
  for (let i = 0; i < healthyBench.length; i++) {
    const mins = templates[5 + i] ?? 0;
    targetMinutes[healthyBench[i].id] = Math.max(0, Math.min(BENCH_CAP, mins));
  }

  // Normalize to exactly 240 (5 × 48 player-minutes per game). The
  // per-player clamps (STARTER_CAP / BENCH_CAP) hold throughout, so
  // freed minutes only flow to players who still have headroom. If
  // everyone is at their cap, total can fall short of 240 — that's
  // fine; the in-game pace tracker treats each target as a ceiling,
  // not a quota. No more "residual force-to-240" that pushed one
  // starter to 48 by bypassing the cap.
  const total = Object.values(targetMinutes).reduce((sum, m) => sum + m, 0);
  if (total > 0 && total !== 240) {
    const factor = 240 / total;
    for (const id of Object.keys(targetMinutes)) {
      const isStarter = starterSet.has(id);
      const cap = isStarter ? STARTER_CAP : BENCH_CAP;
      targetMinutes[id] = Math.max(0, Math.min(cap, Math.round(targetMinutes[id] * factor)));
    }
    // Cap-respecting residual fix: walk players who still have headroom
    // (below their cap) and distribute the rounding residual to them.
    // Drops the residual on the floor if nobody has headroom — better
    // than the old `Math.min(48, ...)` shortcut that ignored the cap.
    const rounded = Object.values(targetMinutes).reduce((s, m) => s + m, 0);
    let residual = 240 - rounded;
    if (residual !== 0) {
      const ids = Object.keys(targetMinutes).sort((a, b) =>
        targetMinutes[b] - targetMinutes[a]
      );
      for (const id of ids) {
        if (residual === 0) break;
        const isStarter = starterSet.has(id);
        const cap = isStarter ? STARTER_CAP : BENCH_CAP;
        const headroom = cap - targetMinutes[id];
        if (residual > 0 && headroom > 0) {
          const bump = Math.min(headroom, residual);
          targetMinutes[id] += bump;
          residual -= bump;
        } else if (residual < 0 && targetMinutes[id] > 0) {
          const cut = Math.min(targetMinutes[id], -residual);
          targetMinutes[id] -= cut;
          residual += cut;
        }
      }
    }
  }

  return targetMinutes;
}

/**
 * AI minute-target builder — single entry point for AI team pregame
 * allocation. Output is final and ready to use; no further mutation
 * by variance / renormalize / clamp steps in GameSimulator.
 *
 * Pipeline:
 *   1. Strategy template + quality bonuses + per-player cap
 *      (via generateRoleAwareTargetMinutes — cap is strategy-aware)
 *   2. Rest mode (player.restMode = true → 0 min for this game)
 *   3. Mild yellow-zone haircut (fatigue 50-69 → ×0.85)
 *   4. Final clamp at the strategy's starter cap (safety net)
 *
 * No renormalize-to-240. If the team has multiple players in restMode,
 * total target minutes may sum to less than 240 — that's correct
 * shorthanded-game behavior. The in-game pace tracker treats each
 * value as a ceiling; the in-game sub engine fills the gap by pulling
 * deep-bench when in-rotation is exhausted.
 *
 * Playoff bypass: returns the base output unchanged — no haircut, no
 * cap. AI plays stars hard when it matters.
 *
 * @param {Array} roster - Full roster of player objects
 * @param {Array} starterIds - Array of starter player IDs
 * @param {string} strategy - Substitution strategy key
 * @param {Object} [opts]
 * @param {boolean} [opts.isPlayoff=false]
 * @returns {Object} { [playerId]: minutesNumber }
 */
export function computeAITargetMinutes(roster, starterIds, strategy, { isPlayoff = false } = {}) {
  const base = generateRoleAwareTargetMinutes(roster, starterIds, strategy);

  const playerOf = (id) => roster.find((r) => r?.id === id);

  // Playoffs ride stars harder but are no longer a free-for-all: skip the
  // pregame fatigue haircut and restMode sit (a coach won't bench a star for a
  // whole playoff game), but still cap at regular cap + 4 MPG so no one is
  // pinned at 40+ every night. Extreme fatigue is caught mid-game by the
  // stakes-scaled hard cap (92) in evaluateSubstitutions.
  if (isPlayoff) {
    const PLAYOFF_CAP = aiStarterCapFor(strategy) + 4;
    const adjustedPo = {};
    for (const [id, mins] of Object.entries(base)) {
      adjustedPo[id] = Math.max(0, Math.round(Math.min(PLAYOFF_CAP, mins)));
    }
    return adjustedPo;
  }

  const STARTER_CAP = aiStarterCapFor(strategy);

  const adjusted = {};
  for (const [id, mins] of Object.entries(base)) {
    const p = playerOf(id);
    const f = p?.fatigue ?? 0;
    let m = mins;
    // Rest fatigued starters earlier and harder (tiered): the previous single
    // ≥50 → ×0.85 let stars ride heavy minutes while still red.
    if (p?.restMode === true) {
      m = 0;
    } else if (f >= 60) {
      m = m * 0.78;
    } else if (f >= 40) {
      m = m * 0.90;
    }
    // Final cap respects the team's strategy. base already clamped
    // at the same cap inside generateRoleAwareTargetMinutes, but
    // we re-apply here defensively after the fatigue multiplier.
    m = Math.min(STARTER_CAP, m);
    adjusted[id] = Math.max(0, Math.round(m));
  }

  return adjusted;
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
export function getDefaultTargetMinutes(roster, starterIds, strategy = 'staggered') {
  const targetMinutes = {};
  const bench = [];
  const STARTER_CAP = aiStarterCapFor(strategy);

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
  // the remainder across the first N starters, then clamp to the strategy's
  // starter cap so the fallback can't leak ~39-MPG uncapped starters (the
  // bench budget below absorbs any shortfall; a sub-240 total is fine).
  const baseStarterMins =
    healthyStarterCount > 0 ? Math.floor(192 / healthyStarterCount) : 0;
  const starterRemainder = 192 - baseStarterMins * healthyStarterCount;
  let starterTotal = 0;
  let starterIdx = 0;
  for (const id of Object.keys(targetMinutes)) {
    if (targetMinutes[id] === null) {
      const extra = starterIdx < starterRemainder ? 1 : 0;
      targetMinutes[id] = Math.min(baseStarterMins + extra, STARTER_CAP);
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
