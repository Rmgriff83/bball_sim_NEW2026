<?php

namespace App\Services\PlayerEvolution;

use Carbon\Carbon;

class DevelopmentCalculator
{
    private array $config;
    private string $difficulty = 'pro';

    public function __construct()
    {
        $this->config = config('player_evolution');
    }

    /**
     * Set the difficulty level for calculations.
     */
    public function setDifficulty(string $difficulty): self
    {
        $this->difficulty = $difficulty;
        return $this;
    }

    /**
     * Get difficulty-specific settings.
     */
    public function getDifficultySettings(): array
    {
        // Fallback defaults if config not loaded properly
        $defaultSettings = [
            'micro_dev_threshold_high' => 14,
            'micro_dev_threshold_low' => 6,
            'micro_dev_gain_min' => 0.1,
            'micro_dev_gain_max' => 0.3,
            'micro_dev_loss_min' => 0.08,
            'micro_dev_loss_max' => 0.15,
            'stat_thresholds' => [
                'points' => 15,
                'assists' => 5,
                'rebounds' => 6,
                'steals' => 2,
                'blocks' => 2,
                'threes' => 2,
            ],
            'development_multiplier' => 1.0,
            'regression_multiplier' => 1.0,
        ];

        if (!isset($this->config['difficulty_settings'])) {
            return $defaultSettings;
        }

        return $this->config['difficulty_settings'][$this->difficulty]
            ?? $this->config['difficulty_settings']['pro']
            ?? $defaultSettings;
    }

    /**
     * Get the age bracket for a player's age.
     */
    public function getAgeBracket(int $age): string
    {
        foreach ($this->config['age_brackets'] as $bracket => $range) {
            if ($age >= $range['min'] && $age <= $range['max']) {
                return $bracket;
            }
        }
        return 'veteran';
    }

    /**
     * Get development multiplier for an age (adjusted by difficulty).
     */
    public function getDevelopmentMultiplier(int $age): float
    {
        $bracket = $this->getAgeBracket($age);
        $baseMult = $this->config['age_brackets'][$bracket]['development'] ?? 0.0;
        $diffSettings = $this->getDifficultySettings();
        return $baseMult * ($diffSettings['development_multiplier'] ?? 1.0);
    }

    /**
     * Get regression multiplier for an age (adjusted by difficulty).
     */
    public function getRegressionMultiplier(int $age): float
    {
        $bracket = $this->getAgeBracket($age);
        $baseMult = $this->config['age_brackets'][$bracket]['regression'] ?? 0.0;
        $diffSettings = $this->getDifficultySettings();
        return $baseMult * ($diffSettings['regression_multiplier'] ?? 1.0);
    }

    /**
     * Calculate age from birth date string.
     * Defaults to 25 if birth date is empty, null, or invalid.
     */
    public function calculateAge(?string $birthDate): int
    {
        if (empty($birthDate)) {
            return 25;
        }

        try {
            $age = Carbon::parse($birthDate)->age;
            // Sanity check - if age is negative or unreasonably high, default to 25
            if ($age < 0 || $age > 50) {
                return 25;
            }
            return $age;
        } catch (\Exception $e) {
            return 25;
        }
    }

    /**
     * Get birth date from player array, handling both camelCase and snake_case.
     */
    public function getPlayerBirthDate(array $player): ?string
    {
        $birthDate = $player['birthDate'] ?? $player['birth_date'] ?? null;
        // Return null if empty string so calculateAge defaults to 25
        return !empty($birthDate) ? $birthDate : null;
    }

    /**
     * Get player age with safe default of 25.
     */
    public function getPlayerAge(array $player): int
    {
        return $this->calculateAge($this->getPlayerBirthDate($player));
    }

