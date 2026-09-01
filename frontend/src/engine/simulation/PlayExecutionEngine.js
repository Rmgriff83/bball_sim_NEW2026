/**
 * PlayExecutionEngine.js
 *
 * Translated from backend/app/Services/PlayExecutionEngine.php
 * Executes plays through their action points, resolving outcomes based on
 * player attributes, badges, and defensive schemes.
 */

import { getCoachPerks, getEffectiveCoachAttribute } from '@/engine/coaching/CoachPerks';
import { T } from '@/engine/simulation/commentaryTemplate';
import { BADGES } from '@/engine/data/badges';
import { ACTION_EFFECT_KEYS, aggregateBadgeEffects, sumActionBoost } from '@/engine/data/badgeKeysByAction';
import { DEFENSIVE_SCHEMES } from '@/engine/simulation/CoachingEngine';
import {
  schemeFamily,
  assignManMatchups,
  buildZoneAnchors,
  zoneDefenderId,
  assignBoxAndOne,
  screenSwitchChance,
} from '@/engine/simulation/DefensiveMatchup';

// Module-level lookup so we don't rebuild this map per call.
const BADGE_DEFINITIONS = Object.fromEntries(BADGES.map(b => [b.id, b]));

// --- Defense/matchup-aware read steering -----------------------------------
// Result keys are shot/possession RESULTS, not reads — they are never steered.
const RESULT_OUTCOME_KEYS = new Set([
  'made', 'missed', 'blocked', 'fouled', 'stolen', 'turnover', 'deflected',
]);
const READ_TERMINALS = new Set(['end_made', 'end_turnover', 'rebound_battle', 'free_throws']);
// Map a read type → the defensive-scheme strength/weakness tokens it exploits.
const READ_SCHEME_TOKENS = {
  three: ['spot_up', 'corner_three', 'three_point', 'wing_three', 'skip_pass', 'open_shooter'],
  kick: ['spot_up', 'corner_three', 'three_point', 'wing_three', 'skip_pass', 'open_shooter', 'motion'],
  rim: ['drive', 'transition', 'paint', 'pick_and_roll'],
  post: ['post_up', 'high_post'],
  mid: ['mid_range'],
};

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

// --- Ball-flight presentation (top-down court view) -------------------------
// Every shot appends keyframes for release → straight ground-line flight to
// the rim → result (swish shrink-through, or rim bounce back toward
// halfcourt). The court renders overhead, so apex "height" is a 0..1 scale
// factor the renderer uses to swell the ball toward the camera mid-flight —
// never a screen-space offset. Real-shot grounding: ~2-2.5 rev/s backspin,
// 45-52° launch, and backspin braking rim contact so misses rebound softly
// back toward the court.
const RIM_POS = { x: 0.5, y: 0.836 }; // rendered rim center (courtConfig)
const SHOT_FLIGHT_BASE_S = 0.45;
const SHOT_FLIGHT_PER_DIST_S = 0.6;   // per normalized court unit of distance
const SHOT_HEIGHT_BASE = 0.35;
const SHOT_HEIGHT_PER_DIST = 0.9;     // longer shot = higher apex (clamped 1)
const SWISH_THROUGH_S = 0.28;         // swishes drop near-vertically → pure scale-down
const MISS_BOUNCE_S = 0.5;
const MISS_BOUNCE_HEIGHT = 0.15;      // one soft hop (backspin brakes the ricochet)
const FT_FLIGHT_S = 0.6;
const BLOCK_DEFLECT_S = 0.3;
const PASS_FLIGHT_HEIGHT = 0.15;      // chest passes stay low

// --- Free-throw formation (real NBA geometry, offense-only rendering) ------
// The shooter stands at the center of the FT line (19ft from baseline →
// y≈0.45 in courtConfig terms — the old {0.5, 0.75} spot was far too close
// to the rim). Teammates take lane spots along the key edges (x 0.34/0.66),
// bigs at the low spots nearest the basket like real rebounders. Defenders
// aren't rendered on this court, so the formation is shooter + 4 teammates.
const FT_LINE_POS = { x: 0.5, y: 0.45 };
const FT_LANE_SPOTS = [
  { x: 0.31, y: 0.72 },  // left low   (best rebounder)
  { x: 0.69, y: 0.72 },  // right low  (second big)
  { x: 0.31, y: 0.56 },  // left mid
  { x: 0.69, y: 0.56 },  // right mid
];
const FT_SETUP_S = 0.9;  // walk into formation
const FT_SET_S = 0.6;    // dribble/set before each attempt
// Lane-spot priority: bigs closest to the basket.
const FT_REBOUND_PRIORITY = { C: 0, PF: 1, SF: 2, SG: 3, PG: 4 };

// --- Play-by-play commentary template pools ---------------------------------
// Every entry is a translation TEMPLATE ({token} placeholders, no player names
// baked in) interpolated via T() after a variant is picked. The `*_TPLS`
// naming is load-bearing: wl-i18n.config.js regex-extracts the quoted strings
// of these const blocks (plus direct quoted first args of T calls).

// Shot narration keyed by shotType (threePoint / midRange / paint / default).
const SHOT_RELEASE_TPLS = {
  threePoint: '{name} puts up the three-pointer...',
  midRange: '{name} puts up the mid-range jumper...',
  paint: '{name} puts up the shot at the rim...',
  default: '{name} puts up the shot...',
};
const SHOT_FOULED_TPLS = {
  threePoint: '{name} is fouled on the three-pointer',
  midRange: '{name} is fouled on the mid-range jumper',
  paint: '{name} is fouled on the shot at the rim',
  default: '{name} is fouled on the shot',
};
const SHOT_TAKE_TPLS = {
  threePoint: '{name} takes a three-pointer',
  midRange: '{name} takes a mid-range jumper',
  paint: '{name} takes a shot at the rim',
  default: '{name} takes a shot',
};

// Scheme-aware blocked-shot variants ({def} = blocker, {shooter} = victim).
const BLOCK_TPLS = {
  man: [
    "{def} swats {shooter}'s shot away!",
    '{def} rejects {shooter} at the rim!',
  ],
  zone_2_3: [
    '{def} collapses out of the 2-3 zone for the block!',
    '{def} walls off the paint and blocks {shooter}!',
  ],
  zone_3_2: [
    '{def} rotates from the 3-2 zone for the block!',
    "{shooter}'s shot is sent back by {def}!",
  ],
  zone_1_3_1: [
    '{def} gets the block out of the 1-3-1!',
    'Weak side help — {def} with the rejection!',
  ],
  press: [
    "{shooter}'s rushed shot is blocked by {def}!",
    '{def} rejects the contested attempt!',
  ],
  trap: [
    '{def} blocks it out of the double team!',
    '{shooter} gets trapped — {def} with the block!',
  ],
  default: [
    "{def} blocks {shooter}'s shot!",
    '{def} with the rejection!',
  ],
};

