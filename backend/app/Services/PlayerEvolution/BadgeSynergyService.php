<?php

namespace App\Services\PlayerEvolution;

use App\Models\BadgeSynergy;

class BadgeSynergyService
{
    private const LEVEL_VALUES = ['bronze' => 1, 'silver' => 2, 'gold' => 3, 'hof' => 4];
    private const SYNERGY_BOOST_BY_MIN_LEVEL = [1 => 0.03, 2 => 0.05, 3 => 0.06, 4 => 0.08];

    private array $config;
    private array $synergies = [];

    public function __construct()
    {
        $this->config = config('player_evolution.badge_synergies');
        $this->loadSynergies();
    }

    /**
     * Load badge synergies from database.
     */
    private function loadSynergies(): void
    {
        try {
            $this->synergies = BadgeSynergy::all()->toArray();
        } catch (\Exception $e) {
            // Table might not exist yet
            $this->synergies = $this->getDefaultSynergies();
        }
    }

    /**
     * Get default synergies if database not available.
     */
    private function getDefaultSynergies(): array
    {
        return [
            ['badge1_id' => 'dimer', 'badge2_id' => 'catch_and_shoot', 'effect' => 'shooting_boost', 'magnitude' => 5],
            ['badge1_id' => 'lob_city_passer', 'badge2_id' => 'lob_city_finisher', 'effect' => 'alley_oop_boost', 'magnitude' => 10],
            ['badge1_id' => 'brick_wall', 'badge2_id' => 'pick_and_roller', 'effect' => 'screen_boost', 'magnitude' => 5],
            ['badge1_id' => 'anchor', 'badge2_id' => 'intimidator', 'effect' => 'interior_defense_boost', 'magnitude' => 8],
            ['badge1_id' => 'floor_general', 'badge2_id' => 'deadeye', 'effect' => 'team_shooting_boost', 'magnitude' => 3],
            ['badge1_id' => 'floor_general', 'badge2_id' => 'catch_and_shoot', 'effect' => 'team_shooting_boost', 'magnitude' => 3],
            ['badge1_id' => 'floor_general', 'badge2_id' => 'corner_specialist', 'effect' => 'team_shooting_boost', 'magnitude' => 3],
        ];
    }

    /**
     * Find all badge synergies between two players.
     */
    public function findBadgeSynergies(array $playerABadges, array $playerBBadges): array
    {
        $foundSynergies = [];

        $aBadgeIds = array_column($playerABadges, 'id');
        $bBadgeIds = array_column($playerBBadges, 'id');

        foreach ($this->synergies as $synergy) {
            $badge1 = $synergy['badge1_id'] ?? '';
            $badge2 = $synergy['badge2_id'] ?? '';

            // Check if player A has badge1 and player B has badge2
            if (in_array($badge1, $aBadgeIds) && in_array($badge2, $bBadgeIds)) {
                $foundSynergies[] = [
                    'synergy' => $synergy,
                    'badge1_level' => $this->getBadgeLevel($playerABadges, $badge1),
                    'badge2_level' => $this->getBadgeLevel($playerBBadges, $badge2),
                ];
            }

            // Check reverse direction
            if (in_array($badge2, $aBadgeIds) && in_array($badge1, $bBadgeIds)) {
                $foundSynergies[] = [
                    'synergy' => $synergy,
                    'badge1_level' => $this->getBadgeLevel($playerABadges, $badge2),
                    'badge2_level' => $this->getBadgeLevel($playerBBadges, $badge1),
                ];
            }
        }

        return $foundSynergies;
    }

    /**
     * Calculate development boost from badge synergies.
     */
    public function calculateDevelopmentBoost(array $player, array $roster): float
    {
        $playerBadges = $player['badges'] ?? [];
        if (empty($playerBadges)) {
            return 0.0;
        }

        $totalBoost = 0.0;
        $synergyCount = 0;

        foreach ($roster as $teammate) {
            if (($teammate['id'] ?? '') === ($player['id'] ?? 'no-match')) {
                continue;
            }

            $teammateBadges = $teammate['badges'] ?? [];
            $synergies = $this->findBadgeSynergies($playerBadges, $teammateBadges);

            foreach ($synergies as $synergyData) {
                $boost = $this->calculateSingleSynergyBoost($synergyData);
                $totalBoost += $boost;
                $synergyCount++;
            }
        }

        // Cap at max boost
        return min($totalBoost, $this->config['development_boost_max'] ?? 0.15);
    }

    /**
     * Calculate boost from a single synergy.
     * Uses the lower of the two badge levels to determine the tier.
     */
    private function calculateSingleSynergyBoost(array $synergyData): float
    {
        $level1 = self::LEVEL_VALUES[$synergyData['badge1_level'] ?? 'bronze'] ?? 1;
        $level2 = self::LEVEL_VALUES[$synergyData['badge2_level'] ?? 'bronze'] ?? 1;
        $minLevel = min($level1, $level2);

        return self::SYNERGY_BOOST_BY_MIN_LEVEL[$minLevel] ?? 0.03;
    }

    /**
     * Get badge level from badges array.
     */
    private function getBadgeLevel(array $badges, string $badgeId): string
    {
        foreach ($badges as $badge) {
            if (($badge['id'] ?? '') === $badgeId) {
                return $badge['level'] ?? 'bronze';
            }
        }
        return 'bronze';
    }

