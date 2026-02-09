<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\DraftPick;
use App\Models\Team;

class DraftPickService
{
    /**
     * Generate draft picks for a campaign (called on campaign creation).
     * Creates 5 years of picks (1st + 2nd round for each team).
     */
    public function generateInitialPicks(Campaign $campaign): int
    {
        $teams = Team::where('campaign_id', $campaign->id)->get();
        $currentYear = $campaign->game_year;
        $picksCreated = 0;

        // Generate 5 years of picks
        for ($yearOffset = 0; $yearOffset < 5; $yearOffset++) {
            $draftYear = $currentYear + $yearOffset;

            foreach ($teams as $team) {
                // 1st round pick
                DraftPick::create([
                    'campaign_id' => $campaign->id,
                    'original_team_id' => $team->id,
                    'current_owner_id' => $team->id,
                    'year' => $draftYear,
                    'round' => 1,
                    'pick_number' => null,
                ]);
                $picksCreated++;

                // 2nd round pick
                DraftPick::create([
                    'campaign_id' => $campaign->id,
                    'original_team_id' => $team->id,
                    'current_owner_id' => $team->id,
                    'year' => $draftYear,
                    'round' => 2,
                    'pick_number' => null,
                ]);
                $picksCreated++;
            }
        }

        return $picksCreated;
    }

    /**
     * At end of regular season, assign pick numbers based on standings.
     * Worst team gets #1, best non-playoff team gets #14, etc.
     */
    public function assignPickNumbers(Campaign $campaign, int $draftYear): int
    {
        $standings = $this->getStandingsSorted($campaign);
        $updatedCount = 0;
        $pickNumber = 1;

        foreach ($standings as $teamStanding) {
            $teamId = $teamStanding['teamId'];

            // Update 1st round pick
            $updated = DraftPick::where('campaign_id', $campaign->id)
                ->where('original_team_id', $teamId)
                ->where('year', $draftYear)
                ->where('round', 1)
                ->update(['pick_number' => $pickNumber]);
            $updatedCount += $updated;

            // Update 2nd round pick (same order)
            $updated = DraftPick::where('campaign_id', $campaign->id)
                ->where('original_team_id', $teamId)
                ->where('year', $draftYear)
                ->where('round', 2)
                ->update(['pick_number' => $pickNumber]);
            $updatedCount += $updated;

            $pickNumber++;
        }

        return $updatedCount;
    }

    /**
     * Roll forward picks at end of each season.
     * Generate new year 5 picks.
     */
    public function rollForwardPicks(Campaign $campaign): int
    {
        $newYear = $campaign->game_year + 5;
        $teams = Team::where('campaign_id', $campaign->id)->get();
        $picksCreated = 0;

        foreach ($teams as $team) {
            // Check if picks already exist for this year
            $exists = DraftPick::where('campaign_id', $campaign->id)
                ->where('original_team_id', $team->id)
                ->where('year', $newYear)
                ->exists();

            if (!$exists) {
                DraftPick::create([
                    'campaign_id' => $campaign->id,
                    'original_team_id' => $team->id,
                    'current_owner_id' => $team->id,
                    'year' => $newYear,
                    'round' => 1,
                ]);
                $picksCreated++;

                DraftPick::create([
                    'campaign_id' => $campaign->id,
                    'original_team_id' => $team->id,
                    'current_owner_id' => $team->id,
                    'year' => $newYear,
                    'round' => 2,
                ]);
                $picksCreated++;
            }
        }

        return $picksCreated;
    }

