<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\DraftPick;
use App\Models\Player;
use App\Models\Team;

class AITradeEvaluationService
{
    private ?array $currentDiffConfig = null;

    public function __construct(
        private DraftPickService $draftPickService,
        private CampaignPlayerService $playerService,
        private CampaignSeasonService $seasonService
    ) {}

    /**
     * Evaluate a trade proposal from AI team's perspective.
     * Returns: 'accept', 'reject', or 'counter' with reason.
     */
    public function evaluateTrade(
        array $proposal,
        Team $aiTeam,
        Campaign $campaign
    ): array {
        $this->currentDiffConfig = $this->getDifficultyConfig($campaign->difficulty ?? 'pro');
        $context = $this->buildContext($campaign, $aiTeam);
        $teamDirection = $this->analyzeTeamDirection($aiTeam, $context);

        $receiving = $this->calculateReceivingValue($proposal['aiReceives'], $aiTeam, $teamDirection, $campaign);
        $giving = $this->calculateGivingValue($proposal['aiGives'], $aiTeam, $teamDirection, $campaign);

        $netValue = $receiving - $giving;
        $thresholdPct = $this->currentDiffConfig['threshold_pct'];
        $fairnessMult = $this->currentDiffConfig['fairness_mult'];
        $fairnessThreshold = max($giving * $thresholdPct * $fairnessMult, 1);

        \Log::info("Trade evaluation", [
            'ai_team' => $aiTeam->abbreviation,
            'direction' => $teamDirection,
            'difficulty' => $campaign->difficulty ?? 'pro',
            'receiving_value' => $receiving,
            'giving_value' => $giving,
            'net_value' => $netValue,
            'threshold' => $fairnessThreshold,
        ]);

        if ($netValue >= -$fairnessThreshold) {
            return [
                'decision' => 'accept',
                'reason' => null,
                'team_direction' => $teamDirection,
                'value_analysis' => [
                    'receiving' => $receiving,
                    'giving' => $giving,
                    'net' => $netValue,
                ],
            ];
        }

        return [
            'decision' => 'reject',
            'reason' => $this->getRejectReason($netValue, $teamDirection, $proposal, $campaign),
            'team_direction' => $teamDirection,
            'value_analysis' => [
                'receiving' => $receiving,
                'giving' => $giving,
                'net' => $netValue,
            ],
        ];
    }

    /**
     * Get difficulty configuration for trade evaluation.
     */
    public function getDifficultyConfig(string $difficulty): array
    {
        return match ($difficulty) {
            'rookie' => [
                'threshold_pct' => 0.25,
                'fairness_mult' => 1.6,
                'star_protection' => 0.8,
                'pick_sensitivity' => 0.85,
            ],
            'all_star' => [
                'threshold_pct' => 0.10,
                'fairness_mult' => 0.7,
                'star_protection' => 1.25,
                'pick_sensitivity' => 1.15,
            ],
            'hall_of_fame' => [
                'threshold_pct' => 0.05,
                'fairness_mult' => 0.45,
                'star_protection' => 1.5,
                'pick_sensitivity' => 1.30,
            ],
            default => [ // 'pro'
                'threshold_pct' => 0.15,
                'fairness_mult' => 1.0,
                'star_protection' => 1.0,
                'pick_sensitivity' => 1.0,
            ],
        };
    }

    /**
     * Build context for trade evaluation.
     */
    public function buildContext(Campaign $campaign, Team $team): array
    {
        $season = $campaign->currentSeason;
        $standings = $season?->standings ?? ['east' => [], 'west' => []];

        // Count games played
        $gamesPlayed = 0;
        foreach (['east', 'west'] as $conf) {
            foreach ($standings[$conf] ?? [] as $standing) {
                $gamesPlayed = max($gamesPlayed, ($standing['wins'] ?? 0) + ($standing['losses'] ?? 0));
            }
        }

        return [
            'standings' => $this->flattenStandings($standings),
            'gamesPlayed' => $gamesPlayed,
            'season_phase' => $season?->phase ?? 'preseason',
        ];
    }

