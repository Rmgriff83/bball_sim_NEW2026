<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Achievement extends Model
{
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'id',
        'name',
        'description',
        'category',
        'points',
        'icon_url',
        'criteria',
        'hidden',
    ];

    protected $casts = [
        'criteria' => 'array',
        'hidden' => 'boolean',
        'points' => 'integer',
    ];

    public function userAchievements(): HasMany
    {
        return $this->hasMany(UserAchievement::class);
    }
}
