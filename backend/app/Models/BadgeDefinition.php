<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class BadgeDefinition extends Model
{
    public $timestamps = false;

    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'id',
        'name',
        'category',
        'description',
        'effects',
        'icon_url',
    ];

    protected $casts = [
        'effects' => 'array',
    ];

    public function synergiesAsBadge1(): HasMany
    {
        return $this->hasMany(BadgeSynergy::class, 'badge1_id');
    }

    public function synergiesAsBadge2(): HasMany
    {
        return $this->hasMany(BadgeSynergy::class, 'badge2_id');
    }

    /**
     * Get effect for a specific level.
     */
    public function getEffectForLevel(string $level): array
    {
        return $this->effects[$level] ?? [];
    }
}
