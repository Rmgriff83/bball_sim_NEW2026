<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Services\CampaignPlayerService;
use App\Services\CampaignSeasonService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;

class SyncController extends Controller
{
    public function __construct(
        private CampaignSeasonService $seasonService,
        private CampaignPlayerService $playerService
    ) {}

    /**
     * Check if campaign needs syncing.
     * GET /api/campaigns/{campaign}/sync/status
     */
    public function status(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $serverUpdatedAt = $this->getServerUpdatedAt($campaign);

        return response()->json([
            'needsSync' => true, // Always allow sync check
            'serverUpdatedAt' => $serverUpdatedAt,
        ]);
    }

    /**
     * Pull latest campaign data from server.
     * GET /api/campaigns/{campaign}/sync/pull
     */
    public function pull(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Load campaign with relationships
        $campaign->load([
            'team.players' => function ($query) {
                $query->select([
                    'id', 'team_id', 'first_name', 'last_name', 'position',
                    'secondary_position', 'jersey_number', 'overall_rating',
                    'potential_rating', 'height_inches', 'weight_lbs', 'birth_date',
                    'attributes', 'badges', 'contract_years_remaining', 'contract_salary',
                    'is_injured', 'fatigue'
                ])->orderBy('overall_rating', 'desc');
            },
            'team.coach',
            'currentSeason',
        ]);

        $year = $campaign->currentSeason?->year ?? 2025;

        // Get season data
        $seasonData = $this->seasonService->loadSeason($campaign->id, $year) ?? [];
        $standings = $this->seasonService->getStandings($campaign->id, $year);

        // Get league players
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);

        $serverUpdatedAt = $this->getServerUpdatedAt($campaign);

        return response()->json([
            'campaign' => [
                'id' => $campaign->id,
                'name' => $campaign->name,
                'current_date' => $campaign->current_date->format('Y-m-d'),
                'game_year' => $campaign->game_year,
                'difficulty' => $campaign->difficulty,
                'settings' => $campaign->settings,
                'team' => $campaign->team,
                'roster' => $campaign->team?->players->map(function ($player) {
                    return [
                        'id' => $player->id,
                        'name' => $player->full_name,
                        'position' => $player->position,
                        'secondary_position' => $player->secondary_position,
                        'jersey_number' => $player->jersey_number,
                        'overall_rating' => $player->overall_rating,
                        'potential_rating' => $player->potential_rating,
                        'height' => $player->height_formatted,
                        'weight' => $player->weight_lbs,
                        'age' => $player->age,
                        'attributes' => $player->attributes,
                        'badges' => $player->getAllBadges(),
                        'contract' => [
                            'years_remaining' => $player->contract_years_remaining,
                            'salary' => $player->contract_salary,
                        ],
                        'is_injured' => $player->is_injured,
                        'fatigue' => $player->fatigue,
                    ];
                }),
                'coach' => $campaign->team?->coach,
            ],
            'season' => [
                'year' => $year,
                'phase' => $campaign->currentSeason?->phase,
                'standings' => $standings,
                'schedule' => $seasonData['schedule'] ?? [],
                'playerStats' => $seasonData['playerStats'] ?? [],
            ],
            'players' => [
                'players' => $leaguePlayers,
                'metadata' => [
                    'updatedAt' => $serverUpdatedAt,
                ],
            ],
            'metadata' => [
                'updatedAt' => $serverUpdatedAt,
            ],
        ]);
    }

    /**
     * Push local changes to server.
     * POST /api/campaigns/{campaign}/sync/push
     */
    public function push(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'seasons' => 'sometimes|array',
            'players' => 'sometimes|array',
            'clientUpdatedAt' => 'sometimes|string',
        ]);

        // Sync only handles JSON file data (AI teams, season data)
        // User team data (lineup, settings) is in MySQL and handled by direct API calls

        // Update season data if provided
        if (isset($validated['seasons'])) {
            foreach ($validated['seasons'] as $year => $seasonData) {
                if (isset($seasonData['standings'])) {
                    $this->seasonService->updateStandings($campaign->id, (int) $year, $seasonData['standings']);
                }
                if (isset($seasonData['playerStats'])) {
                    $this->seasonService->updatePlayerStatsBulk($campaign->id, (int) $year, $seasonData['playerStats']);
                }
                if (isset($seasonData['schedule'])) {
                    $this->seasonService->updateSchedule($campaign->id, (int) $year, $seasonData['schedule']);
                }
            }
        }

        // Update league players if provided
        if (isset($validated['players']['players'])) {
            $this->playerService->saveLeaguePlayers($campaign->id, $validated['players']['players']);
        }

        // Update the campaign's updated_at
        $campaign->touch();

        return response()->json([
            'success' => true,
            'serverUpdatedAt' => $campaign->fresh()->updated_at->toISOString(),
        ]);
    }

    /**
     * Get the latest update timestamp for a campaign.
     */
    private function getServerUpdatedAt(Campaign $campaign): string
    {
        // Check campaign updated_at
        $latestTime = $campaign->updated_at;

        // Check season file modification time
        $year = $campaign->currentSeason?->year ?? 2025;
        $seasonPath = "campaigns/{$campaign->id}/season_{$year}.json";
        if (Storage::exists($seasonPath)) {
            $seasonTime = Storage::lastModified($seasonPath);
            $latestTime = max($latestTime->timestamp, $seasonTime);
            $latestTime = \Carbon\Carbon::createFromTimestamp($latestTime);
        }

        // Check league players file modification time
        $playersPath = "campaigns/{$campaign->id}/league_players.json";
        if (Storage::exists($playersPath)) {
            $playersTime = Storage::lastModified($playersPath);
            $latestTime = max($latestTime->timestamp, $playersTime);
            $latestTime = \Carbon\Carbon::createFromTimestamp($latestTime);
        }

        return $latestTime instanceof \Carbon\Carbon
            ? $latestTime->toISOString()
            : \Carbon\Carbon::createFromTimestamp($latestTime)->toISOString();
    }
}
