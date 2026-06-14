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

// Synergy and probability-stacking guard rails. Without these, multiple
// synergies firing simultaneously plus stacked badge / coach / momentum /
// home-court bumps could push raw shot probability above 1.0 before the
// [0.05, 0.95] safety clamp truncated it — producing 127-56 blowouts and
// near-deterministic possessions for contender teams. These caps preserve
// meaningful per-modifier impact while preventing runaway combinations.
const MAX_OFFENSIVE_SYNERGY_BOOST = 0.12;   // one strong synergy's worth
const MAX_DEFENSIVE_SYNERGY_PENALTY = 0.10;
const MAX_DEVIATION_FROM_BASE = 0.35;
// Negative outcomes (turnover / blocked / stolen) need a tighter deviation
// cap than `made` shots — those probabilities don't have headroom to absorb
// large modifiers (base ~0.10) and a spike there suppresses `made` via the
// normalize-to-1 step. Capping each at ±0.15 keeps worst-case rates
// realistic (e.g., turnover base 0.10 → max 0.25).
const MAX_NEGATIVE_OUTCOME_DEVIATION = 0.15;

// Shot-type-aware default base probabilities. Real NBA: ~62% close shots,
// ~42% mid-range, ~37% threes. These are used when a play's outcome
// doesn't explicitly set a probability — preventing the historic flat-0.5
// default from forcing modifiers to do all the differentiation work.
const DEFAULT_PROB_THREE = 0.37;
const DEFAULT_PROB_CLOSE = 0.60;
const DEFAULT_PROB_MID_RANGE = 0.42;

