<?php

namespace App\Services\PlayerEvolution;

use Carbon\Carbon;

class DevelopmentCalculator
{
    private array $config;

    public function __construct()
    {
        $this->config = config('player_evolution');
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
     * Get development multiplier for an age.
     */
    public function getDevelopmentMultiplier(int $age): float
    {
        $bracket = $this->getAgeBracket($age);
        return $this->config['age_brackets'][$bracket]['development'] ?? 0.0;
    }

    /**
     * Get regression multiplier for an age.
     */
    public function getRegressionMultiplier(int $age): float
    {
        $bracket = $this->getAgeBracket($age);
        return $this->config['age_brackets'][$bracket]['regression'] ?? 0.0;
    }

    /**
     * Calculate age from birth date string.
     */
    public function calculateAge(string $birthDate): int
    {
        return Carbon::parse($birthDate)->age;
    }

    /**
     * Calculate monthly development points for a player.
     */
    public function calculateMonthlyDevelopment(array $player, array $context = []): float
    {
        $age = $this->calculateAge($player['birthDate'] ?? $player['birth_date'] ?? '1995-01-01');
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
        $age = $this->calculateAge($player['birthDate'] ?? $player['birth_date'] ?? '1995-01-01');
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
     */
    public function calculateMicroDevelopment(array $player, array $boxScore): array
    {
        $devConfig = $this->config['development'];
        $performance = $this->calculatePerformanceRating($boxScore);

        $result = [
            'performanceRating' => $performance,
            'attributeChanges' => [],
            'type' => 'none',
        ];

        if ($performance >= $devConfig['micro_dev_threshold_high']) {
            // Good performance - slight development
            $result['type'] = 'development';
            $gain = $this->randomFloat(
                $devConfig['micro_dev_gain_min'],
                $devConfig['micro_dev_gain_max']
            );
            $result['attributeChanges'] = $this->getAttributeChangesFromStats($boxScore, $gain);
        } elseif ($performance <= $devConfig['micro_dev_threshold_low'] && $boxScore['minutes'] >= 15) {
            // Poor performance with significant minutes - slight regression
            $result['type'] = 'regression';
            $loss = $this->randomFloat(
                $devConfig['micro_dev_loss_min'],
                $devConfig['micro_dev_loss_max']
            );
            $result['attributeChanges'] = $this->getAttributeChangesFromStats($boxScore, -$loss);
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
     */
    private function getAttributeChangesFromStats(array $boxScore, float $change): array
    {
        $changes = [];

        $points = $boxScore['points'] ?? 0;
        $assists = $boxScore['assists'] ?? 0;
        $rebounds = ($boxScore['offensiveRebounds'] ?? 0) + ($boxScore['defensiveRebounds'] ?? 0);
        $steals = $boxScore['steals'] ?? 0;
        $blocks = $boxScore['blocks'] ?? 0;
        $threes = $boxScore['threePointersMade'] ?? 0;

        // Scoring
        if ($points >= 20) {
            if ($threes >= 3) {
                $changes['offense.threePoint'] = $change;
            } else {
                $changes['offense.midRange'] = $change * 0.5;
                $changes['offense.layup'] = $change * 0.5;
            }
        }

        // Playmaking
        if ($assists >= 6) {
            $changes['offense.passAccuracy'] = $change;
        }

        // Rebounding
        if ($rebounds >= 8) {
            $changes['defense.defensiveRebound'] = $change * 0.7;
            $changes['defense.offensiveRebound'] = $change * 0.3;
        }

        // Defense
        if ($steals >= 2) {
            $changes['defense.steal'] = $change;
        }
        if ($blocks >= 2) {
            $changes['defense.block'] = $change;
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
        $age = $this->calculateAge($player['birthDate'] ?? $player['birth_date'] ?? '1995-01-01');

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
