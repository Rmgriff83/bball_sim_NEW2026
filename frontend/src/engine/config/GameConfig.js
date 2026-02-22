// =============================================================================
// GameConfig.js
// =============================================================================
// Comprehensive game configuration translated from PHP backend config.
// Sources:
//   - backend/config/player_evolution.php
//   - backend/app/Services/GameSimulationService.php
//   - backend/app/Services/CoachingService.php
//   - backend/app/Services/SubstitutionService.php
// =============================================================================

// =============================================================================
// GAME SIMULATION CONSTANTS
// =============================================================================

export const QUARTERS = 4;
export const QUARTER_LENGTH_MINUTES = 10;
export const POSSESSIONS_PER_MINUTE = 2.2; // ~100 possessions per game
export const SHOT_CLOCK_SECONDS = 24;
export const OVERTIME_LENGTH_MINUTES = 5;
export const TOTAL_GAME_MINUTES = 40.0;

// =============================================================================
// AGE BRACKETS
// =============================================================================
// Development and regression multipliers by age group.
// Development: How fast a player can improve (1.0 = normal rate)
// Regression: How fast a player declines (1.0 = normal rate)

export const AGE_BRACKETS = {
  youth: { min: 19, max: 23, development: 1.5, regression: 0.0 },
  rising: { min: 24, max: 26, development: 1.0, regression: 0.0 },
  prime: { min: 27, max: 31, development: 0.3, regression: 0.1 },
  decline: { min: 32, max: 35, development: 0.0, regression: 0.5 },
  veteran: { min: 36, max: 45, development: 0.0, regression: 1.0 },
};

// =============================================================================
// ATTRIBUTE AGING PROFILES
// =============================================================================
// Different attributes peak and decline at different ages.
// peak_age: Age when attribute is at maximum
// decline_start: Age when attribute starts declining
// decline_rate: Points lost per year after decline starts
// can_improve_past_peak: Whether attribute can still grow after peak

export const ATTRIBUTE_PROFILES = {
  physical: {
    peak_age: 26,
    decline_start: 29,
    decline_rate: 0.8,
    can_improve_past_peak: false,
    attributes: ["speed", "acceleration", "vertical", "stamina"],
  },
  strength: {
    peak_age: 30,
    decline_start: 33,
    decline_rate: 0.4,
    can_improve_past_peak: false,
    attributes: ["strength"],
  },
  shooting: {
    peak_age: 29,
    decline_start: 34,
    decline_rate: 0.3,
    can_improve_past_peak: true,
    attributes: ["threePoint", "midRange", "freeThrow", "closeShot"],
  },
  mental: {
    peak_age: 32,
    decline_start: 37,
    decline_rate: 0.2,
    can_improve_past_peak: true,
    attributes: ["basketballIQ", "clutch", "consistency", "intangibles"],
  },
  skill: {
    peak_age: 28,
    decline_start: 33,
    decline_rate: 0.4,
    can_improve_past_peak: true,
    attributes: [
      "ballHandling",
      "passAccuracy",
      "passVision",
      "passIQ",
      "postControl",
      "layup",
    ],
  },
  finishing: {
    peak_age: 27,
    decline_start: 31,
    decline_rate: 0.5,
    can_improve_past_peak: false,
    attributes: ["standingDunk", "drivingDunk", "drawFoul"],
  },
  defense: {
    peak_age: 28,
    decline_start: 32,
    decline_rate: 0.4,
    can_improve_past_peak: true,
    attributes: [
      "perimeterDefense",
      "interiorDefense",
      "steal",
      "block",
      "helpDefenseIQ",
      "passPerception",
    ],
  },
  rebounding: {
    peak_age: 29,
    decline_start: 33,
    decline_rate: 0.3,
    can_improve_past_peak: true,
    attributes: ["offensiveRebound", "defensiveRebound"],
  },
};

// =============================================================================
// INJURY CONFIGURATION
// =============================================================================

export const INJURY_BASE_CHANCE = 0.001; // 0.1% base chance per game

