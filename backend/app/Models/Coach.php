<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Coach extends Model
{
    protected $fillable = [
        'campaign_id',
        'team_id',
        'first_name',
        'last_name',
        'overall_rating',
        'attributes',
        'offensive_scheme',
        'defensive_scheme',
        'contract_years_remaining',
        'contract_salary',
        // Career stats
        'career_wins',
        'career_losses',
        'playoff_wins',
        'playoff_losses',
        'championships',
        'conference_titles',
        'coach_of_year_awards',
        'seasons_coached',
    ];

    protected $casts = [
        'attributes' => 'array',
        'contract_salary' => 'decimal:2',
        'overall_rating' => 'integer',
        'contract_years_remaining' => 'integer',
        'career_wins' => 'integer',
        'career_losses' => 'integer',
        'playoff_wins' => 'integer',
        'playoff_losses' => 'integer',
        'championships' => 'integer',
        'conference_titles' => 'integer',
        'coach_of_year_awards' => 'integer',
        'seasons_coached' => 'integer',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    /**
     * Get coach's full name.
     */
    public function getFullNameAttribute(): string
    {
        return "{$this->first_name} {$this->last_name}";
    }

    /**
     * Check if coach is available to hire.
     */
    public function getIsAvailableAttribute(): bool
    {
        return is_null($this->team_id);
    }

    /**
     * Scope to get available coaches.
     */
    public function scopeAvailable($query)
    {
        return $query->whereNull('team_id');
    }

    /**
     * Get career win percentage.
     */
    public function getCareerWinPctAttribute(): float
    {
        $total = $this->career_wins + $this->career_losses;
        if ($total === 0) return 0;
        return round($this->career_wins / $total * 100, 1);
    }

    /**
     * Get playoff win percentage.
     */
    public function getPlayoffWinPctAttribute(): float
    {
        $total = $this->playoff_wins + $this->playoff_losses;
        if ($total === 0) return 0;
        return round($this->playoff_wins / $total * 100, 1);
    }

    /**
     * Get total career games.
     */
    public function getTotalGamesAttribute(): int
    {
        return $this->career_wins + $this->career_losses + $this->playoff_wins + $this->playoff_losses;
    }

    /**
     * Record a game result for this coach.
     */
    public function recordGameResult(bool $won, bool $isPlayoff = false): void
    {
        if ($isPlayoff) {
            $won ? $this->increment('playoff_wins') : $this->increment('playoff_losses');
        } else {
            $won ? $this->increment('career_wins') : $this->increment('career_losses');
        }
    }
}
