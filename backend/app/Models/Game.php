<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Game extends Model
{
    protected $fillable = [
        'season_id',
        'home_team_id',
        'away_team_id',
        'game_date',
        'is_playoff',
        'playoff_round',
        'playoff_game_number',
        'home_score',
        'away_score',
        'is_complete',
        'box_score',
    ];

    protected $casts = [
        'game_date' => 'date',
        'box_score' => 'array',
        'is_playoff' => 'boolean',
        'is_complete' => 'boolean',
        'home_score' => 'integer',
        'away_score' => 'integer',
        'playoff_round' => 'integer',
        'playoff_game_number' => 'integer',
    ];

    public function season(): BelongsTo
    {
        return $this->belongsTo(Season::class);
    }

    public function homeTeam(): BelongsTo
    {
        return $this->belongsTo(Team::class, 'home_team_id');
    }

    public function awayTeam(): BelongsTo
    {
        return $this->belongsTo(Team::class, 'away_team_id');
    }

    /**
     * Get the winning team.
     */
    public function getWinnerAttribute(): ?Team
    {
        if (!$this->is_complete) {
            return null;
        }

        return $this->home_score > $this->away_score
            ? $this->homeTeam
            : $this->awayTeam;
    }

    /**
     * Get the losing team.
     */
    public function getLoserAttribute(): ?Team
    {
        if (!$this->is_complete) {
            return null;
        }

        return $this->home_score < $this->away_score
            ? $this->homeTeam
            : $this->awayTeam;
    }

    /**
     * Scope to get completed games.
     */
    public function scopeCompleted($query)
    {
        return $query->where('is_complete', true);
    }

    /**
     * Scope to get upcoming games.
     */
    public function scopeUpcoming($query)
    {
        return $query->where('is_complete', false);
    }
}
