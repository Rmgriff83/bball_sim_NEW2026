<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\DraftPick;
use App\Models\Player;
use App\Models\Team;
use App\Models\Trade;
use Illuminate\Support\Facades\DB;

class TradeService
{
    public function __construct(
        private CampaignPlayerService $playerService,
        private DraftPickService $draftPickService,
        private CampaignSeasonService $seasonService
    ) {}

    /**
     * Validate trade meets salary cap rules.
     */
    public function validateSalaryCap(array $userGiving, array $userReceiving, Campaign $campaign): array
    {
        $capMode = $campaign->settings['salary_cap_mode'] ?? 'normal';

        if ($capMode === 'easy') {
            return ['valid' => true];
        }

        $outgoingSalary = $this->calculateTotalSalary($userGiving, $campaign);
        $incomingSalary = $this->calculateTotalSalary($userReceiving, $campaign);

        if ($capMode === 'normal') {
            // 125% + $100K rule
            if ($outgoingSalary > 0) {
                $maxIncoming = ($outgoingSalary * 1.25) + 100000;
                if ($incomingSalary > $maxIncoming) {
                    return [
                        'valid' => false,
                        'reason' => "Incoming salary ($" . number_format($incomingSalary) .
                                   ") exceeds 125% of outgoing ($" . number_format($maxIncoming) . ")",
                        'incoming_salary' => $incomingSalary,
                        'outgoing_salary' => $outgoingSalary,
                        'max_incoming' => $maxIncoming,
                    ];
                }
            }
        }

        if ($capMode === 'hard') {
            $team = $campaign->team;
            $netChange = $incomingSalary - $outgoingSalary;

            if ($team->total_payroll + $netChange > $team->salary_cap) {
                return [
                    'valid' => false,
                    'reason' => "Trade would put team over salary cap ($" .
                               number_format($team->salary_cap) . ")",
                    'current_payroll' => $team->total_payroll,
                    'net_change' => $netChange,
                    'salary_cap' => $team->salary_cap,
                ];
            }
        }

        return [
            'valid' => true,
            'incoming_salary' => $incomingSalary,
            'outgoing_salary' => $outgoingSalary,
        ];
    }

    /**
     * Calculate total salary of assets (players only).
     */
    private function calculateTotalSalary(array $assets, Campaign $campaign): float
    {
        $total = 0;

        foreach ($assets as $asset) {
            if ($asset['type'] === 'player') {
                $salary = $this->getPlayerSalary($asset['playerId'], $campaign);
                $total += $salary;
            }
        }

        return $total;
    }

    /**
     * Get player salary from DB or JSON.
     */
    private function getPlayerSalary($playerId, Campaign $campaign): float
    {
        // Try database first
        $dbPlayer = Player::where('campaign_id', $campaign->id)
            ->where('id', $playerId)
            ->first();

        if ($dbPlayer) {
            return (float) $dbPlayer->contract_salary;
        }

        // Try JSON players
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        foreach ($leaguePlayers as $player) {
            if (($player['id'] ?? '') == $playerId) {
                return (float) ($player['contractSalary'] ?? $player['contract_salary'] ?? 0);
            }
        }

        return 0;
    }

