/**
 * PlayExecutionEngine.js
 *
 * Translated from backend/app/Services/PlayExecutionEngine.php
 * Executes plays through their action points, resolving outcomes based on
 * player attributes, badges, and defensive schemes.
 */

import { getCoachPerks, getEffectiveCoachAttribute } from '@/engine/coaching/CoachPerks';
import { BADGES } from '@/engine/data/badges';
import { ACTION_EFFECT_KEYS, aggregateBadgeEffects, sumActionBoost } from '@/engine/data/badgeKeysByAction';

// Module-level lookup so we don't rebuild this map per call.
const BADGE_DEFINITIONS = Object.fromEntries(BADGES.map(b => [b.id, b]));

// Always-on attribute contributors per action type. These layer on top of the
// explicit `attributes.offense` / `attributes.defense` arrays in plays.js so
// every defined attribute appears in at least one rating computation. Because
// `calculateAttributeRating` averages across the full list, adding an extra
// contributor tempers the average rather than dominating it — exactly the
// behavior we want for "consistency", "hustle", "vertical" etc.
const AMBIENT_OFFENSE = {
  shot: ['offensiveConsistency'],
  drive: ['offensiveConsistency', 'hustle'],
  pass: ['passVision', 'passIQ'],
  dribble: ['ballHandling'],
  rebound: ['hustle', 'vertical'],
  screen: ['strength'],
  cut: ['hustle'],
};
const AMBIENT_DEFENSE = {
  shot: ['defensiveConsistency'],
  drive: ['defensiveConsistency', 'hustle'],
  pass: ['passPerception'],
  dribble: ['perimeterDefense'],
  rebound: ['hustle', 'vertical'],
  screen: ['helpDefenseIQ'],
  cut: ['helpDefenseIQ'],
  block: ['vertical', 'helpDefenseIQ'],
};

// Layer dunk/block-specific attrs on top of `shot` shots that target the rim.
function augmentAttrs(action, side, base) {
  const map = side === 'offense' ? AMBIENT_OFFENSE : AMBIENT_DEFENSE;
  const ambient = map[action.type] || [];
  // Avoid duplicates so calculateAttributeRating's average isn't double-weighted.
  const merged = [...base];
  for (const a of ambient) if (!merged.includes(a)) merged.push(a);
  // Rim-attacking shots also pull `vertical` on offense and on defense (the
  // shot-blocker's hops). Heuristic: shotType paint OR explicit dunk action.
  if (action.type === 'shot' && (action.shotType === 'paint' || /dunk/i.test(action.id))) {
    if (side === 'offense' && !merged.includes('vertical')) merged.push('vertical');
    if (side === 'defense' && !merged.includes('vertical')) merged.push('vertical');
  }
  return merged;
}

class PlayExecutionEngine {
  constructor() {
    this.roleAssignments = {};
    this.playerPositions = {};
    this.playerLineupIndices = {}; // Maps player ID to their lineup slot (0-4)
    this.ballCarrierId = null;
    this.keyframes = [];
    this.elapsedTime = 0;
    this.playResult = {};
    this.activatedBadges = [];
    this.defensiveScheme = 'man';
    this.defensiveModifiers = {};
    this.offensiveModifiers = {};
    this.offensiveCoach = null;
    this.clutchTime = false;
  }

  /**
   * Execute a play through its action points.
   *
   * @param {Object} play - The play to execute
   * @param {Array} offensiveLineup - The offensive team's lineup
   * @param {Array} defensiveLineup - The defensive team's lineup
   * @param {string} defensiveScheme - The defensive scheme being used (man, zone_2_3, etc.)
   * @param {Object} defensiveModifiers - Pre-calculated defensive modifiers
   * @param {Object} options - Additional context: { offensiveModifiers, offensiveCoach, clutchTime }
   * @returns {Object} Play result with stats, outcome, and animation keyframes
   */
  executePlay(play, offensiveLineup, defensiveLineup, defensiveScheme = 'man', defensiveModifiers = {}, options = {}) {
    // Store defensive context
    this.defensiveScheme = defensiveScheme;
    this.defensiveModifiers = defensiveModifiers;
    // Offensive context (coach IQ + game-management clutch bias)
    this.offensiveModifiers = options.offensiveModifiers ?? {};
    this.offensiveCoach = options.offensiveCoach ?? null;
    this.clutchTime = !!options.clutchTime;

    // Reset state
    this.resetState();

    // Track lineup indices for all players (offensive 0-4, defensive 5-9)
    offensiveLineup.forEach((player, index) => {
      const playerId = String(player.id ?? '');
      if (playerId) {
        this.playerLineupIndices[playerId] = index;
      }
    });
    defensiveLineup.forEach((player, index) => {
      const playerId = String(player.id ?? '');
      if (playerId) {
        this.playerLineupIndices[playerId] = index;
      }
    });

    // Assign players to roles
    this.assignRoles(play, offensiveLineup);

    // Set initial formation
    this.setFormation(play);

    // Find first action (usually the first one in the array)
    const firstAction = play.actions?.[0];
    let currentActionId = firstAction?.id ?? null;

    // Execute action sequence until we hit an end state
    const maxIterations = 20; // Safety limit
    let iterations = 0;

    while (currentActionId && iterations < maxIterations) {
      const action = this.findAction(play, currentActionId);
      if (!action) {
        break;
      }

      const outcome = this.executeAction(action, play, offensiveLineup, defensiveLineup);

      // Check for terminal states
      if (outcome.next && outcome.next.startsWith('end_')) {
        this.handleEndState(outcome, action);
        break;
      }

      if (outcome.next === 'rebound_battle') {
        this.handleReboundBattle(offensiveLineup, defensiveLineup);
        break;
      }

      if (outcome.next === 'free_throws') {
        this.handleFreeThrows(outcome, offensiveLineup);
        break;
      }

      currentActionId = outcome.next;
      iterations++;
    }

    return this.buildPlayResult(play);
  }

