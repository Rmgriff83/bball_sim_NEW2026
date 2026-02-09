<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Player extends Model
{
    protected $fillable = [
        'campaign_id',
        'team_id',
        'first_name',
        'last_name',
        'position',
        'secondary_position',
        'jersey_number',
        'height_inches',
        'weight_lbs',
        'birth_date',
        'country',
        'college',
        'draft_year',
        'draft_round',
        'draft_pick',
        'overall_rating',
        'potential_rating',
        'attributes',
        'tendencies',
        'badges',
        'personality',
        'contract_years_remaining',
        'contract_salary',
        'contract_details',
        'trade_value',
        'trade_value_total',
        'injury_risk',
        'is_injured',
        'injury_details',
        'fatigue',
        // Evolution tracking fields
        'games_played_this_season',
        'minutes_played_this_season',
        'development_history',
        'streak_data',
        'career_seasons',
        'is_retired',
        'recent_performances',
        // Career stats
        'career_games_played',
        'career_games_started',
        'career_minutes',
        'career_points',
        'career_rebounds',
        'career_assists',
        'career_steals',
        'career_blocks',
        'career_turnovers',
        'career_fgm',
        'career_fga',
        'career_fg3m',
        'career_fg3a',
        'career_ftm',
        'career_fta',
        'championships',
        'all_star_selections',
        'mvp_awards',
        'finals_mvp_awards',
        'conference_finals_mvp_awards',
        'seasons_played',
    ];

    protected $casts = [
        'birth_date' => 'date',
        'attributes' => 'array',
        'tendencies' => 'array',
        'badges' => 'array',
        'personality' => 'array',
        'contract_details' => 'array',
        'injury_details' => 'array',
        'contract_salary' => 'decimal:2',
        'trade_value' => 'decimal:2',
        'trade_value_total' => 'decimal:2',
        'is_injured' => 'boolean',
        'overall_rating' => 'integer',
        'potential_rating' => 'integer',
        'height_inches' => 'integer',
        'weight_lbs' => 'integer',
        'fatigue' => 'integer',
        'contract_years_remaining' => 'integer',
        'jersey_number' => 'integer',
        'draft_year' => 'integer',
        'draft_round' => 'integer',
        'draft_pick' => 'integer',
        // Evolution tracking
        'games_played_this_season' => 'integer',
        'minutes_played_this_season' => 'integer',
        'development_history' => 'array',
        'streak_data' => 'array',
        'career_seasons' => 'integer',
        'is_retired' => 'boolean',
        'recent_performances' => 'array',
        // Career stats
        'career_games_played' => 'integer',
        'career_games_started' => 'integer',
        'career_minutes' => 'integer',
        'career_points' => 'integer',
        'career_rebounds' => 'integer',
        'career_assists' => 'integer',
        'career_steals' => 'integer',
        'career_blocks' => 'integer',
        'career_turnovers' => 'integer',
        'career_fgm' => 'integer',
        'career_fga' => 'integer',
        'career_fg3m' => 'integer',
        'career_fg3a' => 'integer',
        'career_ftm' => 'integer',
        'career_fta' => 'integer',
        'championships' => 'integer',
        'all_star_selections' => 'integer',
        'mvp_awards' => 'integer',
        'finals_mvp_awards' => 'integer',
        'conference_finals_mvp_awards' => 'integer',
        'seasons_played' => 'integer',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function seasonStats(): HasMany
    {
        return $this->hasMany(PlayerSeasonStats::class);
    }

    public function hallOfFame(): HasOne
    {
        return $this->hasOne(HallOfFame::class);
    }

    public function newsEvents(): HasMany
    {
        return $this->hasMany(NewsEvent::class);
    }

    /**
     * Get player badges from bridge table (for DB players).
     */
    public function badgeRelations(): HasMany
    {
        return $this->hasMany(PlayerBadge::class);
    }

    /**
     * Get all badges - prefers bridge table, falls back to JSON column.
     */
    public function getAllBadges(): array
    {
        // If player has badges in bridge table, use those
        if ($this->badgeRelations()->exists()) {
            return $this->badgeRelations()
                ->with('badgeDefinition')
                ->get()
                ->map(fn($pb) => [
                    'id' => $pb->badge_definition_id,
                    'level' => $pb->level,
                    'name' => $pb->badgeDefinition?->name,
                    'category' => $pb->badgeDefinition?->category,
                ])
                ->toArray();
        }

        // Fall back to JSON column for backward compatibility
        return $this->badges ?? [];
    }

    /**
     * Get player's full name.
     */
    public function getFullNameAttribute(): string
    {
        return "{$this->first_name} {$this->last_name}";
    }

    /**
     * Get player's height as formatted string (e.g., "6'2"").
     */
    public function getHeightFormattedAttribute(): string
    {
        $feet = floor($this->height_inches / 12);
        $inches = $this->height_inches % 12;
        return "{$feet}'{$inches}\"";
    }

    /**
     * Get player's age based on birth date.
     */
    public function getAgeAttribute(): int
    {
        return $this->birth_date->age;
    }

    /**
     * Check if player is a free agent.
     */
    public function getIsFreeAgentAttribute(): bool
    {
        return is_null($this->team_id);
    }

    /**
     * Scope to get free agents.
     */
    public function scopeFreeAgents($query)
    {
        return $query->whereNull('team_id');
    }

    /**
     * Scope to get players by position.
     */
    public function scopePosition($query, string $position)
    {
        return $query->where('position', $position)
            ->orWhere('secondary_position', $position);
    }

    /**
     * Get career points per game.
     */
    public function getCareerPpgAttribute(): float
    {
        if (($this->career_games_played ?? 0) === 0) return 0;
        return round($this->career_points / $this->career_games_played, 1);
    }

    /**
     * Get career rebounds per game.
     */
    public function getCareerRpgAttribute(): float
    {
        if (($this->career_games_played ?? 0) === 0) return 0;
        return round($this->career_rebounds / $this->career_games_played, 1);
    }

    /**
     * Get career assists per game.
     */
    public function getCareerApgAttribute(): float
    {
        if (($this->career_games_played ?? 0) === 0) return 0;
        return round($this->career_assists / $this->career_games_played, 1);
    }

    /**
     * Get career FG percentage.
     */
    public function getCareerFgPctAttribute(): float
    {
        if (($this->career_fga ?? 0) === 0) return 0;
        return round($this->career_fgm / $this->career_fga * 100, 1);
    }

    /**
     * Get career 3P percentage.
     */
    public function getCareerThreePctAttribute(): float
    {
        if (($this->career_fg3a ?? 0) === 0) return 0;
        return round($this->career_fg3m / $this->career_fg3a * 100, 1);
    }

    /**
     * Get career FT percentage.
     */
    public function getCareerFtPctAttribute(): float
    {
        if (($this->career_fta ?? 0) === 0) return 0;
        return round($this->career_ftm / $this->career_fta * 100, 1);
    }

    /**
     * Record game stats to career totals.
     */
    public function recordGameStats(array $stats, bool $started = false): void
    {
        $minutes = $stats['minutes'] ?? 0;

        // Only count as a game played if the player actually played
        if ($minutes > 0) {
            $this->increment('career_games_played');
            if ($started) {
                $this->increment('career_games_started');
            }
        }

        $this->increment('career_minutes', $minutes);
        $this->increment('career_points', $stats['points'] ?? 0);
        $this->increment('career_rebounds', $stats['rebounds'] ?? 0);
        $this->increment('career_assists', $stats['assists'] ?? 0);
        $this->increment('career_steals', $stats['steals'] ?? 0);
        $this->increment('career_blocks', $stats['blocks'] ?? 0);
        $this->increment('career_turnovers', $stats['turnovers'] ?? 0);
        $this->increment('career_fgm', $stats['fgm'] ?? $stats['fieldGoalsMade'] ?? 0);
        $this->increment('career_fga', $stats['fga'] ?? $stats['fieldGoalsAttempted'] ?? 0);
        $this->increment('career_fg3m', $stats['fg3m'] ?? $stats['threePointersMade'] ?? 0);
        $this->increment('career_fg3a', $stats['fg3a'] ?? $stats['threePointersAttempted'] ?? 0);
        $this->increment('career_ftm', $stats['ftm'] ?? $stats['freeThrowsMade'] ?? 0);
        $this->increment('career_fta', $stats['fta'] ?? $stats['freeThrowsAttempted'] ?? 0);
    }
}
