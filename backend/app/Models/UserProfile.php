<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
}
