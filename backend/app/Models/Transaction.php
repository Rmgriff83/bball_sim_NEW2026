<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Transaction extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'campaign_id',
        'season_id',
        'transaction_type',
        'transaction_date',
        'details',
    ];

    protected $casts = [
        'transaction_date' => 'date',
        'details' => 'array',
        'created_at' => 'datetime',
    ];

    /**
     * Get the campaign that owns the transaction.
     */
    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    /**
     * Get the season when the transaction occurred.
     */
    public function season(): BelongsTo
    {
        return $this->belongsTo(Season::class);
    }

    /**
     * Scope to filter by transaction type.
     */
    public function scopeOfType($query, string $type)
    {
        return $query->where('transaction_type', $type);
    }

    /**
     * Scope to get recent transactions.
     */
    public function scopeRecent($query, int $limit = 10)
    {
        return $query->orderBy('transaction_date', 'desc')
                     ->orderBy('id', 'desc')
                     ->limit($limit);
    }
}
