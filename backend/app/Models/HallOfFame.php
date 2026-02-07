<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HallOfFame extends Model
{
    public $timestamps = false;

    protected $table = 'hall_of_fame';

    protected $fillable = [
        'campaign_id',
        'player_id',
        'career_stats',
        'induction_year',
    ];

    protected $casts = [
        'career_stats' => 'array',
        'induction_year' => 'integer',
        'inducted_at' => 'datetime',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function player(): BelongsTo
    {
        return $this->belongsTo(Player::class);
    }
}