    /**
     * Flatten standings to team abbreviation => record map.
     */
    private function flattenStandings(array $standings): array
    {
        $flat = [];
        foreach (['east', 'west'] as $conf) {
            foreach ($standings[$conf] ?? [] as $standing) {
                $teamId = $standing['teamId'] ?? null;
                if ($teamId) {
                    $team = Team::find($teamId);
                    if ($team) {
                        $flat[$team->abbreviation] = [
                            'wins' => $standing['wins'] ?? 0,
                            'losses' => $standing['losses'] ?? 0,
                        ];
                    }
                }
            }
        }
        return $flat;
    }

    /**
     * Analyze the team's roster composition.
     * Returns metrics used for direction classification.
     */
    public function analyzeRoster(Team $team, Campaign $campaign): array
    {
        $roster = $this->playerService->getTeamRoster($campaign->id, $team->abbreviation);

        if (empty($roster)) {
            return [
                'starPower' => 0,
                'coreAlignment' => 0.5,
                'youthScore' => 0.5,
                'avgOverall' => 75,
            ];
        }

        // Sort by overall rating descending, take top 5 as "core"
        usort($roster, function ($a, $b) {
            return ($b['overallRating'] ?? $b['overall_rating'] ?? 75) <=> ($a['overallRating'] ?? $a['overall_rating'] ?? 75);
        });

        $core = array_slice($roster, 0, min(5, count($roster)));

        // Star power: 85+ = 1 star credit, 82+ = 0.5 credit, normalized /2
        $starCredits = 0;
        foreach ($core as $player) {
            $rating = $player['overallRating'] ?? $player['overall_rating'] ?? 75;
            if ($rating >= 85) {
                $starCredits += 1.0;
            } elseif ($rating >= 82) {
                $starCredits += 0.5;
            }
        }
        $starPower = min(1.0, $starCredits / 2.0);

        // Core ages
        $coreAges = [];
        foreach ($core as $player) {
            $birthDate = $player['birthDate'] ?? $player['birth_date'] ?? null;
            $age = $birthDate ? (int) abs($campaign->current_date->diffInYears($birthDate)) : 25;
            $coreAges[] = $age;
        }

        // Core alignment: how tight is the age range? (<=3yrs = 1.0, >=10 = 0)
        if (count($coreAges) >= 2) {
            $ageRange = max($coreAges) - min($coreAges);
            $coreAlignment = max(0, 1.0 - ($ageRange - 3) / 7);
        } else {
            $coreAlignment = 0.5;
        }

        // Youth score: avg core age mapped (22 → 1.0, 32+ → 0)
        $avgCoreAge = count($coreAges) > 0 ? array_sum($coreAges) / count($coreAges) : 27;
        $youthScore = max(0, min(1.0, (32 - $avgCoreAge) / 10));

        // Full roster average
        $totalRating = 0;
        $count = 0;
        foreach ($roster as $player) {
            $totalRating += $player['overallRating'] ?? $player['overall_rating'] ?? 75;
            $count++;
        }
        $avgOverall = $count > 0 ? $totalRating / $count : 75;

        return [
            'starPower' => round($starPower, 2),
            'coreAlignment' => round($coreAlignment, 2),
            'youthScore' => round($youthScore, 2),
            'avgOverall' => round($avgOverall, 1),
            'avgCoreAge' => round($avgCoreAge, 1),
        ];
    }

