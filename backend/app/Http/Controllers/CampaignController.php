<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\Team;
use App\Models\Player;
use App\Models\Coach;
use App\Models\Season;
use App\Services\CampaignPlayerService;
use App\Services\CampaignSeasonService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Database\Seeders\TeamSeeder;
use Database\Seeders\CoachSeeder;

class CampaignController extends Controller
{
    public function __construct(
        private CampaignSeasonService $seasonService
    ) {}
    /**
     * Get all campaigns for the authenticated user.
     */
    public function index(Request $request): JsonResponse
    {
        $campaigns = Campaign::where('user_id', $request->user()->id)
            ->with(['team:id,name,abbreviation,primary_color,secondary_color'])
            ->orderBy('last_played_at', 'desc')
            ->get();

        return response()->json([
            'campaigns' => $campaigns->map(function ($campaign) {
                return [
                    'id' => $campaign->id,
                    'name' => $campaign->name,
                    'team' => $campaign->team,
                    'current_date' => $campaign->current_date->format('Y-m-d'),
                    'game_year' => $campaign->game_year,
                    'difficulty' => $campaign->difficulty,
                    'last_played_at' => $campaign->last_played_at?->toISOString(),
                ];
            }),
        ]);
    }

    /**
     * Create a new campaign.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'team_abbreviation' => 'required|string|max:5',
            'difficulty' => 'required|in:rookie,pro,all_star,hall_of_fame',
        ]);

        try {
            DB::beginTransaction();

            // Create the campaign
            $campaign = Campaign::create([
                'user_id' => $request->user()->id,
                'name' => $validated['name'],
                'current_date' => '2025-10-21', // NBA season start
                'game_year' => 1,
                'difficulty' => $validated['difficulty'],
                'settings' => [
                    'autoSave' => true,
                    'injuryFrequency' => 'normal',
                    'tradeFrequency' => 'normal',
                ],
                'last_played_at' => now(),
            ]);

            // Generate teams, coaches, and players for this campaign
            // Players for user's team go to database, others to JSON file
            $playerStats = $this->generateCampaignData($campaign->id, $validated['team_abbreviation']);

            // Find and set the user's selected team
            $userTeam = Team::where('campaign_id', $campaign->id)
                ->where('abbreviation', $validated['team_abbreviation'])
                ->first();

            if (!$userTeam) {
                throw new \Exception('Selected team not found');
            }

            // Create the initial season record (minimal - just for phase management)
            $season = Season::create([
                'campaign_id' => $campaign->id,
                'year' => 2025,
                'phase' => 'regular',
            ]);

            // Update campaign with team and season
            $campaign->update([
                'team_id' => $userTeam->id,
                'current_season_id' => $season->id,
            ]);

            // Initialize season data in JSON file and generate schedule
            $this->seasonService->initializeSeason($campaign, 2025);
            $gamesCreated = $this->seasonService->generateSchedule($campaign, 2025);

            DB::commit();

            return response()->json([
                'message' => 'Campaign created successfully',
                'campaign' => [
                    'id' => $campaign->id,
                    'name' => $campaign->name,
                    'team' => $userTeam,
                    'games_created' => $gamesCreated,
                ],
            ], 201);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'message' => 'Failed to create campaign',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Get a specific campaign with full data.
     */
    public function show(Request $request, Campaign $campaign): JsonResponse
    {
        // Ensure user owns this campaign
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Update last played time
        $campaign->update(['last_played_at' => now()]);

        // Load the campaign with relationships
        $campaign->load([
            'team.players' => function ($query) {
                $query->select([
                    'id', 'team_id', 'first_name', 'last_name', 'position',
                    'secondary_position', 'jersey_number', 'overall_rating',
                    'potential_rating', 'height_inches', 'weight_lbs', 'birth_date',
                    'attributes', 'badges', 'contract_years_remaining', 'contract_salary',
                    'is_injured', 'fatigue'
                ])->orderBy('overall_rating', 'desc');
            },
            'team.coach',
            'currentSeason',
        ]);

        // Get standings from JSON file
        $year = $campaign->currentSeason?->year ?? 2025;
        $standings = $this->seasonService->getStandings($campaign->id, $year);

        // Get upcoming games from JSON file
        $upcomingGames = $this->seasonService->getUpcomingGames($campaign->id, $year, $campaign->team_id, 5);
        $upcomingGames = $this->formatUpcomingGames($upcomingGames, $campaign);

        // Get recent news
        $recentNews = $campaign->newsEvents()
            ->orderBy('game_date', 'desc')
            ->limit(10)
            ->get();

        return response()->json([
            'campaign' => [
                'id' => $campaign->id,
                'name' => $campaign->name,
                'current_date' => $campaign->current_date->format('Y-m-d'),
                'game_year' => $campaign->game_year,
                'difficulty' => $campaign->difficulty,
                'settings' => $campaign->settings,
            ],
            'team' => $campaign->team,
            'roster' => $campaign->team?->players->map(function ($player) {
                return [
                    'id' => $player->id,
                    'name' => $player->full_name,
                    'position' => $player->position,
                    'secondary_position' => $player->secondary_position,
                    'jersey_number' => $player->jersey_number,
                    'overall_rating' => $player->overall_rating,
                    'potential_rating' => $player->potential_rating,
                    'height' => $player->height_formatted,
                    'weight' => $player->weight_lbs,
                    'age' => $player->age,
                    'attributes' => $player->attributes,
                    'badges' => $player->badges,
                    'contract' => [
                        'years_remaining' => $player->contract_years_remaining,
                        'salary' => $player->contract_salary,
                    ],
                    'is_injured' => $player->is_injured,
                    'fatigue' => $player->fatigue,
                ];
            }),
            'coach' => $campaign->team?->coach,
            'season' => [
                'year' => $campaign->currentSeason?->year,
                'phase' => $campaign->currentSeason?->phase,
            ],
            'standings' => $standings,
            'upcoming_games' => $upcomingGames,
            'news' => $recentNews,
        ]);
    }

