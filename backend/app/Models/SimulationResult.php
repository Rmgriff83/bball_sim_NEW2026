<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SimulationResult extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected $casts = [
        'box_score' => 'array',
        'quarter_scores' => 'array',
        'is_user_game' => 'boolean',
        'is_playoff' => 'boolean',
        'home_score' => 'integer',
        'away_score' => 'integer',
        'home_team_id' => 'integer',
        'away_team_id' => 'integer',
        'campaign_id' => 'integer',
    ];
}
