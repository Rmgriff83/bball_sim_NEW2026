<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\LoginHandoffToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * One-time app→web login handoff (Roster Editor Part B "Community" flow).
 *
 * Security model:
 *  - mint (auth:sanctum, throttled): generates a 64-char random nonce, stores
 *    ONLY its sha256 hash with a 60s TTL, returns the web autologin URL.
 *  - exchange (public, throttled, POST-only): trades the nonce for a normal
 *    Sanctum token. The claim is a single atomic UPDATE (used_at) whose row
 *    count IS the authorization — expired/used/unknown all yield the same
 *    uniform 401 so the endpoint can't be used as an oracle.
 */
class LoginHandoffController extends Controller
{
    private const TTL_SECONDS = 60;

    /** POST /api/auth/handoff */
    public function mint(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'return_to' => 'nullable|string|max:500',
        ]);

        // Only app-relative paths — never absolute URLs (no open-redirect).
        $returnTo = $validated['return_to'] ?? null;
        if ($returnTo !== null && !str_starts_with($returnTo, '/')) {
            $returnTo = null;
        }

        // Opportunistic prune of stale rows.
        LoginHandoffToken::where('expires_at', '<', now()->subHour())->delete();

        $nonce = Str::random(64);
        LoginHandoffToken::create([
            'user_id' => $request->user()->id,
            'token_hash' => hash('sha256', $nonce),
            'return_to' => $returnTo,
            'expires_at' => now()->addSeconds(self::TTL_SECONDS),
        ]);

        $base = rtrim(config('app.web_url'), '/');
        $url = $base . '/autologin?nonce=' . $nonce
            . ($returnTo ? '&to=' . urlencode($returnTo) : '');

        return response()->json(['url' => $url, 'expires_in' => self::TTL_SECONDS]);
    }

    /** POST /api/auth/handoff/exchange */
    public function exchange(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'nonce' => 'required|string|min:32|max:128',
        ]);

        $hash = hash('sha256', $validated['nonce']);

        // Atomic single-use claim: the UPDATE's row count is the authorization.
        $claimed = LoginHandoffToken::where('token_hash', $hash)
            ->whereNull('used_at')
            ->where('expires_at', '>', now())
            ->update(['used_at' => now()]);

        if ($claimed !== 1) {
            // Uniform response for unknown/expired/already-used.
            return response()->json(['message' => 'Invalid or expired link'], 401);
        }

        $row = LoginHandoffToken::where('token_hash', $hash)->first();
        $user = $row?->user;
        if (!$user) {
            return response()->json(['message' => 'Invalid or expired link'], 401);
        }

        // Standard Sanctum token — same shape/revocation as a normal login.
        $token = $user->createToken('auth-token')->plainTextToken;

        return response()->json([
            'message' => 'Login successful.',
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'avatar_url' => $user->avatar_url,
                'settings' => $user->settings,
                'email_verified' => $user->hasVerifiedEmail(),
            ],
            'token' => $token,
            'return_to' => $row->return_to,
        ]);
    }
}
