<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BadgeSynergy extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'badge1_id',
        'badge2_id',
        'synergy_name',
        'description',
        'effect',
        'min_level1',
        'min_level2',
    ];

    protected $casts = [
        'effect' => 'array',
    ];

    public function badge1(): BelongsTo
    {
        return $this->belongsTo(BadgeDefinition::class, 'badge1_id');
    }

    public function badge2(): BelongsTo
    {
        return $this->belongsTo(BadgeDefinition::class, 'badge2_id');
    }

    /**
     * Check if two players can trigger this synergy.
     * Synergies activate at ANY badge level — boost magnitude scales with level elsewhere.
     */
    public function canTrigger(array $player1Badges, array $player2Badges): bool
    {
        $hasBadge1 = collect($player1Badges)->contains('id', $this->badge1_id);
        $hasBadge2 = collect($player2Badges)->contains('id', $this->badge2_id);

        return $hasBadge1 && $hasBadge2;
    }
}
