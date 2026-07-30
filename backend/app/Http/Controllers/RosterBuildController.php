<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\RosterBuild;
use App\Support\ProfanityScreen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Community roster builds (Roster Editor IAP Part B). Web-only UI; every
 * endpoint here is auth:sanctum + server-side custom_roster entitlement
 * (the actual security boundary — the client checks are cosmetic).
 *
 * Storage: private `roster_builds` S3 disk. Blobs are streamed through the
 * authenticated blob endpoint only; S3 keys are always server-generated and
 * read back exclusively from DB rows — never from client input.
 */
class RosterBuildController extends Controller
{
    private const MAX_BLOB_BYTES = 40 * 1024 * 1024; // gz, generous for headshots
    private const BUILD_FORMAT = 1;

    /** 403 unless the caller owns the custom_roster unlock. */
    private function gate(Request $request): ?JsonResponse
    {
        $profile = $request->user()?->profile;
        if (!$profile || !$profile->hasUnlock('custom_roster')) {
            return response()->json([
                'error' => 'feature_not_unlocked',
                'feature' => 'custom_roster',
            ], 403);
        }
        return null;
    }

    /** Read + decode one synced campaign part off the default (campaigns) disk. */
    private function readPart(string $clientId, string $part): ?array
    {
        $raw = Storage::get("campaigns/{$clientId}/{$part}.json.gz");
        if ($raw === null) {
            return null;
        }
        $json = @gzdecode($raw);
        if ($json === false) {
            return null;
        }
        $data = json_decode($json, true);
        return is_array($data) ? $data : null;
    }

