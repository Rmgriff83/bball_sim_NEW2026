<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Record extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'campaign_id',
        'record_type',
        'category',
        'record_value',
        'player_id',
        'team_id',
        'season_id',
        'game_id',
        'description',
        'achieved_date',
    ];

    protected $casts = [
        'record_value' => 'decimal:2',
        'achieved_date' => 'date',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function player(): BelongsTo
    {
        return $this->belongsTo(Player::class);
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function season(): BelongsTo
    {
        return $this->belongsTo(Season::class);
    }

    public function game(): BelongsTo
    {
        return $this->belongsTo(Game::class);
    }
}