    /**
     * Calculate trade value of a pick.
     * Higher picks worth more, 1st rounders worth more than 2nd.
     */
    public function calculatePickValue(DraftPick $pick, Campaign $campaign, ?int $projectedPosition = null): float
    {
        // Base values (comparable to player trade values)
        $firstRoundValues = [
            1 => 30, 2 => 25, 3 => 22, 4 => 18, 5 => 15,
            6 => 13, 7 => 11, 8 => 10, 9 => 9, 10 => 8,
            11 => 7, 12 => 6.5, 13 => 6, 14 => 5.5,
            15 => 5, 16 => 4.5, 17 => 4, 18 => 3.8, 19 => 3.5, 20 => 3.2,
            21 => 3, 22 => 2.8, 23 => 2.6, 24 => 2.4, 25 => 2.2,
            26 => 2, 27 => 1.8, 28 => 1.6, 29 => 1.4, 30 => 1.2,
        ];

        $secondRoundValues = [
            1 => 1.0, 2 => 0.95, 3 => 0.9, 4 => 0.85, 5 => 0.8,
            6 => 0.75, 7 => 0.7, 8 => 0.65, 9 => 0.6, 10 => 0.55,
            11 => 0.5, 12 => 0.48, 13 => 0.46, 14 => 0.44, 15 => 0.42,
            16 => 0.4, 17 => 0.38, 18 => 0.36, 19 => 0.34, 20 => 0.32,
            21 => 0.3, 22 => 0.28, 23 => 0.26, 24 => 0.24, 25 => 0.22,
            26 => 0.2, 27 => 0.18, 28 => 0.16, 29 => 0.14, 30 => 0.12,
        ];

        $position = $projectedPosition ?? $pick->pick_number ?? 15;
        $position = min(30, max(1, $position)); // Clamp to 1-30

        $value = $pick->round === 1
            ? ($firstRoundValues[$position] ?? 3)
            : ($secondRoundValues[$position] ?? 0.5);

        // Future picks worth less (discount 10% per year out)
        $yearsOut = $pick->year - $campaign->game_year;
        $value *= pow(0.90, max(0, $yearsOut));

        return round($value, 2);
    }

    /**
     * Project where a team's pick will land based on current standings.
     */
    public function projectPickPosition(Campaign $campaign, int $teamId): int
    {
        $standings = $this->getStandingsSorted($campaign);
        $position = 1;

        foreach ($standings as $standing) {
            if ($standing['teamId'] === $teamId) {
                return $position;
            }
            $position++;
        }

        return 15; // Default middle
    }

    /**
     * Get standings sorted by wins (ascending = worst first for draft order).
     */
    public function getStandingsSorted(Campaign $campaign): array
    {
        $season = $campaign->currentSeason;
        if (!$season || !$season->standings) {
            // No standings yet - return teams in random order
            $teams = Team::where('campaign_id', $campaign->id)->get();
            return $teams->map(fn($t) => [
                'teamId' => $t->id,
                'wins' => 0,
                'losses' => 0,
            ])->shuffle()->values()->toArray();
        }

        $standings = $season->standings;
        $allTeams = [];

        // Combine east and west standings
        foreach (['east', 'west'] as $conference) {
            if (isset($standings[$conference])) {
                foreach ($standings[$conference] as $standing) {
                    $allTeams[] = $standing;
                }
            }
        }

        // Sort by wins ascending (worst teams first for draft)
        usort($allTeams, function ($a, $b) {
            $aWins = $a['wins'] ?? 0;
            $bWins = $b['wins'] ?? 0;

            if ($aWins === $bWins) {
                // Tiebreaker: more losses = worse = earlier pick
                $aLosses = $a['losses'] ?? 0;
                $bLosses = $b['losses'] ?? 0;
                return $bLosses <=> $aLosses;
            }

            return $aWins <=> $bWins;
        });

        return $allTeams;
    }

    /**
     * Get all picks owned by a team.
     */
    public function getTeamPicks(int $campaignId, int $teamId): array
    {
        return DraftPick::where('campaign_id', $campaignId)
            ->where('current_owner_id', $teamId)
            ->whereNull('player_id') // Not yet used
            ->with(['originalTeam:id,abbreviation,name'])
            ->orderBy('year')
            ->orderBy('round')
            ->orderBy('pick_number')
            ->get()
            ->toArray();
    }

    /**
     * Get picks with enriched data for trade display.
     */
    public function getTeamPicksForTrade(Campaign $campaign, int $teamId): array
    {
        $picks = DraftPick::where('campaign_id', $campaign->id)
            ->where('current_owner_id', $teamId)
            ->whereNull('player_id')
            ->with(['originalTeam:id,abbreviation,name'])
            ->orderBy('year')
            ->orderBy('round')
            ->get();

        return $picks->map(function ($pick) use ($campaign) {
            $projectedPosition = $this->projectPickPosition($campaign, $pick->original_team_id);
            $value = $this->calculatePickValue($pick, $campaign, $pick->pick_number ?? $projectedPosition);

            return [
                'id' => $pick->id,
                'year' => $pick->year,
                'round' => $pick->round,
                'pick_number' => $pick->pick_number,
                'projected_position' => $pick->pick_number ?? $projectedPosition,
                'original_team_id' => $pick->original_team_id,
                'original_team_abbreviation' => $pick->originalTeam?->abbreviation,
                'original_team_name' => $pick->originalTeam?->name,
                'current_owner_id' => $pick->current_owner_id,
                'is_traded' => $pick->is_traded,
                'display_name' => $pick->display_name,
                'trade_value' => $value,
            ];
        })->toArray();
    }
}
