<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\SocialAccount;
use App\Models\User;
use App\Models\UserProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
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
     * Redirect to OAuth provider.
     */
    public function redirect(string $provider): RedirectResponse|JsonResponse
    {
        if (!in_array($provider, $this->providers)) {
            return response()->json([
                'message' => 'Unsupported OAuth provider.',
            ], 400);
        }

        return Socialite::driver($provider)->stateless()->redirect();
    }

    /**
     * Handle OAuth callback.
     */
    public function callback(string $provider): JsonResponse
    {
        if (!in_array($provider, $this->providers)) {
            return response()->json([
                'message' => 'Unsupported OAuth provider.',
            ], 400);
        }

        try {
            $socialUser = Socialite::driver($provider)->stateless()->user();
        } catch (\Exception $e) {
            return response()->json([
                'message' => 'OAuth authentication failed.',
                'error' => $e->getMessage(),
            ], 400);
        }

        // Check if social account already exists
        $socialAccount = SocialAccount::where('provider', $provider)
            ->where('provider_id', $socialUser->getId())
            ->first();

        if ($socialAccount) {
            // Update tokens
            $socialAccount->update([
                'token' => $socialUser->token,
                'refresh_token' => $socialUser->refreshToken,
            ]);

            $user = $socialAccount->user;
        } else {
            // Check if user exists with this email
            $user = User::where('email', $socialUser->getEmail())->first();

            if (!$user) {
                // Create new user
                $user = User::create([
                    'username' => $this->generateUniqueUsername($socialUser->getName()),
                    'email' => $socialUser->getEmail(),
                    'password' => Hash::make(Str::random(32)),
                    'avatar_url' => $socialUser->getAvatar(),
                    'email_verified_at' => now(), // Social accounts are pre-verified
                    'settings' => [
                        'theme' => 'dark',
                        'simSpeed' => 'normal',
                        'notifications' => true,
                    ],
                ]);

                // Create user profile with default rewards
                UserProfile::create([
                    'user_id' => $user->id,
                    'rewards' => UserProfile::defaultRewards(),
                ]);
            }

            // Create social account link
            SocialAccount::create([
                'user_id' => $user->id,
                'provider' => $provider,
                'provider_id' => $socialUser->getId(),
                'token' => $socialUser->token,
                'refresh_token' => $socialUser->refreshToken,
            ]);
        }

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
     * Generate a unique username from a name.
     */
    protected function generateUniqueUsername(string $name): string
    {
        // Convert to lowercase, replace spaces with underscores, remove special chars
        $base = preg_replace('/[^a-zA-Z0-9_]/', '', str_replace(' ', '_', strtolower($name)));
        $base = substr($base, 0, 40); // Leave room for numbers

        $username = $base;
        $counter = 1;

        while (User::where('username', $username)->exists()) {
            $username = $base . '_' . $counter;
            $counter++;
        }

        return $username;
    }
}
