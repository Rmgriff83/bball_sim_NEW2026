<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Coach;
use App\Models\Player;
use App\Models\Team;
use App\Services\CampaignSeasonService;
use App\Services\GameSimulationService;
use App\Services\AILineupService;
use App\Services\PlayerEvolution\PlayerEvolutionService;
use App\Services\RewardService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GameController extends Controller
{
    public function __construct(
        private CampaignSeasonService $seasonService,
        private GameSimulationService $simulationService,
        private PlayerEvolutionService $evolutionService,
        private AILineupService $aiLineupService,
        private RewardService $rewardService
    ) {}

    /**
     * Get all games for a campaign's current season.
     */
    public function index(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? 2025;
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

        $year = $campaign->currentSeason?->year ?? 2025;
        $game = $this->seasonService->getGame($campaign->id, $year, $gameId);

        if (!$game) {
            return response()->json(['message' => 'Game not found'], 404);
        }

        // Get team info
        $homeTeam = Team::find($game['homeTeamId']);
        $awayTeam = Team::find($game['awayTeamId']);

        // For in-progress games, get scores from gameState
        $homeScore = $game['homeScore'];
        $awayScore = $game['awayScore'];
        if (($game['isInProgress'] ?? false) && isset($game['gameState'])) {
            $homeScore = $game['gameState']['homeScore'] ?? 0;
            $awayScore = $game['gameState']['awayScore'] ?? 0;
        }

        // Determine if this is the user's game
        $isUserGame = $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id;

        // Get news events for this game date (for completed games)
        $gameNews = [];
        if ($game['isComplete']) {
            $gameNews = $campaign->newsEvents()
                ->where('game_date', $game['gameDate'])
                ->where(function ($query) use ($homeTeam, $awayTeam) {
                    $query->whereIn('team_id', [$homeTeam->id, $awayTeam->id])
                        ->orWhereNull('team_id');
                })
                ->orderBy('created_at', 'desc')
                ->get()
                ->map(fn($news) => [
                    'id' => $news->id,
                    'event_type' => $news->event_type,
                    'headline' => $news->headline,
                    'body' => $news->body,
                    'player_id' => $news->player_id,
                    'team_id' => $news->team_id,
                ])
                ->toArray();
        }

        return response()->json([
            'game' => [
                'id' => $game['id'],
                'home_team' => $homeTeam,
                'away_team' => $awayTeam,
                'game_date' => $game['gameDate'],
                'home_score' => $homeScore,
                'away_score' => $awayScore,
                'is_complete' => $game['isComplete'],
                'is_in_progress' => $game['isInProgress'] ?? false,
                'current_quarter' => $game['currentQuarter'] ?? null,
                'is_playoff' => $game['isPlayoff'],
                'is_user_game' => $isUserGame,
                'box_score' => $game['boxScore'],
                'quarter_scores' => $game['quarterScores'] ?? null,
                'evolution' => $game['evolution'] ?? null,
                'rewards' => $game['rewards'] ?? null,
                'news' => $gameNews,
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

        // Initialize AI team lineups if not already set
        $this->aiLineupService->initializeAllTeamLineups($campaign);

        // Get simulation mode (animated or quick)
        $mode = $request->input('mode', 'animated');

        // Future: lineup and playbook params (placeholder for now)
        $lineup = $request->input('lineup', null);
        $playbook = $request->input('playbook', null);

        $year = $campaign->currentSeason?->year ?? 2025;
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

        // Get user's saved starting lineup if this is their game
        $userLineup = null;
        if ($game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id) {
            $userLineup = $campaign->settings['lineup']['starters'] ?? null;
        }

        // Simulate the game
        $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam, $userLineup);

        // Update game in JSON (this is the user's game since they triggered it)
        $this->seasonService->updateGame($campaign->id, $year, $gameId, [
            'isComplete' => true,
            'homeScore' => $result['home_score'],
            'awayScore' => $result['away_score'],
            'boxScore' => $result['box_score'],
            'quarterScores' => $result['quarter_scores'] ?? null,
            'evolution' => $result['evolution'] ?? null,
            'rewards' => $result['rewards'] ?? null,
        ], true);

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

        // Initialize AI team lineups if not already set
        $this->aiLineupService->initializeAllTeamLineups($campaign);

        $year = $campaign->currentSeason?->year ?? 2025;
        $currentDate = $campaign->current_date->format('Y-m-d');
        $games = $this->seasonService->getGamesByDate($campaign->id, $year, $currentDate);

        // Filter to only incomplete games
        $games = array_filter($games, fn($g) => !$g['isComplete']);

        // Get all teams for this campaign
        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('id');

        // Get user's saved starting lineup
        $userLineup = $campaign->settings['lineup']['starters'] ?? null;

        $results = [];
        foreach ($games as $game) {
            $homeTeam = $teams[$game['homeTeamId']];
            $awayTeam = $teams[$game['awayTeamId']];

            // Determine if this is the user's game and pass their lineup
            $isUserGame = $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id;
            $gameLineup = $isUserGame ? $userLineup : null;

            // Simulate the game
            $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam, $gameLineup);

            // Update game in JSON
            $isUserGame = $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id;
            $this->seasonService->updateGame($campaign->id, $year, $game['id'], [
                'isComplete' => true,
                'homeScore' => $result['home_score'],
                'awayScore' => $result['away_score'],
                'boxScore' => $result['box_score'],
                'quarterScores' => $result['quarter_scores'] ?? null,
            ], $isUserGame);

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
                'home_team' => [
                    'id' => $homeTeam->id,
                    'name' => $homeTeam->name,
                    'abbreviation' => $homeTeam->abbreviation,
                ],
                'away_team' => [
                    'id' => $awayTeam->id,
                    'name' => $awayTeam->name,
                    'abbreviation' => $awayTeam->abbreviation,
                ],
                'home_score' => $result['home_score'],
                'away_score' => $result['away_score'],
                'is_user_game' => $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id,
            ];
        }

        // Advance to next day
        $newDate = $campaign->current_date->addDay();
        $campaign->update(['current_date' => $newDate]);

        // Check for weekly evolution updates (every 7 days)
        $dayOfSeason = $campaign->current_date->diffInDays(Carbon::parse('2025-10-21'));
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

        $year = $campaign->currentSeason?->year ?? 2025;
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

        $year = $campaign->currentSeason?->year ?? 2025;
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

        // Initialize AI team lineups if not already set
        $this->aiLineupService->initializeAllTeamLineups($campaign);

        $year = $campaign->currentSeason?->year ?? 2025;
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
        // Allow override from request for pre-game lineup changes
        $userLineup = null;
        $isUserHome = $game['homeTeamId'] === $campaign->team_id;
        $isUserAway = $game['awayTeamId'] === $campaign->team_id;

        if ($isUserHome || $isUserAway) {
            // Use request lineup if provided, otherwise use saved
            if ($isUserHome && $request->has('home_lineup')) {
                $userLineup = $request->input('home_lineup');
            } elseif ($isUserAway && $request->has('away_lineup')) {
                $userLineup = $request->input('away_lineup');
            } else {
                $userLineup = $campaign->settings['lineup']['starters'] ?? null;
            }
        }

        // Get coaching adjustments from request, falling back to saved campaign settings
        $coachingAdjustments = [];
        $settingsToSave = [];

        if ($request->has('offensive_style')) {
            $coachingAdjustments['offensiveStyle'] = $request->input('offensive_style');
            $settingsToSave['offensive_style'] = $request->input('offensive_style');
        } elseif (isset($campaign->settings['offensive_style'])) {
            $coachingAdjustments['offensiveStyle'] = $campaign->settings['offensive_style'];
        }

        if ($request->has('defensive_style')) {
            $coachingAdjustments['defensiveStyle'] = $request->input('defensive_style');
            $settingsToSave['defensive_style'] = $request->input('defensive_style');
        } elseif (isset($campaign->settings['defensive_style'])) {
            $coachingAdjustments['defensiveStyle'] = $campaign->settings['defensive_style'];
        }

        // Save updated coaching styles to campaign settings
        if (!empty($settingsToSave)) {
            $campaign->update([
                'settings' => array_merge($campaign->settings ?? [], $settingsToSave)
            ]);
        }

        // Start game and simulate Q1
        $result = $this->simulationService->startGame($campaign, $game, $homeTeam, $awayTeam, $userLineup, $coachingAdjustments);

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

        $year = $campaign->currentSeason?->year ?? 2025;
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
        $settingsToSave = [];

        if ($request->has('home_lineup')) {
            $adjustments['homeLineup'] = $request->input('home_lineup');
        }
        if ($request->has('away_lineup')) {
            $adjustments['awayLineup'] = $request->input('away_lineup');
        }

        // Get coaching styles from request, falling back to saved campaign settings
        if ($request->has('offensive_style')) {
            $adjustments['offensiveStyle'] = $request->input('offensive_style');
            $settingsToSave['offensive_style'] = $request->input('offensive_style');
        } elseif (isset($campaign->settings['offensive_style'])) {
            $adjustments['offensiveStyle'] = $campaign->settings['offensive_style'];
        }

        if ($request->has('defensive_style')) {
            $adjustments['defensiveStyle'] = $request->input('defensive_style');
            $settingsToSave['defensive_style'] = $request->input('defensive_style');
        } elseif (isset($campaign->settings['defensive_style'])) {
            $adjustments['defensiveStyle'] = $campaign->settings['defensive_style'];
        }

        // Save updated coaching styles to campaign settings
        if (!empty($settingsToSave)) {
            $campaign->update([
                'settings' => array_merge($campaign->settings ?? [], $settingsToSave)
            ]);
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

            // Update game in JSON (remove gameState, mark complete) - this is user's game
            $this->seasonService->updateGame($campaign->id, $year, $gameId, [
                'isComplete' => true,
                'isInProgress' => false,
                'gameState' => null,
                'homeScore' => $finalResult['home_score'],
                'awayScore' => $finalResult['away_score'],
                'boxScore' => $finalResult['box_score'],
                'quarterScores' => $finalResult['quarter_scores'] ?? null,
            ], true);

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

            // Process evolution and capture summary
            $evolutionSummary = null;
            try {
                $evolutionSummary = $this->evolutionService->processPostGameFromData(
                    $campaign,
                    $game,
                    $finalResult['home_score'],
                    $finalResult['away_score'],
                    [
                        'home' => $finalResult['box_score']['home'],
                        'away' => $finalResult['box_score']['away'],
                    ]
                );
            } catch (\Exception $e) {
                \Log::error('Evolution processing failed: ' . $e->getMessage(), [
                    'game_id' => $gameId,
                    'trace' => $e->getTraceAsString(),
                ]);
            }

            // Process synergy rewards for user's team
            $rewardSummary = null;
            if ($game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id) {
                $isHome = $game['homeTeamId'] === $campaign->team_id;
                $didWin = ($isHome && $finalResult['home_score'] > $finalResult['away_score'])
                    || (!$isHome && $finalResult['away_score'] > $finalResult['home_score']);

                $synergiesActivated = $finalResult['synergies_activated'] ?? [];
                $userSynergies = $isHome
                    ? ($synergiesActivated['home'] ?? 0)
                    : ($synergiesActivated['away'] ?? 0);

                if ($userSynergies > 0) {
                    $campaign->loadMissing('user.profile');
                    if ($campaign->user && $campaign->user->profile) {
                        $tokensPerSynergy = $didWin ? 2 : 1;
                        $tokensAwarded = $campaign->user->profile->awardSynergyTokens($userSynergies, $tokensPerSynergy);
                        $rewardSummary = [
                            'synergies_activated' => $userSynergies,
                            'tokens_awarded' => $tokensAwarded,
                            'win_bonus_applied' => $didWin,
                        ];
                    }
                }
            }

            // Update game with evolution and rewards data
            $this->seasonService->updateGame($campaign->id, $year, $gameId, [
                'evolution' => $evolutionSummary,
                'rewards' => $rewardSummary,
            ], true);

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

                // Update game in storage (AI vs AI game, use compact box score)
                $this->seasonService->updateGame($campaign->id, $year, $otherGame['id'], [
                    'isComplete' => true,
                    'homeScore' => $simResult['home_score'],
                    'awayScore' => $simResult['away_score'],
                    'boxScore' => $simResult['box_score'],
                    'quarterScores' => $simResult['quarter_scores'] ?? null,
                ], false);

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
                'result' => array_merge($finalResult, [
                    'evolution' => $evolutionSummary,
                ]),
                'rewards' => $rewardSummary,
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
                // Update season stats (JSON file) - batched, not saved yet
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
                // Update season stats (JSON file) - batched, not saved yet
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

        // Flush all batched player stat updates to storage in one write
        $this->seasonService->flushSeason($campaignId, $year);
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

        // Get user's saved starting lineup for their games
        $userLineup = $campaign->settings['lineup']['starters'] ?? null;

        foreach ($games as $game) {
            $homeTeam = $teams[$game['homeTeamId']] ?? null;
            $awayTeam = $teams[$game['awayTeamId']] ?? null;

            if (!$homeTeam || !$awayTeam) {
                continue;
            }

            // Determine if this is the user's game and pass their lineup
            $isUserGame = $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id;
            $gameLineup = $isUserGame ? $userLineup : null;

            // Simulate the game
            $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam, $gameLineup);

            // Update game in JSON
            $isUserGame = $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id;
            $this->seasonService->updateGame($campaign->id, $year, $game['id'], [
                'isComplete' => true,
                'homeScore' => $result['home_score'],
                'awayScore' => $result['away_score'],
                'boxScore' => $result['box_score'],
                'quarterScores' => $result['quarter_scores'] ?? null,
            ], $isUserGame);

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
        $dayOfSeason = $campaign->current_date->diffInDays(Carbon::parse('2025-10-21'));
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

    /**
     * Get preview data for simulating to next user game.
     */
    public function simulateToNextGamePreview(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? 2025;
        $preview = $this->seasonService->getSimulateToNextGamePreview(
            $campaign->id,
            $year,
            $campaign->team_id,
            $campaign->current_date
        );

        if (!$preview) {
            return response()->json([
                'hasNextGame' => false,
                'message' => 'No upcoming games found',
            ]);
        }

        // Get team info for the user's next game
        $nextUserGame = $preview['nextUserGame'];
        $homeTeam = Team::find($nextUserGame['homeTeamId']);
        $awayTeam = Team::find($nextUserGame['awayTeamId']);

        // Enrich games by date with team info
        $teams = Team::where('campaign_id', $campaign->id)
            ->select('id', 'name', 'abbreviation', 'primary_color')
            ->get()
            ->keyBy('id');

        $enrichedGamesByDate = [];
        foreach ($preview['gamesByDate'] as $date => $games) {
            $enrichedGames = [];
            foreach ($games as $game) {
                $enrichedGames[] = [
                    'id' => $game['id'],
                    'homeTeam' => [
                        'id' => $game['homeTeamId'],
                        'abbreviation' => $teams[$game['homeTeamId']]->abbreviation ?? '???',
                        'name' => $teams[$game['homeTeamId']]->name ?? 'Unknown',
                        'color' => $teams[$game['homeTeamId']]->primary_color ?? '#666',
                    ],
                    'awayTeam' => [
                        'id' => $game['awayTeamId'],
                        'abbreviation' => $teams[$game['awayTeamId']]->abbreviation ?? '???',
                        'name' => $teams[$game['awayTeamId']]->name ?? 'Unknown',
                        'color' => $teams[$game['awayTeamId']]->primary_color ?? '#666',
                    ],
                ];
            }
            $enrichedGamesByDate[$date] = $enrichedGames;
        }

        // Check if user's next game is today
        $isGameToday = $nextUserGame['gameDate'] === $campaign->current_date->format('Y-m-d');

        return response()->json([
            'hasNextGame' => true,
            'isGameToday' => $isGameToday,
            'nextUserGame' => [
                'id' => $nextUserGame['id'],
                'gameDate' => $nextUserGame['gameDate'],
                'homeTeam' => [
                    'id' => $homeTeam->id,
                    'name' => $homeTeam->name,
                    'abbreviation' => $homeTeam->abbreviation,
                    'color' => $homeTeam->primary_color,
                ],
                'awayTeam' => [
                    'id' => $awayTeam->id,
                    'name' => $awayTeam->name,
                    'abbreviation' => $awayTeam->abbreviation,
                    'color' => $awayTeam->primary_color,
                ],
                'isHome' => $nextUserGame['homeTeamId'] === $campaign->team_id,
            ],
            'daysToSimulate' => $preview['daysToSimulate'],
            'totalGamesToSimulate' => $preview['totalGamesToSimulate'],
            'gamesByDate' => $enrichedGamesByDate,
        ]);
    }

    /**
     * Simulate all games up to and including the user's next game.
     * If excludeUserGame is true, only simulate games BEFORE the user's game (for live play from preview page).
     */
    public function simulateToNextGame(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $excludeUserGame = $request->boolean('excludeUserGame', false);

        // Initialize AI team lineups if not already set
        $this->aiLineupService->initializeAllTeamLineups($campaign);

        $year = $campaign->currentSeason?->year ?? 2025;

        // Get user's next game
        $nextUserGame = $this->seasonService->getNextTeamGame($campaign->id, $year, $campaign->team_id);
        if (!$nextUserGame) {
            return response()->json(['message' => 'No upcoming games found'], 400);
        }

        $gameDate = Carbon::parse($nextUserGame['gameDate']);
        $currentDate = $campaign->current_date->copy();
        $allSimulatedGames = [];

        // Simulate all days between current date and game date (exclusive)
        while ($currentDate->lt($gameDate)) {
            $dateStr = $currentDate->format('Y-m-d');
            $dayGames = $this->seasonService->getGamesByDate($campaign->id, $year, $dateStr);
            $dayGames = array_filter($dayGames, fn($g) => !$g['isComplete']);

            if (!empty($dayGames)) {
                $dayResult = $this->simulateDayGames($campaign, $year, $dayGames);
                $allSimulatedGames[] = $dayResult;
            }

            $currentDate = $currentDate->copy()->addDay();
        }

        // Get all teams for the user's game date
        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('id');

        // Get all games on the user's game date
        $gameDateStr = $gameDate->format('Y-m-d');
        $gameDateGames = $this->seasonService->getGamesByDate($campaign->id, $year, $gameDateStr);
        $gameDateGames = array_filter($gameDateGames, fn($g) => !$g['isComplete']);

        $userGameResult = null;
        $gameDateResults = [];

        // Get user's saved starting lineup
        $userLineup = $campaign->settings['lineup']['starters'] ?? null;

        foreach ($gameDateGames as $game) {
            $homeTeam = $teams[$game['homeTeamId']] ?? null;
            $awayTeam = $teams[$game['awayTeamId']] ?? null;

            if (!$homeTeam || !$awayTeam) {
                continue;
            }

            // Determine if this is the user's game
            $isUserGame = $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id;

            // Skip user's game if excludeUserGame is true (user wants to play it live)
            if ($isUserGame && $excludeUserGame) {
                continue;
            }

            $gameLineup = $isUserGame ? $userLineup : null;

            // Simulate the game
            $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam, $gameLineup);

            // Update game in JSON (include evolution/rewards only for user's game)
            $isUserGame = $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id;
            $this->seasonService->updateGame($campaign->id, $year, $game['id'], [
                'isComplete' => true,
                'homeScore' => $result['home_score'],
                'awayScore' => $result['away_score'],
                'boxScore' => $result['box_score'],
                'quarterScores' => $result['quarter_scores'] ?? null,
                'evolution' => $isUserGame ? ($result['evolution'] ?? null) : null,
                'rewards' => $isUserGame ? ($result['rewards'] ?? null) : null,
            ], $isUserGame);

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

            $userTeamId = (int) $campaign->team_id;
            $homeTeamId = (int) $game['homeTeamId'];
            $awayTeamId = (int) $game['awayTeamId'];
            $isUserGame = $homeTeamId === $userTeamId || $awayTeamId === $userTeamId;
            $isUserHome = $homeTeamId === $userTeamId;

            $gameResult = [
                'game_id' => $game['id'],
                'home_team' => [
                    'id' => $homeTeam->id,
                    'name' => $homeTeam->name,
                    'abbreviation' => $homeTeam->abbreviation,
                ],
                'away_team' => [
                    'id' => $awayTeam->id,
                    'name' => $awayTeam->name,
                    'abbreviation' => $awayTeam->abbreviation,
                ],
                'home_score' => $result['home_score'],
                'away_score' => $result['away_score'],
                'is_user_game' => $isUserGame,
                'is_user_home' => $isUserGame ? $isUserHome : null,
            ];

            // Include evolution and rewards for user's game
            if ($isUserGame) {
                $gameResult['evolution'] = $result['evolution'] ?? null;
                $gameResult['rewards'] = $result['rewards'] ?? null;
                $gameResult['box_score'] = $result['box_score'] ?? null;
                $userGameResult = $gameResult;
            }

            $gameDateResults[] = $gameResult;
        }

        // Add game date results to all simulated games
        if (!empty($gameDateResults)) {
            $allSimulatedGames[] = [
                'date' => $gameDateStr,
                'games_count' => count($gameDateResults),
                'results' => $gameDateResults,
            ];
        }

        // Advance date: if excluding user game, stay on game date; otherwise advance past it
        if ($excludeUserGame) {
            // Move to the game date (user will play their game there)
            $newDate = $gameDate->copy();
            $campaign->update(['current_date' => $newDate]);
        } else {
            // Advance to next day (all games including user's were simulated)
            $newDate = $gameDate->copy()->addDay();
            $campaign->update(['current_date' => $newDate]);

            // Check for weekly/monthly evolution updates (only when advancing past game date)
            $dayOfSeason = $newDate->diffInDays(Carbon::parse('2025-10-21'));
            if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                $this->evolutionService->processWeeklyUpdates($campaign);
            }
            if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                $this->evolutionService->processMonthlyDevelopment($campaign);
            }
        }

        return response()->json([
            'message' => 'Simulated to next game successfully',
            'userGameResult' => $userGameResult,
            'simulatedDays' => $allSimulatedGames,
            'totalGamesSimulated' => array_sum(array_map(fn($d) => $d['games_count'], $allSimulatedGames)),
            'newDate' => $campaign->fresh()->current_date->format('Y-m-d'),
        ]);
    }
}
