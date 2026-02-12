<?php

namespace App\Services;

class SubstitutionService
{
    public const CHECK_INTERVAL_MINUTES = 2.0;
    public const VARIANCE_RANGE = 0.15;
    public const CLOSE_GAME_THRESHOLD = 6;
    public const TOTAL_GAME_MINUTES = 40.0;

    public const STRATEGIES = [
        'staggered' => [
            'name' => 'Staggered',
            'description' => 'Stars rest in shifts. At least one playmaker always on floor. Max 2 subs at a time.',
            'type' => 'balanced',
            'rotation_depth' => '8-9 players',
            'strengths' => ['Continuity', 'Matchup Flexibility'],
            'weaknesses' => ['Star Fatigue Risk'],
            'pace_threshold' => 1.5,
            'max_subs_per_check' => 2,
        ],
        'platoon' => [
            'name' => 'Platoon',
            'description' => 'Swap groups of 2-3 players at defined intervals. Unit chemistry over individual matchups.',
            'type' => 'balanced',
            'rotation_depth' => '8-10 players',
            'strengths' => ['Unit Chemistry', 'Predictable Rhythm'],
            'weaknesses' => ['Transition Gaps'],
            'pace_threshold' => 2.0,
            'max_subs_per_check' => 3,
        ],
        'tight_rotation' => [
            'name' => 'Tight Rotation',
            'description' => 'Lean heavily on top 7 players. Stars play big minutes. Bench only for short rest.',
            'type' => 'aggressive',
            'rotation_depth' => '7-8 players',
            'strengths' => ['Star Maximization', 'Closing Lineup'],
            'weaknesses' => ['Fatigue Risk', 'Thin Depth'],
            'pace_threshold' => 2.5,
            'max_subs_per_check' => 2,
        ],
        'deep_bench' => [
            'name' => 'Deep Bench',
            'description' => 'Spread minutes across 9-10 players. Everyone contributes. Fresh legs all game.',
            'type' => 'passive',
            'rotation_depth' => '9-10 players',
            'strengths' => ['Fresh Legs', 'Injury Insurance'],
            'weaknesses' => ['Fewer Star Minutes', 'Less Continuity'],
            'pace_threshold' => 1.0,
            'max_subs_per_check' => 3,
        ],
    ];

