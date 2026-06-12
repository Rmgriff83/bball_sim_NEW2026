// =============================================================================
// Badge Synergies
// =============================================================================
// Two badges held by two different players on the same lineup activate a
// synergy. The sim's evaluator routes each synergy to one of four phases
// (`shot` | `defense` | `rebound` | `transition`) inferred from the
// `effect.condition` string via CONDITION_TO_PHASE below.
//
// Effect keys that the sim actually consumes today:
//   • shotPercentage    — added to the offense's made-shot probability
//   • rollerFinishing   — additive boost on pick-and-roll plays
//   • paintDefense      — subtracted from offense's prob on paint shots
//   • forcedBadShots    — subtracted from offense's prob on any shot
//   • screenEffectiveness — added to offensive badge boost on screen actions
//   • reboundRate       — added to the offense's rebound-battle weight
//   • fastBreakChance   — added to transitionFreq before the per-possession roll
//
// All other boost keys appearing on entries below (alleyOopSuccess,
// putbackChance, floaterSuccess, cutSuccessRate, andOneChance, dunks,
// defenderFreezeChance, openShotChance, openLookChance, contestedShots,
// helpDefense, highlightChance, layupConversion, screenOffense,
// screenDefense, secondChancePoints, teamRating, clutchPerformance,
// transitionPoints, heightPenaltyReduction) are FLAVOR METADATA — they
// document the synergy's thematic intent but don't currently change sim
// math. Wire them up if/when the corresponding micro-event is modeled.

