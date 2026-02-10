<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\Team;

class AILineupService
{
    private const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

    // Fatigue thresholds for lineup decisions
    private const FATIGUE_REST_THRESHOLD = 70;      // Rest player if fatigue >= this
    private const FATIGUE_CAUTION_THRESHOLD = 50;   // Start considering fatigue at this level
    private const FATIGUE_RATING_PENALTY = 0.5;     // Rating points to subtract per fatigue point over caution threshold

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
     * Factors in fatigue - highly fatigued players are deprioritized or rested.
     */
    private function selectBestLineup(array $roster): array
    {
        $lineup = [];
        $usedPlayerIds = [];

        // Calculate effective rating for each player (rating adjusted by fatigue)
        $rosterWithEffectiveRating = array_map(function ($player) {
            $rating = $player['overallRating'] ?? $player['overall_rating'] ?? 70;
            $fatigue = $player['fatigue'] ?? 0;

            // Calculate effective rating based on fatigue
            $effectiveRating = $this->calculateEffectiveRating($rating, $fatigue);

            return array_merge($player, [
                'effectiveRating' => $effectiveRating,
                'shouldRest' => $fatigue >= self::FATIGUE_REST_THRESHOLD,
            ]);
        }, $roster);

        // Sort by effective rating (highest first)
        usort($rosterWithEffectiveRating, fn($a, $b) =>
            ($b['effectiveRating'] ?? 0) - ($a['effectiveRating'] ?? 0)
        );

        // First pass: assign players to their natural positions (skip those who should rest if alternatives exist)
        foreach (self::POSITIONS as $pos) {
            $bestCandidate = null;
            $bestCandidateNeedsRest = false;

            foreach ($rosterWithEffectiveRating as $player) {
                $playerId = $player['id'] ?? null;
                if (!$playerId) continue;

                $isInjured = $player['isInjured'] ?? $player['is_injured'] ?? false;
                if ($isInjured) continue;

                if (in_array($playerId, $usedPlayerIds)) continue;

                $primaryPos = $player['position'] ?? null;
                $secondaryPos = $player['secondaryPosition'] ?? $player['secondary_position'] ?? null;

                if ($primaryPos === $pos || $secondaryPos === $pos) {
                    $shouldRest = $player['shouldRest'] ?? false;

                    // If this player should rest but we haven't found anyone yet, save as fallback
                    if ($shouldRest && !$bestCandidate) {
                        $bestCandidate = $player;
                        $bestCandidateNeedsRest = true;
                        continue;
                    }

                    // Found a player who doesn't need rest - use them
                    if (!$shouldRest) {
                        $bestCandidate = $player;
                        $bestCandidateNeedsRest = false;
                        break;
                    }
                }
            }

            if ($bestCandidate) {
                $lineup[$pos] = $bestCandidate['id'];
                $usedPlayerIds[] = $bestCandidate['id'];
            }
        }

        // Second pass: fill any remaining positions with best available
        foreach (self::POSITIONS as $pos) {
            if (!isset($lineup[$pos])) {
                foreach ($rosterWithEffectiveRating as $player) {
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
     * Calculate effective rating based on fatigue.
     * Players above the caution threshold have their rating penalized.
     */
    private function calculateEffectiveRating(int $rating, int $fatigue): float
    {
        if ($fatigue <= self::FATIGUE_CAUTION_THRESHOLD) {
            return (float) $rating;
        }

        // Penalize rating based on fatigue above caution threshold
        $fatigueOverCaution = $fatigue - self::FATIGUE_CAUTION_THRESHOLD;
        $penalty = $fatigueOverCaution * self::FATIGUE_RATING_PENALTY;

        return max(0, $rating - $penalty);
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
     * Considers fatigue in addition to rating and position fit.
     */
    private function findReplacement(array $roster, array $currentStarters, string $position): ?string
    {
        $candidates = [];

        foreach ($roster as $player) {
            $playerId = $player['id'] ?? null;
            if (!$playerId) continue;

            // Skip current starters
            if (in_array($playerId, $currentStarters)) continue;

            // Skip injured players
            $isInjured = $player['isInjured'] ?? $player['is_injured'] ?? false;
            if ($isInjured) continue;

            $rating = $player['overallRating'] ?? $player['overall_rating'] ?? 0;
            $fatigue = $player['fatigue'] ?? 0;
            $effectiveRating = $this->calculateEffectiveRating($rating, $fatigue);

            // Check if can play the position
            $primaryPos = $player['position'] ?? null;
            $secondaryPos = $player['secondaryPosition'] ?? $player['secondary_position'] ?? null;

            if ($primaryPos === $position || $secondaryPos === $position) {
                $candidates[] = [
                    'id' => $playerId,
                    'rating' => $rating,
                    'effectiveRating' => $effectiveRating,
                    'fatigue' => $fatigue,
                    'isPrimary' => $primaryPos === $position,
                    'shouldRest' => $fatigue >= self::FATIGUE_REST_THRESHOLD,
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

                $rating = $player['overallRating'] ?? $player['overall_rating'] ?? 0;
                $fatigue = $player['fatigue'] ?? 0;
                $effectiveRating = $this->calculateEffectiveRating($rating, $fatigue);

                $candidates[] = [
                    'id' => $playerId,
                    'rating' => $rating,
                    'effectiveRating' => $effectiveRating,
                    'fatigue' => $fatigue,
                    'isPrimary' => false,
                    'shouldRest' => $fatigue >= self::FATIGUE_REST_THRESHOLD,
                ];
            }
        }

        if (empty($candidates)) {
            return null;
        }

        // Sort by: not needing rest first, then primary position, then by effective rating
        usort($candidates, function ($a, $b) {
            // Prefer players who don't need rest
            if ($a['shouldRest'] !== $b['shouldRest']) {
                return $a['shouldRest'] - $b['shouldRest'];
            }
            // Then prefer primary position
            if ($a['isPrimary'] !== $b['isPrimary']) {
                return $b['isPrimary'] - $a['isPrimary'];
            }
            // Then by effective rating
            return $b['effectiveRating'] - $a['effectiveRating'];
        });

        return $candidates[0]['id'];
    }

    /**
     * Refresh all AI team lineups before a game day.
     * Swaps out fatigued starters for fresher bench players when available.
     */
    public function refreshAllTeamLineups(Campaign $campaign): int
    {
        $teams = Team::where('campaign_id', $campaign->id)
            ->where('id', '!=', $campaign->team_id) // Exclude user's team
            ->get();

        $refreshedCount = 0;

        foreach ($teams as $team) {
            if ($this->refreshTeamLineup($campaign, $team)) {
                $refreshedCount++;
            }
        }

        return $refreshedCount;
    }

    /**
     * Refresh a single AI team's lineup based on current fatigue levels.
     * Returns true if lineup was changed.
     */
    public function refreshTeamLineup(Campaign $campaign, Team $team): bool
    {
        // Don't manage user's team
        if ($team->id === $campaign->team_id) {
            return false;
        }

        $lineupSettings = $team->lineup_settings;
        $currentStarters = $lineupSettings['starters'] ?? null;

        // If team has no lineup, initialize it
        if (empty($currentStarters)) {
            $this->initializeTeamLineup($campaign, $team);
            return true;
        }

        $roster = $this->playerService->getTeamRoster($campaign->id, $team->abbreviation, $campaign->team_id);

        if (empty($roster)) {
            return false;
        }

        // Build player lookup map
        $playerMap = [];
        foreach ($roster as $player) {
            $playerId = $player['id'] ?? null;
            if ($playerId) {
                $playerMap[$playerId] = $player;
            }
        }

        $newStarters = $currentStarters;
        $changed = false;

        // Check each starter position
        foreach (self::POSITIONS as $index => $pos) {
            $starterId = $currentStarters[$index] ?? null;
            if (!$starterId) continue;

            $starter = $playerMap[$starterId] ?? null;
            if (!$starter) continue;

            $starterFatigue = $starter['fatigue'] ?? 0;
            $starterInjured = $starter['isInjured'] ?? $starter['is_injured'] ?? false;

            // Check if starter should be rested or is injured
            if ($starterInjured || $starterFatigue >= self::FATIGUE_REST_THRESHOLD) {
                // Find a replacement
                $replacement = $this->findReplacement($roster, $newStarters, $pos);

                if ($replacement && $replacement !== $starterId) {
                    // Verify replacement is actually better (fresher)
                    $replacementPlayer = $playerMap[$replacement] ?? null;
                    if ($replacementPlayer) {
                        $replacementFatigue = $replacementPlayer['fatigue'] ?? 0;

                        // Only swap if replacement is significantly fresher
                        if ($replacementFatigue < $starterFatigue - 20 || $starterInjured) {
                            $newStarters[$index] = $replacement;
                            $changed = true;
                        }
                    }
                }
            }
        }

        if ($changed) {
            $team->update([
                'lineup_settings' => [
                    'starters' => $newStarters,
                ],
            ]);
        }

        return $changed;
    }

    /**
     * Get a team's starting lineup (player IDs).
     * Returns null if no lineup is set.
     */
    public function getTeamLineup(Team $team): ?array
    {
        return $team->lineup_settings['starters'] ?? null;
    }

    /**
     * Initialize lineup for the user's team.
     * Sets the default starters in campaign settings based on best players per position.
     */
    public function initializeUserTeamLineup(Campaign $campaign): array
    {
        $team = $campaign->team;
        if (!$team) {
            return [];
        }

        // Get roster from database (user's team players)
        $roster = $team->players->map(function ($player) {
            return [
                'id' => $player->id,
                'position' => $player->position,
                'secondaryPosition' => $player->secondary_position,
                'overallRating' => $player->overall_rating,
                'isInjured' => $player->is_injured,
            ];
        })->toArray();

        if (empty($roster)) {
            return [];
        }

        // Sort by overall rating (highest first)
        usort($roster, fn($a, $b) => ($b['overallRating'] ?? 0) - ($a['overallRating'] ?? 0));

        // Select best lineup by position
        $starters = $this->selectBestLineup($roster);

        // Save to campaign settings
        $settings = $campaign->settings ?? [];
        $settings['lineup'] = [
            'starters' => $starters,
            'rotation' => [],
        ];
        $campaign->update(['settings' => $settings]);

        return $starters;
    }
}