function _defaultBaseProbability(key, outcome, action) {
  if (key === 'made') {
    if (outcome?.points === 3) return DEFAULT_PROB_THREE;
    const shotType = action?.shotType;
    if (shotType === 'midRange' || shotType === 'mid_range') return DEFAULT_PROB_MID_RANGE;
    // 'paint', 'close', 'at_rim', layups, dunks — all treated as close shots.
    return DEFAULT_PROB_CLOSE;
  }
  return 0.5;
}

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
    // Set by GameSimulator after instantiation; lets the engine read momentum,
    // fatigue, and cold-streak state during per-action probability resolution.
    this.gameSimulator = null;
    this.offensiveTeamSide = null;
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
    // 'home' | 'away' — used to look up the offense's momentum value on the
    // shared gameSimulator during shot-probability calculation.
    this.offensiveTeamSide = options.offensiveTeamSide ?? null;

    // Synergy candidates pre-computed by GameSimulator. Condition gating is
    // deferred to here because PEE has the full shot context. PEE writes back
    // the FIRED subset to playResult so the animation list reflects only
    // synergies whose conditions actually matched.
    this.synergyShotMap = options.synergyShotMap ?? null;            // Map<playerId, [act, ...]>
    this.synergyDefenseCandidates = options.synergyDefenseCandidates ?? [];
    this.synergyReboundCandidates = options.synergyReboundCandidates ?? [];
    this.firedShotSynergies = [];
    this.firedDefenseSynergies = [];
    this.firedReboundSynergies = [];

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
    // shot resolution. We scale to advantage-units, but at 60× rather than
    // the original 100× — a single HoF defense badge now contributes ~10
    // advantage units instead of ~17, softening the cumulative effect of
    // stacked defensive lineups (further damped by the defense-side falloff
    // inside calculateBadgeBoost).
    advantage += badgeBoost * 60;

    // Apply defensive scheme modifiers
    const shotMod = this.defensiveModifiers.shotModifier ?? 0;
    const turnoverMod = this.defensiveModifiers.turnoverModifier ?? 0;
    const blockMod = this.defensiveModifiers.blockModifier ?? 0;
    const stealMod = this.defensiveModifiers.stealModifier ?? 0;

    // Offensive coach scheme effectiveness (offensiveIQ-driven shot quality bonus
    // and turnover dampener) + late-game `gameManagement` clutch bias.
    const offShotBonus = this.offensiveModifiers.shotQualityBonus ?? 0;
    const offTurnoverPenalty = this.offensiveModifiers.turnoverPenalty ?? 0;
    // Team chemistry shot bonus — fed in per-possession from GameSimulator
    // using the average roster morale. Already clamped to ±0.03 upstream.
    const chemistryShotBonus = this.offensiveModifiers.chemistryShotBonus ?? 0;
    // Home court advantage — only set when the offense is the home team
    // (zero for away). +1.5% baseline, +2.5% when the home crowd is engaged
    // (avg roster morale ≥ 65). See GameSimulator.calculateHomeCourtAdvantage.
    const homeCourtBonus = this.offensiveModifiers.homeCourtBonus ?? 0;

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
      // Resolve the base probability. If the play didn't set one explicitly,
      // fall back to a shot-type-aware default so threes start at ~37%,
      // close shots at ~60%, and mid-range at ~42% — close to real NBA
      // baselines per shot type. Previously every shot defaulted to 0.50,
      // which meant the modifier stack had to do disproportionate work to
      // differentiate shot quality, and the negative side of the stack
      // dragged scoring well below realistic levels.
      let baseProbability = outcome.probability;
      if (baseProbability == null) {
        baseProbability = _defaultBaseProbability(key, outcome, action);
      }
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
          adjustedProbability += chemistryShotBonus;
          adjustedProbability += homeCourtBonus;

          // Team momentum spillover. Range ±0.02 — small per shot but
          // compounds visibly over a quarter, creating natural runs.
          const momentumValue =
            this.gameSimulator?.momentum?.[this.offensiveTeamSide] ?? 50;
          adjustedProbability += (momentumValue - 50) / 1500;

          // Personal cold-streak break-out: one-shot +0.03 bump when the
          // shooter is below 25% over their last 5 attempts AND their team
          // momentum is ≥ 60. Burns the bonus once; resets on next make.
          const shooterId = actor?.id;
          if (
            shooterId &&
            this.gameSimulator?.shouldGrantColdStreakBonus?.(
              shooterId,
              this.offensiveTeamSide
            )
          ) {
            adjustedProbability += 0.03;
            this.gameSimulator.consumeColdStreakBonus(shooterId);
          }

          // Fatigue is applied AFTER the deviation cap below — see the
          // post-cap block. Order matters: applying it here would compound
          // fatigue with the additive modifier stack, then the cap would
          // clamp the residue, producing inconsistent ceilings depending on
          // the shooter's gas.

          // Apply badge synergies. The condition gate runs here because PEE
          // owns the full shot context (shotType, dribblesSincePass,
          // play.category, clutchTime). Each fired synergy is stamped onto
          // `firedShotSynergies` / `firedDefenseSynergies` so GameSimulator's
          // animation list reflects only synergies that actually applied.
          const shotType = this._normalizeShotType(action.shotType);
          const synergyCtx = {
            shotType,
            dribblesSincePass: this.playResult.dribblesSincePass,
            clutchTime: this.clutchTime,
            playCategory: play?.category,
            playId: play?.id,
          };
          // Accumulate offensive synergy boosts into a local total, then cap
          // before adding to adjustedProbability. Without the cap, 3+ shot-
          // phase synergies firing on the same possession could stack to
          // +0.30 or more on shot probability — the single biggest amplifier
          // behind contender-vs-rebuilder blowouts. Each fired synergy still
          // gets pushed onto `firedShotSynergies` so the on-court animation
          // banner shows them.
          if (this.gameSimulator && this.synergyShotMap && actor?.id != null) {
            const shotCandidates = this.synergyShotMap.get(String(actor.id)) || [];
            let synergyOffenseBoost = 0;
            for (const cand of shotCandidates) {
              if (!this.gameSimulator.shotSynergyMatches(cand, synergyCtx)) continue;
              synergyOffenseBoost += cand.boost?.shotPercentage || 0;
              synergyOffenseBoost += cand.boost?.rollerFinishing || 0;
              synergyOffenseBoost += cand.boost?.screenEffectiveness || 0;
              this.firedShotSynergies.push(cand);
            }
            adjustedProbability += Math.min(synergyOffenseBoost, MAX_OFFENSIVE_SYNERGY_BOOST);
          }
          if (this.gameSimulator && this.synergyDefenseCandidates) {
            let synergyDefensePenalty = 0;
            for (const cand of this.synergyDefenseCandidates) {
              if (!this.gameSimulator.defenseSynergyMatches(cand, synergyCtx)) continue;
              synergyDefensePenalty += cand.boost?.paintDefense || 0;
              synergyDefensePenalty += cand.boost?.forcedBadShots || 0;
              this.firedDefenseSynergies.push(cand);
            }
            adjustedProbability -= Math.min(synergyDefensePenalty, MAX_DEFENSIVE_SYNERGY_PENALTY);
          }
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

      // Cap cumulative deviation from baseProbability so the [0.05, 0.95]
      // safety clamp below stops being the primary limiter. Tighter cap on
      // negative outcomes (turnover/blocked/stolen): those bases are small
      // (~0.10) and a wide cap would let modifiers double them, then the
      // normalize-to-1 step would squeeze `made` way down — invisible
      // suppression that the positive-side cap can't see.
      const maxDeviation = negativeOutcomes.includes(key)
        ? MAX_NEGATIVE_OUTCOME_DEVIATION
        : MAX_DEVIATION_FROM_BASE;
      const deviation = adjustedProbability - baseProbability;
      const cappedDeviation = Math.max(
        -maxDeviation,
        Math.min(maxDeviation, deviation)
      );
      adjustedProbability = baseProbability + cappedDeviation;

      // Fatigue multiplier — applied AFTER the cap so a fatigued shooter's
      // ceiling is cleanly (capped × fatigue) rather than compounding with
      // the additive negative stack underneath the cap. Only the `made`
      // outcome takes the penalty; turnovers/blocks/steals don't get a
      // bonus from a tired shooter.
      if (key === 'made') {
        const fatigueMod =
          this.gameSimulator?.calculateFatigueModifier?.(actor) ?? 1;
        adjustedProbability *= fatigueMod;
      }

      // Final safety clamp — should now rarely engage, just protects
      // against any unforeseen path that produces a value outside [0.05, 0.95].
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
        // Defensive-stack diminishing returns: rank the defender's contributing
        // action-relevant effect-key values descending, then sum with
        // [1.00, 0.60, 0.35, 0.20] multipliers (4th+ all at 0.20). A single
        // elite defender still wins his matchup, but a defender carrying many
        // stacked defense badges no longer compounds them linearly.
        const defKeys = ACTION_EFFECT_KEYS[actionType].defense || [];
        const contributions = defKeys
          .map(k => defEffects[k] || 0)
          .filter(v => v > 0)
          .sort((a, b) => b - a);
        const FALLOFF = [1.00, 0.60, 0.35, 0.20];
        let damped = 0;
        for (let i = 0; i < contributions.length; i++) {
          const factor = FALLOFF[i] ?? FALLOFF[FALLOFF.length - 1];
          damped += contributions[i] * factor;
        }
        boost -= damped;
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
   * Normalize the shot-type tokens emitted by play definitions
   * (`threePoint`, `midRange`, `paint`) to the snake_case form used by
   * synergy condition matching.
   */
  _normalizeShotType(raw) {
    switch (raw || 'paint') {
      case 'threePoint': return 'three_pointer';
      case 'midRange': return 'mid_range';
      default: return 'paint';
    }
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
    // Handle pass - transfer ball carrier and track passer for assist
    // attribution. Each successful pass / handoff resets the
    // "dribbles-between-pass-and-shot" counter so a clean catch-and-shoot
    // off this pass is recognised as an assist downstream.
    if (action.type === 'pass' && outcome.key !== 'stolen') {
      this.playResult.lastPasserId = actor.id ?? null;
      this.playResult.dribblesSincePass = 0;
      const receiverRole = action.receiver ?? null;
      if (receiverRole && receiverRole in this.roleAssignments) {
        this.ballCarrierId = this.roleAssignments[receiverRole];
      }
    }

    // Handle handoff - track passer for assist attribution
    if (action.type === 'handoff' && outcome.key !== 'turnover') {
      this.playResult.lastPasserId = actor.id ?? null;
      this.playResult.dribblesSincePass = 0;
      const receiverRole = action.receiver ?? null;
      if (receiverRole && receiverRole in this.roleAssignments) {
        this.ballCarrierId = this.roleAssignments[receiverRole];
      }
    }

    // Drives count as ball-handling between a catch and a shot. Only count
    // them once we've actually seen a pass (otherwise undefined → NaN-ish
    // accumulation from a fresh play start). If `dribblesSincePass` is null
    // there hasn't been a pass yet on this play, so don't track.
    if (action.type === 'drive' && this.playResult.dribblesSincePass != null) {
      this.playResult.dribblesSincePass += 1;
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
        // Number of drive (dribble) actions executed between the last pass
        // and this shot. Used by the assist resolver: 0 → guaranteed assist,
        // 1–2 → high probability, 3+ → standard probabilistic credit.
        dribblesSincePass: this.playResult.dribblesSincePass,
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

    // Apply rebound-phase synergy boost (Board Dominance, Box Out Brigade,
    // Second Chance Machine). `rebounding` fires unconditionally inside the
    // rebound battle; `offensive_rebound` fires only when offense wins, so we
    // bias the roll first and resolve the condition-gated synergy after.
    const reboundCandidates = this.synergyReboundCandidates || [];
    for (const cand of reboundCandidates) {
      if (cand.condition === 'rebounding') {
        offRebChance += cand.boost?.reboundRate || 0;
        this.firedReboundSynergies.push(cand);
      }
    }
    offRebChance = Math.max(0.15, Math.min(0.60, offRebChance));

    const offenseWon = Math.floor(Math.random() * 1000) + 1 <= Math.floor(offRebChance * 1000);
    if (offenseWon) {
      this.playResult.outcome = 'offensive_rebound';
      this.playResult.points = 0;
      // `offensive_rebound` condition: only fires when offense wins the battle.
      for (const cand of reboundCandidates) {
        if (cand.condition === 'offensive_rebound') {
          this.firedReboundSynergies.push(cand);
        }
      }
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
      firedShotSynergies: this.firedShotSynergies,
      firedDefenseSynergies: this.firedDefenseSynergies,
      firedReboundSynergies: this.firedReboundSynergies,
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
