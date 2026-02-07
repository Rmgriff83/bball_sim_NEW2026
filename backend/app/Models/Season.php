<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Season extends Model
{
    protected $fillable = [
        'campaign_id',
        'year',
        'phase',
        'standings',
        'playoff_bracket',
        'is_archived',
    ];

    protected $casts = [
        'standings' => 'array',
        'playoff_bracket' => 'array',
        'is_archived' => 'boolean',
        'year' => 'integer',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function games(): HasMany
    {
        return $this->hasMany(Game::class);
    }

    public function playerStats(): HasMany
    {
        return $this->hasMany(PlayerSeasonStats::class);
    }

    public function teamStats(): HasMany
    {
        return $this->hasMany(TeamSeasonStats::class);
    }

    public function trades(): HasMany
    {
        return $this->hasMany(Trade::class);
    }

    /**
     * Scope to get regular season games.
     */
    public function scopeRegularSeasonGames($query)
    {
        return $this->games()->where('is_playoff', false);
    }

    /**
     * Scope to get playoff games.
     */
    public function scopePlayoffGames($query)
    {
        return $this->games()->where('is_playoff', true);
    }
}
