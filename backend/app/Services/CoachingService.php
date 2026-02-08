<?php

namespace App\Services;

class CoachingService
{
    /**
     * Available offensive coaching schemes with descriptions.
     */
    public const SCHEMES = [
        'balanced' => [
            'name' => 'Balanced',
            'description' => 'Balanced offense with varied play selection based on matchups',
            'pace' => 'medium',
            'strengths' => ['versatility', 'adaptability'],
            'weaknesses' => ['no dominant strategy'],
        ],
        'motion' => [
            'name' => 'Motion Offense',
            'description' => 'Motion-heavy offense emphasizing ball movement, screens, and cuts',
            'pace' => 'medium',
            'strengths' => ['ball movement', 'open shots', 'team chemistry'],
            'weaknesses' => ['requires high IQ players', 'takes time to develop'],
        ],
        'iso_heavy' => [
            'name' => 'Isolation Heavy',
            'description' => 'Isolation-focused offense maximizing star player usage',
            'pace' => 'slow',
            'strengths' => ['star players shine', 'late game execution'],
            'weaknesses' => ['predictable', 'role players underutilized'],
        ],
        'post_centric' => [
            'name' => 'Post Centric',
            'description' => 'Post-up heavy offense utilizing big men as primary scorers',
            'pace' => 'slow',
            'strengths' => ['physical play', 'rebounding', 'free throws'],
            'weaknesses' => ['spacing issues', 'slower pace'],
        ],
        'three_point' => [
            'name' => 'Three-Point Oriented',
            'description' => 'Perimeter-oriented offense maximizing three-point attempts',
            'pace' => 'fast',
            'strengths' => ['high scoring potential', 'floor spacing'],
            'weaknesses' => ['variance', 'cold shooting nights'],
        ],
        'run_and_gun' => [
            'name' => 'Run and Gun',
            'description' => 'Fast-paced transition offense pushing tempo at every opportunity',
            'pace' => 'very_fast',
            'strengths' => ['fast break points', 'tiring opponents'],
            'weaknesses' => ['turnovers', 'defensive lapses'],
        ],
    ];

    /**
     * Available defensive schemes with modifiers.
     * Note: Modifiers reduced ~15% from original to favor offense slightly.
     */
    public const DEFENSIVE_SCHEMES = [
        'man' => [
            'name' => 'Man-to-Man',
            'description' => 'Traditional man-to-man defense with strong individual matchups',
            'modifiers' => [
                'iso_defense' => 0.10,
                'screen_vulnerability' => -0.08,
                'contest_boost' => 0.04,
                'steal_boost' => 0.025,
            ],
            'weaknesses' => ['pick_and_roll', 'motion'],
            'strengths' => ['isolation', 'post_up'],
        ],
        'zone_2_3' => [
            'name' => '2-3 Zone',
            'description' => 'Zone defense protecting the paint with two guards up top and three bigs below',
            'modifiers' => [
                'paint_protection' => 0.12,
                'corner_three_weakness' => -0.10,
                'block_boost' => 0.06,
            ],
            'weaknesses' => ['spot_up', 'corner_three'],
            'strengths' => ['post_up', 'drive'],
        ],
        'zone_3_2' => [
            'name' => '3-2 Zone',
            'description' => 'Zone defense with three players up top to contest perimeter shots',
            'modifiers' => [
                'perimeter_protection' => 0.08,
                'high_post_weakness' => -0.08,
            ],
            'weaknesses' => ['high_post', 'cut'],
            'strengths' => ['three_point', 'spot_up'],
        ],
        'zone_1_3_1' => [
            'name' => '1-3-1 Zone',
            'description' => 'Aggressive trapping zone that forces turnovers but vulnerable to skip passes',
            'modifiers' => [
                'turnover_boost' => 0.06,
                'skip_pass_weakness' => -0.12,
                'steal_boost' => 0.08,
            ],
            'weaknesses' => ['skip_pass', 'wing_three'],
            'strengths' => ['isolation'],
        ],
        'press' => [
            'name' => 'Full Court Press',
            'description' => 'High-pressure full court defense forcing turnovers but risky in transition',
            'modifiers' => [
                'turnover_boost' => 0.10,
                'transition_weakness' => -0.17,
                'steal_boost' => 0.06,
            ],
            'weaknesses' => ['transition', 'fastbreak'],
            'strengths' => ['slow_offense'],
        ],
        'trap' => [
            'name' => 'Trapping Defense',
            'description' => 'Double-team oriented defense creating steals but leaving shooters open',
            'modifiers' => [
                'steal_boost' => 0.10,
                'open_shooter_weakness' => -0.12,
                'turnover_boost' => 0.05,
            ],
            'weaknesses' => ['spot_up', 'corner_three'],
            'strengths' => ['isolation'],
        ],
    ];