    /**
     * Analyze team direction using 4 archetypes.
     * Blends roster analysis with record (record weight increases as season progresses).
     */
    public function analyzeTeamDirection(Team $team, array $context): string
    {
        $standings = $context['standings'];
        $gamesPlayed = $context['gamesPlayed'];
        $totalGames = 54;

        $teamRecord = $standings[$team->abbreviation] ?? ['wins' => 0, 'losses' => 0];
        $wins = $teamRecord['wins'] ?? 0;
        $losses = $teamRecord['losses'] ?? 0;
        $winPct = ($wins + $losses) > 0 ? $wins / ($wins + $losses) : 0.5;

        // Record weight increases as season progresses
        $recordWeight = min(0.7, ($gamesPlayed / $totalGames) * 0.9);
        $rosterWeight = 1.0 - $recordWeight;

        // Get roster analysis
        $campaign = $team->campaign;
        $rosterMetrics = $campaign
            ? $this->analyzeRoster($team, $campaign)
            : ['starPower' => 0, 'coreAlignment' => 0.5, 'youthScore' => 0.5, 'avgOverall' => 75];

        // Compute blended scores for each archetype
        // Record-based signals
        $recordStrength = $winPct; // 0 to 1

        // Roster-based signals
        $starPower = $rosterMetrics['starPower'];
        $youthScore = $rosterMetrics['youthScore'];
        $avgOverall = $rosterMetrics['avgOverall'];

        // Title contender: multiple stars + strong record
        $contenderScore = ($starPower * 0.5 + min(1, ($avgOverall - 72) / 10) * 0.3) * $rosterWeight
            + ($recordStrength > 0.6 ? $recordStrength : $recordStrength * 0.5) * $recordWeight;

        // Win-now: decent star power + good (not elite) record
        $winNowScore = ($starPower * 0.35 + min(1, ($avgOverall - 70) / 10) * 0.3) * $rosterWeight
            + (($recordStrength > 0.45 && $recordStrength <= 0.65) ? 0.7 : $recordStrength * 0.4) * $recordWeight;

        // Ascending: young core, values development
        $ascendingScore = ($youthScore * 0.5 + (1 - $starPower) * 0.2) * $rosterWeight
            + (($recordStrength >= 0.35 && $recordStrength <= 0.55) ? 0.6 : 0.3) * $recordWeight;

        // Rebuilding: poor record + aging or weak roster
        $rebuildingScore = ((1 - min(1, ($avgOverall - 68) / 12)) * 0.4 + (1 - $starPower) * 0.3) * $rosterWeight
            + (($recordStrength < 0.4) ? (1 - $recordStrength) : 0.2) * $recordWeight;

        // Pick the highest scoring direction
        $scores = [
            'title_contender' => $contenderScore,
            'win_now' => $winNowScore,
            'ascending' => $ascendingScore,
            'rebuilding' => $rebuildingScore,
        ];

        // Special overrides for clear-cut cases
        if ($gamesPlayed >= 20) {
            $gamesRemaining = $totalGames - $gamesPlayed;
            $winsNeeded = 41 - $wins;
            if ($gamesRemaining > 0 && $winsNeeded > $gamesRemaining) {
                return 'rebuilding'; // Mathematically eliminated
            }
        }

        if ($starPower >= 0.8 && $winPct >= 0.65 && $gamesPlayed >= 15) {
            return 'title_contender';
        }

        arsort($scores);
        return array_key_first($scores);
    }

    /**
     * Get direction-specific multipliers for trade valuation.
     */
    private function getDirectionMultipliers(string $direction): array
    {
        return match ($direction) {
            'title_contender' => [
                'starReceivePremium' => 1.25,
                'starGiveProtection' => 1.35,
                'youngReceiveDiscount' => 0.95,
                'youngGiveEase' => 0.9,
                'vetReceivePremium' => 1.1,
                'vetGiveEase' => 0.85,
                'pickReceiveDiscount' => 0.65,
                'pickGiveSensitivity' => 0.75,
            ],
            'win_now' => [
                'starReceivePremium' => 1.2,
                'starGiveProtection' => 1.25,
                'youngReceiveDiscount' => 1.0,
                'youngGiveEase' => 0.95,
                'vetReceivePremium' => 1.05,
                'vetGiveEase' => 0.9,
                'pickReceiveDiscount' => 0.75,
                'pickGiveSensitivity' => 0.85,
            ],
            'ascending' => [
                'starReceivePremium' => 1.05,
                'starGiveProtection' => 1.1,
                'youngReceiveDiscount' => 1.2,
                'youngGiveEase' => 1.15,
                'vetReceivePremium' => 0.9,
                'vetGiveEase' => 0.85,
                'pickReceiveDiscount' => 1.2,
                'pickGiveSensitivity' => 1.3,
            ],
            'rebuilding' => [
                'starReceivePremium' => 0.9,
                'starGiveProtection' => 0.85,
                'youngReceiveDiscount' => 1.25,
                'youngGiveEase' => 1.2,
                'vetReceivePremium' => 0.8,
                'vetGiveEase' => 0.75,
                'pickReceiveDiscount' => 1.4,
                'pickGiveSensitivity' => 1.5,
            ],
        };
    }

