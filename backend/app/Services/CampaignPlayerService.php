<?php

namespace App\Services;

use App\Models\BadgeDefinition;
use App\Models\Campaign;
use App\Models\Player;
use App\Models\PlayerBadge;
use App\Models\Team;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class CampaignPlayerService
{
    private string $masterFilePath;
    private ?array $validBadgeIds = null;

    public function __construct()
    {
        $this->masterFilePath = resource_path('data/players_master.js');
    }

    /**
     * Initialize players for a new campaign.
     * User's team goes to database, all others go to JSON file.
     */
    public function initializeCampaignPlayers(Campaign $campaign, string $userTeamAbbreviation): array
    {
        $masterPlayers = $this->loadPlayersMaster();
        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('abbreviation');

        $userTeam = $teams->get($userTeamAbbreviation);
        if (!$userTeam) {
            throw new \Exception("Team not found: {$userTeamAbbreviation}");
        }

        $dbPlayerCount = 0;
        $jsonPlayerCount = 0;
        $leaguePlayers = [];

        foreach ($masterPlayers as $playerData) {
            $playerData = $this->randomizePlayerData($playerData);

            if ($playerData['teamAbbreviation'] === $userTeamAbbreviation) {
                // User's team → Create in database
                $this->createPlayerInDatabase($playerData, $campaign->id, $userTeam->id);
                $dbPlayerCount++;
            } else {
                // Other teams → Add to JSON file
                $leaguePlayers[] = $playerData;
                $jsonPlayerCount++;
            }
        }

        // Write league players to campaign JSON file
        $this->saveLeaguePlayers($campaign->id, $leaguePlayers);

        return [
            'database_players' => $dbPlayerCount,
            'json_players' => $jsonPlayerCount,
            'total_players' => $dbPlayerCount + $jsonPlayerCount,
        ];
    }

    /**
     * Load the master players file.
     */
    public function loadPlayersMaster(): array
    {
        if (!file_exists($this->masterFilePath)) {
            throw new \Exception("Players master file not found: {$this->masterFilePath}. Run 'php artisan players:build-master' first.");
        }

        $content = file_get_contents($this->masterFilePath);

        // Extract JSON from the JS file - match from opening [ to the ]; before "export default"
        if (preg_match('/export const playersMaster = (\[[\s\S]*\]);\s*\n\s*export default/m', $content, $matches)) {
            $json = $matches[1];
            $decoded = json_decode($json, true);

            if ($decoded !== null) {
                return $decoded;
            }
        }

        throw new \Exception("Could not parse players master file.");
    }

    /**
     * Get the file path for a campaign's league players JSON.
     */
    private function getLeaguePlayersPath(int $campaignId): string
    {
        return "campaigns/{$campaignId}/league_players.json";
    }

    /**
     * Load league players from campaign JSON file.
     */
    public function loadLeaguePlayers(int $campaignId): array
    {
        $path = $this->getLeaguePlayersPath($campaignId);

        if (!Storage::exists($path)) {
            return [];
        }

        $content = Storage::get($path);
        return json_decode($content, true) ?? [];
    }

    /**
     * Save league players to campaign JSON file.
     */
    public function saveLeaguePlayers(int $campaignId, array $players): void
    {
        $path = $this->getLeaguePlayersPath($campaignId);

        // Ensure directory exists
        $dir = dirname($path);
        if (!Storage::exists($dir)) {
            Storage::makeDirectory($dir);
        }

        Storage::put($path, json_encode($players, JSON_PRETTY_PRINT));
    }

    /**
     * Get a team's roster.
     * Returns from database if user's team, from JSON otherwise.
     */
    public function getTeamRoster(int $campaignId, string $teamAbbreviation, ?int $userTeamId = null): array
    {
        // Check if this is the user's team (has players in DB)
        $dbPlayers = Player::where('campaign_id', $campaignId)
            ->whereHas('team', fn($q) => $q->where('abbreviation', $teamAbbreviation))
            ->get();

        if ($dbPlayers->count() > 0) {
            // User's team - return from database
            return $dbPlayers->map(fn($p) => $this->playerModelToArray($p))->toArray();
        }

        // League team - return from JSON
        $leaguePlayers = $this->loadLeaguePlayers($campaignId);

        $filtered = array_values(array_filter($leaguePlayers, fn($p) =>
            ($p['teamAbbreviation'] ?? '') === $teamAbbreviation
        ));

        return $filtered;
    }

    /**
     * Update a player in the league JSON file.
     * WARNING: This loads/saves the entire file. For batch updates, use updateLeaguePlayersBatch.
     */
    public function updateLeaguePlayer(int $campaignId, string $playerId, array $changes): bool
    {
        $leaguePlayers = $this->loadLeaguePlayers($campaignId);

        $found = false;
        foreach ($leaguePlayers as &$player) {
            if (($player['id'] ?? '') === $playerId) {
                $player = array_merge($player, $changes);
                $found = true;
                break;
            }
        }

        if ($found) {
            $this->saveLeaguePlayers($campaignId, $leaguePlayers);
        }

        return $found;
    }

    /**
     * Batch update multiple players in the league JSON file.
     * Much more efficient than calling updateLeaguePlayer in a loop.
     * @param array $playerUpdates Array of [playerId => playerData]
     */
    public function updateLeaguePlayersBatch(int $campaignId, array $playerUpdates): int
    {
        if (empty($playerUpdates)) {
            return 0;
        }

        $leaguePlayers = $this->loadLeaguePlayers($campaignId);
        $updatedCount = 0;

        foreach ($leaguePlayers as &$player) {
            $playerId = $player['id'] ?? '';
            if (isset($playerUpdates[$playerId])) {
                $player = array_merge($player, $playerUpdates[$playerId]);
                $updatedCount++;
            }
        }

        if ($updatedCount > 0) {
            $this->saveLeaguePlayers($campaignId, $leaguePlayers);
        }

        return $updatedCount;
    }

    /**
     * Move a player from JSON to database (e.g., trade to user's team).
     */
    public function movePlayerToDatabase(int $campaignId, string $playerId, int $teamId): ?Player
    {
        $leaguePlayers = $this->loadLeaguePlayers($campaignId);

        $playerData = null;
        $playerIndex = null;

        foreach ($leaguePlayers as $index => $player) {
            if (($player['id'] ?? '') === $playerId) {
                $playerData = $player;
                $playerIndex = $index;
                break;
            }
        }

        if (!$playerData) {
            return null;
        }

        // Remove from JSON
        array_splice($leaguePlayers, $playerIndex, 1);
        $this->saveLeaguePlayers($campaignId, $leaguePlayers);

        // Create in database
        return $this->createPlayerInDatabase($playerData, $campaignId, $teamId);
    }

    /**
     * Move a player from database to JSON (e.g., trade away from user's team).
     */
    public function movePlayerToJson(int $campaignId, int $playerId, string $newTeamAbbreviation): bool
    {
        $player = Player::where('campaign_id', $campaignId)
            ->where('id', $playerId)
            ->first();

        if (!$player) {
            return false;
        }

        // Convert to array format (includes badges from bridge table)
        $playerData = $this->playerModelToArray($player);
        $playerData['teamAbbreviation'] = $newTeamAbbreviation;

        // Add to JSON
        $leaguePlayers = $this->loadLeaguePlayers($campaignId);
        $leaguePlayers[] = $playerData;
        $this->saveLeaguePlayers($campaignId, $leaguePlayers);

        // Remove from database (cascade deletes badges from bridge table)
        $player->delete();

        return true;
    }

    /**
     * Create a player record in the database from master data.
     * Uses bridge table for badges instead of JSON column.
     */
    private function createPlayerInDatabase(array $data, int $campaignId, int $teamId): Player
    {
        return DB::transaction(function () use ($data, $campaignId, $teamId) {
            // Create player without badges in JSON column
            $player = Player::create([
                'campaign_id' => $campaignId,
                'team_id' => $teamId,
                'first_name' => $data['firstName'],
                'last_name' => $data['lastName'],
                'position' => $data['position'],
                'secondary_position' => $data['secondaryPosition'],
                'jersey_number' => $data['jerseyNumber'],
                'height_inches' => $data['heightInches'],
                'weight_lbs' => $data['weightLbs'],
                'birth_date' => $data['birthDate'],
                'country' => $data['country'] ?? null,
                'college' => $data['college'] ?? null,
                'draft_year' => $data['draftYear'] ?? null,
                'draft_round' => $data['draftRound'] ?? null,
                'draft_pick' => $data['draftPick'] ?? null,
                'overall_rating' => $data['overallRating'],
                'potential_rating' => $data['potentialRating'],
                'attributes' => $data['attributes'],
                'tendencies' => $data['tendencies'],
                'badges' => null, // Using bridge table instead
                'personality' => $data['personality'],
                'contract_years_remaining' => rand(1, 4),
                'contract_salary' => $data['contractSalary'],
                'contract_details' => [
                    'totalYears' => rand(2, 5),
                    'salaries' => [$data['contractSalary']],
                    'options' => [],
                    'noTradeClause' => false,
                ],
                'trade_value' => $data['tradeValue'] ?? null,
                'trade_value_total' => $data['tradeValueTotal'] ?? null,
                'injury_risk' => $data['injuryRisk'] ?? 'M',
                'is_injured' => false,
                'fatigue' => 0,
            ]);

            // Create badges in bridge table
            $this->createPlayerBadges($player->id, $data['badges'] ?? []);

            return $player;
        });
    }

    /**
     * Create badge records in the bridge table for a player.
     */
    private function createPlayerBadges(int $playerId, array $badges): void
    {
        if (empty($badges)) {
            return;
        }

        // Get valid badge IDs from the database
        $validBadgeIds = $this->getValidBadgeIds();

        $badgeRecords = [];
        $now = now();

        foreach ($badges as $badge) {
            if (!isset($badge['id']) || !isset($badge['level'])) {
                continue;
            }

            // Skip badges that don't exist in the database
            if (!in_array($badge['id'], $validBadgeIds)) {
                continue;
            }

            $badgeRecords[] = [
                'player_id' => $playerId,
                'badge_definition_id' => $badge['id'],
                'level' => $badge['level'],
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        if (!empty($badgeRecords)) {
            PlayerBadge::insert($badgeRecords);
        }
    }

    /**
     * Get valid badge IDs from the database (cached).
     */
    private function getValidBadgeIds(): array
    {
        if ($this->validBadgeIds === null) {
            $this->validBadgeIds = BadgeDefinition::pluck('id')->toArray();
        }
        return $this->validBadgeIds;
    }

    /**
     * Convert a Player model to the array format used in JSON.
     */
    private function playerModelToArray(Player $player): array
    {
        // Get badges from bridge table or JSON column
        $badges = $player->getAllBadges();

        // Simplify badge format for JSON storage (just id and level)
        $badgesForJson = array_map(fn($b) => [
            'id' => $b['id'],
            'level' => $b['level'],
        ], $badges);

        return [
            'id' => $player->id,
            'firstName' => $player->first_name,
            'lastName' => $player->last_name,
            'position' => $player->position,
            'secondaryPosition' => $player->secondary_position,
            'teamAbbreviation' => $player->team?->abbreviation ?? 'FA',
            'jerseyNumber' => $player->jersey_number,
            'heightInches' => $player->height_inches,
            'weightLbs' => $player->weight_lbs,
            'birthDate' => $player->birth_date?->format('Y-m-d'),
            'country' => $player->country,
            'college' => $player->college,
            'draftYear' => $player->draft_year,
            'draftRound' => $player->draft_round,
            'draftPick' => $player->draft_pick,
            'overallRating' => $player->overall_rating,
            'potentialRating' => $player->potential_rating,
            'attributes' => $player->attributes,
            'badges' => $badgesForJson,
            'tendencies' => $player->tendencies,
            'personality' => $player->personality,
            'contractSalary' => (int) $player->contract_salary,
            'tradeValue' => $player->trade_value ? (float) $player->trade_value : null,
            'tradeValueTotal' => $player->trade_value_total ? (float) $player->trade_value_total : null,
            'injuryRisk' => $player->injury_risk ?? 'M',
            // Evolution tracking fields
            'fatigue' => $player->fatigue ?? 0,
            'is_injured' => $player->is_injured ?? false,
            'isInjured' => $player->is_injured ?? false,
            'injury_details' => $player->injury_details,
            'injuryDetails' => $player->injury_details,
            'games_played_this_season' => $player->games_played_this_season ?? 0,
            'gamesPlayedThisSeason' => $player->games_played_this_season ?? 0,
            'minutes_played_this_season' => $player->minutes_played_this_season ?? 0,
            'minutesPlayedThisSeason' => $player->minutes_played_this_season ?? 0,
            'development_history' => $player->development_history ?? [],
            'streak_data' => $player->streak_data,
            'streakData' => $player->streak_data,
            'recent_performances' => $player->recent_performances ?? [],
            'recentPerformances' => $player->recent_performances ?? [],
            'allStarSelections' => $player->all_star_selections ?? 0,
            'all_star_selections' => $player->all_star_selections ?? 0,
        ];
    }

    /**
     * Initialize all players as free agents for fantasy draft mode.
     * No players go to MySQL — all go to league_players.json with teamAbbreviation = 'FA'.
     */
    public function initializeFantasyDraftPlayers(Campaign $campaign): array
    {
        $masterPlayers = $this->loadPlayersMaster();
        $leaguePlayers = [];

        foreach ($masterPlayers as $playerData) {
            $playerData = $this->randomizePlayerData($playerData);
            $playerData['teamAbbreviation'] = 'FA';
            $leaguePlayers[] = $playerData;
        }

        $this->saveLeaguePlayers($campaign->id, $leaguePlayers);

        return [
            'database_players' => 0,
            'json_players' => count($leaguePlayers),
            'total_players' => count($leaguePlayers),
        ];
    }

    /**
     * Assign drafted players to their teams after fantasy draft completes.
     * Players assigned to user's team go to MySQL, all others stay in JSON.
     */
    public function assignDraftedPlayers(Campaign $campaign, string $userTeamAbbr, int $userTeamId, array $draftResults): array
    {
        $leaguePlayers = $this->loadLeaguePlayers($campaign->id);

        // Build a map of playerId → teamAbbreviation from draft results
        $assignments = [];
        foreach ($draftResults as $pick) {
            $assignments[$pick['playerId']] = $pick['teamAbbreviation'];
        }

        $userPlayers = [];
        $remainingPlayers = [];
        $dbCount = 0;
        $jsonCount = 0;

        foreach ($leaguePlayers as $player) {
            $playerId = $player['id'] ?? null;
            $assignedTeam = $assignments[$playerId] ?? null;

            if ($assignedTeam) {
                $player['teamAbbreviation'] = $assignedTeam;

                if ($assignedTeam === $userTeamAbbr) {
                    // User's team → create in database
                    $userPlayers[] = $player;
                } else {
                    // AI team → stays in JSON
                    $remainingPlayers[] = $player;
                    $jsonCount++;
                }
            } else {
                // Undrafted → stays as FA in JSON
                $remainingPlayers[] = $player;
                $jsonCount++;
            }
        }

        // Create user's players in database
        foreach ($userPlayers as $playerData) {
            $this->createPlayerInDatabase($playerData, $campaign->id, $userTeamId);
            $dbCount++;
        }

        // Save remaining players to JSON
        $this->saveLeaguePlayers($campaign->id, $remainingPlayers);

        return [
            'database_players' => $dbCount,
            'json_players' => $jsonCount,
            'total_players' => $dbCount + $jsonCount,
        ];
    }

    /**
     * Delete all campaign player data (both DB and JSON).
     */
    public function deleteCampaignPlayers(int $campaignId): void
    {
        // Delete from database
        Player::where('campaign_id', $campaignId)->delete();

        // Delete JSON file
        $path = $this->getLeaguePlayersPath($campaignId);
        if (Storage::exists($path)) {
            Storage::delete($path);
        }
    }

    /**
     * Update a JSON player's contract.
     */
    public function updatePlayerContract(int $campaignId, string $playerId, int $years, float $salary): bool
    {
        $leaguePlayers = $this->loadLeaguePlayers($campaignId);
        $updated = false;

        foreach ($leaguePlayers as &$player) {
            if (($player['id'] ?? '') == $playerId) {
                $player['contractYearsRemaining'] = $years;
                $player['contract_years_remaining'] = $years;
                $player['contractSalary'] = $salary;
                $player['contract_salary'] = $salary;
                $updated = true;
                break;
            }
        }

        if ($updated) {
            $this->saveLeaguePlayers($campaignId, $leaguePlayers);
        }

        return $updated;
    }

    /**
     * Release a JSON player (remove team assignment).
     */
    public function releaseJsonPlayer(int $campaignId, string $playerId): bool
    {
        $leaguePlayers = $this->loadLeaguePlayers($campaignId);
        $updated = false;

        foreach ($leaguePlayers as &$player) {
            if (($player['id'] ?? '') == $playerId) {
                $player['teamAbbreviation'] = 'FA';
                $player['team_abbreviation'] = 'FA';
                $player['contractYearsRemaining'] = 0;
                $player['contract_years_remaining'] = 0;
                $player['contractSalary'] = 0;
                $player['contract_salary'] = 0;
                $updated = true;
                break;
            }
        }

        if ($updated) {
            $this->saveLeaguePlayers($campaignId, $leaguePlayers);
        }

        return $updated;
    }

    /**
     * Sign a free agent to an AI team (JSON player).
     */
    public function signFreeAgentToAiTeam(
        int $campaignId,
        string $playerId,
        string $teamAbbr,
        int $years,
        float $salary
    ): bool {
        $leaguePlayers = $this->loadLeaguePlayers($campaignId);
        $updated = false;

        foreach ($leaguePlayers as &$player) {
            if (($player['id'] ?? '') == $playerId) {
                $currentTeam = $player['teamAbbreviation'] ?? $player['team_abbreviation'] ?? null;

                // Only sign if currently a free agent
                if (empty($currentTeam) || $currentTeam === 'FA') {
                    $player['teamAbbreviation'] = $teamAbbr;
                    $player['team_abbreviation'] = $teamAbbr;
                    $player['contractYearsRemaining'] = $years;
                    $player['contract_years_remaining'] = $years;
                    $player['contractSalary'] = $salary;
                    $player['contract_salary'] = $salary;
                    $updated = true;
                }
                break;
            }
        }

        if ($updated) {
            $this->saveLeaguePlayers($campaignId, $leaguePlayers);
        }

        return $updated;
    }

    // =========================================================================
    // Player Data Randomization (called during campaign creation)
    // =========================================================================

    /**
     * Randomize player data fields that are identical/null in the master file.
     * Called once per player during campaign initialization.
     */
    private function randomizePlayerData(array $data): array
    {
        $data = $this->randomizeBirthDate($data);
        $data = $this->randomizeDraftInfo($data);
        $data = $this->randomizeTradeValue($data);
        $data = $this->randomizePersonalityTraits($data);
        $data = $this->randomizePhysicalAttributes($data);
        $data = $this->randomizeBioData($data);

        // Randomize jersey number
        $data['jerseyNumber'] = rand(0, 99);

        // Clean up temp field
        unset($data['_age']);

        return $data;
    }

    /**
     * Infer age from ratings gap and generate a realistic birth date.
     */
    private function randomizeBirthDate(array $data): array
    {
        $ovr = $data['overallRating'] ?? 70;
        $potential = $data['potentialRating'] ?? $ovr;
        $potentialGap = $potential - $ovr;

        if ($potentialGap >= 10) {
            $age = rand(19, 23);
        } elseif ($potentialGap >= 5 && $ovr < 80) {
            $age = rand(20, 25);
        } elseif ($ovr >= 88 && $potentialGap >= 3) {
            $age = rand(22, 27);
        } elseif ($ovr >= 88 && $potentialGap < 3) {
            $age = rand(26, 32);
        } elseif ($ovr >= 78) {
            $age = rand(24, 32);
        } elseif ($ovr >= 68) {
            $age = rand(22, 34);
        } elseif ($potentialGap <= 0 && $ovr < 65) {
            $age = rand(28, 36);
        } else {
            $age = rand(19, 24);
        }

        $birthYear = 2025 - $age;
        $month = rand(1, 12);
        $maxDay = cal_days_in_month(CAL_GREGORIAN, $month, $birthYear);
        $day = rand(1, $maxDay);

        $data['birthDate'] = Carbon::create($birthYear, $month, $day)->format('Y-m-d');
        $data['_age'] = $age; // Temp field used by other randomizers

        return $data;
    }

    /**
     * Generate draft year, round, and pick based on age and ratings.
     */
    private function randomizeDraftInfo(array $data): array
    {
        $age = $data['_age'] ?? 25;
        $ovr = $data['overallRating'] ?? 70;
        $potential = $data['potentialRating'] ?? $ovr;
        $combinedScore = $ovr + ($potential - $ovr) * 0.5;

        // Entry age: weighted random 19-22
        $entryRoll = rand(1, 100);
        if ($entryRoll <= 40) {
            $entryAge = 19;
        } elseif ($entryRoll <= 70) {
            $entryAge = 20;
        } elseif ($entryRoll <= 90) {
            $entryAge = 21;
        } else {
            $entryAge = 22;
        }

        // Can't be drafted before they were born
        $entryAge = min($entryAge, $age);

        $draftYear = 2025 - ($age - $entryAge);

        // Draft round and pick based on combined score
        if ($combinedScore >= 88) {
            $draftRound = 1;
            $draftPick = rand(1, 5);
        } elseif ($combinedScore >= 82) {
            $draftRound = 1;
            $draftPick = rand(3, 14);
        } elseif ($combinedScore >= 76) {
            $draftRound = 1;
            $draftPick = rand(10, 30);
        } elseif ($combinedScore >= 70) {
            $draftRound = rand(1, 2);
            $draftPick = $draftRound === 1 ? rand(15, 30) : rand(31, 60);
        } elseif ($combinedScore >= 60) {
            $draftRound = 2;
            $draftPick = rand(31, 60);
        } else {
            // 50% undrafted, 50% late 2nd round
            if (rand(0, 1) === 0) {
                $data['draftYear'] = null;
                $data['draftRound'] = null;
                $data['draftPick'] = null;
                return $data;
            }
            $draftRound = 2;
            $draftPick = rand(45, 60);
        }

        $data['draftYear'] = $draftYear;
        $data['draftRound'] = $draftRound;
        $data['draftPick'] = $draftPick;

        return $data;
    }

    /**
     * Generate trade value based on OVR with age modifier.
     */
    private function randomizeTradeValue(array $data): array
    {
        if (($data['tradeValue'] ?? null) !== null) {
            return $data;
        }

        $ovr = $data['overallRating'] ?? 70;
        $age = $data['_age'] ?? 25;

        if ($ovr >= 92) {
            $value = $this->randFloat(25, 40);
        } elseif ($ovr >= 88) {
            $value = $this->randFloat(18, 28);
        } elseif ($ovr >= 84) {
            $value = $this->randFloat(12, 20);
        } elseif ($ovr >= 80) {
            $value = $this->randFloat(8, 14);
        } elseif ($ovr >= 76) {
            $value = $this->randFloat(5, 10);
        } elseif ($ovr >= 72) {
            $value = $this->randFloat(3, 7);
        } elseif ($ovr >= 68) {
            $value = $this->randFloat(1.5, 4);
        } else {
            $value = $this->randFloat(0.5, 2);
        }

        // Age modifiers
        if ($age <= 24) {
            $value *= 1.15;
        } elseif ($age >= 32) {
            $value *= 0.80;
        }

        $data['tradeValue'] = round($value, 2);
        $data['tradeValueTotal'] = round($value * $this->randFloat(0.6, 0.9), 2);

        return $data;
    }

    /**
     * Assign personality traits based on attributes and random selection.
     */
    private function randomizePersonalityTraits(array $data): array
    {
        $traits = $data['personality']['traits'] ?? [];
        if (!empty($traits)) {
            return $data;
        }

        $allTraits = ['competitor', 'leader', 'mentor', 'hot_head', 'ball_hog', 'team_player', 'joker', 'quiet', 'media_darling'];

        // Determine number of traits
        $countRoll = rand(1, 100);
        if ($countRoll <= 20) {
            $numTraits = 0;
        } elseif ($countRoll <= 60) {
            $numTraits = 1;
        } elseif ($countRoll <= 90) {
            $numTraits = 2;
        } else {
            $numTraits = 3;
        }

        if ($numTraits === 0) {
            return $data;
        }

        $assignedTraits = [];
        $ovr = $data['overallRating'] ?? 70;
        $age = $data['_age'] ?? 25;
        $workEthic = $data['attributes']['mental']['workEthic'] ?? 50;
        $basketballIQ = $data['attributes']['mental']['basketballIQ'] ?? 50;

        // Attribute-inferred traits (checked first)
        if ($workEthic >= 85 && rand(1, 100) <= 40) {
            $assignedTraits[] = 'competitor';
        }
        if ($basketballIQ >= 85 && $age >= 28 && rand(1, 100) <= 30 && count($assignedTraits) < $numTraits) {
            $assignedTraits[] = 'mentor';
        }
        if ($basketballIQ >= 80 && $ovr >= 82 && rand(1, 100) <= 25 && count($assignedTraits) < $numTraits) {
            $assignedTraits[] = 'leader';
        }

        // Fill remaining slots randomly
        $remainingPool = array_diff($allTraits, $assignedTraits);
        $remainingPool = array_values($remainingPool);
        shuffle($remainingPool);

        while (count($assignedTraits) < $numTraits && !empty($remainingPool)) {
            $assignedTraits[] = array_shift($remainingPool);
        }

        // Conflict resolution
        $hasBallHog = in_array('ball_hog', $assignedTraits);
        $hasTeamPlayer = in_array('team_player', $assignedTraits);
        $hasHotHead = in_array('hot_head', $assignedTraits);
        $hasQuiet = in_array('quiet', $assignedTraits);

        if ($hasBallHog && $hasTeamPlayer) {
            $assignedTraits = array_values(array_diff($assignedTraits, [rand(0, 1) ? 'ball_hog' : 'team_player']));
        }
        if ($hasHotHead && $hasQuiet) {
            $assignedTraits = array_values(array_diff($assignedTraits, [rand(0, 1) ? 'hot_head' : 'quiet']));
        }

        $data['personality']['traits'] = $assignedTraits;

        return $data;
    }

    /**
     * Generate realistic physical attributes from position-appropriate distributions.
     * Master data has nearly everyone at 78" regardless of position, so we generate
     * from scratch using a bell curve centered on realistic NBA averages.
     */
    private function randomizePhysicalAttributes(array $data): array
    {
        $position = $data['position'] ?? 'SF';

        // [mean height, stddev, min, max, mean weight, weight stddev, weight min, weight max]
        $positionProfiles = [
            'PG' => ['hMean' => 74, 'hStd' => 2.0, 'hMin' => 70, 'hMax' => 78, 'wMean' => 190, 'wStd' => 12, 'wMin' => 165, 'wMax' => 215],
            'SG' => ['hMean' => 76, 'hStd' => 1.8, 'hMin' => 72, 'hMax' => 80, 'wMean' => 200, 'wStd' => 12, 'wMin' => 175, 'wMax' => 225],
            'SF' => ['hMean' => 79, 'hStd' => 1.8, 'hMin' => 75, 'hMax' => 83, 'wMean' => 220, 'wStd' => 12, 'wMin' => 200, 'wMax' => 250],
            'PF' => ['hMean' => 81, 'hStd' => 1.8, 'hMin' => 77, 'hMax' => 85, 'wMean' => 240, 'wStd' => 12, 'wMin' => 215, 'wMax' => 265],
            'C'  => ['hMean' => 83, 'hStd' => 2.0, 'hMin' => 79, 'hMax' => 88, 'wMean' => 255, 'wStd' => 15, 'wMin' => 225, 'wMax' => 285],
        ];

        $profile = $positionProfiles[$position] ?? $positionProfiles['SF'];

        // Generate height from normal distribution, clamped to position range
        $height = (int) round($this->normalRandom($profile['hMean'], $profile['hStd']));
        $height = max($profile['hMin'], min($profile['hMax'], $height));
        $data['heightInches'] = $height;

        // Weight scales with height — taller players within a position tend to be heavier
        $heightOffset = $height - $profile['hMean'];
        $weightMean = $profile['wMean'] + ($heightOffset * 5); // ~5 lbs per inch above/below avg
        $weight = (int) round($this->normalRandom($weightMean, $profile['wStd']));
        $weight = max($profile['wMin'], min($profile['wMax'], $weight));
        $data['weightLbs'] = $weight;

        // Wingspan: typically height + 0 to 5 inches, with taller players trending longer
        $wingspanBase = $height + rand(0, 5);
        // Add a slight bonus for bigs
        if ($position === 'C' || $position === 'PF') {
            $wingspanBase += rand(0, 2);
        }
        $data['wingspanInches'] = $wingspanBase;

        return $data;
    }

    /**
     * Assign college and hometown if missing.
     */
    private function randomizeBioData(array $data): array
    {
        $country = $data['country'] ?? 'United States';
        $isInternational = $country !== 'United States';

        // College
        if (empty($data['college'])) {
            if ($isInternational) {
                $data['college'] = rand(0, 1) ? 'International' : 'Overseas Academy';
            } else {
                $colleges = [
                    'Duke', 'Kentucky', 'North Carolina', 'Kansas', 'UCLA',
                    'Michigan State', 'Gonzaga', 'Villanova', 'Louisville', 'Syracuse',
                    'Indiana', 'Connecticut', 'Arizona', 'Florida', 'Ohio State',
                    'Michigan', 'Texas', 'Georgetown', 'Wake Forest', 'Memphis',
                    'LSU', 'Auburn', 'Baylor', 'Tennessee', 'Virginia',
                    'Wisconsin', 'Purdue', 'Iowa State', 'Oregon', 'Maryland',
                    'Georgia Tech', 'Creighton', 'Marquette', 'San Diego State', 'Houston',
                    'USC', 'Stanford', 'Notre Dame', 'Oklahoma', 'Arkansas',
                    'Alabama', 'Dayton', 'Xavier', 'Butler', 'Providence',
                ];
                $data['college'] = $colleges[array_rand($colleges)];
            }
        }

        // Hometown
        if (empty($data['hometown']) && !$isInternational) {
            $hometowns = [
                'Los Angeles, CA', 'Chicago, IL', 'Houston, TX', 'New York, NY',
                'Philadelphia, PA', 'Atlanta, GA', 'Detroit, MI', 'Memphis, TN',
                'Miami, FL', 'Dallas, TX', 'Oakland, CA', 'Indianapolis, IN',
                'Baltimore, MD', 'Charlotte, NC', 'Milwaukee, WI', 'St. Louis, MO',
                'Cleveland, OH', 'New Orleans, LA', 'Minneapolis, MN', 'Phoenix, AZ',
                'San Antonio, TX', 'Washington, DC', 'Denver, CO', 'Seattle, WA',
                'Boston, MA', 'Raleigh, NC', 'Nashville, TN', 'Jacksonville, FL',
                'Columbus, OH', 'Sacramento, CA', 'Las Vegas, NV', 'Louisville, KY',
                'Compton, CA', 'Brooklyn, NY', 'Akron, OH',
            ];
            $data['hometown'] = $hometowns[array_rand($hometowns)];
        }

        return $data;
    }

    /**
     * Generate a random float between min and max.
     */
    private function randFloat(float $min, float $max): float
    {
        return $min + mt_rand() / mt_getrandmax() * ($max - $min);
    }

    /**
     * Generate a normally-distributed random number (Box-Muller transform).
     */
    private function normalRandom(float $mean, float $stddev): float
    {
        $u1 = max(0.0001, mt_rand() / mt_getrandmax()); // avoid log(0)
        $u2 = mt_rand() / mt_getrandmax();
        $z = sqrt(-2 * log($u1)) * cos(2 * M_PI * $u2);
        return $mean + $z * $stddev;
    }

    /**
     * Decrement contract years for all players at end of season.
     */
    public function decrementContractYears(int $campaignId): array
    {
        $expiredPlayers = [];

        // Update DB players
        $dbPlayers = Player::where('campaign_id', $campaignId)->get();
        foreach ($dbPlayers as $player) {
            if ($player->contract_years_remaining > 0) {
                $newYears = $player->contract_years_remaining - 1;
                $player->update(['contract_years_remaining' => $newYears]);

                if ($newYears === 0) {
                    // Player becomes a free agent
                    $player->update([
                        'team_id' => null,
                        'contract_salary' => 0,
                    ]);
                    $expiredPlayers[] = [
                        'id' => $player->id,
                        'name' => $player->first_name . ' ' . $player->last_name,
                        'source' => 'database',
                    ];
                }
            }
        }

        // Update JSON players
        $leaguePlayers = $this->loadLeaguePlayers($campaignId);
        $updated = false;

        foreach ($leaguePlayers as &$player) {
            $years = $player['contractYearsRemaining'] ?? $player['contract_years_remaining'] ?? 0;
            if ($years > 0) {
                $newYears = $years - 1;
                $player['contractYearsRemaining'] = $newYears;
                $player['contract_years_remaining'] = $newYears;
                $updated = true;

                if ($newYears === 0) {
                    // Player becomes a free agent
                    $player['teamAbbreviation'] = 'FA';
                    $player['team_abbreviation'] = 'FA';
                    $player['contractSalary'] = 0;
                    $player['contract_salary'] = 0;

                    $expiredPlayers[] = [
                        'id' => $player['id'],
                        'name' => ($player['firstName'] ?? $player['first_name']) . ' ' .
                                 ($player['lastName'] ?? $player['last_name']),
                        'source' => 'json',
                    ];
                }
            }
        }

        if ($updated) {
            $this->saveLeaguePlayers($campaignId, $leaguePlayers);
        }

        return $expiredPlayers;
    }
}
