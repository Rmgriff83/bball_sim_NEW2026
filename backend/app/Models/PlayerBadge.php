<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PlayerBadge extends Model
{
    protected $fillable = [
        'player_id',
        'badge_definition_id',
        'level',
    ];

    protected $casts = [
        'player_id' => 'integer',
    ];

    public function player(): BelongsTo
    {
        return $this->belongsTo(Player::class);
    }

    public function badgeDefinition(): BelongsTo
    {
        return $this->belongsTo(BadgeDefinition::class);
    }

    /**
     * Get level as numeric value for sorting/comparison.
     */
    public function getLevelValueAttribute(): int
    {
        return match ($this->level) {
            'bronze' => 1,
            'silver' => 2,
            'gold' => 3,
            'hof' => 4,
            default => 0,
        };
    }
}
