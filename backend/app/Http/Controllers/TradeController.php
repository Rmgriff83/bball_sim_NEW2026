<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\NewsEvent;
use App\Models\Team;
use App\Models\TradeProposal;
use App\Services\AITradeEvaluationService;
use App\Services\AITradeProposalService;
use App\Services\CampaignPlayerService;
use App\Services\CampaignSeasonService;
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
        private CampaignPlayerService $playerService,
        private AITradeProposalService $proposalService,
        private CampaignSeasonService $seasonService
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
            ->where('id', '!=', $campaign->team_id)
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

        $roster = $this->playerService->getTeamRoster($campaign->id, $team->abbreviation);

        $formattedRoster = collect($roster)->map(function ($player) {
            $birthDate = $player['birthDate'] ?? $player['birth_date'] ?? null;
            $age = $birthDate ? (int) abs(now()->diffInYears($birthDate)) : 25;

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

        $picks = $this->draftPickService->getTeamPicksForTrade($campaign, $team->id);

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

        $roster = $userTeam->players()->get()->map(function ($player) {
            return [
                'id' => $player->id,
                'firstName' => $player->first_name,
                'lastName' => $player->last_name,
                'position' => $player->position,
                'overallRating' => $player->overall_rating,
                'age' => $player->birth_date ? (int) abs(now()->diffInYears($player->birth_date)) : 25,
                'contractSalary' => (int) $player->contract_salary,
                'contractYearsRemaining' => $player->contract_years_remaining,
                'tradeValue' => $player->trade_value,
            ];
        })->sortByDesc('overallRating')->values();

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

        // Check trade deadline
        if (!$this->proposalService->isBeforeDeadline($campaign)) {
            return response()->json(['message' => 'The trade deadline has passed.'], 400);
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

        // Check trade deadline
        if (!$this->proposalService->isBeforeDeadline($campaign)) {
            return response()->json(['message' => 'The trade deadline has passed.'], 400);
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

        $tradeDetails = $this->tradeService->buildTradeDetails(
            $campaign,
            $aiTeam,
            $validated['userGives'],
            $validated['userReceives']
        );

        $trade = $this->tradeService->executeTrade($campaign, $tradeDetails);

        // Create trade completed news
        $this->createTradeCompletedNews($campaign, $tradeDetails);

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
     * Get pending AI trade proposals for the user.
     */
    public function getProposals(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Expire stale proposals first
        $this->proposalService->expireStaleProposals($campaign);

        $proposals = TradeProposal::where('campaign_id', $campaign->id)
            ->where('status', 'pending')
            ->with('proposingTeam')
            ->orderBy('created_at', 'desc')
            ->get();

        $enriched = $proposals->map(function ($proposal) use ($campaign) {
            $proposalData = $proposal->proposal;

            // Enrich AI gives (what the user would receive)
            $aiGives = collect($proposalData['aiGives'] ?? [])->map(function ($asset) use ($campaign) {
                if ($asset['type'] === 'player') {
                    $player = $this->aiEvaluationService->getPlayer($asset['playerId'], $campaign);
                    return array_merge($asset, ['player' => $player]);
                }
                if ($asset['type'] === 'pick') {
                    $pick = \App\Models\DraftPick::find($asset['pickId']);
                    return array_merge($asset, ['pick' => $pick?->toArray()]);
                }
                return $asset;
            });

            // Enrich AI receives (what the user would give up)
            $aiReceives = collect($proposalData['aiReceives'] ?? [])->map(function ($asset) use ($campaign) {
                if ($asset['type'] === 'player') {
                    $player = $this->aiEvaluationService->getPlayer($asset['playerId'], $campaign);
                    return array_merge($asset, ['player' => $player]);
                }
                if ($asset['type'] === 'pick') {
                    $pick = \App\Models\DraftPick::find($asset['pickId']);
                    return array_merge($asset, ['pick' => $pick?->toArray()]);
                }
                return $asset;
            });

            return [
                'id' => $proposal->id,
                'proposing_team' => [
                    'id' => $proposal->proposingTeam->id,
                    'name' => $proposal->proposingTeam->name,
                    'city' => $proposal->proposingTeam->city,
                    'abbreviation' => $proposal->proposingTeam->abbreviation,
                    'primary_color' => $proposal->proposingTeam->primary_color,
                    'secondary_color' => $proposal->proposingTeam->secondary_color,
                ],
                'ai_gives' => $aiGives,
                'ai_receives' => $aiReceives,
                'reason' => $proposal->reason,
                'expires_at' => $proposal->expires_at->format('Y-m-d'),
                'created_at' => $proposal->created_at->toISOString(),
            ];
        });

        return response()->json(['proposals' => $enriched]);
    }

    /**
     * Accept an AI trade proposal.
     */
    public function acceptProposal(Request $request, Campaign $campaign, int $id): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Check trade deadline
        if (!$this->proposalService->isBeforeDeadline($campaign)) {
            return response()->json(['message' => 'The trade deadline has passed.'], 400);
        }

        $proposal = TradeProposal::where('campaign_id', $campaign->id)
            ->where('id', $id)
            ->firstOrFail();

        if ($proposal->status !== 'pending') {
            return response()->json(['message' => 'This proposal is no longer pending.'], 400);
        }

        if ($proposal->isExpired()) {
            $proposal->update(['status' => 'expired']);
            return response()->json(['message' => 'This proposal has expired.'], 400);
        }

        $aiTeam = Team::findOrFail($proposal->proposing_team_id);
        $proposalData = $proposal->proposal;

        // The AI gives = user receives, AI receives = user gives
        $userGives = $proposalData['aiReceives'];
        $userReceives = $proposalData['aiGives'];

        // Build and execute trade
        $tradeDetails = $this->tradeService->buildTradeDetails(
            $campaign,
            $aiTeam,
            $userGives,
            $userReceives
        );

        $trade = $this->tradeService->executeTrade($campaign, $tradeDetails);

        // Mark proposal as accepted
        $proposal->update(['status' => 'accepted']);

        // Create trade completed news
        $this->createTradeCompletedNews($campaign, $tradeDetails);

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
     * Reject an AI trade proposal.
     */
    public function rejectProposal(Request $request, Campaign $campaign, int $id): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $proposal = TradeProposal::where('campaign_id', $campaign->id)
            ->where('id', $id)
            ->firstOrFail();

        if ($proposal->status !== 'pending') {
            return response()->json(['message' => 'This proposal is no longer pending.'], 400);
        }

        $proposal->update(['status' => 'rejected']);

        return response()->json([
            'success' => true,
            'message' => 'Trade proposal rejected.',
        ]);
    }

    /**
     * Create news event for a completed trade.
     */
    private function createTradeCompletedNews(Campaign $campaign, array $tradeDetails): void
    {
        $playerAssets = array_filter($tradeDetails['assets'], fn($a) => $a['type'] === 'player');
        $firstPlayer = !empty($playerAssets) ? array_values($playerAssets)[0] : null;
        $playerName = $firstPlayer['playerName'] ?? 'assets';

        $teamNames = $tradeDetails['team_names'] ?? [];
        $teamList = implode(' and ', array_values($teamNames));

        NewsEvent::create([
            'campaign_id' => $campaign->id,
            'event_type' => 'trade',
            'headline' => "{$playerName} traded in deal between {$teamList}",
            'body' => "A trade has been completed between {$teamList} involving {$playerName}.",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Build team context for evaluation.
     */
    private function buildTeamContext(Campaign $campaign, Team $team): array
    {
        $season = $campaign->currentSeason;
        $year = $season?->year ?? $campaign->game_year ?? 2025;
        $standings = $this->seasonService->getStandings($campaign->id, $year);

        $gamesPlayed = 0;
        foreach (['east', 'west'] as $conf) {
            foreach ($standings[$conf] ?? [] as $standing) {
                $gamesPlayed = max($gamesPlayed, ($standing['wins'] ?? 0) + ($standing['losses'] ?? 0));
            }
        }

        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('id');
        $flat = [];
        foreach (['east', 'west'] as $conf) {
            foreach ($standings[$conf] ?? [] as $standing) {
                $teamId = $standing['teamId'] ?? null;
                $t = $teamId ? ($teams[$teamId] ?? null) : null;
                if ($t) {
                    $flat[$t->abbreviation] = [
                        'wins' => $standing['wins'] ?? 0,
                        'losses' => $standing['losses'] ?? 0,
                    ];
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
