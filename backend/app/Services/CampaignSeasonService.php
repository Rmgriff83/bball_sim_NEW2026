<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\Season;
use App\Models\Team;
use Carbon\Carbon;
use Illuminate\Support\Facades\Storage;

class CampaignSeasonService
{
    private array $loadedSeasons = [];

    /**
     * Get the file path for a campaign's season JSON.
     */
    private function getSeasonFilePath(int $campaignId, int $year): string
    {
        return "campaigns/{$campaignId}/season_{$year}.json";
    }

    /**
     * Load season data from JSON file (cached per request).
     */
    public function loadSeason(int $campaignId, int $year): ?array
    {
        $key = "{$campaignId}_{$year}";

        if (!isset($this->loadedSeasons[$key])) {
            $path = $this->getSeasonFilePath($campaignId, $year);

            if (!Storage::exists($path)) {
                return null;
            }

            $this->loadedSeasons[$key] = json_decode(Storage::get($path), true);
        }

        return $this->loadedSeasons[$key];
    }

    /**
     * Save season data to JSON file.
     */
    public function saveSeason(int $campaignId, int $year, array $data): void
    {
        $path = $this->getSeasonFilePath($campaignId, $year);

        // Ensure directory exists
        $dir = dirname($path);
        if (!Storage::exists($dir)) {
            Storage::makeDirectory($dir);
        }

        // Update metadata
        $data['metadata']['updatedAt'] = now()->toIso8601String();

        // Use compact JSON (no pretty print) to reduce file size
        // Also use JSON_INVALID_UTF8_SUBSTITUTE to handle any encoding issues
        $json = json_encode($data, JSON_INVALID_UTF8_SUBSTITUTE);

        if ($json === false) {
            \Log::error("Failed to encode season data for campaign {$campaignId}, year {$year}: " . json_last_error_msg());
            return;
        }

        Storage::put($path, $json);

        // Update cache
        $key = "{$campaignId}_{$year}";
        $this->loadedSeasons[$key] = $data;
    }

    /**
     * Check if season file exists.
     */
    public function seasonExists(int $campaignId, int $year): bool
    {
        return Storage::exists($this->getSeasonFilePath($campaignId, $year));
    }

    /**
     * Initialize a new season with empty data structure.
     */
    public function initializeSeason(Campaign $campaign, int $year): array
    {
        $teams = Team::where('campaign_id', $campaign->id)->get();
        $standings = $this->generateInitialStandings($teams);

        $seasonData = [
            'metadata' => [
                'campaignId' => $campaign->id,
                'year' => $year,
                'createdAt' => now()->toIso8601String(),
                'updatedAt' => now()->toIso8601String(),
            ],
            'standings' => $standings,
            'schedule' => [],
            'playerStats' => [],
            'teamStats' => $this->generateInitialTeamStats($teams),
            'playoffBracket' => null,
        ];

        $this->saveSeason($campaign->id, $year, $seasonData);

        return $seasonData;
    }

    /**
     * Generate initial standings with all teams at 0-0.
     */
    private function generateInitialStandings($teams): array
    {
        $east = [];
        $west = [];

        foreach ($teams as $team) {
            $teamStanding = [
                'teamId' => $team->id,
                'teamAbbreviation' => $team->abbreviation,
                'wins' => 0,
                'losses' => 0,
                'streak' => null,
                'last10' => '0-0',
                'homeRecord' => '0-0',
                'awayRecord' => '0-0',
                'conferenceRecord' => '0-0',
                'divisionRecord' => '0-0',
                'pointsFor' => 0,
                'pointsAgainst' => 0,
            ];

            if ($team->conference === 'east') {
                $east[] = $teamStanding;
            } else {
                $west[] = $teamStanding;
            }
        }

        return ['east' => $east, 'west' => $west];
    }