export const SYNERGIES = [
  // ---- Legacy synergies (IDs 1-16) ----
  { id: 1, badge1_id: 'pick_and_roll_maestro', badge2_id: 'brick_wall', synergy_name: 'Pick & Roll Connection', description: 'Ball handler and screener work in perfect harmony in pick and roll situations.', effect: { condition: 'pick_and_roll', boost: { screenEffectiveness: 0.15, rollerFinishing: 0.10 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 3, badge1_id: 'dimer', badge2_id: 'catch_and_shoot', synergy_name: 'Dish & Splash', description: 'Perfect passes to set shooters create automatic buckets.', effect: { condition: 'catch_and_shoot', boost: { shotPercentage: 0.08 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 4, badge1_id: 'floor_general', badge2_id: 'corner_specialist', synergy_name: 'Corner Offense', description: 'Floor general creates perfect spacing for corner shooters.', effect: { condition: 'corner_three', boost: { shotPercentage: 0.06, openLookChance: 0.10 } }, min_level1: 'gold', min_level2: 'silver' },
  { id: 5, badge1_id: 'lob_city_passer', badge2_id: 'lob_city_finisher', synergy_name: 'Lob City', description: 'Elite passer and finisher connect on alley-oops at an incredible rate.', effect: { condition: 'alley_oop', boost: { shotPercentage: 0.12, alleyOopSuccess: 0.25, highlightChance: 0.15 } }, min_level1: 'gold', min_level2: 'gold' },
  { id: 6, badge1_id: 'defensive_leader', badge2_id: 'rim_protector', synergy_name: 'Defensive Anchor', description: 'Defensive leader and rim protector form an impenetrable paint defense.', effect: { condition: 'interior_defense', boost: { paintDefense: 0.08, helpDefense: 0.08 } }, min_level1: 'gold', min_level2: 'gold' },
  { id: 7, badge1_id: 'clamps', badge2_id: 'rim_protector', synergy_name: 'Lockdown Defense', description: 'Perimeter defender funnels ball handlers into elite rim protector.', effect: { condition: 'team_defense', boost: { forcedBadShots: 0.06, contestedShots: 0.08 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 8, badge1_id: 'interceptor', badge2_id: 'break_starter', synergy_name: 'Fast Break Igniter', description: 'Steals turn into instant fast break opportunities.', effect: { condition: 'transition', boost: { fastBreakChance: 0.10, transitionPoints: 0.10 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 9, badge1_id: 'rebound_chaser', badge2_id: 'box', synergy_name: 'Board Dominance', description: 'Elite rebounding duo controls the glass on both ends.', effect: { condition: 'rebounding', boost: { reboundRate: 0.10, secondChancePoints: 0.08 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 10, badge1_id: 'putback_boss', badge2_id: 'worm', synergy_name: 'Second Chance Machine', description: 'Creates and converts second chance opportunities at an elite rate.', effect: { condition: 'offensive_rebound', boost: { reboundRate: 0.10, putbackChance: 0.15, secondChancePoints: 0.12 } }, min_level1: 'gold', min_level2: 'gold' },
  { id: 11, badge1_id: 'ankle_breaker', badge2_id: 'space_creator', synergy_name: 'Iso Master', description: 'Devastating combination of moves creates easy scoring opportunities.', effect: { condition: 'isolation', boost: { shotPercentage: 0.08, defenderFreezeChance: 0.15, openShotChance: 0.10 } }, min_level1: 'gold', min_level2: 'silver' },
  { id: 12, badge1_id: 'needle_threader', badge2_id: 'slithery_finisher', synergy_name: 'Traffic Navigator', description: 'Passer finds cutter who expertly avoids contact in the lane.', effect: { condition: 'cutting', boost: { shotPercentage: 0.07, cutSuccessRate: 0.12, layupConversion: 0.08 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 13, badge1_id: 'contact_finisher', badge2_id: 'posterizer', synergy_name: 'Freight Train', description: 'Unstoppable force at the rim who finishes through any contact.', effect: { condition: 'at_rim', boost: { shotPercentage: 0.09, andOneChance: 0.15, dunks: 0.10 } }, min_level1: 'gold', min_level2: 'gold' },
  { id: 14, badge1_id: 'giant_slayer', badge2_id: 'floater_specialist', synergy_name: 'Small Ball Specialist', description: 'Expert at scoring over taller defenders with craft and touch.', effect: { condition: 'mismatch', boost: { shotPercentage: 0.06, floaterSuccess: 0.12, heightPenaltyReduction: 0.15 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 15, badge1_id: 'floor_general', badge2_id: 'defensive_leader', synergy_name: 'Complete Leader', description: 'True two-way leader elevates the entire team on both ends.', effect: { condition: 'always', boost: { shotPercentage: 0.02, teamRating: 2, clutchPerformance: 0.08 } }, min_level1: 'gold', min_level2: 'gold' },
  { id: 16, badge1_id: 'brick_wall', badge2_id: 'pick_dodger', synergy_name: 'Screen Game Master', description: 'Team excels at using and defending screens.', effect: { condition: 'screen_play', boost: { screenEffectiveness: 0.08, screenOffense: 0.10, screenDefense: 0.10 } }, min_level1: 'silver', min_level2: 'silver' },

  // ---- New synergies (IDs 17-28) ----
  // Shot-phase additions covering previously-orphaned shooting and finishing
  // badge clusters.
  { id: 17, badge1_id: 'limitless_range', badge2_id: 'deep_threes', synergy_name: 'Deep Range Threat', description: 'Two range-extending shooters pull defenses well past the arc.', effect: { condition: 'three_pointer', boost: { shotPercentage: 0.08 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 18, badge1_id: 'volume_shooter', badge2_id: 'green_machine', synergy_name: 'Volume Sniper', description: 'Pile-up scorer with a hot hand keeps the spigot open.', effect: { condition: 'three_pointer', boost: { shotPercentage: 0.06 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 19, badge1_id: 'clutch_shooter', badge2_id: 'deadeye', synergy_name: 'Cold Blooded', description: 'Contested or not, the ice in the veins comes out late.', effect: { condition: 'clutch', boost: { shotPercentage: 0.10, clutchPerformance: 0.08 } }, min_level1: 'gold', min_level2: 'silver' },
  { id: 20, badge1_id: 'hot_zone_hunter', badge2_id: 'set_shot_specialist', synergy_name: 'Hot Zone Specialist', description: 'Lives in the sweet spots and lets it fly off the catch.', effect: { condition: 'mid_range', boost: { shotPercentage: 0.07 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 21, badge1_id: 'post_up_poet', badge2_id: 'post_powerhouse', synergy_name: 'Post Powerhouse', description: 'Footwork plus force overwhelms post matchups.', effect: { condition: 'paint', boost: { shotPercentage: 0.08 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 22, badge1_id: 'hook_specialist', badge2_id: 'post_fade_phenom', synergy_name: 'Hook Mastery', description: 'Classic post counters — hook one direction, fade the other.', effect: { condition: 'paint', boost: { shotPercentage: 0.06 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 23, badge1_id: 'aerial_wizard', badge2_id: 'rise_up', synergy_name: 'Aerial Show', description: 'Elevates above traffic to finish over the rim.', effect: { condition: 'at_rim', boost: { shotPercentage: 0.08, dunks: 0.10 } }, min_level1: 'silver', min_level2: 'silver' },

  // Defense-phase additions — these finally have a working consumer.
  { id: 24, badge1_id: 'paint_patroller', badge2_id: 'immovable_enforcer', synergy_name: 'Paint Wall', description: 'Two paint anchors shut down interior scoring.', effect: { condition: 'paint_defense', boost: { paintDefense: 0.08 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 25, badge1_id: 'glove', badge2_id: 'on_ball_menace', synergy_name: 'Perimeter Lockdown', description: 'Aggressive on-ball pressure forces uncomfortable looks across the floor.', effect: { condition: 'team_defense', boost: { forcedBadShots: 0.06 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 26, badge1_id: 'pogo_stick', badge2_id: 'high_flying_denier', synergy_name: 'Block Party', description: 'Springs and reach keep the rim a no-fly zone.', effect: { condition: 'paint_defense', boost: { paintDefense: 0.06 } }, min_level1: 'silver', min_level2: 'silver' },

  // Rebound-phase + transition-phase additions.
  { id: 27, badge1_id: 'boxout_beast', badge2_id: 'worm', synergy_name: 'Box Out Brigade', description: 'Sealing tandem dominates the glass on both ends.', effect: { condition: 'rebounding', boost: { reboundRate: 0.10 } }, min_level1: 'silver', min_level2: 'silver' },
  { id: 28, badge1_id: 'chase_down_artist', badge2_id: 'downhill', synergy_name: 'Block-to-Break', description: 'A chase-down stop instantly flips into a downhill outlet.', effect: { condition: 'transition', boost: { fastBreakChance: 0.10 } }, min_level1: 'silver', min_level2: 'silver' },
]

// Maps each synergy condition string to the simulation phase it fires in.
// Used by GameSimulator's synergy router so legacy entries don't need a
// `phase` field.
export const CONDITION_TO_PHASE = {
  // Shot-phase conditions (evaluated when the shooter resolves a shot)
  always: 'shot',
  three_pointer: 'shot',
  mid_range: 'shot',
  paint: 'shot',
  at_rim: 'shot',
  catch_and_shoot: 'shot',
  corner_three: 'shot',
  clutch: 'shot',
  isolation: 'shot',
  pick_and_roll: 'shot',
  alley_oop: 'shot',
  cutting: 'shot',
  mismatch: 'shot',
  screen_play: 'shot',

  // Defense-phase conditions (evaluated on the defensive lineup before shot
  // resolution; boost is subtracted from offense's shot probability)
  team_defense: 'defense',
  interior_defense: 'defense',
  paint_defense: 'defense',

  // Rebound-phase conditions (evaluated in handleReboundBattle)
  rebounding: 'rebound',
  offensive_rebound: 'rebound',

  // Transition-phase (evaluated when transition is rolled at possession start)
  transition: 'transition',
}
