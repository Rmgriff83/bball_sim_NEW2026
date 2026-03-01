<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class SyncController extends Controller
{
    /**
     * List all synced campaigns for the authenticated user.
     * GET /api/sync/campaigns
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
     * Push a campaign snapshot part to the server.
     * Accepts chunked uploads: part = "meta" | "players" | "seasons"
     * POST /api/sync/{clientId}/push
     */
    public function pushSnapshot(Request $request, string $clientId): JsonResponse
    {
        $part = $request->input('part');
        $userId = $request->user()->id;

        // Chunked upload: validate based on part type
        if ($part && in_array($part, ['meta', 'players', 'seasons'])) {
            return $this->pushSnapshotPart($request, $clientId, $part, $userId);
        }

        // Legacy: full snapshot push (backward compat)
        $validated = $request->validate([
            'campaign' => 'required|array',
            'teams' => 'required|array',
            'players' => 'required|array',
            'seasons' => 'required|array',
            'clientUpdatedAt' => 'required|string',
        ]);

        // Find or create the campaign record using client_id
        $campaign = Campaign::firstOrCreate(
            ['client_id' => $clientId, 'user_id' => $userId],
            [
                'name' => $validated['campaign']['name'] ?? 'Campaign',
                'current_date' => $validated['campaign']['currentDate'] ?? $validated['campaign']['current_date'] ?? '2025-10-21',
                'difficulty' => $validated['campaign']['difficulty'] ?? 'pro',
            ]
        );

        // Verify ownership
        if ($campaign->user_id !== $userId) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        try {
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

            $snapshotPath = "campaigns/{$clientId}/snapshot.json";
            Storage::put($snapshotPath, $compressed);

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
     * Handle a single chunked part upload.
     */
    private function pushSnapshotPart(Request $request, string $clientId, string $part, int $userId): JsonResponse
    {
        $campaign = Campaign::where('client_id', $clientId)
            ->where('user_id', $userId)
            ->first();

        // For the meta part, create the campaign record if needed
        if ($part === 'meta') {
            $request->validate([
                'campaign' => 'required|array',
                'teams' => 'required|array',
                'clientUpdatedAt' => 'required|string',
            ]);

            $campaignData = $request->input('campaign');

            $campaign = Campaign::firstOrCreate(
                ['client_id' => $clientId, 'user_id' => $userId],
                [
                    'name' => $campaignData['name'] ?? 'Campaign',
                    'current_date' => $campaignData['currentDate'] ?? $campaignData['current_date'] ?? '2025-10-21',
                    'difficulty' => $campaignData['difficulty'] ?? 'pro',
                ]
            );

            if ($campaign->user_id !== $userId) {
                return response()->json(['message' => 'Unauthorized'], 403);
            }

            $data = [
                'campaign' => $campaignData,
                'teams' => $request->input('teams'),
                'clientUpdatedAt' => $request->input('clientUpdatedAt'),
            ];
        } elseif ($part === 'players') {
            $request->validate([
                'players' => 'required|array',
                'clientUpdatedAt' => 'required|string',
            ]);

            if (!$campaign) {
                return response()->json(['message' => 'Campaign not found. Push meta part first.'], 404);
            }

            $data = [
                'players' => $request->input('players'),
                'clientUpdatedAt' => $request->input('clientUpdatedAt'),
            ];
        } else { // seasons
            $request->validate([
                'seasons' => 'required|array',
                'clientUpdatedAt' => 'required|string',
            ]);

            if (!$campaign) {
                return response()->json(['message' => 'Campaign not found. Push meta part first.'], 404);
            }

            $data = [
                'seasons' => $request->input('seasons'),
                'clientUpdatedAt' => $request->input('clientUpdatedAt'),
            ];
        }

        try {
            $json = json_encode($data, JSON_UNESCAPED_UNICODE);

            if ($json === false) {
                Log::error("Failed to encode {$part} JSON for campaign {$clientId}: " . json_last_error_msg());
                return response()->json(['message' => "Failed to encode {$part}"], 500);
            }

            $compressed = gzencode($json, 6);

            if ($compressed === false) {
                Log::error("Failed to compress {$part} for campaign {$clientId}");
                return response()->json(['message' => "Failed to compress {$part}"], 500);
            }

            $partPath = "campaigns/{$clientId}/{$part}.json.gz";
            Storage::put($partPath, $compressed);

            // Update campaign record on meta push
            if ($part === 'meta') {
                $campaign->update([
                    'name' => $request->input('campaign.name', $campaign->name),
                    'last_played_at' => now(),
                ]);
            }

            return response()->json([
                'success' => true,
                'part' => $part,
                'serverUpdatedAt' => $campaign->fresh()->updated_at->toISOString(),
            ]);
        } catch (\Exception $e) {
            Log::error("Error storing {$part} for campaign {$clientId}: " . $e->getMessage());
            return response()->json(['message' => "Failed to store {$part}"], 500);
        }
    }

    /**
     * Pull the full campaign snapshot from the server.
     * Reads chunked part files and combines them, with fallback to legacy snapshot.json.
     * GET /api/sync/{clientId}/pull
     */
    public function pullSnapshot(Request $request, string $clientId): JsonResponse
    {
        $userId = $request->user()->id;

        $campaign = Campaign::where('client_id', $clientId)
            ->where('user_id', $userId)
            ->first();

        if (!$campaign) {
            return response()->json(['message' => 'Campaign not found'], 404);
        }

        try {
            // Try chunked part files first
            $metaPath = "campaigns/{$clientId}/meta.json.gz";
            $playersPath = "campaigns/{$clientId}/players.json.gz";
            $seasonsPath = "campaigns/{$clientId}/seasons.json.gz";

            if (Storage::exists($metaPath)) {
                $snapshot = [];

                // Read meta part
                $metaData = $this->readCompressedJson($metaPath);
                if ($metaData) {
                    $snapshot['campaign'] = $metaData['campaign'] ?? null;
                    $snapshot['teams'] = $metaData['teams'] ?? [];
                    $snapshot['clientUpdatedAt'] = $metaData['clientUpdatedAt'] ?? null;
                }

                // Read players part
                if (Storage::exists($playersPath)) {
                    $playersData = $this->readCompressedJson($playersPath);
                    if ($playersData) {
                        $snapshot['players'] = $playersData['players'] ?? [];
                    }
                }

                // Read seasons part
                if (Storage::exists($seasonsPath)) {
                    $seasonsData = $this->readCompressedJson($seasonsPath);
                    if ($seasonsData) {
                        $snapshot['seasons'] = $seasonsData['seasons'] ?? [];
                    }
                }

                return response()->json($snapshot);
            }

            // Fallback: legacy monolithic snapshot.json
            $snapshotPath = "campaigns/{$clientId}/snapshot.json";

            if (!Storage::exists($snapshotPath)) {
                return response()->json(['message' => 'No snapshot available'], 404);
            }

            $snapshot = $this->readCompressedJson($snapshotPath);

            if ($snapshot === null) {
                return response()->json(['message' => 'Failed to read snapshot'], 500);
            }

            return response()->json($snapshot);
        } catch (\Exception $e) {
            Log::error("Error reading snapshot for campaign {$clientId}: " . $e->getMessage());
            return response()->json(['message' => 'Failed to read snapshot'], 500);
        }
    }

    /**
     * Read and decompress a gzipped JSON file from storage.
     */
    private function readCompressedJson(string $path): ?array
    {
        try {
            $compressed = Storage::get($path);
            $decompressed = gzdecode($compressed);

            if ($decompressed === false) {
                Log::error("Failed to decompress: {$path}");
                return null;
            }

            $data = json_decode($decompressed, true);

            if (json_last_error() !== JSON_ERROR_NONE) {
                Log::error("Failed to decode JSON from {$path}: " . json_last_error_msg());
                return null;
            }

            return $data;
        } catch (\Exception $e) {
            Log::error("Error reading {$path}: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Delete a campaign and its S3 data.
     * DELETE /api/sync/{clientId}
     */
    public function deleteCampaign(Request $request, string $clientId): JsonResponse
    {
        $userId = $request->user()->id;

        $campaign = Campaign::where('client_id', $clientId)
            ->where('user_id', $userId)
            ->first();

        if (!$campaign) {
            return response()->json(['message' => 'Campaign not found'], 404);
        }

        try {
            // Delete all S3 files for this campaign
            $directory = "campaigns/{$clientId}";
            Storage::deleteDirectory($directory);

            // Delete the database record
            $campaign->delete();

            return response()->json(['success' => true]);
        } catch (\Exception $e) {
            Log::error("Error deleting campaign {$clientId}: " . $e->getMessage());
            return response()->json(['message' => 'Failed to delete campaign data'], 500);
        }
    }
}
