<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Coach;
use App\Models\Player;
use App\Models\Team;
use App\Services\CampaignSeasonService;
use App\Services\GameSimulationService;
use App\Services\PlayerEvolution\PlayerEvolutionService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GameController extends Controller
{
    public function __construct(
        private CampaignSeasonService $seasonService,
        private GameSimulationService $simulationService,
        private PlayerEvolutionService $evolutionService
    ) {}

    /**
     * Get all games for a campaign's current season.
     */
    public function index(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? 2024;
        $schedule = $this->seasonService->getSchedule($campaign->id, $year);

        // Get team info for formatting
        $teams = Team::where('campaign_id', $campaign->id)
            ->select('id', 'name', 'abbreviation', 'primary_color')
            ->get()
            ->keyBy('id');

        $games = array_map(function ($game) use ($campaign, $teams) {
            return [
                'id' => $game['id'],
                'home_team' => $teams[$game['homeTeamId']] ?? null,
                'away_team' => $teams[$game['awayTeamId']] ?? null,
                'game_date' => $game['gameDate'],
                'home_score' => $game['homeScore'],
                'away_score' => $game['awayScore'],
                'is_complete' => $game['isComplete'],
                'is_playoff' => $game['isPlayoff'],
                'is_user_game' => $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id,
            ];
        }, $schedule);

        return response()->json(['games' => $games]);
    }

    /**
     * Get a specific game with box score.
     */
    public function show(Request $request, Campaign $campaign, string $gameId): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? 2024;
        $game = $this->seasonService->getGame($campaign->id, $year, $gameId);

        if (!$game) {
            return response()->json(['message' => 'Game not found'], 404);
        }

        // Get team info
        $homeTeam = Team::find($game['homeTeamId']);
        $awayTeam = Team::find($game['awayTeamId']);

        return response()->json([
            'game' => [
                'id' => $game['id'],
                'home_team' => $homeTeam,
                'away_team' => $awayTeam,
                'game_date' => $game['gameDate'],
                'home_score' => $game['homeScore'],
                'away_score' => $game['awayScore'],
                'is_complete' => $game['isComplete'],
                'is_in_progress' => $game['isInProgress'] ?? false,
                'current_quarter' => $game['currentQuarter'] ?? null,
                'is_playoff' => $game['isPlayoff'],
                'box_score' => $game['boxScore'],
            ],
        ]);
    }

    /**
     * Simulate a game.
     *
     * @param string $mode 'animated' (default) returns full animation data, 'quick' strips it
     * @param array|null $lineup Future: custom starting lineup
     * @param array|null $playbook Future: custom play preferences
     */
    public function simulate(Request $request, Campaign $campaign, string $gameId): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Get simulation mode (animated or quick)
        $mode = $request->input('mode', 'animated');

        // Future: lineup and playbook params (placeholder for now)
        $lineup = $request->input('lineup', null);
        $playbook = $request->input('playbook', null);

        $year = $campaign->currentSeason?->year ?? 2024;
        $game = $this->seasonService->getGame($campaign->id, $year, $gameId);

        if (!$game) {
            return response()->json(['message' => 'Game not found'], 404);
        }

        if ($game['isComplete']) {
            return response()->json(['message' => 'Game has already been played'], 400);
        }

        // Simulate all days between current_date and game_date (exclusive)
        // This ensures games are always in sync with the actual day
        $gameDate = Carbon::parse($game['gameDate']);
        $currentDate = $campaign->current_date;
        $simulatedDays = [];

        while ($currentDate->lt($gameDate)) {
            $dateStr = $currentDate->format('Y-m-d');
            $dayGames = $this->seasonService->getGamesByDate($campaign->id, $year, $dateStr);
            $dayGames = array_filter($dayGames, fn($g) => !$g['isComplete']);

            if (!empty($dayGames)) {
                $simulatedDays[] = $this->simulateDayGames($campaign, $year, $dayGames);
            }

            $currentDate = $currentDate->copy()->addDay();
        }

        // Get teams
        $homeTeam = Team::find($game['homeTeamId']);
        $awayTeam = Team::find($game['awayTeamId']);

        // Simulate the game
        $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam);

        // Update game in JSON
        $this->seasonService->updateGame($campaign->id, $year, $gameId, [
            'isComplete' => true,
            'homeScore' => $result['home_score'],
            'awayScore' => $result['away_score'],
            'boxScore' => $result['box_score'],
        ]);

        // Update standings
        $this->seasonService->updateStandingsAfterGame(
            $campaign->id,
            $year,
            $game['homeTeamId'],
            $game['awayTeamId'],
            $result['home_score'],
            $result['away_score'],
            $homeTeam->conference,
            $awayTeam->conference
        );

        // Update player stats
        $this->updatePlayerStats($campaign->id, $year, $result['box_score'], $homeTeam->id, $awayTeam->id);

        // Update coach stats
        $this->updateCoachStats($homeTeam->id, $awayTeam->id, $result['home_score'], $result['away_score'], $game['isPlayoff'] ?? false);

        // Advance campaign date
        $campaign->update(['current_date' => Carbon::parse($game['gameDate'])->addDay()]);

        // Strip animation data for quick sim mode to reduce response size
        if ($mode === 'quick') {
            unset($result['animation_data']);
            unset($result['play_by_play']);
        }

        $response = [
            'message' => 'Game simulated successfully',
            'result' => $result,
        ];

        // Include info about simulated days if any
        if (!empty($simulatedDays)) {
            $response['simulated_days'] = $simulatedDays;
        }

        return response()->json($response);
    }

    /**
     * Simulate all games for a day (quick sim).
     */
    public function simulateDay(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? 2024;
        $currentDate = $campaign->current_date->format('Y-m-d');
        $games = $this->seasonService->getGamesByDate($campaign->id, $year, $currentDate);

        // Filter to only incomplete games
        $games = array_filter($games, fn($g) => !$g['isComplete']);

        // Get all teams for this campaign
        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('id');

        $results = [];
        foreach ($games as $game) {
            $homeTeam = $teams[$game['homeTeamId']];
            $awayTeam = $teams[$game['awayTeamId']];

            // Simulate the game
            $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam);

            // Update game in JSON
            $this->seasonService->updateGame($campaign->id, $year, $game['id'], [
                'isComplete' => true,
                'homeScore' => $result['home_score'],
                'awayScore' => $result['away_score'],
                'boxScore' => $result['box_score'],
            ]);

            // Update standings
            $this->seasonService->updateStandingsAfterGame(
                $campaign->id,
                $year,
                $game['homeTeamId'],
                $game['awayTeamId'],
                $result['home_score'],
                $result['away_score'],
                $homeTeam->conference,
                $awayTeam->conference
            );

            // Update player stats
            $this->updatePlayerStats($campaign->id, $year, $result['box_score'], $homeTeam->id, $awayTeam->id);

            // Update coach stats
            $this->updateCoachStats($homeTeam->id, $awayTeam->id, $result['home_score'], $result['away_score'], $game['isPlayoff'] ?? false);

            $results[] = [
                'game_id' => $game['id'],
                'home_team' => $homeTeam->name,
                'away_team' => $awayTeam->name,
                'home_score' => $result['home_score'],
                'away_score' => $result['away_score'],
            ];
        }

        // Advance to next day
        $newDate = $campaign->current_date->addDay();
        $campaign->update(['current_date' => $newDate]);

        // Check for weekly evolution updates (every 7 days)
        $dayOfSeason = $campaign->current_date->diffInDays(Carbon::parse('2024-10-22'));
        if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
            $this->evolutionService->processWeeklyUpdates($campaign);
        }

        // Check for monthly evolution updates (every ~30 days)
        if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
            $this->evolutionService->processMonthlyDevelopment($campaign);
        }

        return response()->json([
            'message' => count($results) . ' games simulated',
            'results' => $results,
            'new_date' => $campaign->fresh()->current_date->format('Y-m-d'),
        ]);
    }

    /**
     * Get current standings.
     */
    public function standings(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? 2024;
        $standings = $this->seasonService->getStandings($campaign->id, $year);

        // Enrich with team data
        $teams = Team::where('campaign_id', $campaign->id)
            ->select('id', 'name', 'city', 'abbreviation', 'primary_color', 'secondary_color')
            ->get()
            ->keyBy('id');

        foreach (['east', 'west'] as $conference) {
            foreach ($standings[$conference] as &$standing) {
                $team = $teams[$standing['teamId']] ?? null;
                if ($team) {
                    $standing['team'] = $team;
                }
            }
        }

        return response()->json(['standings' => $standings]);
    }

    /**
     * Get league leaders (all player stats for the season).
     */
    public function leagueLeaders(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? 2024;
        $allPlayerStats = $this->seasonService->getAllPlayerStats($campaign->id, $year);

        // Get team info for each player
        $teams = Team::where('campaign_id', $campaign->id)
            ->select('id', 'name', 'abbreviation', 'primary_color')
            ->get()
            ->keyBy('id');

        // Format player stats with calculated per-game averages
        $leaders = [];
        foreach ($allPlayerStats as $playerId => $stats) {
            $gp = $stats['gamesPlayed'] ?? 0;
            if ($gp === 0) continue; // Skip players who haven't played

            $team = $teams[$stats['teamId']] ?? null;

            $leaders[] = [
                'playerId' => $playerId,
                'name' => $stats['playerName'] ?? 'Unknown',
                'teamId' => $stats['teamId'],
                'teamAbbreviation' => $team?->abbreviation ?? '???',
                'teamColor' => $team?->primary_color ?? '#6B7280',
                'gamesPlayed' => $gp,
                // Per game averages
                'ppg' => round(($stats['points'] ?? 0) / $gp, 1),
                'rpg' => round(($stats['rebounds'] ?? 0) / $gp, 1),
                'apg' => round(($stats['assists'] ?? 0) / $gp, 1),
                'spg' => round(($stats['steals'] ?? 0) / $gp, 1),
                'bpg' => round(($stats['blocks'] ?? 0) / $gp, 1),
                'topg' => round(($stats['turnovers'] ?? 0) / $gp, 1),
                'mpg' => round(($stats['minutesPlayed'] ?? 0) / $gp, 1),
                // Shooting percentages
                'fgPct' => ($stats['fieldGoalsAttempted'] ?? 0) > 0
                    ? round(($stats['fieldGoalsMade'] ?? 0) / $stats['fieldGoalsAttempted'] * 100, 1)
                    : 0,
                'threePct' => ($stats['threePointersAttempted'] ?? 0) > 0
                    ? round(($stats['threePointersMade'] ?? 0) / $stats['threePointersAttempted'] * 100, 1)
                    : 0,
                'ftPct' => ($stats['freeThrowsAttempted'] ?? 0) > 0
                    ? round(($stats['freeThrowsMade'] ?? 0) / $stats['freeThrowsAttempted'] * 100, 1)
                    : 0,
                // Totals (for context)
                'totalPoints' => $stats['points'] ?? 0,
                'totalRebounds' => $stats['rebounds'] ?? 0,
                'totalAssists' => $stats['assists'] ?? 0,
                'totalSteals' => $stats['steals'] ?? 0,
                'totalBlocks' => $stats['blocks'] ?? 0,
                // Shooting totals
                'fgm' => $stats['fieldGoalsMade'] ?? 0,
                'fga' => $stats['fieldGoalsAttempted'] ?? 0,
                'fg3m' => $stats['threePointersMade'] ?? 0,
                'fg3a' => $stats['threePointersAttempted'] ?? 0,
                'ftm' => $stats['freeThrowsMade'] ?? 0,
                'fta' => $stats['freeThrowsAttempted'] ?? 0,
            ];
        }

        // Sort by PPG descending by default
        usort($leaders, fn($a, $b) => $b['ppg'] <=> $a['ppg']);

        return response()->json(['leaders' => $leaders]);
    }

    /**
     * Start a quarter-by-quarter game simulation (Q1 only).
     */
    public function startGame(Request $request, Campaign $campaign, string $gameId): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? 2024;
        $game = $this->seasonService->getGame($campaign->id, $year, $gameId);

        if (!$game) {
            return response()->json(['message' => 'Game not found'], 404);
        }

        if ($game['isComplete']) {
            return response()->json(['message' => 'Game has already been played'], 400);
        }

        if ($game['isInProgress'] ?? false) {
            return response()->json(['message' => 'Game is already in progress. Use /continue endpoint.'], 400);
        }

        // Simulate all days between current_date and game_date (exclusive)
        // This ensures games are always in sync with the actual day
        $gameDate = Carbon::parse($game['gameDate']);
        $currentDate = $campaign->current_date;
        $simulatedDays = [];

        while ($currentDate->lt($gameDate)) {
            $dateStr = $currentDate->format('Y-m-d');
            $dayGames = $this->seasonService->getGamesByDate($campaign->id, $year, $dateStr);
            $dayGames = array_filter($dayGames, fn($g) => !$g['isComplete']);

            if (!empty($dayGames)) {
                $simulatedDays[] = $this->simulateDayGames($campaign, $year, $dayGames);
            }

            $currentDate = $currentDate->copy()->addDay();
        }

        // Update campaign date to the game date
        if (!$campaign->current_date->eq($gameDate)) {
            $campaign->update(['current_date' => $gameDate]);
        }

        $homeTeam = Team::find($game['homeTeamId']);
        $awayTeam = Team::find($game['awayTeamId']);

        // Get user's saved starting lineup if this is their team
        $userLineup = null;
        if ($game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id) {
            $userLineup = $campaign->settings['lineup']['starters'] ?? null;
        }

        // Start game and simulate Q1
        $result = $this->simulationService->startGame($campaign, $game, $homeTeam, $awayTeam, $userLineup);

        // Save game state to JSON
        $this->seasonService->updateGame($campaign->id, $year, $gameId, [
            'isInProgress' => true,
            'currentQuarter' => 1,
            'gameState' => $result['gameState'],
        ]);

        $response = [
            'message' => 'Quarter 1 complete',
            'quarter' => 1,
            'isGameComplete' => false,
            ...$result['quarterResult'],
        ];

        // Include info about simulated days if any
        if (!empty($simulatedDays)) {
            $response['simulated_days'] = $simulatedDays;
        }

        return response()->json($response);
    }

    /**
     * Continue a quarter-by-quarter game simulation (Q2+).
     * Accepts optional lineup and coaching style adjustments.
     */
    public function continueGame(Request $request, Campaign $campaign, string $gameId): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? 2024;
        $game = $this->seasonService->getGame($campaign->id, $year, $gameId);

        if (!$game) {
            return response()->json(['message' => 'Game not found'], 404);
        }

        if ($game['isComplete']) {
            return response()->json(['message' => 'Game has already been played'], 400);
        }

        if (!($game['isInProgress'] ?? false) || !isset($game['gameState'])) {
            return response()->json(['message' => 'Game not in progress. Use /start endpoint first.'], 400);
        }

        // Get user adjustments for next quarter
        $adjustments = [];
        if ($request->has('home_lineup')) {
            $adjustments['homeLineup'] = $request->input('home_lineup');
        }
        if ($request->has('away_lineup')) {
            $adjustments['awayLineup'] = $request->input('away_lineup');
        }
        if ($request->has('offensive_style')) {
            $adjustments['offensiveStyle'] = $request->input('offensive_style');
        }
        if ($request->has('defensive_style')) {
            $adjustments['defensiveStyle'] = $request->input('defensive_style');
        }

        // Continue simulation
        $result = $this->simulationService->continueGame(
            $game['gameState'],
            !empty($adjustments) ? $adjustments : null
        );

        if ($result['isComplete']) {
            // Game is complete - finalize
            $homeTeam = Team::find($game['homeTeamId']);
            $awayTeam = Team::find($game['awayTeamId']);

            $finalResult = $result['finalResult'];

            // Update game in JSON (remove gameState, mark complete)
            $this->seasonService->updateGame($campaign->id, $year, $gameId, [
                'isComplete' => true,
                'isInProgress' => false,
                'gameState' => null,
                'homeScore' => $finalResult['home_score'],
                'awayScore' => $finalResult['away_score'],
                'boxScore' => $finalResult['box_score'],
            ]);

            // Update standings
            $this->seasonService->updateStandingsAfterGame(
                $campaign->id,
                $year,
                $game['homeTeamId'],
                $game['awayTeamId'],
                $finalResult['home_score'],
                $finalResult['away_score'],
                $homeTeam->conference,
                $awayTeam->conference
            );

            // Update player stats
            $this->updatePlayerStats(
                $campaign->id,
                $year,
                $finalResult['box_score'],
                $homeTeam->id,
                $awayTeam->id
            );

            // Update coach stats
            $this->updateCoachStats($homeTeam->id, $awayTeam->id, $finalResult['home_score'], $finalResult['away_score'], $game['isPlayoff'] ?? false);

            // Process evolution
            $this->evolutionService->processPostGameFromData(
                $campaign,
                $game,
                $finalResult['home_score'],
                $finalResult['away_score'],
                [
                    'home' => $finalResult['box_score']['home'],
                    'away' => $finalResult['box_score']['away'],
                ]
            );

            // Simulate remaining games on this day
            $gameDate = $game['gameDate'];
            $allGames = $this->seasonService->getGamesByDate($campaign->id, $year, $gameDate);

            foreach ($allGames as $otherGame) {
                // Skip the game we just completed and any already complete games
                if ($otherGame['id'] === $gameId || ($otherGame['isComplete'] ?? false)) {
                    continue;
                }

                // Simulate this game
                $otherHomeTeam = Team::find($otherGame['homeTeamId']);
                $otherAwayTeam = Team::find($otherGame['awayTeamId']);

                if (!$otherHomeTeam || !$otherAwayTeam) {
                    continue;
                }

                $simResult = $this->simulationService->simulateFromData(
                    $campaign,
                    $otherGame,
                    $otherHomeTeam,
                    $otherAwayTeam
                );

                // Update game in storage
                $this->seasonService->updateGame($campaign->id, $year, $otherGame['id'], [
                    'isComplete' => true,
                    'homeScore' => $simResult['home_score'],
                    'awayScore' => $simResult['away_score'],
                    'boxScore' => $simResult['box_score'],
                ]);

                // Update standings
                $this->seasonService->updateStandingsAfterGame(
                    $campaign->id,
                    $year,
                    $otherGame['homeTeamId'],
                    $otherGame['awayTeamId'],
                    $simResult['home_score'],
                    $simResult['away_score'],
                    $otherHomeTeam->conference,
                    $otherAwayTeam->conference
                );

                // Update player stats
                $this->updatePlayerStats(
                    $campaign->id,
                    $year,
                    $simResult['box_score'],
                    $otherHomeTeam->id,
                    $otherAwayTeam->id
                );

                // Update coach stats
                $this->updateCoachStats($otherHomeTeam->id, $otherAwayTeam->id, $simResult['home_score'], $simResult['away_score'], $otherGame['isPlayoff'] ?? false);
            }

            // Advance campaign date
            $campaign->update(['current_date' => Carbon::parse($game['gameDate'])->addDay()]);

            return response()->json([
                'message' => 'Game complete',
                'quarter' => $result['quarterResult']['quarter'],
                'isGameComplete' => true,
                'result' => $finalResult,
                ...$result['quarterResult'],
            ]);
        }

        // Game continues - save updated state
        $this->seasonService->updateGame($campaign->id, $year, $gameId, [
            'currentQuarter' => $result['quarterResult']['quarter'],
            'gameState' => $result['gameState'],
        ]);

        return response()->json([
            'message' => "Quarter {$result['quarterResult']['quarter']} complete",
            'quarter' => $result['quarterResult']['quarter'],
            'isGameComplete' => false,
            ...$result['quarterResult'],
        ]);
    }

    /**
     * Update player stats after a game (both season and career stats).
     */
    private function updatePlayerStats(int $campaignId, int $year, array $boxScore, int $homeTeamId, int $awayTeamId): void
    {
        // Get starters for determining if player started
        $homeStarters = array_slice($boxScore['home'] ?? [], 0, 5);
        $awayStarters = array_slice($boxScore['away'] ?? [], 0, 5);
        $homeStarterIds = array_column($homeStarters, 'player_id');
        $awayStarterIds = array_column($awayStarters, 'player_id');

        // Update home team player stats
        foreach ($boxScore['home'] ?? [] as $playerStats) {
            $playerId = $playerStats['player_id'] ?? $playerStats['playerId'] ?? null;
            $playerName = $playerStats['name'] ?? 'Unknown';

            if ($playerId) {
                // Update season stats (JSON file)
                $this->seasonService->updatePlayerStats(
                    $campaignId,
                    $year,
                    $playerId,
                    $playerName,
                    $homeTeamId,
                    $playerStats
                );

                // Update career stats (database) - only for DB players
                $player = Player::find($playerId);
                if ($player) {
                    $started = in_array($playerId, $homeStarterIds);
                    $player->recordGameStats($playerStats, $started);
                }
            }
        }

        // Update away team player stats
        foreach ($boxScore['away'] ?? [] as $playerStats) {
            $playerId = $playerStats['player_id'] ?? $playerStats['playerId'] ?? null;
            $playerName = $playerStats['name'] ?? 'Unknown';

            if ($playerId) {
                // Update season stats (JSON file)
                $this->seasonService->updatePlayerStats(
                    $campaignId,
                    $year,
                    $playerId,
                    $playerName,
                    $awayTeamId,
                    $playerStats
                );

                // Update career stats (database) - only for DB players
                $player = Player::find($playerId);
                if ($player) {
                    $started = in_array($playerId, $awayStarterIds);
                    $player->recordGameStats($playerStats, $started);
                }
            }
        }
    }

    /**
     * Update coach stats after a game.
     */
    private function updateCoachStats(int $homeTeamId, int $awayTeamId, int $homeScore, int $awayScore, bool $isPlayoff = false): void
    {
        $homeWon = $homeScore > $awayScore;

        // Update home team coach
        $homeCoach = Coach::where('team_id', $homeTeamId)->first();
        if ($homeCoach) {
            $homeCoach->recordGameResult($homeWon, $isPlayoff);
        }

        // Update away team coach
        $awayCoach = Coach::where('team_id', $awayTeamId)->first();
        if ($awayCoach) {
            $awayCoach->recordGameResult(!$homeWon, $isPlayoff);
        }
    }

    /**
     * Simulate all games for a given day (helper method).
     * Returns summary of simulated games.
     */
    private function simulateDayGames(Campaign $campaign, int $year, array $games): array
    {
        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('id');
        $results = [];

        foreach ($games as $game) {
            $homeTeam = $teams[$game['homeTeamId']] ?? null;
            $awayTeam = $teams[$game['awayTeamId']] ?? null;

            if (!$homeTeam || !$awayTeam) {
                continue;
            }

            // Simulate the game
            $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam);

            // Update game in JSON
            $this->seasonService->updateGame($campaign->id, $year, $game['id'], [
                'isComplete' => true,
                'homeScore' => $result['home_score'],
                'awayScore' => $result['away_score'],
                'boxScore' => $result['box_score'],
            ]);

            // Update standings
            $this->seasonService->updateStandingsAfterGame(
                $campaign->id,
                $year,
                $game['homeTeamId'],
                $game['awayTeamId'],
                $result['home_score'],
                $result['away_score'],
                $homeTeam->conference,
                $awayTeam->conference
            );

            // Update player stats
            $this->updatePlayerStats($campaign->id, $year, $result['box_score'], $homeTeam->id, $awayTeam->id);

            // Update coach stats
            $this->updateCoachStats($homeTeam->id, $awayTeam->id, $result['home_score'], $result['away_score'], $game['isPlayoff'] ?? false);

            $results[] = [
                'game_id' => $game['id'],
                'home_team' => $homeTeam->name,
                'away_team' => $awayTeam->name,
                'home_score' => $result['home_score'],
                'away_score' => $result['away_score'],
            ];
        }

        // Check for weekly/monthly evolution updates
        $dayOfSeason = $campaign->current_date->diffInDays(Carbon::parse('2024-10-22'));
        if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
            $this->evolutionService->processWeeklyUpdates($campaign);
        }
        if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
            $this->evolutionService->processMonthlyDevelopment($campaign);
        }

        return [
            'date' => $games[0]['gameDate'] ?? null,
            'games_count' => count($results),
            'results' => $results,
        ];
    }
}