export const INJURY_TYPES = {
  minor: {
    duration: [1, 5],
    weight: 60, // 60% of injuries are minor
    permanent_impact: 0,
    injuries: {
      sprained_ankle: "Sprained Ankle",
      bruised_knee: "Bruised Knee",
      sore_back: "Sore Back",
      finger_sprain: "Finger Sprain",
      hip_soreness: "Hip Soreness",
      wrist_soreness: "Wrist Soreness",
    },
  },
  moderate: {
    duration: [6, 20],
    weight: 30, // 30% of injuries
    permanent_impact: 0,
    injuries: {
      hamstring_strain: "Hamstring Strain",
      groin_injury: "Groin Injury",
      calf_strain: "Calf Strain",
      shoulder_sprain: "Shoulder Sprain",
      quad_strain: "Quad Strain",
      ankle_sprain_grade2: "Grade 2 Ankle Sprain",
    },
  },
  severe: {
    duration: [21, 60],
    weight: 8, // 8% of injuries
    permanent_impact: 1, // -1 to physical attributes permanently
    injuries: {
      torn_meniscus: "Torn Meniscus",
      broken_hand: "Broken Hand",
      stress_fracture: "Stress Fracture",
      concussion: "Concussion",
      torn_ligament: "Torn Ligament",
    },
  },
  season_ending: {
    duration: [61, 82],
    weight: 2, // 2% of injuries
    permanent_impact: 3, // -3 to physical attributes permanently
    injuries: {
      acl_tear: "ACL Tear",
      achilles_rupture: "Achilles Rupture",
      broken_leg: "Broken Leg",
      major_back_injury: "Major Back Injury",
      patellar_tendon_tear: "Patellar Tendon Tear",
    },
  },
};

// =============================================================================
// PERSONALITY TRAITS
// =============================================================================

export const PERSONALITY_TRAITS = {
  competitor: {
    development_bonus: 0.1,
    clutch_boost: 5,
    playoff_performance: 0.05,
  },
  leader: {
    chemistry_boost: 5,
    team_development: 0.05,
    morale_stability: 0.3,
  },
  mentor: {
    young_player_boost: 0.15, // Players age <= 24 on same team
    own_development_penalty: -0.05,
    max_mentees: 2,
  },
  hot_head: {
    morale_volatility: 2.0,
    tech_foul_chance: 0.02,
    ejection_chance: 0.005,
  },
  ball_hog: {
    usage_boost: 0.1,
    chemistry_penalty: -3,
    assist_penalty: -0.1,
  },
  team_player: {
    chemistry_boost: 3,
    assist_boost: 0.1,
    morale_stability: 0.5,
  },
  joker: {
    chemistry_boost: 2,
    morale_boost: 0.05,
  },
  quiet: {
    morale_stability: 0.7,
    media_profile_low: true,
  },
  media_darling: {
    contract_bonus: 0.05, // 5% higher contract value
    pressure_penalty: -0.02, // Slight performance drop under media scrutiny
  },
};

// =============================================================================
// BADGE SYNERGY CONFIGURATION
// =============================================================================

export const BADGE_SYNERGIES = {
  development_boost_by_level: {
    bronze: 0.03,
    silver: 0.05,
    gold: 0.06,
    hof: 0.08,
  },
  development_boost_max: 0.15, // Maximum +15% from all synergies
  in_game_boost: 0.03, // +3% in-game performance
  chemistry_contribution: 2, // +2 team chemistry per synergy
  dynamic_duo_boost: 0.02, // +2% all attributes
  dynamic_duo_min_synergies: 2, // 2+ gold+ synergies required
};

// =============================================================================
// MORALE SETTINGS
// =============================================================================

export const MORALE = {
  starting: 80,
  min: 0,
  max: 100,
  trade_request_threshold: 25,

  factors: {
    win: 1,
    loss: -1,
    winning_streak_bonus: 2, // 3+ game streak
    losing_streak_penalty: -2,
    playing_time_met: 1,
    playing_time_unmet: -3,
    playing_time_exceeded: 2,
    final_contract_year: -5,
    extension_offered: 10,
    underpaid: -3,
    star_treatment: 2,
  },

  effects: {
    high: {
      threshold: 80,
      development_modifier: 0.05,
      performance_modifier: 0.02,
    },
    normal: {
      threshold: 50,
      development_modifier: 0.0,
      performance_modifier: 0.0,
    },
    low: {
      threshold: 25,
      development_modifier: -0.05,
      performance_modifier: -0.02,
    },
    critical: {
      threshold: 0,
      development_modifier: -0.1,
      performance_modifier: -0.05,
    },
  },
};

