<?php

namespace App\Services;

use App\Models\Campaign;

class RewardService
{
    /**
     * Default tokens awarded per synergy activation.
     */
    private const TOKENS_PER_SYNERGY = 1;

    /**
     * Win multiplier for token rewards (1.5x for wins).
     */
    private const WIN_MULTIPLIER = 1.5;

    /**
     * Process synergy rewards for the user's team after a game.
     *
     * @param Campaign $campaign The campaign
     * @param array $animationData Animation data containing possession info
     * @param int $userTeamId The user's team ID
     * @param bool $isHome Whether the user's team was home
     * @param bool $didWin Whether the user's team won
     * @return array Summary of rewards given
     */
    public function processGameRewards(
        Campaign $campaign,
        array $animationData,
        int $userTeamId,
        bool $isHome,
        bool $didWin
    ): array {
        // Explicitly load relationships to ensure they're available
        $campaign->loadMissing('user.profile');

        $user = $campaign->user;
        if (!$user) {
            \Log::debug('RewardService: No user found for campaign', ['campaign_id' => $campaign->id]);
            return [
                'synergies_activated' => 0,
                'tokens_awarded' => 0,
            ];
        }

        if (!$user->profile) {
            \Log::debug('RewardService: No profile found for user', ['user_id' => $user->id]);
            return [
                'synergies_activated' => 0,
                'tokens_awarded' => 0,
            ];
        }

        $teamKey = $isHome ? 'home' : 'away';
        $synergyCount = $this->countUserTeamSynergies($animationData, $teamKey);

        \Log::debug('RewardService: Synergy count', [
            'team_key' => $teamKey,
            'synergy_count' => $synergyCount,
            'possession_count' => count($animationData['possessions'] ?? []),
        ]);

        if ($synergyCount === 0) {
            return [
                'synergies_activated' => 0,
                'tokens_awarded' => 0,
            ];
        }

        // Calculate tokens with optional win multiplier
        $baseTokens = $synergyCount * self::TOKENS_PER_SYNERGY;
        $tokensAwarded = $didWin
            ? (int) ceil($baseTokens * self::WIN_MULTIPLIER)
            : $baseTokens;

        // Award tokens to user profile
        $user->profile->awardSynergyTokens($synergyCount, $didWin ? (int) ceil(self::WIN_MULTIPLIER) : self::TOKENS_PER_SYNERGY);

        \Log::info('RewardService: Awarded tokens', [
            'user_id' => $user->id,
            'synergies' => $synergyCount,
            'tokens' => $tokensAwarded,
            'did_win' => $didWin,
        ]);

        return [
            'synergies_activated' => $synergyCount,
            'tokens_awarded' => $tokensAwarded,
            'win_bonus_applied' => $didWin,
        ];
    }

    /**
     * Count synergies activated by the user's team.
     *
     * @param array $animationData Animation data containing possessions
     * @param string $teamKey 'home' or 'away'
     * @return int Number of synergies activated
     */
    public function countUserTeamSynergies(array $animationData, string $teamKey): int
    {
        $possessions = $animationData['possessions'] ?? [];
        $count = 0;

        foreach ($possessions as $possession) {
            // Only count synergies for the user's team possessions
            if (($possession['team'] ?? '') !== $teamKey) {
                continue;
            }

            // Count activated synergies in this possession
            $activatedSynergies = $possession['activated_synergies'] ?? [];
            if (is_array($activatedSynergies)) {
                $count += count($activatedSynergies);
            }
        }

        return $count;
    }
}
