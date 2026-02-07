<?php

namespace App\Services\PlayerEvolution;

use Carbon\Carbon;

class PersonalityEffects
{
    private array $config;

    public function __construct()
    {
        $this->config = config('player_evolution.personality_traits');
    }

    /**
     * Calculate total development modifier from personality traits.
     */
    public function getDevelopmentModifier(array $player): float
    {
        $traits = $player['personality']['traits'] ?? [];
        $modifier = 0.0;

        foreach ($traits as $trait) {
            if (isset($this->config[$trait]['development_bonus'])) {
                $modifier += $this->config[$trait]['development_bonus'];
            }
            if (isset($this->config[$trait]['own_development_penalty'])) {
                $modifier += $this->config[$trait]['own_development_penalty'];
            }
        }

        // Work ethic multiplier (from mental attributes)
        $workEthic = $player['attributes']['mental']['workEthic'] ?? 70;
        if ($workEthic >= 85) {
            $modifier += 0.15; // High work ethic bonus
        } elseif ($workEthic <= 50) {
            $modifier -= 0.10; // Low work ethic penalty
        }

        return $modifier;
    }

    /**
     * Calculate mentor bonus for a young player.
     */
    public function getMentorBonus(array $veteran, array $youngPlayer): float
    {
        $veteranTraits = $veteran['personality']['traits'] ?? [];

        if (!in_array('mentor', $veteranTraits)) {
            return 0.0;
        }

        $youngAge = $this->calculateAge($youngPlayer);
        if ($youngAge > 24) {
            return 0.0; // Too old for mentoring
        }

        $mentorConfig = $this->config['mentor'] ?? [];
        return $mentorConfig['young_player_boost'] ?? 0.15;
    }

    /**
     * Find mentors on a roster for young players.
     */
    public function findMentorsForPlayer(array $youngPlayer, array $roster): array
    {
        $mentors = [];
        $youngAge = $this->calculateAge($youngPlayer);

        if ($youngAge > 24) {
            return $mentors;
        }

        $maxMentees = $this->config['mentor']['max_mentees'] ?? 2;
        $menteesCount = [];

        foreach ($roster as $player) {
            if (($player['id'] ?? '') === ($youngPlayer['id'] ?? 'no-match')) {
                continue;
            }

            $traits = $player['personality']['traits'] ?? [];
            if (in_array('mentor', $traits)) {
                $mentorId = $player['id'] ?? '';
                $menteesCount[$mentorId] = ($menteesCount[$mentorId] ?? 0) + 1;

                if ($menteesCount[$mentorId] <= $maxMentees) {
                    $mentors[] = $player;
                }
            }
        }

        return $mentors;
    }

    /**
     * Calculate leadership effect on team.
     */
    public function calculateLeadershipEffect(array $leader, array $roster): array
    {
        $leaderTraits = $leader['personality']['traits'] ?? [];

        if (!in_array('leader', $leaderTraits)) {
            return ['chemistry_boost' => 0, 'development_boost' => 0];
        }

        $leaderConfig = $this->config['leader'] ?? [];

        return [
            'chemistry_boost' => $leaderConfig['chemistry_boost'] ?? 5,
            'development_boost' => $leaderConfig['team_development'] ?? 0.05,
        ];
    }

    /**
     * Check for technical foul based on personality.
     */
    public function checkForTechnicalFoul(array $player): bool
    {
        $traits = $player['personality']['traits'] ?? [];

        if (!in_array('hot_head', $traits)) {
            return false;
        }

        $chance = $this->config['hot_head']['tech_foul_chance'] ?? 0.02;
        return mt_rand(1, 10000) / 10000 <= $chance;
    }

    /**
     * Check for ejection based on personality.
     */
    public function checkForEjection(array $player, int $technicals = 0): bool
    {
        // Auto-eject at 2 technicals
        if ($technicals >= 2) {
            return true;
        }

        $traits = $player['personality']['traits'] ?? [];
        if (!in_array('hot_head', $traits)) {
            return false;
        }

        $chance = $this->config['hot_head']['ejection_chance'] ?? 0.005;
        return mt_rand(1, 10000) / 10000 <= $chance;
    }

    /**
     * Get usage rate modifier based on personality.
     */
    public function getUsageModifier(array $player): float
    {
        $traits = $player['personality']['traits'] ?? [];
        $modifier = 0.0;

        if (in_array('ball_hog', $traits)) {
            $modifier += $this->config['ball_hog']['usage_boost'] ?? 0.10;
        }

        if (in_array('team_player', $traits)) {
            $modifier -= 0.05; // More willing to pass
        }

        return $modifier;
    }

    /**
     * Get assist rate modifier based on personality.
     */
    public function getAssistModifier(array $player): float
    {
        $traits = $player['personality']['traits'] ?? [];
        $modifier = 0.0;

        if (in_array('ball_hog', $traits)) {
            $modifier += $this->config['ball_hog']['assist_penalty'] ?? -0.10;
        }

        if (in_array('team_player', $traits)) {
            $modifier += $this->config['team_player']['assist_boost'] ?? 0.10;
        }

        return $modifier;
    }

    /**
     * Get clutch performance modifier based on personality.
     */
    public function getClutchModifier(array $player): float
    {
        $traits = $player['personality']['traits'] ?? [];
        $modifier = 0.0;

        if (in_array('competitor', $traits)) {
            $clutchBoost = $this->config['competitor']['clutch_boost'] ?? 5;
            $modifier += $clutchBoost / 100; // Convert to percentage
        }

        return $modifier;
    }

    /**
     * Get playoff performance modifier.
     */
    public function getPlayoffModifier(array $player): float
    {
        $traits = $player['personality']['traits'] ?? [];
        $modifier = 0.0;

        if (in_array('competitor', $traits)) {
            $modifier += $this->config['competitor']['playoff_performance'] ?? 0.05;
        }

        // Pressure can affect media darlings
        if (in_array('media_darling', $traits)) {
            $modifier += $this->config['media_darling']['pressure_penalty'] ?? -0.02;
        }

        return $modifier;
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
     * Get all trait effects summary for a player.
     */
    public function getTraitEffectsSummary(array $player): array
    {
        $traits = $player['personality']['traits'] ?? [];
        $effects = [];

        foreach ($traits as $trait) {
            if (isset($this->config[$trait])) {
                $effects[$trait] = $this->config[$trait];
            }
        }

        return $effects;
    }
}