// =============================================================================
// DEVELOPMENT FORMULA CONSTANTS
// =============================================================================
// Base values (not difficulty-dependent)

export const DEVELOPMENT = {
  base_rate: 0.1, // Base development rate
  work_ethic_factor: 0.5, // How much work ethic affects development
  playing_time_factor: 0.3, // How much playing time affects development
  mentor_factor: 0.2, // Mentor bonus
  badge_synergy_factor: 0.15, // Max badge synergy bonus

  max_season_gain: 5, // Maximum overall rating gain per season
  max_season_loss: 4, // Maximum overall rating loss per season

  // Opportunity development (backup getting starter minutes)
  opportunity_multiplier: 1.5,
};

// =============================================================================
// DIFFICULTY-BASED DEVELOPMENT SETTINGS
// =============================================================================
// Per-game micro-development thresholds and gains vary by difficulty.
// Performance rating uses a PER-inspired formula (average ~15).
// Stat thresholds are per-36-minute baselines, auto-scaled by actual minutes.

export const DIFFICULTY_SETTINGS = {
  rookie: {
    // Very achievable growth - most decent performances trigger development
    micro_dev_threshold_high: 13, // PER-scale: slightly below average triggers growth
    micro_dev_threshold_low: 6, // Only truly bad games regress
    micro_dev_gain_min: 0.15, // Higher gains
    micro_dev_gain_max: 0.4,
    micro_dev_loss_min: 0.04, // Lower losses
    micro_dev_loss_max: 0.08,
    min_minutes_for_regression: 12, // Need 12+ min for regression to apply
    // Per-36-minute stat thresholds (auto-scaled by actual minutes played)
    stat_thresholds: {
      points: 12,
      assists: 3,
      rebounds: 5,
      steals: 1,
      blocks: 1,
      threes: 2,
    },
    // Age bracket modifiers (multiply base values)
    development_multiplier: 1.3, // 30% more development
    regression_multiplier: 0.7, // 30% less regression
  },
  pro: {
    // Balanced - above-average performances trigger development
    micro_dev_threshold_high: 16, // PER-scale: above average triggers growth
    micro_dev_threshold_low: 8, // Below average triggers regression
    micro_dev_gain_min: 0.1,
    micro_dev_gain_max: 0.3,
    micro_dev_loss_min: 0.05,
    micro_dev_loss_max: 0.1,
    min_minutes_for_regression: 10,
    stat_thresholds: {
      points: 14,
      assists: 4,
      rebounds: 5,
      steals: 1,
      blocks: 1,
      threes: 2,
    },
    development_multiplier: 1.0,
    regression_multiplier: 1.0,
  },
  all_star: {
    // Challenging - need solid performances for growth
    micro_dev_threshold_high: 19, // PER-scale: need good games for growth
    micro_dev_threshold_low: 10, // Average-ish games trigger regression
    micro_dev_gain_min: 0.08,
    micro_dev_gain_max: 0.25,
    micro_dev_loss_min: 0.06,
    micro_dev_loss_max: 0.15,
    min_minutes_for_regression: 10,
    stat_thresholds: {
      points: 16,
      assists: 5,
      rebounds: 6,
      steals: 2,
      blocks: 2,
      threes: 2,
    },
    development_multiplier: 0.85,
    regression_multiplier: 1.15,
  },
  hall_of_fame: {
    // Very challenging - need great performances for growth
    micro_dev_threshold_high: 22, // PER-scale: need great games for growth
    micro_dev_threshold_low: 12, // Below-average games trigger regression
    micro_dev_gain_min: 0.05,
    micro_dev_gain_max: 0.2,
    micro_dev_loss_min: 0.08,
    micro_dev_loss_max: 0.2,
    min_minutes_for_regression: 8,
    stat_thresholds: {
      points: 18,
      assists: 6,
      rebounds: 7,
      steals: 2,
      blocks: 2,
      threes: 3,
    },
    development_multiplier: 0.7,
    regression_multiplier: 1.3,
  },
};

