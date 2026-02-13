<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Team;
use App\Models\Player;
use App\Services\AILineupService;
use App\Services\CampaignSeasonService;
use App\Services\CampaignPlayerService;
use App\Services\CoachingService;
use App\Services\FinanceService;
use App\Services\SubstitutionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TeamController extends Controller
{
    private CampaignSeasonService $seasonService;
    private CampaignPlayerService $playerService;
    private CoachingService $coachingService;
    private AILineupService $lineupService;
    private FinanceService $financeService;
    private SubstitutionService $substitutionService;

    public function __construct(
        CampaignSeasonService $seasonService,
        CampaignPlayerService $playerService,
        CoachingService $coachingService,
        AILineupService $lineupService,
        FinanceService $financeService,
        SubstitutionService $substitutionService
    ) {
        $this->seasonService = $seasonService;
        $this->playerService = $playerService;
        $this->coachingService = $coachingService;
        $this->lineupService = $lineupService;
        $this->financeService = $financeService;
        $this->substitutionService = $substitutionService;
    }
    /**
     * Get the user's team with full roster.
     */
    public function show(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $team = $campaign->team;
        if (!$team) {
            return response()->json(['message' => 'No team assigned'], 404);
        }

        $team->load(['players', 'coach']);

        // Load player stats from JSON file
        $year = $campaign->currentSeason?->year ?? 2025;
        $allPlayerStats = $this->seasonService->getAllPlayerStats($campaign->id, $year);

        // Get saved lineup settings, or generate default if none exists
        $savedLineup = $campaign->settings['lineup']['starters'] ?? null;

        // If no lineup is saved, generate a proper one based on positions
        if (!$savedLineup || count(array_filter($savedLineup)) < 5) {
            $savedLineup = $this->lineupService->initializeUserTeamLineup($campaign);
            $campaign->refresh(); // Reload to get updated settings
        }

        // Format all players
        $formattedPlayers = $team->players->map(function ($player) use ($allPlayerStats) {
            $playerStats = $allPlayerStats[$player->id] ?? null;
            return $this->formatPlayer($player, false, $playerStats);
        });

        // Reorder roster based on saved lineup
        if ($savedLineup && count($savedLineup) === 5) {
            // Convert to integers but preserve nulls for empty slots
            $starterIds = array_map(fn($id) => $id !== null ? (int)$id : null, $savedLineup);
            $starters = [];
            $bench = [];

            foreach ($formattedPlayers as $player) {
                $starterIndex = array_search($player['id'], $starterIds, true);
                if ($starterIndex !== false) {
                    $starters[$starterIndex] = $player;
                } else {
                    $bench[] = $player;
                }
            }

            // Fill empty starter slots with null placeholders
            for ($i = 0; $i < 5; $i++) {
                if (!isset($starters[$i]) && $starterIds[$i] === null) {
                    $starters[$i] = null;
                }
            }

            // Sort starters by position index, bench by overall rating
            ksort($starters);
            usort($bench, fn($a, $b) => $b['overall_rating'] - $a['overall_rating']);

            $orderedRoster = array_merge(array_values($starters), $bench);
        } else {
            // Default: sort by position then rating
            $orderedRoster = $formattedPlayers->sortBy([
                fn($a, $b) => $this->getPositionOrder($a['position']) <=> $this->getPositionOrder($b['position']),
                fn($a, $b) => $b['overall_rating'] <=> $a['overall_rating'],
            ])->values()->all();
        }

        return response()->json([
            'team' => [
                'id' => $team->id,
                'name' => $team->name,
                'city' => $team->city,
                'abbreviation' => $team->abbreviation,
                'conference' => $team->conference,
                'division' => $team->division,
                'primary_color' => $team->primary_color,
                'secondary_color' => $team->secondary_color,
                'salary_cap' => $team->salary_cap,
                'total_payroll' => $team->total_payroll,
                'cap_space' => $team->cap_space,
                'facilities' => $team->facilities,
                'coaching_scheme' => $team->coaching_scheme ?? ['offensive' => 'balanced', 'defensive' => 'man', 'substitution' => 'staggered'],
            ],
            'roster' => $orderedRoster,
            // Include lineup settings for frontend to track starters explicitly
            'lineup_settings' => [
                'starters' => $savedLineup,
                'target_minutes' => $this->ensureTargetMinutes($campaign, $orderedRoster, $savedLineup),
            ],
            'coach' => $team->coach ? [
                'id' => $team->coach->id,
                'name' => $team->coach->first_name . ' ' . $team->coach->last_name,
                'overall_rating' => $team->coach->overall_rating,
                'offensive_scheme' => $team->coach->offensive_scheme,
                'defensive_scheme' => $team->coach->defensive_scheme,
                'attributes' => $team->coach->attributes,
                // Career stats
                'career_stats' => [
                    'wins' => $team->coach->career_wins ?? 0,
                    'losses' => $team->coach->career_losses ?? 0,
                    'win_pct' => $team->coach->career_win_pct ?? 0,
                    'playoff_wins' => $team->coach->playoff_wins ?? 0,
                    'playoff_losses' => $team->coach->playoff_losses ?? 0,
                    'playoff_win_pct' => $team->coach->playoff_win_pct ?? 0,
                    'championships' => $team->coach->championships ?? 0,
                    'conference_titles' => $team->coach->conference_titles ?? 0,
                    'coach_of_year_awards' => $team->coach->coach_of_year_awards ?? 0,
                    'seasons_coached' => $team->coach->seasons_coached ?? 0,
                ],
            ] : null,
        ]);
    }

    /**
     * Get a specific player's full details.
     */
    public function getPlayer(Request $request, Campaign $campaign, Player $player): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        if ($player->campaign_id !== $campaign->id) {
            return response()->json(['message' => 'Player not in this campaign'], 404);
        }

        $player->load(['team:id,name,abbreviation', 'seasonStats' => function ($query) {
            $query->orderBy('season_id', 'desc');
        }]);

        return response()->json([
            'player' => $this->formatPlayer($player, true),
            'team' => $player->team,
            'career_stats' => $player->seasonStats->map(function ($stats) {
                return [
                    'season_id' => $stats->season_id,
                    'games_played' => $stats->games_played,
                    'ppg' => $stats->games_played > 0 ? round($stats->points / $stats->games_played, 1) : 0,
                    'rpg' => $stats->games_played > 0 ? round($stats->rebounds / $stats->games_played, 1) : 0,
                    'apg' => $stats->games_played > 0 ? round($stats->assists / $stats->games_played, 1) : 0,
                    'fg_pct' => $stats->field_goals_attempted > 0
                        ? round($stats->field_goals_made / $stats->field_goals_attempted * 100, 1) : 0,
                    'three_pct' => $stats->three_pointers_attempted > 0
                        ? round($stats->three_pointers_made / $stats->three_pointers_attempted * 100, 1) : 0,
                ];
            }),
        ]);
    }

    /**
     * Update player lineup/rotation settings.
     */
    public function updateLineup(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'starters' => 'required|array|size:5',
            'starters.*' => 'nullable|integer|exists:players,id',
            'rotation' => 'sometimes|array',
            'rotation.*' => 'sometimes|integer|exists:players,id',
        ]);

        // Verify all players belong to the user's team
        $team = $campaign->team;
        $teamPlayers = $team->players->keyBy('id');

        foreach ($validated['starters'] as $playerId) {
            // Skip null values (empty starter slots)
            if ($playerId === null) continue;

            if (!$teamPlayers->has($playerId)) {
                return response()->json(['message' => 'Invalid player selection'], 400);
            }
        }

        // Validate position assignments
        $positions = ['PG', 'SG', 'SF', 'PF', 'C'];
        $positionErrors = [];

        foreach ($validated['starters'] as $index => $playerId) {
            // Skip null values (empty starter slots)
            if ($playerId === null) continue;

            $player = $teamPlayers->get($playerId);
            $requiredPosition = $positions[$index];

            if ($player->position !== $requiredPosition &&
                $player->secondary_position !== $requiredPosition) {
                $positionErrors[] = "{$player->first_name} {$player->last_name} cannot play {$requiredPosition}";
            }
        }

        if (!empty($positionErrors)) {
            return response()->json([
                'message' => 'Invalid lineup: position mismatch',
                'errors' => $positionErrors,
            ], 422);
        }

        // Store lineup in team settings or campaign settings (preserve existing keys like target_minutes)
        $settings = $campaign->settings ?? [];
        $existingLineup = $settings['lineup'] ?? [];
        $settings['lineup'] = array_merge($existingLineup, [
            'starters' => $validated['starters'],
            'rotation' => $validated['rotation'] ?? [],
        ]);
        $campaign->update(['settings' => $settings]);

        return response()->json([
            'message' => 'Lineup updated successfully',
            'lineup' => $settings['lineup'],
        ]);
    }

    /**
     * Update target minutes for players.
     */
    public function updateTargetMinutes(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'target_minutes' => 'required|array',
            'target_minutes.*' => 'integer|min:0|max:40',
        ]);

        $team = $campaign->team;
        $teamPlayerIds = $team->players->pluck('id')->toArray();

        // Verify all player IDs belong to user's team
        foreach ($validated['target_minutes'] as $playerId => $minutes) {
            if (!in_array((int) $playerId, $teamPlayerIds)) {
                return response()->json(['message' => 'Invalid player in target minutes'], 400);
            }
        }

        // Validate starters have minimum 8 minutes
        $starters = $campaign->settings['lineup']['starters'] ?? [];
        foreach ($starters as $starterId) {
            if ($starterId && isset($validated['target_minutes'][$starterId])) {
                if ($validated['target_minutes'][$starterId] < 8) {
                    return response()->json(['message' => 'Starters must have at least 8 minutes'], 422);
                }
            }
        }

        // Save to campaign settings
        $settings = $campaign->settings ?? [];
        $settings['lineup']['target_minutes'] = $validated['target_minutes'];
        $campaign->update(['settings' => $settings]);

        $total = array_sum($validated['target_minutes']);

        return response()->json([
            'message' => 'Target minutes updated',
            'target_minutes' => $validated['target_minutes'],
            'total' => $total,
        ]);
    }

    /**
     * Get all teams in the campaign.
     */
    public function allTeams(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $teams = Team::where('campaign_id', $campaign->id)
            ->withCount('players')
            ->with(['coach:id,team_id,first_name,last_name,overall_rating'])
            ->orderBy('conference')
            ->orderBy('division')
            ->orderBy('name')
            ->get()
            ->map(function ($team) {
                return [
                    'id' => $team->id,
                    'name' => $team->name,
                    'city' => $team->city,
                    'abbreviation' => $team->abbreviation,
                    'conference' => $team->conference,
                    'division' => $team->division,
                    'primary_color' => $team->primary_color,
                    'players_count' => $team->players_count,
                    'coach' => $team->coach ? [
                        'name' => $team->coach->first_name . ' ' . $team->coach->last_name,
                        'overall_rating' => $team->coach->overall_rating,
                    ] : null,
                ];
            });

        return response()->json(['teams' => $teams]);
    }

    /**
     * Get a specific team's roster (any team in the campaign).
     */
    public function getTeamRoster(Request $request, Campaign $campaign, Team $team): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        if ($team->campaign_id !== $campaign->id) {
            return response()->json(['message' => 'Team not in this campaign'], 404);
        }

        $team->load('coach');

        // Load player stats from JSON file
        $year = $campaign->currentSeason?->year ?? 2025;
        $allPlayerStats = $this->seasonService->getAllPlayerStats($campaign->id, $year);

        // Get roster from appropriate source (database for user team, JSON for others)
        $rosterData = $this->playerService->getTeamRoster(
            $campaign->id,
            $team->abbreviation,
            $campaign->team_id
        );

        // Format roster with season stats
        $roster = array_map(function ($player) use ($allPlayerStats) {
            // Player ID might be int (from DB) or string (from JSON)
            $playerId = $player['id'] ?? null;
            $playerStats = $playerId ? ($allPlayerStats[$playerId] ?? null) : null;

            return $this->formatPlayerFromArray($player, $playerStats);
        }, $rosterData);

        // Sort by position then rating
        usort($roster, function ($a, $b) {
            $posOrder = ['PG' => 1, 'SG' => 2, 'SF' => 3, 'PF' => 4, 'C' => 5];
            $posA = $posOrder[$a['position']] ?? 6;
            $posB = $posOrder[$b['position']] ?? 6;
            if ($posA !== $posB) return $posA - $posB;
            return $b['overall_rating'] - $a['overall_rating'];
        });

        return response()->json([
            'team' => [
                'id' => $team->id,
                'name' => $team->name,
                'city' => $team->city,
                'abbreviation' => $team->abbreviation,
                'primary_color' => $team->primary_color,
                'secondary_color' => $team->secondary_color,
            ],
            'roster' => $roster,
            'coach' => $team->coach,
        ]);
    }

    /**
     * Format player data from array (works for both DB and JSON sources).
     */
    private function formatPlayerFromArray(array $player, ?array $seasonStats = null): array
    {
        // Handle camelCase (JSON) vs snake_case (DB) field names
        $data = [
            'id' => $player['id'] ?? null,
            'name' => ($player['firstName'] ?? $player['first_name'] ?? '') . ' ' .
                     ($player['lastName'] ?? $player['last_name'] ?? ''),
            'first_name' => $player['firstName'] ?? $player['first_name'] ?? '',
            'last_name' => $player['lastName'] ?? $player['last_name'] ?? '',
            'position' => $player['position'] ?? 'SF',
            'secondary_position' => $player['secondaryPosition'] ?? $player['secondary_position'] ?? null,
            'jersey_number' => $player['jerseyNumber'] ?? $player['jersey_number'] ?? 0,
            'overall_rating' => $player['overallRating'] ?? $player['overall_rating'] ?? 75,
            'potential_rating' => $player['potentialRating'] ?? $player['potential_rating'] ?? 75,
            'height' => $this->formatHeight($player['heightInches'] ?? $player['height_inches'] ?? 78),
            'height_inches' => $player['heightInches'] ?? $player['height_inches'] ?? 78,
            'weight' => $player['weightLbs'] ?? $player['weight_lbs'] ?? 220,
            'age' => $this->calculateAge($player['birthDate'] ?? $player['birth_date'] ?? null),
            'is_injured' => $player['isInjured'] ?? $player['is_injured'] ?? false,
            'fatigue' => $player['fatigue'] ?? 0,
            'contract' => [
                'years_remaining' => $player['contractYearsRemaining'] ?? $player['contract_years_remaining'] ?? 1,
                'salary' => $player['contractSalary'] ?? $player['contract_salary'] ?? 1000000,
            ],
            'badges' => $player['badges'] ?? [],
            'attributes' => $player['attributes'] ?? [],
        ];

        // Include season stats if provided
        if ($seasonStats && ($seasonStats['gamesPlayed'] ?? 0) > 0) {
            $gp = $seasonStats['gamesPlayed'];
            $data['season_stats'] = [
                'games_played' => $gp,
                'ppg' => round(($seasonStats['points'] ?? 0) / $gp, 1),
                'rpg' => round(($seasonStats['rebounds'] ?? 0) / $gp, 1),
                'apg' => round(($seasonStats['assists'] ?? 0) / $gp, 1),
                'spg' => round(($seasonStats['steals'] ?? 0) / $gp, 1),
                'bpg' => round(($seasonStats['blocks'] ?? 0) / $gp, 1),
                'fg_pct' => ($seasonStats['fieldGoalsAttempted'] ?? 0) > 0
                    ? round(($seasonStats['fieldGoalsMade'] ?? 0) / $seasonStats['fieldGoalsAttempted'] * 100, 1) : 0,
                'three_pct' => ($seasonStats['threePointersAttempted'] ?? 0) > 0
                    ? round(($seasonStats['threePointersMade'] ?? 0) / $seasonStats['threePointersAttempted'] * 100, 1) : 0,
                'ft_pct' => ($seasonStats['freeThrowsAttempted'] ?? 0) > 0
                    ? round(($seasonStats['freeThrowsMade'] ?? 0) / $seasonStats['freeThrowsAttempted'] * 100, 1) : 0,
                'mpg' => round(($seasonStats['minutesPlayed'] ?? 0) / $gp, 1),
            ];
        }

        // Include evolution tracking data
        $data['development_history'] = $player['development_history'] ?? $player['developmentHistory'] ?? [];
        $data['streak_data'] = $player['streak_data'] ?? $player['streakData'] ?? null;
        $data['recent_performances'] = $player['recent_performances'] ?? $player['recentPerformances'] ?? [];
        $data['upgrade_points'] = $player['upgrade_points'] ?? $player['upgradePoints'] ?? 0;

        return $data;
    }

    /**
     * Ensure target minutes exist, generating and persisting defaults if needed.
     */
    private function ensureTargetMinutes(Campaign $campaign, array $roster, ?array $starterIds): array
    {
        $savedMinutes = $campaign->settings['lineup']['target_minutes'] ?? [];

        if (!empty($savedMinutes)) {
            return $savedMinutes;
        }

        // Generate defaults using SubstitutionService
        $starterIds = array_filter($starterIds ?? [], fn($id) => $id !== null);
        $defaults = $this->substitutionService->getDefaultTargetMinutes($roster, $starterIds);

        // Persist to campaign settings
        $settings = $campaign->settings ?? [];
        $settings['lineup']['target_minutes'] = $defaults;
        $campaign->settings = $settings;
        $campaign->save();

        return $defaults;
    }

    /**
     * Get position sort order.
     */
    private function getPositionOrder(string $position): int
    {
        return match ($position) {
            'PG' => 1,
            'SG' => 2,
            'SF' => 3,
            'PF' => 4,
            'C' => 5,
            default => 6,
        };
    }

    /**
     * Format height in inches to display format (e.g., 6'10").
     */
    private function formatHeight(int $inches): string
    {
        $feet = floor($inches / 12);
        $remainingInches = $inches % 12;
        return "{$feet}'{$remainingInches}\"";
    }

    /**
     * Calculate age from birth date.
     */
    private function calculateAge(?string $birthDate): int
    {
        if (!$birthDate) {
            return 25;
        }
        try {
            return (int) abs(now()->diffInYears($birthDate));
        } catch (\Exception $e) {
            return 25;
        }
    }

    /**
     * Get free agents.
     */
    public function freeAgents(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $freeAgents = Player::where('campaign_id', $campaign->id)
            ->whereNull('team_id')
            ->orderBy('overall_rating', 'desc')
            ->get()
            ->map(function ($player) {
                return $this->formatPlayer($player);
            });

        return response()->json(['free_agents' => $freeAgents]);
    }

    /**
     * Sign a free agent.
     */
    public function signPlayer(Request $request, Campaign $campaign, Player $player): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        if ($player->campaign_id !== $campaign->id || $player->team_id !== null) {
            return response()->json(['message' => 'Player is not a free agent in this campaign'], 400);
        }

        $validated = $request->validate([
            'years' => 'required|integer|min:1|max:5',
            'salary' => 'required|numeric|min:900000',
        ]);

        $team = $campaign->team;

        // Check cap space
        if ($validated['salary'] > $team->cap_space) {
            return response()->json(['message' => 'Not enough cap space'], 400);
        }

        // Check roster size
        if ($team->players->count() >= 15) {
            return response()->json(['message' => 'Roster is full'], 400);
        }

        // Sign the player
        $player->update([
            'team_id' => $team->id,
            'contract_years_remaining' => $validated['years'],
            'contract_salary' => $validated['salary'],
            'contract_details' => [
                'totalYears' => $validated['years'],
                'salaries' => array_fill(0, $validated['years'], $validated['salary']),
                'signedYear' => $campaign->currentSeason?->year ?? 2025,
            ],
        ]);

        // Update team payroll
        $team->update([
            'total_payroll' => $team->total_payroll + $validated['salary'],
        ]);

        // Record transaction
        $this->financeService->recordTransaction($campaign, 'signing', [
            'playerId' => $player->id,
            'playerName' => $player->first_name . ' ' . $player->last_name,
            'teamId' => $team->id,
            'teamName' => $team->city . ' ' . $team->name,
            'years' => $validated['years'],
            'salary' => $validated['salary'],
            'totalValue' => $validated['salary'] * $validated['years'],
        ]);

        return response()->json([
            'message' => 'Player signed successfully',
            'player' => $this->formatPlayer($player->fresh()),
        ]);
    }

    /**
     * Release a player.
     */
    public function releasePlayer(Request $request, Campaign $campaign, Player $player): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        if ($player->campaign_id !== $campaign->id || $player->team_id !== $campaign->team_id) {
            return response()->json(['message' => 'Player is not on your team'], 400);
        }

        $team = $campaign->team;
        $salary = $player->contract_salary;

        // Release the player
        $player->update([
            'team_id' => null,
            'contract_years_remaining' => 0,
            'contract_salary' => 0,
            'contract_details' => [],
        ]);

        // Update team payroll
        $team->update([
            'total_payroll' => max(0, $team->total_payroll - $salary),
        ]);

        // Record transaction
        $this->financeService->recordTransaction($campaign, 'release', [
            'playerId' => $player->id,
            'playerName' => $player->first_name . ' ' . $player->last_name,
            'teamId' => $team->id,
            'teamName' => $team->city . ' ' . $team->name,
            'previousSalary' => $salary,
        ]);

        return response()->json([
            'message' => 'Player released',
        ]);
    }

    /**
     * Format player data for response.
     */
    private function formatPlayer(Player $player, bool $detailed = false, ?array $seasonStats = null): array
    {
        $data = [
            'id' => $player->id,
            'name' => $player->full_name,
            'first_name' => $player->first_name,
            'last_name' => $player->last_name,
            'position' => $player->position,
            'secondary_position' => $player->secondary_position,
            'jersey_number' => $player->jersey_number,
            'overall_rating' => $player->overall_rating,
            'potential_rating' => $player->potential_rating,
            'height' => $player->height_formatted,
            'height_inches' => $player->height_inches,
            'weight' => $player->weight_lbs,
            'age' => $player->age,
            'is_injured' => $player->is_injured,
            'fatigue' => $player->fatigue,
            'contract' => [
                'years_remaining' => $player->contract_years_remaining,
                'salary' => $player->contract_salary,
            ],
        ];

        // Include season stats from JSON file if provided
        if ($seasonStats && ($seasonStats['gamesPlayed'] ?? 0) > 0) {
            $gp = $seasonStats['gamesPlayed'];
            $data['season_stats'] = [
                'games_played' => $gp,
                'ppg' => round(($seasonStats['points'] ?? 0) / $gp, 1),
                'rpg' => round(($seasonStats['rebounds'] ?? 0) / $gp, 1),
                'apg' => round(($seasonStats['assists'] ?? 0) / $gp, 1),
                'spg' => round(($seasonStats['steals'] ?? 0) / $gp, 1),
                'bpg' => round(($seasonStats['blocks'] ?? 0) / $gp, 1),
                'fg_pct' => ($seasonStats['fieldGoalsAttempted'] ?? 0) > 0
                    ? round(($seasonStats['fieldGoalsMade'] ?? 0) / $seasonStats['fieldGoalsAttempted'] * 100, 1) : 0,
                'three_pct' => ($seasonStats['threePointersAttempted'] ?? 0) > 0
                    ? round(($seasonStats['threePointersMade'] ?? 0) / $seasonStats['threePointersAttempted'] * 100, 1) : 0,
                'ft_pct' => ($seasonStats['freeThrowsAttempted'] ?? 0) > 0
                    ? round(($seasonStats['freeThrowsMade'] ?? 0) / $seasonStats['freeThrowsAttempted'] * 100, 1) : 0,
                'mpg' => round(($seasonStats['minutesPlayed'] ?? 0) / $gp, 1),
            ];
        }

        // Use getAllBadges() to properly fetch from bridge table for user players
        $badges = $player->getAllBadges();

        if ($detailed) {
            $data['attributes'] = $player->attributes;
            $data['tendencies'] = $player->tendencies;
            $data['badges'] = $badges;
            $data['personality'] = $player->personality;
            $data['contract_details'] = $player->contract_details;
            $data['injury_details'] = $player->injury_details;
        } else {
            // Include badges in non-detailed view too (for team view)
            $data['badges'] = $badges;
            $data['attributes'] = $player->attributes;
        }

        // Always include evolution tracking data
        $data['development_history'] = $player->development_history ?? [];
        $data['streak_data'] = $player->streak_data;
        $data['recent_performances'] = $player->recent_performances ?? [];
        $data['upgrade_points'] = $player->upgrade_points ?? 0;

        return $data;
    }

    /**
     * Get available coaching schemes with descriptions.
     */
    public function getCoachingSchemes(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $schemes = $this->coachingService->getSchemes();

        // Get roster for scheme effectiveness calculation
        $team = $campaign->team;
        $roster = $this->playerService->getTeamRoster(
            $campaign->id,
            $team->abbreviation,
            $campaign->team_id
        );

        // Calculate effectiveness for each scheme
        $schemesWithEffectiveness = [];
        foreach ($schemes as $id => $scheme) {
            $schemesWithEffectiveness[$id] = array_merge($scheme, [
                'id' => $id,
                'effectiveness' => round($this->coachingService->calculateSchemeEffectiveness($id, $roster)),
            ]);
        }

        // Get recommended scheme
        $recommended = $this->coachingService->recommendScheme($roster);

        $currentScheme = $team->coaching_scheme ?? ['offensive' => 'balanced', 'defensive' => 'man', 'substitution' => 'staggered'];

        // Get substitution strategies
        $substitutionStrategies = $this->coachingService->getSubstitutionStrategies();

        return response()->json([
            'schemes' => $schemesWithEffectiveness,
            'recommended' => $recommended,
            'current' => $currentScheme,
            'substitution_strategies' => $substitutionStrategies,
        ]);
    }

    /**
     * Upgrade a player attribute using upgrade points.
     */
    public function upgradePlayerAttribute(Request $request, Campaign $campaign, Player $player): JsonResponse
    {
        // Verify ownership
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }
        if ($player->campaign_id !== $campaign->id) {
            return response()->json(['message' => 'Player not in campaign'], 400);
        }
        if ($player->team_id !== $campaign->team_id) {
            return response()->json(['message' => 'Player not on your team'], 400);
        }

        $validated = $request->validate([
            'category' => 'required|in:offense,defense,physical',
            'attribute' => 'required|string',
        ]);

        // Check player has points
        if (($player->upgrade_points ?? 0) < 1) {
            return response()->json(['message' => 'No upgrade points available'], 400);
        }

        // Verify attribute exists
        $attributes = $player->attributes;
        if (!isset($attributes[$validated['category']][$validated['attribute']])) {
            return response()->json(['message' => 'Invalid attribute'], 400);
        }

        $currentValue = $attributes[$validated['category']][$validated['attribute']];
        $potentialCap = $player->potential_rating ?? 99;

        if ($currentValue >= $potentialCap) {
            return response()->json(['message' => 'Attribute at potential cap'], 400);
        }

        // Apply upgrade (capped at potential rating)
        $attributes[$validated['category']][$validated['attribute']] = min($potentialCap, $currentValue + 1);

        // Record in development history
        $history = $player->development_history ?? [];
        $history[] = [
            'date' => now()->format('Y-m-d'),
            'category' => $validated['category'],
            'attribute' => $validated['attribute'],
            'change' => 1,
            'old_value' => $currentValue,
            'new_value' => $currentValue + 1,
            'source' => 'manual_upgrade',
        ];

        // Recalculate overall
        $newOverall = $this->calculateOverallRating($attributes);

        $player->update([
            'attributes' => $attributes,
            'upgrade_points' => $player->upgrade_points - 1,
            'development_history' => array_slice($history, -200),
            'overall_rating' => $newOverall,
        ]);

        return response()->json([
            'success' => true,
            'attribute' => $validated['attribute'],
            'new_value' => $currentValue + 1,
            'remaining_points' => $player->upgrade_points - 1,
            'new_overall' => $newOverall,
        ]);
    }

    /**
     * Calculate overall rating from attributes.
     */
    private function calculateOverallRating(array $attributes): int
    {
        $weights = config('player_evolution.overall_weights', [
            'offense' => 0.40,
            'defense' => 0.25,
            'physical' => 0.20,
            'mental' => 0.15,
        ]);

        $categoryAverages = [];
        foreach ($attributes as $category => $categoryAttrs) {
            if (!is_array($categoryAttrs) || empty($categoryAttrs)) continue;
            $categoryAverages[$category] = array_sum($categoryAttrs) / count($categoryAttrs);
        }

        $overall = 0;
        foreach ($weights as $category => $weight) {
            $overall += ($categoryAverages[$category] ?? 75) * $weight;
        }

        return (int) round(min(99, max(40, $overall)));
    }

    /**
     * Update the team's coaching scheme.
     * Accepts either { offensive, defensive } or legacy { scheme } format.
     */
    public function updateCoachingScheme(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Support both new format and legacy format
        $offensiveStyles = ['balanced', 'motion', 'iso_heavy', 'post_centric', 'three_point', 'run_and_gun'];
        $defensiveStyles = ['man', 'zone_2_3', 'zone_3_2', 'zone_1_3_1', 'press', 'trap'];
        $subStrategies = ['staggered', 'platoon', 'tight_rotation', 'deep_bench'];

        $validated = $request->validate([
            'offensive' => 'sometimes|string|in:' . implode(',', $offensiveStyles),
            'defensive' => 'sometimes|string|in:' . implode(',', $defensiveStyles),
            'substitution' => 'sometimes|string|in:' . implode(',', $subStrategies),
            'scheme' => 'sometimes|string|in:' . implode(',', $offensiveStyles), // Legacy support
        ]);

        $team = $campaign->team;
        $currentScheme = $team->coaching_scheme ?? ['offensive' => 'balanced', 'defensive' => 'man', 'substitution' => 'staggered'];

        // Handle legacy format (just 'scheme' for offensive)
        if (isset($validated['scheme']) && !isset($validated['offensive'])) {
            $validated['offensive'] = $validated['scheme'];
        }

        // Update schemes
        $newScheme = [
            'offensive' => $validated['offensive'] ?? $currentScheme['offensive'] ?? 'balanced',
            'defensive' => $validated['defensive'] ?? $currentScheme['defensive'] ?? 'man',
            'substitution' => $validated['substitution'] ?? $currentScheme['substitution'] ?? 'staggered',
        ];

        $team->update(['coaching_scheme' => $newScheme]);

        // Sync to campaign settings so game view stays in sync
        $campaign->update([
            'settings' => array_merge($campaign->settings ?? [], [
                'offensive_style' => $newScheme['offensive'],
                'defensive_style' => $newScheme['defensive'],
            ])
        ]);

        $offensiveSchemeData = $this->coachingService->getScheme($newScheme['offensive']);

        return response()->json([
            'message' => 'Coaching scheme updated',
            'coaching_scheme' => $newScheme,
            'scheme_data' => $offensiveSchemeData,
        ]);
    }
}
