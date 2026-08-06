<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Campaign extends Model
{
    // Soft deletes: a delete request tombstones the row (and keeps the S3
    // part files) instead of destroying the user's only cloud save. The
    // campaigns:prune-deleted command hard-deletes after a 30-day grace.
    use SoftDeletes;

    protected $fillable = [
        'user_id',
        'name',
        'client_id',
        'current_date',
        'difficulty',
        'workshop',
        'settings',
        'last_played_at',
    ];

    protected $casts = [
        'current_date' => 'date',
        'workshop' => 'boolean',
        'settings' => 'array',
        'last_played_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