  /**
   * Execute a single action point.
   */
  executeAction(action, play, offensiveLineup, defensiveLineup) {
    // Get actor player
    const actorRole = action.actor;
    const actor = this.getPlayerByRole(actorRole, offensiveLineup);

    // Get defender if applicable
    const defender = this.getMatchingDefender(actor, defensiveLineup);

    // Apply movement
    if (action.movement) {
      this.applyMovement(action.movement, offensiveLineup);
    }

    // Accumulate fatigue per action. Cost defaults to 0.5 — heavier actions
    // can override via `action.fatigueCost`. Tireless badges and high
    // `durability` reduce the increment.
    this.accumulateFatigue(action, actor, defender);

    // Calculate outcome probabilities based on attributes
    const modifiedOutcomes = this.calculateModifiedOutcomes(
      action,
      actor,
      defender,
      offensiveLineup,
      defensiveLineup,
      play
    );

    // Select outcome
    const selectedOutcome = this.selectOutcome(modifiedOutcomes);

    // Record keyframe
    this.recordKeyframe(action, actor, selectedOutcome);

    // Update elapsed time
    this.elapsedTime += action.duration ?? 1.0;

    // Handle specific action types
    this.processActionType(action, selectedOutcome, actor, offensiveLineup);

    return selectedOutcome;
  }

