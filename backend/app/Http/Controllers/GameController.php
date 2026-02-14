<?php

namespace App\Http\Controllers;

use App\Jobs\SimulateGameJob;
use App\Models\Campaign;
use App\Models\Coach;
use App\Models\Player;
use App\Models\SimulationResult;
use App\Models\Team;
use App\Services\CampaignSeasonService;
use App\Services\GameSimulationService;
use App\Services\AILineupService;
use App\Services\AITradeProposalService;
use App\Services\AllStarService;
use App\Services\PlayoffService;
use App\Services\PlayerEvolution\PlayerEvolutionService;
use App\Services\RewardService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Log;

class GameController extends Controller
{
    public function __construct(
        private CampaignSeasonService $seasonService,
        private GameSimulationService $simulationService,
        private PlayerEvolutionService $evolutionService,
        private AILineupService $aiLineupService,
        private RewardService $rewardService,
        private PlayoffService $playoffService
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
            $isInProgress = $game['isInProgress'] ?? false;

            // For in-progress games, get current scores from gameState
            $homeScore = $game['homeScore'];
            $awayScore = $game['awayScore'];
            if ($isInProgress && isset($game['gameState'])) {
                $homeScore = $game['gameState']['homeScore'] ?? 0;
                $awayScore = $game['gameState']['awayScore'] ?? 0;
            }

            return [
                'id' => $game['id'],
                'home_team' => $teams[$game['homeTeamId']] ?? null,
                'away_team' => $teams[$game['awayTeamId']] ?? null,
                'game_date' => $game['gameDate'],
                'home_score' => $homeScore,
                'away_score' => $awayScore,
                'is_complete' => $game['isComplete'],
                'is_in_progress' => $isInProgress,
                'current_quarter' => $game['currentQuarter'] ?? null,
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

        // Guard: reject if a simulation batch is still running
        if ($campaign->simulation_batch_id) {
            $existingBatch = Bus::findBatch($campaign->simulation_batch_id);
            if ($existingBatch && !$existingBatch->finished()) {
                return response()->json([
                    'message' => 'A simulation is already in progress',
                    'batchId' => $campaign->simulation_batch_id,
                ], 409);
            }
            // Batch finished but wasn't cleaned up - clear it
            $campaign->update(['simulation_batch_id' => null]);
        }

        // Initialize AI team lineups if not already set, then refresh based on fatigue
        $this->aiLineupService->initializeAllTeamLineups($campaign);
        $this->aiLineupService->refreshAllTeamLineups($campaign);

        // Get simulation mode (animated or quick)
        $mode = $request->input('mode', 'animated');

        $year = $campaign->currentSeason?->year ?? 2025;
        $game = $this->seasonService->getGame($campaign->id, $year, $gameId);

        if (!$game) {
            return response()->json(['message' => 'Game not found'], 404);
        }

        if ($game['isComplete']) {
            return response()->json(['message' => 'Game has already been played'], 400);
        }

        // Get teams
        $homeTeam = Team::find($game['homeTeamId']);
        $awayTeam = Team::find($game['awayTeamId']);

        // Get user's saved starting lineup if this is their game
        $userLineup = null;
        if ($game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id) {
            $userLineup = $campaign->settings['lineup']['starters'] ?? null;
        }

        // Simulate the user's game synchronously
        $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam, $userLineup);

        // Update game in JSON
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

        // Process playoff game completion if applicable
        $playoffUpdate = null;
        if ($game['isPlayoff'] ?? false) {
            $playoffUpdate = $this->processPlayoffGameCompletion($campaign, $game, $result['home_score'], $result['away_score']);
        }

        // Collect pre-game sync games (days between current_date and game_date)
        $gameDate = Carbon::parse($game['gameDate']);
        $currentDate = $campaign->current_date->copy();
        $preGameJobs = [];
        $teamsPerDay = [];

        while ($currentDate->lt($gameDate)) {
            $dateStr = $currentDate->format('Y-m-d');
            $dayGames = $this->seasonService->getGamesByDate($campaign->id, $year, $dateStr);
            $dayGames = array_filter($dayGames, fn($g) => !$g['isComplete']);

            $dayTeamIds = [];
            foreach ($dayGames as $dayGame) {
                $dayTeamIds[] = $dayGame['homeTeamId'];
                $dayTeamIds[] = $dayGame['awayTeamId'];
                $preGameJobs[] = new SimulateGameJob(
                    $campaign->id,
                    $year,
                    $dayGame,
                    $dayGame['homeTeamId'],
                    $dayGame['awayTeamId'],
                    false,
                    null,
                    $dateStr
                );
            }

            $teamsPerDay[] = $dayTeamIds;
            $currentDate = $currentDate->copy()->addDay();
        }

        // Game day: the user's game teams played
        $teamsPerDay[] = [$game['homeTeamId'], $game['awayTeamId']];

        $batchId = null;

        if (!empty($preGameJobs)) {
            $campaignId = $campaign->id;
            $perDayTeams = $teamsPerDay;
            // Set to game date (not +1) — user hasn't played their game yet
            $newDate = $gameDate->copy();

            $batch = Bus::batch($preGameJobs)
                ->name("Pre-game sync: Campaign {$campaignId}")
                ->then(function ($batch) use ($campaignId, $perDayTeams, $newDate, $year) {
                    $campaign = Campaign::find($campaignId);
                    if (!$campaign) return;

                    // Update date + clear batch FIRST so campaign is never stuck
                    $campaign->update([
                        'current_date' => $newDate,
                        'simulation_batch_id' => null,
                    ]);

                    try {
                        // Bulk merge all simulation results into season JSON
                        app(CampaignSeasonService::class)->bulkMergeResults($campaignId, $year, $batch->id);

                        $evolutionService = app(PlayerEvolutionService::class);
                        $evolutionService->processMultiDayRestRecovery($campaign, $perDayTeams);

                        $dayOfSeason = $newDate->diffInDays(Carbon::parse('2025-10-21'));
                        if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                            $evolutionService->processWeeklyUpdates($campaign);
                            $proposalService = app(AITradeProposalService::class);
                            $proposalService->generateWeeklyProposals($campaign);
                        }
                        if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                            $evolutionService->processMonthlyDevelopment($campaign);
                        }
                        app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
                        app(AllStarService::class)->processAllStarSelections($campaign);
                    } catch (\Exception $e) {
                        Log::error("Post-batch processing failed for campaign {$campaignId}: " . $e->getMessage());
                    }
                })
                ->catch(function ($batch, $e) use ($campaignId) {
                    Log::error("Simulation batch failed for campaign {$campaignId}: " . $e->getMessage());
                    Campaign::where('id', $campaignId)->update(['simulation_batch_id' => null]);
                })
                ->dispatch();

