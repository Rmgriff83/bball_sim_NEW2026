<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Services\CampaignPlayerService;
use App\Services\CampaignSeasonService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class SyncController extends Controller
{
    public function __construct(
        private CampaignSeasonService $seasonService,
        private CampaignPlayerService $playerService
    ) {}

    /**
     * List all synced campaigns for the authenticated user.
     * GET /api/sync/campaigns
     *
     * Returns minimal campaign info so the client can check which
     * campaigns exist on the server but are missing locally.
     */
    public function listCampaigns(Request $request): JsonResponse
    {
        $campaigns = Campaign::where('user_id', $request->user()->id)
            ->whereNotNull('client_id')
            ->orderBy('updated_at', 'desc')
            ->get();

        return response()->json([
            'campaigns' => $campaigns->map(function ($campaign) {
                return [
                    'id' => $campaign->client_id,
                    'name' => $campaign->name,
                    'updatedAt' => $campaign->updated_at->toISOString(),
                ];
            }),
        ]);
    }

    /**
     * Push a full campaign snapshot to the server.
     * POST /api/sync/{clientId}/push
     *
     * Uses client_id (UUID) to identify the campaign. Auto-creates the
     * MySQL campaign record if it doesn't exist yet (client-side campaigns
     * are created in IndexedDB only).
     */
    public function pushSnapshot(Request $request, string $clientId): JsonResponse
    {
        $validated = $request->validate([
            'campaign' => 'required|array',
            'teams' => 'required|array',
            'players' => 'required|array',
            'seasons' => 'required|array',
            'clientUpdatedAt' => 'required|string',
        ]);

        $userId = $request->user()->id;

        // Find or create the campaign record using client_id
        $campaign = Campaign::firstOrCreate(
            ['client_id' => $clientId, 'user_id' => $userId],
            [
                'name' => $validated['campaign']['name'] ?? 'Campaign',
                'current_date' => $validated['campaign']['currentDate'] ?? $validated['campaign']['current_date'] ?? '2025-10-21',
                'game_year' => $validated['campaign']['gameYear'] ?? $validated['campaign']['game_year'] ?? 1,
                'difficulty' => $validated['campaign']['difficulty'] ?? 'pro',
            ]
        );

        // Verify ownership (in case someone tries a different user's client_id)
        if ($campaign->user_id !== $userId) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        try {
            // Encode and compress the full snapshot
            $json = json_encode($validated, JSON_UNESCAPED_UNICODE);

            if ($json === false) {
                Log::error("Failed to encode snapshot JSON for campaign {$clientId}: " . json_last_error_msg());
                return response()->json(['message' => 'Failed to encode snapshot'], 500);
            }

            $compressed = gzencode($json, 6);

            if ($compressed === false) {
                Log::error("Failed to compress snapshot for campaign {$clientId}");
                return response()->json(['message' => 'Failed to compress snapshot'], 500);
            }

            // Store the compressed snapshot in S3 using client_id as the directory
            $snapshotPath = "campaigns/{$clientId}/snapshot.json";
            Storage::put($snapshotPath, $compressed);

            // Update campaign name and timestamp
            $campaign->update([
                'name' => $validated['campaign']['name'] ?? $campaign->name,
                'last_played_at' => now(),
            ]);

            return response()->json([
                'success' => true,
                'serverUpdatedAt' => $campaign->fresh()->updated_at->toISOString(),
            ]);
        } catch (\Exception $e) {
            Log::error("Error storing snapshot for campaign {$clientId}: " . $e->getMessage());
            return response()->json(['message' => 'Failed to store snapshot'], 500);
        }
    }

    /**
     * Pull the full campaign snapshot from the server.
     * GET /api/sync/{clientId}/pull
     *
     * Reads the compressed snapshot.json from S3.
     */
    public function pullSnapshot(Request $request, string $clientId): JsonResponse
    {
        $userId = $request->user()->id;

        // Find campaign by client_id and verify ownership
        $campaign = Campaign::where('client_id', $clientId)
            ->where('user_id', $userId)
            ->first();

        if (!$campaign) {
            return response()->json(['message' => 'Campaign not found'], 404);
        }

        $snapshotPath = "campaigns/{$clientId}/snapshot.json";

        if (!Storage::exists($snapshotPath)) {
            return response()->json(['message' => 'No snapshot available'], 404);
        }

        try {
            $compressed = Storage::get($snapshotPath);
            $decompressed = gzdecode($compressed);

            if ($decompressed === false) {
                Log::error("Failed to decompress snapshot for campaign {$clientId}");
                return response()->json(['message' => 'Failed to decompress snapshot'], 500);
            }

            $snapshot = json_decode($decompressed, true);

            if (json_last_error() !== JSON_ERROR_NONE) {
                Log::error("Failed to decode snapshot JSON for campaign {$clientId}: " . json_last_error_msg());
                return response()->json(['message' => 'Invalid snapshot data'], 500);
            }

            return response()->json($snapshot);
        } catch (\Exception $e) {
            Log::error("Error reading snapshot for campaign {$clientId}: " . $e->getMessage());
            return response()->json(['message' => 'Failed to read snapshot'], 500);
        }
    }

    // -------------------------------------------------------------------------
    // Legacy endpoints (route-model-bound, for backwards compatibility)
    // -------------------------------------------------------------------------

    /**
     * Check if campaign needs syncing.
     * GET /api/campaigns/{campaign}/sync/status
     */
    public function status(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $serverUpdatedAt = $campaign->updated_at->toISOString();

        return response()->json([
            'needsSync' => true,
            'serverUpdatedAt' => $serverUpdatedAt,
        ]);
    }

    /**
     * Pull the full campaign snapshot from the server (legacy).
     * GET /api/campaigns/{campaign}/sync/pull
     */
    public function pull(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $snapshotPath = "campaigns/{$campaign->id}/snapshot.json";

        if (Storage::exists($snapshotPath)) {
            try {
                $compressed = Storage::get($snapshotPath);
                $decompressed = gzdecode($compressed);

                if ($decompressed === false) {
                    Log::error("Failed to decompress snapshot for campaign {$campaign->id}");
                    return response()->json(['message' => 'Failed to decompress snapshot'], 500);
                }

                $snapshot = json_decode($decompressed, true);

                if (json_last_error() !== JSON_ERROR_NONE) {
                    Log::error("Failed to decode snapshot JSON for campaign {$campaign->id}: " . json_last_error_msg());
                    return response()->json(['message' => 'Invalid snapshot data'], 500);
                }

                return response()->json($snapshot);
            } catch (\Exception $e) {
                Log::error("Error reading snapshot for campaign {$campaign->id}: " . $e->getMessage());
                return response()->json(['message' => 'Failed to read snapshot'], 500);
            }
        }

        return $this->_legacyPull($request, $campaign);
    }

    /**
     * Push a full campaign snapshot to the server (legacy).
     * POST /api/campaigns/{campaign}/sync/push
     */
    public function push(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'campaign' => 'required|array',
            'teams' => 'required|array',
            'players' => 'required|array',
            'seasons' => 'required|array',
            'clientUpdatedAt' => 'required|string',
        ]);

        try {
            $json = json_encode($validated, JSON_UNESCAPED_UNICODE);

            if ($json === false) {
                Log::error("Failed to encode snapshot JSON for campaign {$campaign->id}: " . json_last_error_msg());
                return response()->json(['message' => 'Failed to encode snapshot'], 500);
            }

            $compressed = gzencode($json, 6);

            if ($compressed === false) {
                Log::error("Failed to compress snapshot for campaign {$campaign->id}");
                return response()->json(['message' => 'Failed to compress snapshot'], 500);
            }

            $snapshotPath = "campaigns/{$campaign->id}/snapshot.json";
            Storage::put($snapshotPath, $compressed);

            $campaign->touch();

            return response()->json([
                'success' => true,
                'serverUpdatedAt' => $campaign->fresh()->updated_at->toISOString(),
            ]);
        } catch (\Exception $e) {
            Log::error("Error storing snapshot for campaign {$campaign->id}: " . $e->getMessage());
            return response()->json(['message' => 'Failed to store snapshot'], 500);
        }
    }

    /**
     * Legacy pull method for pre-migration campaigns.
     */
    private function _legacyPull(Request $request, Campaign $campaign): JsonResponse
    {
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
        $seasonData = $this->seasonService->loadSeason($campaign->id, $year) ?? [];
        $standings = $this->seasonService->getStandings($campaign->id, $year);
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        $serverUpdatedAt = $campaign->updated_at->toISOString();

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
}
