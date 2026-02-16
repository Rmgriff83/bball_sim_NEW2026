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
     * Push a full campaign snapshot to the server.
     * POST /api/sync/{clientId}/push
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
     * Pull the full campaign snapshot from the server.
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
}
