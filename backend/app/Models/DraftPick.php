<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DraftPick extends Model
{
    protected $fillable = [
        'campaign_id',
        'original_team_id',
        'current_owner_id',
        'year',
        'round',
        'pick_number',
        'player_id',
        'is_traded',
        'trade_conditions',
    ];

    protected $casts = [
        'trade_conditions' => 'array',
        'is_traded' => 'boolean',
        'year' => 'integer',
        'round' => 'integer',
        'pick_number' => 'integer',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function originalTeam(): BelongsTo
    {
        return $this->belongsTo(Team::class, 'original_team_id');
    }

    public function currentOwner(): BelongsTo
    {
        return $this->belongsTo(Team::class, 'current_owner_id');
    }

    public function player(): BelongsTo
    {
        return $this->belongsTo(Player::class);
    }

    /**
     * Get display name for the pick.
     */
    public function getDisplayNameAttribute(): string
    {
        $year = $this->year;
        $round = $this->round == 1 ? '1st' : '2nd';
        $team = $this->originalTeam->abbreviation ?? 'UNK';

        if ($this->is_traded && $this->original_team_id !== $this->current_owner_id) {
            return "{$year} {$round} Round ({$team})";
        }

        return "{$year} {$round} Round";
    }
}
