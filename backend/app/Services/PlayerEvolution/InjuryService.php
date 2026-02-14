<?php

namespace App\Services\PlayerEvolution;

use Carbon\Carbon;

class InjuryService
{
    private array $config;
    private AttributeAging $attributeAging;

    public function __construct(AttributeAging $attributeAging)
    {
        $this->config = config('player_evolution.injuries');
        $this->attributeAging = $attributeAging;
    }

    /**
     * Check if a player gets injured during a game.
     */
    public function checkForInjury(array $player, int $minutesPlayed, bool $isPlayoff = false): ?array
    {
        $chance = $this->calculateInjuryChance($player, $minutesPlayed, $isPlayoff);
        $roll = mt_rand(1, 10000) / 10000; // 0.0001 to 1.0000

        if ($roll <= $chance) {
            return $this->generateInjury($player);
        }

        return null;
    }

    /**
     * Calculate injury chance based on player attributes and context.
     */
    public function calculateInjuryChance(array $player, int $minutesPlayed, bool $isPlayoff = false): float
    {
        $durability = $player['attributes']['physical']['durability'] ?? 75;
        $age = $this->calculateAge($player);
        $fatigue = $player['fatigue'] ?? 0;
        $injuryRisk = $player['injuryRisk'] ?? $player['injury_risk'] ?? 'M';

        $base = $this->config['base_chance'];

        // Injury risk factor from CSV data (L=Low, M=Medium, H=High)
        $riskMultiplier = match(strtoupper($injuryRisk)) {
            'L' => 0.5,   // Low risk: 50% of normal chance
            'M' => 1.0,   // Medium risk: normal chance
            'H' => 2.0,   // High risk: 2x normal chance
            default => 1.0,
        };

        // Durability factor: lower durability = higher chance
        $durabilityFactor = ((100 - $durability) / 100) * 0.005;

        // Age factor: older players get injured more
        $ageFactor = max(0, ($age - 30) * 0.0005);

        // Fatigue factor: tired players get injured more
        $fatigueFactor = ($fatigue / 100) * 0.002;

        // Minutes factor: more minutes = more exposure
        $minutesFactor = ($minutesPlayed / 36) * 0.001;

        // Apply injury risk multiplier to the base calculation
        $chance = ($base + $durabilityFactor + $ageFactor + $fatigueFactor + $minutesFactor) * $riskMultiplier;

        // Playoffs are more intense
        if ($isPlayoff) {
            $chance *= 1.2;
        }

        // Cap at 5%
        return min(0.05, $chance);
    }

    /**
     * Generate a random injury based on weighted probabilities.
     */
    public function generateInjury(array $player): array
    {
        $severity = $this->rollInjurySeverity();
        $injuryConfig = $this->config['types'][$severity];

        $injuryTypes = $injuryConfig['injuries'];
        $injuryKey = array_rand($injuryTypes);
        $injuryName = $injuryTypes[$injuryKey];

        $duration = mt_rand($injuryConfig['duration'][0], $injuryConfig['duration'][1]);

        return [
            'type' => $injuryKey,
            'name' => $injuryName,
            'severity' => $severity,
            'games_remaining' => $duration,
            'occurred_date' => now()->toDateString(),
            'permanent_impact' => $injuryConfig['permanent_impact'] ?? 0,
            'permanent_impact_applied' => false,
        ];
    }

    /**
     * Roll for injury severity based on weighted probabilities.
     */
    private function rollInjurySeverity(): string
    {
        $roll = mt_rand(1, 100);
        $cumulative = 0;

        foreach ($this->config['types'] as $severity => $config) {
            $cumulative += $config['weight'];
            if ($roll <= $cumulative) {
                return $severity;
            }
        }

        return 'minor';
    }

    /**
     * Process injury recovery (decrement games remaining).
     */
    public function processRecovery(array $player): array
    {
        if (!$this->isInjured($player)) {
            return $player;
        }

        $injury = $player['injury_details'] ?? $player['injuryDetails'] ?? null;
        if (!$injury) {
            return $player;
        }

        $injury['games_remaining'] = max(0, ($injury['games_remaining'] ?? 0) - 1);

        // Check if recovered
        if ($injury['games_remaining'] <= 0) {
            $player['is_injured'] = false;
            $player['isInjured'] = false;
            $player['injury_details'] = null;
            $player['injuryDetails'] = null;

            // Apply permanent impact if not already applied
            if (!($injury['permanent_impact_applied'] ?? false) && ($injury['permanent_impact'] ?? 0) > 0) {
                $player['attributes'] = $this->attributeAging->applyInjuryImpact(
                    $player['attributes'],
                    $injury['permanent_impact']
                );
            }
        } else {
            $player['injury_details'] = $injury;
            $player['injuryDetails'] = $injury;
        }

        return $player;
    }

    /**
     * Apply permanent impact from a severe injury.
     */
    public function applyPermanentImpact(array $player, array $injury): array
    {
        if (($injury['permanent_impact'] ?? 0) <= 0) {
            return $player;
        }

        $player['attributes'] = $this->attributeAging->applyInjuryImpact(
            $player['attributes'],
            $injury['permanent_impact']
        );

        // Mark as applied
        if (isset($player['injury_details'])) {
            $player['injury_details']['permanent_impact_applied'] = true;
        }
        if (isset($player['injuryDetails'])) {
            $player['injuryDetails']['permanent_impact_applied'] = true;
        }

        return $player;
    }

    /**
     * Check if player is currently injured.
     */
    public function isInjured(array $player): bool
    {
        return ($player['is_injured'] ?? $player['isInjured'] ?? false) === true;
    }

    /**
     * Get games remaining for injury recovery.
     */
    public function getGamesRemaining(array $player): int
    {
        $injury = $player['injury_details'] ?? $player['injuryDetails'] ?? null;
        return $injury['games_remaining'] ?? 0;
    }

    /**
     * Calculate player age from birth date.
     */
    private function calculateAge(array $player): int
    {
        $birthDate = $player['birthDate'] ?? $player['birth_date'] ?? null;
        if (!$birthDate) return 25;

        return Carbon::parse($birthDate)->age;
    }

    /**
     * Get human-readable injury duration estimate.
     */
    public function getRecoveryEstimate(array $injury): string
    {
        $games = $injury['games_remaining'] ?? 0;

        if ($games <= 5) {
            return 'day-to-day';
        } elseif ($games <= 14) {
            return '1-2 weeks';
        } elseif ($games <= 28) {
            return '2-4 weeks';
        } elseif ($games <= 42) {
            return '4-6 weeks';
        } elseif ($games <= 60) {
            return '6-8 weeks';
        } else {
            return 'out for season';
        }
    }
}
