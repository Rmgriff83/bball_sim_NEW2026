<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PlayerSeasonStats extends Model
{
    protected $fillable = [
        'player_id',
        'season_id',
        'team_id',
        'games_played',
        'games_started',
        'minutes_played',
        'points',
        'rebounds',
        'offensive_rebounds',
        'defensive_rebounds',
        'assists',
        'steals',
        'blocks',
        'turnovers',
        'personal_fouls',
        'field_goals_made',
        'field_goals_attempted',
        'three_pointers_made',
        'three_pointers_attempted',
        'free_throws_made',
        'free_throws_attempted',
        'player_efficiency_rating',
        'true_shooting_pct',
        'usage_rate',
        'win_shares',
    ];

    protected $casts = [
        'games_played' => 'integer',
        'games_started' => 'integer',
        'minutes_played' => 'integer',
        'points' => 'integer',
        'rebounds' => 'integer',
        'offensive_rebounds' => 'integer',
        'defensive_rebounds' => 'integer',
        'assists' => 'integer',
        'steals' => 'integer',
        'blocks' => 'integer',
        'turnovers' => 'integer',
        'personal_fouls' => 'integer',
        'field_goals_made' => 'integer',
        'field_goals_attempted' => 'integer',
        'three_pointers_made' => 'integer',
        'three_pointers_attempted' => 'integer',
        'free_throws_made' => 'integer',
        'free_throws_attempted' => 'integer',
        'player_efficiency_rating' => 'decimal:2',
        'true_shooting_pct' => 'decimal:4',
        'usage_rate' => 'decimal:4',
        'win_shares' => 'decimal:2',
    ];

    public function player(): BelongsTo
    {
        return $this->belongsTo(Player::class);
    }

    public function season(): BelongsTo
    {
        return $this->belongsTo(Season::class);
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    // Per-game averages
    public function getPpgAttribute(): float
    {
        return $this->games_played > 0 ? round($this->points / $this->games_played, 1) : 0;
    }

    public function getRpgAttribute(): float
    {
        return $this->games_played > 0 ? round($this->rebounds / $this->games_played, 1) : 0;
    }

    public function getApgAttribute(): float
    {
        return $this->games_played > 0 ? round($this->assists / $this->games_played, 1) : 0;
    }

    public function getSpgAttribute(): float
    {
        return $this->games_played > 0 ? round($this->steals / $this->games_played, 1) : 0;
    }

    public function getBpgAttribute(): float
    {
        return $this->games_played > 0 ? round($this->blocks / $this->games_played, 1) : 0;
    }

    public function getMpgAttribute(): float
    {
        return $this->games_played > 0 ? round($this->minutes_played / $this->games_played, 1) : 0;
    }

    // Shooting percentages
    public function getFgPctAttribute(): float
    {
        return $this->field_goals_attempted > 0
            ? round(($this->field_goals_made / $this->field_goals_attempted) * 100, 1)
            : 0;
    }

    public function getThreePctAttribute(): float
    {
        return $this->three_pointers_attempted > 0
            ? round(($this->three_pointers_made / $this->three_pointers_attempted) * 100, 1)
            : 0;
    }

    public function getFtPctAttribute(): float
    {
        return $this->free_throws_attempted > 0
            ? round(($this->free_throws_made / $this->free_throws_attempted) * 100, 1)
            : 0;
    }
}
