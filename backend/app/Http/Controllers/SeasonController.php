<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Season;
use App\Services\AIContractService;
use App\Services\CampaignPlayerService;
use App\Services\DraftPickService;
use App\Services\PlayoffService;
use App\Services\PlayerEvolution\PlayerEvolutionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SeasonController extends Controller
{
    public function __construct(
        private PlayerEvolutionService $evolutionService,
        private DraftPickService $draftPickService,
        private PlayoffService $playoffService,
        private AIContractService $aiContractService,
        private CampaignPlayerService $playerService
    ) {}

    /**
     * Get current season info.
     */
    public function show(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $season = $campaign->currentSeason;

        return response()->json([
            'season' => [
                'id' => $season?->id,
                'year' => $season?->year,
                'phase' => $season?->phase,
                'standings' => $season?->standings,
                'playoff_bracket' => $season?->playoff_bracket,
            ],
        ]);
    }

    /**
     * Advance to next season phase.
     */
    public function advancePhase(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $season = $campaign->currentSeason;
        if (!$season) {
            return response()->json(['message' => 'No active season'], 400);
        }

        $phases = ['preseason', 'regular', 'playoffs', 'offseason', 'draft', 'free_agency'];
        $currentIndex = array_search($season->phase, $phases);

        if ($currentIndex === false || $currentIndex >= count($phases) - 1) {
            // Start new season
            return $this->startNewSeason($campaign);
        }

        $newPhase = $phases[$currentIndex + 1];
        $season->update(['phase' => $newPhase]);

        // Handle phase-specific logic
        if ($newPhase === 'playoffs') {
            return $this->enterPlayoffs($campaign);
        }

        if ($newPhase === 'offseason') {
            return $this->processOffseason($request, $campaign);
        }

        return response()->json([
            'message' => "Advanced to {$newPhase}",
            'phase' => $newPhase,
        ]);
    }

    /**
     * Enter playoffs phase - generate bracket and schedule.
     */
    private function enterPlayoffs(Campaign $campaign): JsonResponse
    {
        // Generate playoff bracket
        $bracket = $this->playoffService->generatePlayoffBracket($campaign);

        // Generate schedule for round 1
        $gamesCreated = $this->playoffService->generatePlayoffSchedule($campaign, 1);

        // Get user's playoff status
        $userStatus = $this->playoffService->getUserPlayoffStatus($campaign);

        return response()->json([
            'message' => 'Playoffs started',
            'phase' => 'playoffs',
            'bracket' => $bracket,
            'gamesCreated' => $gamesCreated,
            'userStatus' => $userStatus,
        ]);
    }

    /**
     * Process offseason - player evolution, retirements, etc.
     */
    public function processOffseason(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $season = $campaign->currentSeason;
        if (!$season) {
            return response()->json(['message' => 'No active season'], 400);
        }

        // Process player evolution for all players
        $results = $this->evolutionService->processOffseason($campaign);

        // Decrement contract years and handle expired contracts
        $expiredContracts = $this->playerService->decrementContractYears($campaign->id);

        // Process AI team contract decisions (re-signings and free agent signings)
        $contractResults = $this->aiContractService->runAIContractDecisions($campaign);

        // Assign draft pick numbers based on final standings
        $draftYear = $season->year;
        $this->draftPickService->assignPickNumbers($campaign, $draftYear);

        // Roll forward picks (generate new year 5 picks)
        $this->draftPickService->rollForwardPicks($campaign);

        // Update season phase
        $season->update(['phase' => 'offseason']);

        // Increment campaign game year
        $campaign->update(['game_year' => $campaign->game_year + 1]);

        return response()->json([
            'message' => 'Offseason processed successfully',
            'results' => [
                'players_developed' => count($results['developed']),
                'players_regressed' => count($results['regressed']),
                'players_retired' => count($results['retired']),
                'developed' => array_slice($results['developed'], 0, 10), // Top 10
                'regressed' => array_slice($results['regressed'], 0, 10),
                'retired' => $results['retired'],
                'expired_contracts' => count($expiredContracts),
                'ai_extensions' => count($contractResults['extensions']),
                'ai_signings' => count($contractResults['signings']),
            ],
        ]);
    }

    /**
     * Start a new season.
     */
    private function startNewSeason(Campaign $campaign): JsonResponse
    {
        $oldSeason = $campaign->currentSeason;
        $newYear = ($oldSeason?->year ?? 2025) + 1;

        // Create new season
        $newSeason = Season::create([
            'campaign_id' => $campaign->id,
            'year' => $newYear,
            'phase' => 'preseason',
            'standings' => $this->generateInitialStandings($campaign),
        ]);

        // Update campaign
        $campaign->update(['current_season_id' => $newSeason->id]);

        return response()->json([
            'message' => "New season {$newYear} started",
            'season' => [
                'id' => $newSeason->id,
                'year' => $newSeason->year,
                'phase' => $newSeason->phase,
            ],
        ]);
    }

    /**
     * Generate initial standings for a new season.
     */
    private function generateInitialStandings(Campaign $campaign): array
    {
        $teams = $campaign->teams;

        $east = [];
        $west = [];

        foreach ($teams as $team) {
            $standing = [
                'teamId' => $team->id,
                'wins' => 0,
                'losses' => 0,
                'streak' => null,
                'last10' => '0-0',
                'homeRecord' => '0-0',
                'awayRecord' => '0-0',
            ];

            if ($team->conference === 'east') {
                $east[] = $standing;
            } else {
                $west[] = $standing;
            }
        }

        return [
            'east' => $east,
            'west' => $west,
        ];
    }
}