    /**
     * Generate initial team stats.
     */
    private function generateInitialTeamStats($teams): array
    {
        $stats = [];

        foreach ($teams as $team) {
            $stats[$team->id] = [
                'teamId' => $team->id,
                'teamAbbreviation' => $team->abbreviation,
                'wins' => 0,
                'losses' => 0,
                'homeWins' => 0,
                'homeLosses' => 0,
                'pointsScored' => 0,
                'pointsAllowed' => 0,
                'playoffSeed' => null,
                'playoffResult' => null,
            ];
        }

        return $stats;
    }

    /**
     * Generate the regular season schedule.
     * Returns number of games created.
     */
    public function generateSchedule(Campaign $campaign, int $year): int
    {
        $season = $this->loadSeason($campaign->id, $year);
        if (!$season) {
            $season = $this->initializeSeason($campaign, $year);
        }

        $teams = Team::where('campaign_id', $campaign->id)->get();
        $startDate = Carbon::parse('2025-10-21');
        $teamIds = $teams->pluck('id')->toArray();
        $teamConferences = $teams->pluck('conference', 'id')->toArray();
        $teamAbbreviations = $teams->pluck('abbreviation', 'id')->toArray();

        // Build matchups
        $matchups = [];
        foreach ($teamIds as $homeTeamId) {
            foreach ($teamIds as $awayTeamId) {
                if ($homeTeamId === $awayTeamId) continue;

                $sameConference = $teamConferences[$homeTeamId] === $teamConferences[$awayTeamId];
                $numGames = $sameConference ? 2 : 1;

                for ($k = 0; $k < $numGames; $k++) {
                    $matchups[] = [
                        'homeTeamId' => $homeTeamId,
                        'awayTeamId' => $awayTeamId,
                    ];
                }
            }
        }

        // Distribute games across season ensuring no team plays twice on the same day
        shuffle($matchups);
        $gamesPerDay = 8;
        $currentDate = $startDate->copy();
        $schedule = [];
        $gameNumber = 1;
        $remaining = $matchups;

        while (!empty($remaining)) {
            $dayGames = [];
            $teamsPlayingToday = [];
            $unscheduled = [];

            foreach ($remaining as $matchup) {
                $home = $matchup['homeTeamId'];
                $away = $matchup['awayTeamId'];

                if (count($dayGames) >= $gamesPerDay
                    || in_array($home, $teamsPlayingToday)
                    || in_array($away, $teamsPlayingToday)
                ) {
                    $unscheduled[] = $matchup;
                    continue;
                }

                $dayGames[] = $matchup;
                $teamsPlayingToday[] = $home;
                $teamsPlayingToday[] = $away;
            }

            foreach ($dayGames as $matchup) {
                $gameId = sprintf('game_%d_%04d', $year, $gameNumber);

                $schedule[] = [
                    'id' => $gameId,
                    'homeTeamId' => $matchup['homeTeamId'],
                    'homeTeamAbbreviation' => $teamAbbreviations[$matchup['homeTeamId']],
                    'awayTeamId' => $matchup['awayTeamId'],
                    'awayTeamAbbreviation' => $teamAbbreviations[$matchup['awayTeamId']],
                    'gameDate' => $currentDate->format('Y-m-d'),
                    'isPlayoff' => false,
                    'playoffRound' => null,
                    'playoffGameNumber' => null,
                    'isComplete' => false,
                    'homeScore' => null,
                    'awayScore' => null,
                    'boxScore' => null,
                ];

                $gameNumber++;
            }

            // Re-shuffle remaining to avoid ordering bias
            shuffle($unscheduled);
            $remaining = $unscheduled;

            $currentDate->addDay();

            // Skip some Sundays
            if ($currentDate->dayOfWeek === 0 && rand(0, 1) === 0) {
                $currentDate->addDay();
            }
        }

        $season['schedule'] = $schedule;
        $this->saveSeason($campaign->id, $year, $season);

        return count($schedule);
    }

    /**
     * Get full schedule.
     */
    public function getSchedule(int $campaignId, int $year): array
    {
        $season = $this->loadSeason($campaignId, $year);
        return $season['schedule'] ?? [];
    }

