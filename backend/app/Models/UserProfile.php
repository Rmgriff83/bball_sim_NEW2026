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
    ];

    protected $casts = [
        'total_games' => 'integer',
        'total_wins' => 'integer',
        'championships' => 'integer',
        'seasons_completed' => 'integer',
        'play_time_minutes' => 'integer',
        'player_level' => 'integer',
        'experience_points' => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
