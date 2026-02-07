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
    ];

    protected $casts = [
        'attributes' => 'array',
        'contract_salary' => 'decimal:2',
        'overall_rating' => 'integer',
        'contract_years_remaining' => 'integer',
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
}
