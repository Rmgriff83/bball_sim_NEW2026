<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\SocialAccount;
use App\Models\User;
use App\Models\UserProfile;
use App\Services\SocialTokenVerifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;

class SocialAuthController extends Controller
{
    /**
     * Supported OAuth providers.
     */
    protected array $providers = ['google', 'apple', 'facebook'];

    /**
     * Native one-tap sign in / sign up. The client (web Google Identity
     * Services / Apple JS / iOS native Sign in with Apple) obtains an identity
     * token and POSTs it here; we verify it server-side against the provider's
     * JWKS, then create or link the user and issue a Sanctum token.
     *
     * Body: { provider: 'apple'|'google', credential: <idToken>, name?, email? }
     */
    public function token(Request $request, SocialTokenVerifier $verifier): JsonResponse
    {
        $data = $request->validate([
            'provider' => 'required|in:apple,google',
            'credential' => 'required|string',
            // Apple only returns name/email on the FIRST authorization; the client
            // forwards them so new accounts aren't created without an identity.
            'name' => 'nullable|string|max:255',
            'email' => 'nullable|email',
        ]);

        try {
            $claims = $verifier->verify($data['provider'], $data['credential']);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Social authentication failed.',
                'error' => $e->getMessage(),
            ], 401);
        }

        if (empty($claims['sub'])) {
            return response()->json(['message' => 'Invalid identity token.'], 401);
        }

        $user = $this->resolveUserForSocial(
            provider: $data['provider'],
            providerId: $claims['sub'],
            email: $claims['email'] ?? ($data['email'] ?? null),
            name: $claims['name'] ?? ($data['name'] ?? null),
            avatar: $claims['avatar'] ?? null,
        );

        return $this->respondWithToken($user);
    }

    /**
     * Redirect to OAuth provider (legacy web flow — unused by one-tap).
     */
    public function redirect(string $provider): RedirectResponse|JsonResponse
    {
        if (! in_array($provider, $this->providers)) {
            return response()->json(['message' => 'Unsupported OAuth provider.'], 400);
        }

        return Socialite::driver($provider)->stateless()->redirect();
    }

    /**
     * Handle OAuth callback (legacy web flow — unused by one-tap).
     */
    public function callback(string $provider): JsonResponse
    {
        if (! in_array($provider, $this->providers)) {
            return response()->json(['message' => 'Unsupported OAuth provider.'], 400);
        }

        try {
            $socialUser = Socialite::driver($provider)->stateless()->user();
        } catch (\Exception $e) {
            return response()->json([
                'message' => 'OAuth authentication failed.',
                'error' => $e->getMessage(),
            ], 400);
        }

        $user = $this->resolveUserForSocial(
            provider: $provider,
            providerId: $socialUser->getId(),
            email: $socialUser->getEmail(),
            name: $socialUser->getName(),
            avatar: $socialUser->getAvatar(),
            token: $socialUser->token ?? null,
            refreshToken: $socialUser->refreshToken ?? null,
        );

        return $this->respondWithToken($user);
    }

    /**
     * Find the user for a verified social identity, creating or email-linking
     * one when needed, and ensure a SocialAccount link exists. Shared by the
     * token (one-tap) and callback (redirect) flows.
     */
    protected function resolveUserForSocial(
        string $provider,
        string $providerId,
        ?string $email,
        ?string $name,
        ?string $avatar,
        ?string $token = null,
        ?string $refreshToken = null,
    ): User {
        $socialAccount = SocialAccount::where('provider', $provider)
            ->where('provider_id', $providerId)
            ->first();

        if ($socialAccount) {
            if ($token !== null || $refreshToken !== null) {
                $socialAccount->update(['token' => $token, 'refresh_token' => $refreshToken]);
            }

            return $socialAccount->user;
        }

        // Link to an existing account by email when we have one, else create.
        $user = $email ? User::where('email', $email)->first() : null;

        if (! $user) {
            $usernameSeed = $name ?: ($email ? Str::before($email, '@') : 'player');

            $user = User::create([
                'username' => $this->generateUniqueUsername($usernameSeed),
                // Apple "hide my email" / repeat logins may omit email; synthesize a
                // unique non-routable address so the unique constraint holds.
                'email' => $email ?: "{$provider}_{$providerId}@users.noreply.bballsim.app",
                'password' => Hash::make(Str::random(32)),
                'avatar_url' => $avatar,
                'email_verified_at' => now(), // social identities are pre-verified
                'settings' => [
                    'theme' => 'dark',
                    'simSpeed' => 'normal',
                    'notifications' => true,
                ],
            ]);

            UserProfile::create([
                'user_id' => $user->id,
                'rewards' => UserProfile::defaultRewards(),
            ]);
        }

        SocialAccount::create([
            'user_id' => $user->id,
            'provider' => $provider,
            'provider_id' => $providerId,
            'token' => $token,
            'refresh_token' => $refreshToken,
        ]);

        return $user;
    }

    /**
     * Issue a Sanctum token and return the standard auth response shape
     * (matches LoginController/RegisterController).
     */
    protected function respondWithToken(User $user): JsonResponse
    {
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
        ]);
    }

    /**
     * Generate a unique username from a name/seed.
     */
    protected function generateUniqueUsername(string $name): string
    {
        $base = preg_replace('/[^a-zA-Z0-9_]/', '', str_replace(' ', '_', strtolower($name)));
        $base = $base !== '' ? substr($base, 0, 40) : 'player';

        $username = $base;
        $counter = 1;

        while (User::where('username', $username)->exists()) {
            $username = $base.'_'.$counter;
            $counter++;
        }

        return $username;
    }
}
