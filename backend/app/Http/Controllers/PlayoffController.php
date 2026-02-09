<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Services\PlayoffService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PlayoffController extends Controller
{
    public function __construct(
        private PlayoffService $playoffService
    ) {}

    /**
     * Get the current playoff bracket.
     */
    public function getBracket(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $bracket = $this->playoffService->getBracket($campaign);

        if (!$bracket) {
            return response()->json([
                'bracket' => null,
                'message' => 'No playoff bracket generated yet',
            ]);
        }

        return response()->json([
            'bracket' => $bracket,
        ]);
    }

    /**
     * Generate the playoff bracket (called when regular season ends).
     */
    public function generateBracket(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Check if regular season is complete
        if (!$this->playoffService->isRegularSeasonComplete($campaign)) {
            return response()->json([
                'message' => 'Regular season is not complete yet',
            ], 400);
        }

        // Check if bracket already exists
        $existingBracket = $this->playoffService->getBracket($campaign);
        if ($existingBracket) {
            return response()->json([
                'message' => 'Playoff bracket already exists',
                'bracket' => $existingBracket,
            ]);
        }

        // Generate bracket
        $bracket = $this->playoffService->generatePlayoffBracket($campaign);

        // Generate schedule for round 1
        $gamesCreated = $this->playoffService->generatePlayoffSchedule($campaign, 1);

        // Get user's playoff status
        $userStatus = $this->playoffService->getUserPlayoffStatus($campaign);

        return response()->json([
            'message' => 'Playoff bracket generated',
            'bracket' => $bracket,
            'gamesCreated' => $gamesCreated,
            'userStatus' => $userStatus,
        ]);
    }

    /**
     * Get a specific series by ID.
     */
    public function getSeries(Request $request, Campaign $campaign, string $seriesId): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $series = $this->playoffService->getSeries($campaign, $seriesId);

        if (!$series) {
            return response()->json(['message' => 'Series not found'], 404);
        }

        return response()->json([
            'series' => $series,
        ]);
    }

    /**
     * Check if regular season is complete and get playoff qualification status.
     */
    public function checkRegularSeasonEnd(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $isComplete = $this->playoffService->isRegularSeasonComplete($campaign);
        $userStatus = $this->playoffService->getUserPlayoffStatus($campaign);
        $bracketExists = $this->playoffService->getBracket($campaign) !== null;

        return response()->json([
            'regularSeasonComplete' => $isComplete,
            'bracketGenerated' => $bracketExists,
            'userStatus' => $userStatus,
        ]);
    }

    /**
     * Get the user's next playoff series.
     */
    public function getNextUserSeries(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $series = $this->playoffService->getNextUserSeries($campaign);

        return response()->json([
            'series' => $series,
        ]);
    }

    /**
     * Generate schedule for a specific playoff round.
     */
    public function generateRoundSchedule(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $round = $request->input('round', 1);

        if ($round < 1 || $round > 4) {
            return response()->json(['message' => 'Invalid round'], 400);
        }

        $gamesCreated = $this->playoffService->generatePlayoffSchedule($campaign, $round);

        return response()->json([
            'message' => "Schedule generated for round {$round}",
            'gamesCreated' => $gamesCreated,
        ]);
    }
}
