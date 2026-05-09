// =============================================================================
// badgeKeysByAction.js
// =============================================================================
// Single source of truth for which badge effect keys move which kind of action.
// Used by PlayExecutionEngine.calculateBadgeBoost (and indirectly by the
// gameplay-coverage audit) to decide which of a player's badge effects can
// modify a given action's outcome.
//
// Convention:
//   ACTION_EFFECT_KEYS[action.type].offense → keys read from the actor's badges
//   ACTION_EFFECT_KEYS[action.type].defense → keys read from the defender's badges
//
// When multiple of an actor's badges grant the same key (e.g. two badges both
// grant `assistBoost`), we take Math.max — never sum. PlayExecutionEngine and
// GameSimulator both apply this rule.
// =============================================================================

export const ACTION_EFFECT_KEYS = {
  pass: {
    offense: [
      'assistBoost',           // Dimer
      'lobPassBoost',          // Lob City Passer
      'tightPassBoost',        // Needle Threader
      'bailOutPassBoost',      // Bail Out
      'outletPassBoost',       // Break Starter
      'passSpeedBoost',        // Lightning Launch
      'visionBoost',           // Versatile Visionary
      'teamOffenseBoost',      // Floor General
    ],
    defense: [
      'stealChanceBoost',      // Interceptor
      'offBallDefBoost',       // Off Ball Pest
      'pressureBoost',         // On Ball Menace
    ],
  },
  dribble: {
    offense: [
      'crossoverBoost',        // Ankle Breaker
      'firstStepBoost',        // Quick First Step / Downhill
      'separationBoost',       // Space Creator
      'ballSecurityBoost',     // Tight Handles / Strong Handle
      'stripResistance',       // Unpluckable
      'dribbleStaminaReduction', // Handles for Days
      'pnrHandlerBoost',       // Pick and Roll Maestro
      'ankleBreakChance',      // Ankle Assassin
      'transitionSpeedBoost',  // Downhill
      'offDribbleBoost',       // Shifty Shooter (off-dribble shot prep)
    ],
    defense: [
      'onBallStealBoost',      // Pick Pocket
      'onBallDefBoost',        // Glove
      'perimeterDefBoost',     // Clamps
      'pressureBoost',         // On Ball Menace
    ],
  },
  screen: {
    offense: [
      'screenEffectBoost',     // Brick Wall
      'offBallMovementBoost',  // Slippery Off Ball (off-ball cutter benefits from screen)
    ],
    defense: [
      'screenNavBoost',        // Pick Dodger
      'postDefStrength',       // Immovable Enforcer (resists screen-and-roll)
    ],
  },
  shot: {
    // Shot resolution is anchored in GameSimulator.calculateBadgeBoostWithActivations
    // and uses these keys via Math.max-per-key aggregation.
    offense: [
      'catchShootBoost', 'cornerThreeBoost', 'deepRangeBoost', 'contestReduction',
      'movingShotBoost', 'contestedLayupBoost', 'contactFinishBoost', 'floaterBoost',
      'giantSlayerBoost',
      // Newly-wired shot-flavor keys:
      'posterDunkBoost',       // Posterizer
      'avoidContactBoost',     // Slithery Finisher
      'layupTimingBoost',      // Pro Touch
      'aerialFinishBoost',     // Aerial Wizard / Rise Up (riseUpDunkBoost mirrored)
      'riseUpDunkBoost',
      'paintScoringBoost',     // Paint Prodigy
      'creativeLayupBoost',    // Layup Mixmaster
      'putbackBoost',          // Putback Boss
      'hookShotBoost',         // Hook Specialist
      'postFadeBoost',         // Post Fade Phenom
      'postStrengthBoost',     // Post Powerhouse
      'postMoveBoost',         // Post Up Poet
      'hotHandBoost',          // Green Machine
      'hotZoneBoost',          // Hot Zone Hunter
      'clutchShotBoost',       // Clutch Shooter
      'volumeBoost',           // Volume Shooter
      'smallShooterBoost',     // Mini Marksman
      'setShotBoost',          // Set Shot Specialist
      'alleyOopFinishBoost',   // Lob City Finisher
    ],
    defense: [
      'contestBoost',          // Intimidator / Challenger
      'rimProtectionBoost',    // Rim Protector
      'paintDefBoost',         // Paint Patroller
      'postDefBoost',          // Post Lockdown
      'aerialBlockBoost',      // High Flying Denier
      'blockRecoveryBoost',    // Pogo Stick
      'chaseDownBlockBoost',   // Chase Down Artist
      'teamDefenseBoost',      // Defensive Leader
    ],
  },
  rebound: {
    offense: [
      'putbackBoost',          // Putback Boss
      'boxOutEscapeBoost',     // Worm
    ],
    defense: [
      'boxOutBoost',           // Box / Boxout Beast
      'reboundRangeBoost',     // Rebound Chaser
    ],
  },
  cut: {
    offense: [
      'offBallMovementBoost',  // Slippery Off Ball
      'separationBoost',
    ],
    defense: [
      'offBallDefBoost',
    ],
  },
  // Stamina costs are reduced by these keys; consumed in GameSimulator's
  // fatigue accumulator rather than per-action advantage math.
  fatigue: {
    offenseReduction: ['fatigueReduction', 'dribbleStaminaReduction'],
    defenseReduction: ['defenseStaminaReduction'],
  },
}