    /**
     * Get player data from DB or JSON.
     */
    public function getPlayer($playerId, Campaign $campaign): ?array
    {
        // Try database first
        $dbPlayer = Player::where('campaign_id', $campaign->id)
            ->where('id', $playerId)
            ->first();

        if ($dbPlayer) {
            return [
                'id' => $dbPlayer->id,
                'firstName' => $dbPlayer->first_name,
                'lastName' => $dbPlayer->last_name,
                'position' => $dbPlayer->position,
                'secondaryPosition' => $dbPlayer->secondary_position,
                'overallRating' => $dbPlayer->overall_rating,
                'age' => $dbPlayer->birth_date ? (int) abs(now()->diffInYears($dbPlayer->birth_date)) : 25,
                'contractSalary' => (float) $dbPlayer->contract_salary,
                'tradeValue' => $dbPlayer->trade_value,
                'tradeValueTotal' => $dbPlayer->trade_value_total,
                'teamId' => $dbPlayer->team_id,
                'isDbPlayer' => true,
            ];
        }

        // Try JSON players
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        foreach ($leaguePlayers as $player) {
            if (($player['id'] ?? '') == $playerId) {
                $birthDate = $player['birthDate'] ?? null;
                $age = $birthDate ? (int) abs(now()->diffInYears($birthDate)) : 25;

                return [
                    'id' => $player['id'],
                    'firstName' => $player['firstName'],
                    'lastName' => $player['lastName'],
                    'position' => $player['position'],
                    'secondaryPosition' => $player['secondaryPosition'] ?? null,
                    'overallRating' => $player['overallRating'],
                    'age' => $age,
                    'contractSalary' => (float) ($player['contractSalary'] ?? $player['contract_salary'] ?? 0),
                    'tradeValue' => $player['tradeValue'] ?? null,
                    'tradeValueTotal' => $player['tradeValueTotal'] ?? null,
                    'teamAbbreviation' => $player['teamAbbreviation'],
                    'isDbPlayer' => false,
                ];
            }
        }

        return null;
    }

    /**
     * Execute an accepted trade.
     */
    public function executeTrade(Campaign $campaign, array $tradeDetails): Trade
    {
        return DB::transaction(function () use ($campaign, $tradeDetails) {
            // Create trade record
            $trade = Trade::create([
                'campaign_id' => $campaign->id,
                'season_id' => $campaign->current_season_id,
                'trade_date' => $campaign->current_date,
                'details' => $tradeDetails,
            ]);

            // Move players and picks
            foreach ($tradeDetails['assets'] as $asset) {
                if ($asset['type'] === 'player') {
                    $this->movePlayer($campaign, $asset['playerId'], $asset['from'], $asset['to']);
                } elseif ($asset['type'] === 'pick') {
                    $this->transferPick($asset['pickId'], $asset['to']);
                }
            }

            // Recalculate team payrolls
            $teamIds = array_unique($tradeDetails['teams']);
            $this->recalculatePayrolls($campaign, $teamIds);

            return $trade;
        });
    }

    /**
     * Move player to new team - PERMANENTLY updates player's team assignment.
     * Also handles migrating player stats to the new player ID/team.
     * - Database players: Updates team_id foreign key
     * - JSON players: Updates teamAbbreviation field
     */
    private function movePlayer(Campaign $campaign, $playerId, $fromTeamId, $toTeamId): void
    {
        $toTeam = Team::find($toTeamId);
        $season = $campaign->currentSeason;
        $seasonYear = $season?->year ?? now()->year;

        // Get player name for stats migration
        $playerData = $this->getPlayer($playerId, $campaign);
        $playerName = ($playerData['firstName'] ?? '') . ' ' . ($playerData['lastName'] ?? '');

        if ($campaign->team_id == $toTeamId) {
            // Moving TO user's team (JSON -> DB)
            $oldPlayerId = (string) $playerId;
            $newPlayer = $this->playerService->movePlayerToDatabase($campaign->id, $playerId, $toTeamId);

            if ($newPlayer) {
                // Migrate stats from old JSON player ID to new DB player ID
                $this->seasonService->migratePlayerStats(
                    $campaign->id,
                    $seasonYear,
                    $oldPlayerId,
                    (string) $newPlayer->id,
                    $toTeamId,
                    $playerName
                );
            }
        } elseif ($campaign->team_id == $fromTeamId) {
            // Moving FROM user's team (DB -> JSON)
            // The player ID is preserved when moving to JSON
            $oldPlayerId = (string) $playerId;
            $this->playerService->movePlayerToJson($campaign->id, $playerId, $toTeam->abbreviation);

            // Update team in stats (ID stays the same)
            $this->seasonService->updatePlayerStatsTeam(
                $campaign->id,
                $seasonYear,
                $oldPlayerId,
                $toTeamId
            );
        } else {
            // AI to AI trade - update JSON file
            $this->playerService->updateLeaguePlayer($campaign->id, $playerId, [
                'teamAbbreviation' => $toTeam->abbreviation,
            ]);

            // Update team in stats
            $this->seasonService->updatePlayerStatsTeam(
                $campaign->id,
                $seasonYear,
                (string) $playerId,
                $toTeamId
            );
        }
    }

