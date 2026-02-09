<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Team;
use App\Services\AITradeEvaluationService;
use App\Services\CampaignPlayerService;
use App\Services\DraftPickService;
use App\Services\TradeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TradeController extends Controller
{
    public function __construct(
        private TradeService $tradeService,
        private DraftPickService $draftPickService,
        private AITradeEvaluationService $aiEvaluationService,
        private CampaignPlayerService $playerService
    ) {}

    /**
     * Get all teams available for trading.
     */
    public function getTeams(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $teams = Team::where('campaign_id', $campaign->id)
            ->where('id', '!=', $campaign->team_id) // Exclude user's team
            ->get();

        $teamsData = $teams->map(function ($team) use ($campaign) {
            $context = $this->buildTeamContext($campaign, $team);
            $direction = $this->aiEvaluationService->analyzeTeamDirection($team, $context);
            $record = $context['standings'][$team->abbreviation] ?? ['wins' => 0, 'losses' => 0];

            return [
                'id' => $team->id,
                'name' => $team->name,
                'city' => $team->city,
                'abbreviation' => $team->abbreviation,
                'conference' => $team->conference,
                'division' => $team->division,
                'record' => [
                    'wins' => $record['wins'],
                    'losses' => $record['losses'],
                ],
                'direction' => $direction,
                'trade_interest' => $this->aiEvaluationService->getTradeInterest($team, $campaign),
                'cap_space' => $team->cap_space,
                'primary_color' => $team->primary_color,
                'secondary_color' => $team->secondary_color,
            ];
        });

        return response()->json([
            'teams' => $teamsData->sortBy('name')->values(),
        ]);
    }

    /**
     * Get detailed team info for trading.
     */
    public function getTeamDetails(Request $request, Campaign $campaign, Team $team): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        if ($team->campaign_id !== $campaign->id) {
            return response()->json(['message' => 'Team not in this campaign'], 400);
        }

        // Get roster
        $roster = $this->playerService->getTeamRoster($campaign->id, $team->abbreviation);

        // Format roster with trade-relevant info
        $formattedRoster = collect($roster)->map(function ($player) {
            $birthDate = $player['birthDate'] ?? $player['birth_date'] ?? null;
            $age = $birthDate ? now()->diffInYears($birthDate) : 25;

            return [
                'id' => $player['id'],
                'firstName' => $player['firstName'] ?? $player['first_name'] ?? '',
                'lastName' => $player['lastName'] ?? $player['last_name'] ?? '',
                'position' => $player['position'] ?? '',
                'overallRating' => $player['overallRating'] ?? $player['overall_rating'] ?? 75,
                'age' => $age,
                'contractSalary' => (int) ($player['contractSalary'] ?? $player['contract_salary'] ?? 0),
                'contractYearsRemaining' => $player['contractYearsRemaining'] ?? $player['contract_years_remaining'] ?? 1,
                'tradeValue' => $player['tradeValue'] ?? $player['trade_value'] ?? null,
            ];
        })->sortByDesc('overallRating')->values();

        // Get draft picks
        $picks = $this->draftPickService->getTeamPicksForTrade($campaign, $team->id);

        // Get team context
        $context = $this->buildTeamContext($campaign, $team);
        $direction = $this->aiEvaluationService->analyzeTeamDirection($team, $context);
        $record = $context['standings'][$team->abbreviation] ?? ['wins' => 0, 'losses' => 0];

        return response()->json([
            'team' => [
                'id' => $team->id,
                'name' => $team->name,
                'city' => $team->city,
                'abbreviation' => $team->abbreviation,
                'record' => $record,
                'direction' => $direction,
                'salary_cap' => $team->salary_cap,
                'total_payroll' => $team->total_payroll,
                'cap_space' => $team->cap_space,
            ],
            'roster' => $formattedRoster,
            'picks' => $picks,
        ]);
    }

    /**
     * Get user's tradeable assets.
     */
    public function getUserAssets(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $userTeam = $campaign->team;

        // Get roster from database
        $roster = $userTeam->players()->get()->map(function ($player) {
            return [
                'id' => $player->id,
                'firstName' => $player->first_name,
                'lastName' => $player->last_name,
                'position' => $player->position,
                'overallRating' => $player->overall_rating,
                'age' => $player->birth_date ? now()->diffInYears($player->birth_date) : 25,
                'contractSalary' => (int) $player->contract_salary,
                'contractYearsRemaining' => $player->contract_years_remaining,
                'tradeValue' => $player->trade_value,
            ];
        })->sortByDesc('overallRating')->values();

        // Get draft picks
        $picks = $this->draftPickService->getTeamPicksForTrade($campaign, $userTeam->id);

        return response()->json([
            'team' => [
                'id' => $userTeam->id,
                'name' => $userTeam->name,
                'abbreviation' => $userTeam->abbreviation,
                'salary_cap' => $userTeam->salary_cap,
                'total_payroll' => $userTeam->total_payroll,
                'cap_space' => $userTeam->cap_space,
            ],
            'roster' => $roster,
            'picks' => $picks,
        ]);
    }

    /**
     * Propose a trade to an AI team.
     */
    public function proposeTrade(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'aiTeamId' => 'required|exists:teams,id',
            'userGives' => 'required|array|min:1',
            'userGives.*.type' => 'required|in:player,pick',
            'userGives.*.playerId' => 'required_if:userGives.*.type,player',
            'userGives.*.pickId' => 'required_if:userGives.*.type,pick',
            'userReceives' => 'required|array|min:1',
            'userReceives.*.type' => 'required|in:player,pick',
            'userReceives.*.playerId' => 'required_if:userReceives.*.type,player',
            'userReceives.*.pickId' => 'required_if:userReceives.*.type,pick',
        ]);

        $aiTeam = Team::findOrFail($validated['aiTeamId']);

        if ($aiTeam->campaign_id !== $campaign->id) {
            return response()->json(['message' => 'Team not in this campaign'], 400);
        }

        // Validate salary cap
        $capValidation = $this->tradeService->validateSalaryCap(
            $validated['userGives'],
            $validated['userReceives'],
            $campaign
        );

        if (!$capValidation['valid']) {
            return response()->json([
                'decision' => 'invalid',
                'reason' => $capValidation['reason'],
                'salary_details' => $capValidation,
            ]);
        }

        // Evaluate trade from AI perspective
        $evaluation = $this->aiEvaluationService->evaluateTrade(
            [
                'aiReceives' => $validated['userGives'],
                'aiGives' => $validated['userReceives'],
            ],
            $aiTeam,
            $campaign
        );

        return response()->json([
            'decision' => $evaluation['decision'],
            'reason' => $evaluation['reason'],
            'team_direction' => $evaluation['team_direction'],
            'salary_details' => [
                'incoming' => $capValidation['incoming_salary'] ?? 0,
                'outgoing' => $capValidation['outgoing_salary'] ?? 0,
            ],
        ]);
    }

    /**
     * Execute an accepted trade.
     */
    public function executeTrade(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'aiTeamId' => 'required|exists:teams,id',
            'userGives' => 'required|array|min:1',
            'userGives.*.type' => 'required|in:player,pick',
            'userGives.*.playerId' => 'required_if:userGives.*.type,player',
            'userGives.*.pickId' => 'required_if:userGives.*.type,pick',
            'userReceives' => 'required|array|min:1',
            'userReceives.*.type' => 'required|in:player,pick',
            'userReceives.*.playerId' => 'required_if:userReceives.*.type,player',
            'userReceives.*.pickId' => 'required_if:userReceives.*.type,pick',
        ]);

        $aiTeam = Team::findOrFail($validated['aiTeamId']);

        if ($aiTeam->campaign_id !== $campaign->id) {
            return response()->json(['message' => 'Team not in this campaign'], 400);
        }

        // Build trade details
        $tradeDetails = $this->tradeService->buildTradeDetails(
            $campaign,
            $aiTeam,
            $validated['userGives'],
            $validated['userReceives']
        );

        // Execute the trade
        $trade = $this->tradeService->executeTrade($campaign, $tradeDetails);

        return response()->json([
            'success' => true,
            'trade' => [
                'id' => $trade->id,
                'trade_date' => $trade->trade_date->format('Y-m-d'),
                'teams' => $trade->teams,
                'assets' => $trade->assets,
            ],
            'message' => 'Trade completed successfully!',
        ]);
    }

    /**
     * Get trade history for the campaign.
     */
    public function getTradeHistory(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $history = $this->tradeService->getTradeHistory($campaign);

        return response()->json([
            'trades' => $history,
        ]);
    }

    /**
     * Get salary cap validation for a proposed trade.
     */
    public function validateTrade(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'userGives' => 'required|array',
            'userGives.*.type' => 'required|in:player,pick',
            'userGives.*.playerId' => 'required_if:userGives.*.type,player',
            'userGives.*.pickId' => 'required_if:userGives.*.type,pick',
            'userReceives' => 'required|array',
            'userReceives.*.type' => 'required|in:player,pick',
            'userReceives.*.playerId' => 'required_if:userReceives.*.type,player',
            'userReceives.*.pickId' => 'required_if:userReceives.*.type,pick',
        ]);

        $capValidation = $this->tradeService->validateSalaryCap(
            $validated['userGives'],
            $validated['userReceives'],
            $campaign
        );

        return response()->json($capValidation);
    }

    /**
     * Build team context for evaluation.
     */
    private function buildTeamContext(Campaign $campaign, Team $team): array
    {
        $season = $campaign->currentSeason;
        $standings = $season?->standings ?? ['east' => [], 'west' => []];

        // Count games played
        $gamesPlayed = 0;
        foreach (['east', 'west'] as $conf) {
            foreach ($standings[$conf] ?? [] as $standing) {
                $gamesPlayed = max($gamesPlayed, ($standing['wins'] ?? 0) + ($standing['losses'] ?? 0));
            }
        }

        // Flatten standings to abbreviation => record
        $flat = [];
        foreach (['east', 'west'] as $conf) {
            foreach ($standings[$conf] ?? [] as $standing) {
                $teamId = $standing['teamId'] ?? null;
                if ($teamId) {
                    $t = Team::find($teamId);
                    if ($t) {
                        $flat[$t->abbreviation] = [
                            'wins' => $standing['wins'] ?? 0,
                            'losses' => $standing['losses'] ?? 0,
                        ];
                    }
                }
            }
        }

        return [
            'standings' => $flat,
            'gamesPlayed' => $gamesPlayed,
            'season_phase' => $season?->phase ?? 'preseason',
        ];
    }
}