// Flat lookup helper used by callers that don't care about action type — e.g.
// the audit script grepping for "any defined effect key consumed somewhere."
export const ALL_EFFECT_KEYS = Array.from(new Set([
  ...ACTION_EFFECT_KEYS.pass.offense,
  ...ACTION_EFFECT_KEYS.pass.defense,
  ...ACTION_EFFECT_KEYS.dribble.offense,
  ...ACTION_EFFECT_KEYS.dribble.defense,
  ...ACTION_EFFECT_KEYS.screen.offense,
  ...ACTION_EFFECT_KEYS.screen.defense,
  ...ACTION_EFFECT_KEYS.shot.offense,
  ...ACTION_EFFECT_KEYS.shot.defense,
  ...ACTION_EFFECT_KEYS.rebound.offense,
  ...ACTION_EFFECT_KEYS.rebound.defense,
  ...ACTION_EFFECT_KEYS.cut.offense,
  ...ACTION_EFFECT_KEYS.cut.defense,
  ...ACTION_EFFECT_KEYS.fatigue.offenseReduction,
  ...ACTION_EFFECT_KEYS.fatigue.defenseReduction,
]))

/**
 * Aggregate badge effects for a player using max-per-key (never sum).
 *
 * @param {object} player - Player record with `badges: [{id, level}]`
 * @param {object} badgeDefinitions - id → BADGES entry lookup
 * @returns {Record<string, number>} effectKey → max value across player's badges
 */
export function aggregateBadgeEffects(player, badgeDefinitions) {
  const out = {}
  const badges = player?.badges || []
  for (const badge of badges) {
    const def = badgeDefinitions[badge.id]
    if (!def) continue
    const tierEffects = def.effects?.[badge.level] || {}
    for (const [key, value] of Object.entries(tierEffects)) {
      if (typeof value !== 'number') continue
      out[key] = Math.max(out[key] || 0, value)
    }
  }
  return out
}

/**
 * Sum the relevant offense or defense keys for a given action type.
 *
 * @param {Record<string, number>} aggregated - output of aggregateBadgeEffects
 * @param {string} actionType - 'pass' | 'dribble' | 'screen' | 'shot' | 'rebound' | 'cut'
 * @param {'offense'|'defense'} side
 * @returns {number} summed boost (already max-merged per key by aggregate)
 */
export function sumActionBoost(aggregated, actionType, side) {
  const keys = ACTION_EFFECT_KEYS[actionType]?.[side] || []
  let total = 0
  for (const key of keys) total += aggregated[key] || 0
  return total
}