    /**
     * POST /api/roster-builds — publish the caller's custom campaign roster.
     */
    public function publish(Request $request): JsonResponse
    {
        if ($resp = $this->gate($request)) {
            return $resp;
        }

        $validated = $request->validate([
            'campaign_client_id' => 'required|uuid',
            'title' => 'required|string|max:100',
            'description' => 'nullable|string|max:1000',
        ]);

        $user = $request->user();

        // Ownership FIRST — the client-supplied id is only ever used inside
        // this user-scoped lookup; all storage paths below derive from the
        // resulting DB row.
        $campaign = Campaign::where('client_id', $validated['campaign_client_id'])
            ->where('user_id', $user->id)
            ->first();
        if (!$campaign) {
            return response()->json(['message' => 'Campaign not found'], 404);
        }

        $clientId = $campaign->client_id;
        $meta = $this->readPart($clientId, 'meta');
        if (!$meta || empty($meta['teams']) || !is_array($meta['teams'])) {
            return response()->json(['error' => 'campaign_not_synced'], 422);
        }
        // Only custom-roster campaigns are publishable.
        $campaignRecord = $meta['campaign'] ?? [];
        $isCustom = ($campaignRecord['customRoster'] ?? $campaignRecord['custom_roster'] ?? false) === true;
        if (!$isCustom) {
            return response()->json(['error' => 'not_a_custom_campaign'], 422);
        }
        // Only FINALIZED builds are publishable — an un-finalized campaign is
        // still in the roster editor and its snapshot is a half-built league.
        $isFinalized = ($campaignRecord['rosterSetupCompleted'] ?? $campaignRecord['roster_setup_completed'] ?? false) === true;
        if (!$isFinalized) {
            return response()->json(['error' => 'campaign_not_finalized'], 422);
        }
        // One live publish per campaign. Importing a build into a SEPARATE
        // campaign and publishing that is fine (different client id); removing
        // a published build frees its campaign for a re-publish.
        $alreadyPublished = RosterBuild::where('user_id', $user->id)
            ->where('campaign_client_id', $clientId)
            ->where('status', RosterBuild::STATUS_ACTIVE)
            ->exists();
        if ($alreadyPublished) {
            return response()->json(['error' => 'already_published'], 422);
        }

        ini_set('memory_limit', '512M'); // large player payloads (same as sync)

        // Team id → abbreviation map + coaches keyed by abbreviation.
        $abbrByTeamId = [];
        $coaches = [];
        foreach ($meta['teams'] as $team) {
            $abbr = $team['abbreviation'] ?? null;
            $tid = $team['id'] ?? null;
            if (!$abbr || $tid === null) {
                continue;
            }
            $abbrByTeamId[(string) $tid] = $abbr;
            if (!empty($team['coach']) && is_array($team['coach'])) {
                $coach = $team['coach'];
                // Strip the source campaign's accrued coaching record — a
                // build is roster data; importers reset these to zero anyway
                // (belt for old importers + smaller blobs).
                unset(
                    $coach['career_stats'],
                    $coach['career_wins'],
                    $coach['career_losses'],
                    $coach['playoff_wins'],
                    $coach['playoff_losses'],
                    $coach['championships'],
                    $coach['conference_titles'],
                    $coach['seasons_coached'],
                    // Per-campaign lifecycle state — importers stamp these
                    // fresh (hiredSeason, budgets) on install.
                    $coach['actionsRemaining'],
                    $coach['trainActionsRemaining'],
                    $coach['activeTraining'],
                    $coach['hiredSeason'],
                    $coach['seasonsWithTeam'],
                );
                $coaches[$abbr] = $coach;
            }
        }

        // Authored pick trades: TRADED picks only (holder ≠ originator),
        // expressed entirely in abbreviations + the game-year counter so the
        // importer can recreate ownership in any campaign (team UUIDs are
        // campaign-specific). Additive optional blob key — old importers
        // ignore it.
        $tradedPicks = [];
        foreach ($meta['teams'] as $team) {
            foreach (($team['draftPicks'] ?? []) as $pick) {
                if (!is_array($pick)) {
                    continue;
                }
                $ownerId = $pick['currentOwnerId'] ?? $pick['current_owner_id'] ?? null;
                $originalId = $pick['originalTeamId'] ?? $pick['original_team_id'] ?? null;
                $originalAbbr = $pick['original_team_abbreviation'] ?? null;
                if ($ownerId === null || $originalId === null || !$originalAbbr) {
                    continue;
                }
                if ((string) $ownerId === (string) $originalId) {
                    continue; // untraded — importer's defaults cover it
                }
                $heldBy = $abbrByTeamId[(string) $ownerId] ?? null;
                if (!$heldBy) {
                    continue;
                }
                $tradedPicks[] = [
                    'original' => $originalAbbr,
                    'year' => $pick['year'] ?? null,
                    'round' => $pick['round'] ?? null,
                    'heldBy' => $heldBy,
                ];
            }
        }

        // Collect + partition players by abbreviation (fa = no team).
        $playersByAbbr = ['fa' => []];
        $playerCount = 0;
        foreach (['players_user', 'players_ai', 'players_fa'] as $part) {
            $data = $this->readPart($clientId, $part);
            foreach (($data['players'] ?? []) as $player) {
                if (!is_array($player)) {
                    continue;
                }
                // Draft prospects are generated scouting content, not roster —
                // every campaign creates its own class, so they never travel
                // in a build (the importer also skips them for old blobs).
                if (!empty($player['isDraftProspect']) || !empty($player['is_draft_prospect'])) {
                    continue;
                }
                // A build is ROSTER data only — strip the source campaign's
                // in-progress season state (stat snapshots, evolution logs,
                // earned training points). The importer also strips these
                // client-side for blobs published before this deploy.
                foreach ([
                    'season_stats', 'seasonStats',
                    'season_playoff_stats', 'seasonPlayoffStats',
                    'recent_performances', 'recentPerformances',
                    'streak_data', 'streakData',
                    'development_history', 'developmentHistory',
                    'upgrade_points', 'upgradePoints',
                    'offense_upgrade_points', 'offenseUpgradePoints',
                    'defense_upgrade_points', 'defenseUpgradePoints',
                    '_overallExact',
                    // Accrued-by-play state (mirrors the importer's strip):
                    // single-game highs, per-season archives, career team
                    // counters, season-end awards, re-sign flags.
                    'careerHighs', 'career_highs',
                    'seasonHighs', 'season_highs',
                    'seasonHistory', 'season_history',
                    'playerCareer', 'player_career',
                    'awards',
                    'all_star_selections', 'allStarSelections',
                    'mvp_awards', 'mvpAwards',
                    'finals_mvp_awards', 'finalsMvpAwards',
                    'rookie_of_the_year', 'rookieOfTheYear',
                    'all_nba_selections', 'allNbaSelections',
                    'all_nba_first_team', 'allNbaFirstTeam',
                    'all_rookie_team', 'allRookieTeam',
                    'all_defensive_team', 'allDefensiveTeam',
                    'resignedThisSeason', 'resigned_this_season',
                    'resignedSeasonYear', 'resigned_season_year',
                ] as $seasonKey) {
                    unset($player[$seasonKey]);
                }
                foreach (array_keys($player) as $pk) {
                    if (str_starts_with((string) $pk, '_seasonDrop_')) {
                        unset($player[$pk]);
                    }
                }
                $tid = $player['team_id'] ?? $player['teamId'] ?? null;
                $abbr = $tid !== null ? ($abbrByTeamId[(string) $tid] ?? null) : null;
                $bucket = $abbr ?? 'fa';
                $playersByAbbr[$bucket] ??= [];
                $playersByAbbr[$bucket][] = $player;
                $playerCount++;
            }
        }
        if ($playerCount === 0) {
            return response()->json(['error' => 'campaign_not_synced'], 422);
        }

        // Profanity screen: title, description, and every player/coach name.
        // Each entry is labeled so a rejection can NAME the offending field —
        // "content_rejected" with no location left publishers hunting through
        // 450 players.
        $texts = [
            ['label' => 'the title', 'text' => $validated['title']],
            ['label' => 'the description', 'text' => $validated['description'] ?? ''],
        ];
        foreach ($playersByAbbr as $abbr => $list) {
            foreach ($list as $p) {
                $name = trim(($p['first_name'] ?? '') . ' ' . ($p['last_name'] ?? '') . ' ' . ($p['name'] ?? ''));
                $texts[] = ['label' => "player \"{$name}\" ({$abbr})", 'text' => $name];
            }
        }
        foreach ($coaches as $abbr => $c) {
            $name = trim(($c['firstName'] ?? '') . ' ' . ($c['lastName'] ?? '') . ' ' . ($c['name'] ?? ''));
            $texts[] = ['label' => "coach \"{$name}\" ({$abbr})", 'text' => $name];
        }
        foreach ($texts as $entry) {
            if (($hit = ProfanityScreen::firstViolation($entry['text'])) !== null) {
                return response()->json([
                    'error' => 'content_rejected',
                    'message' => "Disallowed language in {$entry['label']}.",
                    'fragment' => $hit,
                    'source' => $entry['label'],
                ], 422);
            }
        }

        // Headshots (optional part; may be absent for campaigns without any).
        $headshotsPart = $this->readPart($clientId, 'headshots');
        $headshots = [];
        foreach (($headshotsPart['headshots'] ?? []) as $h) {
            if (!empty($h['playerId']) && !empty($h['svgContent'])) {
                $entry = [
                    'playerId' => $h['playerId'],
                    'svgContent' => $h['svgContent'],
                ];
                // Personnel entries (coach headshots) ride in the synced
                // headshots part with a `kind` discriminator and the personnel
                // id on playerId. Carry the kind so importers can restore
                // them; current importers skip unmapped ids harmlessly.
                if (!empty($h['kind'])) {
                    $entry['kind'] = $h['kind'];
                }
                $headshots[] = $entry;
            }
        }

        $blob = [
            'format' => self::BUILD_FORMAT,
            'title' => $validated['title'],
            'players' => $playersByAbbr,
            'coaches' => $coaches,
            'headshots' => $headshots,
            'picks' => $tradedPicks,
        ];
        $json = json_encode($blob, JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            Log::error("Roster build encode failed for campaign {$clientId}: " . json_last_error_msg());
            return response()->json(['message' => 'Failed to package build'], 500);
        }
        $compressed = gzencode($json, 6);
        if (strlen($compressed) > self::MAX_BLOB_BYTES) {
            return response()->json(['error' => 'build_too_large'], 422);
        }

        // Server-generated key only.
        $key = 'rosters/' . Str::uuid()->toString() . '.json.gz';
        // The disk is configured throw=false, so a failed write (bucket
        // missing/misconfigured, credentials revoked) returns false instead
        // of throwing. Without this check we'd insert an "active" board row
        // whose blob 404s on every download.
        $stored = Storage::disk('roster_builds')->put($key, $compressed);
        if ($stored === false) {
            Log::error("Roster build S3 write failed for campaign {$clientId} (key {$key}) — check ROSTER_BUILDS_AWS_* config");
            return response()->json([
                'error' => 'storage_unavailable',
                'message' => 'Upload storage is temporarily unavailable. Please try again later.',
            ], 503);
        }

        $build = RosterBuild::create([
            'user_id' => $user->id,
            'campaign_client_id' => $clientId,
            'title' => $validated['title'],
            'description' => $validated['description'] ?? null,
            's3_key' => $key,
            'size_bytes' => strlen($compressed),
            'player_count' => $playerCount,
            'status' => RosterBuild::STATUS_ACTIVE,
        ]);

        return response()->json(['build' => $this->present($build)], 201);
    }