  /**
   * Calculate modified outcome probabilities based on player attributes.
   */
  calculateModifiedOutcomes(action, actor, defender, offensiveLineup, defensiveLineup, play) {
    const outcomes = action.outcomes;
    const modified = {};

    // Get relevant attributes — augment with always-on contributors so that
    // every defined attribute touches at least one slot in the per-possession
    // math. `offensiveConsistency` and `defensiveConsistency` ride along on
    // every shot. `vertical` matters on dunks and on block-eligible defenses.
    // `hustle` matters on rebounds, drives, and putbacks. These are always
    // averaged into the offense/defense rating, never replacing the action's
    // explicit attributes — see `calculateAttributeRating`'s averaging.
    const offenseAttrs = augmentAttrs(action, 'offense', action.attributes?.offense ?? []);
    const defenseAttrs = augmentAttrs(action, 'defense', action.attributes?.defense ?? []);

    // Calculate offensive rating for this action
    const offenseRating = this.calculateAttributeRating(actor, offenseAttrs);

    // Calculate defensive rating
    let defenseRating = 50; // Default
    if (defender) {
      defenseRating = this.calculateAttributeRating(defender, defenseAttrs);
    }

    // Calculate advantage (-50 to +50 range typically)
    let advantage = (offenseRating - defenseRating) / 2;

    // Apply badge effects
    const badgeBoost = this.calculateBadgeBoost(action, actor, defender, play);
    // Effect-key magnitudes already match the per-percentage scale used by
    // shot resolution (e.g. assistBoost: 0.15 HOF). Multiply by 100 to land
    // on the same advantage-units scale as offense/defense ratings (where a
    // 50-point swing = ±25 advantage = ±0.125 probability shift).
    advantage += badgeBoost * 100;

    // Apply defensive scheme modifiers
    const shotMod = this.defensiveModifiers.shotModifier ?? 0;
    const turnoverMod = this.defensiveModifiers.turnoverModifier ?? 0;
    const blockMod = this.defensiveModifiers.blockModifier ?? 0;
    const stealMod = this.defensiveModifiers.stealModifier ?? 0;

    // Offensive coach scheme effectiveness (offensiveIQ-driven shot quality bonus
    // and turnover dampener) + late-game `gameManagement` clutch bias.
    const offShotBonus = this.offensiveModifiers.shotQualityBonus ?? 0;
    const offTurnoverPenalty = this.offensiveModifiers.turnoverPenalty ?? 0;

    let clutchShotBias = 0;
    let clutchTurnoverBias = 0;
    if (this.clutchTime && this.offensiveCoach) {
      const gm = getEffectiveCoachAttribute(this.offensiveCoach, 'gameManagement');
      // Centered at 75. Range roughly -2% .. +2.4% on shot probability.
      const gmBias = ((gm - 75) / 100) * 0.04;
      const perks = getCoachPerks(this.offensiveCoach);
      const clutchPerk = perks.clutchShotBonus ?? 0;
      clutchShotBias = gmBias + clutchPerk;
      // High game-management teams turn it over less under pressure.
      clutchTurnoverBias = -gmBias * 0.5;
    }

    // Player-level clutch + intangibles bias on the shooter when it's clutch
    // time. Centered at 50 to leave average players neutral. `clutch` swings
    // ±2%, `intangibles` adds another ±1% — flavorful nudge for cold-blooded
    // veterans without overshadowing skill ratings.
    if (this.clutchTime && action.type === 'shot') {
      const clutchAttr = this.getPlayerAttribute(actor, 'clutch') ?? 50;
      const intangiblesAttr = this.getPlayerAttribute(actor, 'intangibles') ?? 50;
      clutchShotBias += ((clutchAttr - 50) / 100) * 0.04;
      clutchShotBias += ((intangiblesAttr - 50) / 100) * 0.02;
    }

    const positiveOutcomes = ['success', 'made', 'finish', 'open', 'beat_defender', 'drive', 'shooter_open', 'cutter_open'];
    const negativeOutcomes = ['stolen', 'turnover', 'blocked', 'deflected', 'covered'];

    for (const [key, outcome] of Object.entries(outcomes)) {
      const baseProbability = outcome.probability ?? 0.5;
      const modifier = outcome.modifier ?? 0;

      // Adjust probability based on advantage
      let adjustedProbability = baseProbability;

      // Positive outcomes boosted by positive advantage
      if (positiveOutcomes.includes(key)) {
        adjustedProbability = baseProbability + (advantage / 200);
        // Apply shot modifier from defensive scheme + offensive coach bonuses
        if (key === 'made') {
          adjustedProbability += shotMod;
          adjustedProbability += offShotBonus;
          adjustedProbability += clutchShotBias;
        }
      }
      // Negative outcomes reduced by positive advantage
      else if (negativeOutcomes.includes(key)) {
        adjustedProbability = baseProbability - (advantage / 200);

        // Apply defensive scheme modifiers
        if (key === 'blocked') {
          adjustedProbability += blockMod;
        }
        if (key === 'stolen') {
          adjustedProbability += stealMod;
        }
        if (key === 'turnover') {
          adjustedProbability += turnoverMod;
          adjustedProbability += offTurnoverPenalty;
          adjustedProbability += clutchTurnoverBias;
        }
      }
      // Foul drawing — neither purely positive nor negative, so it gets its
      // own track. Centered at 50: high `drawFoul` shooters draw more
      // contact; defenders' clean-contest badge effects (Challenger,
      // Intimidator) reduce the chance.
      else if (key === 'fouled') {
        adjustedProbability = baseProbability;
        if (action.type === 'shot' || action.type === 'drive') {
          const drawFoul = this.getPlayerAttribute(actor, 'drawFoul') ?? 50;
          adjustedProbability += ((drawFoul - 50) / 200);
          if (defender) {
            const defEffects = aggregateBadgeEffects(defender, BADGE_DEFINITIONS);
            const cleanContest = defEffects.contestBoost || 0;
            adjustedProbability -= cleanContest * 0.5;
          }
        }
      }

      // Apply action-specific modifier
      adjustedProbability += modifier;

      // Clamp probability
      adjustedProbability = Math.max(0.05, Math.min(0.95, adjustedProbability));

      modified[key] = { ...outcome, probability: adjustedProbability };
    }

    // Normalize probabilities to sum to 1
    return this.normalizeProbabilities(modified);
  }

  /**
   * Calculate rating from multiple attributes.
   */
  calculateAttributeRating(player, attributeNames) {
    if (!attributeNames || attributeNames.length === 0) {
      return player.overall_rating ?? player.overallRating ?? 70;
    }

    let total = 0;
    let count = 0;

    for (const attrName of attributeNames) {
      const value = this.getPlayerAttribute(player, attrName);
      if (value !== null) {
        total += value;
        count++;
      }
    }

    return count > 0 ? total / count : 70;
  }

  /**
   * Get a player attribute by name (searches all categories).
   */
  getPlayerAttribute(player, attrName) {
    const attributes = player.attributes ?? {};

    for (const category of ['offense', 'defense', 'physical', 'mental']) {
      if (attributes[category]?.[attrName] !== undefined) {
        return Number(attributes[category][attrName]);
      }
    }

    // Check camelCase variations
    const camelName = attrName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    if (camelName !== attrName) {
      for (const category of ['offense', 'defense', 'physical', 'mental']) {
        if (attributes[category]?.[camelName] !== undefined) {
          return Number(attributes[category][camelName]);
        }
      }
    }

    return null;
  }