    /**
     * Entry point called by rotatePlayers(). Returns new lineup IDs or null.
     */
    public function evaluateSubstitutions(
        array $currentLineup,
        array $fullRoster,
        array $boxScore,
        array $targetMinutes,
        string $strategy,
        int $currentQuarter,
        float $timeRemaining,
        int $scoreDiff,
        bool $isUserTeamLive
    ): ?array {
        // User controls subs during live games
        if ($isUserTeamLive) {
            return null;
        }

        $strategyData = self::STRATEGIES[$strategy] ?? self::STRATEGIES['staggered'];

        // Calculate game minutes elapsed
        $gameElapsed = $this->calculateGameElapsed($currentQuarter, $timeRemaining);

        // Q4 close game override - force best 5 back in
        $closeGameLineup = $this->applyCloseGameOverride(
            $fullRoster, $currentQuarter, $timeRemaining, $scoreDiff
        );
        if ($closeGameLineup !== null) {
            return $closeGameLineup;
        }

        // Get current lineup IDs
        $currentLineupIds = array_map(fn($p) => $p['id'], $currentLineup);

        // Build player map for quick lookup
        $playerMap = [];
        foreach ($fullRoster as $player) {
            $playerMap[$player['id']] = $player;
        }

        // Calculate target percentage for each player
        $targetPcts = [];
        foreach ($targetMinutes as $playerId => $mins) {
            $targetPcts[$playerId] = $mins / self::TOTAL_GAME_MINUTES;
        }

        // Find players ahead of pace (candidates to sit)
        $sitCandidates = [];
        foreach ($currentLineupIds as $playerId) {
            $actualMinutes = $boxScore[$playerId]['minutes'] ?? 0;
            $targetPct = $targetPcts[$playerId] ?? 0.5;
            $expectedMinutes = $gameElapsed * $targetPct;
            $paceDelta = $actualMinutes - $expectedMinutes;

            if ($paceDelta >= $strategyData['pace_threshold']) {
                $sitCandidates[] = [
                    'id' => $playerId,
                    'paceDelta' => $paceDelta,
                    'position' => $playerMap[$playerId]['position'] ?? 'SF',
                    'secondary_position' => $playerMap[$playerId]['secondary_position'] ?? null,
                ];
            }
        }

        if (empty($sitCandidates)) {
            return null;
        }

        // Sort by most ahead of pace first
        usort($sitCandidates, fn($a, $b) => $b['paceDelta'] <=> $a['paceDelta']);

        // Staggered extra rule: never sub out both primary ball-handlers simultaneously
        if ($strategy === 'staggered') {
            $sitCandidates = $this->applyStaggeredConstraint($sitCandidates, $currentLineup);
        }

        // Limit subs per check
        $maxSubs = $strategyData['max_subs_per_check'];
        $sitCandidates = array_slice($sitCandidates, 0, $maxSubs);

        // Build bench (players not in current lineup)
        $benchPlayers = [];
        foreach ($fullRoster as $player) {
            if (!in_array($player['id'], $currentLineupIds)) {
                $isInjured = $player['is_injured'] ?? $player['isInjured'] ?? false;
                if (!$isInjured) {
                    $benchPlayers[] = $player;
                }
            }
        }

        // Find replacements for each sit candidate
        $newLineupIds = $currentLineupIds;
        $subsApplied = 0;

        foreach ($sitCandidates as $candidate) {
            $replacement = $this->findBenchReplacement(
                $benchPlayers,
                $candidate,
                $boxScore,
                $targetMinutes,
                $gameElapsed,
                $newLineupIds
            );

            if ($replacement) {
                // Swap in the lineup
                $lineupIndex = array_search($candidate['id'], $newLineupIds);
                if ($lineupIndex !== false) {
                    $newLineupIds[$lineupIndex] = $replacement['id'];
                    // Remove replacement from bench candidates
                    $benchPlayers = array_filter($benchPlayers, fn($p) => $p['id'] !== $replacement['id']);
                    $benchPlayers = array_values($benchPlayers);
                    $subsApplied++;
                }
            }
        }

        if ($subsApplied === 0) {
            return null;
        }

        return $newLineupIds;
    }

    /**
     * If Q4, timeRemaining <= 5.0, scoreDiff <= CLOSE_GAME_THRESHOLD:
     * Force best 5 players back into lineup.
     */
    public function applyCloseGameOverride(
        array $fullRoster,
        int $currentQuarter,
        float $timeRemaining,
        int $scoreDiff
    ): ?array {
        if ($currentQuarter < 4 || $timeRemaining > 5.0 || abs($scoreDiff) > self::CLOSE_GAME_THRESHOLD) {
            return null;
        }

        // Get healthy players sorted by rating
        $healthy = array_filter($fullRoster, function ($p) {
            return !($p['is_injured'] ?? $p['isInjured'] ?? false);
        });

        usort($healthy, fn($a, $b) => ($b['overall_rating'] ?? 0) - ($a['overall_rating'] ?? 0));

        // Take best 5
        $best5 = array_slice($healthy, 0, 5);

        if (count($best5) < 5) {
            return null;
        }

        return array_map(fn($p) => $p['id'], $best5);
    }

    /**
     * Auto-calculate target minutes for AI teams based on strategy.
     */
    public function generateAITargetMinutes(array $roster, array $starterIds, string $strategy): array
    {
        // Sort roster by overall rating descending
        $sorted = $roster;
        usort($sorted, fn($a, $b) => ($b['overall_rating'] ?? $b['overallRating'] ?? 0) - ($a['overall_rating'] ?? $a['overallRating'] ?? 0));

        $templates = $this->getDistributionTemplate($strategy);
        $targetMinutes = [];

        // Assign minutes by rank
        foreach ($sorted as $index => $player) {
            $playerId = $player['id'] ?? null;
            if (!$playerId) continue;

            $isStarter = in_array($playerId, $starterIds);
            $minuteSlot = $templates[$index] ?? 0;

            // Quality adjustment
            $rating = $player['overall_rating'] ?? $player['overallRating'] ?? 70;
            if ($rating >= 90 && $isStarter) {
                $minuteSlot += 2;
            } elseif ($rating >= 80 && $isStarter) {
                $minuteSlot += 1;
            }

            $targetMinutes[$playerId] = max(0, min(40, $minuteSlot));
        }

        // Normalize to approximately 200 total
        $total = array_sum($targetMinutes);
        if ($total > 0 && abs($total - 200) > 5) {
            $factor = 200 / $total;
            foreach ($targetMinutes as $id => &$mins) {
                $mins = (int) round($mins * $factor);
                $mins = max(0, min(40, $mins));
            }
        }

        return $targetMinutes;
    }