            $batchId = $batch->id;
            $campaign->update(['simulation_batch_id' => $batchId]);
        } else {
            // No pre-game games - handle synchronously (teamsPerDay has just game day)
            $this->evolutionService->processMultiDayRestRecovery($campaign, $teamsPerDay);
            $campaign->update(['current_date' => $gameDate->copy()->addDay()]);

            $dayOfSeason = $campaign->current_date->diffInDays(Carbon::parse('2025-10-21'));
            if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                $upgradePointsAwarded = $this->evolutionService->processWeeklyUpdates($campaign);
                app(AITradeProposalService::class)->generateWeeklyProposals($campaign);
            }
            if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                $this->evolutionService->processMonthlyDevelopment($campaign);
            }
            app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
            app(AllStarService::class)->processAllStarSelections($campaign);
        }

        // Strip animation data for quick sim mode
        if ($mode === 'quick') {
            unset($result['animation_data']);
            unset($result['play_by_play']);
        }

        $response = [
            'message' => 'Game simulated successfully',
            'result' => $result,
        ];

        if (!empty($upgradePointsAwarded ?? [])) {
            $response['upgrade_points_awarded'] = $upgradePointsAwarded;
        }

        if ($batchId) {
            $response['batchId'] = $batchId;
            $response['totalAiGames'] = count($preGameJobs);
        }

        if ($playoffUpdate) {
            $response['playoffUpdate'] = $playoffUpdate;
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

        // Guard against existing batch
        if ($campaign->simulation_batch_id) {
            $existingBatch = Bus::findBatch($campaign->simulation_batch_id);
            if ($existingBatch && !$existingBatch->finished()) {
                return response()->json([
                    'message' => 'A simulation is already in progress',
                    'batchId' => $campaign->simulation_batch_id,
                ], 409);
            }
            $campaign->update(['simulation_batch_id' => null]);
        }

        // Initialize AI team lineups if not already set, then refresh based on fatigue
        $this->aiLineupService->initializeAllTeamLineups($campaign);
        $this->aiLineupService->refreshAllTeamLineups($campaign);

        $year = $campaign->currentSeason?->year ?? 2025;
        $currentDate = $campaign->current_date->format('Y-m-d');
        $games = $this->seasonService->getGamesByDate($campaign->id, $year, $currentDate);
        $games = array_filter($games, fn($g) => !$g['isComplete']);

        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('id');
        $userLineup = $campaign->settings['lineup']['starters'] ?? null;

        $teamsWithGames = [];
        $userGameResult = null;
        $aiJobs = [];

        // Separate user's game (simulate sync) from AI games (queue)
        foreach ($games as $game) {
            $homeTeam = $teams[$game['homeTeamId']] ?? null;
            $awayTeam = $teams[$game['awayTeamId']] ?? null;
            if (!$homeTeam || !$awayTeam) continue;

            $teamsWithGames[] = $game['homeTeamId'];
            $teamsWithGames[] = $game['awayTeamId'];

            $isUserGame = $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id;

            if ($isUserGame) {
                // Simulate user's game synchronously
                $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam, $userLineup);

                $this->seasonService->updateGame($campaign->id, $year, $game['id'], [
                    'isComplete' => true,
                    'homeScore' => $result['home_score'],
                    'awayScore' => $result['away_score'],
                    'boxScore' => $result['box_score'],
                    'quarterScores' => $result['quarter_scores'] ?? null,
                ], true);

                $this->seasonService->updateStandingsAfterGame(
                    $campaign->id, $year, $game['homeTeamId'], $game['awayTeamId'],
                    $result['home_score'], $result['away_score'],
                    $homeTeam->conference, $awayTeam->conference
                );

                $this->updatePlayerStats($campaign->id, $year, $result['box_score'], $homeTeam->id, $awayTeam->id);
                $this->updateCoachStats($homeTeam->id, $awayTeam->id, $result['home_score'], $result['away_score'], $game['isPlayoff'] ?? false);

                $userGameResult = [
                    'game_id' => $game['id'],
                    'home_team' => ['id' => $homeTeam->id, 'name' => $homeTeam->name, 'abbreviation' => $homeTeam->abbreviation],
                    'away_team' => ['id' => $awayTeam->id, 'name' => $awayTeam->name, 'abbreviation' => $awayTeam->abbreviation],
                    'home_score' => $result['home_score'],
                    'away_score' => $result['away_score'],
                    'is_user_game' => true,
                ];
            } else {
                $aiJobs[] = new SimulateGameJob(
                    $campaign->id, $year, $game, $game['homeTeamId'], $game['awayTeamId'],
                    false, null, $currentDate
                );
            }
        }

        $batchId = null;

        if (!empty($aiJobs)) {
            $campaignId = $campaign->id;
            $uniqueTeams = array_unique($teamsWithGames);
            $newDate = $campaign->current_date->copy()->addDay();

            $batch = Bus::batch($aiJobs)
                ->name("Simulate day: Campaign {$campaignId}")
                ->then(function ($batch) use ($campaignId, $uniqueTeams, $newDate, $year) {
                    $campaign = Campaign::find($campaignId);
                    if (!$campaign) return;

                    // Update date + clear batch FIRST so campaign is never stuck
                    $campaign->update([
                        'current_date' => $newDate,
                        'simulation_batch_id' => null,
                    ]);

                    try {
                        app(CampaignSeasonService::class)->bulkMergeResults($campaignId, $year, $batch->id);

                        $evolutionService = app(PlayerEvolutionService::class);
                        $evolutionService->processRestDayRecovery($campaign, $uniqueTeams);

                        $dayOfSeason = $newDate->diffInDays(Carbon::parse('2025-10-21'));
                        if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                            $evolutionService->processWeeklyUpdates($campaign);
                            $proposalService = app(AITradeProposalService::class);
                            $proposalService->generateWeeklyProposals($campaign);
                        }
                        if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                            $evolutionService->processMonthlyDevelopment($campaign);
                        }
                        app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
                        app(AllStarService::class)->processAllStarSelections($campaign);
                    } catch (\Exception $e) {
                        Log::error("Post-batch processing failed for campaign {$campaignId}: " . $e->getMessage());
                    }
                })
                ->catch(function ($batch, $e) use ($campaignId) {
                    Log::error("SimulateDay batch failed for campaign {$campaignId}: " . $e->getMessage());
                    Campaign::where('id', $campaignId)->update(['simulation_batch_id' => null]);
                })
                ->dispatch();

            $batchId = $batch->id;
            $campaign->update(['simulation_batch_id' => $batchId]);
        } else {
            // No AI games - handle synchronously
            $this->evolutionService->processRestDayRecovery($campaign, array_unique($teamsWithGames));
            $newDate = $campaign->current_date->copy()->addDay();
            $campaign->update(['current_date' => $newDate]);

            $dayOfSeason = $newDate->diffInDays(Carbon::parse('2025-10-21'));
            if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                $upgradePointsAwarded = $this->evolutionService->processWeeklyUpdates($campaign);
                app(AITradeProposalService::class)->generateWeeklyProposals($campaign);
            }
            if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                $this->evolutionService->processMonthlyDevelopment($campaign);
            }
            app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
            app(AllStarService::class)->processAllStarSelections($campaign);
        }

        $response = [
            'message' => 'Day simulated',
            'userGameResult' => $userGameResult,
            'new_date' => $campaign->fresh()->current_date->format('Y-m-d'),
        ];

        if (!empty($upgradePointsAwarded ?? [])) {
            $response['upgrade_points_awarded'] = $upgradePointsAwarded;
        }

        if ($batchId) {
            $response['batchId'] = $batchId;
            $response['totalAiGames'] = count($aiJobs);
        }

        return response()->json($response);
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
     * Get All-Star and Rising Stars rosters for the current season.
     */
    public function allStarRosters(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? $campaign->game_year ?? 2025;
        $settings = $campaign->settings ?? [];
        $rosters = $settings["all_star_rosters_{$year}"] ?? null;

        if (!$rosters) {
            return response()->json(['rosters' => null]);
        }

        return response()->json(['rosters' => $rosters]);
    }

    /**
     * Mark All-Star rosters as viewed.
     */
    public function markAllStarViewed(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $year = $campaign->currentSeason?->year ?? $campaign->game_year ?? 2025;
        $settings = $campaign->settings ?? [];
        $settings["all_star_viewed_{$year}"] = true;
        $campaign->update(['settings' => $settings]);

        return response()->json(['success' => true]);
    }

    /**
     * Check simulation batch status.
     */
    public function simulationStatus(Request $request, Campaign $campaign, string $batchId): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $batch = Bus::findBatch($batchId);

        if (!$batch) {
            return response()->json([
                'status' => 'not_found',
                'message' => 'Batch not found',
            ], 404);
        }

        $status = 'processing';
        if ($batch->cancelled()) {
            $status = 'cancelled';
        } elseif ($batch->finished()) {
            $status = $batch->failedJobs > 0 ? 'completed_with_errors' : 'completed';
        }

        // Progressive game results — frontend sends ?seen=N to skip already-received rows
        $seen = (int) $request->input('seen', 0);
        $gameResults = SimulationResult::where('batch_id', $batchId)
            ->orderBy('id')
            ->skip($seen)
            ->take(50)
            ->get()
            ->map(fn ($r) => [
                'game_id' => $r->game_id,
                'home_team_id' => $r->home_team_id,
                'away_team_id' => $r->away_team_id,
                'home_score' => $r->home_score,
                'away_score' => $r->away_score,
                'game_date' => $r->game_date,
            ]);

        // Get team abbreviations for display
        $teamIds = $gameResults->pluck('home_team_id')
            ->merge($gameResults->pluck('away_team_id'))
            ->unique()
            ->values();
        $teamAbbreviations = Team::whereIn('id', $teamIds)
            ->pluck('abbreviation', 'id');

        $gameResults = $gameResults->map(function ($r) use ($teamAbbreviations) {
            $r['home_abbreviation'] = $teamAbbreviations[$r['home_team_id']] ?? '???';
            $r['away_abbreviation'] = $teamAbbreviations[$r['away_team_id']] ?? '???';
            return $r;
        });

        $totalResults = SimulationResult::where('batch_id', $batchId)->count();

        return response()->json([
            'status' => $status,
            'progress' => [
                'total' => $batch->totalJobs,
                'completed' => $batch->processedJobs() - $batch->failedJobs,
                'failed' => $batch->failedJobs,
                'pending' => $batch->pendingJobs,
            ],
            'gameResults' => $gameResults,
            'totalResults' => $totalResults,
        ]);
    }

    /**
     * Start a quarter-by-quarter game simulation (Q1 only).
     */
    public function startGame(Request $request, Campaign $campaign, string $gameId): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Clean up stale batch if it already finished
        if ($campaign->simulation_batch_id) {
            $existingBatch = Bus::findBatch($campaign->simulation_batch_id);
            if (!$existingBatch || $existingBatch->finished()) {
                $campaign->update(['simulation_batch_id' => null]);
            }
        }

        // Initialize AI team lineups if not already set, then refresh based on fatigue
        $this->aiLineupService->initializeAllTeamLineups($campaign);
        $this->aiLineupService->refreshAllTeamLineups($campaign);

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

        // Dispatch pre-game sync games as background batch (if not already handled)
        $gameDate = Carbon::parse($game['gameDate']);
        $batchId = $campaign->simulation_batch_id; // may already be set by simulateToNextGame

        if (!$batchId) {
            $currentDate = $campaign->current_date->copy();
            $preGameJobs = [];
            $preGameTeams = [];

            while ($currentDate->lt($gameDate)) {
                $dateStr = $currentDate->format('Y-m-d');
                $dayGames = $this->seasonService->getGamesByDate($campaign->id, $year, $dateStr);
                $dayGames = array_filter($dayGames, fn($g) => !$g['isComplete']);

                foreach ($dayGames as $dayGame) {
                    $preGameTeams[] = $dayGame['homeTeamId'];
                    $preGameTeams[] = $dayGame['awayTeamId'];
                    $preGameJobs[] = new SimulateGameJob(
                        $campaign->id, $year, $dayGame, $dayGame['homeTeamId'], $dayGame['awayTeamId'],
                        false, null, $dateStr
                    );
                }

                $currentDate = $currentDate->copy()->addDay();
            }

            if (!empty($preGameJobs)) {
                $campaignId = $campaign->id;
                $uniqueTeams = array_unique($preGameTeams);

                $batch = Bus::batch($preGameJobs)
                    ->name("Pre-game sync: Campaign {$campaignId}")
                    ->then(function ($batch) use ($campaignId, $uniqueTeams, $year) {
                        $campaign = Campaign::find($campaignId);
                        if (!$campaign) return;

                        // Clear batch FIRST so campaign is never stuck
                        $campaign->update(['simulation_batch_id' => null]);

                        try {
                            app(CampaignSeasonService::class)->bulkMergeResults($campaignId, $year, $batch->id);

                            $evolutionService = app(PlayerEvolutionService::class);
                            $evolutionService->processRestDayRecovery($campaign, $uniqueTeams);
                        } catch (\Exception $e) {
                            Log::error("Post-batch processing failed for campaign {$campaignId}: " . $e->getMessage());
                        }
                    })
                    ->catch(function ($batch, $e) use ($campaignId) {
                        Log::error("Pre-game sync batch failed for campaign {$campaignId}: " . $e->getMessage());
                        Campaign::where('id', $campaignId)->update(['simulation_batch_id' => null]);
                    })
                    ->dispatch();

                $batchId = $batch->id;
                $campaign->update(['simulation_batch_id' => $batchId]);
            }
        }

        // Always proceed to Q1 — AI games run in background
        if (!$campaign->current_date->eq($gameDate)) {
            $campaign->update(['current_date' => $gameDate]);
        }

        $homeTeam = Team::find($game['homeTeamId']);
        $awayTeam = Team::find($game['awayTeamId']);

        // Get user's saved starting lineup
        $userLineup = null;
        $isUserHome = $game['homeTeamId'] === $campaign->team_id;
        $isUserAway = $game['awayTeamId'] === $campaign->team_id;

        if ($isUserHome || $isUserAway) {
            if ($isUserHome && $request->has('home_lineup')) {
                $userLineup = $request->input('home_lineup');
            } elseif ($isUserAway && $request->has('away_lineup')) {
                $userLineup = $request->input('away_lineup');
            } else {
                $userLineup = $campaign->settings['lineup']['starters'] ?? null;
            }
        }

        // Get coaching adjustments
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

        if ($batchId) {
            $response['batchId'] = $batchId;
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

            // Process playoff game completion if applicable
            $playoffUpdate = null;
            if ($game['isPlayoff'] ?? false) {
                $playoffUpdate = $this->processPlayoffGameCompletion($campaign, $game, $finalResult['home_score'], $finalResult['away_score']);
            }

            // Collect remaining AI games on this day for background batch
            $gameDate = $game['gameDate'];
            $allGames = $this->seasonService->getGamesByDate($campaign->id, $year, $gameDate);

            $teamsWithGames = [$game['homeTeamId'], $game['awayTeamId']];
            $remainingJobs = [];

            foreach ($allGames as $otherGame) {
                if ($otherGame['id'] === $gameId || ($otherGame['isComplete'] ?? false)) {
                    continue;
                }

                $teamsWithGames[] = $otherGame['homeTeamId'];
                $teamsWithGames[] = $otherGame['awayTeamId'];

                $remainingJobs[] = new SimulateGameJob(
                    $campaign->id, $year, $otherGame,
                    $otherGame['homeTeamId'], $otherGame['awayTeamId'],
                    false, null, $gameDate
                );
            }

            $batchId = null;

            if (!empty($remainingJobs)) {
                $campaignId = $campaign->id;
                $uniqueTeams = array_unique($teamsWithGames);
                $newDate = Carbon::parse($gameDate)->addDay();

                $batch = Bus::batch($remainingJobs)
                    ->name("Post-game day: Campaign {$campaignId}")
                    ->then(function ($batch) use ($campaignId, $uniqueTeams, $newDate, $year) {
                        $campaign = Campaign::find($campaignId);
                        if (!$campaign) return;

                        // Update date + clear batch FIRST so campaign is never stuck
                        $campaign->update([
                            'current_date' => $newDate,
                            'simulation_batch_id' => null,
                        ]);

                        try {
                            app(CampaignSeasonService::class)->bulkMergeResults($campaignId, $year, $batch->id);

                            $evolutionService = app(PlayerEvolutionService::class);
                            $evolutionService->processRestDayRecovery($campaign, $uniqueTeams);

                            $dayOfSeason = $newDate->diffInDays(Carbon::parse('2025-10-21'));
                            if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                                $evolutionService->processWeeklyUpdates($campaign);
                                app(AITradeProposalService::class)->generateWeeklyProposals($campaign);
                            }
                            if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                                $evolutionService->processMonthlyDevelopment($campaign);
                            }
                            app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
                            app(AllStarService::class)->processAllStarSelections($campaign);
                        } catch (\Exception $e) {
                            Log::error("Post-batch processing failed for campaign {$campaignId}: " . $e->getMessage());
                        }
                    })
                    ->catch(function ($batch, $e) use ($campaignId) {
                        Log::error("Post-game batch failed for campaign {$campaignId}: " . $e->getMessage());
                        Campaign::where('id', $campaignId)->update(['simulation_batch_id' => null]);
                    })
                    ->dispatch();

                $batchId = $batch->id;
                $campaign->update(['simulation_batch_id' => $batchId]);
            } else {
                // No remaining games - handle synchronously
                $this->evolutionService->processRestDayRecovery($campaign, array_unique($teamsWithGames));
                $newDate = Carbon::parse($gameDate)->addDay();
                $campaign->update(['current_date' => $newDate]);

                $dayOfSeason = $newDate->diffInDays(Carbon::parse('2025-10-21'));
                if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                    $upgradePointsAwarded = $this->evolutionService->processWeeklyUpdates($campaign);
                    app(AITradeProposalService::class)->generateWeeklyProposals($campaign);
                }
                if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                    $this->evolutionService->processMonthlyDevelopment($campaign);
                }
                app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
                app(AllStarService::class)->processAllStarSelections($campaign);
            }

            $response = [
                'message' => 'Game complete',
                'quarter' => $result['quarterResult']['quarter'],
                'isGameComplete' => true,
                'result' => array_merge($finalResult, [
                    'evolution' => $evolutionSummary,
                ]),
                'rewards' => $rewardSummary,
                ...$result['quarterResult'],
            ];

            if (!empty($upgradePointsAwarded ?? [])) {
                $response['upgrade_points_awarded'] = $upgradePointsAwarded;
            }

            if ($batchId) {
                $response['batchId'] = $batchId;
                $response['totalAiGames'] = count($remainingJobs);
            }

            if ($playoffUpdate) {
                $response['playoffUpdate'] = $playoffUpdate;
            }

            return response()->json($response);
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
     * Sim an in-progress game to completion (skip remaining quarters).
     */
    public function simToEnd(Request $request, Campaign $campaign, string $gameId): JsonResponse
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
            return response()->json(['message' => 'Game not in progress'], 400);
        }

        $result = $this->simulationService->simToEnd($game['gameState']);

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

        // Process evolution
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
            \Log::error('Evolution processing failed (simToEnd): ' . $e->getMessage(), [
                'game_id' => $gameId,
                'trace' => $e->getTraceAsString(),
            ]);
        }

        // Process synergy rewards
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

        // Process playoff game completion if applicable
        $playoffUpdate = null;
        if ($game['isPlayoff'] ?? false) {
            $playoffUpdate = $this->processPlayoffGameCompletion($campaign, $game, $finalResult['home_score'], $finalResult['away_score']);
        }

        // Collect remaining AI games on this day for background batch
        $gameDate = $game['gameDate'];
        $allGames = $this->seasonService->getGamesByDate($campaign->id, $year, $gameDate);

        $teamsWithGames = [$game['homeTeamId'], $game['awayTeamId']];
        $remainingJobs = [];

        foreach ($allGames as $otherGame) {
            if ($otherGame['id'] === $gameId || ($otherGame['isComplete'] ?? false)) {
                continue;
            }

            $teamsWithGames[] = $otherGame['homeTeamId'];
            $teamsWithGames[] = $otherGame['awayTeamId'];

            $remainingJobs[] = new SimulateGameJob(
                $campaign->id, $year, $otherGame,
                $otherGame['homeTeamId'], $otherGame['awayTeamId'],
                false, null, $gameDate
            );
        }

        $batchId = null;

        if (!empty($remainingJobs)) {
            $campaignId = $campaign->id;
            $uniqueTeams = array_unique($teamsWithGames);
            $newDate = Carbon::parse($gameDate)->addDay();

            $batch = Bus::batch($remainingJobs)
                ->name("Post-game day: Campaign {$campaignId}")
                ->then(function ($batch) use ($campaignId, $uniqueTeams, $newDate, $year) {
                    $campaign = Campaign::find($campaignId);
                    if (!$campaign) return;

                    // Update date + clear batch FIRST so campaign is never stuck
                    $campaign->update([
                        'current_date' => $newDate,
                        'simulation_batch_id' => null,
                    ]);

                    try {
                        app(CampaignSeasonService::class)->bulkMergeResults($campaignId, $year, $batch->id);

                        $evolutionService = app(PlayerEvolutionService::class);
                        $evolutionService->processRestDayRecovery($campaign, $uniqueTeams);

                        $dayOfSeason = $newDate->diffInDays(Carbon::parse('2025-10-21'));
                        if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                            $evolutionService->processWeeklyUpdates($campaign);
                            $proposalService = app(AITradeProposalService::class);
                            $proposalService->generateWeeklyProposals($campaign);
                        }
                        if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                            $evolutionService->processMonthlyDevelopment($campaign);
                        }
                        app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
                        app(AllStarService::class)->processAllStarSelections($campaign);
                    } catch (\Exception $e) {
                        Log::error("Post-batch processing failed for campaign {$campaignId}: " . $e->getMessage());
                    }
                })
                ->catch(function ($batch, $e) use ($campaignId) {
                    Log::error("Post-game batch failed for campaign {$campaignId}: " . $e->getMessage());
                    Campaign::where('id', $campaignId)->update(['simulation_batch_id' => null]);
                })
                ->dispatch();

            $batchId = $batch->id;
            $campaign->update(['simulation_batch_id' => $batchId]);
        } else {
            $this->evolutionService->processRestDayRecovery($campaign, array_unique($teamsWithGames));
            $newDate = Carbon::parse($gameDate)->addDay();
            $campaign->update(['current_date' => $newDate]);

            $dayOfSeason = $newDate->diffInDays(Carbon::parse('2025-10-21'));
            if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                $upgradePointsAwarded = $this->evolutionService->processWeeklyUpdates($campaign);
                app(AITradeProposalService::class)->generateWeeklyProposals($campaign);
            }
            if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                $this->evolutionService->processMonthlyDevelopment($campaign);
            }
            app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
            app(AllStarService::class)->processAllStarSelections($campaign);
        }

        $response = [
            'message' => 'Game complete',
            'isGameComplete' => true,
            'result' => array_merge($finalResult, [
                'evolution' => $evolutionSummary,
            ]),
            'rewards' => $rewardSummary,
        ];

        if (!empty($upgradePointsAwarded ?? [])) {
            $response['upgrade_points_awarded'] = $upgradePointsAwarded;
        }

        if ($batchId) {
            $response['batchId'] = $batchId;
            $response['totalAiGames'] = count($remainingJobs);
        }

        if ($playoffUpdate) {
            $response['playoffUpdate'] = $playoffUpdate;
        }

        return response()->json($response);
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
     * Process playoff game completion - update series, advance winners, persist awards.
     * Returns playoff update data to include in response.
     */
    private function processPlayoffGameCompletion(Campaign $campaign, array $game, int $homeScore, int $awayScore): ?array
    {
        if (!($game['isPlayoff'] ?? false)) {
            return null;
        }

        $year = $campaign->currentSeason?->year ?? 2025;

        // Update series with game result
        $seriesUpdate = $this->playoffService->updateSeriesAfterGame($campaign, $game, $homeScore, $awayScore);

        if (!$seriesUpdate) {
            return null;
        }

        $result = [
            'seriesId' => $seriesUpdate['seriesId'],
            'series' => $seriesUpdate['series'],
            'seriesComplete' => $seriesUpdate['seriesComplete'],
            'round' => $seriesUpdate['round'],
        ];

        if ($seriesUpdate['seriesComplete']) {
            $result['winner'] = $seriesUpdate['winner'];
            $result['seriesMVP'] = $seriesUpdate['seriesMVP'];

            // Persist MVP awards
            if ($seriesUpdate['seriesMVP']) {
                $mvpPlayerId = $seriesUpdate['seriesMVP']['playerId'];

                if ($seriesUpdate['round'] === 3) {
                    // Conference Finals MVP
                    $result['isConferenceFinals'] = true;
                    $this->playoffService->persistPlayerAward($campaign, $mvpPlayerId, 'conference_finals_mvp', $year);
                } elseif ($seriesUpdate['round'] === 4) {
                    // Finals MVP
                    $result['isFinals'] = true;
                    $result['isChampion'] = true;
                    $this->playoffService->persistPlayerAward($campaign, $mvpPlayerId, 'finals_mvp', $year);

                    // Award championships to entire roster
                    $winnerId = $seriesUpdate['winner']['teamId'];
                    $this->playoffService->persistChampionshipToRoster($campaign, $winnerId, $year);
                }
            }

            // Advance winner to next round
            $this->playoffService->advanceWinnerToNextRound($campaign, $seriesUpdate);

            // Generate schedule for next round if needed
            $nextRound = $seriesUpdate['round'] + 1;
            if ($nextRound <= 4) {
                $this->playoffService->generatePlayoffSchedule($campaign, $nextRound);
            }
        }

        return $result;
    }

    /**
     * Simulate all games for a given day (helper method).
     * Returns summary of simulated games.
     */
    private function simulateDayGames(Campaign $campaign, int $year, array $games): array
    {
        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('id');
        $results = [];

        // Track which teams played today
        $teamsWithGames = [];

        // Get user's saved starting lineup for their games
        $userLineup = $campaign->settings['lineup']['starters'] ?? null;

        foreach ($games as $game) {
            $homeTeam = $teams[$game['homeTeamId']] ?? null;
            $awayTeam = $teams[$game['awayTeamId']] ?? null;

            if (!$homeTeam || !$awayTeam) {
                continue;
            }

            // Track teams that played
            $teamsWithGames[] = $game['homeTeamId'];
            $teamsWithGames[] = $game['awayTeamId'];

            // Determine if this is the user's game and pass their lineup
            $isUserGame = $game['homeTeamId'] === $campaign->team_id || $game['awayTeamId'] === $campaign->team_id;
            $gameLineup = $isUserGame ? $userLineup : null;

            // Simulate the game (skip animation data for AI-only games)
            $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam, $gameLineup, $isUserGame);

            // Update game in JSON
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

            // Process playoff game completion if applicable
            $playoffUpdate = null;
            if ($game['isPlayoff'] ?? false) {
                $playoffUpdate = $this->processPlayoffGameCompletion($campaign, $game, $result['home_score'], $result['away_score']);
            }

            $gameResult = [
                'game_id' => $game['id'],
                'home_team' => $homeTeam->name,
                'away_team' => $awayTeam->name,
                'home_score' => $result['home_score'],
                'away_score' => $result['away_score'],
            ];

            if ($playoffUpdate) {
                $gameResult['playoffUpdate'] = $playoffUpdate;
            }

            $results[] = $gameResult;
        }

        // Process rest day recovery for teams that didn't play
        $this->evolutionService->processRestDayRecovery($campaign, array_unique($teamsWithGames));

        // Check for weekly/monthly evolution updates
        $upgradePointsAwarded = [];
        $dayOfSeason = $campaign->current_date->diffInDays(Carbon::parse('2025-10-21'));
        if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
            $upgradePointsAwarded = $this->evolutionService->processWeeklyUpdates($campaign);
            app(AITradeProposalService::class)->generateWeeklyProposals($campaign);
        }
        if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
            $this->evolutionService->processMonthlyDevelopment($campaign);
        }
        app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
        app(AllStarService::class)->processAllStarSelections($campaign);

        $result = [
            'date' => $games[0]['gameDate'] ?? null,
            'games_count' => count($results),
            'results' => $results,
        ];

        if (!empty($upgradePointsAwarded)) {
            $result['upgrade_points_awarded'] = $upgradePointsAwarded;
        }

        return $result;
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

        // Guard: reject if a simulation batch is still running
        if ($campaign->simulation_batch_id) {
            $existingBatch = Bus::findBatch($campaign->simulation_batch_id);
            if ($existingBatch && !$existingBatch->finished()) {
                return response()->json([
                    'message' => 'A simulation is already in progress',
                    'batchId' => $campaign->simulation_batch_id,
                ], 409);
            }
            $campaign->update(['simulation_batch_id' => null]);
        }

        $excludeUserGame = $request->boolean('excludeUserGame', false);

        // Initialize AI team lineups if not already set, then refresh based on fatigue
        $this->aiLineupService->initializeAllTeamLineups($campaign);
        $this->aiLineupService->refreshAllTeamLineups($campaign);

        $year = $campaign->currentSeason?->year ?? 2025;

        // Get user's next game (only games on or after current date)
        $currentDate = $campaign->current_date->copy();
        $nextUserGame = $this->seasonService->getNextTeamGame($campaign->id, $year, $campaign->team_id, $currentDate->format('Y-m-d'));
        if (!$nextUserGame) {
            return response()->json(['message' => 'No upcoming games found'], 400);
        }

        $gameDate = Carbon::parse($nextUserGame['gameDate']);
        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('id');
        $userLineup = $campaign->settings['lineup']['starters'] ?? null;

        // Collect all games across all days (pre-game days + game day)
        $aiJobs = [];
        $teamsPerDay = [];
        $userGameResult = null;

        // Days before game date — only queue AI games, skip any user games
        $userTeamId = (int) $campaign->team_id;
        while ($currentDate->lt($gameDate)) {
            $dateStr = $currentDate->format('Y-m-d');
            $dayGames = $this->seasonService->getGamesByDate($campaign->id, $year, $dateStr);
            $dayGames = array_filter($dayGames, fn($g) => !$g['isComplete']);

            $dayTeamIds = [];
            foreach ($dayGames as $game) {
                // Skip user games — only the game-day loop handles the user's game
                if ((int) $game['homeTeamId'] === $userTeamId || (int) $game['awayTeamId'] === $userTeamId) {
                    continue;
                }

                $dayTeamIds[] = $game['homeTeamId'];
                $dayTeamIds[] = $game['awayTeamId'];

                $aiJobs[] = new SimulateGameJob(
                    $campaign->id, $year, $game, $game['homeTeamId'], $game['awayTeamId'],
                    false, null, $dateStr
                );
            }

            $teamsPerDay[] = $dayTeamIds;
            $currentDate = $currentDate->copy()->addDay();
        }

        // Game day games
        $gameDateStr = $gameDate->format('Y-m-d');
        $gameDateGames = $this->seasonService->getGamesByDate($campaign->id, $year, $gameDateStr);
        $gameDateGames = array_filter($gameDateGames, fn($g) => !$g['isComplete']);

        $gameDayTeamIds = [];
        foreach ($gameDateGames as $game) {
            $homeTeam = $teams[$game['homeTeamId']] ?? null;
            $awayTeam = $teams[$game['awayTeamId']] ?? null;
            if (!$homeTeam || !$awayTeam) continue;

            $gameDayTeamIds[] = $game['homeTeamId'];
            $gameDayTeamIds[] = $game['awayTeamId'];

            $userTeamId = (int) $campaign->team_id;
            $homeTeamId = (int) $game['homeTeamId'];
            $awayTeamId = (int) $game['awayTeamId'];
            $isUserGame = $homeTeamId === $userTeamId || $awayTeamId === $userTeamId;

            // Skip user's game if excludeUserGame is true
            if ($isUserGame && $excludeUserGame) {
                continue;
            }

            if ($isUserGame) {
                // Simulate user's game synchronously
                $gameLineup = $userLineup;
                $result = $this->simulationService->simulateFromData($campaign, $game, $homeTeam, $awayTeam, $gameLineup);

                $this->seasonService->updateGame($campaign->id, $year, $game['id'], [
                    'isComplete' => true,
                    'homeScore' => $result['home_score'],
                    'awayScore' => $result['away_score'],
                    'boxScore' => $result['box_score'],
                    'quarterScores' => $result['quarter_scores'] ?? null,
                    'evolution' => $result['evolution'] ?? null,
                    'rewards' => $result['rewards'] ?? null,
                ], true);

                $this->seasonService->updateStandingsAfterGame(
                    $campaign->id, $year, $game['homeTeamId'], $game['awayTeamId'],
                    $result['home_score'], $result['away_score'],
                    $homeTeam->conference, $awayTeam->conference
                );

                $this->updatePlayerStats($campaign->id, $year, $result['box_score'], $homeTeam->id, $awayTeam->id);
                $this->updateCoachStats($homeTeam->id, $awayTeam->id, $result['home_score'], $result['away_score'], $game['isPlayoff'] ?? false);

                // Process playoff completion for user's game
                $playoffUpdate = null;
                if ($game['isPlayoff'] ?? false) {
                    $playoffUpdate = $this->processPlayoffGameCompletion($campaign, $game, $result['home_score'], $result['away_score']);
                }

                $isUserHome = $homeTeamId === $userTeamId;

                $userGameResult = [
                    'game_id' => $game['id'],
                    'home_team' => ['id' => $homeTeam->id, 'name' => $homeTeam->name, 'abbreviation' => $homeTeam->abbreviation],
                    'away_team' => ['id' => $awayTeam->id, 'name' => $awayTeam->name, 'abbreviation' => $awayTeam->abbreviation],
                    'home_score' => $result['home_score'],
                    'away_score' => $result['away_score'],
                    'is_user_game' => true,
                    'is_user_home' => $isUserHome,
                    'evolution' => $result['evolution'] ?? null,
                    'rewards' => $result['rewards'] ?? null,
                    'box_score' => $result['box_score'] ?? null,
                ];

                if ($playoffUpdate) {
                    $userGameResult['playoffUpdate'] = $playoffUpdate;
                }
            } else {
                // Queue AI game
                $aiJobs[] = new SimulateGameJob(
                    $campaign->id, $year, $game, $game['homeTeamId'], $game['awayTeamId'],
                    false, null, $gameDateStr
                );
            }
        }

        // Add game day teams to per-day tracking
        $teamsPerDay[] = $gameDayTeamIds;

        $batchId = null;

        if (!empty($aiJobs)) {
            $campaignId = $campaign->id;
            $perDayTeams = $teamsPerDay;
            $newDate = $excludeUserGame ? $gameDate->copy() : $gameDate->copy()->addDay();

            $batch = Bus::batch($aiJobs)
                ->name("Simulate to next game: Campaign {$campaignId}")
                ->then(function ($batch) use ($campaignId, $perDayTeams, $newDate, $year, $excludeUserGame) {
                    $campaign = Campaign::find($campaignId);
                    if (!$campaign) return;

                    // Update date + clear batch FIRST so campaign is never stuck
                    $campaign->update([
                        'current_date' => $newDate,
                        'simulation_batch_id' => null,
                    ]);

                    try {
                        app(CampaignSeasonService::class)->bulkMergeResults($campaignId, $year, $batch->id);

                        $evolutionService = app(PlayerEvolutionService::class);
                        $evolutionService->processMultiDayRestRecovery($campaign, $perDayTeams);

                        if (!$excludeUserGame) {
                            $dayOfSeason = $newDate->diffInDays(Carbon::parse('2025-10-21'));
                            if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                                $evolutionService->processWeeklyUpdates($campaign);
                                app(AITradeProposalService::class)->generateWeeklyProposals($campaign);
                            }
                            if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                                $evolutionService->processMonthlyDevelopment($campaign);
                            }
                            app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
                            app(AllStarService::class)->processAllStarSelections($campaign);
                        }
                    } catch (\Exception $e) {
                        Log::error("Post-batch processing failed for campaign {$campaignId}: " . $e->getMessage());
                    }
                })
                ->catch(function ($batch, $e) use ($campaignId) {
                    Log::error("SimulateToNextGame batch failed for campaign {$campaignId}: " . $e->getMessage());
                    Campaign::where('id', $campaignId)->update(['simulation_batch_id' => null]);
                })
                ->dispatch();

            $batchId = $batch->id;
            $campaign->update(['simulation_batch_id' => $batchId]);
        } else {
            // No AI games - handle synchronously
            $this->evolutionService->processMultiDayRestRecovery($campaign, $teamsPerDay);

            $newDate = $excludeUserGame ? $gameDate->copy() : $gameDate->copy()->addDay();
            $campaign->update(['current_date' => $newDate]);

            if (!$excludeUserGame) {
                $dayOfSeason = $newDate->diffInDays(Carbon::parse('2025-10-21'));
                if ($dayOfSeason > 0 && $dayOfSeason % 7 === 0) {
                    $upgradePointsAwarded = $this->evolutionService->processWeeklyUpdates($campaign);
                    app(AITradeProposalService::class)->generateWeeklyProposals($campaign);
                }
                if ($dayOfSeason > 0 && $dayOfSeason % 30 === 0) {
                    $this->evolutionService->processMonthlyDevelopment($campaign);
                }
                app(AITradeProposalService::class)->processTradeDeadlineEvents($campaign);
                app(AllStarService::class)->processAllStarSelections($campaign);
            }
        }

        $response = [
            'message' => 'Simulated to next game successfully',
            'userGameResult' => $userGameResult,
            'newDate' => $campaign->fresh()->current_date->format('Y-m-d'),
        ];

        if (!empty($upgradePointsAwarded ?? [])) {
            $response['upgrade_points_awarded'] = $upgradePointsAwarded;
        }

        if ($batchId) {
            $response['batchId'] = $batchId;
            $response['totalAiGames'] = count($aiJobs);
        }

        return response()->json($response);
    }
}
