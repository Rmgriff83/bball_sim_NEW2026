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
     */
    public function canTrigger(array $player1Badges, array $player2Badges): bool
    {
        $levelOrder = ['bronze' => 1, 'silver' => 2, 'gold' => 3, 'hof' => 4];
        $minLevel1 = $levelOrder[$this->min_level1] ?? 1;
        $minLevel2 = $levelOrder[$this->min_level2] ?? 1;

        $hasBadge1 = false;
        $hasBadge2 = false;

        foreach ($player1Badges as $badge) {
            if ($badge['id'] === $this->badge1_id) {
                $badgeLevel = $levelOrder[$badge['level']] ?? 0;
                if ($badgeLevel >= $minLevel1) {
                    $hasBadge1 = true;
                }
            }
        }

        foreach ($player2Badges as $badge) {
            if ($badge['id'] === $this->badge2_id) {
                $badgeLevel = $levelOrder[$badge['level']] ?? 0;
                if ($badgeLevel >= $minLevel2) {
                    $hasBadge2 = true;
                }
            }
        }

        return $hasBadge1 && $hasBadge2;
    }
}