    /**
     * Apply ±15% random variance to each player's target minutes.
     * Called once at game initialization.
     */
    public function applyVariance(array $targetMinutes): array
    {
        $varied = [];
        foreach ($targetMinutes as $playerId => $mins) {
            if ($mins <= 0) {
                $varied[$playerId] = 0;
                continue;
            }

            $variance = 1.0 + ((mt_rand(-100, 100) / 100) * self::VARIANCE_RANGE);
            $newMins = $mins * $variance;

            // Clamp: starters (>= 20 min target) min 8, bench min 0, max 40
            if ($mins >= 20) {
                $newMins = max(8, min(40, $newMins));
            } else {
                $newMins = max(0, min(40, $newMins));
            }

            $varied[$playerId] = (int) round($newMins);
        }

        return $varied;
    }

    /**
     * Returns default minutes based on rating tiers.
     */
    public function getDefaultTargetMinutes(array $roster, array $starterIds): array
    {
        $targetMinutes = [];
        $bench = [];

        // Identify healthy starters and bench
        $healthyStarterCount = 0;
        foreach ($roster as $player) {
            $playerId = $player['id'] ?? null;
            if (!$playerId) continue;

            $isInjured = !empty($player['is_injured']) || !empty($player['isInjured']);

            if (in_array($playerId, $starterIds)) {
                if ($isInjured) {
                    $targetMinutes[$playerId] = 0;
                } else {
                    $healthyStarterCount++;
                    $targetMinutes[$playerId] = null; // placeholder, set below
                }
            } else {
                $bench[] = $player;
            }
        }

        // Healthy starters split 160 minutes evenly
        $starterMins = $healthyStarterCount > 0 ? (int) floor(160 / $healthyStarterCount) : 0;
        $starterMins = min($starterMins, 40);
        $starterTotal = 0;
        foreach ($targetMinutes as $id => &$mins) {
            if ($mins === null) {
                $mins = $starterMins;
                $starterTotal += $mins;
            }
        }
        unset($mins);

        // Sort bench by rating descending
        usort($bench, function ($a, $b) {
            $ratingA = $a['overall_rating'] ?? $a['overallRating'] ?? 70;
            $ratingB = $b['overall_rating'] ?? $b['overallRating'] ?? 70;
            return $ratingB - $ratingA;
        });

        // Top healthy bench players get remaining minutes: 16, 12, 8, 4
        $benchDistribution = [16, 12, 8, 4];
        $benchBudget = 200 - $starterTotal;
        $benchSlot = 0;

        foreach ($bench as $player) {
            $playerId = $player['id'] ?? null;
            if (!$playerId) continue;

            $isInjured = !empty($player['is_injured']) || !empty($player['isInjured']);

            if ($isInjured || $benchSlot >= count($benchDistribution) || $benchBudget <= 0) {
                $targetMinutes[$playerId] = 0;
            } else {
                $mins = min($benchDistribution[$benchSlot], $benchBudget);
                $targetMinutes[$playerId] = $mins;
                $benchBudget -= $mins;
                $benchSlot++;
            }
        }

        return $targetMinutes;
    }

    /**
     * Get strategy info for API responses (without internal thresholds).
     */
    public static function getStrategyDisplayInfo(): array
    {
        $strategies = [];
        foreach (self::STRATEGIES as $id => $strategy) {
            $strategies[$id] = [
                'name' => $strategy['name'],
                'description' => $strategy['description'],
                'type' => $strategy['type'],
                'rotation_depth' => $strategy['rotation_depth'],
                'strengths' => $strategy['strengths'],
                'weaknesses' => $strategy['weaknesses'],
            ];
        }
        return $strategies;
    }