    /**
     * Transfer draft pick ownership.
     */
    private function transferPick(int $pickId, int $newOwnerId): void
    {
        DraftPick::where('id', $pickId)->update([
            'current_owner_id' => $newOwnerId,
            'is_traded' => true,
        ]);
    }

    /**
     * Recalculate team payrolls after trade.
     */
    private function recalculatePayrolls(Campaign $campaign, array $teamIds): void
    {
        foreach ($teamIds as $teamId) {
            $team = Team::find($teamId);
            if (!$team) continue;

            if ($teamId == $campaign->team_id) {
                // User team - sum from database players
                $totalPayroll = Player::where('campaign_id', $campaign->id)
                    ->where('team_id', $teamId)
                    ->sum('contract_salary');
            } else {
                // AI team - sum from JSON players
                $roster = $this->playerService->getTeamRoster($campaign->id, $team->abbreviation);
                $totalPayroll = collect($roster)->sum(fn($p) =>
                    $p['contractSalary'] ?? $p['contract_salary'] ?? 0
                );
            }

            $team->update(['total_payroll' => $totalPayroll]);
        }
    }

    /**
     * Build trade details array from proposal.
     */
    public function buildTradeDetails(
        Campaign $campaign,
        Team $aiTeam,
        array $userGives,
        array $userReceives
    ): array {
        $assets = [];
        $userTeam = $campaign->team;

        // User giving assets (going to AI team)
        foreach ($userGives as $asset) {
            if ($asset['type'] === 'player') {
                $player = $this->getPlayer($asset['playerId'], $campaign);
                $assets[] = [
                    'type' => 'player',
                    'playerId' => $asset['playerId'],
                    'playerName' => ($player['firstName'] ?? '') . ' ' . ($player['lastName'] ?? ''),
                    'from' => $userTeam->id,
                    'to' => $aiTeam->id,
                    'salary' => $player['contractSalary'] ?? 0,
                ];
            } elseif ($asset['type'] === 'pick') {
                $pick = DraftPick::find($asset['pickId']);
                $assets[] = [
                    'type' => 'pick',
                    'pickId' => $asset['pickId'],
                    'pickDisplay' => $pick?->display_name ?? 'Unknown Pick',
                    'from' => $userTeam->id,
                    'to' => $aiTeam->id,
                ];
            }
        }

        // User receiving assets (coming from AI team)
        foreach ($userReceives as $asset) {
            if ($asset['type'] === 'player') {
                $player = $this->getPlayer($asset['playerId'], $campaign);
                $assets[] = [
                    'type' => 'player',
                    'playerId' => $asset['playerId'],
                    'playerName' => ($player['firstName'] ?? '') . ' ' . ($player['lastName'] ?? ''),
                    'from' => $aiTeam->id,
                    'to' => $userTeam->id,
                    'salary' => $player['contractSalary'] ?? 0,
                ];
            } elseif ($asset['type'] === 'pick') {
                $pick = DraftPick::find($asset['pickId']);
                $assets[] = [
                    'type' => 'pick',
                    'pickId' => $asset['pickId'],
                    'pickDisplay' => $pick?->display_name ?? 'Unknown Pick',
                    'from' => $aiTeam->id,
                    'to' => $userTeam->id,
                ];
            }
        }

        return [
            'teams' => [$userTeam->id, $aiTeam->id],
            'team_names' => [
                $userTeam->id => $userTeam->name,
                $aiTeam->id => $aiTeam->name,
            ],
            'assets' => $assets,
        ];
    }

    /**
     * Get trade history for a campaign.
     */
    public function getTradeHistory(Campaign $campaign): array
    {
        return Trade::where('campaign_id', $campaign->id)
            ->orderByDesc('trade_date')
            ->get()
            ->map(function ($trade) {
                return [
                    'id' => $trade->id,
                    'trade_date' => $trade->trade_date->format('Y-m-d'),
                    'teams' => $trade->teams,
                    'team_names' => $trade->details['team_names'] ?? [],
                    'assets' => $trade->assets,
                ];
            })
            ->toArray();
    }
}