  /**
   * Calculate badge boost for an action.
   *
   * Two pathways combined:
   *
   *  1. Effect-key pathway (the meaningful one) — the actor's badges contribute
   *     the action-relevant offense effect keys (e.g. `assistBoost` for a pass)
   *     and the defender's badges subtract action-relevant defense effect keys.
   *     Multiple badges granting the same key take the MAX, never sum.
   *
   *  2. Legacy `play.badgeEffects[actionId]` pathway — small flat tier bonus
   *     for any badge tagged on this action. Kept so animation tracking on
   *     existing plays still fires while we migrate.
   *
   * Returns a small numeric "boost" that's multiplied by 100 by the caller to
   * land on the same scale as offense/defense ratings.
   */
  calculateBadgeBoost(action, actor, defender, play) {
    const actionId = action.id;
    const actionType = action.type;
    let boost = 0;

    // Animations should appear when the action RESOLVES, not at the start of
    // its movement. We schedule activations at the end of the action so they
    // stagger with the rest of the play animation.
    const activationTime = this.elapsedTime + (action.duration ?? 0);

    // Helper: dedupe per (badgeId, playerId) within a play. Keep the LATEST
    // activation so the badge fires when its effect actually mattered most
    // (e.g. on the shot, not on the upstream pass).
    const recordActivation = (badge, owner) => {
      const key = `${badge.id}-${owner.id ?? 'unknown'}`;
      const entry = {
        badgeId: badge.id,
        level: badge.level,
        playerId: owner.id ?? 'unknown',
        playerName: (owner.first_name ?? owner.firstName ?? '') + ' ' + (owner.last_name ?? owner.lastName ?? ''),
        actionId,
        time: activationTime,
      };
      const existingIdx = this._activationIndex?.get(key);
      if (existingIdx !== undefined) {
        this.activatedBadges[existingIdx] = entry;
      } else {
        if (!this._activationIndex) this._activationIndex = new Map();
        this._activationIndex.set(key, this.activatedBadges.length);
        this.activatedBadges.push(entry);
      }
    };

    // ---------------- Effect-key pathway ----------------
    if (ACTION_EFFECT_KEYS[actionType]) {
      const offEffects = aggregateBadgeEffects(actor, BADGE_DEFINITIONS);
      boost += sumActionBoost(offEffects, actionType, 'offense');

      if (defender) {
        const defEffects = aggregateBadgeEffects(defender, BADGE_DEFINITIONS);
        boost -= sumActionBoost(defEffects, actionType, 'defense');
      }

      // Track activation for any badge whose tier effects intersect this
      // action's offense keys (used for animation overlays).
      const relevantOffKeys = new Set(ACTION_EFFECT_KEYS[actionType].offense || []);
      const playerBadges = actor.badges ?? [];
      for (const badge of playerBadges) {
        const def = BADGE_DEFINITIONS[badge.id];
        if (!def) continue;
        const tierEffects = def.effects?.[badge.level] || {};
        const consumed = Object.keys(tierEffects).some(k => relevantOffKeys.has(k));
        if (consumed) recordActivation(badge, actor);
      }
    }

    // ---------------- Legacy badge-effects-by-action-id pathway ----------------
    const taggedBadgeIds = play.badgeEffects?.[actionId] ?? [];
    if (taggedBadgeIds.length > 0) {
      const TIER_FLAT = { bronze: 0.01, silver: 0.03, gold: 0.05, hof: 0.08 };
      const playerBadges = actor.badges ?? [];
      for (const badge of playerBadges) {
        if (!taggedBadgeIds.includes(badge.id)) continue;
        const flat = TIER_FLAT[badge.level] || 0;
        if (flat <= 0) continue;
        boost += flat;
        recordActivation(badge, actor);
      }
    }

    return boost;
  }

  /**
   * Accumulate fatigue on the actor and primary defender as actions resolve.
   *
   * - Default cost 0.5 per action; heavy actions (drives, shots, screens) can
   *   override via `action.fatigueCost`.
   * - Tireless badges (offense fatigue keys / defense fatigue keys) reduce
   *   the increment by their max-merged effect value (0..0.6).
   * - High `durability` cuts a small additional slice on top, so iron-man
   *   physical types decline more slowly across a long game.
   *
   * Fatigue is read by `GameSimulator.calculateFatigueModifier` to dampen
   * shot accuracy and by `SubstitutionEngine` as a sub trigger.
   */
  accumulateFatigue(action, actor, defender) {
    const baseCost = typeof action.fatigueCost === 'number' ? action.fatigueCost : 0.5;
    if (baseCost <= 0) return;

    const incrementFor = (player, sideKeys) => {
      if (!player) return;
      const effects = aggregateBadgeEffects(player, BADGE_DEFINITIONS);
      let badgeReduction = 0;
      for (const key of sideKeys) badgeReduction = Math.max(badgeReduction, effects[key] || 0);
      const durability = this.getPlayerAttribute(player, 'durability') ?? 70;
      const durabilityReduction = Math.max(0, (durability - 50) / 500); // up to 0.10
      const reduction = Math.min(0.85, badgeReduction + durabilityReduction);
      const delta = baseCost * (1 - reduction);
      player.fatigue = Math.min(100, (player.fatigue ?? 0) + delta);
    };

    incrementFor(actor, ACTION_EFFECT_KEYS.fatigue.offenseReduction);
    incrementFor(defender, ACTION_EFFECT_KEYS.fatigue.defenseReduction);
  }

