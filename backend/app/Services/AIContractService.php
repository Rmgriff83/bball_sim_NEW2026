<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\Player;
use App\Models\Team;
use Illuminate\Support\Facades\Log;

class AIContractService
{
    public function __construct(
        private CampaignPlayerService $playerService,
        private CampaignSeasonService $seasonService,
        private FinanceService $financeService,
        private AITradeEvaluationService $tradeEvalService
    ) {}

    /**
     * Process all AI teams' contract decisions for a campaign.
     * Called during offseason processing.
     */
    public function runAIContractDecisions(Campaign $campaign): array
    {
        $results = [
            'extensions' => [],
            'signings' => [],
            'releases' => [],
        ];

        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        $aiTeams = Team::where('campaign_id', $campaign->id)
            ->where('id', '!=', $campaign->team_id)
            ->get();

        $context = $this->buildContext($campaign);

        foreach ($aiTeams as $team) {
            $teamDirection = $this->tradeEvalService->analyzeTeamDirection($team, $context);
            $teamRoster = $this->getTeamRoster($leaguePlayers, $team->abbreviation);

            // Process re-signings first
            $extensionResults = $this->processTeamExtensions($campaign, $team, $teamRoster, $teamDirection, $leaguePlayers);
            $results['extensions'] = array_merge($results['extensions'], $extensionResults['extensions']);
            $leaguePlayers = $extensionResults['updatedPlayers'];

            // Process free agent signings if roster has room
            $rosterCount = count($this->getTeamRoster($leaguePlayers, $team->abbreviation));
            if ($rosterCount < 12) {
                $signingResults = $this->processTeamSignings($campaign, $team, $teamDirection, $leaguePlayers, $rosterCount);
                $results['signings'] = array_merge($results['signings'], $signingResults['signings']);
                $leaguePlayers = $signingResults['updatedPlayers'];
            }
        }

        // Save updated league players
        $this->playerService->saveLeaguePlayers($campaign->id, $leaguePlayers);

        Log::info("AI Contract Decisions completed", [
            'campaign_id' => $campaign->id,
            'extensions' => count($results['extensions']),
            'signings' => count($results['signings']),
        ]);

        return $results;
    }

    /**
     * Process contract extensions for a single AI team.
     */
    private function processTeamExtensions(
        Campaign $campaign,
        Team $team,
        array $roster,
        string $direction,
        array $leaguePlayers
    ): array {
        $extensions = [];
        $updatedPlayers = $leaguePlayers;

        $expiringPlayers = array_filter($roster, function ($player) {
            $years = $player['contractYearsRemaining'] ?? $player['contract_years_remaining'] ?? 0;
            return $years === 1;
        });

        foreach ($expiringPlayers as $player) {
            $playerStats = $this->getPlayerSeasonStats($player['id'], $campaign);
            $shouldResign = $this->evaluateResigning($player, $team, $direction, $playerStats);

            if ($shouldResign) {
                $contract = $this->calculateContractOffer($player, $direction);

                // Update player in league players array
                foreach ($updatedPlayers as &$p) {
                    if (($p['id'] ?? '') == $player['id']) {
                        $p['contractYearsRemaining'] = $contract['years'];
                        $p['contractSalary'] = $contract['salary'];
                        break;
                    }
                }

                // Record transaction
                $this->financeService->recordTransaction($campaign, 'extension', [
                    'playerId' => $player['id'],
                    'playerName' => ($player['firstName'] ?? $player['first_name']) . ' ' .
                                   ($player['lastName'] ?? $player['last_name']),
                    'teamId' => $team->id,
                    'teamAbbreviation' => $team->abbreviation,
                    'years' => $contract['years'],
                    'salary' => $contract['salary'],
                    'totalValue' => $contract['salary'] * $contract['years'],
                ]);

                $extensions[] = [
                    'team' => $team->abbreviation,
                    'player' => ($player['firstName'] ?? $player['first_name']) . ' ' .
                               ($player['lastName'] ?? $player['last_name']),
                    'years' => $contract['years'],
                    'salary' => $contract['salary'],
                ];
            }
        }

        return [
            'extensions' => $extensions,
            'updatedPlayers' => $updatedPlayers,
        ];
    }

