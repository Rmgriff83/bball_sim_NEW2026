<?php

namespace App\Http\Controllers;

use App\Models\Achievement;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class UserController extends Controller
{
    /**
     * Get the authenticated user's profile.
     */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        $user->load('profile');

        return response()->json([
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'avatar_url' => $user->avatar_url,
                'settings' => $user->settings,
                'email_verified' => $user->hasVerifiedEmail(),
                'created_at' => $user->created_at,
            ],
            'profile' => $user->profile ? [
                'total_games' => $user->profile->total_games,
                'total_wins' => $user->profile->total_wins,
                'championships' => $user->profile->championships,
                'seasons_completed' => $user->profile->seasons_completed,
                'play_time_minutes' => $user->profile->play_time_minutes,
                'player_level' => $user->profile->player_level,
                'experience_points' => $user->profile->experience_points,
                'tokens' => $user->profile->getTokens(),
                'lifetime_synergies' => $user->profile->getLifetimeSynergies(),
            ] : null,
        ]);
    }

    /**
     * Update the authenticated user's profile.
     */
    public function update(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'username' => [
                'sometimes',
                'string',
                'min:3',
                'max:50',
                'regex:/^[a-zA-Z0-9_]+$/',
                Rule::unique('users')->ignore($user->id),
            ],
            'email' => [
                'sometimes',
                'string',
                'email',
                'max:255',
                Rule::unique('users')->ignore($user->id),
            ],
            'settings' => ['sometimes', 'array'],
            'settings.theme' => ['sometimes', 'string', 'in:dark,light'],
            'settings.simSpeed' => ['sometimes', 'string', 'in:instant,fast,normal,slow'],
            'settings.notifications' => ['sometimes', 'boolean'],
        ], [
            'username.regex' => 'Username can only contain letters, numbers, and underscores.',
        ]);

        // Check if email is being changed
        $emailChanged = isset($validated['email']) && $validated['email'] !== $user->email;

        if ($emailChanged) {
            $validated['email_verified_at'] = null;
        }

        // Merge settings if provided
        if (isset($validated['settings'])) {
            $validated['settings'] = array_merge($user->settings ?? [], $validated['settings']);
        }

        $user->update($validated);

        if ($emailChanged) {
            $user->sendEmailVerificationNotification();
        }

        return response()->json([
            'message' => 'Profile updated successfully.' . ($emailChanged ? ' Please verify your new email.' : ''),
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'avatar_url' => $user->avatar_url,
                'settings' => $user->settings,
                'email_verified' => $user->hasVerifiedEmail(),
            ],
        ]);
    }

    /**
     * Update the authenticated user's password.
     */
    public function updatePassword(Request $request): JsonResponse
    {
        $request->validate([
            'current_password' => ['required', 'current_password'],
            'password' => ['required', 'confirmed', Password::min(8)],
        ]);

        $request->user()->update([
            'password' => Hash::make($request->password),
        ]);

        return response()->json([
            'message' => 'Password updated successfully.',
        ]);
    }

    /**
     * Upload a user avatar.
     */
    public function uploadAvatar(Request $request): JsonResponse
    {
        $request->validate([
            'avatar' => ['required', 'image', 'max:2048'], // Max 2MB
        ]);

        $user = $request->user();

        // Delete old avatar if exists
        if ($user->avatar_url) {
            $oldPath = str_replace('/storage/', '', $user->avatar_url);
            Storage::disk('public')->delete($oldPath);
        }

        $path = $request->file('avatar')->store('avatars', 'public');

        $user->update([
            'avatar_url' => '/storage/' . $path,
        ]);

        return response()->json([
            'message' => 'Avatar uploaded successfully.',
            'avatar_url' => $user->avatar_url,
        ]);
    }

    /**
     * Delete the authenticated user's account.
     */
    public function destroy(Request $request): JsonResponse
    {
        $request->validate([
            'password' => ['required', 'current_password'],
        ]);

        $user = $request->user();

        // Delete avatar if exists
        if ($user->avatar_url) {
            $path = str_replace('/storage/', '', $user->avatar_url);
            Storage::disk('public')->delete($path);
        }

        // Revoke all tokens
        $user->tokens()->delete();

        // Delete user (cascade will handle related records)
        $user->delete();

        return response()->json([
            'message' => 'Account deleted successfully.',
        ]);
    }

    /**
     * Get the authenticated user's gaming statistics.
     */
    public function stats(Request $request): JsonResponse
    {
        $user = $request->user();
        $user->load('profile');

        if (!$user->profile) {
            return response()->json([
                'stats' => null,
            ]);
        }

        $winRate = $user->profile->total_games > 0
            ? round(($user->profile->total_wins / $user->profile->total_games) * 100, 1)
            : 0;

        return response()->json([
            'stats' => [
                'total_games' => $user->profile->total_games,
                'total_wins' => $user->profile->total_wins,
                'total_losses' => $user->profile->total_games - $user->profile->total_wins,
                'win_rate' => $winRate,
                'championships' => $user->profile->championships,
                'seasons_completed' => $user->profile->seasons_completed,
                'play_time_hours' => round($user->profile->play_time_minutes / 60, 1),
                'player_level' => $user->profile->player_level,
                'experience_points' => $user->profile->experience_points,
                'tokens' => $user->profile->getTokens(),
                'lifetime_synergies' => $user->profile->getLifetimeSynergies(),
            ],
        ]);
    }

    /**
     * Get the authenticated user's achievements.
     */
    public function achievements(Request $request): JsonResponse
    {
        $user = $request->user();
        $userAchievements = $user->achievements()->with('achievement')->get();

        return response()->json([
            'achievements' => $userAchievements->map(function ($ua) {
                return [
                    'id' => $ua->achievement->id,
                    'name' => $ua->achievement->name,
                    'description' => $ua->achievement->description,
                    'category' => $ua->achievement->category,
                    'points' => $ua->achievement->points,
                    'icon_url' => $ua->achievement->icon_url,
                    'unlocked_at' => $ua->unlocked_at,
                ];
            }),
        ]);
    }

    /**
     * Get all available achievements.
     */
    public function allAchievements(): JsonResponse
    {
        $achievements = Achievement::where('hidden', false)
            ->orWhereNull('hidden')
            ->get();

        return response()->json([
            'achievements' => $achievements->map(function ($a) {
                return [
                    'id' => $a->id,
                    'name' => $a->name,
                    'description' => $a->description,
                    'category' => $a->category,
                    'points' => $a->points,
                    'icon_url' => $a->icon_url,
                ];
            }),
        ]);
    }
}
