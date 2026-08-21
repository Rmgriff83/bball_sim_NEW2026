<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\Auth\ForgotPasswordController;
use App\Http\Controllers\Auth\ResetPasswordController;
use App\Http\Controllers\Auth\EmailVerificationController;
use App\Http\Controllers\Auth\SocialAuthController;
use App\Http\Controllers\Auth\LoginHandoffController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\RosterBuildController;
use App\Http\Controllers\SyncController;
use App\Http\Controllers\PaymentController;
use App\Http\Controllers\AdminHeadshotController;
use App\Http\Controllers\AppVersionController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

// Public authentication routes
Route::prefix('auth')->group(function () {
    Route::post('/register', [RegisterController::class, 'register']);
    Route::post('/login', [LoginController::class, 'login']);

    // Password reset
    Route::post('/forgot-password', [ForgotPasswordController::class, 'sendResetLink']);
    Route::post('/reset-password', [ResetPasswordController::class, 'reset']);

    // Email verification
    Route::get('/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
        ->middleware(['signed'])
        ->name('verification.verify');

    // Social OAuth — native one-tap identity-token verification (Apple/Google).
    // The client (web GIS / Apple JS / iOS native plugin) obtains an identity
    // token and POSTs it here; the server verifies it against the provider JWKS.
    Route::post('/social/token', [SocialAuthController::class, 'token']);

    // Legacy web redirect/callback flow (unused by one-tap; kept for reference).
    Route::get('/social/{provider}', [SocialAuthController::class, 'redirect']);
    Route::get('/social/{provider}/callback', [SocialAuthController::class, 'callback']);

    // One-time app→web login handoff exchange (public by design — the nonce
    // is the credential; single-use + 60s TTL + uniform 401, throttled).
    Route::post('/handoff/exchange', [LoginHandoffController::class, 'exchange'])
        ->middleware('throttle:20,1');
});

// Protected routes (require authentication)
Route::middleware('auth:sanctum')->group(function () {
    // Auth
    Route::post('/auth/logout', [LoginController::class, 'logout']);
    Route::post('/auth/resend-verification', [EmailVerificationController::class, 'resend']);

    // User profile
    Route::get('/user', [UserController::class, 'show']);
    Route::put('/user', [UserController::class, 'update']);
    Route::put('/user/password', [UserController::class, 'updatePassword']);
    Route::post('/user/avatar', [UserController::class, 'uploadAvatar']);
    Route::delete('/user', [UserController::class, 'destroy']);

    // Link / unlink a social identity (Apple/Google) to the current account.
    Route::post('/user/social/link', [UserController::class, 'linkSocialAccount']);
    Route::delete('/user/social/{provider}', [UserController::class, 'unlinkSocialAccount']);

    // User stats and achievements
    Route::get('/user/stats', [UserController::class, 'stats']);
    Route::get('/user/achievements', [UserController::class, 'achievements']);

    // Token operations (spending only — credits flow via Stripe webhook)
    Route::post('/user/tokens', [UserController::class, 'updateTokens']);

    // Offline token-ledger flush: idempotent batch of queued offline deltas
    // (per-reason earn caps + 5k/day ceiling inside the controller). Tight
    // throttle — a client flushes at most a handful of times per session.
    Route::post('/user/tokens/ledger', [UserController::class, 'flushTokenLedger'])
        ->middleware('throttle:12,1');

    // Career GM level (0-4). Persisted on contract extension / grandfathering.
    Route::post('/user/gm-level', [UserController::class, 'updateGmLevel']);

    // Payments
    Route::post('/payments/checkout-session', [PaymentController::class, 'createCheckoutSession']);

    // Cloud sync (client-id based, no route model binding). whereUuid keeps
    // malformed ids out of the controllers entirely (belt-and-suspenders for
    // the push create-path, where the param becomes a stored client_id + S3
    // path segment).
    Route::get('/sync/campaigns', [SyncController::class, 'listCampaigns']);
    Route::post('/sync/{clientId}/push', [SyncController::class, 'pushSnapshot'])->whereUuid('clientId');
    Route::get('/sync/{clientId}/pull', [SyncController::class, 'pullSnapshot'])->whereUuid('clientId');
    Route::delete('/sync/{clientId}', [SyncController::class, 'deleteCampaign'])->whereUuid('clientId');

    // One-time app→web login handoff mint (Community flow). Generous limit:
    // minting is a cheap, authed, self-serve action producing a single-use
    // 60s nonce — a tight limit only punishes legitimate retries. The
    // exchange endpoint carries its own throttle.
    Route::post('/auth/handoff', [LoginHandoffController::class, 'mint'])
        ->middleware('throttle:30,1');

    // Community roster builds (Roster Editor IAP Part B — web-only UI; every
    // endpoint enforces the custom_roster unlock server-side except report).
    Route::get('/roster-builds', [RosterBuildController::class, 'index']);
    Route::get('/roster-builds/mine', [RosterBuildController::class, 'mine']);
    Route::get('/roster-builds/downloads', [RosterBuildController::class, 'downloads']);
    Route::post('/roster-builds', [RosterBuildController::class, 'publish'])
        ->middleware('throttle:10,1440'); // 10 publishes/day (spans rosters + draft classes)
    Route::post('/roster-builds/{id}/download', [RosterBuildController::class, 'download'])->whereNumber('id');
    Route::get('/roster-builds/{id}/blob', [RosterBuildController::class, 'blob'])->whereNumber('id');
    Route::post('/roster-builds/{id}/report', [RosterBuildController::class, 'report'])
        ->whereNumber('id')->middleware('throttle:10,60');
    Route::delete('/roster-builds/{id}', [RosterBuildController::class, 'destroy'])->whereNumber('id');

    // Admin: headshot layer catalog management. The controller enforces
    // global_admin and 503s when ASSETS_AWS_BUCKET isn't configured.
    Route::get('/admin/headshot-layers/manifest', [AdminHeadshotController::class, 'listManifest']);
    Route::post('/admin/headshot-layers/tier', [AdminHeadshotController::class, 'setTier']);
    Route::post('/admin/headshot-layers/save', [AdminHeadshotController::class, 'saveVariant']);
    Route::post('/admin/headshot-layers/delete', [AdminHeadshotController::class, 'deleteVariant']);
    Route::post('/admin/headshot-layers/rename', [AdminHeadshotController::class, 'renameVariant']);
    Route::get('/admin/headshot-layers/variant', [AdminHeadshotController::class, 'getVariant']);

    // Admin: premade-headshot snapshots authored from the catalog preview.
    // Same admin/env gates as the layer endpoints above.
    Route::get('/admin/headshot-premades', [AdminHeadshotController::class, 'listPremades']);
    Route::post('/admin/headshot-premades', [AdminHeadshotController::class, 'savePremade']);
    Route::delete('/admin/headshot-premades/{name}', [AdminHeadshotController::class, 'deletePremade']);

    // Admin: color palette catalog (skin/hair/eye/lip/headband + ethnicity
    // profiles). Backs the Palettes tab in HeadshotAdminEditorView. Reads
    // palettes.json from S3; full-document writes atomically.
    Route::get('/admin/palettes', [AdminHeadshotController::class, 'getPalettes']);
    Route::put('/admin/palettes', [AdminHeadshotController::class, 'savePalettes']);
});

// Public routes
Route::get('/achievements', [UserController::class, 'allAchievements']);

// App version gate — powers the native in-app "update available" nag (public).
Route::get('/app-version', AppVersionController::class);

// Stripe webhook (public — authenticated by signature, not session)
Route::post('/webhooks/stripe', [PaymentController::class, 'webhook']);

// RevenueCat webhook for iOS In-App Purchases (public — authenticated by
// the Authorization header value set in the RevenueCat dashboard).
Route::post('/webhooks/revenuecat', [PaymentController::class, 'revenueCatWebhook']);