  /**
   * Normalize probabilities to sum to 1.
   */
  normalizeProbabilities(outcomes) {
    const values = Object.values(outcomes);
    const total = values.reduce((sum, o) => sum + (o.probability ?? 0), 0);

    if (total <= 0) {
      // Equal distribution
      const count = values.length;
      for (const key of Object.keys(outcomes)) {
        outcomes[key].probability = 1 / count;
      }
      return outcomes;
    }

    for (const key of Object.keys(outcomes)) {
      outcomes[key].probability = outcomes[key].probability / total;
    }

    return outcomes;
  }

  /**
   * Select an outcome based on probabilities.
   */
  selectOutcome(outcomes) {
    const random = Math.random();
    let cumulative = 0;

    for (const [key, outcome] of Object.entries(outcomes)) {
      cumulative += outcome.probability;
      if (random <= cumulative) {
        return { ...outcome, key };
      }
    }

    // Fallback to last outcome
    const keys = Object.keys(outcomes);
    const lastKey = keys[keys.length - 1];
    return { ...outcomes[lastKey], key: lastKey };
  }

  /**
   * Assign players to play roles using attribute-weighted selection.
   * This distributes shots more realistically across the team.
   */
  assignRoles(play, lineup) {
    const roles = play.roles;
    const assigned = [];
    const category = play.category ?? 'motion';

    for (const [role, positions] of Object.entries(roles)) {
      // Get all eligible candidates (matching position)
      const candidates = [];
      for (const player of lineup) {
        const playerId = player.id;
        if (assigned.includes(playerId)) {
          continue;
        }

        // Check if player can play any of the role's positions
        const playerPos = player.position ?? 'SF';
        const secondaryPos = player.secondary_position ?? null;
        for (const position of positions) {
          if (playerPos === position || secondaryPos === position) {
            const fitness = this.calculateRoleFitness(player, role, category);
            candidates.push({
              player: player,
              fitness: fitness,
            });
            break;
          }
        }
      }

      // Select from candidates with weighted randomness
      if (candidates.length > 0) {
        // Sort by fitness (highest first)
        candidates.sort((a, b) => b.fitness - a.fitness);

        // Add variance: 70% best, 25% second best, 5% random
        const selectedPlayer = this.selectWithVariance(candidates);
        this.roleAssignments[role] = selectedPlayer.id;
        assigned.push(selectedPlayer.id);
      }

      // Fallback: assign any unassigned player
      if (!(role in this.roleAssignments)) {
        for (const player of lineup) {
          if (!assigned.includes(player.id)) {
            this.roleAssignments[role] = player.id;
            assigned.push(player.id);
            break;
          }
        }
      }
    }

    // Set initial ball carrier (usually ballHandler, point, or first role)
    const ballHandlerRoles = ['ballHandler', 'point', 'passer', 'pointGuard'];
    for (const role of ballHandlerRoles) {
      if (role in this.roleAssignments) {
        this.ballCarrierId = this.roleAssignments[role];
        break;
      }
    }

    if (!this.ballCarrierId && Object.keys(this.roleAssignments).length > 0) {
      const firstRole = Object.keys(this.roleAssignments)[0];
      this.ballCarrierId = this.roleAssignments[firstRole];
    }
  }

  /**
   * Calculate how well a player fits a given role based on attributes.
   */
  calculateRoleFitness(player, role, category) {
    let score = player.overall_rating ?? player.overallRating ?? 70;
    const offense = player.attributes?.offense ?? {};
    const physical = player.attributes?.physical ?? {};

    switch (role) {
      case 'ballHandler':
      case 'point':
      case 'passer':
      case 'pointGuard':
        score += (offense.ballHandling ?? 50) * 0.3;
        score += (offense.passVision ?? 50) * 0.2;
        score += (physical.speed ?? 50) * 0.1;
        break;

      case 'shooter':
      case 'wing1':
      case 'wing2':
      case 'weakWing':
        score += (offense.threePoint ?? 50) * 0.4;
        score += (offense.offensiveConsistency ?? 50) * 0.1;
        break;

      case 'screener':
      case 'post':
      case 'postPlayer':
      case 'elbow1':
      case 'elbow2':
      case 'block1':
      case 'block2':
        score += (offense.postControl ?? 50) * 0.3;
        score += (physical.strength ?? 50) * 0.2;
        break;

      case 'corner':
      case 'corner1':
      case 'corner2':
        score += (offense.threePoint ?? 50) * 0.35;
        break;

      case 'facilitator':
      case 'playmaker':
        score += (offense.passVision ?? 50) * 0.35;
        score += (offense.passAccuracy ?? 50) * 0.25;
        score += (offense.postControl ?? 50) * 0.1;
        break;

      case 'cutter':
      case 'trailer1':
      case 'trailer2':
      case 'rim_runner':
        score += (offense.layup ?? 50) * 0.25;
        score += (physical.speed ?? 50) * 0.2;
        break;
    }

    return score;
  }

  /**
   * Select a player from sorted candidates with variance.
   * 70% chance: best fit, 25% chance: second best, 5% chance: random
   */
  selectWithVariance(sortedCandidates) {
    const count = sortedCandidates.length;
    if (count === 1) {
      return sortedCandidates[0].player;
    }

    const rand = Math.floor(Math.random() * 100) + 1; // 1-100

    if (rand <= 70) {
      // Best candidate
      return sortedCandidates[0].player;
    } else if (rand <= 95 && count >= 2) {
      // Second best candidate
      return sortedCandidates[1].player;
    } else {
      // Random from remaining
      const randomIndex = Math.floor(Math.random() * count);
      return sortedCandidates[randomIndex].player;
    }
  }

