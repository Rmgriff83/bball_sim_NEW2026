<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Team extends Model
{
    protected $fillable = [
        'campaign_id',
        'name',
        'city',
        'abbreviation',
        'conference',
        'division',
        'salary_cap',
        'total_payroll',
        'luxury_tax_bill',
        'facilities',
        'primary_color',
        'secondary_color',
        'logo_url',
        'coaching_scheme',
        'offensive_playbook',
        'lineup_settings',
    ];

    protected $casts = [
        'facilities' => 'array',
        'salary_cap' => 'decimal:2',
        'total_payroll' => 'decimal:2',
        'luxury_tax_bill' => 'decimal:2',
        'offensive_playbook' => 'array',
        'lineup_settings' => 'array',
        'coaching_scheme' => 'array',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function players(): HasMany
    {
        return $this->hasMany(Player::class);
    }

    public function coach(): HasOne
    {
        return $this->hasOne(Coach::class);
    }

    public function homeGames(): HasMany
    {
        return $this->hasMany(Game::class, 'home_team_id');
    }

    public function awayGames(): HasMany
    {
        return $this->hasMany(Game::class, 'away_team_id');
    }

    public function seasonStats(): HasMany
    {
        return $this->hasMany(TeamSeasonStats::class);
    }

    public function ownedDraftPicks(): HasMany
    {
        return $this->hasMany(DraftPick::class, 'current_owner_id');
    }

    public function originalDraftPicks(): HasMany
    {
        return $this->hasMany(DraftPick::class, 'original_team_id');
    }

    public function newsEvents(): HasMany
    {
        return $this->hasMany(NewsEvent::class);
    }

    /**
     * Get cap space remaining.
     */
    public function getCapSpaceAttribute(): float
    {
        return max(0, $this->salary_cap - $this->total_payroll);
    }
}
