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
use App\Http\Controllers\TradeController;
use App\Http\Controllers\PlayoffController;
use App\Http\Controllers\FinanceController;
use App\Http\Controllers\SyncController;
use App\Http\Controllers\BadgeSynergyController;
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

    // Badge synergies (static game data)
    Route::get('/badge-synergies', [BadgeSynergyController::class, 'index']);

    // Campaigns
    Route::get('/teams', [CampaignController::class, 'getTeams']);
    Route::apiResource('/campaigns', CampaignController::class);

    // Campaign-specific routes
    Route::prefix('campaigns/{campaign}')->group(function () {
        // Fantasy draft
        Route::get('/draft-pool', [CampaignController::class, 'getDraftPool']);
        Route::post('/finalize-draft', [CampaignController::class, 'finalizeDraft']);

        // Team management
        Route::get('/team', [TeamController::class, 'show']);
        Route::get('/team/lineup', [TeamController::class, 'show']);
        Route::put('/team/lineup', [TeamController::class, 'updateLineup']);
        Route::put('/team/target-minutes', [TeamController::class, 'updateTargetMinutes']);
        Route::get('/team/coaching-schemes', [TeamController::class, 'getCoachingSchemes']);
        Route::put('/team/coaching-scheme', [TeamController::class, 'updateCoachingScheme']);
        Route::get('/teams', [TeamController::class, 'allTeams']);
        Route::get('/teams/{team}/roster', [TeamController::class, 'getTeamRoster']);

        // Players
        Route::get('/players/{player}', [TeamController::class, 'getPlayer']);
        Route::get('/free-agents', [TeamController::class, 'freeAgents']);
        Route::post('/players/{player}/sign', [TeamController::class, 'signPlayer']);
        Route::post('/players/{player}/release', [TeamController::class, 'releasePlayer']);
        Route::post('/players/{player}/upgrade', [TeamController::class, 'upgradePlayerAttribute']);

        // Games (uses JSON storage, gameId is a string like "game_2024_001")
        Route::get('/games', [GameController::class, 'index']);
        Route::get('/games/{gameId}', [GameController::class, 'show']);
        Route::post('/games/{gameId}/simulate', [GameController::class, 'simulate']);
        Route::post('/games/{gameId}/start', [GameController::class, 'startGame']);
        Route::post('/games/{gameId}/continue', [GameController::class, 'continueGame']);
        Route::post('/games/{gameId}/sim-to-end', [GameController::class, 'simToEnd']);
        Route::post('/simulate-day', [GameController::class, 'simulateDay']);
        Route::get('/simulate-to-next-game/preview', [GameController::class, 'simulateToNextGamePreview']);
        Route::post('/simulate-to-next-game', [GameController::class, 'simulateToNextGame']);
        Route::post('/simulate-remaining-season', [GameController::class, 'simulateRemainingSeason']);
        Route::get('/simulation-status/{batchId}', [GameController::class, 'simulationStatus']);
        Route::get('/standings', [GameController::class, 'standings']);
        Route::get('/league-leaders', [GameController::class, 'leagueLeaders']);
        Route::get('/all-star-rosters', [GameController::class, 'allStarRosters']);
        Route::post('/all-star-viewed', [GameController::class, 'markAllStarViewed']);

        // Season management
        Route::get('/season', [SeasonController::class, 'show']);
        Route::post('/season/advance', [SeasonController::class, 'advancePhase']);
        Route::post('/season/offseason', [SeasonController::class, 'processOffseason']);

        // Trade center
        Route::get('/trade/teams', [TradeController::class, 'getTeams']);
        Route::get('/trade/teams/{team}', [TradeController::class, 'getTeamDetails']);
        Route::get('/trade/user-assets', [TradeController::class, 'getUserAssets']);
        Route::post('/trade/validate', [TradeController::class, 'validateTrade']);
        Route::post('/trade/propose', [TradeController::class, 'proposeTrade']);
        Route::post('/trade/execute', [TradeController::class, 'executeTrade']);
        Route::get('/trade/history', [TradeController::class, 'getTradeHistory']);
        Route::get('/trade/proposals', [TradeController::class, 'getProposals']);
        Route::post('/trade/proposals/{id}/accept', [TradeController::class, 'acceptProposal']);
        Route::post('/trade/proposals/{id}/reject', [TradeController::class, 'rejectProposal']);

        // Playoffs
        Route::get('/playoffs/bracket', [PlayoffController::class, 'getBracket']);
        Route::post('/playoffs/generate', [PlayoffController::class, 'generateBracket']);
        Route::get('/playoffs/series/{seriesId}', [PlayoffController::class, 'getSeries']);
        Route::get('/playoffs/check-regular-season-end', [PlayoffController::class, 'checkRegularSeasonEnd']);
        Route::get('/playoffs/next-series', [PlayoffController::class, 'getNextUserSeries']);
        Route::post('/playoffs/generate-round-schedule', [PlayoffController::class, 'generateRoundSchedule']);

        // Finances
        Route::get('/finances/summary', [FinanceController::class, 'summary']);
        Route::get('/finances/roster', [FinanceController::class, 'rosterContracts']);
        Route::get('/finances/free-agents', [FinanceController::class, 'freeAgents']);
        Route::get('/finances/transactions', [FinanceController::class, 'transactions']);
        Route::post('/finances/resign/{player}', [FinanceController::class, 'resignPlayer']);
        Route::post('/finances/sign/{playerId}', [FinanceController::class, 'signFreeAgent']);
        Route::post('/finances/drop/{player}', [FinanceController::class, 'dropPlayer']);

        // Sync (cloud save/load)
        Route::get('/sync/status', [SyncController::class, 'status']);
        Route::get('/sync/pull', [SyncController::class, 'pull']);
        Route::post('/sync/push', [SyncController::class, 'push']);
    });
});

// Public routes
Route::get('/achievements', [UserController::class, 'allAchievements']);
