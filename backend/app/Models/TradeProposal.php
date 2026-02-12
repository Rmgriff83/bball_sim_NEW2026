<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TradeProposal extends Model
{
    use HasFactory;

    protected $fillable = [
        'campaign_id',
        'proposing_team_id',
        'status',
        'proposal',
        'reason',
        'expires_at',
    ];

    protected $casts = [
        'proposal' => 'array',
        'expires_at' => 'date',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function proposingTeam(): BelongsTo
    {
        return $this->belongsTo(Team::class, 'proposing_team_id');
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast() || $this->status === 'expired';
    }
}
