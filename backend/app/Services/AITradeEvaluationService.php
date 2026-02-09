<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\DraftPick;
use App\Models\Player;
use App\Models\Team;

class AITradeEvaluationService
{
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
        $context = $this->buildContext($campaign, $aiTeam);
        $teamDirection = $this->analyzeTeamDirection($aiTeam, $context);

        $receiving = $this->calculateReceivingValue($proposal['aiReceives'], $aiTeam, $teamDirection, $campaign);
        $giving = $this->calculateGivingValue($proposal['aiGives'], $aiTeam, $teamDirection, $campaign);

        $netValue = $receiving - $giving;
        $fairnessThreshold = max($giving * 0.15, 1); // Allow 15% swing, minimum 1 point

        \Log::info("Trade evaluation", [
            'ai_team' => $aiTeam->abbreviation,
            'direction' => $teamDirection,
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
            'reason' => $this->getRejectReason($netValue, $teamDirection, $proposal),
            'team_direction' => $teamDirection,
            'value_analysis' => [
                'receiving' => $receiving,
                'giving' => $giving,
                'net' => $netValue,
            ],
        ];
    }

    /**
     * Build context for trade evaluation.
     */
    private function buildContext(Campaign $campaign, Team $team): array
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
     * Analyze team direction: rebuilding, contending, or middling.
     */
    public function analyzeTeamDirection(Team $team, array $context): string
    {
        $standings = $context['standings'];
        $gamesPlayed = $context['gamesPlayed'];
        $totalGames = 82;

        $teamRecord = $standings[$team->abbreviation] ?? ['wins' => 0, 'losses' => 0];
        $wins = $teamRecord['wins'] ?? 0;
        $losses = $teamRecord['losses'] ?? 0;
        $winPct = ($wins + $losses) > 0 ? $wins / ($wins + $losses) : 0.5;

        // Early season: use roster quality
        if ($gamesPlayed < 20) {
            $avgOverall = $this->getTeamAverageRating($team);
            if ($avgOverall >= 78) return 'contending';
            if ($avgOverall <= 72) return 'rebuilding';
            return 'middling';
        }

        // Mid/late season: use actual record
        $gamesRemaining = $totalGames - $gamesPlayed;
        $winsNeeded = 41 - $wins; // ~41 wins for playoffs

        if ($gamesRemaining > 0 && $winsNeeded > $gamesRemaining) {
            return 'rebuilding'; // Mathematically eliminated
        }

        if ($winPct >= 0.600) return 'contending';
        if ($winPct <= 0.400) return 'rebuilding';

        return 'middling';
    }

    /**
     * Get average overall rating of team's roster.
     */
    private function getTeamAverageRating(Team $team): float
    {
        // Try database players first
        $dbPlayers = Player::where('team_id', $team->id)->get();
        if ($dbPlayers->count() > 0) {
            return $dbPlayers->avg('overall_rating') ?? 75;
        }

        // Try JSON players
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
    private function getPlayer($playerId, Campaign $campaign): ?array
    {
        // Try database first
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
                'age' => $dbPlayer->birth_date ? now()->diffInYears($dbPlayer->birth_date) : 25,
                'contractSalary' => (float) $dbPlayer->contract_salary,
                'contractYearsRemaining' => $dbPlayer->contract_years_remaining ?? 1,
                'tradeValue' => $dbPlayer->trade_value,
                'tradeValueTotal' => $dbPlayer->trade_value_total,
                'teamId' => $dbPlayer->team_id,
            ];
        }