    /**
     * Get games for a specific date.
     */
    public function getGamesByDate(int $campaignId, int $year, string $date): array
    {
        $schedule = $this->getSchedule($campaignId, $year);

        return array_values(array_filter($schedule, fn($game) =>
            $game['gameDate'] === $date
        ));
    }

    /**
     * Get upcoming games for a team.
     */
    public function getUpcomingGames(int $campaignId, int $year, int $teamId, int $limit = 5): array
    {
        $schedule = $this->getSchedule($campaignId, $year);

        $teamGames = array_filter($schedule, fn($game) =>
            !$game['isComplete'] &&
            ($game['homeTeamId'] === $teamId || $game['awayTeamId'] === $teamId)
        );

        // Sort by date
        usort($teamGames, fn($a, $b) => strcmp($a['gameDate'], $b['gameDate']));

        return array_slice(array_values($teamGames), 0, $limit);
    }

    /**
     * Get completed games.
     */
    public function getCompletedGames(int $campaignId, int $year): array
    {
        $schedule = $this->getSchedule($campaignId, $year);

        return array_values(array_filter($schedule, fn($game) => $game['isComplete']));
    }

    /**
     * Get a specific game by ID.
     */
    public function getGame(int $campaignId, int $year, string $gameId): ?array
    {
        $schedule = $this->getSchedule($campaignId, $year);

        foreach ($schedule as $game) {
            if ($game['id'] === $gameId) {
                return $game;
            }
        }

        return null;
    }

    /**
     * Get game index in schedule array.
     */
    private function getGameIndex(array $schedule, string $gameId): ?int
    {
        foreach ($schedule as $index => $game) {
            if ($game['id'] === $gameId) {
                return $index;
            }
        }
        return null;
    }

    /**
     * Update a game with results.
     *
     * @param bool $isUserGame If false, strips detailed box score to save space
     */
    public function updateGame(int $campaignId, int $year, string $gameId, array $data, bool $isUserGame = true, bool $defer = false): bool
    {
        $season = $this->loadSeason($campaignId, $year);
        if (!$season) return false;

        $index = $this->getGameIndex($season['schedule'], $gameId);
        if ($index === null) return false;

        // For AI vs AI games, strip detailed box score to save storage
        if (!$isUserGame && isset($data['boxScore'])) {
            $data['boxScore'] = $this->compactBoxScore($data['boxScore']);
        }

        $season['schedule'][$index] = array_merge($season['schedule'][$index], $data);

        if ($defer) {
            // Update in-memory cache only; caller must call flushSeason() later
            $key = "{$campaignId}_{$year}";
            $this->loadedSeasons[$key] = $season;
        } else {
            $this->saveSeason($campaignId, $year, $season);
        }

        return true;
    }

    /**
     * Compact box score for AI games - keeps only essential data.
     */
    private function compactBoxScore(array $boxScore): array
    {
        $compact = [];

        foreach (['home', 'away'] as $team) {
            $compact[$team] = [];
            foreach ($boxScore[$team] ?? [] as $player) {
                // Keep only essential stats for historical reference
                $compact[$team][] = [
                    'player_id' => $player['player_id'] ?? $player['playerId'] ?? null,
                    'name' => $player['name'] ?? 'Unknown',
                    'points' => $player['points'] ?? 0,
                    'rebounds' => $player['rebounds'] ?? 0,
                    'assists' => $player['assists'] ?? 0,
                    'minutes' => $player['minutes'] ?? 0,
                ];
            }
        }

        return $compact;
    }

    /**
     * Get standings.
     */
    public function getStandings(int $campaignId, int $year): array
    {
        $season = $this->loadSeason($campaignId, $year);
        return $season['standings'] ?? ['east' => [], 'west' => []];
    }

