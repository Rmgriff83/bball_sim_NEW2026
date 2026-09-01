<?php

namespace App\Http\Controllers;

use App\Models\Achievement;
use App\Models\SocialAccount;
use App\Models\User;
use App\Services\SocialTokenVerifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
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
        $user->load('profile', 'socialAccounts');

        return response()->json([
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'avatar_url' => $user->avatar_url,
                'settings' => $user->settings,
                'email_verified' => $user->hasVerifiedEmail(),
                'created_at' => $user->created_at,
                'global_admin' => (bool) $user->global_admin,
                'has_password' => (bool) $user->has_password,
                'linked_providers' => $user->socialAccounts->pluck('provider')->unique()->values(),
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
                // Career GM level (0-4), profile-global like tokens. Read by
                // authStore as profile.gmLevel.
                'gmLevel' => $user->profile->getGmLevel(),
                // Frontend reads camelCase via authStore.hasFeature(); the
                // storage column uses snake_case. Translate at the boundary.
                'unlockedFeatures' => $user->profile->getUnlockedFeatures(),
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
            'has_password' => true,
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
     * Link a verified Apple/Google identity to the authenticated account.
     * Keyed on the provider's stable user id (`sub`), so it works regardless of
     * email (incl. Apple "Hide My Email"). Does not touch the user's email.
     */
    public function linkSocialAccount(Request $request, SocialTokenVerifier $verifier): JsonResponse
    {
        $data = $request->validate([
            'provider' => ['required', 'in:apple,google'],
            'credential' => ['required', 'string'],
            'name' => ['nullable', 'string', 'max:255'],
            'email' => ['nullable', 'email'],
        ]);

        try {
            $claims = $verifier->verify($data['provider'], $data['credential']);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Could not verify that '.ucfirst($data['provider']).' account.',
                'error' => $e->getMessage(),
            ], 401);
        }

        if (empty($claims['sub'])) {
            return response()->json(['message' => 'Invalid identity token.'], 401);
        }

        $user = $request->user();

        $existing = SocialAccount::where('provider', $data['provider'])
            ->where('provider_id', $claims['sub'])
            ->first();

        if ($existing && $existing->user_id !== $user->id) {
            return response()->json([
                'message' => 'This '.ucfirst($data['provider']).' account is already linked to another user.',
            ], 409);
        }

        if (! $existing) {
            SocialAccount::create([
                'user_id' => $user->id,
                'provider' => $data['provider'],
                'provider_id' => $claims['sub'],
            ]);
        }

        return $this->socialStateResponse($user->fresh('socialAccounts'), 'Account linked.');
    }

    /**
     * Unlink an Apple/Google identity from the authenticated account. Refuses to
     * remove the user's only sign-in method when they have no password set.
     */
    public function unlinkSocialAccount(Request $request, string $provider): JsonResponse
    {
        if (! in_array($provider, ['apple', 'google'], true)) {
            return response()->json(['message' => 'Unsupported provider.'], 422);
        }

        $user = $request->user();
        $user->load('socialAccounts');

        if ($user->socialAccounts->firstWhere('provider', $provider) === null) {
            return response()->json(['message' => 'That account is not linked.'], 422);
        }

        if (! $user->has_password && $user->socialAccounts->count() <= 1) {
            return response()->json([
                'message' => 'Set a password before unlinking your only sign-in method.',
            ], 422);
        }

        $user->socialAccounts()->where('provider', $provider)->delete();

        return $this->socialStateResponse($user->fresh('socialAccounts'), 'Account unlinked.');
    }

    /**
     * Standard payload describing the user's current sign-in linkage.
     */
    private function socialStateResponse(User $user, string $message): JsonResponse
    {
        return response()->json([
            'message' => $message,
            'linked_providers' => $user->socialAccounts->pluck('provider')->unique()->values(),
            'has_password' => (bool) $user->has_password,
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
     * Adjust the user's token balance.
     * POST /api/user/tokens
     */
    public function updateTokens(Request $request): JsonResponse
    {
        // Positive ceiling: client-side awards are small (largest legit
        // single credit is the 3,500 championship payout) — purchases are
        // credited exclusively by the payment webhooks, never through this
        // endpoint, so an implausibly large client-stated credit is rejected
        // outright. Spends (negative) are already bounded by the balance
        // guard in creditTokens.
        $validated = $request->validate([
            'amount' => 'required|integer|not_in:0|between:-100000,5000',
        ]);

        $user = $request->user();
        $profile = $user->profile;

        if (!$profile) {
            return response()->json(['message' => 'Profile not found'], 404);
        }

        $newBalance = $profile->creditTokens($validated['amount']);

        if ($newBalance === null) {
            return response()->json(['message' => 'Insufficient tokens'], 422);
        }

        // Audit line for every client-driven token movement. The 2026-07-10
        // credit-loss investigation stalled for a week because spends left
        // no server-side trace — this line makes any future balance dispute
        // answerable straight from the log.
        Log::notice('Tokens adjusted', [
            'user_id' => $user->id,
            'amount' => $validated['amount'],
            'new_balance' => $newBalance,
        ]);

        return response()->json([
            'tokens' => $newBalance,
        ]);
    }

    /**
     * Ledger-flush earn ceiling: max tokens creditable per user per UTC day
     * through this endpoint. Excess earn entries are returned as `deferred`
     * (the client keeps them queued and re-flushes on a later day). Prod
     * logs (2026-08-28) showed heavy legitimate play sustains ~770/hr —
     * back-to-back season sims where a single championship run nets 5.5k+
     * (250+750+3500 playoff + 1000 owner bonus) — so the original 5000 cap
     * deferred real players by mid-morning and their balances drifted below
     * what the app displayed. Sized ~5x the heaviest observed legitimate
     * day so real play never defers, while forged-entry farming stays
     * bounded (and below what the legacy endpoint already allows).
     */
    private const LEDGER_DAILY_EARN_CAP = 25000;

    /**
     * Per-reason validation for ledger EARN entries — the abuse surface.
     * game_reward: 1..21 (client-side MAX_TOKENS_PER_GAME); playoff_payout:
     * exact tier amounts; owner_bonus: exactly 1000. Spend reasons accept any
     * negative amount (they only lower the user's own balance, and the
     * clamped credit floors it at 0 — validating exact prices here would
     * break legit offline purchases whenever a client-side price changes).
     */
    private const LEDGER_EARN_RULES = [
        'game_reward' => ['min' => 1, 'max' => 21],
        'playoff_payout' => ['exact' => [250, 750, 3500]],
        'owner_bonus' => ['exact' => [1000]],
    ];

    private const LEDGER_SPEND_REASONS = [
        'facility_upgrade', 'staff_hire', 'coach_hire', 'coach_resign',
        'coach_meeting', 'badge_purchase', 'upgrade_point', 'marketing_event',
    ];

    /**
     * Flush a batch of offline token deltas (earns + spends queued on-device
     * while the app had no connectivity). Idempotent per (user, batch_id):
     * a replayed batch returns its stored result and never re-applies —
     * mirrors the payment-webhook claim pattern.
     * POST /api/user/tokens/ledger
     */
    public function flushTokenLedger(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'batch_id' => 'required|uuid',
            'entries' => 'required|array|min:1|max:200',
            'entries.*.id' => 'required|uuid|distinct',
            'entries.*.amount' => 'required|integer|not_in:0|between:-100000,3500',
            'entries.*.reason' => 'required|string|in:game_reward,playoff_payout,owner_bonus,'
                . 'facility_upgrade,staff_hire,coach_hire,coach_resign,coach_meeting,badge_purchase,upgrade_point,marketing_event',
        ]);

        $user = $request->user();
        $profile = $user->profile;

        if (!$profile) {
            return response()->json(['message' => 'Profile not found'], 404);
        }

        $result = DB::transaction(function () use ($user, $profile, $validated) {
            // Claim the batch. insertOrIgnore + the unique (user_id, batch_id)
            // index makes this the idempotency gate: 0 rows = someone already
            // claimed it (concurrent request holds the row lock until commit;
            // a finished one has its stored result) — replay, never re-apply.
            $claimed = DB::table('token_ledger_batches')->insertOrIgnore([
                'user_id' => $user->id,
                'batch_id' => $validated['batch_id'],
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            if ($claimed === 0) {
                $row = DB::table('token_ledger_batches')
                    ->where('user_id', $user->id)
                    ->where('batch_id', $validated['batch_id'])
                    ->lockForUpdate()
                    ->first();
                $stored = $row && $row->result ? json_decode($row->result, true) : null;
                if (is_array($stored)) {
                    // Replay the original outcome with the CURRENT balance.
                    $stored['tokens'] = $profile->refresh()->getTokens();
                    $stored['replayed'] = true;
                    return $stored;
                }
                // Claimed row without a result should be unreachable (claim +
                // apply share this transaction), but fail safe: report nothing
                // credited so the client retries with the same batch id later.
                return [
                    'tokens' => $profile->refresh()->getTokens(),
                    'credited' => [], 'deferred' => [], 'rejected' => [],
                    'incomplete' => true,
                ];
            }

            // Partition entries: semantic validation happens HERE (not in the
            // validator) so one bad entry becomes `rejected` instead of
            // 422-stranding the legitimate entries beside it.
            $rejected = [];
            $spendSum = 0;
            $earns = [];
            foreach ($validated['entries'] as $entry) {
                $amount = (int) $entry['amount'];
                $reason = $entry['reason'];
                if ($amount < 0) {
                    if (!in_array($reason, self::LEDGER_SPEND_REASONS, true)) {
                        $rejected[] = $entry['id'];
                        continue;
                    }
                    $spendSum += $amount;
                    continue;
                }
                $rules = self::LEDGER_EARN_RULES[$reason] ?? null;
                $valid = $rules !== null && (
                    isset($rules['exact'])
                        ? in_array($amount, $rules['exact'], true)
                        : ($amount >= $rules['min'] && $amount <= $rules['max'])
                );
                if (!$valid) {
                    $rejected[] = $entry['id'];
                    continue;
                }
                $earns[] = $entry;
            }

            // Daily earn ceiling: row-locked counter for today (UTC), credit
            // whole earn entries oldest-first while they fit the remaining
            // headroom; the rest defer to a later day (client keeps them).
            $today = now('UTC')->toDateString();
            DB::table('user_token_earn_days')->insertOrIgnore([
                'user_id' => $user->id,
                'day' => $today,
                'earned' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $dayRow = DB::table('user_token_earn_days')
                ->where('user_id', $user->id)
                ->where('day', $today)
                ->lockForUpdate()
                ->first();
            $headroom = max(0, self::LEDGER_DAILY_EARN_CAP - (int) ($dayRow->earned ?? 0));

            $credited = [];
            $deferred = [];
            $earnSum = 0;
            $deferredSum = 0;
            foreach ($earns as $entry) {
                $amount = (int) $entry['amount'];
                if ($amount <= $headroom) {
                    $credited[] = $entry['id'];
                    $earnSum += $amount;
                    $headroom -= $amount;
                } else {
                    $deferred[] = $entry['id'];
                    $deferredSum += $amount;
                }
            }
            if ($earnSum > 0) {
                DB::table('user_token_earn_days')
                    ->where('user_id', $user->id)
                    ->where('day', $today)
                    ->update(['earned' => DB::raw("earned + {$earnSum}"), 'updated_at' => now()]);
            }

            // Spends are consumed regardless of the net's sign — the client's
            // local purchases are already applied on-device.
            $credited = array_merge($credited, array_values(array_filter(
                array_map(fn ($e) => ((int) $e['amount']) < 0 ? $e['id'] : null, $validated['entries'])
            )));

            $net = $spendSum + $earnSum;
            if ($net > 0) {
                $newBalance = $profile->creditTokens($net); // positive never returns null
            } elseif ($net < 0) {
                // Overdraw (cross-device races only) clamps the balance to 0
                // rather than stranding a client whose purchases are applied.
                $newBalance = $profile->creditTokensClamped($net);
            } else {
                $newBalance = $profile->refresh()->getTokens();
            }

            $summary = [
                'tokens' => $newBalance,
                'credited' => $credited,
                'deferred' => $deferred,
                'rejected' => $rejected,
                'deferred_sum' => $deferredSum,
            ];

            DB::table('token_ledger_batches')
                ->where('user_id', $user->id)
                ->where('batch_id', $validated['batch_id'])
                ->update([
                    'net' => $net,
                    'result' => json_encode($summary + ['net' => $net]),
                    'updated_at' => now(),
                ]);

            return $summary + ['net' => $net];
        });

        // Audit line, same spirit as 'Tokens adjusted' — every ledger flush is
        // traceable per user + batch with the applied net and outcome counts.
        Log::notice('Token ledger flushed', [
            'user_id' => $user->id,
            'batch_id' => $validated['batch_id'],
            'net' => $result['net'] ?? 0,
            'new_balance' => $result['tokens'],
            'credited' => count($result['credited']),
            'deferred' => count($result['deferred']),
            // Total tokens NOT credited this flush (over the daily cap) — the
            // count alone can't reconstruct how much a user is owed.
            'deferred_sum' => (int) ($result['deferred_sum'] ?? 0),
            'rejected' => count($result['rejected']),
            'replayed' => (bool) ($result['replayed'] ?? false),
        ]);

        return response()->json([
            'tokens' => $result['tokens'],
            'credited' => $result['credited'],
            'deferred' => $result['deferred'],
            'rejected' => $result['rejected'],
        ]);
    }

    /**
     * Set the user's career GM level (0-4). Called when an owner extends the
     * GM's contract (+1) or to grandfather a legacy GM up to a floor.
     * POST /api/user/gm-level
     */
    public function updateGmLevel(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'level' => 'required|integer|between:0,4',
        ]);

        $user = $request->user();
        $profile = $user->profile;

        if (!$profile) {
            return response()->json(['message' => 'Profile not found'], 404);
        }

        $finalLevel = $profile->setGmLevel($validated['level']);

        return response()->json([
            'gmLevel' => $finalLevel,
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