        // Try JSON players
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        foreach ($leaguePlayers as $player) {
            if (($player['id'] ?? '') == $playerId) {
                $birthDate = $player['birthDate'] ?? null;
                $age = $birthDate ? now()->diffInYears($birthDate) : 25;

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
     * All teams value young talent more highly.
     */
    private function calculateYoungPlayerPremium(int $age): float
    {
        if ($age <= 22) return 1.25;  // Elite young prospect
        if ($age <= 25) return 1.15;  // Young with upside
        if ($age <= 27) return 1.0;   // Prime years (neutral)
        if ($age <= 30) return 0.90;  // Declining value
        return 0.75;                   // Veteran decline
    }

    /**
     * Calculate expected salary based on overall rating and production.
     */
    private function calculateExpectedSalary(?array $playerStats, int $overallRating): float
    {
        // Base salary from overall rating (scale: $1M to $45M)
        $ratingBase = match(true) {
            $overallRating >= 90 => 40_000_000,  // Superstar
            $overallRating >= 85 => 30_000_000,  // All-Star
            $overallRating >= 80 => 20_000_000,  // Starter
            $overallRating >= 75 => 10_000_000,  // Rotation
            $overallRating >= 70 =>  5_000_000,  // Bench
            default              =>  2_000_000,  // Minimum
        };

        // Stats adjustment: +/- 20% based on production
        if ($playerStats && ($playerStats['gamesPlayed'] ?? 0) >= 5) {
            $gp = $playerStats['gamesPlayed'];
            $ppg = ($playerStats['points'] ?? 0) / $gp;
            $rpg = ($playerStats['rebounds'] ?? 0) / $gp;
            $apg = ($playerStats['assists'] ?? 0) / $gp;

            // Simple production score
            $production = $ppg + ($apg * 0.5) + ($rpg * 0.5);

            // Expected production by rating tier
            $expectedProduction = match(true) {
                $overallRating >= 90 => 35,
                $overallRating >= 85 => 25,
                $overallRating >= 80 => 18,
                $overallRating >= 75 => 12,
                default              => 8,
            };

            // Adjust base by production ratio (capped at +/- 20%)
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

        // Underpaid players (bargain contracts) are more valuable
        if ($ratio <= 0.5) return 1.30;   // Massive bargain
        if ($ratio <= 0.75) return 1.15;  // Good value
        if ($ratio <= 1.0) return 1.0;    // Fair contract

        // Overpaid players are less valuable in trades
        if ($ratio <= 1.25) return 0.95;  // Slightly overpaid
        if ($ratio <= 1.5) return 0.85;   // Overpaid
        return 0.70;                       // Massively overpaid
    }

    /**
     * Calculate expiring contract bonus value.
     * Only rebuilding teams value cap relief.
     */
    private function calculateExpiringContractValue(
        int $yearsRemaining,
        float $salary,
        string $teamDirection
    ): float {
        // Only rebuilding teams value cap relief
        if ($teamDirection !== 'rebuilding') return 0;

        // Only expiring contracts (1 year or less)
        if ($yearsRemaining > 1) return 0;

        // Cap relief value: ~5% of salary as trade value bonus
        // Max of 2 trade value points for big contracts
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

        foreach ($assets as $asset) {
            if ($asset['type'] === 'player') {
                $player = $this->getPlayer($asset['playerId'], $campaign);
                if (!$player) continue;

                $baseValue = $player['tradeValue'] ?? $player['tradeValueTotal'] ?? 10;
                $age = $player['age'] ?? 25;
                $rating = $player['overallRating'] ?? 75;
                $salary = $player['contractSalary'] ?? 0;
                $yearsRemaining = $player['contractYearsRemaining'] ?? 1;

                // Universal young player premium (applies to all teams)
                $baseValue *= $this->calculateYoungPlayerPremium($age);

                // Contract value adjustment (bargain vs overpaid)
                $playerStats = $this->getPlayerSeasonStats($asset['playerId'], $campaign);
                $expectedSalary = $this->calculateExpectedSalary($playerStats, $rating);
                $baseValue *= $this->calculateContractValueMultiplier($salary, $expectedSalary);

                // Expiring contract bonus for rebuilding teams
                $baseValue += $this->calculateExpiringContractValue($yearsRemaining, $salary, $direction);

                // Direction-specific adjustments (reduced magnitude since young premium is universal)
                if ($direction === 'rebuilding') {
                    if ($age <= 24) $baseValue *= 1.15;  // Extra young premium (reduced from 1.3)
                    if ($age >= 30) $baseValue *= 0.8;   // Vets discounted
                } elseif ($direction === 'contending') {
                    if ($rating >= 80) $baseValue *= 1.2;  // Stars premium
                    // Removed unproven discount - young premium handles age valuation
                }

                // Positional need bonus
                if ($this->hasPositionalNeed($aiTeam, $player['position'], $campaign)) {
                    $baseValue *= 1.15;
                }

                \Log::debug("Trade receiving player value", [
                    'player' => $player['firstName'] . ' ' . $player['lastName'],
                    'age' => $age,
                    'rating' => $rating,
                    'salary' => $salary,
                    'expected_salary' => $expectedSalary,
                    'years_remaining' => $yearsRemaining,
                    'final_value' => $baseValue,
                ]);

                $value += $baseValue;

            } elseif ($asset['type'] === 'pick') {
                $pick = DraftPick::find($asset['pickId']);
                if (!$pick) continue;

                $projectedPos = $this->draftPickService->projectPickPosition($campaign, $pick->original_team_id);
                $pickValue = $this->draftPickService->calculatePickValue($pick, $campaign, $projectedPos);

                // Direction adjustment
                if ($direction === 'rebuilding') {
                    $pickValue *= 1.4;  // Rebuilding teams love picks
                } elseif ($direction === 'contending') {
                    $pickValue *= 0.7;  // Contenders discount picks
                }

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

                // Direction-specific adjustments
                if ($direction === 'contending') {
                    if ($rating >= 80) $baseValue *= 1.3;  // Don't want to lose stars
                } elseif ($direction === 'rebuilding') {
                    if ($age >= 30) $baseValue *= 0.8;    // Fine to trade vets
                }

                \Log::debug("Trade giving player value", [
                    'player' => $player['firstName'] . ' ' . $player['lastName'],
                    'age' => $age,
                    'rating' => $rating,
                    'salary' => $salary,
                    'expected_salary' => $expectedSalary,
                    'final_value' => $baseValue,
                ]);

                $value += $baseValue;

            } elseif ($asset['type'] === 'pick') {
                $pick = DraftPick::find($asset['pickId']);
                if (!$pick) continue;

                $projectedPos = $this->draftPickService->projectPickPosition($campaign, $pick->original_team_id);
                $pickValue = $this->draftPickService->calculatePickValue($pick, $campaign, $projectedPos);

                // Direction adjustment
                if ($direction === 'rebuilding') {
                    $pickValue *= 1.5;  // Don't want to give up picks
                } elseif ($direction === 'contending') {
                    $pickValue *= 0.8;  // Picks less valuable
                }

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

        $playerService = app(CampaignPlayerService::class);
        $roster = $playerService->getTeamRoster($campaign->id, $team->abbreviation);

        // Count players at this position
        $count = 0;
        foreach ($roster as $player) {
            $primary = $player['position'] ?? '';
            $secondary = $player['secondaryPosition'] ?? '';
            if ($primary === $position || $secondary === $position) {
                $count++;
            }
        }

        // Need if only 1 or fewer players at position
        return $count <= 1;
    }

    /**
     * Get rejection reason based on trade analysis.
     */
    private function getRejectReason(float $netValue, string $direction, array $proposal): string
    {
        $deficit = abs($netValue);

        if ($direction === 'rebuilding') {
            if (!$this->hasPicksInAssets($proposal['aiReceives'])) {
                return "We're looking to acquire draft picks in any deal.";
            }
            if ($this->hasVeterans($proposal['aiReceives'])) {
                return "We're focused on building for the future with young talent.";
            }
            return "We'd need more young talent or draft compensation to make this work.";
        }

        if ($direction === 'contending') {
            if (!$this->hasStars($proposal['aiReceives'])) {
                return "We need proven players who can help us win now.";
            }
            return "The value isn't there for a win-now team like us.";
        }

        // Middling
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
    private function hasVeterans(array $assets): bool
    {
        foreach ($assets as $asset) {
            if ($asset['type'] === 'player') {
                // Would need to look up player age
                // For now, simplified check
                return false;
            }
        }
        return false;
    }

    /**
     * Check if assets include star players (rating >= 80).
     */
    private function hasStars(array $assets): bool
    {
        foreach ($assets as $asset) {
            if ($asset['type'] === 'player') {
                // Would need to look up player rating
                // For now, simplified check
                return false;
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

        // Rebuilding teams are more willing to trade
        if ($direction === 'rebuilding') {
            return 'high';
        }

        // Middling teams might be buyers or sellers
        if ($direction === 'middling') {
            return 'medium';
        }

        // Contending teams are selective
        return 'low';
    }
}
