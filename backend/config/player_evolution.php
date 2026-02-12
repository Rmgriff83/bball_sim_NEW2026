<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Age Brackets
    |--------------------------------------------------------------------------
    | Development and regression multipliers by age group.
    | Development: How fast a player can improve (1.0 = normal rate)
    | Regression: How fast a player declines (1.0 = normal rate)
    */
    'age_brackets' => [
        'youth'   => ['min' => 19, 'max' => 23, 'development' => 1.5, 'regression' => 0.0],
        'rising'  => ['min' => 24, 'max' => 26, 'development' => 1.0, 'regression' => 0.0],
        'prime'   => ['min' => 27, 'max' => 31, 'development' => 0.3, 'regression' => 0.1],
        'decline' => ['min' => 32, 'max' => 35, 'development' => 0.0, 'regression' => 0.5],
        'veteran' => ['min' => 36, 'max' => 45, 'development' => 0.0, 'regression' => 1.0],
    ],

    /*
    |--------------------------------------------------------------------------
    | Attribute Aging Profiles
    |--------------------------------------------------------------------------
    | Different attributes peak and decline at different ages.
    | peak_age: Age when attribute is at maximum
    | decline_start: Age when attribute starts declining
    | decline_rate: Points lost per year after decline starts
    | can_improve_past_peak: Whether attribute can still grow after peak
    */
    'attribute_profiles' => [
        'physical' => [
            'peak_age' => 26,
            'decline_start' => 29,
            'decline_rate' => 0.8,
            'can_improve_past_peak' => false,
            'attributes' => ['speed', 'acceleration', 'vertical', 'stamina'],
        ],
        'strength' => [
            'peak_age' => 30,
            'decline_start' => 33,
            'decline_rate' => 0.4,
            'can_improve_past_peak' => false,
            'attributes' => ['strength'],
        ],
        'shooting' => [
            'peak_age' => 29,
            'decline_start' => 34,
            'decline_rate' => 0.3,
            'can_improve_past_peak' => true,
            'attributes' => ['threePoint', 'midRange', 'freeThrow', 'closeShot'],
        ],
        'mental' => [
            'peak_age' => 32,
            'decline_start' => 37,
            'decline_rate' => 0.2,
            'can_improve_past_peak' => true,
            'attributes' => ['basketballIQ', 'clutch', 'consistency', 'intangibles'],
        ],
        'skill' => [
            'peak_age' => 28,
            'decline_start' => 33,
            'decline_rate' => 0.4,
            'can_improve_past_peak' => true,
            'attributes' => ['ballHandling', 'passAccuracy', 'passVision', 'passIQ', 'postControl', 'layup'],
        ],
        'finishing' => [
            'peak_age' => 27,
            'decline_start' => 31,
            'decline_rate' => 0.5,
            'can_improve_past_peak' => false,
            'attributes' => ['standingDunk', 'drivingDunk', 'drawFoul'],
        ],
        'defense' => [
            'peak_age' => 28,
            'decline_start' => 32,
            'decline_rate' => 0.4,
            'can_improve_past_peak' => true,
            'attributes' => ['perimeterDefense', 'interiorDefense', 'steal', 'block', 'helpDefenseIQ', 'passPerception'],
        ],
        'rebounding' => [
            'peak_age' => 29,
            'decline_start' => 33,
            'decline_rate' => 0.3,
            'can_improve_past_peak' => true,
            'attributes' => ['offensiveRebound', 'defensiveRebound'],
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Injury Configuration
    |--------------------------------------------------------------------------
    */
    'injuries' => [
        'base_chance' => 0.001, // 0.1% base chance per game

        'types' => [
            'minor' => [
                'duration' => [1, 5],
                'weight' => 60, // 60% of injuries are minor
                'permanent_impact' => 0,
                'injuries' => [
                    'sprained_ankle' => 'Sprained Ankle',
                    'bruised_knee' => 'Bruised Knee',
                    'sore_back' => 'Sore Back',
                    'finger_sprain' => 'Finger Sprain',
                    'hip_soreness' => 'Hip Soreness',
                    'wrist_soreness' => 'Wrist Soreness',
                ],
            ],
            'moderate' => [
                'duration' => [6, 20],
                'weight' => 30, // 30% of injuries
                'permanent_impact' => 0,
                'injuries' => [
                    'hamstring_strain' => 'Hamstring Strain',
                    'groin_injury' => 'Groin Injury',
                    'calf_strain' => 'Calf Strain',
                    'shoulder_sprain' => 'Shoulder Sprain',
                    'quad_strain' => 'Quad Strain',
                    'ankle_sprain_grade2' => 'Grade 2 Ankle Sprain',
                ],
            ],
            'severe' => [
                'duration' => [21, 60],
                'weight' => 8, // 8% of injuries
                'permanent_impact' => 1, // -1 to physical attributes permanently
                'injuries' => [
                    'torn_meniscus' => 'Torn Meniscus',
                    'broken_hand' => 'Broken Hand',
                    'stress_fracture' => 'Stress Fracture',
                    'concussion' => 'Concussion',
                    'torn_ligament' => 'Torn Ligament',
                ],
            ],
            'season_ending' => [
                'duration' => [61, 82],
                'weight' => 2, // 2% of injuries
                'permanent_impact' => 3, // -3 to physical attributes permanently
                'injuries' => [
                    'acl_tear' => 'ACL Tear',
                    'achilles_rupture' => 'Achilles Rupture',
                    'broken_leg' => 'Broken Leg',
                    'major_back_injury' => 'Major Back Injury',
                    'patellar_tendon_tear' => 'Patellar Tendon Tear',
                ],
            ],
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Personality Traits
    |--------------------------------------------------------------------------
    */
    'personality_traits' => [
        'competitor' => [
            'development_bonus' => 0.10,
            'clutch_boost' => 5,
            'playoff_performance' => 0.05,
        ],
        'leader' => [
            'chemistry_boost' => 5,
            'team_development' => 0.05,
            'morale_stability' => 0.3,
        ],
        'mentor' => [
            'young_player_boost' => 0.15, // Players age <= 24 on same team
            'own_development_penalty' => -0.05,
            'max_mentees' => 2,
        ],
        'hot_head' => [
            'morale_volatility' => 2.0,
            'tech_foul_chance' => 0.02,
            'ejection_chance' => 0.005,
        ],
        'ball_hog' => [
            'usage_boost' => 0.10,
            'chemistry_penalty' => -3,
            'assist_penalty' => -0.10,
        ],
        'team_player' => [
            'chemistry_boost' => 3,
            'assist_boost' => 0.10,
            'morale_stability' => 0.5,
        ],
        'joker' => [
            'chemistry_boost' => 2,
            'morale_boost' => 0.05,
        ],
        'quiet' => [
            'morale_stability' => 0.7,
            'media_profile_low' => true,
        ],
        'media_darling' => [
            'contract_bonus' => 0.05, // 5% higher contract value
            'pressure_penalty' => -0.02, // Slight performance drop under media scrutiny
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Badge Synergy Configuration
    |--------------------------------------------------------------------------
    */
    'badge_synergies' => [
        'development_boost_base' => 0.05, // +5% development per synergy
        'development_boost_hof' => 0.08, // +8% for HOF level badges
        'development_boost_max' => 0.15, // Maximum +15% from all synergies
        'in_game_boost' => 0.03, // +3% in-game performance
        'chemistry_contribution' => 2, // +2 team chemistry per synergy
    ],

    /*
    |--------------------------------------------------------------------------
    | Morale Settings
    |--------------------------------------------------------------------------
    */
    'morale' => [
        'starting' => 80,
        'min' => 0,
        'max' => 100,
        'trade_request_threshold' => 25,

        'factors' => [
            'win' => 1,
            'loss' => -1,
            'winning_streak_bonus' => 2, // 3+ game streak
            'losing_streak_penalty' => -2,
            'playing_time_met' => 1,
            'playing_time_unmet' => -3,
            'playing_time_exceeded' => 2,
            'final_contract_year' => -5,
            'extension_offered' => 10,
            'underpaid' => -3,
            'star_treatment' => 2,
        ],

        'effects' => [
            'high' => [
                'threshold' => 80,
                'development_modifier' => 0.05,
                'performance_modifier' => 0.02,
            ],
            'normal' => [
                'threshold' => 50,
                'development_modifier' => 0.0,
                'performance_modifier' => 0.0,
            ],
            'low' => [
                'threshold' => 25,
                'development_modifier' => -0.05,
                'performance_modifier' => -0.02,
            ],
            'critical' => [
                'threshold' => 0,
                'development_modifier' => -0.10,
                'performance_modifier' => -0.05,
            ],
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Development Formula Constants
    |--------------------------------------------------------------------------
    | Base values (not difficulty-dependent)
    */
    'development' => [
        'base_rate' => 0.10, // Base development rate
        'work_ethic_factor' => 0.50, // How much work ethic affects development
        'playing_time_factor' => 0.30, // How much playing time affects development
        'mentor_factor' => 0.20, // Mentor bonus
        'badge_synergy_factor' => 0.15, // Max badge synergy bonus

        'max_season_gain' => 5, // Maximum overall rating gain per season
        'max_season_loss' => 4, // Maximum overall rating loss per season

        // Opportunity development (backup getting starter minutes)
        'opportunity_multiplier' => 1.5,
    ],

    /*
    |--------------------------------------------------------------------------
    | Difficulty-Based Development Settings
    |--------------------------------------------------------------------------
    | Per-game micro-development thresholds and gains vary by difficulty.
    | Lower thresholds = easier to trigger growth.
    | Higher gains = more attribute improvement per good game.
    */
    'difficulty_settings' => [
        'rookie' => [
            // Very achievable growth - most decent performances trigger development
            'micro_dev_threshold_high' => 9,    // Reduced ~15% for shorter quarters
            'micro_dev_threshold_low' => 4,
            'micro_dev_gain_min' => 0.15,       // Higher gains
            'micro_dev_gain_max' => 0.4,
            'micro_dev_loss_min' => 0.05,       // Lower losses
            'micro_dev_loss_max' => 0.1,
            // Stat thresholds for which attributes improve
            'stat_thresholds' => [
                'points' => 10,
                'assists' => 3,
                'rebounds' => 4,
                'steals' => 1,
                'blocks' => 1,
                'threes' => 2,
            ],
            // Age bracket modifiers (multiply base values)
            'development_multiplier' => 1.3,    // 30% more development
            'regression_multiplier' => 0.7,     // 30% less regression
        ],
        'pro' => [
            // Balanced - good performances trigger development
            'micro_dev_threshold_high' => 12,   // Reduced ~15% for shorter quarters
            'micro_dev_threshold_low' => 5,
            'micro_dev_gain_min' => 0.1,
            'micro_dev_gain_max' => 0.3,
            'micro_dev_loss_min' => 0.08,
            'micro_dev_loss_max' => 0.15,
            'stat_thresholds' => [
                'points' => 13,
                'assists' => 4,
                'rebounds' => 5,
                'steals' => 2,
                'blocks' => 2,
                'threes' => 2,
            ],
            'development_multiplier' => 1.0,
            'regression_multiplier' => 1.0,
        ],
        'all_star' => [
            // Challenging - need solid performances for growth
            'micro_dev_threshold_high' => 15,   // Reduced ~15% for shorter quarters
            'micro_dev_threshold_low' => 6,
            'micro_dev_gain_min' => 0.08,
            'micro_dev_gain_max' => 0.25,
            'micro_dev_loss_min' => 0.1,
            'micro_dev_loss_max' => 0.2,
            'stat_thresholds' => [
                'points' => 15,
                'assists' => 5,
                'rebounds' => 6,
                'steals' => 2,
                'blocks' => 2,
                'threes' => 3,
            ],
            'development_multiplier' => 0.85,
            'regression_multiplier' => 1.15,
        ],
        'hall_of_fame' => [
            // Very challenging - need great performances for growth
            'micro_dev_threshold_high' => 19,   // Reduced ~15% for shorter quarters
            'micro_dev_threshold_low' => 7,
            'micro_dev_gain_min' => 0.05,
            'micro_dev_gain_max' => 0.2,
            'micro_dev_loss_min' => 0.12,
            'micro_dev_loss_max' => 0.25,
            'stat_thresholds' => [
                'points' => 19,
                'assists' => 6,
                'rebounds' => 7,
                'steals' => 2,
                'blocks' => 2,
                'threes' => 3,
            ],
            'development_multiplier' => 0.7,
            'regression_multiplier' => 1.3,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Streak Configuration
    |--------------------------------------------------------------------------
    */
    'streaks' => [
        'hot_streak_games' => 3, // Games needed to trigger hot streak
        'hot_streak_threshold' => 21, // Performance rating threshold (reduced ~15% for shorter quarters)
        'hot_streak_bonus' => 2, // Attribute bonus during streak

        'cold_streak_games' => 3,
        'cold_streak_threshold' => 9,
        'cold_streak_penalty' => -2,

        'max_streak_length' => 10, // Streaks cap at 10 games
    ],

    /*
    |--------------------------------------------------------------------------
    | Retirement Settings
    |--------------------------------------------------------------------------
    */
    'retirement' => [
        'min_age' => 35,
        'base_chance' => 0.10, // 10% base chance at min_age
        'age_factor' => 0.10, // Additional 10% per year over min_age
        'low_rating_threshold' => 65,
        'low_rating_bonus' => 0.15, // +15% retirement chance if below threshold
        'injury_history_factor' => 0.05, // +5% per major injury in career
    ],

    /*
    |--------------------------------------------------------------------------
    | Fatigue Settings
    |--------------------------------------------------------------------------
    */
    'fatigue' => [
        'per_minute_gain' => 0.4, // Fatigue gained per minute played (reduced 20% for shorter quarters)
        'max_fatigue' => 100,
        'weekly_recovery' => 15, // Fatigue recovered per week
        'rest_day_recovery' => 15, // Recovery when player doesn't play (0 mins or no game)
        'performance_penalty_start' => 50, // Fatigue level where penalties begin
        'max_performance_penalty' => 0.25, // Maximum 25% performance reduction
    ],

    /*
    |--------------------------------------------------------------------------
    | Rookie Wall
    |--------------------------------------------------------------------------
    | First-year players experience fatigue penalty after game threshold
    */
    'rookie_wall' => [
        'game_threshold' => 50, // After 50 games
        'fatigue_multiplier' => 1.5, // 50% more fatigue gain
        'duration_games' => 20, // Lasts for 20 games
    ],

    /*
    |--------------------------------------------------------------------------
    | Overall Rating Weights
    |--------------------------------------------------------------------------
    | How much each attribute category contributes to overall rating
    */
    'overall_weights' => [
        'offense' => 0.40,
        'defense' => 0.25,
        'physical' => 0.20,
        'mental' => 0.15,
    ],

    /*
    |--------------------------------------------------------------------------
    | Manual Upgrade Points Configuration
    |--------------------------------------------------------------------------
    | Settings for the player upgrade point system where users can manually
    | improve their players' attributes using earned upgrade points.
    |
    | Points per growth is scaled by potential rating (75 = 1.0x baseline):
    |   - 60 potential = ~0.8x multiplier
    |   - 75 potential = 1.0x multiplier (baseline)
    |   - 90 potential = 1.2x multiplier
    |   - 99 potential = ~1.32x multiplier
    |
    | Elite potential (90+) also gets +1 to max_weekly_points cap.
    */
    'upgrade_points' => [
        'enabled' => true,
        'points_per_growth' => 1.5,       // Base: 1.5 points per 1.0 growth (scaled by potential/75)
        'min_growth_threshold' => 0.3,    // Need 0.3+ total growth to earn any points
        'max_weekly_points' => 3,         // Cap at 3 points per week (4 for 90+ potential)
        'max_stored_points' => 99,        // Cap total stored points
    ],
];