    /**
     * Calculate timeline fit for an incoming player relative to team's core age.
     */
    private function calculateTimelineFit(int $playerAge, string $direction, Team $team, Campaign $campaign): float
    {
        // Rebuilding teams don't penalize timeline mismatches
        if ($direction === 'rebuilding') {
            return 1.0;
        }

        $rosterMetrics = $this->analyzeRoster($team, $campaign);
        $coreAge = $rosterMetrics['avgCoreAge'] ?? 27;
        $ageDiff = abs($playerAge - $coreAge);

        if ($ageDiff <= 2) return 1.10;
        if ($ageDiff <= 4) return 1.0;
        if ($ageDiff <= 7) return 0.92;
        return 0.85;
    }

    /**
     * Get average overall rating of team's roster.
     */
    private function getTeamAverageRating(Team $team): float
    {
        $dbPlayers = Player::where('team_id', $team->id)->get();
        if ($dbPlayers->count() > 0) {
            return $dbPlayers->avg('overall_rating') ?? 75;
        }

        $campaign = $team->campaign;
        if (!$campaign) return 75;

        $roster = $this->playerService->getTeamRoster($campaign->id, $team->abbreviation);
        if (empty($roster)) return 75;

        $total = array_reduce($roster, fn($sum, $p) =>
            $sum + ($p['overallRating'] ?? $p['overall_rating'] ?? 75), 0);

        return $total / count($roster);
    }

    /**
     * Get player data from DB or JSON.
     */
    public function getPlayer($playerId, Campaign $campaign): ?array
    {
        $dbPlayer = Player::where('campaign_id', $campaign->id)
            ->where('id', $playerId)
            ->first();

        if ($dbPlayer) {
            return [
                'id' => $dbPlayer->id,
                'firstName' => $dbPlayer->first_name,
                'lastName' => $dbPlayer->last_name,
                'position' => $dbPlayer->position,
                'secondaryPosition' => $dbPlayer->secondary_position,
                'overallRating' => $dbPlayer->overall_rating,
                'age' => $dbPlayer->birth_date ? (int) abs($campaign->current_date->diffInYears($dbPlayer->birth_date)) : 25,
                'contractSalary' => (float) $dbPlayer->contract_salary,
                'contractYearsRemaining' => $dbPlayer->contract_years_remaining ?? 1,
                'tradeValue' => $dbPlayer->trade_value,
                'tradeValueTotal' => $dbPlayer->trade_value_total,
                'teamId' => $dbPlayer->team_id,
            ];
        }

        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        foreach ($leaguePlayers as $player) {
            if (($player['id'] ?? '') == $playerId) {
                $birthDate = $player['birthDate'] ?? null;
                $age = $birthDate ? (int) abs($campaign->current_date->diffInYears($birthDate)) : 25;

                return [
                    'id' => $player['id'],
                    'firstName' => $player['firstName'],
                    'lastName' => $player['lastName'],
                    'position' => $player['position'],
                    'secondaryPosition' => $player['secondaryPosition'] ?? null,
                    'overallRating' => $player['overallRating'],
                    'age' => $age,
                    'contractSalary' => (float) ($player['contractSalary'] ?? $player['contract_salary'] ?? 0),
                    'contractYearsRemaining' => $player['contractYearsRemaining'] ?? $player['contract_years_remaining'] ?? 1,
                    'tradeValue' => $player['tradeValue'] ?? null,
                    'tradeValueTotal' => $player['tradeValueTotal'] ?? null,
                    'teamAbbreviation' => $player['teamAbbreviation'],
                ];
            }
        }

        return null;
    }

    /**
     * Get player's season stats.
     */
    private function getPlayerSeasonStats($playerId, Campaign $campaign): ?array
    {
        $season = $campaign->currentSeason;
        if (!$season) return null;

        return $this->seasonService->getPlayerStats(
            $campaign->id,
            $season->year,
            (string) $playerId
        );
    }

