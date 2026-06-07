<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class AdminHeadshotController extends Controller
{
    /**
     * Per-audience folder prefix helpers. Variant SVGs live in 2×2 folders
     * (audience × tier). The audience axis is encoded by folder name; the
     * tier axis is the `-upgraded` suffix. There is no manifest — folder
     * location is the source of truth. These prefixes are also the top-level
     * keys in the S3 bucket.
     */
    private function genericPrefix(string $audience): string
    {
        return $audience === 'coach' ? 'headshot-layers-coaches' : 'headshot-layers';
    }

    private function upgradedPrefix(string $audience): string
    {
        return $audience === 'coach' ? 'headshot-layers-coaches-upgraded' : 'headshot-layers-upgraded';
    }

    /**
     * Production-safe guard. Without an S3 bucket configured for the assets
     * disk the admin endpoints have nowhere to write, so they 503 — same UX
     * shape the old FRONTEND_ASSETS_PATH gate had, just sourced from the
     * dedicated headshot-assets disk now (separate from the campaigns
     * bucket on the default `s3` disk).
     *
     * Reads through `config()` (not `env()`) — env() outside of config
     * files returns null when `php artisan config:cache` has been run,
     * which is the default in every production Laravel deploy. config()
     * stays correct in both cached and uncached modes.
     */
    private function s3Unavailable(): bool
    {
        return !config('filesystems.disks.assets.bucket');
    }

    /**
     * Move a headshot layer SVG between the generic and upgraded folders
     * for the given audience by relocating the S3 key.
     *
     * POST /api/admin/headshot-layers/tier
     * Body: { layer, variant, tier: 'upgraded'|'generic', audience?: 'player'|'coach' }
     */
    public function setTier(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $validated = $request->validate([
            'layer' => 'required|string|alpha_dash',
            'variant' => 'required|string|alpha_dash',
            'tier' => 'required|in:generic,upgraded',
            'audience' => 'sometimes|string|in:player,coach',
        ]);
        $audience = $validated['audience'] ?? 'player';

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_tier_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        $layer = $validated['layer'];
        $variant = $validated['variant'];
        $targetTier = $validated['tier'];
        $genericFolder = $this->genericPrefix($audience);
        $upgradedFolder = $this->upgradedPrefix($audience);

        $filename = "{$variant}.svg";
        $genericKey = "{$genericFolder}/{$layer}/{$filename}";
        $upgradedKey = "{$upgradedFolder}/{$layer}/{$filename}";

        $s3 = Storage::disk('assets');
        $currentlyGeneric = $s3->exists($genericKey);
        $currentlyUpgraded = $s3->exists($upgradedKey);

        if (!$currentlyGeneric && !$currentlyUpgraded) {
            return response()->json([
                'error' => 'variant_not_found',
                'detail' => "Neither {$genericKey} nor {$upgradedKey} exists.",
            ], 404);
        }

        if ($targetTier === 'generic' && $currentlyGeneric && !$currentlyUpgraded) {
            return response()->json(['tier' => 'generic', 'audience' => $audience, 'path' => $genericKey]);
        }
        if ($targetTier === 'upgraded' && $currentlyUpgraded && !$currentlyGeneric) {
            return response()->json(['tier' => 'upgraded', 'audience' => $audience, 'path' => $upgradedKey]);
        }

        $sourceKey = $targetTier === 'upgraded' ? $genericKey : $upgradedKey;
        $destKey = $targetTier === 'upgraded' ? $upgradedKey : $genericKey;

        if (!$s3->exists($sourceKey)) {
            return response()->json([
                'error' => 'variant_in_both_folders',
                'detail' => 'Variant exists in both generic and upgraded folders. Resolve manually.',
            ], 409);
        }

        if (!$s3->move($sourceKey, $destKey)) {
            Log::error("AdminHeadshotController: S3 move failed {$sourceKey} -> {$destKey}");
            return response()->json(['error' => 'move_failed'], 500);
        }

        return response()->json([
            'tier' => $targetTier,
            'audience' => $audience,
            'path' => $destKey,
        ]);
    }

    /**
     * Write a headshot variant SVG to the S3 bucket. Used by the admin
     * variant editor's Save button.
     *
     * POST /api/admin/headshot-layers/save
     * Body: { layer, variant, tier: 'generic'|'upgraded', content, audience?: 'player'|'coach' }
     */
    public function saveVariant(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $validated = $request->validate([
            'layer' => 'required|string|alpha_dash',
            'variant' => ['required', 'string', 'regex:/^[a-z0-9-]+$/'],
            'tier' => 'required|in:generic,upgraded',
            'audience' => 'sometimes|string|in:player,coach',
            // 100 KB cap — way more than any reasonable pixel-art variant
            // needs but cheap insurance against runaway client behavior.
            'content' => 'required|string|max:102400',
        ]);
        $audience = $validated['audience'] ?? 'player';

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_save_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        // Basic XML well-formedness check.
        $previousErrors = libxml_use_internal_errors(true);
        $doc = simplexml_load_string($validated['content']);
        libxml_clear_errors();
        libxml_use_internal_errors($previousErrors);
        if ($doc === false) {
            return response()->json(['error' => 'invalid_svg', 'detail' => 'Content is not well-formed XML.'], 422);
        }

        $tier = $validated['tier'];
        $layer = $validated['layer'];
        $variant = $validated['variant'];
        $folder = $tier === 'upgraded' ? $this->upgradedPrefix($audience) : $this->genericPrefix($audience);
        $targetKey = "{$folder}/{$layer}/{$variant}.svg";

        $s3 = Storage::disk('assets');
        if (!$s3->put($targetKey, $validated['content'])) {
            Log::error("AdminHeadshotController: S3 put failed {$targetKey}");
            return response()->json(['error' => 'write_failed'], 500);
        }

        // If a stale copy exists in the opposite tier WITHIN THE SAME AUDIENCE,
        // remove it so the tier source-of-truth stays unambiguous. Cross-audience
        // copies (player vs coach with same name) are independent and not touched.
        $otherFolder = $tier === 'upgraded' ? $this->genericPrefix($audience) : $this->upgradedPrefix($audience);
        $otherKey = "{$otherFolder}/{$layer}/{$variant}.svg";
        if ($s3->exists($otherKey)) {
            $s3->delete($otherKey);
        }

        return response()->json([
            'saved' => true,
            'tier' => $tier,
            'audience' => $audience,
            'path' => $targetKey,
        ]);
    }

    /**
     * Permanently delete a headshot variant SVG from whichever tier folder
     * it lives in.
     *
     * POST /api/admin/headshot-layers/delete
     * Body: { layer, variant, audience?: 'player'|'coach' }
     */
    public function deleteVariant(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $validated = $request->validate([
            'layer' => 'required|string|alpha_dash',
            'variant' => ['required', 'string', 'regex:/^[a-z0-9-]+$/'],
            'audience' => 'sometimes|string|in:player,coach',
        ]);
        $audience = $validated['audience'] ?? 'player';

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_delete_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        $layer = $validated['layer'];
        $variant = $validated['variant'];
        $filename = "{$variant}.svg";
        $genericKey = "{$this->genericPrefix($audience)}/{$layer}/{$filename}";
        $upgradedKey = "{$this->upgradedPrefix($audience)}/{$layer}/{$filename}";

        $s3 = Storage::disk('assets');
        $removed = [];
        foreach ([$genericKey, $upgradedKey] as $key) {
            if (!$s3->exists($key)) continue;
            if (!$s3->delete($key)) {
                Log::error("AdminHeadshotController: S3 delete failed {$key}");
                return response()->json(['error' => 'delete_failed'], 500);
            }
            $removed[] = $key;
        }

        if (empty($removed)) {
            return response()->json([
                'error' => 'variant_not_found',
                'detail' => "Neither {$genericKey} nor {$upgradedKey} exists.",
            ], 404);
        }

        return response()->json(['deleted' => true, 'paths' => $removed]);
    }

    /**
     * Read the raw SVG content of a specific variant straight from S3.
     * The admin variant strip uses this to bypass any stale bundle cache.
     *
     * GET /api/admin/headshot-layers/variant?layer=face&variant=medium&audience=player|coach
     */
    public function getVariant(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $validated = $request->validate([
            'layer' => 'required|string|alpha_dash',
            'variant' => ['required', 'string', 'regex:/^[a-z0-9-]+$/'],
            'audience' => 'sometimes|string|in:player,coach',
        ]);
        $audience = $validated['audience'] ?? 'player';

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_get_variant_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        $layer = $validated['layer'];
        $variant = $validated['variant'];
        $filename = "{$variant}.svg";
        $genericKey = "{$this->genericPrefix($audience)}/{$layer}/{$filename}";
        $upgradedKey = "{$this->upgradedPrefix($audience)}/{$layer}/{$filename}";

        $s3 = Storage::disk('assets');
        $key = null;
        $tier = null;
        if ($s3->exists($genericKey)) {
            $key = $genericKey;
            $tier = 'generic';
        } elseif ($s3->exists($upgradedKey)) {
            $key = $upgradedKey;
            $tier = 'upgraded';
        } else {
            return response()->json([
                'error' => 'variant_not_found',
                'detail' => "Neither {$genericKey} nor {$upgradedKey} exists.",
            ], 404);
        }

        try {
            $content = $s3->get($key);
        } catch (\Throwable $e) {
            Log::error("AdminHeadshotController: S3 get failed {$key}: " . $e->getMessage());
            return response()->json(['error' => 'read_failed'], 500);
        }
        if ($content === null) {
            Log::error("AdminHeadshotController: S3 get returned null for {$key}");
            return response()->json(['error' => 'read_failed'], 500);
        }

        return response()->json([
            'layer' => $layer,
            'variant' => $variant,
            'tier' => $tier,
            'content' => $content,
        ]);
    }

    /**
     * Return the full layer-variant catalog for the given audience straight
     * from S3. The admin editor calls this on mount to discover variants
     * authored since the frontend bundle was built — without it, anything
     * saved after the last deploy is invisible to the picker even though
     * the file lives in S3.
     *
     * GET /api/admin/headshot-layers/manifest?audience=player|coach
     * Returns: { audience, layers: { hair: [{name, tier}], eyes: [...], ... } }
     */
    public function listManifest(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $audience = $request->query('audience', 'player');
        if (!in_array($audience, ['player', 'coach'], true)) {
            return response()->json(['error' => 'invalid_audience'], 422);
        }

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_manifest_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        $genericPrefix = $this->genericPrefix($audience);
        $upgradedPrefix = $this->upgradedPrefix($audience);
        $s3 = Storage::disk('assets');

        $layers = [];
        foreach ([['generic', $genericPrefix], ['upgraded', $upgradedPrefix]] as [$tier, $prefix]) {
            // allFiles recurses into <layer>/<variant>.svg subkeys; files() is
            // top-level only and would miss everything.
            foreach ($s3->allFiles($prefix) as $key) {
                if (!preg_match('#^' . preg_quote($prefix, '#') . '/([^/]+)/([^/]+)\.svg$#', $key, $m)) {
                    continue;
                }
                $layerId = $m[1];
                $variant = $m[2];
                if (!isset($layers[$layerId])) {
                    $layers[$layerId] = [];
                }
                $layers[$layerId][] = ['name' => $variant, 'tier' => $tier];
            }
        }

        // Stable order so the picker isn't visually noisy across refreshes.
        foreach ($layers as $id => $list) {
            usort($layers[$id], fn($a, $b) => strcmp($a['name'], $b['name']));
        }

        return response()->json(['audience' => $audience, 'layers' => $layers]);
    }

    /**
     * Rename a headshot variant SVG in place (within its current tier folder).
     * Refuses to overwrite an existing variant in either tier folder.
     *
     * POST /api/admin/headshot-layers/rename
     * Body: { layer, variant, newName, audience?: 'player'|'coach' }
     */
    public function renameVariant(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $validated = $request->validate([
            'layer' => 'required|string|alpha_dash',
            'variant' => ['required', 'string', 'regex:/^[a-z0-9-]+$/'],
            'newName' => ['required', 'string', 'regex:/^[a-z0-9-]+$/'],
            'audience' => 'sometimes|string|in:player,coach',
        ]);
        $audience = $validated['audience'] ?? 'player';

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_rename_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        $layer = $validated['layer'];
        $variant = $validated['variant'];
        $newName = $validated['newName'];

        if ($variant === $newName) {
            return response()->json(['renamed' => false, 'note' => 'no_change']);
        }

        $genericFolder = $this->genericPrefix($audience);
        $upgradedFolder = $this->upgradedPrefix($audience);
        $oldFilename = "{$variant}.svg";
        $newFilename = "{$newName}.svg";

        $genericOld = "{$genericFolder}/{$layer}/{$oldFilename}";
        $upgradedOld = "{$upgradedFolder}/{$layer}/{$oldFilename}";
        $genericNew = "{$genericFolder}/{$layer}/{$newFilename}";
        $upgradedNew = "{$upgradedFolder}/{$layer}/{$newFilename}";

        $s3 = Storage::disk('assets');

        $sourceKey = null;
        $destKey = null;
        $folder = null;
        if ($s3->exists($genericOld)) {
            $sourceKey = $genericOld;
            $destKey = $genericNew;
            $folder = $genericFolder;
        } elseif ($s3->exists($upgradedOld)) {
            $sourceKey = $upgradedOld;
            $destKey = $upgradedNew;
            $folder = $upgradedFolder;
        } else {
            return response()->json([
                'error' => 'variant_not_found',
                'detail' => "Neither {$genericOld} nor {$upgradedOld} exists.",
            ], 404);
        }

        // Refuse to overwrite — collision is reportable, not silently destructive.
        // Check BOTH folders since a name should be unique across tiers.
        if ($s3->exists($genericNew) || $s3->exists($upgradedNew)) {
            return response()->json([
                'error' => 'name_collision',
                'detail' => "A variant named '{$newName}' already exists for {$layer}.",
            ], 409);
        }

        if (!$s3->move($sourceKey, $destKey)) {
            Log::error("AdminHeadshotController: S3 move failed {$sourceKey} -> {$destKey}");
            return response()->json(['error' => 'rename_failed'], 500);
        }

        return response()->json([
            'renamed' => true,
            'newName' => $newName,
            'audience' => $audience,
            'path' => "{$folder}/{$layer}/{$newFilename}",
        ]);
    }

    /**
     * S3 prefix for "Create New Headshot" saves. Players write to
     * headshots-premade/ (a swappable premade pool the user picks from);
     * coaches write directly into coach-headshots/ (assigned to coaches at
     * campaign creation, with no user swap UX).
     */
    private function premadePrefix(string $audience = 'player'): string
    {
        return $audience === 'coach' ? 'coach-headshots' : 'headshots-premade';
    }

    /**
     * Filename prefix per audience. Players: `premade_NNN`. Coaches:
     * `coach_NNN` to read as a finished coach headshot rather than a
     * swappable premade slug.
     */
    private function premadeFilenamePrefix(string $audience): string
    {
        return $audience === 'coach' ? 'coach' : 'premade';
    }

    /**
     * All audience prefixes used for premade saves. Used by deletePremade so
     * we don't need the caller to know which audience a file belongs to.
     */
    private function allPremadePrefixes(): array
    {
        return [
            'player' => $this->premadePrefix('player'),
            'coach'  => $this->premadePrefix('coach'),
        ];
    }


    /**
     * List every premade headshot for the given audience with its inlined
     * SVG content so the admin gallery can render thumbnails without a
     * second round-trip per file.
     *
     * GET /api/admin/headshot-premades?audience=player|coach
     */
    public function listPremades(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $audience = $request->query('audience', 'player');
        if (!in_array($audience, ['player', 'coach'], true)) {
            return response()->json(['error' => 'invalid_audience'], 422);
        }

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_premades_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        $prefix = $this->premadePrefix($audience);
        $filePrefix = $this->premadeFilenamePrefix($audience);
        $s3 = Storage::disk('assets');

        $keys = $s3->files($prefix);
        sort($keys, SORT_NATURAL);

        $items = [];
        foreach ($keys as $key) {
            $basename = basename($key);
            if (!preg_match('/^(' . $filePrefix . '_\d+)\.svg$/', $basename, $m)) continue;
            try {
                $content = $s3->get($key);
            } catch (\Throwable $e) {
                continue;
            }
            if ($content === null) continue;
            $items[] = ['name' => $m[1], 'svgContent' => $content];
        }

        return response()->json(['premades' => $items, 'audience' => $audience]);
    }

    /**
     * Snapshot the admin catalog preview as a new premade headshot SVG.
     * Auto-increments the file name (premade_001.svg, premade_002.svg, ...)
     * based on the highest existing index in the AUDIENCE-SPECIFIC folder,
     * so player and coach premades each have their own slot sequence.
     *
     * POST /api/admin/headshot-premades
     * Body: { content: '<svg ...>...</svg>', audience?: 'player'|'coach' }
     */
    public function savePremade(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        // 250KB cap — composed headshots with piece-wrapped face variants
        // (slim face alone is ~70KB) can easily exceed 100KB once you stack
        // hair / eyes / headband on top.
        $validated = $request->validate([
            'content' => 'required|string|max:250000',
            'audience' => 'sometimes|string|in:player,coach',
        ]);
        $audience = $validated['audience'] ?? 'player';

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_premades_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        // Basic XML well-formedness check — same defense as saveVariant.
        $previousErrors = libxml_use_internal_errors(true);
        $doc = simplexml_load_string($validated['content']);
        libxml_clear_errors();
        libxml_use_internal_errors($previousErrors);
        if ($doc === false) {
            return response()->json(['error' => 'invalid_svg', 'detail' => 'Content is not well-formed XML.'], 422);
        }

        $prefix = $this->premadePrefix($audience);
        $filePrefix = $this->premadeFilenamePrefix($audience);
        $s3 = Storage::disk('assets');

        // Find max existing index; next slot is max + 1 (never reuses a slot,
        // even after manual deletion).
        $maxIndex = 0;
        foreach ($s3->files($prefix) as $key) {
            $basename = basename($key);
            if (preg_match('/^' . $filePrefix . '_(\d+)\.svg$/', $basename, $m)) {
                $n = (int) $m[1];
                if ($n > $maxIndex) $maxIndex = $n;
            }
        }
        $nextIndex = $maxIndex + 1;
        $name = sprintf('%s_%03d', $filePrefix, $nextIndex);
        $targetKey = "{$prefix}/{$name}.svg";

        if (!$s3->put($targetKey, $validated['content'])) {
            Log::error("AdminHeadshotController: S3 put failed {$targetKey}");
            return response()->json(['error' => 'write_failed'], 500);
        }

        return response()->json([
            'saved' => true,
            'name' => $name,
            'audience' => $audience,
            'svgContent' => $validated['content'],
        ]);
    }

    /**
     * Remove a premade headshot file by name. Scans both audience folders
     * since the slug alone doesn't disclose the audience.
     *
     * DELETE /api/admin/headshot-premades/{name}
     * `name` must match ^(premade|coach)_\d+$ — defense against path traversal.
     */
    public function deletePremade(Request $request, string $name): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        if (!preg_match('/^(premade|coach)_\d+$/', $name)) {
            return response()->json(['error' => 'invalid_name'], 422);
        }

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_premades_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        $s3 = Storage::disk('assets');
        $deleted = [];
        foreach ($this->allPremadePrefixes() as $audience => $prefix) {
            $targetKey = "{$prefix}/{$name}.svg";
            if (!$s3->exists($targetKey)) continue;
            if (!$s3->delete($targetKey)) {
                Log::error("AdminHeadshotController: S3 delete failed {$targetKey}");
                return response()->json(['error' => 'delete_failed'], 500);
            }
            $deleted[] = $audience;
        }

        if (empty($deleted)) {
            return response()->json(['error' => 'not_found'], 404);
        }

        return response()->json(['deleted' => true, 'name' => $name, 'audiences' => $deleted]);
    }

    /**
     * Top-level S3 key for the editable color palette JSON. Both the JS
     * composer and the Python pool generator read the same file at build
     * time; admin edits happen through the endpoints below.
     */
    private const PALETTES_KEY = 'palettes.json';

    /**
     * Required schema keys in the palette blob — used by both load and save
     * to fail-fast on a malformed payload (so an accidental empty PUT can't
     * wipe the bucket's color truth).
     */
    private const PALETTE_REQUIRED_KEYS = ['skin', 'hair', 'eye', 'lip', 'headband', 'ethnicity_profiles'];

    /**
     * Read the palette JSON from S3 and return it verbatim. Admin Palette
     * Editor calls this on mount to hot-swap composeSvg's in-memory palette
     * constants so authoring against fresh truth works without a redeploy.
     *
     * GET /api/admin/palettes
     */
    public function getPalettes(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_palettes_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        $s3 = Storage::disk('assets');
        if (!$s3->exists(self::PALETTES_KEY)) {
            return response()->json([
                'error' => 'palettes_not_initialized',
                'detail' => 'palettes.json does not exist in the bucket yet. Run sync:headshots:upload to seed it.',
            ], 404);
        }

        try {
            $raw = $s3->get(self::PALETTES_KEY);
        } catch (\Throwable $e) {
            Log::error('AdminHeadshotController: S3 get palettes.json failed: ' . $e->getMessage());
            return response()->json(['error' => 'read_failed'], 500);
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return response()->json([
                'error' => 'palettes_malformed',
                'detail' => 'palettes.json in the bucket is not valid JSON.',
            ], 500);
        }

        return response()->json(['palettes' => $decoded]);
    }

    /**
     * Persist the entire palette blob to S3. Full-document writes (not
     * per-entry patches) keep the controller small and atomic — the file
     * is only a few KB and admin authoring is bursty, so the simpler
     * approach is fine.
     *
     * PUT /api/admin/palettes
     * Body: { palettes: { skin, hair, eye, lip, headband, ethnicity_profiles } }
     */
    public function savePalettes(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        if ($this->s3Unavailable()) {
            return response()->json([
                'error' => 'admin_palettes_endpoint_unavailable',
                'detail' => 'ASSETS_AWS_BUCKET is not configured.',
            ], 503);
        }

        // 64KB is way more than the current palette catalog needs but cheap
        // insurance against an accidentally-massive PUT.
        $validated = $request->validate([
            'palettes' => 'required|array',
        ]);
        $palettes = $validated['palettes'];

        foreach (self::PALETTE_REQUIRED_KEYS as $key) {
            if (!array_key_exists($key, $palettes) || !is_array($palettes[$key])) {
                return response()->json([
                    'error' => 'invalid_palettes',
                    'detail' => "Missing or invalid top-level key: {$key}",
                ], 422);
            }
        }

        $encoded = json_encode($palettes, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        if ($encoded === false) {
            return response()->json(['error' => 'encode_failed'], 500);
        }

        $s3 = Storage::disk('assets');
        if (!$s3->put(self::PALETTES_KEY, $encoded)) {
            Log::error('AdminHeadshotController: S3 put palettes.json failed');
            return response()->json(['error' => 'write_failed'], 500);
        }

        return response()->json(['saved' => true, 'palettes' => $palettes]);
    }
}
