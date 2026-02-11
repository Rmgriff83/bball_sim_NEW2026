<?php

namespace App\Jobs;

use App\Models\Campaign;
use App\Models\Coach;
use App\Models\Player;
use App\Models\Team;
use App\Services\CampaignSeasonService;
use App\Services\GameSimulationService;
use App\Services\PlayoffService;
use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class SimulateGameJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;
    public $timeout = 120;

    public function __construct(
        public int $campaignId,
        public int $year,
        public array $gameData,
        public int $homeTeamId,
        public int $awayTeamId,
        public bool $isUserGame,
        public ?array $userLineup,
        public string $gameDate
    ) {}

    public function handle(CampaignSeasonService $seasonService, GameSimulationService $simulationService, PlayoffService $playoffService): void
    {
        if ($this->batch()?->cancelled()) {
            return;
        }

        $campaign = Campaign::find($this->campaignId);
        if (!$campaign) {
            Log::error("SimulateGameJob: Campaign {$this->campaignId} not found");
            return;
        }

        $homeTeam = Team::find($this->homeTeamId);
        $awayTeam = Team::find($this->awayTeamId);

        if (!$homeTeam || !$awayTeam) {
            Log::error("SimulateGameJob: Teams not found", [
                'homeTeamId' => $this->homeTeamId,
                'awayTeamId' => $this->awayTeamId,
            ]);
            return;
        }

        $gameLineup = $this->isUserGame ? $this->userLineup : null;

        // Simulate the game (skip animation data for AI-only games)
        $result = $simulationService->simulateFromData($campaign, $this->gameData, $homeTeam, $awayTeam, $gameLineup, $this->isUserGame);

        // Update game in JSON (defer write — flushSeason() handles the final save)
        $seasonService->updateGame($this->campaignId, $this->year, $this->gameData['id'], [
            'isComplete' => true,
            'homeScore' => $result['home_score'],
            'awayScore' => $result['away_score'],
            'boxScore' => $result['box_score'],
            'quarterScores' => $result['quarter_scores'] ?? null,
        ], $this->isUserGame, defer: true);

        // Update standings (defer write — flushSeason() handles the final save)
        $seasonService->updateStandingsAfterGame(
            $this->campaignId,
            $this->year,
            $this->homeTeamId,
            $this->awayTeamId,
            $result['home_score'],
            $result['away_score'],
            $homeTeam->conference,
            $awayTeam->conference,
            defer: true
        );

        // Update player stats
        $this->updatePlayerStats($seasonService, $result['box_score']);

        // Update coach stats
        $this->updateCoachStats($result['home_score'], $result['away_score'], $this->gameData['isPlayoff'] ?? false);

        // Process playoff game completion if applicable
        if ($this->gameData['isPlayoff'] ?? false) {
            $this->processPlayoffGameCompletion($campaign, $playoffService, $result['home_score'], $result['away_score']);
        }
    }

    private function updatePlayerStats(CampaignSeasonService $seasonService, array $boxScore): void
    {
        $homeStarters = array_slice($boxScore['home'] ?? [], 0, 5);
        $awayStarters = array_slice($boxScore['away'] ?? [], 0, 5);
        $homeStarterIds = array_column($homeStarters, 'player_id');
        $awayStarterIds = array_column($awayStarters, 'player_id');

        // Batch load all players in one query instead of individual Player::find() calls
        $allPlayerIds = [];
        foreach (['home', 'away'] as $side) {
            foreach ($boxScore[$side] ?? [] as $playerStats) {
                $playerId = $playerStats['player_id'] ?? $playerStats['playerId'] ?? null;
                if ($playerId) {
                    $allPlayerIds[] = $playerId;
                }
            }
        }
        $players = Player::whereIn('id', $allPlayerIds)->get()->keyBy('id');

        foreach ($boxScore['home'] ?? [] as $playerStats) {
            $playerId = $playerStats['player_id'] ?? $playerStats['playerId'] ?? null;
            $playerName = $playerStats['name'] ?? 'Unknown';

            if ($playerId) {
                $seasonService->updatePlayerStats(
                    $this->campaignId,
                    $this->year,
                    $playerId,
                    $playerName,
                    $this->homeTeamId,
                    $playerStats
                );

                $player = $players[$playerId] ?? null;
                if ($player) {
                    $started = in_array($playerId, $homeStarterIds);
                    $player->recordGameStats($playerStats, $started);
                }
            }
        }

        foreach ($boxScore['away'] ?? [] as $playerStats) {
            $playerId = $playerStats['player_id'] ?? $playerStats['playerId'] ?? null;
            $playerName = $playerStats['name'] ?? 'Unknown';

            if ($playerId) {
                $seasonService->updatePlayerStats(
                    $this->campaignId,
                    $this->year,
                    $playerId,
                    $playerName,
                    $this->awayTeamId,
                    $playerStats
                );

                $player = $players[$playerId] ?? null;
                if ($player) {
                    $started = in_array($playerId, $awayStarterIds);
                    $player->recordGameStats($playerStats, $started);
                }
            }
        }

        $seasonService->flushSeason($this->campaignId, $this->year);
    }

    private function updateCoachStats(int $homeScore, int $awayScore, bool $isPlayoff): void
    {
        $homeWon = $homeScore > $awayScore;

        $homeCoach = Coach::where('team_id', $this->homeTeamId)->first();
        if ($homeCoach) {
            $homeCoach->recordGameResult($homeWon, $isPlayoff);
        }

        $awayCoach = Coach::where('team_id', $this->awayTeamId)->first();
        if ($awayCoach) {
            $awayCoach->recordGameResult(!$homeWon, $isPlayoff);
        }
    }

    private function processPlayoffGameCompletion(Campaign $campaign, PlayoffService $playoffService, int $homeScore, int $awayScore): void
    {
        $seriesUpdate = $playoffService->updateSeriesAfterGame($campaign, $this->gameData, $homeScore, $awayScore);

        if (!$seriesUpdate) {
            return;
        }

        if ($seriesUpdate['seriesComplete']) {
            // Persist MVP awards
            if ($seriesUpdate['seriesMVP']) {
                $mvpPlayerId = $seriesUpdate['seriesMVP']['playerId'];

                if ($seriesUpdate['round'] === 3) {
                    $playoffService->persistPlayerAward($campaign, $mvpPlayerId, 'conference_finals_mvp', $this->year);
                } elseif ($seriesUpdate['round'] === 4) {
                    $playoffService->persistPlayerAward($campaign, $mvpPlayerId, 'finals_mvp', $this->year);
                    $winnerId = $seriesUpdate['winner']['teamId'];
                    $playoffService->persistChampionshipToRoster($campaign, $winnerId, $this->year);
                }
            }

            $playoffService->advanceWinnerToNextRound($campaign, $seriesUpdate);

            $nextRound = $seriesUpdate['round'] + 1;
            if ($nextRound <= 4) {
                $playoffService->generatePlayoffSchedule($campaign, $nextRound);
            }
        }
    }
}