    // ========================================
    // Private helpers
    // ========================================

    private function calculateGameElapsed(int $currentQuarter, float $timeRemaining): float
    {
        $quarterLength = 10.0; // 10-minute quarters
        $completedQuarters = $currentQuarter - 1;
        $elapsedInCurrent = $quarterLength - $timeRemaining;

        return ($completedQuarters * $quarterLength) + $elapsedInCurrent;
    }

    /**
     * For staggered strategy: never sub out both primary ball-handlers at once.
     */
    private function applyStaggeredConstraint(array $sitCandidates, array $currentLineup): array
    {
        // Find ball handlers in current lineup (PG + highest-rated guard)
        $ballHandlerIds = [];
        foreach ($currentLineup as $player) {
            $pos = $player['position'] ?? '';
            if ($pos === 'PG' || $pos === 'SG') {
                $ballHandlerIds[] = $player['id'];
            }
        }

        // Count how many ball handlers are in sit candidates
        $bhInSitList = array_filter($sitCandidates, fn($c) => in_array($c['id'], $ballHandlerIds));

        if (count($bhInSitList) > 1) {
            // Remove all but the one most ahead of pace
            $removedFirst = false;
            $sitCandidates = array_filter($sitCandidates, function ($c) use ($ballHandlerIds, &$removedFirst) {
                if (in_array($c['id'], $ballHandlerIds)) {
                    if (!$removedFirst) {
                        $removedFirst = true;
                        return true; // keep the first (most ahead of pace)
                    }
                    return false; // remove subsequent
                }
                return true;
            });
            $sitCandidates = array_values($sitCandidates);
        }

        return $sitCandidates;
    }

    /**
     * Find the best bench replacement for a player being subbed out.
     */
    private function findBenchReplacement(
        array $benchPlayers,
        array $sitCandidate,
        array $boxScore,
        array $targetMinutes,
        float $gameElapsed,
        array $currentLineupIds
    ): ?array {
        $position = $sitCandidate['position'];
        $secondaryPosition = $sitCandidate['secondary_position'];

        $candidates = [];
        foreach ($benchPlayers as $player) {
            // Skip if already in lineup
            if (in_array($player['id'], $currentLineupIds)) {
                continue;
            }

            // Must be able to play the position
            $playerPos = $player['position'] ?? '';
            $playerSecondary = $player['secondary_position'] ?? null;
            $canPlay = ($playerPos === $position || $playerSecondary === $position
                || $playerPos === $secondaryPosition || $playerSecondary === $secondaryPosition);

            if (!$canPlay) {
                continue;
            }

            // Must have minutes remaining in budget
            $actualMinutes = $boxScore[$player['id']]['minutes'] ?? 0;
            $target = $targetMinutes[$player['id']] ?? 0;
            $remaining = $target - $actualMinutes;

            if ($remaining <= 0) {
                continue;
            }

            $candidates[] = [
                'player' => $player,
                'id' => $player['id'],
                'rating' => $player['overall_rating'] ?? 70,
                'minutesRemaining' => $remaining,
            ];
        }

        if (empty($candidates)) {
            return null;
        }

        // Prefer highest-rated
        usort($candidates, fn($a, $b) => $b['rating'] <=> $a['rating']);

        return $candidates[0]['player'];
    }

    /**
     * Get minute distribution template per strategy.
     * Index 0 = best player, index 1 = 2nd best, etc.
     */
    private function getDistributionTemplate(string $strategy): array
    {
        return match ($strategy) {
            'staggered' => [34, 32, 30, 28, 26, 18, 14, 10, 8, 0, 0, 0, 0, 0, 0],
            'tight_rotation' => [36, 34, 32, 30, 28, 16, 12, 8, 4, 0, 0, 0, 0, 0, 0],
            'deep_bench' => [30, 28, 26, 24, 22, 18, 16, 14, 12, 10, 0, 0, 0, 0, 0],
            'platoon' => [32, 30, 28, 26, 24, 18, 16, 12, 8, 6, 0, 0, 0, 0, 0],
            default => [34, 32, 30, 28, 26, 18, 14, 10, 8, 0, 0, 0, 0, 0, 0], // staggered default
        };
    }
}