    /**
     * Update campaign settings.
     */
    public function update(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'name' => 'sometimes|string|max:100',
            'settings' => 'sometimes|array',
            'current_date' => 'sometimes|date',
        ]);

        if (isset($validated['settings'])) {
            $validated['settings'] = array_merge(
                $campaign->settings ?? [],
                $validated['settings']
            );
        }

        $campaign->update($validated);
        $campaign->update(['last_played_at' => now()]);

        return response()->json([
            'message' => 'Campaign updated successfully',
            'campaign' => $campaign->fresh(),
        ]);
    }

    /**
     * Delete a campaign.
     */
    public function destroy(Request $request, Campaign $campaign): JsonResponse
    {
        if ($campaign->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Clean up campaign player data (both DB and JSON)
        $playerService = app(CampaignPlayerService::class);
        $playerService->deleteCampaignPlayers($campaign->id);

        // Clean up campaign season data (JSON files)
        $this->seasonService->deleteAllCampaignSeasons($campaign->id);

        $campaign->delete();

        return response()->json([
            'message' => 'Campaign deleted successfully',
        ]);
    }

    /**
     * Get available teams for campaign creation.
     */
    public function getTeams(): JsonResponse
    {
        // Return the list of available team templates
        $teams = [
            // Eastern Conference - Atlantic
            ['abbreviation' => 'BOS', 'name' => 'Boston Seltics', 'city' => 'Boston', 'conference' => 'east', 'division' => 'Atlantic', 'primary_color' => '#007A33'],
            ['abbreviation' => 'BKN', 'name' => 'Brooklyn Netts', 'city' => 'Brooklyn', 'conference' => 'east', 'division' => 'Atlantic', 'primary_color' => '#000000'],
            ['abbreviation' => 'NYK', 'name' => 'New York Bricks', 'city' => 'New York', 'conference' => 'east', 'division' => 'Atlantic', 'primary_color' => '#006BB6'],
            ['abbreviation' => 'PHI', 'name' => 'Philadelphia 67ers', 'city' => 'Philadelphia', 'conference' => 'east', 'division' => 'Atlantic', 'primary_color' => '#006BB6'],
            ['abbreviation' => 'TOR', 'name' => 'Toronto Velociraptors', 'city' => 'Toronto', 'conference' => 'east', 'division' => 'Atlantic', 'primary_color' => '#CE1141'],
            // Eastern Conference - Central
            ['abbreviation' => 'CHI', 'name' => 'Chicago Bullies', 'city' => 'Chicago', 'conference' => 'east', 'division' => 'Central', 'primary_color' => '#CE1141'],
            ['abbreviation' => 'CLE', 'name' => 'Cleveland Cavemen', 'city' => 'Cleveland', 'conference' => 'east', 'division' => 'Central', 'primary_color' => '#6F263D'],
            ['abbreviation' => 'DET', 'name' => 'Detroit Pistons', 'city' => 'Detroit', 'conference' => 'east', 'division' => 'Central', 'primary_color' => '#C8102E'],
            ['abbreviation' => 'IND', 'name' => 'Indiana Racers', 'city' => 'Indiana', 'conference' => 'east', 'division' => 'Central', 'primary_color' => '#002D62'],
            ['abbreviation' => 'MIL', 'name' => 'Milwaukee Ducks', 'city' => 'Milwaukee', 'conference' => 'east', 'division' => 'Central', 'primary_color' => '#00471B'],
            // Eastern Conference - Southeast
            ['abbreviation' => 'ATL', 'name' => 'Atlanta Falcons', 'city' => 'Atlanta', 'conference' => 'east', 'division' => 'Southeast', 'primary_color' => '#E03A3E'],
            ['abbreviation' => 'CHA', 'name' => 'Charlotte Stingers', 'city' => 'Charlotte', 'conference' => 'east', 'division' => 'Southeast', 'primary_color' => '#1D1160'],
            ['abbreviation' => 'MIA', 'name' => 'Miami Warm', 'city' => 'Miami', 'conference' => 'east', 'division' => 'Southeast', 'primary_color' => '#98002E'],
            ['abbreviation' => 'ORL', 'name' => 'Orlando Tragic', 'city' => 'Orlando', 'conference' => 'east', 'division' => 'Southeast', 'primary_color' => '#0077C0'],
            ['abbreviation' => 'WAS', 'name' => 'Washington Lizards', 'city' => 'Washington', 'conference' => 'east', 'division' => 'Southeast', 'primary_color' => '#002B5C'],
            // Western Conference - Northwest
            ['abbreviation' => 'DEN', 'name' => 'Denver Chunks', 'city' => 'Denver', 'conference' => 'west', 'division' => 'Northwest', 'primary_color' => '#0E2240'],
            ['abbreviation' => 'MIN', 'name' => 'Minnesota Timberpups', 'city' => 'Minnesota', 'conference' => 'west', 'division' => 'Northwest', 'primary_color' => '#0C2340'],
            ['abbreviation' => 'OKC', 'name' => 'Oklahoma City Blunder', 'city' => 'Oklahoma City', 'conference' => 'west', 'division' => 'Northwest', 'primary_color' => '#007AC1'],
            ['abbreviation' => 'POR', 'name' => 'Portland Trail Losers', 'city' => 'Portland', 'conference' => 'west', 'division' => 'Northwest', 'primary_color' => '#E03A3E'],
            ['abbreviation' => 'UTA', 'name' => 'Utah Jizz', 'city' => 'Utah', 'conference' => 'west', 'division' => 'Northwest', 'primary_color' => '#002B5C'],
            // Western Conference - Pacific
            ['abbreviation' => 'GSW', 'name' => 'Golden State Worriers', 'city' => 'San Francisco', 'conference' => 'west', 'division' => 'Pacific', 'primary_color' => '#1D428A'],
            ['abbreviation' => 'LAL', 'name' => 'Los Angeles Fakers', 'city' => 'Los Angeles', 'conference' => 'west', 'division' => 'Pacific', 'primary_color' => '#552583'],
            ['abbreviation' => 'LAC', 'name' => 'Los Angeles Snippers', 'city' => 'Los Angeles', 'conference' => 'west', 'division' => 'Pacific', 'primary_color' => '#C8102E'],
            ['abbreviation' => 'PHX', 'name' => 'Phoenix Buns', 'city' => 'Phoenix', 'conference' => 'west', 'division' => 'Pacific', 'primary_color' => '#1D1160'],
            ['abbreviation' => 'SAC', 'name' => 'Sacramento Monarchs', 'city' => 'Sacramento', 'conference' => 'west', 'division' => 'Pacific', 'primary_color' => '#5A2D81'],
            // Western Conference - Southwest
            ['abbreviation' => 'DAL', 'name' => 'Dallas Mavericks', 'city' => 'Dallas', 'conference' => 'west', 'division' => 'Southwest', 'primary_color' => '#00538C'],
            ['abbreviation' => 'HOU', 'name' => 'Houston Rockets', 'city' => 'Houston', 'conference' => 'west', 'division' => 'Southwest', 'primary_color' => '#CE1141'],
            ['abbreviation' => 'MEM', 'name' => 'Memphis Grindlies', 'city' => 'Memphis', 'conference' => 'west', 'division' => 'Southwest', 'primary_color' => '#5D76A9'],
            ['abbreviation' => 'NOP', 'name' => 'New Orleans Parrots', 'city' => 'New Orleans', 'conference' => 'west', 'division' => 'Southwest', 'primary_color' => '#0C2340'],
            ['abbreviation' => 'SAS', 'name' => 'San Antonio Spurts', 'city' => 'San Antonio', 'conference' => 'west', 'division' => 'Southwest', 'primary_color' => '#C4CED4'],
        ];

        return response()->json(['teams' => $teams]);
    }

    /**
     * Generate teams, coaches, and players for a new campaign.
     */
    private function generateCampaignData(int $campaignId, string $userTeamAbbreviation): array
    {
        $teamSeeder = new TeamSeeder();
        $teamSeeder->campaignId = $campaignId;
        $teamSeeder->run();

        $coachSeeder = new CoachSeeder();
        $coachSeeder->campaignId = $campaignId;
        $coachSeeder->run();

        // Use CampaignPlayerService for hybrid storage:
        // - User's team players go to MySQL database
        // - All other teams' players go to campaign JSON file
        $playerService = app(CampaignPlayerService::class);
        $campaign = Campaign::find($campaignId);

        return $playerService->initializeCampaignPlayers($campaign, $userTeamAbbreviation);
    }

    /**
     * Format upcoming games with team info for API response.
     */
    private function formatUpcomingGames(array $games, Campaign $campaign): array
    {
        $teamCache = [];

        return array_map(function ($game) use ($campaign, &$teamCache) {
            // Cache team lookups
            if (!isset($teamCache[$game['homeTeamId']])) {
                $teamCache[$game['homeTeamId']] = Team::find($game['homeTeamId']);
            }
            if (!isset($teamCache[$game['awayTeamId']])) {
                $teamCache[$game['awayTeamId']] = Team::find($game['awayTeamId']);
            }

            $homeTeam = $teamCache[$game['homeTeamId']];
            $awayTeam = $teamCache[$game['awayTeamId']];

            return [
                'id' => $game['id'],
                'home_team' => $homeTeam ? [
                    'id' => $homeTeam->id,
                    'name' => $homeTeam->name,
                    'abbreviation' => $homeTeam->abbreviation,
                    'primary_color' => $homeTeam->primary_color,
                ] : null,
                'away_team' => $awayTeam ? [
                    'id' => $awayTeam->id,
                    'name' => $awayTeam->name,
                    'abbreviation' => $awayTeam->abbreviation,
                    'primary_color' => $awayTeam->primary_color,
                ] : null,
                'game_date' => $game['gameDate'],
                'is_home' => $game['homeTeamId'] === $campaign->team_id,
            ];
        }, $games);
    }
}