// Scheme-aware live-ball steal variants ({def} = defender, {victim} = loser).
const STEAL_TPLS = {
  man: [
    "{def} picks {victim}'s pocket!",
    "{def}'s tight man pressure forces the steal!",
    '{victim} coughs it up — {def} takes it away!',
  ],
  zone_2_3: [
    '{def} reads the pass from the 2-3 zone and picks it off!',
    '{def} jumps the lane out of the zone — steal!',
  ],
  zone_3_2: [
    '{def} picks off the pass from the 3-2 zone!',
    'Quick hands by {def} in the zone — turnover!',
  ],
  zone_1_3_1: [
    '{def} springs the 1-3-1 trap and comes up with it!',
    '{victim} is caught in the 1-3-1 — {def} steals it!',
  ],
  press: [
    '{def} turns the press into a steal!',
    "{victim} can't handle the pressure — {def} takes it!",
  ],
  trap: [
    '{def} strips it out of the double team!',
    '{victim} is suffocated by the trap — {def} with the steal!',
  ],
  default: [
    '{def} strips {victim} — steal!',
    '{def} takes it away from {victim}!',
  ],
};

// Dead-ball violation variants keyed by the rolled violation kind.
const VIOLATION_TPLS = {
  travel: [
    '{name} travels!',
    '{name} shuffles his feet — traveling!',
  ],
  bad_pass_oob: [
    "{name}'s pass sails out of bounds!",
    '{name} throws it away — out of bounds!',
  ],
  lost_ball_oob: [
    '{name} loses the handle and the ball rolls out of bounds!',
    '{name} fumbles it out of bounds!',
  ],
  offensive_foul: [
    '{name} charges into the defender — offensive foul!',
    '{name} bowls over his man! Offensive foul.',
  ],
  double_dribble: [
    '{name} picks up his dribble... and puts it down again! Double dribble.',
  ],
};

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
    // Defensive matchups (persisted per possession). `matchups` is offId→defId
    // for man-family schemes; `zoneAnchors` is [{defId,x,y}] for zone/box; for
    // box-and-one, `chaser` is { offId, defId } (man-locks the star).
    this.matchups = {};
    this.zoneAnchors = null;
    this.chaser = null;
    this.defenseFamily = 'man';
    this.lastOnBallDefenderId = null;
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
    // Game-state context for read steering (which option the offense reads into).
    this.shotClock = options.shotClock ?? 24;
    this.scoreDifferential = options.scoreDifferential ?? 0;
    // 'home' | 'away' — used to look up the offense's momentum value on the
    // shared gameSimulator during shot-probability calculation.
    this.offensiveTeamSide = options.offensiveTeamSide ?? null;
    // Foul model context: whether the defense is in the penalty (team fouls
    // >= 5 this quarter), so non-shooting fouls award 2 free throws.
    this.foulContext = options.foulContext ?? {};

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

    // Assign the defensive matchups for this possession (scheme-aware + any
    // user override map). Persisted on `this` and updated as the play unfolds.
    this._defenseLineup = defensiveLineup;
    this.initMatchups(offensiveLineup, defensiveLineup, options.defensiveMatchups);

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
        this.handleEndState(outcome, action, offensiveLineup);
        break;
      }

      if (outcome.next === 'rebound_battle') {
        this.handleReboundBattle(offensiveLineup, defensiveLineup);
        break;
      }

      if (outcome.next === 'free_throws') {
        // The whistle is the dead ball — the play ends HERE and the free
        // throws run as their own segments (GameSimulator shoots them via
        // executeFreeThrowAttempt), so paced modes get a break BEFORE the
        // first attempt and between attempts, like real basketball.
        this.playResult.outcome = 'foul';
        this.playResult.points = 0;
        this.playResult.deadBall = true;
        this.playResult.offenseRetains = true;
        this.playResult.pendingFreeThrows = {
          shooterId: this.ballCarrierId ?? null,
          attempts: this._ftCountForAction(action),
        };
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

    // Apply movement first so zone/area "pick-up" resolves against the actor's
    // position at this moment in the play.
    if (action.movement) {
      this.applyMovement(action.movement, offensiveLineup);
    }

    // A screen can switch the on-ball matchup (always for switch-everything, a
    // chance in man, never in drop/zone/box) — creating the realistic mismatch.
    if (action.type === 'screen') {
      this.maybeSwitchOnScreen(actor, offensiveLineup);
    }

    // Resolve the CURRENT defender on this actor (scheme-aware + persisted).
    const defender = this.resolveDefender(actor);

    // Accumulate fatigue per action. Cost defaults to 0.5 — heavier actions
    // can override via `action.fatigueCost`. Tireless badges and high
    // `durability` reduce the increment.
    this.accumulateFatigue(action, actor, defender);

    // Defensive disruption gamble (failed-gamble foul model): on ball-moving
    // actions the defender may attempt a deflection. Success tips the ball
    // out of bounds (dead ball, offense retains); failure risks a reach-in
    // foul. Resolves BEFORE the authored outcome graph — a disruption ends
    // the play at this action.
    const disruption = this._attemptDisruption(action, actor, defender);
    if (disruption) {
      this.elapsedTime += action.duration ?? 1.0;
      return disruption;
    }

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
      // Fatigue bites on the defensive end too: a gassed defender gives up
      // more. Scale the rating by the same fatigue modifier the shooter's make
      // probability uses (returns ~0.74–1.0), so a tired defender lowers the
      // matchup's defensive resistance → the offense's advantage rises.
      defenseRating *= this.gameSimulator?.calculateFatigueModifier?.(defender) ?? 1;
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
    // (zero for away). Scales with the home team's fandom meter (band
    // 0.010–0.030, incl. a small morale bump). See
    // GameSimulator.calculateHomeCourtAdvantage / FandomService.
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
            // Disciplined contests foul less (mirrors the failed-gamble
            // model's use of defensiveConsistency on the floor).
            const defConsistency = this.getPlayerAttribute(defender, 'defensiveConsistency') ?? 50;
            adjustedProbability -= (defConsistency - 50) / 250;
          }
        }
      }

      // Apply action-specific modifier
      adjustedProbability += modifier;

      // Defense/matchup/clock-aware READ steering. Only applies to BRANCH
      // outcomes (those that advance to another real action) — i.e. which
      // option the offense reads into. Shot RESULTS (made/missed/blocked/
      // fouled/stolen/turnover) and terminals are never steered here, so the
      // (already-tuned) shot-quality math is untouched. The offense leans
      // toward reads the defense concedes, the matchup favors, or the clock
      // demands. Multiplier is modest and bounded by the deviation cap below.
      const isReadBranch =
        outcome.next &&
        !READ_TERMINALS.has(outcome.next) &&
        !RESULT_OUTCOME_KEYS.has(key);
      if (isReadBranch) {
        adjustedProbability *= this.readSteerMultiplier(play, outcome.next, advantage);
      }

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
   * Classify the "read" a branch represents by its destination action, so read
   * selection can be steered by the defense/matchup. Returns null for branches
   * that aren't a clear scoring read (e.g. a setup/screen leading nowhere yet).
   */
  classifyRead(play, nextId) {
    const b = this.findAction(play, nextId);
    if (!b) return null;
    if (b.type === 'shot') {
      if (b.shotType === 'threePoint') return 'three';
      if (b.shotType === 'midRange') return 'mid';
      return 'rim';
    }
    if (b.type === 'pass' || b.type === 'handoff') return 'kick';
    if (b.type === 'post') return 'post';
    if (b.type === 'drive' || b.type === 'cut') return 'rim';
    return null;
  }

  /**
   * Multiplier applied to a branch outcome's probability so the offense takes
   * what the defense gives: leans toward reads the defensive scheme is weak
   * against, the matchup favors, or the shot clock / score demands. Kept modest
   * (≈±25% per factor) and further bounded by the deviation cap in the caller.
   */
  readSteerMultiplier(play, nextId, advantage) {
    const readType = this.classifyRead(play, nextId);
    if (!readType) return 1;

    let m = 1;
    const tokens = READ_SCHEME_TOKENS[readType] || [];
    const scheme = DEFENSIVE_SCHEMES[this.defensiveScheme];
    if (scheme) {
      const weak = scheme.weaknesses || [];
      const strong = scheme.strengths || [];
      if (tokens.some((t) => weak.includes(t))) m *= 1.25;   // defense concedes this read
      if (tokens.some((t) => strong.includes(t))) m *= 0.8;  // defense takes it away
    }

    // Matchup: a clear offensive edge makes attacking the rim the better read.
    if (readType === 'rim') {
      m *= Math.max(0.8, Math.min(1.2, 1 + (advantage ?? 0) / 300));
    }

    // Late shot clock: force a direct shot, stop swinging the ball.
    if ((this.shotClock ?? 24) < 8) {
      if (readType === 'three' || readType === 'mid' || readType === 'rim') m *= 1.2;
      if (readType === 'kick') m *= 0.7;
    }

    // Trailing big: chase threes.
    if ((this.scoreDifferential ?? 0) < -10 && readType === 'three') m *= 1.2;

    return m;
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

  // ---------------------------------------------------------------------
  // Defensive disruption (failed-gamble foul model)
  // ---------------------------------------------------------------------

  /**
   * Roll a defensive disruption attempt on a ball-moving action.
   *
   * Model: the defender's `steal` attribute (plus steal-family badges) drives
   * how OFTEN they gamble. Each gamble then resolves by matchup quality:
   *   - success → deflection out of bounds (dead ball, offense retains)
   *   - failure → foul roll, reduced by the defender's `defensiveConsistency`
   *     (disciplined gamblers recover cleanly) and raised when the defender
   *     is outmatched (desperation reach); remainder is a no-call.
   *
   * Families: 'pass'/'handoff' use the passing-lane mix (passPerception/
   * steal/helpDefenseIQ vs passAccuracy/passIQ, interceptor vs
   * needle_threader); 'drive' maps to the dribble badge contract
   * (perimeterDefense/steal vs ballHandling/strength, pick_pocket + clamps
   * vs unpluckable / tight_handles / strong_handle).
   *
   * Returns a sentinel outcome ({ next: 'end_deflection' | 'end_foul' }) with
   * playResult already stamped, or null when nothing happens.
   */
  _attemptDisruption(action, actor, defender) {
    if (!defender || !actor) return null;
    const type = action.type;
    const isPassFamily = type === 'pass' || type === 'handoff';
    const isDriveFamily = type === 'drive';
    if (!isPassFamily && !isDriveFamily) return null;

    const defEffects = aggregateBadgeEffects(defender, BADGE_DEFINITIONS);
    const offEffects = aggregateBadgeEffects(actor, BADGE_DEFINITIONS);

    // --- Attempt frequency: aggression scales with `steal` + gamble badges.
    const stealAttr = this.getPlayerAttribute(defender, 'steal') ?? 50;
    let defBadgeSum;
    let baseRate;
    if (isPassFamily) {
      baseRate = 0.04;
      defBadgeSum = defEffects.stealChanceBoost || 0;
    } else {
      baseRate = 0.06;
      defBadgeSum = (defEffects.onBallStealBoost || 0) + (defEffects.perimeterDefBoost || 0);
    }
    const attemptMult = Math.max(0.4, Math.min(2.2, 1 + (stealAttr - 50) / 100 + defBadgeSum));
    if (Math.random() >= baseRate * attemptMult) return null;

    // --- Attempt resolution: matchup quality decides deflection vs risk.
    let defScore, offScore, offBadgeSum;
    if (isPassFamily) {
      defScore = this.calculateAttributeRating(defender, ['passPerception', 'steal', 'helpDefenseIQ']);
      offScore = this.calculateAttributeRating(actor, ['passAccuracy', 'passIQ']);
      offBadgeSum = offEffects.tightPassBoost || 0;
    } else {
      defScore = this.calculateAttributeRating(defender, ['perimeterDefense', 'steal']);
      offScore = this.calculateAttributeRating(actor, ['ballHandling', 'strength']);
      offBadgeSum = (offEffects.stripResistance || 0) + (offEffects.ballSecurityBoost || 0);
    }
    const successChance = Math.max(0.10, Math.min(0.65,
      0.28 + (defScore - offScore) / 150 + defBadgeSum * 0.5 - offBadgeSum
    ));

    if (Math.random() < successChance) {
      // Deflected out of bounds — offense retains, clock event, dead ball.
      this.playResult.deflection = {
        byId: defender.id ?? null,
        onId: actor.id ?? null,
        actionId: action.id,
      };
      this.playResult.outcome = 'deflected';
      this.playResult.points = 0;
      this.playResult.offenseRetains = true;
      this.playResult.deadBall = true;
      this._recordDisruptionKeyframe(action, actor, defender, 'deflection');
      return { next: 'end_deflection', key: 'deflected' };
    }

    // Failed gamble → foul roll. Disciplined defenders recover; beaten
    // defenders reach in desperation.
    const defConsistency = this.getPlayerAttribute(defender, 'defensiveConsistency') ?? 50;
    let foulChance = Math.max(0.2, Math.min(0.75, 0.55 - (defConsistency - 50) / 200));
    foulChance += Math.max(0, Math.min(0.1, (offScore - defScore) / 400));
    if (Math.random() >= foulChance) return null; // clean recovery, play on

    this.playResult.foul = {
      type: 'reach_in',
      byId: defender.id ?? null,
      onId: actor.id ?? null,
    };
    this.playResult.deadBall = true;
    this._recordDisruptionKeyframe(action, actor, defender, 'foul');

    this.playResult.outcome = 'foul';
    this.playResult.points = 0;
    this.playResult.offenseRetains = true;
    if (this.foulContext?.defenseInPenalty) {
      // In the penalty: ball-handler shoots two — as separate segments
      // after the whistle break, same as shooting fouls.
      this.playResult.pendingFreeThrows = {
        shooterId: actor.id ?? null,
        attempts: 2,
      };
    }
    return { next: 'end_foul', key: 'fouled' };
  }

  /**
   * Snap the offense into the real FT formation: shooter at the line,
   * teammates onto the lane spots (bigs get the low spots nearest the
   * basket).
   */
  _setFreeThrowFormation(shooter, offensiveLineup) {
    if (shooter.id != null) {
      this.playerPositions[shooter.id] = { x: FT_LINE_POS.x, y: FT_LINE_POS.y };
      this.ballCarrierId = shooter.id;
    }
    const teammates = offensiveLineup
      .filter(p => p && p.id != null && p.id !== shooter.id)
      .sort((a, b) =>
        (FT_REBOUND_PRIORITY[a.position] ?? 5) - (FT_REBOUND_PRIORITY[b.position] ?? 5)
      );
    teammates.slice(0, FT_LANE_SPOTS.length).forEach((p, i) => {
      this.playerPositions[p.id] = { x: FT_LANE_SPOTS[i].x, y: FT_LANE_SPOTS[i].y };
    });
  }

  /**
   * Execute ONE free-throw attempt as its own standalone play/segment. The
   * foul play ended at the whistle with `pendingFreeThrows`; GameSimulator
   * calls this once per attempt so paced modes get a break BEFORE the
   * first shot and between shots (real dead-ball rhythm — subs made at
   * those breaks genuinely apply because each attempt re-reads the lineup).
   *
   * Rolls the make here, presents formation → set → flight → result, and
   * returns a playResult-shaped object (points/freeThrows for exactly this
   * attempt; ctx.playId keeps play-analytics attribution on the play that
   * drew the foul).
   */
  executeFreeThrowAttempt(shooter, offensiveLineup, ctx = {}) {
    const attemptNo = ctx.attemptNo ?? 1;
    const totalAttempts = ctx.totalAttempts ?? 1;
    const isFinal = attemptNo >= totalAttempts;
    const name = this._lastNameOf(shooter);

    this.resetState();
    offensiveLineup.forEach((player, index) => {
      const playerId = String(player.id ?? '');
      if (playerId) this.playerLineupIndices[playerId] = index;
    });

    // Formation is in place from frame one — each attempt is its own
    // animation possession, and possession starts already snap positions.
    this._setFreeThrowFormation(shooter, offensiveLineup);

    const ftRating = shooter.attributes?.offense?.freeThrow ?? 70;
    const made = Math.random() < ftRating / 100;

    this._appendBallKeyframe(
      { ...FT_LINE_POS },
      T('{name} at the line ({attemptNo} of {totalAttempts})', { name, attemptNo, totalAttempts })
    );
    this.elapsedTime += FT_SET_S;
    this._appendBallKeyframe(
      { ...FT_LINE_POS },
      T('{name} shoots free throw {attemptNo} of {totalAttempts}...', { name, attemptNo, totalAttempts })
    );

    this._appendShotResultKeyframes(made ? 'made' : 'missed', {
      from: FT_LINE_POS,
      flightS: FT_FLIGHT_S,
      shortBounce: !isFinal,
      label: made
        ? T('{name} makes free throw {attemptNo} of {totalAttempts}', { name, attemptNo, totalAttempts })
        : T('{name} misses free throw {attemptNo} of {totalAttempts}', { name, attemptNo, totalAttempts }),
    });

    this.playResult.outcome = 'free_throws';
    this.playResult.points = made ? 1 : 0;
    this.playResult.freeThrows = {
      made: made ? 1 : 0,
      attempted: 1,
      shooterId: shooter.id ?? null,
      attemptNo,
      totalAttempts,
    };
    this.playResult.deadBall = true;
    this.playResult.offenseRetains = !isFinal;

    return this.buildPlayResult({
      id: ctx.playId ?? 'free_throw',
      name: ctx.playName ?? 'Free Throw',
      category: 'free_throw',
    });
  }

  /**
   * Keyframe for a disruption event (deflection or reach-in foul) so the
   * animation and play-by-play show it at the action where it happened.
   */
  _recordDisruptionKeyframe(action, actor, defender, kind) {
    const defName = this._lastNameOf(defender, 'Defender');
    const actorName = this._lastNameOf(actor);
    const desc = kind === 'deflection'
      ? T('{def} tips the ball out of bounds!', { def: defName })
      : T('{def} is called for a reach-in foul on {name}', { def: defName, name: actorName });

    const keyframe = {
      time: this.elapsedTime,
      positions: this.buildPositionsSnapshot(),
      ball: this.ballCarrierId
        ? (this.playerPositions[this.ballCarrierId] ?? { x: 0.5, y: 0.5 })
        : { x: 0.5, y: 0.5 },
      action: action.id,
      actionType: action.type,
      outcome: kind === 'deflection' ? 'deflected' : 'fouled',
      description: desc.text,
      descTpl: desc.tpl,
      descParams: desc.params,
      defensive_scheme: this.defensiveScheme,
      matchups: { ...this.matchups },
      onBallDefenderId: this.lastOnBallDefenderId,
      // Both disruption results are whistle moments: the reach-in call and
      // the ball tipped out of bounds (side out, offense retains).
      sfx: 'foul_whistle',
    };
    if (kind === 'deflection') {
      keyframe.defensive_play = true;
    }
    this.keyframes.push(keyframe);
  }

  /**
   * Free-throw count for a shooting foul: 3 when fouled on a missed three,
   * otherwise 2 (drives / twos / generic free_throws terminals).
   */
  _ftCountForAction(action) {
    return action?.type === 'shot' && action?.shotType === 'threePoint' ? 3 : 2;
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
    const desc = T('Setting up play');
    this.keyframes.push({
      time: 0,
      positions: this.buildPositionsSnapshot(),
      ball: this.ballCarrierId ? this.playerPositions[this.ballCarrierId] : { x: 0.5, y: 0.5 },
      action: 'formation',
      description: desc.text,
      descTpl: desc.tpl,
      descParams: desc.params,
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
   * Get matching defender for a player (legacy fallback — exact position match).
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

  /** Look up an on-court player by id within a lineup. */
  getPlayerById(id, lineup) {
    if (id == null || !lineup) return null;
    const sid = String(id);
    return lineup.find((p) => String(p.id ?? '') === sid) ?? null;
  }

  /**
   * Display name for play descriptions — LAST name (broadcast style),
   * falling back to first name, then a generic label.
   */
  _lastNameOf(player, fallback = 'Player') {
    return (
      player?.last_name ?? player?.lastName ??
      player?.first_name ?? player?.firstName ??
      fallback
    );
  }

  /**
   * The defender credited with a defensive play on `actor`: the current
   * on-ball defender when known, else the actor's assigned matchup.
   */
  _creditedDefender(actor) {
    const def = this.lastOnBallDefenderId != null
      ? this.getPlayerById(this.lastOnBallDefenderId, this._defenseLineup)
      : null;
    if (def) return def;
    const matchupId = actor?.id != null ? this.matchups[String(actor.id)] ?? this.matchups[actor.id] : null;
    return matchupId != null ? this.getPlayerById(matchupId, this._defenseLineup) : null;
  }

  /**
   * Build this possession's defensive assignment, by scheme family:
   *  man  → persistent offId→defId map (honoring any user overrides)
   *  zone → defender-to-area anchors (pick-up by location)
   *  box  → a man "chaser" on the star + 4 zone-box anchors
   */
  initMatchups(offensiveLineup, defensiveLineup, overrides = null) {
    this.defenseFamily = schemeFamily(this.defensiveScheme);
    this.matchups = {};
    this.zoneAnchors = null;
    this.chaser = null;

    if (this.defenseFamily === 'zone') {
      this.zoneAnchors = buildZoneAnchors(defensiveLineup, this.defensiveScheme);
    } else if (this.defenseFamily === 'box_one') {
      const { chaser, anchors } = assignBoxAndOne(offensiveLineup, defensiveLineup);
      this.chaser = chaser;
      this.zoneAnchors = anchors;
    } else {
      this.matchups = assignManMatchups(offensiveLineup, defensiveLineup, {
        overrides: overrides ?? null,
      });
    }
  }

  /**
   * The defender currently on `actor`, per the scheme. Stamps
   * `lastOnBallDefenderId` for keyframe exposure. Falls back to the legacy
   * position match if a lookup fails.
   */
  resolveDefender(actor) {
    const actorId = String(actor?.id ?? '');
    let defId = null;
    if (this.defenseFamily === 'man') {
      defId = this.matchups[actorId] ?? null;
    } else if (this.defenseFamily === 'box_one') {
      defId = (this.chaser && this.chaser.offId === actorId)
        ? this.chaser.defId
        : zoneDefenderId(this.zoneAnchors, this.playerPositions[actorId]);
    } else { // zone
      defId = zoneDefenderId(this.zoneAnchors, this.playerPositions[actorId]);
    }
    const def = defId ? this.getPlayerById(defId, this._defenseLineup) : null;
    const resolved = def ?? this.getMatchingDefender(actor, this._defenseLineup ?? []);
    this.lastOnBallDefenderId = resolved ? String(resolved.id ?? '') : null;
    return resolved;
  }

  /**
   * On a screen, possibly switch the on-ball defender with the screener's
   * defender (man family only). switch_everything always switches; man switches
   * with a probability driven by screen strength vs the defender's navigation;
   * drop coverage never switches.
   */
  maybeSwitchOnScreen(screener, offensiveLineup) {
    if (this.defenseFamily !== 'man') return;
    const ballHandler = this.getPlayerByRole('dynamic', offensiveLineup);
    const bId = String(ballHandler?.id ?? '');
    const sId = String(screener?.id ?? '');
    if (!bId || !sId || bId === sId) return;
    if (!(bId in this.matchups) || !(sId in this.matchups)) return;
    const onBallDef = this.getPlayerById(this.matchups[bId], this._defenseLineup);
    const chance = screenSwitchChance(this.defensiveScheme, screener, onBallDef);
    if (Math.random() < chance) {
      const tmp = this.matchups[bId];
      this.matchups[bId] = this.matchups[sId];
      this.matchups[sId] = tmp;
    }
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
    // T-object: `.text` is the interpolated English line; `.tpl`/`.params`
    // ride along so the UI can dictionary-translate at render time.
    const desc = this.generateDescription(action, actor, outcome);
    const outcomeKey = outcome.key ?? '';

    // Clone the ball position — the raw playerPositions entries are LIVE
    // objects that later movement mutates; sharing the reference would let
    // future actions rewrite past keyframes' ball positions. The clone is
    // also where per-segment flight flags (pass arc/spin queued by
    // processActionType) get attached: they describe the travel INTO this
    // keyframe, matching how the composable reads flight data from the
    // destination keyframe.
    const carrierPos = this.ballCarrierId
      ? (this.playerPositions[this.ballCarrierId] ?? { x: 0.5, y: 0.5 })
      : { x: 0.5, y: 0.5 };
    const ball = { x: carrierPos.x, y: carrierPos.y };
    if (this._pendingBallFlight) {
      Object.assign(ball, this._pendingBallFlight);
      this._pendingBallFlight = null;
    }

    const keyframe = {
      time: this.elapsedTime,
      positions: this.buildPositionsSnapshot(),
      ball,
      action: action.id,
      actionType: action.type,
      outcome: outcomeKey,
      description: desc.text,
      descTpl: desc.tpl,
      descParams: desc.params,
      // Always expose the defensive scheme + current matchups so we always know
      // who's guarding whom (and the scheme) at every moment of the possession.
      defensive_scheme: this.defensiveScheme,
      matchups: { ...this.matchups },
      onBallDefenderId: this.lastOnBallDefenderId,
    };

    // Add result info if this is a scoring action
    if (outcome.points !== undefined) {
      keyframe.result = {
        type: outcomeKey,
        points: outcome.points,
      };
    }

    // Flag defensive plays for frontend animations
    if (['blocked', 'stolen', 'turnover', 'deflected'].includes(outcomeKey)) {
      keyframe.defensive_play = true;
    }

    // Block contact happens AT this keyframe (the "swatted away!" text
    // moment) — the deflection keyframe 0.3s later is the ball LANDING,
    // too late for the swat sound. Every blocked outcome in plays.js routes
    // through a shot action, so this covers all blocks.
    if (outcomeKey === 'blocked' && action.type === 'shot') {
      keyframe.sfx = 'block';
    }

    // Whistle on the call — authored shooting/non-shooting fouls resolve at
    // this keyframe (its text announces the foul). Disruption fouls and
    // tip-out-of-bounds never reach here (early return); they get the
    // whistle in _recordDisruptionKeyframe.
    if (outcomeKey === 'fouled') {
      keyframe.sfx = 'foul_whistle';
    }

    // Steal — the pick-pocket happens at this keyframe (its text announces
    // it). Live ball: play flows on, no whistle.
    if (outcomeKey === 'stolen') {
      keyframe.sfx = 'steal';
    }

    // Generic turnovers are DEAD-BALL violations (travel, pass out of
    // bounds — mirrors _classifyPossessionEnd: outcome 'turnover' with
    // turnoverKind !== 'stolen' → violation), so the ref's whistle blows.
    // Steals stay whistle-free above: the ball never goes dead.
    if (outcomeKey === 'turnover') {
      keyframe.sfx = 'foul_whistle';
    }

    this.keyframes.push(keyframe);
  }

  /**
   * Push a presentation-only keyframe for ball flight/result moments (shot
   * release, rim arrival, swish-through, rim bounce). Uses the standard
   * keyframe shape so the renderer/interpolation treat it like any other.
   * `sfx` (optional) declares an event-sound key ('made_shot', later
   * 'foul_whistle' etc.) — GameView's keyframe watcher plays a random
   * variant from that event's pool when the keyframe becomes current.
   */
  _appendBallKeyframe(ball, description, sfx = null) {
    // `description` is either a commentaryTemplate T-object or '' (silent
    // presentation frames keep an empty string, no template).
    const desc = description && typeof description === 'object'
      ? description
      : { text: description || '', tpl: null, params: null };
    const keyframe = {
      time: this.elapsedTime,
      positions: this.buildPositionsSnapshot(),
      ball,
      action: 'ball_flight',
      actionType: 'ball_flight',
      outcome: '',
      description: desc.text,
      defensive_scheme: this.defensiveScheme,
      matchups: { ...this.matchups },
      onBallDefenderId: this.lastOnBallDefenderId,
    };
    if (desc.tpl) {
      keyframe.descTpl = desc.tpl;
      keyframe.descParams = desc.params;
    }
    if (sfx) keyframe.sfx = sfx;
    this.keyframes.push(keyframe);
  }

  /** Current ball position as a safe clone (falls back to court center). */
  _currentBallPosition() {
    const pos = this.ballCarrierId
      ? (this.playerPositions[this.ballCarrierId] ?? { x: 0.5, y: 0.5 })
      : { x: 0.5, y: 0.5 };
    return { x: pos.x, y: pos.y };
  }

  /**
   * Append the shot-result presentation: release → flight to the rim →
   * swish-through (made) or a soft rim bounce back toward halfcourt
   * (missed). Advances elapsedTime so playResult.duration covers the whole
   * sequence — this is what makes the animation WAIT for the make/miss.
   *
   * kind: 'made' | 'missed'
   * opts.from     — release point (defaults to current ball carrier)
   * opts.flightS  — override flight time (free throws use a fixed value)
   * opts.label    — description for the flight keyframe
   * Returns the ball's final position so follow-up keyframes (rebound
   * scramble) can continue FROM the landing spot instead of snapping back.
   */
  _appendShotResultKeyframes(kind, opts = {}) {
    const from = opts.from ?? this._currentBallPosition();
    const dist = Math.hypot(RIM_POS.x - from.x, RIM_POS.y - from.y);
    const flightS = opts.flightS ?? (SHOT_FLIGHT_BASE_S + dist * SHOT_FLIGHT_PER_DIST_S);
    const height = Math.min(1, SHOT_HEIGHT_BASE + dist * SHOT_HEIGHT_PER_DIST);

    // Release: ball leaves the shooter's hands from where they stand.
    this._appendBallKeyframe({ x: from.x, y: from.y }, T('The shot is up...'));

    // Flight to the rim. Spin + apex height ride the DESTINATION keyframe
    // (the composable reads flight data from the segment's end keyframe).
    // Spin stops here on arrival — the keyframes after this carry no spin.
    // The sound cue rides this keyframe too: it becomes current at the
    // exact moment the ball meets the rim — swish on a make, clank on a
    // miss (covers field goals AND free throws; blocks never reach here).
    this.elapsedTime += flightS;
    this._appendBallKeyframe(
      { ...RIM_POS, inFlight: true, height, spin: 'shot' },
      opts.label ?? (kind === 'made' ? T('It falls through!') : T('Off the rim!')),
      kind === 'made' ? 'made_shot' : 'missed_shot'
    );

    if (kind === 'made') {
      // Swish: hold on the rim while the renderer shrinks/fades the ball
      // down through the net (away from the top-down camera). No
      // description — the flight keyframe already announced the make; a
      // second line here spammed the ticker on every made shot. Carries
      // the crowd-cheer cue: this keyframe becomes current ~0.28s after
      // the rim-arrival swish sound, so the crowd swells right after the
      // net rips.
      this.elapsedTime += SWISH_THROUGH_S;
      this._appendBallKeyframe({ ...RIM_POS, through: true }, '', 'crowd_cheer');
      return { ...RIM_POS };
    }

    // Miss: one soft ground-plane hop back toward halfcourt at a random
    // angle (backspin brakes the ricochet, so it comes back into play).
    // No description — the flight keyframe already narrated the miss and
    // a second line here spammed the ticker on every missed shot.
    // opts.shortBounce: dead-ball misses (non-final free throws — the ref
    // retrieves the ball) barely leave the rim instead of scattering.
    const landing = opts.shortBounce
      ? {
          x: Math.min(0.95, Math.max(0.05, 0.5 + (Math.random() * 0.16 - 0.08))),
          y: RIM_POS.y - (0.04 + Math.random() * 0.06),
        }
      : {
          x: Math.min(0.95, Math.max(0.05, 0.5 + (Math.random() * 0.44 - 0.22))),
          y: RIM_POS.y - (0.10 + Math.random() * 0.18),
        };
    this.elapsedTime += opts.shortBounce ? MISS_BOUNCE_S * 0.6 : MISS_BOUNCE_S;
    this._appendBallKeyframe(
      { ...landing, inFlight: true, height: MISS_BOUNCE_HEIGHT },
      ''
    );
    return landing;
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
   * Generate human-readable description. Returns a commentaryTemplate
   * T-object ({ text, tpl, params }) so keyframes carry both the English
   * line and its translatable template.
   */
  generateDescription(action, actor, outcome) {
    const name = this._lastNameOf(actor);
    const outcomeKey = outcome.key ?? '';

    // Handle special defensive outcomes. Steals are LIVE-ball (play flows,
    // steal credited); generic turnovers are DEAD-ball violations — narrate
    // the concrete violation (travel / OOB / offensive foul), never steal
    // language, so presentation matches the whistle + stoppage.
    if (outcomeKey === 'stolen') {
      return this.getStealDescription(actor);
    }
    if (outcomeKey === 'turnover') {
      return this.getViolationDescription(action, actor);
    }

    switch (action.type) {
      case 'screen':
        return T('{name} sets a screen', { name });
      case 'pass':
        return T('{name} passes the ball', { name });
      case 'drive':
        return T('{name} drives to the basket', { name });
      case 'shot':
        return this.getShotDescription(action, actor, outcome);
      case 'decision':
        return T('{name} reads the defense', { name });
      case 'cut':
        return T('{name} cuts to the basket', { name });
      case 'setup':
        return T('{name} sets up the play', { name });
      case 'post':
        return T('{name} works in the post', { name });
      case 'handoff':
        return T('{name} executes a handoff', { name });
      case 'reset':
        return T('Resetting the offense');
      default:
        return T('{name} executes play action', { name });
    }
  }

  /**
   * Get shot description based on outcome. Templates live in the
   * shot-type-keyed `SHOT_*_TPLS` pools above.
   */
  getShotDescription(action, actor, outcome) {
    const name = this._lastNameOf(actor);
    const shotType = action.shotType ?? 'default';
    const tplFor = (pool) => pool[shotType] ?? pool.default;

    // Made/missed shots get the SAME neutral release line — the result is
    // narrated by the flight keyframes when the ball actually reaches the
    // rim ("It falls through!" / "Off the rim!"). Announcing it here spoiled
    // the outcome on screen before the flight animation played. Blocks and
    // fouls resolve AT the release, so their text stays immediate. The
    // play-by-play feed rebuilds its "makes/misses" line from the play
    // result (GameSimulator.recordPlayByPlay), not from this keyframe.
    if (outcome.key === 'made' || outcome.key === 'missed') {
      return T(tplFor(SHOT_RELEASE_TPLS), { name });
    } else if (outcome.key === 'blocked') {
      return this.getBlockedDescription(actor);
    } else if (outcome.key === 'fouled') {
      return T(tplFor(SHOT_FOULED_TPLS), { name });
    }

    return T(tplFor(SHOT_TAKE_TPLS), { name });
  }

  /**
   * Scheme-aware description for blocked shots — names the BLOCKER (the
   * contesting on-ball defender). The same defender is stamped on
   * playResult.blockedById so the box-score block credit matches the call.
   */
  getBlockedDescription(actor) {
    const shooterName = this._lastNameOf(actor);
    const blocker = this._creditedDefender(actor);
    const def = this._lastNameOf(blocker, 'The defender');

    // Keep narration and stats in sync: the narrated blocker gets the credit.
    if (blocker?.id != null) {
      this.playResult.blockedById = blocker.id;
    }

    const templates = BLOCK_TPLS[this.defensiveScheme] ?? BLOCK_TPLS.default;
    const pick = templates[Math.floor(Math.random() * templates.length)];
    return T(pick, { def, shooter: shooterName });
  }

  /**
   * Dead-ball violation for a generic `turnover` outcome. Rolls ONE concrete
   * violation kind per play (memoized on playResult.turnoverViolation),
   * context-aware by the action it fired on, with weights derived from the
   * real NBA dead-ball turnover distribution (2018-19: offensive foul 36%,
   * bad pass OOB 30%, traveling 19%, lost ball OOB 15% of the main four).
   * Offensive fouls also stamp playResult.foul (type 'offensive') so the
   * simulator books the personal foul on the OFFENDER — NBA rules: counts
   * as a personal (can foul out), does NOT count toward the team-foul
   * penalty, never awards free throws.
   */
  getViolationDescription(action, actor) {
    const name = this._lastNameOf(actor);

    if (!this.playResult.turnoverViolation) {
      const type = action?.type ?? '';
      let weights;
      if (type === 'pass' || type === 'handoff') {
        // Errant delivery dominates; charges/illegal screens spring some.
        weights = { bad_pass_oob: 0.65, offensive_foul: 0.2, travel: 0.15 };
      } else if (type === 'drive') {
        // Attacking downhill: charges and shuffled feet.
        weights = { offensive_foul: 0.4, travel: 0.3, lost_ball_oob: 0.3 };
      } else if (type === 'post') {
        // Back-downs: over-aggressive seals and pivot-foot slips.
        weights = { offensive_foul: 0.45, travel: 0.35, lost_ball_oob: 0.2 };
      } else {
        // Global NBA mix for everything else.
        weights = { offensive_foul: 0.36, bad_pass_oob: 0.3, travel: 0.19, lost_ball_oob: 0.1, double_dribble: 0.05 };
      }

      let roll = Math.random();
      let kind = 'travel';
      for (const [k, w] of Object.entries(weights)) {
        roll -= w;
        if (roll <= 0) { kind = k; break; }
      }
      this.playResult.turnoverViolation = kind;

      if (kind === 'offensive_foul') {
        this.playResult.foul = {
          type: 'offensive',
          byId: actor?.id ?? null,
          onId: this.lastOnBallDefenderId ?? null,
        };
        this.playResult.deadBall = true;
      }
    }

    const variants = VIOLATION_TPLS[this.playResult.turnoverViolation] || VIOLATION_TPLS.travel;
    const pick = variants[Math.floor(Math.random() * variants.length)];
    return T(pick, { name });
  }

  /**
   * Scheme-aware description for LIVE-ball steals (`stolen` outcomes) —
   * always names the DEFENDER who made the play (the on-ball defender,
   * i.e. the same player credited with the steal via stolenById).
   */
  getStealDescription(actor) {
    const victim = this._lastNameOf(actor);
    const defender = this._creditedDefender(actor);
    const def = this._lastNameOf(defender, 'The defender');

    const templates = STEAL_TPLS[this.defensiveScheme] ?? STEAL_TPLS.default;
    const pick = templates[Math.floor(Math.random() * templates.length)];
    return T(pick, { def, victim });
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
      // Flight flags for the NEXT keyframe (ball at the receiver): the
      // travel into it renders as a low arc with slow pass-spin that stops
      // at the catch.
      this._pendingBallFlight = { inFlight: true, height: PASS_FLIGHT_HEIGHT, spin: 'pass' };
    }

    // Handle handoff - track passer for assist attribution
    if (action.type === 'handoff' && outcome.key !== 'turnover') {
      this.playResult.lastPasserId = actor.id ?? null;
      this.playResult.dribblesSincePass = 0;
      const receiverRole = action.receiver ?? null;
      if (receiverRole && receiverRole in this.roleAssignments) {
        this.ballCarrierId = this.roleAssignments[receiverRole];
      }
      // Handoffs are point-blank exchanges — brief spin, no visible arc.
      this._pendingBallFlight = { inFlight: true, height: 0, spin: 'pass' };
    }

    // Drives count as ball-handling between a catch and a shot. Only count
    // them once we've actually seen a pass (otherwise undefined → NaN-ish
    // accumulation from a fresh play start). If `dribblesSincePass` is null
    // there hasn't been a pass yet on this play, so don't track.
    if (action.type === 'drive' && this.playResult.dribblesSincePass != null) {
      this.playResult.dribblesSincePass += 1;
    }

    // Steal attribution: the on-ball defender at the moment of the `stolen`
    // outcome forced it — stamped so GameSimulator credits the right player
    // instead of a random defender. `turnoverKind` distinguishes live-ball
    // steals (transition) from dead-ball violations for break classification.
    if (outcome.key === 'stolen' || outcome.key === 'turnover') {
      this.playResult.turnoverKind = outcome.key;
      if (outcome.key === 'stolen') {
        this.playResult.stolenById = this.lastOnBallDefenderId;
      }
    }

    // Shooting foul attribution (shot or drive resolving `fouled` → FTs).
    if ((action.type === 'shot' || action.type === 'drive') && outcome.key === 'fouled') {
      this.playResult.foul = {
        type: 'shooting',
        byId: this.lastOnBallDefenderId,
        onId: actor.id ?? null,
      };
      this.playResult.deadBall = true;
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

      // And-1 roll: contact finish on a made shot. Rim finishes draw far
      // more continuation contact than jumpers; drawFoul nudges the rate.
      if (outcome.key === 'made' && this.lastOnBallDefenderId) {
        const shotType = action.shotType ?? 'paint';
        const isRim = shotType === 'paint' || /dunk|layup/i.test(action.id ?? '');
        const drawFoul = this.getPlayerAttribute(actor, 'drawFoul') ?? 50;
        const andOneRate = (isRim ? 0.08 : 0.025) * (1 + (drawFoul - 50) / 200);
        if (Math.random() < andOneRate) {
          this.playResult.foul = {
            type: 'and_one',
            byId: this.lastOnBallDefenderId,
            onId: actor.id ?? null,
          };
          this.playResult.pendingAndOne = { shooterId: actor.id ?? null };
          this.playResult.deadBall = true;
        }
      }
    }
  }

  /**
   * Handle end states.
   */
  handleEndState(outcome, action, offensiveLineup = []) {
    const endType = outcome.next;

    if (endType === 'end_made') {
      this.playResult.outcome = 'made';
      this.playResult.points = outcome.points ?? 2;

      // Shot presentation: release → flight → through the net. Launches from
      // the current ball carrier's spot, so terminal makes from drives/cuts
      // (not just `shot` actions) get the full flight too.
      this._appendShotResultKeyframes('made');

      // And-1: shooter converted through contact — the basket counts here
      // and the free throw runs as its own segment after the dead-ball
      // break (its point/FT stats are credited by that attempt's result).
      const pending = this.playResult.pendingAndOne;
      if (pending) {
        delete this.playResult.pendingAndOne;
        this.playResult.pendingFreeThrows = {
          shooterId: pending.shooterId ?? null,
          attempts: 1,
        };
        // Whistle rides a beat after the swish-through — the ref signaling
        // the continuation foul while the crowd is still up. Ball state
        // repeats the through frame so nothing moves on screen.
        this.elapsedTime += 0.15;
        this._appendBallKeyframe({ ...RIM_POS, through: true }, '', 'foul_whistle');
      }
    } else if (endType === 'end_turnover') {
      this.playResult.outcome = 'turnover';
      this.playResult.points = 0;
    } else if (endType === 'end_deflection' || endType === 'end_foul') {
      // Disruption sentinels — playResult outcome/points/freeThrows were
      // already stamped by _attemptDisruption.
    } else {
      this.playResult.outcome = 'completed';
      this.playResult.points = outcome.points ?? 0;
    }
  }

  /**
   * Handle rebound battle.
   */
  handleReboundBattle(offensiveLineup, defensiveLineup) {
    // Present the attempt that precedes the battle. Blocked shots never
    // reach the rim — a short deflection near the shooter instead of the
    // full flight; everything else shows flight → rim bounce. Track where
    // the ball ENDS UP so the rebound is collected there, not dragged back
    // to a fixed spot in front of the hoop.
    let ballLanding
    if (this.playResult.shotAttempt?.blocked) {
      const from = this._currentBallPosition();
      ballLanding = {
        x: Math.min(0.95, Math.max(0.05, from.x + (Math.random() * 0.24 - 0.12))),
        y: Math.max(0.05, from.y - (0.05 + Math.random() * 0.15)),
      };
      this.elapsedTime += BLOCK_DEFLECT_S;
      this._appendBallKeyframe({ ...ballLanding }, T('Swatted away!'));
    } else {
      ballLanding = this._appendShotResultKeyframes('missed');
    }

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

    // Record rebound keyframe — advance elapsedTime so the scramble is
    // inside playResult.duration (previously stamped at duration + 0.5 and
    // never actually displayed). The board is grabbed WHERE the ball landed.
    this.elapsedTime += 0.5;
    this._appendBallKeyframe(
      { x: ballLanding.x, y: ballLanding.y },
      this.playResult.outcome === 'offensive_rebound'
        ? T('Offensive rebound!')
        : T('Defensive rebound')
    );
  }

  /**
   * Build final play result.
   */
  buildPlayResult(play) {
    // End-of-play breather: guarantee a hold between the final keyframe and
    // the end of the possession so every result LANDS before the next play
    // starts (interpolation freezes the last frame during the hold). The
    // hold is measured from the LAST KEYFRAME, not just appended — some
    // endings (turnovers) already carry an implicit tail from the final
    // action's duration, and stacking on top of it froze the court for 2s+.
    const outcome = this.playResult.outcome ?? 'completed'
    let targetHold
    if (outcome === 'missed' || outcome === 'offensive_rebound') {
      targetHold = 0.25 // the bounce + scramble already animated the beat
    } else if (outcome === 'made' || outcome === 'free_throws') {
      targetHold = 0.45 // beat after the ball drops through
    } else {
      targetHold = 1.0  // turnover / deflected / foul — static ending
    }
    const lastKfTime = this.keyframes.length > 0
      ? this.keyframes[this.keyframes.length - 1].time
      : this.elapsedTime

    return {
      playId: play.id,
      playName: play.name,
      category: play.category,
      outcome,
      points: this.playResult.points ?? 0,
      duration: Math.max(this.elapsedTime, lastKfTime + targetHold),
      shotAttempt: this.playResult.shotAttempt ?? null,
      freeThrows: this.playResult.freeThrows ?? null,
      lastPasserId: this.playResult.lastPasserId ?? null,
      // Foul / disruption model (all optional — absent on plain possessions)
      foul: this.playResult.foul ?? null,
      deflection: this.playResult.deflection ?? null,
      stolenById: this.playResult.stolenById ?? null,
      turnoverKind: this.playResult.turnoverKind ?? null,
      // Concrete dead-ball violation call (travel, bad_pass_oob, ...) rolled
      // by getViolationDescription for generic `turnover` outcomes.
      turnoverViolation: this.playResult.turnoverViolation ?? null,
      // The narrated blocker (getBlockedDescription) — box-score block
      // credit prefers this so the stat matches the call.
      blockedById: this.playResult.blockedById ?? null,
      offenseRetains: this.playResult.offenseRetains ?? false,
      deadBall: this.playResult.deadBall ?? false,
      // Free throws owed after this play (whistle ended it): GameSimulator
      // shoots them as separate segments via executeFreeThrowAttempt.
      pendingFreeThrows: this.playResult.pendingFreeThrows ?? null,
      keyframes: this.keyframes,
      roleAssignments: this.roleAssignments,
      activatedBadges: this.activatedBadges,
      firedShotSynergies: this.firedShotSynergies,
      firedDefenseSynergies: this.firedDefenseSynergies,
      firedReboundSynergies: this.firedReboundSynergies,
      // Defensive assignment for this possession (queryable; per-keyframe
      // matchups carry the timeline of switches / zone pick-ups).
      defensiveScheme: this.defensiveScheme,
      defenseFamily: this.defenseFamily,
      matchups: { ...this.matchups },
      chaser: this.chaser ? { ...this.chaser } : null,
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
    this.matchups = {};
    this.zoneAnchors = null;
    this.chaser = null;
    this.defenseFamily = 'man';
    this.lastOnBallDefenderId = null;
    this._pendingBallFlight = null;
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