    /** GET /api/roster-builds — the public board (active builds). */
    public function index(Request $request): JsonResponse
    {
        if ($resp = $this->gate($request)) {
            return $resp;
        }
        $sort = $request->query('sort') === 'downloads' ? 'downloads' : 'created_at';
        $builds = RosterBuild::with('user:id,username')
            ->where('status', RosterBuild::STATUS_ACTIVE)
            ->orderByDesc($sort)
            ->paginate(20);

        return response()->json([
            'builds' => collect($builds->items())->map(fn ($b) => $this->present($b)),
            'page' => $builds->currentPage(),
            'last_page' => $builds->lastPage(),
            'total' => $builds->total(),
        ]);
    }

    /** GET /api/roster-builds/mine — the caller's published builds. */
    public function mine(Request $request): JsonResponse
    {
        if ($resp = $this->gate($request)) {
            return $resp;
        }
        $builds = RosterBuild::where('user_id', $request->user()->id)
            ->orderByDesc('created_at')
            ->limit(100)
            ->get();
        return response()->json(['builds' => $builds->map(fn ($b) => $this->present($b, includeStatus: true))]);
    }

    /** GET /api/roster-builds/downloads — the caller's "My Downloads". */
    public function downloads(Request $request): JsonResponse
    {
        if ($resp = $this->gate($request)) {
            return $resp;
        }
        $rows = DB::table('roster_build_downloads')
            ->where('user_id', $request->user()->id)
            ->orderByDesc('created_at')
            ->limit(100)
            ->pluck('roster_build_id');
        $builds = RosterBuild::with('user:id,username')
            ->whereIn('id', $rows)
            ->where('status', RosterBuild::STATUS_ACTIVE)
            ->get();
        return response()->json(['builds' => $builds->map(fn ($b) => $this->present($b))]);
    }

