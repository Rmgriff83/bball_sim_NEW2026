<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Team;
use App\Models\Player;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TeamController extends Controller
{
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

        $team->load(['players' => function ($query) {
            $query->orderByRaw("CASE position WHEN 'PG' THEN 1 WHEN 'SG' THEN 2 WHEN 'SF' THEN 3 WHEN 'PF' THEN 4 WHEN 'C' THEN 5 ELSE 6 END")
                  ->orderBy('overall_rating', 'desc');
        }, 'coach']);

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
            ],
            'roster' => $team->players->map(function ($player) {
                return $this->formatPlayer($player);
            }),
            'coach' => $team->coach ? [
                'id' => $team->coach->id,
                'name' => $team->coach->first_name . ' ' . $team->coach->last_name,
                'overall_rating' => $team->coach->overall_rating,
                'offensive_scheme' => $team->coach->offensive_scheme,
                'defensive_scheme' => $team->coach->defensive_scheme,
                'attributes' => $team->coach->attributes,
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
            'starters.*' => 'required|integer|exists:players,id',
            'rotation' => 'sometimes|array',
            'rotation.*' => 'sometimes|integer|exists:players,id',
        ]);

        // Verify all players belong to the user's team
        $team = $campaign->team;
        $teamPlayers = $team->players->keyBy('id');

        foreach ($validated['starters'] as $playerId) {
            if (!$teamPlayers->has($playerId)) {
                return response()->json(['message' => 'Invalid player selection'], 400);
            }
        }

        // Validate position assignments
        $positions = ['PG', 'SG', 'SF', 'PF', 'C'];
        $positionErrors = [];

        foreach ($validated['starters'] as $index => $playerId) {
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

        // Store lineup in team settings or campaign settings
        $settings = $campaign->settings ?? [];
        $settings['lineup'] = [
            'starters' => $validated['starters'],
            'rotation' => $validated['rotation'] ?? [],
        ];
        $campaign->update(['settings' => $settings]);

        return response()->json([
            'message' => 'Lineup updated successfully',
            'lineup' => $settings['lineup'],
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

        $team->load(['players' => function ($query) {
            $query->orderByRaw("CASE position WHEN 'PG' THEN 1 WHEN 'SG' THEN 2 WHEN 'SF' THEN 3 WHEN 'PF' THEN 4 WHEN 'C' THEN 5 ELSE 6 END")
                  ->orderBy('overall_rating', 'desc');
        }, 'coach']);

        return response()->json([
            'team' => [
                'id' => $team->id,
                'name' => $team->name,
                'city' => $team->city,
                'abbreviation' => $team->abbreviation,
                'primary_color' => $team->primary_color,
                'secondary_color' => $team->secondary_color,
            ],
            'roster' => $team->players->map(function ($player) {
                return $this->formatPlayer($player);
            }),
            'coach' => $team->coach,
        ]);
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
                'signedYear' => $campaign->currentSeason?->year ?? 2024,
            ],
        ]);

        // Update team payroll
        $team->update([
            'total_payroll' => $team->total_payroll + $validated['salary'],
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

        return response()->json([
            'message' => 'Player released',
        ]);
    }

    /**
     * Format player data for response.
     */
    private function formatPlayer(Player $player, bool $detailed = false): array
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

        if ($detailed) {
            $data['attributes'] = $player->attributes;
            $data['tendencies'] = $player->tendencies;
            $data['badges'] = $player->badges;
            $data['personality'] = $player->personality;
            $data['contract_details'] = $player->contract_details;
            $data['injury_details'] = $player->injury_details;
        } else {
            // Include badges in non-detailed view too (for team view)
            $data['badges'] = $player->badges;
            $data['attributes'] = $player->attributes;
        }

        return $data;
    }
}