    /**
     * Calculate universal young player premium.
     */
    private function calculateYoungPlayerPremium(int $age): float
    {
        if ($age <= 22) return 1.25;
        if ($age <= 25) return 1.15;
        if ($age <= 27) return 1.0;
        if ($age <= 30) return 0.90;
        return 0.75;
    }

    /**
     * Calculate expected salary based on overall rating and production.
     */
    private function calculateExpectedSalary(?array $playerStats, int $overallRating): float
    {
        $ratingBase = match(true) {
            $overallRating >= 90 => 40_000_000,
            $overallRating >= 85 => 30_000_000,
            $overallRating >= 80 => 20_000_000,
            $overallRating >= 75 => 10_000_000,
            $overallRating >= 70 =>  5_000_000,
            default              =>  2_000_000,
        };

        if ($playerStats && ($playerStats['gamesPlayed'] ?? 0) >= 5) {
            $gp = $playerStats['gamesPlayed'];
            $ppg = ($playerStats['points'] ?? 0) / $gp;
            $rpg = ($playerStats['rebounds'] ?? 0) / $gp;
            $apg = ($playerStats['assists'] ?? 0) / $gp;

            $production = $ppg + ($apg * 0.5) + ($rpg * 0.5);

            $expectedProduction = match(true) {
                $overallRating >= 90 => 35,
                $overallRating >= 85 => 25,
                $overallRating >= 80 => 18,
                $overallRating >= 75 => 12,
                default              => 8,
            };

            $productionRatio = min(1.2, max(0.8, $production / max(1, $expectedProduction)));
            $ratingBase *= $productionRatio;
        }

        return $ratingBase;
    }

    /**
     * Calculate contract value multiplier (bargain vs overpaid).
     */
    private function calculateContractValueMultiplier(float $actualSalary, float $expectedSalary): float
    {
        if ($expectedSalary <= 0) return 1.0;

        $ratio = $actualSalary / $expectedSalary;

        if ($ratio <= 0.5) return 1.30;
        if ($ratio <= 0.75) return 1.15;
        if ($ratio <= 1.0) return 1.0;
        if ($ratio <= 1.25) return 0.95;
        if ($ratio <= 1.5) return 0.85;
        return 0.70;
    }

    /**
     * Calculate expiring contract bonus value.
     */
    private function calculateExpiringContractValue(
        int $yearsRemaining,
        float $salary,
        string $teamDirection
    ): float {
        if (!in_array($teamDirection, ['rebuilding', 'ascending'])) return 0;
        if ($yearsRemaining > 1) return 0;

        return min(2.0, $salary * 0.05 / 1_000_000);
    }

    /**
     * Calculate value of assets team is receiving.
     */
    private function calculateReceivingValue(
        array $assets,
        Team $aiTeam,
        string $direction,
        Campaign $campaign
    ): float {
        $value = 0;
        $mults = $this->getDirectionMultipliers($direction);
        $diffConfig = $this->currentDiffConfig ?? $this->getDifficultyConfig('pro');

        foreach ($assets as $asset) {
            if ($asset['type'] === 'player') {
                $player = $this->getPlayer($asset['playerId'], $campaign);
                if (!$player) continue;

                $baseValue = $player['tradeValue'] ?? $player['tradeValueTotal'] ?? 10;
                $age = $player['age'] ?? 25;
                $rating = $player['overallRating'] ?? 75;
                $salary = $player['contractSalary'] ?? 0;
                $yearsRemaining = $player['contractYearsRemaining'] ?? 1;

                // Universal young player premium
                $baseValue *= $this->calculateYoungPlayerPremium($age);

                // Contract value adjustment
                $playerStats = $this->getPlayerSeasonStats($asset['playerId'], $campaign);
                $expectedSalary = $this->calculateExpectedSalary($playerStats, $rating);
                $baseValue *= $this->calculateContractValueMultiplier($salary, $expectedSalary);

                // Expiring contract bonus
                $baseValue += $this->calculateExpiringContractValue($yearsRemaining, $salary, $direction);

                // Timeline fit
                $baseValue *= $this->calculateTimelineFit($age, $direction, $aiTeam, $campaign);

                // Direction-specific multipliers
                if ($rating >= 82) {
                    $baseValue *= $mults['starReceivePremium'];
                }
                if ($age <= 24) {
                    $baseValue *= $mults['youngReceiveDiscount'];
                }
                if ($age >= 30) {
                    $baseValue *= $mults['vetReceivePremium'];
                }

                // Positional need bonus
                if ($this->hasPositionalNeed($aiTeam, $player['position'], $campaign)) {
                    $baseValue *= 1.15;
                }

                \Log::debug("Trade receiving player value", [
                    'player' => $player['firstName'] . ' ' . $player['lastName'],
                    'age' => $age,
                    'rating' => $rating,
                    'direction' => $direction,
                    'final_value' => $baseValue,
                ]);

                $value += $baseValue;

            } elseif ($asset['type'] === 'pick') {
                $pick = DraftPick::find($asset['pickId']);
                if (!$pick) continue;

                $projectedPos = $this->draftPickService->projectPickPosition($campaign, $pick->original_team_id);
                $pickValue = $this->draftPickService->calculatePickValue($pick, $campaign, $projectedPos);

                // Direction-specific pick valuation
                $pickValue *= $mults['pickReceiveDiscount'];

                // Difficulty-based pick sensitivity
                $pickValue *= $diffConfig['pick_sensitivity'];

                $value += $pickValue;
            }
        }

        return round($value, 2);
    }

