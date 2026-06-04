<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class AdminHeadshotController extends Controller
{
    /**
     * Move a headshot layer SVG between the generic and upgraded folders.
     *
     * POST /api/admin/headshot-layers/tier
     * Body: { layer: 'hair', variant: 'afro', tier: 'upgraded' | 'generic' }
     *
     * This is inherently a dev-time tool: the layer files live in the
     * frontend repo's src/assets directory and are bundled by Vite at build
     * time, so writes here only show up after the next deploy. Requires
     * FRONTEND_ASSETS_PATH env to point at the (writable) frontend assets
     * directory; returns 503 otherwise.
     */
    public function setTier(Request $request): JsonResponse
    {
        // Admin gate
        $user = $request->user();
        if (!$user || !$user->global_admin) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        // Validate body
        $validated = $request->validate([
            'layer' => 'required|string|alpha_dash',
            'variant' => 'required|string|alpha_dash',
            'tier' => 'required|in:generic,upgraded',
        ]);

        // Verify the env points at a writable frontend assets dir. In prod
        // this won't be set (assets are bundled), so the endpoint disables
        // itself cleanly with a 503 rather than silently failing.
        $assetsRoot = env('FRONTEND_ASSETS_PATH');
        if (!$assetsRoot || !is_dir($assetsRoot) || !is_writable($assetsRoot)) {
            return response()->json([
                'error' => 'admin_tier_endpoint_unavailable',
                'detail' => 'FRONTEND_ASSETS_PATH is not set or not writable. This endpoint only operates in a dev environment with mutable frontend assets.',
            ], 503);
        }

        $layer = $validated['layer'];
        $variant = $validated['variant'];
        $targetTier = $validated['tier'];

        $genericDir = rtrim($assetsRoot, '/') . "/headshot-layers/{$layer}";
        $upgradedDir = rtrim($assetsRoot, '/') . "/headshot-layers-upgraded/{$layer}";
        $filename = "{$variant}.svg";
        $genericPath = "{$genericDir}/{$filename}";
        $upgradedPath = "{$upgradedDir}/{$filename}";

        $currentlyGeneric = file_exists($genericPath);
        $currentlyUpgraded = file_exists($upgradedPath);

        if (!$currentlyGeneric && !$currentlyUpgraded) {
            return response()->json([
                'error' => 'variant_not_found',
                'detail' => "Neither {$genericPath} nor {$upgradedPath} exists.",
            ], 404);
        }

        // Already in target tier — idempotent no-op
        if ($targetTier === 'generic' && $currentlyGeneric && !$currentlyUpgraded) {
            return response()->json(['tier' => 'generic', 'path' => "headshot-layers/{$layer}/{$filename}"]);
        }
        if ($targetTier === 'upgraded' && $currentlyUpgraded && !$currentlyGeneric) {
            return response()->json(['tier' => 'upgraded', 'path' => "headshot-layers-upgraded/{$layer}/{$filename}"]);
        }

        $sourcePath = $targetTier === 'upgraded' ? $genericPath : $upgradedPath;
        $destPath = $targetTier === 'upgraded' ? $upgradedPath : $genericPath;
        $destDir = $targetTier === 'upgraded' ? $upgradedDir : $genericDir;

        if (!file_exists($sourcePath)) {
            // Defensive — both shouldn't exist simultaneously, but if they do
            // the destination already wins.
            return response()->json([
                'error' => 'variant_in_both_folders',
                'detail' => 'Variant exists in both generic and upgraded folders. Resolve manually.',
            ], 409);
        }

        if (!is_dir($destDir)) {
            if (!mkdir($destDir, 0755, true) && !is_dir($destDir)) {
                Log::error("AdminHeadshotController: failed to create directory {$destDir}");
                return response()->json(['error' => 'mkdir_failed'], 500);
            }
        }

        if (!rename($sourcePath, $destPath)) {
            Log::error("AdminHeadshotController: rename failed {$sourcePath} -> {$destPath}");
            return response()->json(['error' => 'move_failed'], 500);
        }

        $relPath = $targetTier === 'upgraded'
            ? "headshot-layers-upgraded/{$layer}/{$filename}"
            : "headshot-layers/{$layer}/{$filename}";

        return response()->json([
            'tier' => $targetTier,
            'path' => $relPath,
        ]);
    }

    /**
     * Write a headshot variant SVG to disk. Used by the admin variant editor's
     * Save button to persist either an edited existing variant or a brand-new
     * one (file_put_contents creates if missing). Mirrors setTier's auth + env
     * gating exactly — production-safe (returns 503 with FRONTEND_ASSETS_PATH
     * unset).
     *
     * POST /api/admin/headshot-layers/save
     * Body: { layer: 'hair', variant: 'mohawk', tier: 'generic'|'upgraded',
     *         content: '<svg ...>...</svg>' }
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
            // 100 KB cap — way more than any reasonable pixel-art variant
            // needs but cheap insurance against runaway client behavior.
            'content' => 'required|string|max:102400',
        ]);

        $assetsRoot = env('FRONTEND_ASSETS_PATH');
        if (!$assetsRoot || !is_dir($assetsRoot) || !is_writable($assetsRoot)) {
            return response()->json([
                'error' => 'admin_save_endpoint_unavailable',
                'detail' => 'FRONTEND_ASSETS_PATH is not set or not writable. This endpoint only operates in a dev environment with mutable frontend assets.',
            ], 503);
        }

        // Basic XML well-formedness check — reject obviously-broken payloads
        // before writing them to disk where they'd break the next composer load.
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
        $folder = $tier === 'upgraded' ? 'headshot-layers-upgraded' : 'headshot-layers';
        $targetDir = rtrim($assetsRoot, '/') . "/{$folder}/{$layer}";
        $targetPath = "{$targetDir}/{$variant}.svg";

        // Path-traversal defense — realpath the resolved target dir's parent
        // and confirm it sits under the assets root.
        $assetsReal = realpath($assetsRoot);
        $parentReal = realpath(dirname($targetDir)) ?: realpath($assetsRoot);
        if (!$assetsReal || !$parentReal || strpos($parentReal, $assetsReal) !== 0) {
            return response()->json(['error' => 'invalid_path'], 400);
        }

        if (!is_dir($targetDir)) {
            if (!mkdir($targetDir, 0755, true) && !is_dir($targetDir)) {
                Log::error("AdminHeadshotController: failed to create directory {$targetDir}");
                return response()->json(['error' => 'mkdir_failed'], 500);
            }
        }

        // Atomic write: write to temp then rename. Avoids leaving a half-
        // written file if the process dies mid-save.
        $tmpPath = $targetPath . '.tmp';
        if (file_put_contents($tmpPath, $validated['content']) === false) {
            Log::error("AdminHeadshotController: write failed {$tmpPath}");
            return response()->json(['error' => 'write_failed'], 500);
        }
        if (!rename($tmpPath, $targetPath)) {
            @unlink($tmpPath);
            Log::error("AdminHeadshotController: rename failed {$tmpPath} -> {$targetPath}");
            return response()->json(['error' => 'commit_failed'], 500);
        }

        // If we just saved to upgraded but a stale free copy exists with the
        // same name (or vice versa), remove the other so the tier source-of-
        // truth stays unambiguous.
        $otherFolder = $tier === 'upgraded' ? 'headshot-layers' : 'headshot-layers-upgraded';
        $otherPath = rtrim($assetsRoot, '/') . "/{$otherFolder}/{$layer}/{$variant}.svg";
        if (file_exists($otherPath)) {
            @unlink($otherPath);
        }

        return response()->json([
            'saved' => true,
            'tier' => $tier,
            'path' => "{$folder}/{$layer}/{$variant}.svg",
        ]);
    }

    /**
     * Permanently delete a headshot variant SVG. Removes the file from
     * whichever tier folder it lives in. Mirrors the auth + env preamble
     * of the other admin endpoints — 403 for non-admins, 503 in prod where
     * FRONTEND_ASSETS_PATH is unset.
     *
     * POST /api/admin/headshot-layers/delete
     * Body: { layer: 'hair', variant: 'mohawk' }
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
        ]);

        $assetsRoot = env('FRONTEND_ASSETS_PATH');
        if (!$assetsRoot || !is_dir($assetsRoot) || !is_writable($assetsRoot)) {
            return response()->json([
                'error' => 'admin_delete_endpoint_unavailable',
                'detail' => 'FRONTEND_ASSETS_PATH is not set or not writable.',
            ], 503);
        }

        $layer = $validated['layer'];
        $variant = $validated['variant'];
        $filename = "{$variant}.svg";
        $genericPath = rtrim($assetsRoot, '/') . "/headshot-layers/{$layer}/{$filename}";
        $upgradedPath = rtrim($assetsRoot, '/') . "/headshot-layers-upgraded/{$layer}/{$filename}";

        $removed = [];
        // Path-traversal defense — confirm resolved paths sit under the assets root.
        $assetsReal = realpath($assetsRoot);
        foreach ([$genericPath, $upgradedPath] as $path) {
            if (!file_exists($path)) continue;
            $parentReal = realpath(dirname($path));
            if (!$assetsReal || !$parentReal || strpos($parentReal, $assetsReal) !== 0) {
                return response()->json(['error' => 'invalid_path'], 400);
            }
            if (!@unlink($path)) {
                Log::error("AdminHeadshotController: delete failed {$path}");
                return response()->json(['error' => 'delete_failed'], 500);
            }
            $removed[] = $path;
        }

        if (empty($removed)) {
            return response()->json([
                'error' => 'variant_not_found',
                'detail' => "Neither {$genericPath} nor {$upgradedPath} exists.",
            ], 404);
        }

        return response()->json(['deleted' => true, 'paths' => $removed]);
    }

    /**
     * Read the raw SVG content of a specific variant from disk. The admin
     * variant strip uses this to bypass the bundled `import.meta.glob` map,
     * which can serve stale content within the same session if Vite has
     * already cached the asset transform — even after the file was just
     * rewritten by saveVariant. Pulling from disk on demand guarantees the
     * thumb reflects the latest saved content.
     *
     * GET /api/admin/headshot-layers/variant?layer=face&variant=medium
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
        ]);

        $assetsRoot = env('FRONTEND_ASSETS_PATH');
        if (!$assetsRoot || !is_dir($assetsRoot)) {
            return response()->json([
                'error' => 'admin_get_variant_endpoint_unavailable',
                'detail' => 'FRONTEND_ASSETS_PATH is not set.',
            ], 503);
        }

        $layer = $validated['layer'];
        $variant = $validated['variant'];
        $filename = "{$variant}.svg";
        $genericPath = rtrim($assetsRoot, '/') . "/headshot-layers/{$layer}/{$filename}";
        $upgradedPath = rtrim($assetsRoot, '/') . "/headshot-layers-upgraded/{$layer}/{$filename}";

        $path = null;
        $tier = null;
        if (file_exists($genericPath)) {
            $path = $genericPath;
            $tier = 'generic';
        } elseif (file_exists($upgradedPath)) {
            $path = $upgradedPath;
            $tier = 'upgraded';
        } else {
            return response()->json([
                'error' => 'variant_not_found',
                'detail' => "Neither {$genericPath} nor {$upgradedPath} exists.",
            ], 404);
        }

        $assetsReal = realpath($assetsRoot);
        $parentReal = realpath(dirname($path));
        if (!$assetsReal || !$parentReal || strpos($parentReal, $assetsReal) !== 0) {
            return response()->json(['error' => 'invalid_path'], 400);
        }

        $content = @file_get_contents($path);
        if ($content === false) {
            Log::error("AdminHeadshotController: read failed {$path}");
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
     * Rename a headshot variant SVG in place (within its current tier folder).
     * Same auth + env gating as the siblings. Refuses to overwrite an existing
     * variant in either tier folder.
     *
     * POST /api/admin/headshot-layers/rename
     * Body: { layer: 'hair', variant: 'mohawk', newName: 'tall-mohawk' }
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
        ]);

        $assetsRoot = env('FRONTEND_ASSETS_PATH');
        if (!$assetsRoot || !is_dir($assetsRoot) || !is_writable($assetsRoot)) {
            return response()->json([
                'error' => 'admin_rename_endpoint_unavailable',
                'detail' => 'FRONTEND_ASSETS_PATH is not set or not writable.',
            ], 503);
        }

        $layer = $validated['layer'];
        $variant = $validated['variant'];
        $newName = $validated['newName'];

        // No-op short circuit so a "rename to same name" doesn't 409 itself.
        if ($variant === $newName) {
            return response()->json(['renamed' => false, 'note' => 'no_change']);
        }

        $genericDir = rtrim($assetsRoot, '/') . "/headshot-layers/{$layer}";
        $upgradedDir = rtrim($assetsRoot, '/') . "/headshot-layers-upgraded/{$layer}";
        $oldFilename = "{$variant}.svg";
        $newFilename = "{$newName}.svg";

        $genericOld = "{$genericDir}/{$oldFilename}";
        $upgradedOld = "{$upgradedDir}/{$oldFilename}";
        $genericNew = "{$genericDir}/{$newFilename}";
        $upgradedNew = "{$upgradedDir}/{$newFilename}";

        // Locate the source — variant must exist in exactly one of the tier
        // folders (mirrors setTier's invariant).
        $sourcePath = null;
        $destPath = null;
        if (file_exists($genericOld)) {
            $sourcePath = $genericOld;
            $destPath = $genericNew;
            $folder = 'headshot-layers';
        } elseif (file_exists($upgradedOld)) {
            $sourcePath = $upgradedOld;
            $destPath = $upgradedNew;
            $folder = 'headshot-layers-upgraded';
        } else {
            return response()->json([
                'error' => 'variant_not_found',
                'detail' => "Neither {$genericOld} nor {$upgradedOld} exists.",
            ], 404);
        }

        // Refuse to overwrite — collision is reportable, not silently destructive.
        // Check BOTH folders since a name should be unique across tiers.
        if (file_exists($genericNew) || file_exists($upgradedNew)) {
            return response()->json([
                'error' => 'name_collision',
                'detail' => "A variant named '{$newName}' already exists for {$layer}.",
            ], 409);
        }

        // Path-traversal defense.
        $assetsReal = realpath($assetsRoot);
        $parentReal = realpath(dirname($destPath));
        if (!$assetsReal || !$parentReal || strpos($parentReal, $assetsReal) !== 0) {
            return response()->json(['error' => 'invalid_path'], 400);
        }

        if (!rename($sourcePath, $destPath)) {
            Log::error("AdminHeadshotController: rename failed {$sourcePath} -> {$destPath}");
            return response()->json(['error' => 'rename_failed'], 500);
        }

        return response()->json([
            'renamed' => true,
            'newName' => $newName,
            'path' => "{$folder}/{$layer}/{$newFilename}",
        ]);
    }
}