  /**
   * Set initial formation positions.
   */
  setFormation(play) {
    const formation = play.formation;

    for (const [role, position] of Object.entries(formation)) {
      if (role in this.roleAssignments) {
        const playerId = this.roleAssignments[role];
        this.playerPositions[playerId] = position;
      }
    }

    // Record initial keyframe
    this.keyframes.push({
      time: 0,
      positions: this.buildPositionsSnapshot(),
      ball: this.ballCarrierId ? this.playerPositions[this.ballCarrierId] : { x: 0.5, y: 0.5 },
      action: 'formation',
      description: 'Setting up play',
    });
  }

  /**
   * Apply movement from an action.
   */
  applyMovement(movement, lineup) {
    for (const [role, newPosition] of Object.entries(movement)) {
      if (role === 'ball') {
        continue; // Ball handled separately
      }

      if (role === 'dynamic') {
        // Dynamic means current ball carrier
        if (this.ballCarrierId) {
          this.playerPositions[this.ballCarrierId] = newPosition;
        }
        continue;
      }

      if (role in this.roleAssignments) {
        const playerId = this.roleAssignments[role];
        this.playerPositions[playerId] = newPosition;
      }
    }
  }

  /**
   * Get player by role.
   */
  getPlayerByRole(role, lineup) {
    // Safety check: if lineup is empty, return a placeholder to prevent crashes
    if (!lineup || lineup.length === 0) {
      return {
        id: 'unknown_player',
        first_name: 'Unknown',
        last_name: 'Player',
        position: 'SF',
        attributes: {},
      };
    }

    if (role === 'dynamic') {
      // Return current ball carrier
      for (const player of lineup) {
        if ((player.id ?? null) === this.ballCarrierId) {
          return player;
        }
      }
    }

    const playerId = this.roleAssignments[role] ?? null;
    if (playerId) {
      for (const player of lineup) {
        if ((player.id ?? null) === playerId) {
          return player;
        }
      }
    }

    // Fallback to first player (with safety check for empty lineup)
    return lineup[0] ?? null;
  }

  /**
   * Get matching defender for a player.
   */
  getMatchingDefender(offensivePlayer, defensiveLineup) {
    const position = offensivePlayer.position ?? 'SF';

    // Find defender with matching position
    for (const defender of defensiveLineup) {
      if (defender.position === position) {
        return defender;
      }
    }

    // Fallback to any defender
    return defensiveLineup[0] ?? null;
  }

  /**
   * Find an action in a play by ID.
   */
  findAction(play, actionId) {
    for (const action of play.actions) {
      if (action.id === actionId) {
        return action;
      }
    }
    return null;
  }

  /**
   * Record a keyframe for animation.
   */
  recordKeyframe(action, actor, outcome) {
    const description = this.generateDescription(action, actor, outcome);
    const outcomeKey = outcome.key ?? '';

    const keyframe = {
      time: this.elapsedTime,
      positions: this.buildPositionsSnapshot(),
      ball: this.ballCarrierId
        ? (this.playerPositions[this.ballCarrierId] ?? { x: 0.5, y: 0.5 })
        : { x: 0.5, y: 0.5 },
      action: action.id,
      actionType: action.type,
      outcome: outcomeKey,
      description: description,
    };

    // Add result info if this is a scoring action
    if (outcome.points !== undefined) {
      keyframe.result = {
        type: outcomeKey,
        points: outcome.points,
      };
    }

    // Flag defensive plays for frontend animations
    if (['blocked', 'stolen', 'turnover'].includes(outcomeKey)) {
      keyframe.defensive_play = true;
      keyframe.defensive_scheme = this.defensiveScheme;
    }

    this.keyframes.push(keyframe);
  }

  /**
   * Build positions snapshot for all players.
   */
  buildPositionsSnapshot() {
    const snapshot = {};

    for (const [playerId, position] of Object.entries(this.playerPositions)) {
      snapshot[playerId] = {
        x: position.x,
        y: position.y,
        hasBall: playerId === this.ballCarrierId,
        lineupIndex: this.playerLineupIndices[playerId] ?? null,
      };
    }

    return snapshot;
  }

  /**
   * Generate human-readable description.
   */
  generateDescription(action, actor, outcome) {
    const name = actor.first_name ?? actor.firstName ?? 'Player';
    const outcomeKey = outcome.key ?? '';

    // Handle special defensive outcomes
    if (['stolen', 'turnover'].includes(outcomeKey)) {
      return this.getTurnoverDescription(name);
    }

    switch (action.type) {
      case 'screen':
        return `${name} sets a screen`;
      case 'pass':
        return outcomeKey === 'stolen'
          ? this.getTurnoverDescription(name)
          : `${name} passes the ball`;
      case 'drive':
        return outcomeKey === 'turnover'
          ? this.getTurnoverDescription(name)
          : `${name} drives to the basket`;
      case 'shot':
        return this.getShotDescription(action, actor, outcome);
      case 'decision':
        return `${name} reads the defense`;
      case 'cut':
        return `${name} cuts to the basket`;
      case 'setup':
        return `${name} sets up the play`;
      case 'post':
        return `${name} works in the post`;
      case 'handoff':
        return outcomeKey === 'turnover'
          ? this.getTurnoverDescription(name)
          : `${name} executes a handoff`;
      case 'reset':
        return 'Resetting the offense';
      default:
        return `${name} executes play action`;
    }
  }

