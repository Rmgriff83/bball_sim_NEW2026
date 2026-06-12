// =============================================================================
// Badge "fit" recipes — drives attribute-aware badge assignment at player
// generation time. Each entry maps a badge id to a recipe consumed by
// `pickBadgesByFit` in `engine/campaign/CampaignManager.js`.
// =============================================================================
//
// Recipe shape:
//   prereqs:       optional list of hard gates — { key, min?, max? }. If any
//                  fails, the badge can't appear on this player. Used
//                  sparingly (~10 badges) where unrealistic crossover would
//                  be jarring (Rim Protector on a 6'2" PG, Posterizer on a
//                  vertically-challenged big, etc.).
//                  - key beginning with 'offense.', 'defense.', 'physical.',
//                    or 'mental.' → reads `player.attributes.{cat}.{key}`.
//                  - key 'heightInches' / 'weightLbs' → reads top-level vital.
//
//   weights:       soft drivers. Score contribution per attribute is
//                  max(0, attr - 50) * weight. The 50 baseline means only
//                  above-average attrs pull the fit score up.
//
//   vitals:        same shape but for height / weight. { min, weight } or
//                  { max, weight }. Example: heightInches: { min: 80,
//                  weight: 1.5 } adds 1.5 per inch above 6'8".
//
//   positionMult:  soft multiplier per position (default 1.0 if omitted).
//                  Keep in [0.5, 1.4] — anything sharper feels gated.
//                  Position still informs, just doesn't gate.
//
//   archetypeTags: array of archetype names (matches `ARCHETYPES[].name`
//                  in engine/data/archetypes.js). When the player's detected
//                  archetype is in this list, the badge gets a 1.3× score
//                  bump during sampling.
//
// Canonical attribute keys live in engine/data/attributeSchema.js.
// Archetype names live in engine/data/archetypes.js.
//
// Notes on hard prereqs (the ~10 gated badges):
//   - rim_protector       : block ≥ 65, vertical ≥ 65
//   - lob_city_finisher   : vertical ≥ 75, standingDunk ≥ 70
//   - paint_patroller     : interiorDefense ≥ 65, helpDefenseIQ ≥ 65
//   - posterizer          : drivingDunk ≥ 72, vertical ≥ 72
//   - rise_up             : vertical ≥ 72, standingDunk ≥ 70
//   - aerial_wizard       : vertical ≥ 72
//   - chase_down_artist   : speed ≥ 70, acceleration ≥ 70, vertical ≥ 70
//   - high_flying_denier  : vertical ≥ 72, block ≥ 65
//   - hook_specialist     : postHook ≥ 60
//   - post_powerhouse     : strength ≥ 70
//   - mini_marksman       : heightInches ≤ 75 (anti-prereq — for SHORT players)
//
// Everything else is purely soft-weighted; very unlikely picks remain
// theoretically possible.

