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
    */
    'development' => [
        'base_rate' => 0.10, // Base development rate
        'work_ethic_factor' => 0.50, // How much work ethic affects development
        'playing_time_factor' => 0.30, // How much playing time affects development
        'mentor_factor' => 0.20, // Mentor bonus
        'badge_synergy_factor' => 0.15, // Max badge synergy bonus

        'max_season_gain' => 5, // Maximum overall rating gain per season
        'max_season_loss' => 4, // Maximum overall rating loss per season

        // Per-game micro-development
        'micro_dev_threshold_high' => 20, // Performance rating above this = development
        'micro_dev_threshold_low' => 8, // Performance rating below this = regression
        'micro_dev_gain_min' => 0.1,
        'micro_dev_gain_max' => 0.3,
        'micro_dev_loss_min' => 0.1,
        'micro_dev_loss_max' => 0.2,

        // Opportunity development (backup getting starter minutes)
        'opportunity_multiplier' => 1.5,
    ],

    /*
    |--------------------------------------------------------------------------
    | Streak Configuration
    |--------------------------------------------------------------------------
    */
    'streaks' => [
        'hot_streak_games' => 3, // Games needed to trigger hot streak
        'hot_streak_threshold' => 25, // Performance rating threshold
        'hot_streak_bonus' => 2, // Attribute bonus during streak

        'cold_streak_games' => 3,
        'cold_streak_threshold' => 10,
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
        'per_minute_gain' => 0.5, // Fatigue gained per minute played
        'max_fatigue' => 100,
        'weekly_recovery' => 15, // Fatigue recovered per week
        'rest_day_recovery' => 25, // Extra recovery on rest days
        'performance_penalty_start' => 50, // Fatigue level where penalties begin
        'max_performance_penalty' => 0.15, // Maximum 15% performance reduction
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
];