    /**
     * Calculate monthly development points for a player.
     */
    public function calculateMonthlyDevelopment(array $player, array $context = []): float
    {
        $age = $this->getPlayerAge($player);
        $current = $player['overallRating'] ?? $player['overall_rating'] ?? 70;
        $potential = $player['potentialRating'] ?? $player['potential_rating'] ?? 75;
        $workEthic = $player['attributes']['mental']['workEthic'] ?? 70;

        // Can't develop past potential
        if ($current >= $potential) {
            return 0.0;
        }

        $devConfig = $this->config['development'];
        $ageMultiplier = $this->getDevelopmentMultiplier($age);

        // Base development (divided by 12 for monthly)
        $base = ($potential - $current) * $devConfig['base_rate'] * $ageMultiplier / 12;

        // Work ethic bonus
        $workEthicBonus = $base * ($workEthic / 100) * $devConfig['work_ethic_factor'];

        // Playing time bonus
        $avgMinutes = $context['avgMinutesPerGame'] ?? 20;
        $playingTimeBonus = $base * ($avgMinutes / 36) * $devConfig['playing_time_factor'];

        // Mentor bonus
        $mentorBonus = ($context['hasMentor'] ?? false) ? $base * $devConfig['mentor_factor'] : 0;

        // Badge synergy bonus
        $synergyBonus = ($context['badgeSynergyBoost'] ?? 0) * $base;

        // Morale modifier
        $morale = $player['personality']['morale'] ?? 80;
        $moraleModifier = $this->getMoraleModifier($morale);

        $total = ($base + $workEthicBonus + $playingTimeBonus + $mentorBonus + $synergyBonus);
        $total *= (1 + $moraleModifier);

        return max(0, $total);
    }

    /**
     * Calculate monthly regression points for a player.
     */
    public function calculateMonthlyRegression(array $player): float
    {
        $age = $this->getPlayerAge($player);
        $ageMultiplier = $this->getRegressionMultiplier($age);

        if ($ageMultiplier <= 0) {
            return 0.0;
        }

        // Base regression (divided by 12 for monthly)
        $baseRegression = $ageMultiplier * 0.5 / 12;

        return $baseRegression;
    }

    /**
     * Calculate per-game micro-development based on performance.
     * Uses difficulty-specific thresholds and gains.
     */
    public function calculateMicroDevelopment(array $player, array $boxScore): array
    {
        $diffSettings = $this->getDifficultySettings();
        $performance = $this->calculatePerformanceRating($boxScore);

        $result = [
            'performanceRating' => $performance,
            'attributeChanges' => [],
            'type' => 'none',
        ];

        if ($performance >= $diffSettings['micro_dev_threshold_high']) {
            // Good performance - development
            $result['type'] = 'development';
            $gain = $this->randomFloat(
                $diffSettings['micro_dev_gain_min'],
                $diffSettings['micro_dev_gain_max']
            );
            $result['attributeChanges'] = $this->getAttributeChangesFromStats($boxScore, $gain, $diffSettings);
        } elseif ($performance <= $diffSettings['micro_dev_threshold_low'] && ($boxScore['minutes'] ?? 0) >= 15) {
            // Poor performance with significant minutes - slight regression
            $result['type'] = 'regression';
            $loss = $this->randomFloat(
                $diffSettings['micro_dev_loss_min'],
                $diffSettings['micro_dev_loss_max']
            );
            $result['attributeChanges'] = $this->getAttributeChangesFromStats($boxScore, -$loss, $diffSettings);
        }

        return $result;
    }

    /**
     * Calculate performance rating from box score.
     * Formula: (Points + Rebounds + Assists*1.5 + Steals*2 + Blocks*2) / Minutes * 10
     */
    public function calculatePerformanceRating(array $boxScore): float
    {
        $minutes = max(1, $boxScore['minutes'] ?? 1);
        $points = $boxScore['points'] ?? 0;
        $rebounds = ($boxScore['offensiveRebounds'] ?? 0) + ($boxScore['defensiveRebounds'] ?? 0);
        $assists = $boxScore['assists'] ?? 0;
        $steals = $boxScore['steals'] ?? 0;
        $blocks = $boxScore['blocks'] ?? 0;
        $turnovers = $boxScore['turnovers'] ?? 0;

        $raw = ($points + $rebounds + $assists * 1.5 + $steals * 2 + $blocks * 2 - $turnovers) / $minutes * 10;

        return round($raw, 2);
    }

