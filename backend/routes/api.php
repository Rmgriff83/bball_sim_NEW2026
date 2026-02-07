<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\Auth\ForgotPasswordController;
use App\Http\Controllers\Auth\ResetPasswordController;
use App\Http\Controllers\Auth\EmailVerificationController;
use App\Http\Controllers\Auth\SocialAuthController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\CampaignController;
use App\Http\Controllers\GameController;
use App\Http\Controllers\TeamController;
use App\Http\Controllers\SeasonController;
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

    // Campaigns
    Route::get('/teams', [CampaignController::class, 'getTeams']);
    Route::apiResource('/campaigns', CampaignController::class);

    // Campaign-specific routes
    Route::prefix('campaigns/{campaign}')->group(function () {
        // Team management
        Route::get('/team', [TeamController::class, 'show']);
        Route::get('/team/lineup', [TeamController::class, 'show']);
        Route::put('/team/lineup', [TeamController::class, 'updateLineup']);
        Route::get('/team/coaching-schemes', [TeamController::class, 'getCoachingSchemes']);
        Route::put('/team/coaching-scheme', [TeamController::class, 'updateCoachingScheme']);
        Route::get('/teams', [TeamController::class, 'allTeams']);
        Route::get('/teams/{team}/roster', [TeamController::class, 'getTeamRoster']);

        // Players
        Route::get('/players/{player}', [TeamController::class, 'getPlayer']);
        Route::get('/free-agents', [TeamController::class, 'freeAgents']);
        Route::post('/players/{player}/sign', [TeamController::class, 'signPlayer']);
        Route::post('/players/{player}/release', [TeamController::class, 'releasePlayer']);

        // Games (uses JSON storage, gameId is a string like "game_2024_001")
        Route::get('/games', [GameController::class, 'index']);
        Route::get('/games/{gameId}', [GameController::class, 'show']);
        Route::post('/games/{gameId}/simulate', [GameController::class, 'simulate']);
        Route::post('/games/{gameId}/start', [GameController::class, 'startGame']);
        Route::post('/games/{gameId}/continue', [GameController::class, 'continueGame']);
        Route::post('/simulate-day', [GameController::class, 'simulateDay']);
        Route::get('/simulate-to-next-game/preview', [GameController::class, 'simulateToNextGamePreview']);
        Route::post('/simulate-to-next-game', [GameController::class, 'simulateToNextGame']);
        Route::get('/standings', [GameController::class, 'standings']);
        Route::get('/league-leaders', [GameController::class, 'leagueLeaders']);

        // Season management
        Route::get('/season', [SeasonController::class, 'show']);
        Route::post('/season/advance', [SeasonController::class, 'advancePhase']);
        Route::post('/season/offseason', [SeasonController::class, 'processOffseason']);
    });
});

// Public routes
Route::get('/achievements', [UserController::class, 'allAchievements']);