    /**
     * Get all available coaching schemes.
     */
    public function getSchemes(): array
    {
        return self::SCHEMES;
    }

    /**
     * Get a specific scheme by ID.
     */
    public function getScheme(string $schemeId): ?array
    {
        return self::SCHEMES[$schemeId] ?? null;
    }

    /**
     * Get play category weights for a scheme.
     */
    public function getSchemePlayWeights(string $scheme): array
    {
        return match($scheme) {
            'motion' => [
                'motion' => 2.0,
                'cut' => 1.5,
                'pick_and_roll' => 1.2,
                'isolation' => 0.5,
                'post_up' => 0.8,
                'spot_up' => 1.0,
                'transition' => 1.0,
            ],
            'iso_heavy' => [
                'isolation' => 2.5,
                'pick_and_roll' => 1.2,
                'post_up' => 1.0,
                'motion' => 0.5,
                'cut' => 0.6,
                'spot_up' => 0.8,
                'transition' => 1.0,
            ],
            'post_centric' => [
                'post_up' => 2.5,
                'pick_and_roll' => 1.0,
                'cut' => 1.2,
                'isolation' => 0.7,
                'motion' => 0.8,
                'spot_up' => 0.8,
                'transition' => 0.8,
            ],
            'three_point' => [
                'spot_up' => 2.0,
                'pick_and_roll' => 1.5,
                'motion' => 1.3,
                'isolation' => 0.8,
                'post_up' => 0.5,
                'cut' => 1.0,
                'transition' => 1.2,
            ],
            'run_and_gun' => [
                'transition' => 2.5,
                'pick_and_roll' => 1.3,
                'spot_up' => 1.2,
                'isolation' => 1.0,
                'motion' => 0.7,
                'post_up' => 0.5,
                'cut' => 0.8,
            ],
            default => [ // balanced
                'pick_and_roll' => 1.2,
                'isolation' => 1.0,
                'post_up' => 1.0,
                'motion' => 1.0,
                'cut' => 1.0,
                'spot_up' => 1.0,
                'transition' => 1.0,
            ],
        };
    }

    /**
     * Adjust play probabilities based on scheme.
     */
    public function adjustPlayProbabilities(array $plays, string $scheme): array
    {
        $weights = $this->getSchemePlayWeights($scheme);
        $adjusted = [];

        foreach ($plays as $play) {
            $category = $play['category'] ?? 'motion';
            $weight = $weights[$category] ?? 1.0;

            $adjusted[] = [
                'play' => $play,
                'weight' => $weight,
            ];
        }

        return $adjusted;
    }

    /**
     * Get tempo modifier for a scheme (affects pace of play).
     */
    public function getTempoModifier(string $scheme): float
    {
        return match($scheme) {
            'run_and_gun' => 1.3,   // Faster possessions
            'three_point' => 1.1,   // Slightly faster
            'balanced' => 1.0,      // Normal pace
            'motion' => 0.95,       // Slightly slower (more passes)
            'iso_heavy' => 0.9,     // Slower (work the clock)
            'post_centric' => 0.85, // Slowest (feed the post)
            default => 1.0,
        };
    }

    /**
     * Get transition play frequency for a scheme.
     */
    public function getTransitionFrequency(string $scheme): float
    {
        return match($scheme) {
            'run_and_gun' => 0.4,   // Push frequently
            'three_point' => 0.25,  // Sometimes push
            'balanced' => 0.2,      // Normal
            'motion' => 0.15,       // Prefer halfcourt
            'iso_heavy' => 0.15,    // Prefer halfcourt
            'post_centric' => 0.1,  // Rarely push
            default => 0.2,
        };
    }

