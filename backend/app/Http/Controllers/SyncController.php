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
     * Accepts chunked uploads: part = "meta" | "players" | "players_user" | "players_ai" | "players_fa" | "seasons" | "headshots"
     * POST /api/sync/{clientId}/push
     */
    public function pushSnapshot(Request $request, string $clientId): JsonResponse
    {
        // Large part payloads (players_fa grows with every retired player
        // across a campaign's life) exist in memory several times over
        // during parse/validate/encode — big campaigns fatal'd at the
        // default 128M (Validator OOM in production). Same ceiling as
        // pullSnapshot.
        ini_set('memory_limit', '512M');

        $part = $request->input('part');
        $userId = $request->user()->id;

        // Chunked upload: validate based on part type
        if ($part && in_array($part, ['meta', 'players', 'players_user', 'players_ai', 'players_fa', 'seasons', 'headshots'])) {
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

        // Find or create the campaign record using client_id. withTrashed +
        // restore: a push for a soft-deleted campaign resurrects it (same
        // net behavior as the old hard-delete + recreate, without tripping
        // the unique client_id constraint on the tombstoned row).
        $campaign = Campaign::withTrashed()
            ->where('client_id', $clientId)
            ->where('user_id', $userId)
            ->first();

        if ($campaign && $campaign->trashed()) {
            $campaign->restore();
        }

        if (!$campaign) {
            $campaign = Campaign::create([
                'client_id' => $clientId,
                'user_id' => $userId,
                'name' => $validated['campaign']['name'] ?? 'Campaign',
                'current_date' => $validated['campaign']['currentDate'] ?? $validated['campaign']['current_date'] ?? '2025-10-21',
                'difficulty' => $validated['campaign']['difficulty'] ?? 'pro',
            ]);
        }

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

            // withTrashed + restore: see pushSnapshot — a meta push for a
            // soft-deleted campaign resurrects it instead of 500ing on the
            // unique client_id constraint.
            $campaign = Campaign::withTrashed()
                ->where('client_id', $clientId)
                ->where('user_id', $userId)
                ->first();

            if ($campaign && $campaign->trashed()) {
                $campaign->restore();
            }

            if (!$campaign) {
                $campaign = Campaign::create([
                    'client_id' => $clientId,
                    'user_id' => $userId,
                    'name' => $campaignData['name'] ?? 'Campaign',
                    'current_date' => $campaignData['currentDate'] ?? $campaignData['current_date'] ?? '2025-10-21',
                    'difficulty' => $campaignData['difficulty'] ?? 'pro',
                ]);
            }

            if ($campaign->user_id !== $userId) {
                return response()->json(['message' => 'Unauthorized'], 403);
            }

            $data = [
                'campaign' => $campaignData,
                'teams' => $request->input('teams'),
                'clientUpdatedAt' => $request->input('clientUpdatedAt'),
            ];
        } elseif (in_array($part, ['players', 'players_user', 'players_ai', 'players_fa'])) {
            // Manual checks instead of $request->validate(): the Validator
            // deep-copies its data, which doubles a potentially huge players
            // array in memory (players_fa OOM'd in production). Same
            // contract: 422 with a message on bad input.
            $players = $request->input('players');
            $clientUpdatedAt = $request->input('clientUpdatedAt');
            if (!is_array($players) || !is_string($clientUpdatedAt) || $clientUpdatedAt === '') {
                return response()->json(['message' => 'Invalid players payload.'], 422);
            }

            if (!$campaign) {
                return response()->json(['message' => 'Campaign not found. Push meta part first.'], 404);
            }

            $data = [
                'players' => $players,
                'clientUpdatedAt' => $clientUpdatedAt,
            ];
        } elseif ($part === 'seasons') {
            // Manual checks — same Validator-copy avoidance as the player
            // parts (multi-season payloads are the other big array).
            $seasons = $request->input('seasons');
            $clientUpdatedAt = $request->input('clientUpdatedAt');
            if (!is_array($seasons) || $seasons === [] || !is_string($clientUpdatedAt) || $clientUpdatedAt === '') {
                return response()->json(['message' => 'Invalid seasons payload.'], 422);
            }

            if (!$campaign) {
                return response()->json(['message' => 'Campaign not found. Push meta part first.'], 404);
            }

            $data = [
                'seasons' => $seasons,
                'clientUpdatedAt' => $clientUpdatedAt,
            ];
        } else { // headshots
            // Entitlement gate — only users who own the headshot_editor unlock
            // can persist custom headshots. The frontend hides the editor UI
            // for unentitled users, but this is the actual security boundary:
            // a forged request with valid auth still gets rejected here.
            $user = $request->user();
            $profile = $user ? $user->profile : null;
            if (!$profile || !$profile->hasUnlock('headshot_editor')) {
                return response()->json([
                    'error' => 'feature_not_unlocked',
                    'feature' => 'headshot_editor',
                ], 403);
            }

            $request->validate([
                'headshots' => 'present|array',
                'headshots.*.campaignId' => 'sometimes',
                'headshots.*.playerId' => 'required',
                // 250KB cap — composed headshots with piece-wrapped face
                // variants (e.g. the slim face alone is ~70KB) can easily
                // exceed the old 50KB limit once you add hair/eyes/etc.
                'headshots.*.svgContent' => 'required|string|max:250000',
                'clientUpdatedAt' => 'required|string',
            ]);

            if (!$campaign) {
                return response()->json(['message' => 'Campaign not found. Push meta part first.'], 404);
            }

            $data = [
                'headshots' => $request->input('headshots'),
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

            // Minimal audit trail — lets support reconstruct when a campaign
            // last landed (and which parts) after a data-loss report.
            Log::info("Sync push ok: user={$userId} campaign={$clientId} part={$part}");

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
     * Pull a campaign snapshot from the server.
     *
     * Chunked (preferred): GET /api/sync/{clientId}/pull?part=meta|players_user|...
     * returns ONE part's stored JSON verbatim — no decode/re-encode, near-zero
     * memory overhead.
     *
     * Legacy (no ?part): reads all chunked part files and combines them into a
     * single JSON response, with fallback to legacy snapshot.json. Kept for
     * old clients.
     *
     * GET /api/sync/{clientId}/pull
     */
    public function pullSnapshot(Request $request, string $clientId)
    {
        // The combined legacy path holds the whole snapshot in memory several
        // times over (gunzip + json_decode each part, merge, then re-encode in
        // response()->json). Large campaigns (multi-season saves, custom SVG
        // headshots) blew the default 128M limit in production — the OOM
        // 500s made client-side restores fail silently and campaigns look
        // deleted. Raise the ceiling for this endpoint; the chunked ?part
        // path below avoids the problem structurally, and legacy pulls fade
        // out as clients adopt it.
        ini_set('memory_limit', '512M');

        $userId = $request->user()->id;

        $campaign = Campaign::where('client_id', $clientId)
            ->where('user_id', $userId)
            ->first();

        if (!$campaign) {
            return response()->json(['message' => 'Campaign not found'], 404);
        }

        $part = $request->query('part');
        if ($part && in_array($part, ['meta', 'players', 'players_user', 'players_ai', 'players_fa', 'seasons', 'headshots'])) {
            return $this->pullSnapshotPart($clientId, $part);
        }

        try {
            // Try chunked part files first
            $metaPath = "campaigns/{$clientId}/meta.json.gz";
            $playersPath = "campaigns/{$clientId}/players.json.gz";
            $playersUserPath = "campaigns/{$clientId}/players_user.json.gz";
            $playersAiPath = "campaigns/{$clientId}/players_ai.json.gz";
            $playersFaPath = "campaigns/{$clientId}/players_fa.json.gz";
            $seasonsPath = "campaigns/{$clientId}/seasons.json.gz";
            $headshotsPath = "campaigns/{$clientId}/headshots.json.gz";

            if (Storage::exists($metaPath)) {
                $snapshot = [];

                // Read meta part
                $metaData = $this->readCompressedJson($metaPath);
                if ($metaData) {
                    $snapshot['campaign'] = $metaData['campaign'] ?? null;
                    $snapshot['teams'] = $metaData['teams'] ?? [];
                    $snapshot['clientUpdatedAt'] = $metaData['clientUpdatedAt'] ?? null;
                }

                // Read players: prefer split files (players_user + players_ai + players_fa)
                // and fall back to legacy single players.json.gz if any split file is missing.
                $haveSplit = Storage::exists($playersUserPath)
                    && Storage::exists($playersAiPath)
                    && Storage::exists($playersFaPath);

                if ($haveSplit) {
                    $combined = [];
                    foreach ([$playersUserPath, $playersAiPath, $playersFaPath] as $path) {
                        $partData = $this->readCompressedJson($path);
                        if ($partData && isset($partData['players']) && is_array($partData['players'])) {
                            foreach ($partData['players'] as $p) {
                                $combined[] = $p;
                            }
                        }
                    }
                    $snapshot['players'] = $combined;
                } elseif (Storage::exists($playersPath)) {
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

                // Read custom headshots — returned regardless of current
                // entitlement state, since they were validly created and a
                // refund/revocation shouldn't silently strip the user's
                // existing work. Only NEW writes are gated.
                if (Storage::exists($headshotsPath)) {
                    $headshotsData = $this->readCompressedJson($headshotsPath);
                    if ($headshotsData) {
                        $snapshot['headshots'] = $headshotsData['headshots'] ?? [];
                    }
                }

                return response()->json($snapshot)
                    ->header('Cache-Control', 'no-cache, no-store, must-revalidate');
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

            return response()->json($snapshot)
                ->header('Cache-Control', 'no-cache, no-store, must-revalidate');
        } catch (\Exception $e) {
            Log::error("Error reading snapshot for campaign {$clientId}: " . $e->getMessage());
            return response()->json(['message' => 'Failed to read snapshot'], 500);
        }
    }

    /**
     * Return a single stored snapshot part verbatim. The stored .gz already
     * IS the JSON payload the client pushed ({campaign,teams,...} for meta,
     * {players,...} for player parts, etc.), so we gunzip and stream the raw
     * string — no json_decode/encode, keeping memory flat regardless of
     * campaign size.
     *
     * 404 here means "this part file doesn't exist" (e.g. a legacy campaign
     * with only snapshot.json) — the client falls back to the legacy
     * combined pull. "Campaign not found" 404s are returned by the caller
     * before we get here.
     */
    private function pullSnapshotPart(string $clientId, string $part)
    {
        $path = "campaigns/{$clientId}/{$part}.json.gz";

        if (!Storage::exists($path)) {
            return response()->json(['message' => 'Part not available'], 404);
        }

        try {
            $json = gzdecode(Storage::get($path));
            if ($json === false) {
                Log::error("Failed to decompress {$part} for campaign {$clientId}");
                return response()->json(['message' => 'Failed to read part'], 500);
            }

            return response($json, 200)
                ->header('Content-Type', 'application/json')
                ->header('Cache-Control', 'no-cache, no-store, must-revalidate');
        } catch (\Exception $e) {
            Log::error("Error reading {$part} for campaign {$clientId}: " . $e->getMessage());
            return response()->json(['message' => 'Failed to read part'], 500);
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
            // Soft delete only. The S3 part files are intentionally retained
            // so an accidental deletion (or a client bug) is recoverable —
            // the campaigns:prune-deleted command hard-deletes both the row
            // and the S3 directory after a 30-day grace window.
            $campaign->delete();

            Log::info("Sync delete (soft): user={$userId} campaign={$clientId}");

            return response()->json(['success' => true]);
        } catch (\Exception $e) {
            Log::error("Error deleting campaign {$clientId}: " . $e->getMessage());
            return response()->json(['message' => 'Failed to delete campaign data'], 500);
        }
    }
}