// =============================================================================
// STREAK CONFIGURATION
// =============================================================================

export const STREAKS = {
  hot_streak_games: 3, // Games needed to trigger hot streak
  hot_streak_threshold: 22, // PER-scale: 3 consecutive great games (~All-Star level)
  hot_streak_bonus: 2, // Attribute bonus during streak

  cold_streak_games: 3,
  cold_streak_threshold: 8, // PER-scale: 3 consecutive poor games
  cold_streak_penalty: -2,

  max_streak_length: 10, // Streaks cap at 10 games
};

// =============================================================================
// RETIREMENT SETTINGS
// =============================================================================

export const RETIREMENT = {
  min_age: 35,
  base_chance: 0.1, // 10% base chance at min_age
  age_factor: 0.1, // Additional 10% per year over min_age
  low_rating_threshold: 65,
  low_rating_bonus: 0.15, // +15% retirement chance if below threshold
  injury_history_factor: 0.05, // +5% per major injury in career
};

// =============================================================================
// FATIGUE SETTINGS
// =============================================================================

export const FATIGUE = {
  minute_thresholds: [
    // 0-8 mins: light duty -- player stays loose, net fatigue RECOVERY
    { min: 0, max: 8, type: "recovery", base: 6.4 },
    // 9-20 mins: rotation role -- marginal fatigue gain
    { min: 9, max: 20, type: "gain", base: 1.0 },
    // 21-30 mins: significant role -- moderate fatigue gain
    { min: 21, max: 30, type: "gain", base: 3.2 },
    // 31+ mins: heavy minutes -- significant fatigue gain
    { min: 31, max: 48, type: "gain", base: 6.5 },
  ],
  max_fatigue: 100,
  weekly_recovery: 19.5,
  rest_day_recovery: 22.0,
  performance_penalty_start: 50,
  max_performance_penalty: 0.25,
};

// =============================================================================
// ROOKIE WALL
// =============================================================================
// First-year players experience fatigue penalty after game threshold

export const ROOKIE_WALL = {
  game_threshold: 50, // After 50 games
  fatigue_multiplier: 1.5, // 50% more fatigue gain
  duration_games: 20, // Lasts for 20 games
};

// =============================================================================
// OVERALL RATING WEIGHTS
// =============================================================================
// How much each attribute category contributes to overall rating

export const OVERALL_WEIGHTS = {
  offense: 0.4,
  defense: 0.25,
  physical: 0.2,
  mental: 0.15,
};

// =============================================================================
// MANUAL UPGRADE POINTS CONFIGURATION
// =============================================================================
// Settings for the player upgrade point system where users can manually
// improve their players' attributes using earned upgrade points.
//
// Points per growth is scaled by potential rating (75 = 1.0x baseline):
//   - 60 potential = ~0.8x multiplier
//   - 75 potential = 1.0x multiplier (baseline)
//   - 90 potential = 1.2x multiplier
//   - 99 potential = ~1.32x multiplier
//
// Elite potential (90+) also gets +1 to max_weekly_points cap.

export const UPGRADE_POINTS = {
  enabled: true,
  points_per_growth: 1.5, // Base: 1.5 points per 1.0 growth (scaled by potential/75)
  min_growth_threshold: 0.3, // Need 0.3+ total growth to earn any points
  max_weekly_points: 3, // Cap at 3 points per week (4 for 90+ potential)
  max_stored_points: 99, // Cap total stored points
};

// =============================================================================
// COACHING - OFFENSIVE SCHEMES
// =============================================================================