    /** POST /api/roster-builds/{id}/download — attach to the caller's account. */
    public function download(Request $request, int $id): JsonResponse
    {
        if ($resp = $this->gate($request)) {
            return $resp;
        }
        $build = RosterBuild::where('id', $id)
            ->where('status', RosterBuild::STATUS_ACTIVE)
            ->first();
        if (!$build) {
            return response()->json(['message' => 'Build not found'], 404);
        }

        $inserted = DB::table('roster_build_downloads')->insertOrIgnore([
            'user_id' => $request->user()->id,
            'roster_build_id' => $build->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        if ($inserted) {
            $build->increment('downloads');
        }

        return response()->json(['build' => $this->present($build->fresh())]);
    }

    /** GET /api/roster-builds/{id}/blob — stream the build payload (gzip JSON). */
    public function blob(Request $request, int $id): Response
    {
        if ($resp = $this->gate($request)) {
            return $resp;
        }
        $build = RosterBuild::where('id', $id)
            ->where('status', RosterBuild::STATUS_ACTIVE)
            ->first();
        if (!$build) {
            return response()->json(['message' => 'Build not found'], 404);
        }
        $raw = Storage::disk('roster_builds')->get($build->s3_key);
        if ($raw === null) {
            return response()->json(['message' => 'Build data unavailable'], 404);
        }
        // raw=1: send the gz bytes as an opaque octet-stream and let the
        // client inflate explicitly. The legacy Content-Encoding:gzip route
        // is fragile — dev proxies/service workers that decompress the body
        // while leaving the header produce ERR_CONTENT_DECODING_FAILED.
        if ($request->query('raw')) {
            return response($raw, 200, [
                'Content-Type' => 'application/octet-stream',
                'Cache-Control' => 'private, max-age=3600',
            ]);
        }
        return response($raw, 200, [
            'Content-Type' => 'application/json',
            'Content-Encoding' => 'gzip',
            'Cache-Control' => 'private, max-age=3600',
        ]);
    }

    /** POST /api/roster-builds/{id}/report — flag for review (auth only, no IAP gate). */
    public function report(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'reason' => 'nullable|string|max:500',
        ]);
        $build = RosterBuild::where('id', $id)
            ->where('status', RosterBuild::STATUS_ACTIVE)
            ->first();
        if (!$build) {
            return response()->json(['message' => 'Build not found'], 404);
        }
        $inserted = DB::table('roster_build_reports')->insertOrIgnore([
            'user_id' => $request->user()->id,
            'roster_build_id' => $build->id,
            'reason' => $validated['reason'] ?? null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        if ($inserted) {
            $build->increment('report_count');
            $this->sendReportNotice($build->fresh(), $request->user()->id, $validated['reason'] ?? null);
        }
        return response()->json(['message' => 'Reported. Thank you.']);
    }

    /**
     * Fire-and-forget admin notice for a NEW report. Mail failure must never
     * fail the report request — the report row + count are already committed.
     */
    private function sendReportNotice(RosterBuild $build, int $reporterId, ?string $reason): void
    {
        try {
            $owner = $build->user;
            $lines = [
                'A community roster build was reported.',
                '',
                "Build: #{$build->id} — \"{$build->title}\"",
                'Reports so far: ' . $build->report_count,
                'Owner: user #' . $build->user_id . ($owner?->email ? " ({$owner->email})" : ''),
                'Source campaign: ' . ($build->campaign_client_id ?? 'unknown (pre-column build)'),
                'Reporter: user #' . $reporterId,
                'Reason: ' . ($reason !== null && $reason !== '' ? $reason : '(none given)'),
                '',
                "Remove it with: DELETE /api/roster-builds/{$build->id} (as a global_admin account).",
            ];
            Mail::raw(implode("\n", $lines), function ($message) use ($build) {
                $message->to(config('app.admin_email'))
                    ->subject("[BballSim] Roster build #{$build->id} reported (count: {$build->report_count})");
            });
        } catch (\Throwable $e) {
            Log::warning("Report-notice email failed for build {$build->id}: " . $e->getMessage());
        }
    }

    /**
     * DELETE /api/roster-builds/{id} — owner unpublish, or admin removal.
     * Owner scope enforced in the query itself; global admins may remove any.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $query = RosterBuild::where('id', $id);
        if (!($user->global_admin ?? false)) {
            $query->where('user_id', $user->id);
        }
        $build = $query->first();
        if (!$build) {
            return response()->json(['message' => 'Build not found'], 404);
        }
        $build->update(['status' => RosterBuild::STATUS_REMOVED]);
        return response()->json(['message' => 'Build removed']);
    }

    private function present(RosterBuild $build, bool $includeStatus = false): array
    {
        $out = [
            'id' => $build->id,
            'title' => $build->title,
            'description' => $build->description,
            'author' => $build->relationLoaded('user') ? ($build->user->username ?? null) : null,
            'player_count' => $build->player_count,
            'size_bytes' => $build->size_bytes,
            'downloads' => $build->downloads,
            'created_at' => $build->created_at?->toIso8601String(),
        ];
        if ($includeStatus) {
            $out['status'] = $build->status;
            $out['report_count'] = $build->report_count;
            // Owner-only view ("mine") — lets the publish picker exclude
            // campaigns that already have a live build.
            $out['campaign_client_id'] = $build->campaign_client_id;
        }
        return $out;
    }
}
