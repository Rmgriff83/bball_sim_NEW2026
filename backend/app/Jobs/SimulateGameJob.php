<?php

namespace App\Jobs;

use App\Models\Campaign;
use App\Models\Coach;
use App\Models\Player;
use App\Models\SimulationResult;
use App\Models\Team;
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

    public function handle(GameSimulationService $simulationService, PlayoffService $playoffService): void
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

        // Write result to DB instead of JSON — bulk merge happens in then() callback
        SimulationResult::updateOrCreate(
            [
                'batch_id' => $this->batch()->id,
                'game_id' => $this->gameData['id'],
            ],
            [
                'campaign_id' => $this->campaignId,
                'game_date' => $this->gameDate,
                'home_team_id' => $this->homeTeamId,
                'away_team_id' => $this->awayTeamId,
                'home_score' => $result['home_score'],
                'away_score' => $result['away_score'],
                'home_conference' => $homeTeam->conference,
                'away_conference' => $awayTeam->conference,
                'box_score' => $result['box_score'],
                'quarter_scores' => $result['quarter_scores'] ?? null,
                'is_user_game' => $this->isUserGame,
                'is_playoff' => $this->gameData['isPlayoff'] ?? false,
            ]
        );

        // Per-player career stats (small DB updates, must remain per-job)
        $this->recordCareerStats($result['box_score']);

        // Update coach stats (2 small DB updates)
        $this->updateCoachStats($result['home_score'], $result['away_score'], $this->gameData['isPlayoff'] ?? false);

        // Process playoff game completion if applicable (series advancement must be per-job)
        if ($this->gameData['isPlayoff'] ?? false) {
            $this->processPlayoffGameCompletion($campaign, $playoffService, $result['home_score'], $result['away_score']);
        }
    }

    private function recordCareerStats(array $boxScore): void
    {
        $homeStarters = array_slice($boxScore['home'] ?? [], 0, 5);
        $awayStarters = array_slice($boxScore['away'] ?? [], 0, 5);
        $homeStarterIds = array_column($homeStarters, 'player_id');
        $awayStarterIds = array_column($awayStarters, 'player_id');

        // Batch load all players in one query
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
            if ($playerId) {
                $player = $players[$playerId] ?? null;
                if ($player) {
                    $started = in_array($playerId, $homeStarterIds);
                    $player->recordGameStats($playerStats, $started);
                }
            }
        }

        foreach ($boxScore['away'] ?? [] as $playerStats) {
            $playerId = $playerStats['player_id'] ?? $playerStats['playerId'] ?? null;
            if ($playerId) {
                $player = $players[$playerId] ?? null;
                if ($player) {
                    $started = in_array($playerId, $awayStarterIds);
                    $player->recordGameStats($playerStats, $started);
                }
            }
        }
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