export const OFFENSIVE_SCHEMES = {
  balanced: {
    name: "Balanced",
    description:
      "Balanced offense with varied play selection based on matchups",
    pace: "medium",
    strengths: ["versatility", "adaptability"],
    weaknesses: ["no dominant strategy"],
  },
  motion: {
    name: "Motion Offense",
    description:
      "Motion-heavy offense emphasizing ball movement, screens, and cuts",
    pace: "medium",
    strengths: ["ball movement", "open shots", "team chemistry"],
    weaknesses: ["requires high IQ players", "takes time to develop"],
  },
  iso_heavy: {
    name: "Isolation Heavy",
    description: "Isolation-focused offense maximizing star player usage",
    pace: "slow",
    strengths: ["star players shine", "late game execution"],
    weaknesses: ["predictable", "role players underutilized"],
  },
  post_centric: {
    name: "Post Centric",
    description: "Post-up heavy offense utilizing big men as primary scorers",
    pace: "slow",
    strengths: ["physical play", "rebounding", "free throws"],
    weaknesses: ["spacing issues", "slower pace"],
  },
  three_point: {
    name: "Three-Point Oriented",
    description: "Perimeter-oriented offense maximizing three-point attempts",
    pace: "fast",
    strengths: ["high scoring potential", "floor spacing"],
    weaknesses: ["variance", "cold shooting nights"],
  },
  run_and_gun: {
    name: "Run and Gun",
    description:
      "Fast-paced transition offense pushing tempo at every opportunity",
    pace: "very_fast",
    strengths: ["fast break points", "tiring opponents"],
    weaknesses: ["turnovers", "defensive lapses"],
  },
};

// =============================================================================
// COACHING - DEFENSIVE SCHEMES
// =============================================================================
// Note: Modifiers reduced ~15% from original to favor offense slightly.

export const DEFENSIVE_SCHEMES = {
  man: {
    name: "Man-to-Man",
    description:
      "Traditional man-to-man defense with strong individual matchups",
    modifiers: {
      iso_defense: 0.1,
      screen_vulnerability: -0.08,
      contest_boost: 0.04,
      steal_boost: 0.025,
    },
    weaknesses: ["pick_and_roll", "motion"],
    strengths: ["isolation", "post_up"],
  },
  zone_2_3: {
    name: "2-3 Zone",
    description:
      "Zone defense protecting the paint with two guards up top and three bigs below",
    modifiers: {
      paint_protection: 0.12,
      corner_three_weakness: -0.1,
      block_boost: 0.06,
    },
    weaknesses: ["spot_up", "corner_three"],
    strengths: ["post_up", "drive"],
  },
  zone_3_2: {
    name: "3-2 Zone",
    description:
      "Zone defense with three players up top to contest perimeter shots",
    modifiers: {
      perimeter_protection: 0.08,
      high_post_weakness: -0.08,
    },
    weaknesses: ["high_post", "cut"],
    strengths: ["three_point", "spot_up"],
  },
  zone_1_3_1: {
    name: "1-3-1 Zone",
    description:
      "Aggressive trapping zone that forces turnovers but vulnerable to skip passes",
    modifiers: {
      turnover_boost: 0.06,
      skip_pass_weakness: -0.12,
      steal_boost: 0.08,
    },
    weaknesses: ["skip_pass", "wing_three"],
    strengths: ["isolation"],
  },
  press: {
    name: "Full Court Press",
    description:
      "High-pressure full court defense forcing turnovers but risky in transition",
    modifiers: {
      turnover_boost: 0.1,
      transition_weakness: -0.17,
      steal_boost: 0.06,
    },
    weaknesses: ["transition", "fastbreak"],
    strengths: ["slow_offense"],
  },
  trap: {
    name: "Trapping Defense",
    description:
      "Double-team oriented defense creating steals but leaving shooters open",
    modifiers: {
      steal_boost: 0.1,
      open_shooter_weakness: -0.12,
      turnover_boost: 0.05,
    },
    weaknesses: ["spot_up", "corner_three"],
    strengths: ["isolation"],
  },
};

// =============================================================================
// COACHING - SCHEME PLAY WEIGHTS
// =============================================================================
// Play category weight multipliers for each offensive scheme.

