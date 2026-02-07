<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\Team;

class AILineupService
{
    private const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

    public function __construct(
        private CampaignPlayerService $playerService
    ) {}

    /**
     * Initialize lineups for all AI teams in a campaign.
     * Should be called when campaign is created or on first simulation.
     */
    public function initializeAllTeamLineups(Campaign $campaign): void
    {
        $teams = Team::where('campaign_id', $campaign->id)
            ->where('id', '!=', $campaign->team_id) // Exclude user's team
            ->get();

        foreach ($teams as $team) {
            if (empty($team->lineup_settings)) {
                $this->initializeTeamLineup($campaign, $team);
            }
        }
    }

    /**
     * Initialize lineup for a single AI team.
     */
    public function initializeTeamLineup(Campaign $campaign, Team $team): void
    {
        $roster = $this->playerService->getTeamRoster($campaign->id, $team->abbreviation, $campaign->team_id);

        if (empty($roster)) {
            return;
        }

        // Sort by overall rating (highest first)
        usort($roster, fn($a, $b) => ($b['overallRating'] ?? $b['overall_rating'] ?? 0) - ($a['overallRating'] ?? $a['overall_rating'] ?? 0));

        // Select best lineup by position
        $starters = $this->selectBestLineup($roster);

        $team->update([
            'lineup_settings' => [
                'starters' => $starters,
            ],
        ]);
    }

    /**
     * Select the best starting lineup from a roster.
     * Returns array of 5 player IDs in position order (PG, SG, SF, PF, C).
     */
    private function selectBestLineup(array $roster): array
    {
        $lineup = [];
        $usedPlayerIds = [];

        // First pass: assign players to their natural positions
        foreach (self::POSITIONS as $pos) {
            foreach ($roster as $player) {
                $playerId = $player['id'] ?? null;
                if (!$playerId) continue;

                $isInjured = $player['isInjured'] ?? $player['is_injured'] ?? false;
                if ($isInjured) continue;

                if (in_array($playerId, $usedPlayerIds)) continue;

                $primaryPos = $player['position'] ?? null;
                $secondaryPos = $player['secondaryPosition'] ?? $player['secondary_position'] ?? null;

                if ($primaryPos === $pos || $secondaryPos === $pos) {
                    $lineup[$pos] = $playerId;
                    $usedPlayerIds[] = $playerId;
                    break;
                }
            }
        }

        // Second pass: fill any remaining positions with best available
        foreach (self::POSITIONS as $pos) {
            if (!isset($lineup[$pos])) {
                foreach ($roster as $player) {
                    $playerId = $player['id'] ?? null;
                    if (!$playerId) continue;

                    $isInjured = $player['isInjured'] ?? $player['is_injured'] ?? false;
                    if ($isInjured) continue;

                    if (!in_array($playerId, $usedPlayerIds)) {
                        $lineup[$pos] = $playerId;
                        $usedPlayerIds[] = $playerId;
                        break;
                    }
                }
            }
        }

        // Convert to array in position order
        $result = [];
        foreach (self::POSITIONS as $pos) {
            $result[] = $lineup[$pos] ?? null;
        }

        return $result;
    }

    /**
     * Handle an injured starter by finding a replacement.
     * Called when a player gets injured after a game.
     */
    public function handleInjuredStarter(Campaign $campaign, Team $team, $injuredPlayerId): bool
    {
        // Don't manage user's team lineup
        if ($team->id === $campaign->team_id) {
            return false;
        }

        $lineupSettings = $team->lineup_settings;
        $starters = $lineupSettings['starters'] ?? null;

        // If team has no lineup settings, initialize first
        if (empty($starters)) {
            $this->initializeTeamLineup($campaign, $team);
            return true;
        }

        // Check if injured player is a starter
        $starterIndex = array_search($injuredPlayerId, $starters);
        if ($starterIndex === false) {
            return false; // Not a starter, no swap needed
        }

        // Get the position that needs to be filled
        $positionNeeded = self::POSITIONS[$starterIndex];

        // Get roster and find a replacement
        $roster = $this->playerService->getTeamRoster($campaign->id, $team->abbreviation, $campaign->team_id);

        $replacement = $this->findReplacement($roster, $starters, $positionNeeded);

        if ($replacement) {
            $starters[$starterIndex] = $replacement;
            $team->update([
                'lineup_settings' => [
                    'starters' => $starters,
                ],
            ]);
            return true;
        }

        return false;
    }

    /**
     * Find a replacement player for a position.
     */
    private function findReplacement(array $roster, array $currentStarters, string $position): ?string
    {
        // Sort bench players by rating
        $candidates = [];

        foreach ($roster as $player) {
            $playerId = $player['id'] ?? null;
            if (!$playerId) continue;

            // Skip current starters
            if (in_array($playerId, $currentStarters)) continue;

            // Skip injured players
            $isInjured = $player['isInjured'] ?? $player['is_injured'] ?? false;
            if ($isInjured) continue;

            // Check if can play the position
            $primaryPos = $player['position'] ?? null;
            $secondaryPos = $player['secondaryPosition'] ?? $player['secondary_position'] ?? null;

            if ($primaryPos === $position || $secondaryPos === $position) {
                $candidates[] = [
                    'id' => $playerId,
                    'rating' => $player['overallRating'] ?? $player['overall_rating'] ?? 0,
                    'isPrimary' => $primaryPos === $position,
                ];
            }
        }

        if (empty($candidates)) {
            // No position match, just get best available player
            foreach ($roster as $player) {
                $playerId = $player['id'] ?? null;
                if (!$playerId) continue;
                if (in_array($playerId, $currentStarters)) continue;

                $isInjured = $player['isInjured'] ?? $player['is_injured'] ?? false;
                if ($isInjured) continue;

                $candidates[] = [
                    'id' => $playerId,
                    'rating' => $player['overallRating'] ?? $player['overall_rating'] ?? 0,
                    'isPrimary' => false,
                ];
            }
        }

        if (empty($candidates)) {
            return null;
        }

        // Sort by: primary position first, then by rating
        usort($candidates, function ($a, $b) {
            if ($a['isPrimary'] !== $b['isPrimary']) {
                return $b['isPrimary'] - $a['isPrimary'];
            }
            return $b['rating'] - $a['rating'];
        });

        return $candidates[0]['id'];
    }

    /**
     * Get a team's starting lineup (player IDs).
     * Returns null if no lineup is set.
     */
    public function getTeamLineup(Team $team): ?array
    {
        return $team->lineup_settings['starters'] ?? null;
    }
}
