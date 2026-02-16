<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Campaign extends Model
{
    protected $fillable = [
        'user_id',
        'name',
        'client_id',
        'team_id',
        'current_season_id',
        'current_date',
        'game_year',
        'difficulty',
        'draft_mode',
        'draft_completed',
        'settings',
        'last_played_at',
        'simulation_batch_id',
    ];

    protected $casts = [
        'current_date' => 'date',
        'settings' => 'array',
        'last_played_at' => 'datetime',
        'game_year' => 'integer',
        'draft_completed' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function currentSeason(): BelongsTo
    {
        return $this->belongsTo(Season::class, 'current_season_id');
    }

    public function teams(): HasMany
    {
        return $this->hasMany(Team::class);
    }

    public function players(): HasMany
    {
        return $this->hasMany(Player::class);
    }

    public function coaches(): HasMany
    {
        return $this->hasMany(Coach::class);
    }

    public function seasons(): HasMany
    {
        return $this->hasMany(Season::class);
    }

    public function newsEvents(): HasMany
    {
        return $this->hasMany(NewsEvent::class);
    }

    public function records(): HasMany
    {
        return $this->hasMany(Record::class);
    }

    public function hallOfFame(): HasMany
    {
        return $this->hasMany(HallOfFame::class);
    }

    public function draftPicks(): HasMany
    {
        return $this->hasMany(DraftPick::class);
    }

    public function trades(): HasMany
    {
        return $this->hasMany(Trade::class);
    }

    public function tradeProposals(): HasMany
    {
        return $this->hasMany(TradeProposal::class);
    }
}