    /**
     * Update standings after a game.
     */
    public function updateStandingsAfterGame(
        int $campaignId,
        int $year,
        int $homeTeamId,
        int $awayTeamId,
        int $homeScore,
        int $awayScore,
        string $homeConference,
        string $awayConference,
        bool $defer = false
    ): void {
        $season = $this->loadSeason($campaignId, $year);
        if (!$season) return;

        $homeWon = $homeScore > $awayScore;

        // Update standings for both conferences
        foreach (['east', 'west'] as $conf) {
            foreach ($season['standings'][$conf] as &$standing) {
                if ($standing['teamId'] === $homeTeamId) {
                    $standing = $this->updateTeamStanding($standing, $homeWon, $homeScore, $awayScore, true);
                }
                if ($standing['teamId'] === $awayTeamId) {
                    $standing = $this->updateTeamStanding($standing, !$homeWon, $awayScore, $homeScore, false);
                }
            }

            // Sort by wins descending
            usort($season['standings'][$conf], fn($a, $b) => $b['wins'] - $a['wins']);
        }

        // Update team stats
        $this->updateTeamStatsAfterGame($season, $homeTeamId, $homeScore, $awayScore, true);
        $this->updateTeamStatsAfterGame($season, $awayTeamId, $awayScore, $homeScore, false);

        if ($defer) {
            // Update in-memory cache only; caller must call flushSeason() later
            $key = "{$campaignId}_{$year}";
            $this->loadedSeasons[$key] = $season;
        } else {
            $this->saveSeason($campaignId, $year, $season);
        }
    }

    /**
     * Update a single team's standing.
     */
    private function updateTeamStanding(array $standing, bool $won, int $pointsFor, int $pointsAgainst, bool $isHome): array
    {
        if ($won) {
            $standing['wins']++;
            $standing['streak'] = $this->updateStreak($standing['streak'], true);
        } else {
            $standing['losses']++;
            $standing['streak'] = $this->updateStreak($standing['streak'], false);
        }

        // Update home/away records
        if ($isHome) {
            $standing['homeRecord'] = $this->updateRecord($standing['homeRecord'], $won);
        } else {
            $standing['awayRecord'] = $this->updateRecord($standing['awayRecord'], $won);
        }

        $standing['pointsFor'] += $pointsFor;
        $standing['pointsAgainst'] += $pointsAgainst;

        return $standing;
    }

    /**
     * Update streak string.
     */
    private function updateStreak(?string $streak, bool $won): string
    {
        if (!$streak) {
            return $won ? 'W1' : 'L1';
        }

        $type = substr($streak, 0, 1);
        $count = (int) substr($streak, 1);

        if (($type === 'W' && $won) || ($type === 'L' && !$won)) {
            return $type . ($count + 1);
        }

        return $won ? 'W1' : 'L1';
    }

    /**
     * Update record string (e.g., "15-3").
     */
    private function updateRecord(string $record, bool $won): string
    {
        $parts = explode('-', $record);
        $wins = (int) ($parts[0] ?? 0);
        $losses = (int) ($parts[1] ?? 0);

        if ($won) {
            $wins++;
        } else {
            $losses++;
        }

        return "{$wins}-{$losses}";
    }

    /**
     * Update team stats after a game.
     */
    private function updateTeamStatsAfterGame(array &$season, int $teamId, int $pointsFor, int $pointsAgainst, bool $isHome): void
    {
        if (!isset($season['teamStats'][$teamId])) {
            return;
        }

        $stats = &$season['teamStats'][$teamId];
        $won = $pointsFor > $pointsAgainst;

        if ($won) {
            $stats['wins']++;
            if ($isHome) {
                $stats['homeWins']++;
            }
        } else {
            $stats['losses']++;
            if ($isHome) {
                $stats['homeLosses']++;
            }
        }

        $stats['pointsScored'] += $pointsFor;
        $stats['pointsAllowed'] += $pointsAgainst;
    }