    /**
     * Process free agent signings for a single AI team.
     */
    private function processTeamSignings(
        Campaign $campaign,
        Team $team,
        string $direction,
        array $leaguePlayers,
        int $currentRosterCount
    ): array {
        $signings = [];
        $updatedPlayers = $leaguePlayers;
        $maxSignings = min(3, 12 - $currentRosterCount);

        // Get free agents
        $freeAgents = array_filter($leaguePlayers, function ($player) {
            $teamAbbr = $player['teamAbbreviation'] ?? $player['team_abbreviation'] ?? null;
            return empty($teamAbbr) || $teamAbbr === 'FA';
        });

        // Sort by overall rating
        usort($freeAgents, function ($a, $b) {
            $ratingA = $a['overallRating'] ?? $a['overall_rating'] ?? 0;
            $ratingB = $b['overallRating'] ?? $b['overall_rating'] ?? 0;
            return $ratingB - $ratingA;
        });

        $signedCount = 0;
        foreach ($freeAgents as $player) {
            if ($signedCount >= $maxSignings) break;

            $shouldSign = $this->evaluateFreeAgentSigning($player, $team, $direction, $updatedPlayers);

            if ($shouldSign) {
                $contract = $this->calculateContractOffer($player, $direction);

                // Update player in league players array
                foreach ($updatedPlayers as &$p) {
                    if (($p['id'] ?? '') == $player['id']) {
                        $p['teamAbbreviation'] = $team->abbreviation;
                        $p['contractYearsRemaining'] = $contract['years'];
                        $p['contractSalary'] = $contract['salary'];
                        break;
                    }
                }

                // Record transaction
                $this->financeService->recordTransaction($campaign, 'signing', [
                    'playerId' => $player['id'],
                    'playerName' => ($player['firstName'] ?? $player['first_name']) . ' ' .
                                   ($player['lastName'] ?? $player['last_name']),
                    'teamId' => $team->id,
                    'teamAbbreviation' => $team->abbreviation,
                    'years' => $contract['years'],
                    'salary' => $contract['salary'],
                    'totalValue' => $contract['salary'] * $contract['years'],
                ]);

                $signings[] = [
                    'team' => $team->abbreviation,
                    'player' => ($player['firstName'] ?? $player['first_name']) . ' ' .
                               ($player['lastName'] ?? $player['last_name']),
                    'years' => $contract['years'],
                    'salary' => $contract['salary'],
                ];

                $signedCount++;
            }
        }

        return [
            'signings' => $signings,
            'updatedPlayers' => $updatedPlayers,
        ];
    }

    /**
     * Evaluate whether AI should re-sign a player.
     */
    public function evaluateResigning(array $player, Team $team, string $direction, ?array $stats): bool
    {
        $rating = $player['overallRating'] ?? $player['overall_rating'] ?? 70;
        $age = $this->getPlayerAge($player);
        $salary = $player['contractSalary'] ?? $player['contract_salary'] ?? 0;

        // Calculate expected salary based on rating
        $expectedSalary = $this->calculateExpectedSalary($rating);

        // Factor 1: Is player performing well?
        $isPerformingWell = $rating >= 70;
        if ($stats && ($stats['gamesPlayed'] ?? 0) >= 5) {
            $ppg = ($stats['points'] ?? 0) / $stats['gamesPlayed'];
            // Adjust expectation based on stats
            $isPerformingWell = $isPerformingWell && ($ppg >= 5 || $rating >= 75);
        }

        // Factor 2: Is player massively overpaid?
        $isMassivelyOverpaid = $salary > ($expectedSalary * 1.5);

        // Factor 3: Does player match team direction?
        $matchesDirection = $this->playerMatchesDirection($age, $rating, $direction);

        // Factor 4: Minimum roster needs
        $rosterCount = Player::where('team_id', $team->id)->count();
        $needsPlayers = $rosterCount < 12;

        // Decision logic
        if ($isMassivelyOverpaid && !$needsPlayers) {
            return false; // Let overpaid players walk unless desperate
        }

        if (!$matchesDirection && $rating < 78) {
            return false; // Don't resign mismatched role players
        }

        return $isPerformingWell || $needsPlayers;
    }

