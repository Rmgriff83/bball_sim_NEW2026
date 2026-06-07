<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\Auth\ForgotPasswordController;
use App\Http\Controllers\Auth\ResetPasswordController;
use App\Http\Controllers\Auth\EmailVerificationController;
use App\Http\Controllers\Auth\SocialAuthController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\SyncController;
use App\Http\Controllers\PaymentController;
use App\Http\Controllers\AdminHeadshotController;
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

    // Social OAuth
    Route::get('/social/{provider}', [SocialAuthController::class, 'redirect']);
    Route::get('/social/{provider}/callback', [SocialAuthController::class, 'callback']);
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

    // User stats and achievements
    Route::get('/user/stats', [UserController::class, 'stats']);
    Route::get('/user/achievements', [UserController::class, 'achievements']);

    // Token operations (spending only — credits flow via Stripe webhook)
    Route::post('/user/tokens', [UserController::class, 'updateTokens']);

    // Payments
    Route::post('/payments/checkout-session', [PaymentController::class, 'createCheckoutSession']);

    // Cloud sync (client-id based, no route model binding)
    Route::get('/sync/campaigns', [SyncController::class, 'listCampaigns']);
    Route::post('/sync/{clientId}/push', [SyncController::class, 'pushSnapshot']);
    Route::get('/sync/{clientId}/pull', [SyncController::class, 'pullSnapshot']);
    Route::delete('/sync/{clientId}', [SyncController::class, 'deleteCampaign']);

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
});

// Public routes
Route::get('/achievements', [UserController::class, 'allAchievements']);

// Stripe webhook (public — authenticated by signature, not session)
Route::post('/webhooks/stripe', [PaymentController::class, 'webhook']);

// RevenueCat webhook for iOS In-App Purchases (public — authenticated by
// the Authorization header value set in the RevenueCat dashboard).
Route::post('/webhooks/revenuecat', [PaymentController::class, 'revenueCatWebhook']);