    /**
     * Update player stats after a game (in-memory only, requires explicit save).
     * Call saveSeason() after updating all player stats to persist changes.
     */
    public function updatePlayerStats(int $campaignId, int $year, string $playerId, string $playerName, int $teamId, array $gameStats): void
    {
        $season = $this->loadSeason($campaignId, $year);
        if (!$season) return;

        if (!isset($season['playerStats'][$playerId])) {
            $season['playerStats'][$playerId] = [
                'playerId' => $playerId,
                'playerName' => $playerName,
                'teamId' => $teamId,
                'gamesPlayed' => 0,
                'gamesStarted' => 0,
                'minutesPlayed' => 0,
                'points' => 0,
                'rebounds' => 0,
                'offensiveRebounds' => 0,
                'defensiveRebounds' => 0,
                'assists' => 0,
                'steals' => 0,
                'blocks' => 0,
                'turnovers' => 0,
                'personalFouls' => 0,
                'fieldGoalsMade' => 0,
                'fieldGoalsAttempted' => 0,
                'threePointersMade' => 0,
                'threePointersAttempted' => 0,
                'freeThrowsMade' => 0,
                'freeThrowsAttempted' => 0,
            ];
        }

        $stats = &$season['playerStats'][$playerId];

        $stats['gamesPlayed']++;
        $stats['minutesPlayed'] += $gameStats['minutes'] ?? 0;
        $stats['points'] += $gameStats['points'] ?? 0;
        $stats['rebounds'] += $gameStats['rebounds'] ?? 0;
        $stats['offensiveRebounds'] += $gameStats['offensiveRebounds'] ?? $gameStats['offensive_rebounds'] ?? 0;
        $stats['defensiveRebounds'] += $gameStats['defensiveRebounds'] ?? $gameStats['defensive_rebounds'] ?? 0;
        $stats['assists'] += $gameStats['assists'] ?? 0;
        $stats['steals'] += $gameStats['steals'] ?? 0;
        $stats['blocks'] += $gameStats['blocks'] ?? 0;
        $stats['turnovers'] += $gameStats['turnovers'] ?? 0;
        $stats['personalFouls'] += $gameStats['fouls'] ?? $gameStats['personalFouls'] ?? 0;
        $stats['fieldGoalsMade'] += $gameStats['fieldGoalsMade'] ?? $gameStats['fgm'] ?? 0;
        $stats['fieldGoalsAttempted'] += $gameStats['fieldGoalsAttempted'] ?? $gameStats['fga'] ?? 0;
        $stats['threePointersMade'] += $gameStats['threePointersMade'] ?? $gameStats['fg3m'] ?? 0;
        $stats['threePointersAttempted'] += $gameStats['threePointersAttempted'] ?? $gameStats['fg3a'] ?? 0;
        $stats['freeThrowsMade'] += $gameStats['freeThrowsMade'] ?? $gameStats['ftm'] ?? 0;
        $stats['freeThrowsAttempted'] += $gameStats['freeThrowsAttempted'] ?? $gameStats['fta'] ?? 0;

        // Update cache but don't save yet - caller should call flushSeason() after batch updates
        $key = "{$campaignId}_{$year}";
        $this->loadedSeasons[$key] = $season;
    }

    /**
     * Flush any pending season changes to storage.
     * Call this after batch operations like updating multiple player stats.
     */
    public function flushSeason(int $campaignId, int $year): void
    {
        $key = "{$campaignId}_{$year}";
        if (isset($this->loadedSeasons[$key])) {
            $this->saveSeason($campaignId, $year, $this->loadedSeasons[$key]);
        }
    }

    /**
     * Get player stats.
     */
    public function getPlayerStats(int $campaignId, int $year, string $playerId): ?array
    {
        $season = $this->loadSeason($campaignId, $year);
        return $season['playerStats'][$playerId] ?? null;
    }

    /**
     * Get all player stats for a season.
     */
    public function getAllPlayerStats(int $campaignId, int $year): array
    {
        $season = $this->loadSeason($campaignId, $year);
        return $season['playerStats'] ?? [];
    }