    /**
     * Evaluate whether AI should sign a free agent.
     */
    public function evaluateFreeAgentSigning(array $player, Team $team, string $direction, array $allPlayers): bool
    {
        $rating = $player['overallRating'] ?? $player['overall_rating'] ?? 70;
        $age = $this->getPlayerAge($player);
        $position = $player['position'] ?? 'SF';

        // Check roster need at this position
        $teamRoster = $this->getTeamRoster($allPlayers, $team->abbreviation);
        $hasPositionNeed = $this->hasPositionNeed($teamRoster, $position);

        // Check if player fits team direction
        $matchesDirection = $this->playerMatchesDirection($age, $rating, $direction);

        // Check minimum rating threshold
        $meetsRatingThreshold = $rating >= 65;

        // Rebuilding teams want young players with upside
        if ($direction === 'rebuilding') {
            return $age <= 26 && $rating >= 68 && ($hasPositionNeed || count($teamRoster) < 10);
        }

        // Contending teams want proven players
        if ($direction === 'contending') {
            return $rating >= 72 && $hasPositionNeed;
        }

        // Middling teams fill gaps
        return $meetsRatingThreshold && $hasPositionNeed;
    }

    /**
     * Calculate contract offer for a player.
     */
    public function calculateContractOffer(array $player, string $direction): array
    {
        $rating = $player['overallRating'] ?? $player['overall_rating'] ?? 70;
        $age = $this->getPlayerAge($player);

        // Base salary from rating
        $baseSalary = $this->calculateExpectedSalary($rating);

        // Adjust for age
        if ($age <= 25) {
            $baseSalary *= 1.1; // Youth premium
        } elseif ($age >= 32) {
            $baseSalary *= 0.85; // Age discount
        }

        // Determine years based on age and direction
        $years = match (true) {
            $age >= 34 => 1,
            $age >= 30 => $direction === 'rebuilding' ? 1 : 2,
            $age >= 27 => $direction === 'rebuilding' ? 2 : 3,
            default => $direction === 'contending' ? 3 : 4,
        };

        // Cap years at 4 for AI teams
        $years = min($years, 4);

        return [
            'years' => $years,
            'salary' => (int) $baseSalary,
        ];
    }

    /**
     * Build context for team direction analysis.
     */
    private function buildContext(Campaign $campaign): array
    {
        $season = $campaign->currentSeason;
        $standings = $season?->standings ?? ['east' => [], 'west' => []];

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
     * Flatten standings array for easy lookup.
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
     * Get team roster from league players array.
     */
    private function getTeamRoster(array $leaguePlayers, string $teamAbbr): array
    {
        return array_filter($leaguePlayers, function ($player) use ($teamAbbr) {
            return ($player['teamAbbreviation'] ?? $player['team_abbreviation'] ?? '') === $teamAbbr;
        });
    }

    /**
     * Check if team has position need.
     */
    private function hasPositionNeed(array $roster, string $position): bool
    {
        $positionCounts = ['PG' => 0, 'SG' => 0, 'SF' => 0, 'PF' => 0, 'C' => 0];

        foreach ($roster as $player) {
            $pos = $player['position'] ?? 'SF';
            if (isset($positionCounts[$pos])) {
                $positionCounts[$pos]++;
            }
        }

        // Need at least 2 players at each position
        return ($positionCounts[$position] ?? 0) < 2;
    }

    /**
     * Check if player matches team direction.
     */
    private function playerMatchesDirection(int $age, int $rating, string $direction): bool
    {
        return match ($direction) {
            'rebuilding' => $age <= 28 || $rating >= 80, // Want young or stars
            'contending' => $rating >= 72, // Want proven players
            default => true, // Middling takes anyone
        };
    }

    /**
     * Get player age.
     */
    private function getPlayerAge(array $player): int
    {
        $birthDate = $player['birthDate'] ?? $player['birth_date'] ?? null;
        if ($birthDate) {
            return now()->diffInYears($birthDate);
        }
        return $player['age'] ?? 25;
    }

    /**
     * Get player season stats.
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
     * Calculate expected salary based on rating.
     */
    private function calculateExpectedSalary(int $rating): float
    {
        return match (true) {
            $rating >= 90 => 40_000_000,
            $rating >= 85 => 30_000_000,
            $rating >= 80 => 20_000_000,
            $rating >= 75 => 10_000_000,
            $rating >= 70 => 5_000_000,
            $rating >= 65 => 3_000_000,
            default => 2_000_000,
        };
    }
}