  /**
   * Get shot description based on outcome.
   */
  getShotDescription(action, actor, outcome) {
    const name = actor.first_name ?? actor.firstName ?? 'Player';
    const shotType = action.shotType ?? 'shot';

    let shotName;
    switch (shotType) {
      case 'threePoint': shotName = 'three-pointer'; break;
      case 'midRange': shotName = 'mid-range jumper'; break;
      case 'paint': shotName = 'shot at the rim'; break;
      default: shotName = 'shot'; break;
    }

    if (outcome.key === 'made') {
      return `${name} makes the ${shotName}!`;
    } else if (outcome.key === 'missed') {
      return `${name} misses the ${shotName}`;
    } else if (outcome.key === 'blocked') {
      return this.getBlockedDescription(name);
    } else if (outcome.key === 'fouled') {
      return `${name} is fouled on the ${shotName}`;
    }

    return `${name} takes a ${shotName}`;
  }

  /**
   * Get scheme-aware description for blocked shots.
   */
  getBlockedDescription(shooterName) {
    const descriptionsMap = {
      man: [
        `${shooterName}'s shot is swatted away!`,
        'Strong man defense leads to a block!',
        `${shooterName} gets his shot rejected!`,
      ],
      zone_2_3: [
        'The 2-3 zone collapses and blocks!',
        'Zone defense walls off the paint!',
        `${shooterName} is met by the zone!`,
      ],
      zone_3_2: [
        'The 3-2 zone rotates for the block!',
        `${shooterName}'s shot is sent back!`,
      ],
      zone_1_3_1: [
        'The 1-3-1 zone gets the block!',
        'Weak side help leads to a rejection!',
      ],
      press: [
        `${shooterName}'s rushed shot is blocked!`,
        "Press forces contested attempt that's rejected!",
      ],
      trap: [
        'Double team leads to a blocked shot!',
        `${shooterName} gets trapped and blocked!`,
      ],
    };

    const defaultDescriptions = [
      `${shooterName}'s shot is blocked!`,
      'Great defensive play for the block!',
    ];

    const descriptions = descriptionsMap[this.defensiveScheme] ?? defaultDescriptions;
    return descriptions[Math.floor(Math.random() * descriptions.length)];
  }

  /**
   * Get scheme-aware description for turnovers/steals.
   */
  getTurnoverDescription(playerName) {
    const descriptionsMap = {
      man: [
        'Tight man defense forces the turnover!',
        'Man-to-man pressure creates the steal!',
        `${playerName} coughs it up against the pressure!`,
      ],
      zone_2_3: [
        'The 2-3 zone reads the pass!',
        'Zone defense anticipates and steals!',
      ],
      zone_3_2: [
        'The 3-2 zone picks off the pass!',
        'Quick hands in the zone cause the turnover!',
      ],
      zone_1_3_1: [
        'The 1-3-1 trap forces the turnover!',
        'Aggressive trapping creates the steal!',
        `${playerName} is caught in the 1-3-1!`,
      ],
      press: [
        'Full court press creates the turnover!',
        'Press defense forces the bad pass!',
        `${playerName} can't handle the pressure!`,
      ],
      trap: [
        'Double team forces the turnover!',
        'Trap defense creates another steal!',
        `${playerName} is suffocated by the trap!`,
      ],
    };

    const defaultDescriptions = [
      'Turnover! Great defensive play!',
      `${playerName} loses the ball!`,
    ];

    const descriptions = descriptionsMap[this.defensiveScheme] ?? defaultDescriptions;
    return descriptions[Math.floor(Math.random() * descriptions.length)];
  }

  /**
   * Process action type for state updates.
   */
  processActionType(action, outcome, actor, lineup) {
    // Handle pass - transfer ball carrier and track passer for assist attribution
    if (action.type === 'pass' && outcome.key !== 'stolen') {
      this.playResult.lastPasserId = actor.id ?? null;
      const receiverRole = action.receiver ?? null;
      if (receiverRole && receiverRole in this.roleAssignments) {
        this.ballCarrierId = this.roleAssignments[receiverRole];
      }
    }

    // Handle handoff - track passer for assist attribution
    if (action.type === 'handoff' && outcome.key !== 'turnover') {
      this.playResult.lastPasserId = actor.id ?? null;
      const receiverRole = action.receiver ?? null;
      if (receiverRole && receiverRole in this.roleAssignments) {
        this.ballCarrierId = this.roleAssignments[receiverRole];
      }
    }

    // Track shot attempts
    if (action.type === 'shot') {
      this.playResult.shotAttempt = {
        shooter: actor.id ?? 'unknown',
        shooterName: (actor.first_name ?? actor.firstName ?? '') + ' ' + (actor.last_name ?? actor.lastName ?? ''),
        shotType: action.shotType ?? 'paint',
        made: outcome.key === 'made',
        fouled: outcome.key === 'fouled',
        blocked: outcome.key === 'blocked',
        points: outcome.points ?? 0,
      };
    }
  }