    /**
     * Migrate player stats from one player ID to another (used during trades).
     * This handles the case where a player's ID changes when moving between DB and JSON storage.
     */
    public function migratePlayerStats(
        int $campaignId,
        int $year,
        string $oldPlayerId,
        string $newPlayerId,
        int $newTeamId,
        string $newPlayerName
    ): bool {
        $season = $this->loadSeason($campaignId, $year);
        if (!$season) return false;

        // Check if old player has stats
        $oldStats = $season['playerStats'][(string)$oldPlayerId] ?? null;
        if (!$oldStats) {
            \Log::info("No stats to migrate for player {$oldPlayerId}");
            return true; // No stats to migrate, not an error
        }

        // Copy stats to new player ID with updated info
        $season['playerStats'][(string)$newPlayerId] = array_merge($oldStats, [
            'playerId' => (string)$newPlayerId,
            'playerName' => $newPlayerName,
            'teamId' => $newTeamId,
        ]);

        // Remove old player stats entry
        unset($season['playerStats'][(string)$oldPlayerId]);

        // Save immediately
        $this->saveSeason($campaignId, $year, $season);

        \Log::info("Migrated player stats", [
            'old_id' => $oldPlayerId,
            'new_id' => $newPlayerId,
            'team_id' => $newTeamId,
            'games_played' => $oldStats['gamesPlayed'] ?? 0,
        ]);

        return true;
    }

    /**
     * Update player's team ID in their stats (for AI-to-AI trades where ID doesn't change).
     */
    public function updatePlayerStatsTeam(
        int $campaignId,
        int $year,
        string $playerId,
        int $newTeamId
    ): bool {
        $season = $this->loadSeason($campaignId, $year);
        if (!$season) return false;

        if (isset($season['playerStats'][(string)$playerId])) {
            $season['playerStats'][(string)$playerId]['teamId'] = $newTeamId;
            $this->saveSeason($campaignId, $year, $season);
            return true;
        }

        return false;
    }

    /**
     * Get team stats.
     */
    public function getTeamStats(int $campaignId, int $year, int $teamId): ?array
    {
        $season = $this->loadSeason($campaignId, $year);
        return $season['teamStats'][$teamId] ?? null;
    }

    /**
     * Delete all season data for a campaign.
     */
    public function deleteAllCampaignSeasons(int $campaignId): void
    {
        $basePath = "campaigns/{$campaignId}";

        if (Storage::exists($basePath)) {
            $files = Storage::files($basePath);
            foreach ($files as $file) {
                if (str_starts_with(basename($file), 'season_')) {
                    Storage::delete($file);
                }
            }
        }

        // Clear cache
        foreach (array_keys($this->loadedSeasons) as $key) {
            if (str_starts_with($key, "{$campaignId}_")) {
                unset($this->loadedSeasons[$key]);
            }
        }
    }

    /**
     * Get the next game for a specific team that hasn't been played.
     */
    public function getNextTeamGame(int $campaignId, int $year, int $teamId): ?array
    {
        $games = $this->getUpcomingGames($campaignId, $year, $teamId, 1);
        return $games[0] ?? null;
    }

    /**
     * Clear the in-memory cache (useful for testing or long-running processes).
     */
    public function clearCache(): void
    {
        $this->loadedSeasons = [];
    }

    /**
     * Get the playoff bracket from season data.
     */
    public function getPlayoffBracket(int $campaignId, int $year): ?array
    {
        $season = $this->loadSeason($campaignId, $year);
        return $season['playoffBracket'] ?? null;
    }

    /**
     * Save the playoff bracket to season data.
     */
    public function savePlayoffBracket(int $campaignId, int $year, array $bracket): void
    {
        $season = $this->loadSeason($campaignId, $year);
        if ($season) {
            $season['playoffBracket'] = $bracket;
            $this->saveSeason($campaignId, $year, $season);
        }
    }

