<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\Player;
use App\Models\Season;
use App\Models\Transaction;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class FinanceService
{
    private const DEFAULT_FREE_AGENT_SALARY = 8000000; // $8M
    private const DEFAULT_FREE_AGENT_YEARS = 2;

    public function __construct(
        private CampaignPlayerService $playerService,
        private CampaignSeasonService $seasonService
    ) {}

    /**
     * Get the team's financial summary.
     */
    public function getFinanceSummary(Campaign $campaign): array
    {
        $team = $campaign->team;
        $roster = $this->getRosterContracts($campaign);

        $totalPayroll = $roster->sum('contractSalary');
        $salaryCap = $team->salary_cap ?? 136000000; // Default NBA cap

        return [
            'salary_cap' => $salaryCap,
            'total_payroll' => $totalPayroll,
            'cap_space' => $salaryCap - $totalPayroll,
            'roster_count' => $roster->count(),
            'current_season' => $this->getCurrentSeasonYear($campaign),
        ];
    }

    /**
     * Get roster with contracts and season stats.
     */
    public function getRosterContracts(Campaign $campaign): Collection
    {
        $team = $campaign->team;
        $players = Player::where('campaign_id', $campaign->id)
            ->where('team_id', $team->id)
            ->get();

        // Get current season stats
        $seasonStats = $this->getSeasonStats($campaign);

        return $players->map(function ($player) use ($seasonStats) {
            $stats = $seasonStats[$player->id] ?? null;
            $attributes = $player->attributes ?? [];

            // Calculate composite attribute scores
            $shooting = $this->calculateShootingScore($attributes);
            $playmaking = $this->calculatePlaymakingScore($attributes);
            $defense = $this->calculateDefenseScore($attributes);
            $athleticism = $this->calculateAthleticismScore($attributes);
            $rebounding = $this->calculateReboundingScore($attributes);
            $basketballIQ = $attributes['mental']['basketballIQ'] ?? null;

            return [
                'id' => $player->id,
                'firstName' => $player->first_name,
                'lastName' => $player->last_name,
                'position' => $player->position,
                'secondaryPosition' => $player->secondary_position,
                'jerseyNumber' => $player->jersey_number,
                'overallRating' => $player->overall_rating,
                'potentialRating' => $player->potential_rating,
                'age' => $player->age,
                'height' => $player->height_formatted,
                'weight' => $player->weight_lbs,
                'contractSalary' => (float) $player->contract_salary,
                'contractYearsRemaining' => (int) $player->contract_years_remaining,
                'attributes' => $attributes,
                'badges' => $player->getAllBadges(),
                'shooting' => $shooting,
                'playmaking' => $playmaking,
                'defense' => $defense,
                'athleticism' => $athleticism,
                'rebounding' => $rebounding,
                'basketballIQ' => $basketballIQ,
                'stats' => $stats ? [
                    'ppg' => round($stats['ppg'] ?? 0, 1),
                    'rpg' => round($stats['rpg'] ?? 0, 1),
                    'apg' => round($stats['apg'] ?? 0, 1),
                    'fgPct' => round($stats['fg_pct'] ?? 0, 0),
                    'gamesPlayed' => $stats['games_played'] ?? 0,
                ] : null,
            ];
        });
    }

    /**
     * Get free agents with their attributes.
     */
    public function getFreeAgents(Campaign $campaign): Collection
    {
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);

        // Filter to free agents only (no team assignment)
        $freeAgents = collect($leaguePlayers)->filter(function ($player) {
            $teamAbbr = $player['teamAbbreviation'] ?? $player['team_abbreviation'] ?? null;
            return empty($teamAbbr) || $teamAbbr === 'FA';
        });

        return $freeAgents->map(function ($player) {
            $attributes = $player['attributes'] ?? [];

            // Calculate composite attribute scores from nested structure
            $shooting = $this->calculateShootingScore($attributes);
            $playmaking = $this->calculatePlaymakingScore($attributes);
            $defense = $this->calculateDefenseScore($attributes);
            $athleticism = $this->calculateAthleticismScore($attributes);
            $rebounding = $this->calculateReboundingScore($attributes);
            $basketballIQ = $attributes['mental']['basketballIQ'] ?? null;

            return [
                'id' => $player['id'],
                'firstName' => $player['firstName'] ?? $player['first_name'],
                'lastName' => $player['lastName'] ?? $player['last_name'],
                'position' => $player['position'],
                'secondaryPosition' => $player['secondaryPosition'] ?? $player['secondary_position'] ?? null,
                'jerseyNumber' => $player['jerseyNumber'] ?? $player['jersey_number'] ?? null,
                'overallRating' => $player['overallRating'] ?? $player['overall_rating'],
                'potentialRating' => $player['potentialRating'] ?? $player['potential_rating'],
                'age' => $player['age'] ?? $this->calculateAgeFromBirthDate($player['birthDate'] ?? null),
                'height' => $player['heightFormatted'] ?? $this->formatHeight($player['heightInches'] ?? null),
                'weight' => $player['weightLbs'] ?? $player['weight_lbs'] ?? null,
                'contractSalary' => 0,
                'contractYearsRemaining' => 0,
                'attributes' => $attributes,
                'badges' => $player['badges'] ?? [],
                'shooting' => $shooting,
                'playmaking' => $playmaking,
                'defense' => $defense,
                'athleticism' => $athleticism,
                'rebounding' => $rebounding,
                'basketballIQ' => $basketballIQ,
            ];
        })->values();
    }

    /**
     * Calculate composite shooting score.
     */
    private function calculateShootingScore(array $attributes): ?int
    {
        $offense = $attributes['offense'] ?? [];
        $values = array_filter([
            $offense['threePoint'] ?? null,
            $offense['midRange'] ?? null,
            $offense['closeShot'] ?? null,
            $offense['freeThrow'] ?? null,
        ], fn($v) => $v !== null);

        return count($values) > 0 ? (int) round(array_sum($values) / count($values)) : null;
    }

    /**
     * Calculate composite playmaking score.
     */
    private function calculatePlaymakingScore(array $attributes): ?int
    {
        $offense = $attributes['offense'] ?? [];
        $values = array_filter([
            $offense['passAccuracy'] ?? null,
            $offense['passVision'] ?? null,
            $offense['ballHandling'] ?? null,
            $offense['passIQ'] ?? null,
        ], fn($v) => $v !== null);

        return count($values) > 0 ? (int) round(array_sum($values) / count($values)) : null;
    }

    /**
     * Calculate composite defense score.
     */
    private function calculateDefenseScore(array $attributes): ?int
    {
        $defense = $attributes['defense'] ?? [];
        $values = array_filter([
            $defense['perimeterDefense'] ?? null,
            $defense['interiorDefense'] ?? null,
            $defense['helpDefenseIQ'] ?? null,
            $defense['defensiveConsistency'] ?? null,
        ], fn($v) => $v !== null);

        return count($values) > 0 ? (int) round(array_sum($values) / count($values)) : null;
    }

    /**
     * Calculate composite athleticism score.
     */
    private function calculateAthleticismScore(array $attributes): ?int
    {
        $physical = $attributes['physical'] ?? [];
        $values = array_filter([
            $physical['speed'] ?? null,
            $physical['acceleration'] ?? null,
            $physical['vertical'] ?? null,
            $physical['strength'] ?? null,
        ], fn($v) => $v !== null);

        return count($values) > 0 ? (int) round(array_sum($values) / count($values)) : null;
    }

    /**
     * Calculate composite rebounding score.
     */
    private function calculateReboundingScore(array $attributes): ?int
    {
        $defense = $attributes['defense'] ?? [];
        $values = array_filter([
            $defense['offensiveRebound'] ?? null,
            $defense['defensiveRebound'] ?? null,
        ], fn($v) => $v !== null);

        return count($values) > 0 ? (int) round(array_sum($values) / count($values)) : null;
    }

    /**
     * Format height in inches to readable string.
     */
    private function formatHeight(?int $heightInches): ?string
    {
        if (!$heightInches) {
            return null;
        }
        $feet = floor($heightInches / 12);
        $inches = $heightInches % 12;
        return "{$feet}'{$inches}\"";
    }

    /**
     * Calculate age from birth date string.
     */
    private function calculateAgeFromBirthDate(?string $birthDate): int
    {
        if (!$birthDate) {
            return 25; // Default age
        }

        try {
            $birth = \Carbon\Carbon::parse($birthDate);
            $age = $birth->age;
            // Sanity check - if age is negative or unreasonable, return default
            if ($age < 0 || $age > 50) {
                return 25;
            }
            return $age;
        } catch (\Exception $e) {
            return 25;
        }
    }

    /**
     * Validate a new signing against salary cap.
     */
    public function validateSigning(float $salary, Campaign $campaign): array
    {
        $capMode = $campaign->settings['salary_cap_mode'] ?? 'normal';

        // Easy mode - no restrictions
        if ($capMode === 'easy') {
            return ['valid' => true];
        }

        $team = $campaign->team;
        $currentPayroll = Player::where('campaign_id', $campaign->id)
            ->where('team_id', $team->id)
            ->sum('contract_salary');

        $salaryCap = $team->salary_cap ?? 136000000;

        // Hard cap mode
        if ($capMode === 'hard') {
            if ($currentPayroll + $salary > $salaryCap) {
                return [
                    'valid' => false,
                    'reason' => 'Signing would exceed salary cap',
                    'current_payroll' => $currentPayroll,
                    'signing_salary' => $salary,
                    'salary_cap' => $salaryCap,
                ];
            }
        }

        // Normal mode - soft cap but check for excessive spending
        // For now, allow signings even over cap (like NBA bird rights)
        return [
            'valid' => true,
            'current_payroll' => $currentPayroll,
            'signing_salary' => $salary,
            'salary_cap' => $salaryCap,
        ];
    }

    /**
     * Re-sign a player to a new contract (same salary rate for Phase 1).
     */
    public function resignPlayer(Campaign $campaign, Player $player, int $years): array
    {
        // Phase 1: Keep same annual salary, just extend years
        $salary = $player->contract_salary;

        return DB::transaction(function () use ($campaign, $player, $years, $salary) {
            // Update player contract
            $player->update([
                'contract_years_remaining' => $years,
                // Salary stays the same in Phase 1
            ]);

            // Record transaction
            $this->recordTransaction($campaign, 'extension', [
                'playerId' => $player->id,
                'playerName' => $player->first_name . ' ' . $player->last_name,
                'teamId' => $player->team_id,
                'years' => $years,
                'salary' => $salary,
                'totalValue' => $salary * $years,
            ]);

            return [
                'success' => true,
                'player' => $player->fresh(),
                'message' => "Re-signed {$player->first_name} {$player->last_name} to a {$years}-year deal",
            ];
        });
    }

    /**
     * Sign a free agent to the user's team.
     */
    public function signFreeAgent(Campaign $campaign, string $playerId): array
    {
        $team = $campaign->team;

        // Validate roster size
        $rosterCount = Player::where('campaign_id', $campaign->id)
            ->where('team_id', $team->id)
            ->count();

        if ($rosterCount >= 15) {
            return [
                'success' => false,
                'error' => 'Roster is full (15 players maximum)',
            ];
        }

        // Validate salary cap
        $validation = $this->validateSigning(self::DEFAULT_FREE_AGENT_SALARY, $campaign);
        if (!$validation['valid']) {
            return [
                'success' => false,
                'error' => $validation['reason'],
            ];
        }

        // Get the free agent from JSON
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        $freeAgent = null;
        $freeAgentIndex = null;

        foreach ($leaguePlayers as $index => $player) {
            if (($player['id'] ?? '') == $playerId) {
                $teamAbbr = $player['teamAbbreviation'] ?? $player['team_abbreviation'] ?? null;
                if (empty($teamAbbr) || $teamAbbr === 'FA') {
                    $freeAgent = $player;
                    $freeAgentIndex = $index;
                    break;
                }
            }
        }

        if (!$freeAgent) {
            return [
                'success' => false,
                'error' => 'Player not found or not a free agent',
            ];
        }

        return DB::transaction(function () use ($campaign, $team, $freeAgent, $freeAgentIndex, $leaguePlayers) {
            // Create player in database
            $attributes = $freeAgent['attributes'] ?? [];
            $newPlayer = Player::create([
                'campaign_id' => $campaign->id,
                'team_id' => $team->id,
                'first_name' => $freeAgent['firstName'] ?? $freeAgent['first_name'],
                'last_name' => $freeAgent['lastName'] ?? $freeAgent['last_name'],
                'position' => $freeAgent['position'],
                'secondary_position' => $freeAgent['secondaryPosition'] ?? $freeAgent['secondary_position'] ?? null,
                'jersey_number' => $freeAgent['jerseyNumber'] ?? $freeAgent['jersey_number'] ?? rand(0, 99),
                'height_inches' => $freeAgent['heightInches'] ?? $freeAgent['height_inches'] ?? 78,
                'weight_lbs' => $freeAgent['weightLbs'] ?? $freeAgent['weight_lbs'] ?? 220,
                'birth_date' => $freeAgent['birthDate'] ?? $freeAgent['birth_date'] ?? null,
                'country' => $freeAgent['country'] ?? 'USA',
                'overall_rating' => $freeAgent['overallRating'] ?? $freeAgent['overall_rating'],
                'potential_rating' => $freeAgent['potentialRating'] ?? $freeAgent['potential_rating'] ?? $freeAgent['overallRating'] ?? $freeAgent['overall_rating'],
                'attributes' => $attributes,
                'tendencies' => $freeAgent['tendencies'] ?? [],
                'badges' => $freeAgent['badges'] ?? [],
                'contract_years_remaining' => self::DEFAULT_FREE_AGENT_YEARS,
                'contract_salary' => self::DEFAULT_FREE_AGENT_SALARY,
            ]);

            // Remove from JSON free agents list
            unset($leaguePlayers[$freeAgentIndex]);
            $this->playerService->saveLeaguePlayers($campaign->id, array_values($leaguePlayers));

            // Record transaction
            $this->recordTransaction($campaign, 'signing', [
                'playerId' => $newPlayer->id,
                'playerName' => $newPlayer->first_name . ' ' . $newPlayer->last_name,
                'teamId' => $team->id,
                'teamName' => $team->city . ' ' . $team->name,
                'years' => self::DEFAULT_FREE_AGENT_YEARS,
                'salary' => self::DEFAULT_FREE_AGENT_SALARY,
                'totalValue' => self::DEFAULT_FREE_AGENT_SALARY * self::DEFAULT_FREE_AGENT_YEARS,
            ]);

            // Format for response
            $playerData = [
                'id' => $newPlayer->id,
                'firstName' => $newPlayer->first_name,
                'lastName' => $newPlayer->last_name,
                'position' => $newPlayer->position,
                'secondaryPosition' => $newPlayer->secondary_position,
                'overallRating' => $newPlayer->overall_rating,
                'potentialRating' => $newPlayer->potential_rating,
                'age' => $newPlayer->age,
                'contractSalary' => (float) $newPlayer->contract_salary,
                'contractYearsRemaining' => (int) $newPlayer->contract_years_remaining,
            ];

            return [
                'success' => true,
                'player' => $playerData,
                'message' => "Signed {$newPlayer->first_name} {$newPlayer->last_name}",
            ];
        });
    }

    /**
     * Drop a player from the roster (release to free agency).
     */
    public function dropPlayer(Campaign $campaign, Player $player): array
    {
        return DB::transaction(function () use ($campaign, $player) {
            // Store player info for transaction record
            $playerName = $player->first_name . ' ' . $player->last_name;
            $salary = $player->contract_salary;
            $yearsRemaining = $player->contract_years_remaining;

            // Convert player to free agent in JSON
            $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);

            // Create free agent entry
            $freeAgentData = [
                'id' => 'fa_' . $player->id . '_' . time(),
                'firstName' => $player->first_name,
                'lastName' => $player->last_name,
                'position' => $player->position,
                'secondaryPosition' => $player->secondary_position,
                'jerseyNumber' => $player->jersey_number,
                'heightInches' => $player->height_inches,
                'weightLbs' => $player->weight_lbs,
                'birthDate' => $player->birth_date?->toDateString(),
                'country' => $player->country,
                'overallRating' => $player->overall_rating,
                'potentialRating' => $player->potential_rating,
                'attributes' => $player->attributes ?? [],
                'tendencies' => $player->tendencies ?? [],
                'badges' => $player->getAllBadges(),
                'teamAbbreviation' => 'FA',
            ];

            $leaguePlayers[] = $freeAgentData;
            $this->playerService->saveLeaguePlayers($campaign->id, $leaguePlayers);

            // Delete player from database
            $player->delete();

            // Record transaction
            $this->recordTransaction($campaign, 'release', [
                'playerId' => $player->id,
                'playerName' => $playerName,
                'teamId' => $campaign->team_id,
                'teamName' => $campaign->team->city . ' ' . $campaign->team->name,
                'salary' => $salary,
                'yearsRemaining' => $yearsRemaining,
            ]);

            return [
                'success' => true,
                'message' => "Released {$playerName}",
            ];
        });
    }

    /**
     * Get transaction history for a campaign.
     */
    public function getTransactions(Campaign $campaign, int $limit = 50): Collection
    {
        return Transaction::where('campaign_id', $campaign->id)
            ->orderBy('transaction_date', 'desc')
            ->orderBy('id', 'desc')
            ->limit($limit)
            ->get()
            ->map(function ($transaction) {
                return [
                    'id' => $transaction->id,
                    'type' => $transaction->transaction_type,
                    'date' => $transaction->transaction_date->format('Y-m-d'),
                    'details' => $transaction->details,
                ];
            });
    }

    /**
     * Record a transaction to history.
     */
    public function recordTransaction(Campaign $campaign, string $type, array $details): Transaction
    {
        $season = $campaign->currentSeason;

        return Transaction::create([
            'campaign_id' => $campaign->id,
            'season_id' => $season?->id,
            'transaction_type' => $type,
            'transaction_date' => now()->toDateString(),
            'details' => $details,
        ]);
    }

    /**
     * Get current season year.
     */
    private function getCurrentSeasonYear(Campaign $campaign): int
    {
        $season = $campaign->currentSeason;
        return $season?->year ?? (int) date('Y');
    }

    /**
     * Get season stats for all players on user's team.
     */
    private function getSeasonStats(Campaign $campaign): array
    {
        // Get current season year
        $season = $campaign->currentSeason;
        if (!$season) {
            return [];
        }

        // Load season data from JSON
        $seasonData = $this->seasonService->loadSeason($campaign->id, $season->year);

        if (empty($seasonData['playerStats'])) {
            return [];
        }

        $stats = [];
        foreach ($seasonData['playerStats'] as $playerId => $playerStats) {
            $gamesPlayed = $playerStats['gamesPlayed'] ?? 0;
            if ($gamesPlayed > 0) {
                $stats[$playerId] = [
                    'games_played' => $gamesPlayed,
                    'ppg' => ($playerStats['points'] ?? 0) / $gamesPlayed,
                    'rpg' => ($playerStats['rebounds'] ?? 0) / $gamesPlayed,
                    'apg' => ($playerStats['assists'] ?? 0) / $gamesPlayed,
                    'fg_pct' => ($playerStats['fga'] ?? 0) > 0
                        ? (($playerStats['fgm'] ?? 0) / $playerStats['fga']) * 100
                        : 0,
                ];
            }
        }

        return $stats;
    }
}
