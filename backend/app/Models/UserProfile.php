<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

class UserProfile extends Model
{
    protected $fillable = [
        'user_id',
        'total_games',
        'total_wins',
        'championships',
        'seasons_completed',
        'play_time_minutes',
        'player_level',
        'experience_points',
        'rewards',
    ];

    protected $casts = [
        'total_games' => 'integer',
        'total_wins' => 'integer',
        'championships' => 'integer',
        'seasons_completed' => 'integer',
        'play_time_minutes' => 'integer',
        'player_level' => 'integer',
        'experience_points' => 'integer',
        'rewards' => 'array',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the default rewards structure.
     */
    public static function defaultRewards(): array
    {
        return [
            'tokens' => 0,
            'lifetime_synergies' => 0,
            'unlocked_features' => [],
            'gm_level' => 0,
        ];
    }

    /**
     * Get the user's current token balance.
     */
    public function getTokens(): int
    {
        return $this->rewards['tokens'] ?? 0;
    }

    /**
     * Get the user's lifetime synergy count.
     */
    public function getLifetimeSynergies(): int
    {
        return $this->rewards['lifetime_synergies'] ?? 0;
    }

    /**
     * Award tokens for synergy activations.
     *
     * @param int $synergyCount Number of synergies activated
     * @param int $tokensPerSynergy Tokens awarded per synergy (default: 1)
     * @return int Total tokens awarded
     */
    public function awardSynergyTokens(int $synergyCount, int $tokensPerSynergy = 1): int
    {
        if ($synergyCount <= 0) {
            return 0;
        }

        $tokensAwarded = $synergyCount * $tokensPerSynergy;
        $rewards = $this->rewards ?? self::defaultRewards();

        $rewards['tokens'] = ($rewards['tokens'] ?? 0) + $tokensAwarded;
        $rewards['lifetime_synergies'] = ($rewards['lifetime_synergies'] ?? 0) + $synergyCount;

        $this->rewards = $rewards;
        $this->save();

        return $tokensAwarded;
    }

    /**
     * Adjust the user's token balance by $amount (positive = credit, negative = spend).
     * Returns the new balance, or null if the change would push the balance negative.
     *
     * Implemented as ONE atomic UPDATE with in-database JSON arithmetic
     * (2026-07 token-credit-loss incident hardening) rather than the previous
     * PHP read-modify-write of the whole rewards blob. Two properties matter:
     *  - the increment is computed from the row's CURRENT committed value, so
     *    a concurrent writer holding a stale copy can never make this credit
     *    vanish (no lost-update window);
     *  - the spend guard rides in the WHERE clause, so "affected 0 rows" IS
     *    the insufficient-balance answer — check and decrement are one
     *    indivisible statement.
     */
    public function creditTokens(int $amount): ?int
    {
        $tokensExpr = "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(rewards, '$.tokens')) AS SIGNED), 0)";

        $query = static::query()->whereKey($this->getKey());
        if ($amount < 0) {
            $query->whereRaw("{$tokensExpr} >= ?", [-$amount]);
        }

        $affected = $query->update([
            // $amount is an int-typed parameter — interpolation is safe.
            'rewards' => DB::raw("JSON_SET(COALESCE(rewards, '{}'), '$.tokens', {$tokensExpr} + {$amount})"),
            'updated_at' => now(),
        ]);

        if ($affected === 0) {
            return null; // spend guard rejected — balance unchanged
        }

        $this->refresh();

        return $this->getTokens();
    }

    /**
     * Get the user's career GM level (0-4). Profile-global, like tokens; rises
     * by +1 each time an owner extends the GM's contract. Backed by
     * rewards.gm_level so no dedicated column is needed.
     */
    public function getGmLevel(): int
    {
        return max(0, min(4, (int) ($this->rewards['gm_level'] ?? 0)));
    }

    /**
     * Set the user's career GM level, clamped to 0-4. Returns the stored value.
     */
    public function setGmLevel(int $level): int
    {
        $clamped = max(0, min(4, $level));
        $rewards = $this->rewards ?? self::defaultRewards();
        $rewards['gm_level'] = $clamped;
        $this->rewards = $rewards;
        $this->save();

        return $clamped;
    }

    /**
     * Return the user's unlocked feature flags as a plain array. Backed by
     * rewards.unlocked_features (snake_case for parity with the rest of the
     * column; the API layer translates to camelCase for the frontend).
     */
    public function getUnlockedFeatures(): array
    {
        $features = $this->rewards['unlocked_features'] ?? [];
        return is_array($features) ? array_values($features) : [];
    }

    /**
     * Check if the user owns a given one-time unlock (e.g. 'headshot_editor').
     */
    public function hasUnlock(string $feature): bool
    {
        return in_array($feature, $this->getUnlockedFeatures(), true);
    }

    /**
     * Grant a one-time unlock. Idempotent — calling repeatedly with the same
     * feature key is a no-op. Returns the full list of unlocked features.
     */
    public function setUnlock(string $feature): array
    {
        $rewards = $this->rewards ?? self::defaultRewards();
        $features = $rewards['unlocked_features'] ?? [];
        if (!is_array($features)) {
            $features = [];
        }
        if (!in_array($feature, $features, true)) {
            $features[] = $feature;
            $rewards['unlocked_features'] = array_values($features);
            $this->rewards = $rewards;
            $this->save();
        }
        return array_values($features);
    }
}