    /**
     * Check if a scheme favors a certain play category.
     */
    public function schemesFavorCategory(string $scheme, string $category): bool
    {
        $weights = $this->getSchemePlayWeights($scheme);
        return ($weights[$category] ?? 1.0) >= 1.5;
    }

    /**
     * Get recommended scheme based on roster composition.
     */
    public function recommendScheme(array $roster): string
    {
        $avgThreePoint = 0;
        $avgPostControl = 0;
        $avgSpeed = 0;
        $avgBasketballIQ = 0;
        $hasStarPlayer = false;
        $count = min(count($roster), 8); // Consider top 8 players

        for ($i = 0; $i < $count; $i++) {
            $player = $roster[$i];
            $attrs = $player['attributes'] ?? [];

            $avgThreePoint += $attrs['offense']['threePoint'] ?? 50;
            $avgPostControl += $attrs['offense']['postControl'] ?? 50;
            $avgSpeed += $attrs['physical']['speed'] ?? 50;
            $avgBasketballIQ += $attrs['mental']['basketballIQ'] ?? 50;

            if (($player['overallRating'] ?? 0) >= 85) {
                $hasStarPlayer = true;
            }
        }

        if ($count > 0) {
            $avgThreePoint /= $count;
            $avgPostControl /= $count;
            $avgSpeed /= $count;
            $avgBasketballIQ /= $count;
        }

        // Determine best fit
        if ($avgSpeed >= 80 && $avgThreePoint >= 70) {
            return 'run_and_gun';
        }

        if ($avgThreePoint >= 75) {
            return 'three_point';
        }

        if ($avgPostControl >= 75) {
            return 'post_centric';
        }

        if ($hasStarPlayer && $avgBasketballIQ < 65) {
            return 'iso_heavy';
        }

        if ($avgBasketballIQ >= 70) {
            return 'motion';
        }

        return 'balanced';
    }

    /**
     * Calculate scheme effectiveness rating for a roster.
     */
    public function calculateSchemeEffectiveness(string $scheme, array $roster): float
    {
        $effectiveness = 50.0; // Base

        $avgRating = 0;
        $count = 0;
        foreach ($roster as $player) {
            $avgRating += $player['overallRating'] ?? 70;
            $count++;
        }
        $avgRating = $count > 0 ? $avgRating / $count : 70;

        // Base effectiveness from talent
        $effectiveness += ($avgRating - 70) * 0.5;

        // Scheme-specific adjustments
        $schemeData = self::SCHEMES[$scheme] ?? self::SCHEMES['balanced'];

        // Check if roster matches scheme requirements
        switch ($scheme) {
            case 'three_point':
                $avgThree = $this->getRosterAverage($roster, 'offense', 'threePoint');
                $effectiveness += ($avgThree - 60) * 0.3;
                break;

            case 'post_centric':
                $avgPost = $this->getRosterAverage($roster, 'offense', 'postControl');
                $effectiveness += ($avgPost - 60) * 0.3;
                break;

            case 'motion':
                $avgIQ = $this->getRosterAverage($roster, 'mental', 'basketballIQ');
                $effectiveness += ($avgIQ - 60) * 0.3;
                break;

            case 'run_and_gun':
                $avgSpeed = $this->getRosterAverage($roster, 'physical', 'speed');
                $effectiveness += ($avgSpeed - 60) * 0.3;
                break;

            case 'iso_heavy':
                $maxRating = 0;
                foreach ($roster as $player) {
                    $maxRating = max($maxRating, $player['overallRating'] ?? 0);
                }
                $effectiveness += ($maxRating - 80) * 0.5;
                break;
        }

        return max(30, min(100, $effectiveness));
    }

    /**
     * Get average attribute for roster.
     */
    private function getRosterAverage(array $roster, string $category, string $attribute): float
    {
        $total = 0;
        $count = 0;

        foreach ($roster as $player) {
            $value = $player['attributes'][$category][$attribute] ?? null;
            if ($value !== null) {
                $total += $value;
                $count++;
            }
        }

        return $count > 0 ? $total / $count : 50;
    }