export const BADGE_FITS = {
  // -------------------------------------------------------------------------
  // FINISHING
  // -------------------------------------------------------------------------
  acrobat: {
    weights: {
      'offense.layup': 1.8,
      'offense.drivingDunk': 0.8,
      'physical.acceleration': 0.6,
      'offense.hands': 0.4,
    },
    positionMult: { PG: 1.1, SG: 1.2, SF: 1.2, PF: 1.0, C: 0.7 },
    archetypeTags: ['Slasher', 'Slashing Wing', 'Two-Way Wing'],
  },
  contact_finisher: {
    weights: {
      'offense.drivingDunk': 1.4,
      'offense.layup': 1.0,
      'physical.strength': 1.2,
      'offense.drawFoul': 0.6,
    },
    positionMult: { PG: 0.9, SG: 1.1, SF: 1.2, PF: 1.2, C: 1.0 },
    archetypeTags: ['Slasher', 'Slashing Wing', 'Power Forward (Bruiser)', 'Two-Way Wing'],
  },
  posterizer: {
    prereqs: [
      { key: 'offense.drivingDunk', min: 72 },
      { key: 'physical.vertical', min: 72 },
    ],
    weights: {
      'offense.drivingDunk': 2.0,
      'physical.vertical': 1.5,
      'physical.strength': 0.8,
    },
    positionMult: { PG: 0.7, SG: 1.0, SF: 1.3, PF: 1.3, C: 1.1 },
    archetypeTags: ['Slashing Wing', 'Slasher', 'Rim Runner'],
  },
  slithery_finisher: {
    weights: {
      'offense.layup': 1.6,
      'offense.ballHandling': 0.8,
      'physical.acceleration': 0.8,
      'offense.hands': 0.6,
    },
    positionMult: { PG: 1.2, SG: 1.2, SF: 1.0, PF: 0.8, C: 0.6 },
    archetypeTags: ['Slasher', 'Combo Guard', 'Slashing Wing'],
  },
  giant_slayer: {
    weights: {
      'offense.layup': 1.6,
      'offense.shotIQ': 0.8,
      'physical.acceleration': 0.6,
    },
    vitals: { heightInches: { max: 78, weight: 1.2 } },  // shorter favored
    positionMult: { PG: 1.3, SG: 1.2, SF: 0.9, PF: 0.7, C: 0.5 },
    archetypeTags: ['Slasher', 'Lead Guard', 'Combo Guard'],
  },
  pro_touch: {
    weights: {
      'offense.layup': 1.4,
      'offense.shotIQ': 1.2,
      'offense.offensiveConsistency': 0.8,
    },
    positionMult: { PG: 1.0, SG: 1.1, SF: 1.1, PF: 1.0, C: 0.8 },
    archetypeTags: ['Two-Way Wing', 'Combo Guard', 'Lead Guard'],
  },
  floater_specialist: {
    weights: {
      'offense.layup': 1.2,
      'offense.shotIQ': 1.4,
      'offense.midRange': 0.8,
    },
    positionMult: { PG: 1.3, SG: 1.2, SF: 1.0, PF: 0.7, C: 0.6 },
    archetypeTags: ['Lead Guard', 'Combo Guard', 'Slasher'],
  },
  putback_boss: {
    weights: {
      'defense.offensiveRebound': 1.6,
      'offense.standingDunk': 1.0,
      'physical.strength': 0.8,
      'physical.vertical': 0.6,
    },
    positionMult: { PG: 0.4, SG: 0.6, SF: 1.0, PF: 1.3, C: 1.3 },
    archetypeTags: ['Power Forward (Bruiser)', 'Rim Runner', 'Old-School Bruiser'],
  },
  aerial_wizard: {
    prereqs: [{ key: 'physical.vertical', min: 72 }],
    weights: {
      'physical.vertical': 1.8,
      'offense.drivingDunk': 1.2,
      'offense.standingDunk': 0.8,
      'offense.hands': 0.6,
    },
    positionMult: { PG: 0.7, SG: 1.0, SF: 1.2, PF: 1.2, C: 1.0 },
    archetypeTags: ['Rim Runner', 'Slashing Wing', 'Slasher'],
  },
  float_game: {
    weights: {
      'offense.shotIQ': 1.4,
      'offense.midRange': 1.0,
      'offense.layup': 0.8,
    },
    positionMult: { PG: 1.3, SG: 1.1, SF: 1.0, PF: 0.7, C: 0.6 },
    archetypeTags: ['Lead Guard', 'Combo Guard'],
  },
  hook_specialist: {
    prereqs: [{ key: 'offense.postHook', min: 60 }],
    weights: {
      'offense.postHook': 2.0,
      'offense.postControl': 1.2,
      'physical.strength': 0.6,
    },
    positionMult: { PG: 0.3, SG: 0.5, SF: 0.8, PF: 1.2, C: 1.4 },
    archetypeTags: ['Old-School Bruiser', 'Power Forward (Bruiser)', 'Point Center'],
  },
  layup_mixmaster: {
    weights: {
      'offense.layup': 1.6,
      'offense.ballHandling': 1.0,
      'offense.hands': 0.6,
    },
    positionMult: { PG: 1.2, SG: 1.2, SF: 1.1, PF: 0.8, C: 0.6 },
    archetypeTags: ['Slasher', 'Combo Guard', 'Two-Way Wing'],
  },
  paint_prodigy: {
    weights: {
      'offense.layup': 1.0,
      'offense.standingDunk': 1.0,
      'offense.postControl': 1.0,
      'physical.strength': 0.6,
    },
    positionMult: { PG: 0.7, SG: 0.8, SF: 1.0, PF: 1.2, C: 1.3 },
    archetypeTags: ['Power Forward (Bruiser)', 'Old-School Bruiser', 'Slashing Wing'],
  },
  physical_finisher: {
    weights: {
      'offense.drivingDunk': 1.4,
      'physical.strength': 1.6,
      'offense.layup': 0.8,
      'offense.drawFoul': 0.6,
    },
    positionMult: { PG: 0.7, SG: 0.9, SF: 1.2, PF: 1.3, C: 1.2 },
    archetypeTags: ['Slashing Wing', 'Slasher', 'Power Forward (Bruiser)'],
  },
  post_fade_phenom: {
    weights: {
      'offense.postFade': 2.0,
      'offense.midRange': 0.8,
      'offense.postControl': 0.8,
    },
    positionMult: { PG: 0.4, SG: 0.6, SF: 0.9, PF: 1.2, C: 1.3 },
    archetypeTags: ['Old-School Bruiser', 'Power Forward (Bruiser)', 'Point Center'],
  },
  post_powerhouse: {
    prereqs: [{ key: 'physical.strength', min: 70 }],
    weights: {
      'physical.strength': 1.8,
      'offense.postControl': 1.0,
      'offense.postHook': 0.6,
    },
    positionMult: { PG: 0.3, SG: 0.5, SF: 0.8, PF: 1.3, C: 1.3 },
    archetypeTags: ['Old-School Bruiser', 'Power Forward (Bruiser)'],
  },
  post_up_poet: {
    weights: {
      'offense.postHook': 1.0,
      'offense.postFade': 1.0,
      'offense.postControl': 1.4,
      'mental.basketballIQ': 0.6,
    },
    positionMult: { PG: 0.3, SG: 0.6, SF: 0.9, PF: 1.2, C: 1.3 },
    archetypeTags: ['Old-School Bruiser', 'Point Center', 'Power Forward (Bruiser)'],
  },
  rise_up: {
    prereqs: [
      { key: 'physical.vertical', min: 72 },
      { key: 'offense.standingDunk', min: 70 },
    ],
    weights: {
      'offense.standingDunk': 1.6,
      'physical.vertical': 1.4,
      'physical.strength': 0.6,
    },
    positionMult: { PG: 0.6, SG: 0.9, SF: 1.2, PF: 1.3, C: 1.3 },
    archetypeTags: ['Rim Runner', 'Slashing Wing', 'Power Forward (Bruiser)'],
  },

  // -------------------------------------------------------------------------
  // SHOOTING
  // -------------------------------------------------------------------------
  catch_and_shoot: {
    weights: {
      'offense.threePoint': 2.0,
      'offense.shotIQ': 1.0,
      'offense.offensiveConsistency': 0.6,
    },
    positionMult: { PG: 0.9, SG: 1.3, SF: 1.2, PF: 1.0, C: 0.7 },
    archetypeTags: ['3-and-D Guard', '3-and-D Wing', 'Two-Way Wing', 'Stretch 4', 'Stretch 5', 'Combo Guard'],
  },
  corner_specialist: {
    weights: {
      'offense.threePoint': 1.6,
      'offense.shotIQ': 0.8,
      'offense.offensiveConsistency': 0.6,
    },
    positionMult: { PG: 0.8, SG: 1.2, SF: 1.3, PF: 1.1, C: 0.7 },
    archetypeTags: ['3-and-D Wing', '3-and-D Guard', 'Stretch 4'],
  },
  deadeye: {
    weights: {
      'offense.threePoint': 1.4,
      'offense.shotIQ': 1.4,
      'mental.clutch': 0.6,
    },
    positionMult: { PG: 1.0, SG: 1.3, SF: 1.2, PF: 1.0, C: 0.8 },
    archetypeTags: ['3-and-D Guard', '3-and-D Wing', 'Combo Guard', 'Two-Way Wing', 'Stretch 4', 'Stretch 5'],
  },
  deep_threes: {
    weights: {
      'offense.threePoint': 2.0,
      'offense.shotIQ': 0.6,
    },
    positionMult: { PG: 1.2, SG: 1.3, SF: 1.0, PF: 0.9, C: 0.7 },
    archetypeTags: ['Combo Guard', 'Lead Guard', 'Stretch 4', 'Stretch 5'],
  },
  difficult_shots: {
    weights: {
      'offense.midRange': 1.6,
      'offense.shotIQ': 1.2,
      'offense.ballHandling': 0.6,
    },
    positionMult: { PG: 1.2, SG: 1.3, SF: 1.1, PF: 0.8, C: 0.6 },
    archetypeTags: ['Combo Guard', 'Two-Way Wing', 'Lead Guard'],
  },
  green_machine: {
    weights: {
      'offense.threePoint': 1.4,
      'offense.shotIQ': 1.0,
      'mental.clutch': 0.8,
      'mental.intangibles': 0.4,
    },
    positionMult: { PG: 1.0, SG: 1.2, SF: 1.1, PF: 1.0, C: 0.8 },
    archetypeTags: ['3-and-D Guard', '3-and-D Wing', 'Combo Guard', 'Stretch 4'],
  },
  hot_zone_hunter: {
    weights: {
      'offense.threePoint': 1.0,
      'offense.midRange': 1.0,
      'offense.shotIQ': 1.2,
    },
    positionMult: { PG: 1.0, SG: 1.2, SF: 1.1, PF: 1.0, C: 0.8 },
    archetypeTags: ['Combo Guard', 'Two-Way Wing', 'Stretch 4'],
  },
  clutch_shooter: {
    weights: {
      'mental.clutch': 2.0,
      'offense.shotIQ': 0.8,
      'mental.intangibles': 0.8,
      'offense.midRange': 0.4,
    },
    positionMult: { PG: 1.2, SG: 1.2, SF: 1.1, PF: 1.0, C: 0.9 },
    archetypeTags: ['Lead Guard', 'Combo Guard', 'Two-Way Wing'],
  },
  volume_shooter: {
    weights: {
      'offense.threePoint': 0.8,
      'offense.midRange': 0.8,
      'offense.shotIQ': 1.0,
      'mental.workEthic': 0.6,
    },
    positionMult: { PG: 1.1, SG: 1.2, SF: 1.0, PF: 0.9, C: 0.7 },
    archetypeTags: ['Combo Guard', 'Two-Way Wing'],
  },
  tireless_shooter: {
    weights: {
      'offense.threePoint': 0.8,
      'physical.stamina': 1.6,
      'mental.workEthic': 0.8,
    },
    positionMult: { PG: 1.1, SG: 1.2, SF: 1.0, PF: 0.9, C: 0.7 },
    archetypeTags: ['3-and-D Wing', '3-and-D Guard', 'Combo Guard'],
  },
  limitless_range: {
    weights: {
      'offense.threePoint': 2.2,
      'offense.shotIQ': 0.6,
    },
    positionMult: { PG: 1.3, SG: 1.3, SF: 1.0, PF: 0.8, C: 0.6 },
    archetypeTags: ['Combo Guard', 'Lead Guard', 'Stretch 4'],
  },
  mini_marksman: {
    prereqs: [
      { key: 'heightInches', max: 75 },
      { key: 'offense.threePoint', min: 70 },
    ],
    weights: {
      'offense.threePoint': 1.6,
      'offense.shotIQ': 1.0,
    },
    vitals: { heightInches: { max: 73, weight: 1.4 } },
    positionMult: { PG: 1.4, SG: 1.2, SF: 0.6, PF: 0.3, C: 0.2 },
    archetypeTags: ['Combo Guard', 'Lead Guard'],
  },
  set_shot_specialist: {
    weights: {
      'offense.threePoint': 1.4,
      'offense.shotIQ': 1.2,
      'offense.offensiveConsistency': 0.8,
    },
    positionMult: { PG: 0.9, SG: 1.1, SF: 1.2, PF: 1.2, C: 1.0 },
    archetypeTags: ['Stretch 4', 'Stretch 5', '3-and-D Wing'],
  },
  shifty_shooter: {
    weights: {
      'offense.midRange': 1.4,
      'offense.ballHandling': 1.2,
      'offense.shotIQ': 1.0,
      'physical.acceleration': 0.6,
    },
    positionMult: { PG: 1.3, SG: 1.3, SF: 1.0, PF: 0.7, C: 0.5 },
    archetypeTags: ['Combo Guard', 'Lead Guard', 'Two-Way Wing'],
  },

  // -------------------------------------------------------------------------
  // PLAYMAKING
  // -------------------------------------------------------------------------
  ankle_breaker: {
    weights: {
      'offense.ballHandling': 1.8,
      'physical.acceleration': 1.0,
      'physical.speedWithBall': 0.8,
    },
    positionMult: { PG: 1.4, SG: 1.2, SF: 1.0, PF: 0.6, C: 0.4 },
    archetypeTags: ['Lead Guard', 'Combo Guard', 'Slasher'],
  },
  bail_out: {
    weights: {
      'offense.passAccuracy': 1.6,
      'offense.passIQ': 1.4,
      'offense.passVision': 1.0,
    },
    positionMult: { PG: 1.3, SG: 1.0, SF: 1.0, PF: 0.8, C: 0.7 },
    archetypeTags: ['Lead Guard', 'Point Forward', 'Point Center'],
  },
  break_starter: {
    weights: {
      'offense.passAccuracy': 1.6,
      'offense.passVision': 1.4,
      'defense.defensiveRebound': 1.0,
    },
    positionMult: { PG: 1.0, SG: 0.9, SF: 1.0, PF: 1.1, C: 1.1 },
    archetypeTags: ['Point Forward', 'Point Center', 'Lead Guard'],
  },
  dimer: {
    weights: {
      'offense.passAccuracy': 1.4,
      'offense.passIQ': 2.0,
      'offense.passVision': 1.4,
      'mental.basketballIQ': 0.6,
    },
    positionMult: { PG: 1.4, SG: 1.0, SF: 1.0, PF: 0.9, C: 0.8 },
    archetypeTags: ['Lead Guard', 'Point Forward', 'Point Center', 'Combo Guard'],
  },
  floor_general: {
    weights: {
      'mental.basketballIQ': 2.2,
      'offense.passIQ': 1.4,
      'offense.passVision': 1.2,
      'mental.intangibles': 1.0,
      'mental.coachability': 0.6,
    },
    positionMult: { PG: 1.4, SG: 1.0, SF: 1.0, PF: 0.9, C: 1.0 },
    archetypeTags: ['Lead Guard', 'Point Forward', 'Point Center'],
  },
  handles_for_days: {
    weights: {
      'offense.ballHandling': 2.0,
      'physical.stamina': 0.8,
      'mental.workEthic': 0.4,
    },
    positionMult: { PG: 1.4, SG: 1.2, SF: 1.0, PF: 0.6, C: 0.4 },
    archetypeTags: ['Lead Guard', 'Combo Guard', 'Slasher'],
  },
  lob_city_passer: {
    weights: {
      'offense.passAccuracy': 1.4,
      'offense.passIQ': 1.2,
      'offense.passVision': 1.4,
    },
    positionMult: { PG: 1.3, SG: 1.0, SF: 1.0, PF: 0.9, C: 0.9 },
    archetypeTags: ['Lead Guard', 'Point Forward', 'Combo Guard'],
  },
  needle_threader: {
    weights: {
      'offense.passAccuracy': 1.6,
      'offense.passVision': 1.4,
      'offense.passIQ': 1.4,
    },
    positionMult: { PG: 1.4, SG: 1.0, SF: 1.0, PF: 0.8, C: 0.9 },
    archetypeTags: ['Lead Guard', 'Point Forward', 'Point Center'],
  },
  pick_and_roll_maestro: {
    weights: {
      'mental.basketballIQ': 1.6,
      'offense.passIQ': 1.2,
      'offense.ballHandling': 1.0,
      'offense.passVision': 0.8,
    },
    positionMult: { PG: 1.4, SG: 1.1, SF: 1.0, PF: 0.8, C: 0.7 },
    archetypeTags: ['Lead Guard', 'Combo Guard', 'Point Forward'],
  },
  quick_first_step: {
    weights: {
      'physical.acceleration': 1.8,
      'physical.speed': 1.0,
      'offense.ballHandling': 1.0,
    },
    positionMult: { PG: 1.3, SG: 1.3, SF: 1.1, PF: 0.8, C: 0.5 },
    archetypeTags: ['Slasher', 'Combo Guard', 'Lead Guard', 'Slashing Wing'],
  },
  space_creator: {
    weights: {
      'offense.ballHandling': 1.4,
      'offense.shotIQ': 1.0,
      'physical.acceleration': 0.8,
      'offense.midRange': 0.6,
    },
    positionMult: { PG: 1.3, SG: 1.2, SF: 1.1, PF: 0.8, C: 0.5 },
    archetypeTags: ['Lead Guard', 'Combo Guard', 'Two-Way Wing'],
  },
  tight_handles: {
    weights: {
      'offense.ballHandling': 1.8,
      'offense.hands': 0.8,
    },
    positionMult: { PG: 1.4, SG: 1.2, SF: 1.0, PF: 0.6, C: 0.4 },
    archetypeTags: ['Lead Guard', 'Combo Guard', 'Point Forward'],
  },
  ankle_assassin: {
    weights: {
      'offense.ballHandling': 1.6,
      'physical.acceleration': 1.0,
      'offense.shotIQ': 0.4,
    },
    positionMult: { PG: 1.4, SG: 1.2, SF: 0.9, PF: 0.5, C: 0.4 },
    archetypeTags: ['Lead Guard', 'Combo Guard', 'Slasher'],
  },
  lightning_launch: {
    weights: {
      'offense.passAccuracy': 1.4,
      'offense.passIQ': 1.0,
    },
    positionMult: { PG: 1.3, SG: 1.0, SF: 1.0, PF: 0.8, C: 0.7 },
    archetypeTags: ['Lead Guard', 'Point Forward', 'Combo Guard'],
  },
  strong_handle: {
    weights: {
      'offense.ballHandling': 1.4,
      'offense.hands': 0.6,
      'physical.strength': 0.6,
    },
    positionMult: { PG: 1.3, SG: 1.1, SF: 1.0, PF: 0.7, C: 0.5 },
    archetypeTags: ['Lead Guard', 'Combo Guard', 'Slasher'],
  },
  unpluckable: {
    weights: {
      'offense.ballHandling': 1.4,
      'offense.hands': 1.0,
      'physical.strength': 0.6,
    },
    positionMult: { PG: 1.3, SG: 1.1, SF: 1.0, PF: 0.7, C: 0.5 },
    archetypeTags: ['Lead Guard', 'Combo Guard', 'Slasher'],
  },
  versatile_visionary: {
    weights: {
      'offense.passVision': 1.8,
      'offense.passIQ': 1.4,
      'mental.basketballIQ': 0.8,
    },
    positionMult: { PG: 1.3, SG: 1.0, SF: 1.1, PF: 1.0, C: 1.0 },
    archetypeTags: ['Point Forward', 'Point Center', 'Lead Guard'],
  },

  // -------------------------------------------------------------------------
  // DEFENSE
  // -------------------------------------------------------------------------
  clamps: {
    weights: {
      'defense.perimeterDefense': 2.0,
      'physical.acceleration': 0.8,
      'physical.speed': 0.6,
    },
    positionMult: { PG: 1.2, SG: 1.4, SF: 1.3, PF: 0.9, C: 0.5 },
    archetypeTags: ['3-and-D Guard', '3-and-D Wing', 'Two-Way Wing'],
  },
  chase_down_artist: {
    prereqs: [
      { key: 'physical.speed', min: 70 },
      { key: 'physical.acceleration', min: 70 },
      { key: 'physical.vertical', min: 70 },
    ],
    weights: {
      'defense.block': 1.4,
      'physical.speed': 1.2,
      'physical.vertical': 1.0,
    },
    positionMult: { PG: 0.7, SG: 1.0, SF: 1.3, PF: 1.2, C: 0.8 },
    archetypeTags: ['Two-Way Wing', 'Slashing Wing'],
  },
  heart_crusher: {
    weights: {
      'defense.block': 1.0,
      'defense.steal': 1.0,
      'mental.intangibles': 1.0,
      'mental.clutch': 0.6,
    },
    positionMult: { PG: 0.9, SG: 1.0, SF: 1.1, PF: 1.1, C: 1.2 },
    archetypeTags: ['Drop Big', 'Two-Way Wing'],
  },
  interceptor: {
    weights: {
      'defense.steal': 1.6,
      'defense.passPerception': 1.4,
      'mental.basketballIQ': 0.8,
      'physical.speed': 0.6,
    },
    positionMult: { PG: 1.3, SG: 1.3, SF: 1.1, PF: 0.9, C: 0.7 },
    archetypeTags: ['3-and-D Guard', '3-and-D Wing'],
  },
  intimidator: {
    weights: {
      'defense.block': 1.4,
      'defense.interiorDefense': 1.2,
      'defense.helpDefenseIQ': 0.8,
    },
    vitals: { heightInches: { min: 80, weight: 0.6 } },
    positionMult: { PG: 0.4, SG: 0.6, SF: 1.0, PF: 1.3, C: 1.4 },
    archetypeTags: ['Drop Big', 'Stretch 5', 'Power Forward (Bruiser)'],
  },
  pick_dodger: {
    weights: {
      'defense.perimeterDefense': 1.4,
      'mental.basketballIQ': 1.0,
      'physical.acceleration': 1.0,
    },
    positionMult: { PG: 1.3, SG: 1.3, SF: 1.1, PF: 0.7, C: 0.4 },
    archetypeTags: ['3-and-D Guard', '3-and-D Wing'],
  },
  pick_pocket: {
    weights: {
      'defense.steal': 1.8,
      'offense.hands': 0.8,
      'mental.basketballIQ': 0.6,
    },
    positionMult: { PG: 1.3, SG: 1.2, SF: 1.0, PF: 0.8, C: 0.6 },
    archetypeTags: ['3-and-D Guard', 'Two-Way Wing'],
  },
  pogo_stick: {
    weights: {
      'physical.vertical': 1.6,
      'defense.block': 1.2,
      'physical.stamina': 0.4,
    },
    positionMult: { PG: 0.5, SG: 0.7, SF: 1.1, PF: 1.3, C: 1.2 },
    archetypeTags: ['Rim Runner', 'Two-Way Wing'],
  },
  post_lockdown: {
    weights: {
      'defense.interiorDefense': 1.6,
      'physical.strength': 1.0,
      'defense.defensiveConsistency': 0.8,
    },
    positionMult: { PG: 0.3, SG: 0.5, SF: 0.8, PF: 1.3, C: 1.4 },
    archetypeTags: ['Drop Big', 'Power Forward (Bruiser)'],
  },
  rebound_chaser: {
    weights: {
      'defense.defensiveRebound': 1.6,
      'defense.offensiveRebound': 1.0,
      'physical.vertical': 0.8,
      'mental.basketballIQ': 0.4,
    },
    positionMult: { PG: 0.5, SG: 0.7, SF: 1.0, PF: 1.3, C: 1.3 },
    archetypeTags: ['Power Forward (Bruiser)', 'Drop Big', 'Rim Runner', 'Old-School Bruiser'],
  },
  rim_protector: {
    prereqs: [
      { key: 'defense.block', min: 65 },
      { key: 'physical.vertical', min: 65 },
    ],
    weights: {
      'defense.block': 2.0,
      'defense.interiorDefense': 1.4,
      'defense.helpDefenseIQ': 1.0,
    },
    vitals: { heightInches: { min: 80, weight: 1.0 } },
    positionMult: { PG: 0.3, SG: 0.4, SF: 0.8, PF: 1.3, C: 1.4 },
    archetypeTags: ['Drop Big', 'Stretch 5', 'Rim Runner'],
  },
  defensive_leader: {
    weights: {
      'mental.basketballIQ': 2.0,
      'defense.helpDefenseIQ': 1.6,
      'mental.intangibles': 1.0,
      'mental.coachability': 0.6,
      'defense.defensiveConsistency': 0.6,
    },
    positionMult: { PG: 1.0, SG: 1.0, SF: 1.1, PF: 1.2, C: 1.3 },
    archetypeTags: ['Drop Big', 'Two-Way Wing', 'Point Center'],
  },
  worm: {
    weights: {
      'defense.offensiveRebound': 1.4,
      'defense.defensiveRebound': 1.4,
      'physical.acceleration': 0.6,
    },
    positionMult: { PG: 0.4, SG: 0.6, SF: 1.0, PF: 1.3, C: 1.3 },
    archetypeTags: ['Power Forward (Bruiser)', 'Rim Runner', 'Old-School Bruiser'],
  },
  challenger: {
    weights: {
      'defense.perimeterDefense': 1.4,
      'defense.helpDefenseIQ': 1.0,
      'mental.basketballIQ': 0.8,
    },
    positionMult: { PG: 1.0, SG: 1.2, SF: 1.3, PF: 1.1, C: 1.0 },
    archetypeTags: ['3-and-D Wing', '3-and-D Guard', 'Two-Way Wing'],
  },
  glove: {
    weights: {
      'defense.perimeterDefense': 1.8,
      'physical.stamina': 0.8,
      'physical.acceleration': 0.6,
    },
    positionMult: { PG: 1.3, SG: 1.3, SF: 1.2, PF: 0.9, C: 0.6 },
    archetypeTags: ['3-and-D Guard', '3-and-D Wing', 'Two-Way Wing'],
  },
  high_flying_denier: {
    prereqs: [
      { key: 'physical.vertical', min: 72 },
      { key: 'defense.block', min: 65 },
    ],
    weights: {
      'defense.block': 1.6,
      'physical.vertical': 1.4,
      'defense.helpDefenseIQ': 0.8,
    },
    positionMult: { PG: 0.4, SG: 0.7, SF: 1.1, PF: 1.3, C: 1.3 },
    archetypeTags: ['Drop Big', 'Rim Runner'],
  },
  immovable_enforcer: {
    weights: {
      'physical.strength': 1.8,
      'defense.interiorDefense': 1.4,
    },
    positionMult: { PG: 0.3, SG: 0.5, SF: 0.8, PF: 1.3, C: 1.4 },
    archetypeTags: ['Drop Big', 'Power Forward (Bruiser)', 'Old-School Bruiser'],
  },
  off_ball_pest: {
    weights: {
      'defense.perimeterDefense': 1.2,
      'defense.passPerception': 1.2,
      'mental.basketballIQ': 0.8,
      'physical.stamina': 0.6,
    },
    positionMult: { PG: 1.3, SG: 1.3, SF: 1.1, PF: 0.9, C: 0.6 },
    archetypeTags: ['3-and-D Guard', '3-and-D Wing'],
  },
  on_ball_menace: {
    weights: {
      'defense.perimeterDefense': 1.4,
      'physical.acceleration': 1.0,
      'defense.steal': 0.8,
    },
    positionMult: { PG: 1.3, SG: 1.3, SF: 1.2, PF: 0.8, C: 0.5 },
    archetypeTags: ['3-and-D Guard', 'Two-Way Wing'],
  },
  paint_patroller: {
    prereqs: [
      { key: 'defense.interiorDefense', min: 65 },
      { key: 'defense.helpDefenseIQ', min: 65 },
    ],
    weights: {
      'defense.interiorDefense': 1.6,
      'defense.helpDefenseIQ': 1.4,
      'defense.block': 0.8,
    },
    positionMult: { PG: 0.3, SG: 0.5, SF: 0.8, PF: 1.3, C: 1.4 },
    archetypeTags: ['Drop Big', 'Power Forward (Bruiser)', 'Stretch 5'],
  },
  boxout_beast: {
    weights: {
      'defense.defensiveRebound': 1.6,
      'physical.strength': 1.4,
    },
    positionMult: { PG: 0.4, SG: 0.6, SF: 1.0, PF: 1.3, C: 1.3 },
    archetypeTags: ['Power Forward (Bruiser)', 'Drop Big', 'Old-School Bruiser'],
  },

  // -------------------------------------------------------------------------
  // PHYSICAL
  // -------------------------------------------------------------------------
  brick_wall: {
    weights: {
      'physical.strength': 1.8,
      'mental.basketballIQ': 0.6,
    },
    vitals: { weightLbs: { min: 215, weight: 0.5 } },
    positionMult: { PG: 0.4, SG: 0.6, SF: 1.0, PF: 1.3, C: 1.4 },
    archetypeTags: ['Drop Big', 'Power Forward (Bruiser)', 'Old-School Bruiser', 'Rim Runner'],
  },
  box: {
    weights: {
      'defense.defensiveRebound': 1.4,
      'physical.strength': 1.0,
    },
    positionMult: { PG: 0.5, SG: 0.7, SF: 1.0, PF: 1.2, C: 1.2 },
    archetypeTags: ['Power Forward (Bruiser)', 'Drop Big', 'Old-School Bruiser'],
  },
  lob_city_finisher: {
    prereqs: [
      { key: 'physical.vertical', min: 75 },
      { key: 'offense.standingDunk', min: 70 },
    ],
    weights: {
      'physical.vertical': 1.6,
      'offense.standingDunk': 1.4,
      'offense.hands': 0.8,
    },
    positionMult: { PG: 0.4, SG: 0.6, SF: 1.0, PF: 1.3, C: 1.4 },
    archetypeTags: ['Rim Runner', 'Slashing Wing'],
  },
  downhill: {
    weights: {
      'physical.speed': 1.6,
      'offense.ballHandling': 1.0,
      'physical.stamina': 0.6,
    },
    positionMult: { PG: 1.3, SG: 1.2, SF: 1.1, PF: 0.8, C: 0.5 },
    archetypeTags: ['Slasher', 'Combo Guard', 'Lead Guard'],
  },
  tireless_defender: {
    weights: {
      'physical.stamina': 1.8,
      'defense.perimeterDefense': 0.8,
      'mental.workEthic': 0.8,
    },
    positionMult: { PG: 1.2, SG: 1.3, SF: 1.2, PF: 1.0, C: 0.8 },
    archetypeTags: ['3-and-D Guard', '3-and-D Wing', 'Two-Way Wing'],
  },
  slippery_off_ball: {
    weights: {
      'physical.acceleration': 1.0,
      'physical.stamina': 0.8,
      'mental.basketballIQ': 0.6,
      'offense.shotIQ': 0.6,
    },
    positionMult: { PG: 1.0, SG: 1.3, SF: 1.2, PF: 0.9, C: 0.5 },
    archetypeTags: ['3-and-D Guard', '3-and-D Wing', 'Combo Guard'],
  },
}
