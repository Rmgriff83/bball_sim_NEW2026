<?php

namespace App\Services\PlayerEvolution;

class MoraleService
{
    private array $config;

    public function __construct()
    {
        $this->config = config('player_evolution.morale');
    }

    /**
     * Update player morale after a game.
     */
    public function updateAfterGame(array $player, array $gameResult, array $boxScore, string $difficulty = 'pro'): array
    {
        $morale = $player['personality']['morale'] ?? $this->config['starting'];
        $factors = $this->config['factors'];

        // Win/loss impact
        $isWin = $gameResult['won'] ?? false;
        $morale += $isWin ? $factors['win'] : $factors['loss'];

        // Streak bonus/penalty
        $streak = $gameResult['streak'] ?? 0;
        if (abs($streak) >= 3) {
            $morale += $streak > 0 ? $factors['winning_streak_bonus'] : $factors['losing_streak_penalty'];
        }

        // Playing time expectations
        $minutes = $boxScore['minutes'] ?? 0;
        $expectedMinutes = $this->getExpectedMinutes($player, $difficulty);

        if ($minutes >= $expectedMinutes * 1.2) {
            $morale += $factors['playing_time_exceeded'];
        } elseif ($minutes >= $expectedMinutes * 0.8) {
            $morale += $factors['playing_time_met'];
        } else {
            $morale += $factors['playing_time_unmet'];
        }

        // Apply personality volatility
        $traits = $player['personality']['traits'] ?? [];
        if (in_array('hot_head', $traits)) {
            $volatility = config('player_evolution.personality_traits.hot_head.morale_volatility', 2.0);
            // Hot heads have amplified morale changes
            $change = $morale - ($player['personality']['morale'] ?? $this->config['starting']);
            $morale = ($player['personality']['morale'] ?? $this->config['starting']) + ($change * $volatility);
        }

        // Clamp morale
        $player['personality']['morale'] = $this->clamp($morale);

        return $player;
    }

    /**
     * Update morale based on weekly team performance.
     */
    public function updateWeekly(array $player, array $teamRecord): array
    {
        $morale = $player['personality']['morale'] ?? $this->config['starting'];
        $factors = $this->config['factors'];

        // Contract situation
        $contractYears = $player['contract_years_remaining'] ?? $player['contractYearsRemaining'] ?? 2;
        if ($contractYears <= 1) {
            $morale += $factors['final_contract_year'];
        }

        // Team success matters
        $winPct = $teamRecord['wins'] / max(1, $teamRecord['wins'] + $teamRecord['losses']);
        if ($winPct >= 0.6) {
            $morale += 1; // Winning team bonus
        } elseif ($winPct <= 0.3) {
            $morale -= 1; // Losing team penalty
        }

        // Stability from personality
        $traits = $player['personality']['traits'] ?? [];
        if (in_array('team_player', $traits) || in_array('quiet', $traits)) {
            // More stable morale
            $target = $this->config['starting'];
            $morale = $morale + ($target - $morale) * 0.1;
        }

        $player['personality']['morale'] = $this->clamp($morale);

        return $player;
    }

    /**
     * Check if player wants to request a trade.
     */
    public function checkForTradeRequest(array $player): bool
    {
        $morale = $player['personality']['morale'] ?? $this->config['starting'];

        if ($morale < $this->config['trade_request_threshold']) {
            // Random chance based on how low morale is
            $chance = ($this->config['trade_request_threshold'] - $morale) / 100;
            return mt_rand(1, 100) / 100 <= $chance;
        }

        return false;
    }

    /**
     * Calculate team chemistry based on roster personalities.
     */
    public function calculateTeamChemistry(array $roster): int
    {
        $chemistry = 70; // Base chemistry

        $traitConfig = config('player_evolution.personality_traits');
        $leaderCount = 0;
        $ballHogCount = 0;
        $teamPlayerCount = 0;

        foreach ($roster as $player) {
            $traits = $player['personality']['traits'] ?? [];

            foreach ($traits as $trait) {
                if (isset($traitConfig[$trait]['chemistry_boost'])) {
                    $chemistry += $traitConfig[$trait]['chemistry_boost'];
                }
                if (isset($traitConfig[$trait]['chemistry_penalty'])) {
                    $chemistry += $traitConfig[$trait]['chemistry_penalty'];
                }
            }

            if (in_array('leader', $traits)) $leaderCount++;
            if (in_array('ball_hog', $traits)) $ballHogCount++;
            if (in_array('team_player', $traits)) $teamPlayerCount++;
        }

        // Synergy bonuses
        if ($leaderCount >= 1 && $leaderCount <= 2) {
            $chemistry += 5; // Good leadership
        } elseif ($leaderCount > 3) {
            $chemistry -= 5; // Too many cooks
        }

        if ($ballHogCount >= 3) {
            $chemistry -= 10; // Too many ball hogs
        }

        if ($teamPlayerCount >= 5) {
            $chemistry += 5; // Unselfish team
        }

        return $this->clamp($chemistry);
    }

    /**
     * Get expected minutes based on overall rating and difficulty.
     */
    private function getExpectedMinutes(array $player, string $difficulty = 'pro'): int
    {
        $overall = $player['overallRating'] ?? $player['overall_rating'] ?? 70;

        if ($overall >= 85) {
            return match ($difficulty) {
                'rookie' => 27,
                'pro' => 28,
                'all_star', 'all-star' => 29,
                'hall_of_fame', 'hall-of-fame' => 31,
                default => 28,
            };
        }
        if ($overall >= 80) return 28;
        if ($overall >= 75) return 24;
        if ($overall >= 70) return 18;
        if ($overall >= 65) return 12;
        return 6;
    }

    /**
     * Get morale effect level (high, normal, low, critical).
     */
    public function getMoraleLevel(int $morale): string
    {
        $effects = $this->config['effects'];

        if ($morale >= $effects['high']['threshold']) return 'high';
        if ($morale >= $effects['normal']['threshold']) return 'normal';
        if ($morale >= $effects['low']['threshold']) return 'low';
        return 'critical';
    }

    /**
     * Get performance modifier based on morale.
     */
    public function getPerformanceModifier(int $morale): float
    {
        $level = $this->getMoraleLevel($morale);
        return $this->config['effects'][$level]['performance_modifier'] ?? 0.0;
    }

    /**
     * Get development modifier based on morale.
     */
    public function getDevelopmentModifier(int $morale): float
    {
        $level = $this->getMoraleLevel($morale);
        return $this->config['effects'][$level]['development_modifier'] ?? 0.0;
    }

    /**
     * Clamp morale between min and max.
     */
    private function clamp(float $value): int
    {
        return (int) max($this->config['min'], min($this->config['max'], round($value)));
    }
}