    /**
     * Calculate in-game performance boost from synergies.
     */
    public function calculateInGameBoost(array $player, array $teammates): float
    {
        $playerBadges = $player['badges'] ?? [];
        if (empty($playerBadges)) {
            return 0.0;
        }

        $synergyCount = 0;

        foreach ($teammates as $teammate) {
            $teammateBadges = $teammate['badges'] ?? [];
            $synergies = $this->findBadgeSynergies($playerBadges, $teammateBadges);
            $synergyCount += count($synergies);
        }

        // Each synergy gives a small in-game boost
        $boost = $synergyCount * ($this->config['in_game_boost'] ?? 0.03);

        // Cap at reasonable amount
        return min($boost, 0.12);
    }

    /**
     * Calculate chemistry contribution from synergies.
     */
    public function calculateChemistryContribution(array $roster): int
    {
        $totalContribution = 0;
        $countedPairs = [];

        for ($i = 0; $i < count($roster); $i++) {
            for ($j = $i + 1; $j < count($roster); $j++) {
                $playerA = $roster[$i];
                $playerB = $roster[$j];

                $synergies = $this->findBadgeSynergies(
                    $playerA['badges'] ?? [],
                    $playerB['badges'] ?? []
                );

                if (count($synergies) > 0) {
                    $pairKey = ($playerA['id'] ?? $i) . '-' . ($playerB['id'] ?? $j);
                    if (!isset($countedPairs[$pairKey])) {
                        $totalContribution += $this->config['chemistry_contribution'] ?? 2;
                        $countedPairs[$pairKey] = true;
                    }
                }
            }
        }

        return $totalContribution;
    }

    /**
     * Get all synergy pairs on a roster.
     */
    public function getRosterSynergies(array $roster): array
    {
        $allSynergies = [];

        for ($i = 0; $i < count($roster); $i++) {
            for ($j = $i + 1; $j < count($roster); $j++) {
                $playerA = $roster[$i];
                $playerB = $roster[$j];

                $synergies = $this->findBadgeSynergies(
                    $playerA['badges'] ?? [],
                    $playerB['badges'] ?? []
                );

                if (count($synergies) > 0) {
                    $allSynergies[] = [
                        'playerA' => [
                            'id' => $playerA['id'] ?? '',
                            'name' => ($playerA['firstName'] ?? $playerA['first_name'] ?? '') . ' ' .
                                     ($playerA['lastName'] ?? $playerA['last_name'] ?? ''),
                        ],
                        'playerB' => [
                            'id' => $playerB['id'] ?? '',
                            'name' => ($playerB['firstName'] ?? $playerB['first_name'] ?? '') . ' ' .
                                     ($playerB['lastName'] ?? $playerB['last_name'] ?? ''),
                        ],
                        'synergies' => $synergies,
                    ];
                }
            }
        }

        return $allSynergies;
    }

    /**
     * Find Dynamic Duo pairs on a roster.
     * Two players form a Dynamic Duo when they share 2+ synergies
     * and both badges in each synergy are gold or higher.
     */
    public function findDynamicDuos(array $roster): array
    {
        $duos = [];
        $minSynergies = $this->config['dynamic_duo_min_synergies'] ?? 2;

        for ($i = 0; $i < count($roster); $i++) {
            for ($j = $i + 1; $j < count($roster); $j++) {
                $playerA = $roster[$i];
                $playerB = $roster[$j];

                $synergies = $this->findBadgeSynergies(
                    $playerA['badges'] ?? [],
                    $playerB['badges'] ?? []
                );

                $goldPlusCount = 0;
                foreach ($synergies as $synergyData) {
                    $level1 = self::LEVEL_VALUES[$synergyData['badge1_level'] ?? 'bronze'] ?? 1;
                    $level2 = self::LEVEL_VALUES[$synergyData['badge2_level'] ?? 'bronze'] ?? 1;
                    if (min($level1, $level2) >= 3) { // gold = 3
                        $goldPlusCount++;
                    }
                }

                if ($goldPlusCount >= $minSynergies) {
                    $duos[] = [
                        'playerA' => [
                            'id' => $playerA['id'] ?? '',
                            'name' => ($playerA['firstName'] ?? $playerA['first_name'] ?? '') . ' ' .
                                     ($playerA['lastName'] ?? $playerA['last_name'] ?? ''),
                        ],
                        'playerB' => [
                            'id' => $playerB['id'] ?? '',
                            'name' => ($playerB['firstName'] ?? $playerB['first_name'] ?? '') . ' ' .
                                     ($playerB['lastName'] ?? $playerB['last_name'] ?? ''),
                        ],
                        'synergies' => $synergies,
                    ];
                }
            }
        }

        return $duos;
    }

    /**
     * Get Dynamic Duo attribute boost for a player.
     * Returns 0.02 if the player is part of any Dynamic Duo, else 0.0.
     */
    public function getDynamicDuoBoost(array $player, array $roster): float
    {
        $playerId = $player['id'] ?? '';
        $duos = $this->findDynamicDuos($roster);

        foreach ($duos as $duo) {
            if (($duo['playerA']['id'] ?? '') === $playerId || ($duo['playerB']['id'] ?? '') === $playerId) {
                return $this->config['dynamic_duo_boost'] ?? 0.02;
            }
        }

        return 0.0;
    }
}