    /**
     * Get all available defensive schemes.
     */
    public function getDefensiveSchemes(): array
    {
        return self::DEFENSIVE_SCHEMES;
    }

    /**
     * Get a specific defensive scheme by ID.
     */
    public function getDefensiveScheme(string $schemeId): ?array
    {
        return self::DEFENSIVE_SCHEMES[$schemeId] ?? null;
    }

    /**
     * Calculate defensive modifiers based on scheme and play category.
     * Returns an array of modifiers to apply to play outcomes.
     *
     * @param string $scheme The defensive scheme ID
     * @param array $play The play being run against this defense
     * @return array Modifiers: shotModifier, turnoverModifier, blockModifier, stealModifier
     */
    public function calculateDefensiveModifiers(string $scheme, array $play): array
    {
        $schemeData = self::DEFENSIVE_SCHEMES[$scheme] ?? self::DEFENSIVE_SCHEMES['man'];
        $playCategory = $play['category'] ?? 'motion';

        $modifiers = [
            'shotModifier' => 0.0,      // Applied to made shot probability (negative = harder)
            'turnoverModifier' => 0.0,  // Applied to turnover probability (positive = more turnovers)
            'blockModifier' => 0.0,     // Applied to block probability (positive = more blocks)
            'stealModifier' => 0.0,     // Applied to steal probability (positive = more steals)
        ];

        // Apply base modifiers from scheme
        $schemeModifiers = $schemeData['modifiers'] ?? [];

        // Block boost
        if (isset($schemeModifiers['block_boost'])) {
            $modifiers['blockModifier'] += $schemeModifiers['block_boost'];
        }

        // Steal boost
        if (isset($schemeModifiers['steal_boost'])) {
            $modifiers['stealModifier'] += $schemeModifiers['steal_boost'];
        }

        // Turnover boost
        if (isset($schemeModifiers['turnover_boost'])) {
            $modifiers['turnoverModifier'] += $schemeModifiers['turnover_boost'];
        }

        // Check if play exploits scheme weakness
        $weaknesses = $schemeData['weaknesses'] ?? [];
        $strengths = $schemeData['strengths'] ?? [];

        if (in_array($playCategory, $weaknesses)) {
            // Play is strong against this defense
            $modifiers['shotModifier'] += 0.10;  // +10% shooting (boosted for offense)
            $modifiers['turnoverModifier'] -= 0.06;  // -6% turnovers
        }

        if (in_array($playCategory, $strengths)) {
            // Defense is strong against this play (reduced impact for offense)
            $modifiers['shotModifier'] -= 0.07;  // -7% shooting (was -10%)
            $modifiers['turnoverModifier'] += 0.04;  // +4% turnovers (was +5%)
        }

        // Apply specific modifiers based on play type
        if ($playCategory === 'isolation' && isset($schemeModifiers['iso_defense'])) {
            $modifiers['shotModifier'] -= $schemeModifiers['iso_defense'];
        }

        if (in_array($playCategory, ['pick_and_roll', 'motion']) && isset($schemeModifiers['screen_vulnerability'])) {
            $modifiers['shotModifier'] -= $schemeModifiers['screen_vulnerability'];
        }

        if ($playCategory === 'post_up' && isset($schemeModifiers['paint_protection'])) {
            $modifiers['shotModifier'] -= $schemeModifiers['paint_protection'];
            $modifiers['blockModifier'] += 0.05;
        }

        if (in_array($playCategory, ['spot_up', 'three_point']) && isset($schemeModifiers['corner_three_weakness'])) {
            $modifiers['shotModifier'] -= $schemeModifiers['corner_three_weakness'];
        }

        if ($playCategory === 'transition' && isset($schemeModifiers['transition_weakness'])) {
            $modifiers['shotModifier'] -= $schemeModifiers['transition_weakness'];
        }

        // Contest boost applies to all shots
        if (isset($schemeModifiers['contest_boost'])) {
            $modifiers['shotModifier'] -= $schemeModifiers['contest_boost'];
        }

        return $modifiers;
    }
}
