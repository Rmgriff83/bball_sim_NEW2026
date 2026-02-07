<?php

namespace App\Services;

use App\Models\BadgeDefinition;
use App\Models\Campaign;
use App\Models\Player;
use App\Models\PlayerBadge;
use App\Models\Team;
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

        return array_values(array_filter($leaguePlayers, fn($p) =>
            ($p['teamAbbreviation'] ?? '') === $teamAbbreviation
        ));
    }

    /**
     * Update a player in the league JSON file.
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
}