export const SCHEME_PLAY_WEIGHTS = {
  balanced: {
    pick_and_roll: 1.2,
    isolation: 1.0,
    post_up: 1.0,
    motion: 1.0,
    cut: 1.0,
    spot_up: 1.0,
    transition: 1.0,
  },
  motion: {
    motion: 2.0,
    cut: 1.5,
    pick_and_roll: 1.2,
    isolation: 0.5,
    post_up: 0.8,
    spot_up: 1.0,
    transition: 1.0,
  },
  iso_heavy: {
    isolation: 2.5,
    pick_and_roll: 1.2,
    post_up: 1.0,
    motion: 0.5,
    cut: 0.6,
    spot_up: 0.8,
    transition: 1.0,
  },
  post_centric: {
    post_up: 2.5,
    pick_and_roll: 1.0,
    cut: 1.2,
    isolation: 0.7,
    motion: 0.8,
    spot_up: 0.8,
    transition: 0.8,
  },
  three_point: {
    spot_up: 2.0,
    pick_and_roll: 1.5,
    motion: 1.3,
    isolation: 0.8,
    post_up: 0.5,
    cut: 1.0,
    transition: 1.2,
  },
  run_and_gun: {
    transition: 2.5,
    pick_and_roll: 1.3,
    spot_up: 1.2,
    isolation: 1.0,
    motion: 0.7,
    post_up: 0.5,
    cut: 0.8,
  },
};

// =============================================================================
// COACHING - TEMPO MODIFIERS
// =============================================================================
// Affects pace of play per scheme.

export const TEMPO_MODIFIERS = {
  run_and_gun: 1.3, // Faster possessions
  three_point: 1.1, // Slightly faster
  balanced: 1.0, // Normal pace
  motion: 0.95, // Slightly slower (more passes)
  iso_heavy: 0.9, // Slower (work the clock)
  post_centric: 0.85, // Slowest (feed the post)
};

// =============================================================================
// COACHING - TRANSITION FREQUENCIES
// =============================================================================
// Probability of pushing in transition per scheme.

export const TRANSITION_FREQUENCIES = {
  run_and_gun: 0.4, // Push frequently
  three_point: 0.25, // Sometimes push
  balanced: 0.2, // Normal
  motion: 0.15, // Prefer halfcourt
  iso_heavy: 0.15, // Prefer halfcourt
  post_centric: 0.1, // Rarely push
};

// =============================================================================
// SUBSTITUTION CONSTANTS
// =============================================================================

export const SUBSTITUTION_CHECK_INTERVAL_MINUTES = 2.0;
export const SUBSTITUTION_VARIANCE_RANGE = 0.15;
export const CLOSE_GAME_THRESHOLD = 6;

export const SUBSTITUTION_STRATEGIES = {
  staggered: {
    name: "Staggered",
    description:
      "Stars rest in shifts. At least one playmaker always on floor. Max 2 subs at a time.",
    type: "balanced",
    rotation_depth: "8-9 players",
    strengths: ["Continuity", "Matchup Flexibility"],
    weaknesses: ["Star Fatigue Risk"],
    pace_threshold: 1.5,
    max_subs_per_check: 2,
  },
  platoon: {
    name: "Platoon",
    description:
      "Swap groups of 2-3 players at defined intervals. Unit chemistry over individual matchups.",
    type: "balanced",
    rotation_depth: "8-10 players",
    strengths: ["Unit Chemistry", "Predictable Rhythm"],
    weaknesses: ["Transition Gaps"],
    pace_threshold: 2.0,
    max_subs_per_check: 3,
  },
  tight_rotation: {
    name: "Tight Rotation",
    description:
      "Lean heavily on top 7 players. Stars play big minutes. Bench only for short rest.",
    type: "aggressive",
    rotation_depth: "7-8 players",
    strengths: ["Star Maximization", "Closing Lineup"],
    weaknesses: ["Fatigue Risk", "Thin Depth"],
    pace_threshold: 2.5,
    max_subs_per_check: 2,
  },
  deep_bench: {
    name: "Deep Bench",
    description:
      "Spread minutes across 9-10 players. Everyone contributes. Fresh legs all game.",
    type: "passive",
    rotation_depth: "9-10 players",
    strengths: ["Fresh Legs", "Injury Insurance"],
    weaknesses: ["Fewer Star Minutes", "Less Continuity"],
    pace_threshold: 1.0,
    max_subs_per_check: 3,
  },
};