    /**
     * Calculate value of assets team is giving up.
     */
    private function calculateGivingValue(
        array $assets,
        Team $aiTeam,
        string $direction,
        Campaign $campaign
    ): float {
        $value = 0;
        $mults = $this->getDirectionMultipliers($direction);
        $diffConfig = $this->currentDiffConfig ?? $this->getDifficultyConfig('pro');

        foreach ($assets as $asset) {
            if ($asset['type'] === 'player') {
                $player = $this->getPlayer($asset['playerId'], $campaign);
                if (!$player) continue;

                $baseValue = $player['tradeValue'] ?? $player['tradeValueTotal'] ?? 10;
                $age = $player['age'] ?? 25;
                $rating = $player['overallRating'] ?? 75;
                $salary = $player['contractSalary'] ?? 0;

                // Universal young player premium (reluctance to trade young players)
                $baseValue *= $this->calculateYoungPlayerPremium($age);

                // Contract value (overpaid = easier to trade away)
                $playerStats = $this->getPlayerSeasonStats($asset['playerId'], $campaign);
                $expectedSalary = $this->calculateExpectedSalary($playerStats, $rating);
                $baseValue *= $this->calculateContractValueMultiplier($salary, $expectedSalary);

                // Direction-specific giving multipliers
                if ($rating >= 82) {
                    $baseValue *= $mults['starGiveProtection'];
                    // Difficulty-based star protection
                    $baseValue *= $diffConfig['star_protection'];
                }
                if ($age <= 24) {
                    $baseValue *= $mults['youngGiveEase'];
                }
                if ($age >= 30) {
                    $baseValue *= $mults['vetGiveEase'];
                }

                \Log::debug("Trade giving player value", [
                    'player' => $player['firstName'] . ' ' . $player['lastName'],
                    'age' => $age,
                    'rating' => $rating,
                    'direction' => $direction,
                    'final_value' => $baseValue,
                ]);

                $value += $baseValue;

            } elseif ($asset['type'] === 'pick') {
                $pick = DraftPick::find($asset['pickId']);
                if (!$pick) continue;

                $projectedPos = $this->draftPickService->projectPickPosition($campaign, $pick->original_team_id);
                $pickValue = $this->draftPickService->calculatePickValue($pick, $campaign, $projectedPos);

                // Direction-specific pick reluctance
                $pickValue *= $mults['pickGiveSensitivity'];

                // Difficulty-based pick sensitivity
                $pickValue *= $diffConfig['pick_sensitivity'];

                $value += $pickValue;
            }
        }

        return round($value, 2);
    }