  /**
   * Handle end states.
   */
  handleEndState(outcome, action) {
    const endType = outcome.next;

    if (endType === 'end_made') {
      this.playResult.outcome = 'made';
      this.playResult.points = outcome.points ?? 2;
    } else if (endType === 'end_turnover') {
      this.playResult.outcome = 'turnover';
      this.playResult.points = 0;
    } else {
      this.playResult.outcome = 'completed';
      this.playResult.points = outcome.points ?? 0;
    }
  }

  /**
   * Handle rebound battle.
   */
  handleReboundBattle(offensiveLineup, defensiveLineup) {
    let offRebRating = 0;
    let defRebRating = 0;

    for (const player of offensiveLineup) {
      offRebRating += player.attributes?.defense?.offensiveRebound ?? 40;
    }

    for (const player of defensiveLineup) {
      defRebRating += player.attributes?.defense?.defensiveRebound ?? 50;
    }

    // Defense has inherent positioning advantage (box out)
    const defAdvantage = 2.5;
    let totalWeighted = offRebRating + defRebRating * defAdvantage;
    if (totalWeighted <= 0) totalWeighted = 1;

    let offRebChance = offRebRating / totalWeighted;
    offRebChance = Math.max(0.15, Math.min(0.40, offRebChance));

    if (Math.floor(Math.random() * 1000) + 1 <= Math.floor(offRebChance * 1000)) {
      this.playResult.outcome = 'offensive_rebound';
      this.playResult.points = 0;
    } else {
      this.playResult.outcome = 'missed';
      this.playResult.points = 0;
    }

    // Record rebound keyframe
    this.keyframes.push({
      time: this.elapsedTime + 0.5,
      positions: this.buildPositionsSnapshot(),
      ball: { x: 0.5, y: 0.8 },
      action: 'rebound_battle',
      description: this.playResult.outcome === 'offensive_rebound'
        ? 'Offensive rebound!'
        : 'Defensive rebound',
    });
  }

  /**
   * Handle free throws.
   */
  handleFreeThrows(outcome, offensiveLineup) {
    // Safety check: if lineup is empty, skip free throws
    if (!offensiveLineup || offensiveLineup.length === 0) {
      this.playResult.outcome = 'free_throws';
      this.playResult.points = 0;
      this.playResult.freeThrows = { made: 0, attempted: 0 };
      return;
    }

    let shooter = null;
    for (const player of offensiveLineup) {
      if (player.id === this.ballCarrierId) {
        shooter = player;
        break;
      }
    }

    if (!shooter) {
      shooter = offensiveLineup[0];
    }

    const ftRating = shooter.attributes?.offense?.freeThrow ?? 70;
    const ftPercentage = ftRating / 100;

    // Assume 2 free throws
    let made = 0;
    for (let i = 0; i < 2; i++) {
      if (Math.random() < ftPercentage) {
        made++;
      }
    }

    this.playResult.outcome = 'free_throws';
    this.playResult.points = made;
    this.playResult.freeThrows = { made: made, attempted: 2, shooterId: shooter.id ?? null };

    this.keyframes.push({
      time: this.elapsedTime + 1.0,
      positions: this.buildPositionsSnapshot(),
      ball: { x: 0.5, y: 0.75 },
      action: 'free_throws',
      description: (shooter.first_name ?? shooter.firstName ?? 'Player') + ` makes ${made} of 2 free throws`,
    });
  }

  /**
   * Build final play result.
   */
  buildPlayResult(play) {
    return {
      playId: play.id,
      playName: play.name,
      category: play.category,
      outcome: this.playResult.outcome ?? 'completed',
      points: this.playResult.points ?? 0,
      duration: this.elapsedTime,
      shotAttempt: this.playResult.shotAttempt ?? null,
      freeThrows: this.playResult.freeThrows ?? null,
      lastPasserId: this.playResult.lastPasserId ?? null,
      keyframes: this.keyframes,
      roleAssignments: this.roleAssignments,
      activatedBadges: this.activatedBadges,
    };
  }

  /**
   * Reset engine state for new play.
   */
  resetState() {
    this.roleAssignments = {};
    this.playerPositions = {};
    this.playerLineupIndices = {};
    this.ballCarrierId = null;
    this.keyframes = [];
    this.elapsedTime = 0;
    this.playResult = {};
    this.activatedBadges = [];
    this._activationIndex = new Map();
    // Note: defensiveScheme and defensiveModifiers are set at start of executePlay
  }

  /**
   * Generate animation data for frontend.
   */
  generateAnimationData(playResult) {
    return {
      playId: playResult.playId,
      playName: playResult.playName,
      duration: playResult.duration,
      keyframes: playResult.keyframes,
    };
  }
}

export default PlayExecutionEngine;
