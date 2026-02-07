<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class NewsEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'campaign_id',
        'event_type',
        'headline',
        'body',
        'player_id',
        'team_id',
        'game_date',
        'is_read',
    ];

    protected $casts = [
        'game_date' => 'date',
        'is_read' => 'boolean',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function player(): BelongsTo
    {
        return $this->belongsTo(Player::class);
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    /**
     * Scope to get unread events.
     */
    public function scopeUnread($query)
    {
        return $query->where('is_read', false);
    }

    /**
     * Mark as read.
     */
    public function markAsRead(): void
    {
        $this->update(['is_read' => true]);
    }
}
