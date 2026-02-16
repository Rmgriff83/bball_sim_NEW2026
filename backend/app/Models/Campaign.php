<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Campaign extends Model
{
    protected $fillable = [
        'user_id',
        'name',
        'client_id',
        'current_date',
        'difficulty',
        'settings',
        'last_played_at',
    ];

    protected $casts = [
        'current_date' => 'date',
        'settings' => 'array',
        'last_played_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