    /**
     * Check if regular season is complete.
     * Season is complete when every team has played at least 82 games.
     */
    public function isRegularSeasonComplete(int $campaignId, int $year): bool
    {
        $schedule = $this->getSchedule($campaignId, $year);

        // Filter to regular season games only
        $regularSeasonGames = array_filter($schedule, fn($g) => !($g['isPlayoff'] ?? false));

        if (empty($regularSeasonGames)) {
            return false;
        }

        // Count completed games per team
        $gamesPerTeam = [];
        foreach ($regularSeasonGames as $game) {
            if ($game['isComplete'] ?? false) {
                $homeId = $game['homeTeamId'];
                $awayId = $game['awayTeamId'];
                $gamesPerTeam[$homeId] = ($gamesPerTeam[$homeId] ?? 0) + 1;
                $gamesPerTeam[$awayId] = ($gamesPerTeam[$awayId] ?? 0) + 1;
            }
        }

        // Need at least some teams in the count
        if (empty($gamesPerTeam)) {
            return false;
        }

        // Season is complete when all teams have played at least 68 games
        $minGamesRequired = 68;
        foreach ($gamesPerTeam as $teamId => $gamesPlayed) {
            if ($gamesPlayed < $minGamesRequired) {
                return false;
            }
        }

        // Also verify we have all 30 teams
        return count($gamesPerTeam) >= 30;
    }

    /**
     * Get preview data for simulating to the user's next game.
     * Returns the next user game and all intermediate AI games grouped by date.
     */
    public function getSimulateToNextGamePreview(int $campaignId, int $year, int $userTeamId, Carbon $currentDate): ?array
    {
        // Get user's next incomplete game
        $nextUserGame = $this->getNextTeamGame($campaignId, $year, $userTeamId);
        if (!$nextUserGame) {
            return null;
        }

        $nextGameDate = $nextUserGame['gameDate'];
        $currentDateStr = $currentDate->format('Y-m-d');

        // Get all incomplete games between current date and next game date (exclusive)
        $schedule = $this->getSchedule($campaignId, $year);
        $gamesByDate = [];

        foreach ($schedule as $game) {
            if ($game['isComplete']) continue;
            if ($game['gameDate'] < $currentDateStr) continue;
            if ($game['gameDate'] > $nextGameDate) continue;

            // Skip the user's own game on game day
            if ($game['gameDate'] === $nextGameDate &&
                ($game['homeTeamId'] === $userTeamId || $game['awayTeamId'] === $userTeamId)) {
                continue;
            }

            $gamesByDate[$game['gameDate']][] = $game;
        }
        ksort($gamesByDate);

        return [
            'nextUserGame' => $nextUserGame,
            'daysToSimulate' => count($gamesByDate),
            'gamesByDate' => $gamesByDate,
            'totalGamesToSimulate' => array_sum(array_map('count', $gamesByDate)),
        ];
    }

    /**
     * Bulk update standings (for sync operations).
     */
    public function updateStandings(int $campaignId, int $year, array $standings): void
    {
        $seasonData = $this->loadSeason($campaignId, $year);

        if ($seasonData) {
            $seasonData['standings'] = $standings;
            $this->saveSeason($campaignId, $year, $seasonData);
        }
    }

    /**
     * Bulk update player stats (for sync operations).
     */
    public function updatePlayerStatsBulk(int $campaignId, int $year, array $playerStats): void
    {
        $seasonData = $this->loadSeason($campaignId, $year);

        if ($seasonData) {
            $seasonData['playerStats'] = $playerStats;
            $this->saveSeason($campaignId, $year, $seasonData);
        }
    }

    /**
     * Update schedule (for sync operations).
     */
    public function updateSchedule(int $campaignId, int $year, array $schedule): void
    {
        $seasonData = $this->loadSeason($campaignId, $year);

        if ($seasonData) {
            $seasonData['schedule'] = $schedule;
            $this->saveSeason($campaignId, $year, $seasonData);
        }
    }
}
