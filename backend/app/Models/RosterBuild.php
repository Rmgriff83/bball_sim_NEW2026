<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RosterBuild extends Model
{
    public const STATUS_ACTIVE = 'active';
    public const STATUS_REMOVED = 'removed';

    protected $fillable = [
        'user_id',
        'campaign_client_id',
        'title',
        'description',
        's3_key',
        'size_bytes',
        'player_count',
        'downloads',
        'status',
        'report_count',
    ];

    protected $casts = [
        'size_bytes' => 'integer',
        'player_count' => 'integer',
        'downloads' => 'integer',
        'report_count' => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
