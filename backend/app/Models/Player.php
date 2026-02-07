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
}
