<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Player;
use App\Services\FinanceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FinanceController extends Controller
{
    public function __construct(
        private FinanceService $financeService
    ) {}

    /**
     * Get financial summary for the user's team.
     */
    public function summary(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $summary = $this->financeService->getFinanceSummary($campaign);

        return response()->json($summary);
    }

    /**
     * Get roster with contracts and season stats.
     */
    public function rosterContracts(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $roster = $this->financeService->getRosterContracts($campaign);
        $summary = $this->financeService->getFinanceSummary($campaign);

        return response()->json([
            'roster' => $roster->values(),
            'summary' => $summary,
        ]);
    }

    /**
     * Get available free agents.
     */
    public function freeAgents(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $freeAgents = $this->financeService->getFreeAgents($campaign);

        return response()->json([
            'free_agents' => $freeAgents,
        ]);
    }

    /**
     * Get transaction history.
     */
    public function transactions(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $transactions = $this->financeService->getTransactions($campaign);

        return response()->json([
            'transactions' => $transactions,
        ]);
    }

    /**
     * Re-sign a player to a new contract.
     */
    public function resignPlayer(Request $request, Campaign $campaign, Player $player): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Validate player belongs to user's team
        if ($player->campaign_id !== $campaign->id || $player->team_id !== $campaign->team_id) {
            return response()->json(['message' => 'Player not on your team'], 403);
        }

        // Validate player has expiring contract
        if ($player->contract_years_remaining !== 1) {
            return response()->json([
                'message' => 'Only players with expiring contracts can be re-signed',
            ], 422);
        }

        $request->validate([
            'years' => 'required|integer|min:1|max:5',
        ]);

        $result = $this->financeService->resignPlayer(
            $campaign,
            $player,
            $request->input('years')
        );

        if (!$result['success']) {
            return response()->json([
                'message' => $result['error'] ?? 'Failed to re-sign player',
            ], 422);
        }

        return response()->json([
            'message' => $result['message'],
            'player' => $result['player'],
        ]);
    }

    /**
     * Sign a free agent.
     */
    public function signFreeAgent(Request $request, Campaign $campaign, string $playerId): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $result = $this->financeService->signFreeAgent($campaign, $playerId);

        if (!$result['success']) {
            return response()->json([
                'message' => $result['error'] ?? 'Failed to sign free agent',
            ], 422);
        }

        // Get updated summary
        $summary = $this->financeService->getFinanceSummary($campaign);

        return response()->json([
            'message' => $result['message'],
            'player' => $result['player'],
            'summary' => $summary,
        ]);
    }

    /**
     * Drop a player from the roster.
     */
    public function dropPlayer(Request $request, Campaign $campaign, Player $player): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Validate player belongs to user's team
        if ($player->campaign_id !== $campaign->id || $player->team_id !== $campaign->team_id) {
            return response()->json(['message' => 'Player not on your team'], 403);
        }

        $result = $this->financeService->dropPlayer($campaign, $player);

        if (!$result['success']) {
            return response()->json([
                'message' => $result['error'] ?? 'Failed to drop player',
            ], 422);
        }

        // Get updated summary
        $summary = $this->financeService->getFinanceSummary($campaign);

        return response()->json([
            'message' => $result['message'],
            'summary' => $summary,
        ]);
    }
}