    /**
     * Check if team needs a specific position.
     */
    private function hasPositionalNeed(Team $team, ?string $position, Campaign $campaign): bool
    {
        if (!$position) return false;

        $roster = $this->playerService->getTeamRoster($campaign->id, $team->abbreviation);

        $count = 0;
        foreach ($roster as $player) {
            $primary = $player['position'] ?? '';
            $secondary = $player['secondaryPosition'] ?? '';
            if ($primary === $position || $secondary === $position) {
                $count++;
            }
        }

        return $count <= 1;
    }

    /**
     * Get rejection reason based on trade analysis, handling all 4 archetypes.
     */
    private function getRejectReason(float $netValue, string $direction, array $proposal, Campaign $campaign): string
    {
        $deficit = abs($netValue);

        if ($direction === 'rebuilding') {
            if (!$this->hasPicksInAssets($proposal['aiReceives'])) {
                return "We're looking to acquire draft picks in any deal.";
            }
            if ($this->hasVeterans($proposal['aiReceives'], $campaign)) {
                return "We're focused on building for the future with young talent.";
            }
            return "We'd need more young talent or draft compensation to make this work.";
        }

        if ($direction === 'title_contender') {
            if (!$this->hasStars($proposal['aiReceives'], $campaign)) {
                return "We need proven stars who can help us compete for a championship.";
            }
            if ($this->hasYoungPlayers($proposal['aiReceives'], $campaign) && !$this->hasStars($proposal['aiReceives'], $campaign)) {
                return "We can't afford to take on unproven talent at this stage.";
            }
            return "The return doesn't match the caliber of player we'd be giving up.";
        }

        if ($direction === 'win_now') {
            if (!$this->hasStars($proposal['aiReceives'], $campaign)) {
                return "We need proven players who can help us win now.";
            }
            return "The value isn't there for a win-now team like us.";
        }

        if ($direction === 'ascending') {
            if ($this->hasVeterans($proposal['aiReceives'], $campaign) && !$this->hasPicksInAssets($proposal['aiReceives'])) {
                return "We're building something special with our young core. We need picks or young talent.";
            }
            if (!$this->hasYoungPlayers($proposal['aiReceives'], $campaign) && !$this->hasPicksInAssets($proposal['aiReceives'])) {
                return "We're focused on acquiring young talent and draft capital for our future.";
            }
            return "We don't see enough upside in this deal for our timeline.";
        }

        if ($deficit > 5) {
            return "We'd need significantly more value to consider this trade.";
        }
        return "We don't see enough value in this proposal.";
    }

    /**
     * Check if assets include any draft picks.
     */
    private function hasPicksInAssets(array $assets): bool
    {
        foreach ($assets as $asset) {
            if ($asset['type'] === 'pick') {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if assets include veterans (age >= 30).
     */
    private function hasVeterans(array $assets, Campaign $campaign): bool
    {
        foreach ($assets as $asset) {
            if ($asset['type'] === 'player') {
                $player = $this->getPlayer($asset['playerId'], $campaign);
                if ($player && ($player['age'] ?? 25) >= 30) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Check if assets include star players (rating >= 82).
     */
    private function hasStars(array $assets, Campaign $campaign): bool
    {
        foreach ($assets as $asset) {
            if ($asset['type'] === 'player') {
                $player = $this->getPlayer($asset['playerId'], $campaign);
                if ($player && ($player['overallRating'] ?? 75) >= 82) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Check if assets include young players (age <= 24).
     */
    public function hasYoungPlayers(array $assets, Campaign $campaign): bool
    {
        foreach ($assets as $asset) {
            if ($asset['type'] === 'player') {
                $player = $this->getPlayer($asset['playerId'], $campaign);
                if ($player && ($player['age'] ?? 25) <= 24) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get trade interest level for display.
     * Returns: 'high', 'medium', 'low', 'none'
     */
    public function getTradeInterest(Team $aiTeam, Campaign $campaign): string
    {
        $context = $this->buildContext($campaign, $aiTeam);
        $direction = $this->analyzeTeamDirection($aiTeam, $context);

        return match ($direction) {
            'rebuilding' => 'high',
            'ascending' => 'medium',
            'win_now' => 'medium',
            'title_contender' => 'low',
            default => 'medium',
        };
    }
}