    /**
     * Determine which attributes to boost based on stats.
     * Uses difficulty-specific stat thresholds.
     */
    private function getAttributeChangesFromStats(array $boxScore, float $change, array $diffSettings = []): array
    {
        $changes = [];

        // Get stat thresholds from difficulty settings, with fallbacks
        $thresholds = $diffSettings['stat_thresholds'] ?? [
            'points' => 15,
            'assists' => 5,
            'rebounds' => 6,
            'steals' => 2,
            'blocks' => 2,
            'threes' => 2,
        ];

        $points = $boxScore['points'] ?? 0;
        $assists = $boxScore['assists'] ?? 0;
        $rebounds = ($boxScore['offensiveRebounds'] ?? 0) + ($boxScore['defensiveRebounds'] ?? 0);
        $steals = $boxScore['steals'] ?? 0;
        $blocks = $boxScore['blocks'] ?? 0;
        $threes = $boxScore['threePointersMade'] ?? 0;

        // Scoring - if points threshold met
        if ($points >= $thresholds['points']) {
            if ($threes >= $thresholds['threes']) {
                $changes['offense.threePoint'] = $change;
            } else {
                $changes['offense.midRange'] = $change * 0.5;
                $changes['offense.layup'] = $change * 0.5;
            }
        } elseif ($points >= $thresholds['points'] * 0.6) {
            // Partial scoring bonus for decent scoring (60% of threshold)
            $changes['offense.closeShot'] = $change * 0.3;
        }

        // Playmaking
        if ($assists >= $thresholds['assists']) {
            $changes['offense.passAccuracy'] = $change;
            $changes['offense.passVision'] = $change * 0.5;
        } elseif ($assists >= $thresholds['assists'] * 0.6) {
            // Partial assist bonus
            $changes['offense.passAccuracy'] = $change * 0.3;
        }

        // Rebounding
        if ($rebounds >= $thresholds['rebounds']) {
            $changes['defense.defensiveRebound'] = $change * 0.7;
            $changes['defense.offensiveRebound'] = $change * 0.3;
        } elseif ($rebounds >= $thresholds['rebounds'] * 0.6) {
            // Partial rebound bonus
            $changes['defense.defensiveRebound'] = $change * 0.3;
        }

        // Defense
        if ($steals >= $thresholds['steals']) {
            $changes['defense.steal'] = $change;
            $changes['defense.perimeterDefense'] = $change * 0.3;
        }
        if ($blocks >= $thresholds['blocks']) {
            $changes['defense.block'] = $change;
            $changes['defense.interiorDefense'] = $change * 0.3;
        }

        return $changes;
    }

    /**
     * Check if player can still develop towards potential.
     */
    public function canReachPotential(array $player): bool
    {
        $current = $player['overallRating'] ?? $player['overall_rating'] ?? 70;
        $potential = $player['potentialRating'] ?? $player['potential_rating'] ?? 75;
        $age = $this->getPlayerAge($player);

        return $current < $potential && $this->getDevelopmentMultiplier($age) > 0;
    }

    /**
     * Get morale modifier for development.
     */
    private function getMoraleModifier(int $morale): float
    {
        $effects = $this->config['morale']['effects'];

        if ($morale >= $effects['high']['threshold']) {
            return $effects['high']['development_modifier'];
        } elseif ($morale >= $effects['normal']['threshold']) {
            return $effects['normal']['development_modifier'];
        } elseif ($morale >= $effects['low']['threshold']) {
            return $effects['low']['development_modifier'];
        } else {
            return $effects['critical']['development_modifier'];
        }
    }

    /**
     * Generate random float between min and max.
     */
    private function randomFloat(float $min, float $max): float
    {
        return $min + mt_rand() / mt_getrandmax() * ($max - $min);
    }
}
