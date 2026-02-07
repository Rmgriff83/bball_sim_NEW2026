<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TeamSeasonStats extends Model
{
    protected $fillable = [
        'team_id',
        'season_id',
        'wins',
        'losses',
        'home_wins',
        'home_losses',
        'points_scored',
        'points_allowed',
        'playoff_seed',
        'playoff_result',
    ];

    protected $casts = [
        'wins' => 'integer',
        'losses' => 'integer',
        'home_wins' => 'integer',
        'home_losses' => 'integer',
        'points_scored' => 'integer',
        'points_allowed' => 'integer',
        'playoff_seed' => 'integer',
    ];

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function season(): BelongsTo
    {
        return $this->belongsTo(Season::class);
    }

    /**
     * Get win percentage.
     */
    public function getWinPctAttribute(): float
    {
        $total = $this->wins + $this->losses;
        return $total > 0 ? round($this->wins / $total, 3) : 0;
    }

    /**
     * Get point differential.
     */
    public function getPointDifferentialAttribute(): int
    {
        return $this->points_scored - $this->points_allowed;
    }

    /**
     * Get points per game.
     */
    public function getPpgAttribute(): float
    {
        $games = $this->wins + $this->losses;
        return $games > 0 ? round($this->points_scored / $games, 1) : 0;
    }

    /**
     * Get opponent points per game.
     */
    public function getOppgAttribute(): float
    {
        $games = $this->wins + $this->losses;
        return $games > 0 ? round($this->points_allowed / $games, 1) : 0;
    }
}
