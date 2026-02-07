<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Trade extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'campaign_id',
        'season_id',
        'trade_date',
        'details',
    ];

    protected $casts = [
        'trade_date' => 'date',
        'details' => 'array',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function season(): BelongsTo
    {
        return $this->belongsTo(Season::class);
    }

    /**
     * Get teams involved in the trade.
     */
    public function getTeamsAttribute(): array
    {
        return $this->details['teams'] ?? [];
    }

    /**
     * Get assets exchanged in the trade.
     */
    public function getAssetsAttribute(): array
    {
        return $this->details['assets'] ?? [];
    }
}
