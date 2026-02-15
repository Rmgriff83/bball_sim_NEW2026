<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\Game;
use App\Models\Team;
use App\Models\Player;
use App\Models\BadgeDefinition;
use App\Models\BadgeSynergy;
use App\Services\PlayerEvolution\PlayerEvolutionService;
use Illuminate\Support\Facades\Cache;

class GameSimulationService
{
    private const QUARTERS = 4;
    private const QUARTER_LENGTH_MINUTES = 10;
    private const POSSESSIONS_PER_MINUTE = 2.2; // ~100 possessions per game
    private const SHOT_CLOCK_SECONDS = 24;

    private array $badgeDefinitions = [];
    private array $badgeSynergies = [];
    private CampaignPlayerService $playerService;
    private PlayerEvolutionService $evolutionService;
    private PlayService $playService;
    private PlayExecutionEngine $playEngine;
    private CoachingService $coachingService;
    private GameNewsService $gameNewsService;
    private SubstitutionService $substitutionService;

    // Substitution state
    private array $homeTargetMinutes = [];
    private array $awayTargetMinutes = [];
    private string $homeSubStrategy = 'staggered';
    private string $awaySubStrategy = 'staggered';
    private array $homeStarterIds = [];
    private array $awayStarterIds = [];
    private bool $isLiveGame = false;
    private ?int $userTeamId = null;

    // Game state
    private bool $generateAnimationData = true;
    private array $homeBoxScore = [];
    private array $awayBoxScore = [];
    private array $playByPlay = [];
    private array $animationData = [];
    private int $homeScore = 0;
    private int $awayScore = 0;
    private int $currentQuarter = 1;
    private float $timeRemaining = 12.0;
    private array $quarterScores = ['home' => [], 'away' => []];
    private int $possessionCount = 0;
    private array $quarterEndPossessions = [];

    // Team data
    private Team $homeTeam;
    private Team $awayTeam;
    private array $homePlayers = [];
    private array $awayPlayers = [];
    private array $homeLineup = [];
    private array $awayLineup = [];
    private string $homeOffensiveScheme = 'balanced';
    private string $awayOffensiveScheme = 'balanced';
    private string $homeDefensiveScheme = 'man';
    private string $awayDefensiveScheme = 'man';

    // Clutch play tracking for game-winner news
    private ?array $lastClutchPlay = null;
    private ?Campaign $currentCampaign = null;

    // Synergy tracking for rewards
    private int $homeSynergiesActivated = 0;
    private int $awaySynergiesActivated = 0;

    // Team chemistry modifiers (from roster morale average)
    private float $homeChemistryModifier = 0.0;
    private float $awayChemistryModifier = 0.0;

    public function __construct(
        CampaignPlayerService $playerService,
        PlayerEvolutionService $evolutionService,
        PlayService $playService,
        PlayExecutionEngine $playEngine,
        CoachingService $coachingService,
        GameNewsService $gameNewsService,
        SubstitutionService $substitutionService
    ) {
        $this->playerService = $playerService;
        $this->evolutionService = $evolutionService;
        $this->playService = $playService;
        $this->playEngine = $playEngine;
        $this->coachingService = $coachingService;
        $this->gameNewsService = $gameNewsService;
        $this->substitutionService = $substitutionService;
        $this->loadBadgeData();
    }

    /**
     * Load badge definitions and synergies.
     */
    private function loadBadgeData(): void
    {
        $this->badgeDefinitions = Cache::remember('badge_definitions', 3600, fn() => BadgeDefinition::all()->keyBy('id')->toArray());
        $this->badgeSynergies = Cache::remember('badge_synergies', 3600, fn() => BadgeSynergy::all()->toArray());
    }

    /**
     * Simulate a complete game.
     * @deprecated Use simulateFromData instead for JSON-based storage
     */
    public function simulate(Game $game): array
    {
        $this->initializeGame($game);

        // Track scores at start of each quarter
        $homeScoreAtQuarterStart = 0;
        $awayScoreAtQuarterStart = 0;

        // Simulate each quarter
        for ($quarter = 1; $quarter <= self::QUARTERS; $quarter++) {
            $this->currentQuarter = $quarter;
            $this->simulateQuarter();

            // Track which possession ends this quarter
            $this->quarterEndPossessions[] = $this->possessionCount;

            // Record quarter scores (points scored in this quarter)
            $this->quarterScores['home'][] = $this->homeScore - $homeScoreAtQuarterStart;
            $this->quarterScores['away'][] = $this->awayScore - $awayScoreAtQuarterStart;
            $homeScoreAtQuarterStart = $this->homeScore;
            $awayScoreAtQuarterStart = $this->awayScore;
        }

        // Check for overtime
        while ($this->homeScore === $this->awayScore) {
            $this->currentQuarter++;
            $this->timeRemaining = 5.0; // 5-minute OT
            $this->simulateQuarter();

            // Track OT quarter end
            $this->quarterEndPossessions[] = $this->possessionCount;

            // Record OT scores
            $this->quarterScores['home'][] = $this->homeScore - $homeScoreAtQuarterStart;
            $this->quarterScores['away'][] = $this->awayScore - $awayScoreAtQuarterStart;
            $homeScoreAtQuarterStart = $this->homeScore;
            $awayScoreAtQuarterStart = $this->awayScore;
        }

        return $this->finalizeGame($game);
    }

    /**
     * Simulate a game from array data (for JSON-based storage).
     *
     * @param Campaign $campaign
     * @param array $gameData
     * @param Team $homeTeam
     * @param Team $awayTeam
     * @param array|null $userLineup Optional starting lineup for user's team (array of player IDs)
     * @param bool $generateAnimationData Whether to generate animation/play-by-play data (false for AI-only games)
     */
    public function simulateFromData(Campaign $campaign, array $gameData, Team $homeTeam, Team $awayTeam, ?array $userLineup = null, bool $generateAnimationData = true): array
    {
        $this->generateAnimationData = $generateAnimationData;
        $this->initializeGameFromData($campaign, $gameData, $homeTeam, $awayTeam, $userLineup);

        // Simulated game: AI handles all substitutions
        $this->isLiveGame = false;

        // Track scores at start of each quarter
        $homeScoreAtQuarterStart = 0;
        $awayScoreAtQuarterStart = 0;

        // Simulate each quarter
        for ($quarter = 1; $quarter <= self::QUARTERS; $quarter++) {
            $this->currentQuarter = $quarter;
            $this->simulateQuarter();

            // Track which possession ends this quarter
            $this->quarterEndPossessions[] = $this->possessionCount;

            // Record quarter scores (points scored in this quarter)
            $this->quarterScores['home'][] = $this->homeScore - $homeScoreAtQuarterStart;
            $this->quarterScores['away'][] = $this->awayScore - $awayScoreAtQuarterStart;
            $homeScoreAtQuarterStart = $this->homeScore;
            $awayScoreAtQuarterStart = $this->awayScore;
        }

        // Check for overtime
        while ($this->homeScore === $this->awayScore) {
            $this->currentQuarter++;
            $this->timeRemaining = 5.0; // 5-minute OT
            $this->simulateQuarter();

            // Track OT quarter end
            $this->quarterEndPossessions[] = $this->possessionCount;

            // Record OT scores
            $this->quarterScores['home'][] = $this->homeScore - $homeScoreAtQuarterStart;
            $this->quarterScores['away'][] = $this->awayScore - $awayScoreAtQuarterStart;
            $homeScoreAtQuarterStart = $this->homeScore;
            $awayScoreAtQuarterStart = $this->awayScore;
        }

        return $this->finalizeGameFromData($campaign, $gameData);
    }

    /**
     * Initialize game state from array data.
     */
    private function initializeGameFromData(Campaign $campaign, array $gameData, Team $homeTeam, Team $awayTeam, ?array $userLineup = null): void
    {
        $this->homeTeam = $homeTeam;
        $this->awayTeam = $awayTeam;
        $this->currentCampaign = $campaign;
        $this->lastClutchPlay = null;

        // Load players using hybrid storage
        $homeRoster = $this->playerService->getTeamRoster($campaign->id, $homeTeam->abbreviation, $campaign->team_id);
        $awayRoster = $this->playerService->getTeamRoster($campaign->id, $awayTeam->abbreviation, $campaign->team_id);

        // Sort by overall rating
        usort($homeRoster, fn($a, $b) => ($b['overallRating'] ?? 0) - ($a['overallRating'] ?? 0));
        usort($awayRoster, fn($a, $b) => ($b['overallRating'] ?? 0) - ($a['overallRating'] ?? 0));

        // Normalize player data format for simulation
        $this->homePlayers = array_map([$this, 'normalizePlayerForSimulation'], $homeRoster);
        $this->awayPlayers = array_map([$this, 'normalizePlayerForSimulation'], $awayRoster);

        // Determine if user's team is home or away
        $isUserHomeTeam = $homeTeam->id === $campaign->team_id;
        $isUserAwayTeam = $awayTeam->id === $campaign->team_id;

        // Initialize lineups - use saved lineup for user's team or AI team's saved lineup
        if ($isUserHomeTeam && $userLineup && count($userLineup) >= 5) {
            $this->homeLineup = $this->buildLineupFromIds($userLineup, $this->homePlayers);
        } elseif (!$isUserHomeTeam && !empty($homeTeam->lineup_settings['starters'])) {
            // Use AI team's saved lineup
            $this->homeLineup = $this->buildLineupFromIds($homeTeam->lineup_settings['starters'], $this->homePlayers);
        } else {
            $this->homeLineup = $this->selectLineup($this->homePlayers);
        }

        if ($isUserAwayTeam && $userLineup && count($userLineup) >= 5) {
            $this->awayLineup = $this->buildLineupFromIds($userLineup, $this->awayPlayers);
        } elseif (!$isUserAwayTeam && !empty($awayTeam->lineup_settings['starters'])) {
            // Use AI team's saved lineup
            $this->awayLineup = $this->buildLineupFromIds($awayTeam->lineup_settings['starters'], $this->awayPlayers);
        } else {
            $this->awayLineup = $this->selectLineup($this->awayPlayers);
        }

        // Reset and initialize box scores (important: clear previous game's data!)
        $this->homeBoxScore = [];
        $this->awayBoxScore = [];
        foreach ($this->homePlayers as $player) {
            $this->homeBoxScore[$player['id']] = $this->emptyStatLine($player);
        }
        foreach ($this->awayPlayers as $player) {
            $this->awayBoxScore[$player['id']] = $this->emptyStatLine($player);
        }

        $this->homeScore = 0;
        $this->awayScore = 0;
        $this->playByPlay = [];
        $this->animationData = [];
        $this->quarterScores = ['home' => [], 'away' => []];
        $this->possessionCount = 0;
        $this->quarterEndPossessions = [];
        $this->homeSynergiesActivated = 0;
        $this->awaySynergiesActivated = 0;

        // Get coaching schemes from teams (now an object with offensive/defensive)
        $homeScheme = $homeTeam->coaching_scheme ?? [];
        $awayScheme = $awayTeam->coaching_scheme ?? [];
        $this->homeOffensiveScheme = $homeScheme['offensive'] ?? 'balanced';
        $this->homeDefensiveScheme = $homeScheme['defensive'] ?? 'man';
        $this->awayOffensiveScheme = $awayScheme['offensive'] ?? 'balanced';
        $this->awayDefensiveScheme = $awayScheme['defensive'] ?? 'man';

        // Record starter IDs
        $this->homeStarterIds = array_map(fn($p) => $p['id'], $this->homeLineup);
        $this->awayStarterIds = array_map(fn($p) => $p['id'], $this->awayLineup);

        // Set user team ID
        $this->userTeamId = $campaign->team_id;

        // Load target minutes
        $this->homeTargetMinutes = $this->loadTargetMinutes(
            $homeTeam, $campaign, $isUserHomeTeam, $this->homePlayers, $this->homeStarterIds
        );
        $this->awayTargetMinutes = $this->loadTargetMinutes(
            $awayTeam, $campaign, $isUserAwayTeam, $this->awayPlayers, $this->awayStarterIds
        );

        // Load substitution strategies
        $this->homeSubStrategy = $homeScheme['substitution'] ?? 'staggered';
        $this->awaySubStrategy = $awayScheme['substitution'] ?? 'staggered';

        // Apply variance so minutes differ game-to-game
        $this->homeTargetMinutes = $this->substitutionService->applyVariance($this->homeTargetMinutes);
        $this->awayTargetMinutes = $this->substitutionService->applyVariance($this->awayTargetMinutes);

        // Calculate team chemistry modifiers from roster morale
        $this->homeChemistryModifier = $this->calculateChemistryModifier(
            collect($this->homePlayers)->avg(fn($p) => $p['personality']['morale'] ?? 80)
        );
        $this->awayChemistryModifier = $this->calculateChemistryModifier(
            collect($this->awayPlayers)->avg(fn($p) => $p['personality']['morale'] ?? 80)
        );
    }

    /**
     * Load target minutes for a team from the appropriate source.
     */
    private function loadTargetMinutes(Team $team, Campaign $campaign, bool $isUserTeam, array $players, array $starterIds): array
    {
        if ($isUserTeam) {
            $targetMinutes = $campaign->settings['lineup']['target_minutes'] ?? [];
        } else {
            $targetMinutes = $team->lineup_settings['target_minutes'] ?? [];
        }

        // Fallback to defaults if empty
        if (empty($targetMinutes)) {
            $targetMinutes = $this->substitutionService->getDefaultTargetMinutes($players, $starterIds);
        }

        return $targetMinutes;
    }

    /**
     * Finalize game from array data and return results (without updating DB).
     */
    private function finalizeGameFromData(Campaign $campaign, array $gameData): array
    {
        // Convert box score keys to snake_case for frontend
        $homeBoxScoreFormatted = array_map(fn($stats) => $this->formatBoxScoreStats($stats), array_values($this->homeBoxScore));
        $awayBoxScoreFormatted = array_map(fn($stats) => $this->formatBoxScoreStats($stats), array_values($this->awayBoxScore));

        // Note: We don't update the game record here - that's done by the controller
        // Process player evolution (fatigue, injuries, micro-development, morale)
        // Returns summary of evolution changes
        $evolutionSummary = $this->evolutionService->processPostGameFromData(
            $campaign,
            $gameData,
            $this->homeScore,
            $this->awayScore,
            [
                'home' => $this->homeBoxScore,
                'away' => $this->awayBoxScore,
            ]
        );

        // Generate news for game-winner (close game decided by clutch shot)
        $this->generateGameNews($campaign);

        // Process synergy rewards for user's team (requires animation data)
        $rewardSummary = null;
        if ($this->generateAnimationData && $campaign->user && ($this->homeTeam->id === $campaign->team_id || $this->awayTeam->id === $campaign->team_id)) {
            $isHome = $this->homeTeam->id === $campaign->team_id;
            $didWin = ($isHome && $this->homeScore > $this->awayScore) || (!$isHome && $this->awayScore > $this->homeScore);

            $rewardService = app(RewardService::class);
            $rewardSummary = $rewardService->processGameRewards(
                $campaign,
                ['possessions' => $this->animationData],
                $campaign->team_id,
                $isHome,
                $didWin
            );
        }

        return [
            'game_id' => $gameData['id'],
            'home_team' => $this->homeTeam->name,
            'away_team' => $this->awayTeam->name,
            'home_score' => $this->homeScore,
            'away_score' => $this->awayScore,
            'winner' => $this->homeScore > $this->awayScore ? 'home' : 'away',
            'box_score' => [
                'home' => $homeBoxScoreFormatted,
                'away' => $awayBoxScoreFormatted,
            ],
            'quarter_scores' => $this->quarterScores,
            'play_by_play' => $this->generateAnimationData ? $this->playByPlay : [],
            'animation_data' => $this->generateAnimationData ? [
                'possessions' => $this->animationData,
                'total_possessions' => $this->possessionCount,
                'quarter_end_indices' => $this->quarterEndPossessions,
            ] : [],
            'rewards' => $rewardSummary,
            'evolution' => $evolutionSummary,
        ];
    }

    /**
     * Initialize game state.
     */
    private function initializeGame(Game $game): void
    {
        $this->homeTeam = $game->homeTeam;
        $this->awayTeam = $game->awayTeam;
        $this->currentCampaign = $game->campaign;
        $this->lastClutchPlay = null;

        // Load players using hybrid storage (DB for user's team, JSON for others)
        $campaignId = $game->campaign_id;
        $userTeamId = $game->campaign->team_id ?? null;

        $homeRoster = $this->playerService->getTeamRoster($campaignId, $this->homeTeam->abbreviation, $userTeamId);
        $awayRoster = $this->playerService->getTeamRoster($campaignId, $this->awayTeam->abbreviation, $userTeamId);

        // Sort by overall rating
        usort($homeRoster, fn($a, $b) => ($b['overallRating'] ?? 0) - ($a['overallRating'] ?? 0));
        usort($awayRoster, fn($a, $b) => ($b['overallRating'] ?? 0) - ($a['overallRating'] ?? 0));

        // Normalize player data format for simulation
        $this->homePlayers = array_map([$this, 'normalizePlayerForSimulation'], $homeRoster);
        $this->awayPlayers = array_map([$this, 'normalizePlayerForSimulation'], $awayRoster);

        // Initialize lineups (top 5 players by position)
        $this->homeLineup = $this->selectLineup($this->homePlayers);
        $this->awayLineup = $this->selectLineup($this->awayPlayers);

        // Reset and initialize box scores (important: clear previous game's data!)
        $this->homeBoxScore = [];
        $this->awayBoxScore = [];
        foreach ($this->homePlayers as $player) {
            $this->homeBoxScore[$player['id']] = $this->emptyStatLine($player);
        }
        foreach ($this->awayPlayers as $player) {
            $this->awayBoxScore[$player['id']] = $this->emptyStatLine($player);
        }

        $this->homeScore = 0;
        $this->awayScore = 0;
        $this->playByPlay = [];
        $this->animationData = [];
        $this->quarterScores = ['home' => [], 'away' => []];
        $this->possessionCount = 0;
        $this->quarterEndPossessions = [];
        $this->homeSynergiesActivated = 0;
        $this->awaySynergiesActivated = 0;

        // Get coaching schemes from teams (now an object with offensive/defensive)
        $homeScheme = $this->homeTeam->coaching_scheme ?? [];
        $awayScheme = $this->awayTeam->coaching_scheme ?? [];
        $this->homeOffensiveScheme = $homeScheme['offensive'] ?? 'balanced';
        $this->homeDefensiveScheme = $homeScheme['defensive'] ?? 'man';
        $this->awayOffensiveScheme = $awayScheme['offensive'] ?? 'balanced';
        $this->awayDefensiveScheme = $awayScheme['defensive'] ?? 'man';
    }

    /**
     * Select starting lineup by position.
     */
    private function selectLineup(array $players): array
    {
        $lineup = [];
        $usedPlayerIds = [];
        $positions = ['PG', 'SG', 'SF', 'PF', 'C'];

        foreach ($positions as $pos) {
            foreach ($players as $player) {
                $playerId = $player['id'] ?? null;
                // Check position slot is empty AND player isn't already in lineup
                if (!isset($lineup[$pos]) && !in_array($playerId, $usedPlayerIds) &&
                    ($player['position'] === $pos || $player['secondary_position'] === $pos)) {
                    $lineup[$pos] = $player;
                    $usedPlayerIds[] = $playerId;
                    break;
                }
            }
        }

        // If we didn't fill all positions, fill with best available
        foreach ($positions as $pos) {
            if (!isset($lineup[$pos])) {
                foreach ($players as $player) {
                    $playerId = $player['id'] ?? null;
                    if (!in_array($playerId, $usedPlayerIds)) {
                        $lineup[$pos] = $player;
                        $usedPlayerIds[] = $playerId;
                        break;
                    }
                }
            }
        }

        return array_values($lineup);
    }

    /**
     * Build a lineup from an array of player IDs.
     * Falls back to selectLineup() if the lineup can't be fully built.
     */
    private function buildLineupFromIds(array $playerIds, array $allPlayers): array
    {
        $positions = ['PG', 'SG', 'SF', 'PF', 'C'];
        $lineup = [];

        // Build a map of player ID to player data for quick lookup
        $playerMap = [];
        foreach ($allPlayers as $player) {
            $playerMap[$player['id']] = $player;
        }

        // Build lineup from the provided IDs with position validation
        foreach ($playerIds as $index => $id) {
            if (!isset($playerMap[$id])) {
                // Player not found - fall back to auto-selection
                return $this->selectLineup($allPlayers);
            }

            $player = $playerMap[$id];
            $requiredPosition = $positions[$index] ?? null;

            // Validate position if we have one
            if ($requiredPosition) {
                $primaryPos = $player['position'] ?? null;
                $secondaryPos = $player['secondary_position'] ?? null;

                if ($primaryPos !== $requiredPosition && $secondaryPos !== $requiredPosition) {
                    // Position mismatch - fall back to auto-selection
                    \Log::warning("Lineup validation failed: {$player['first_name']} cannot play {$requiredPosition}");
                    return $this->selectLineup($allPlayers);
                }
            }

            $lineup[] = $player;
        }

        // If we couldn't build a full 5-player lineup, fall back to auto-selection
        if (count($lineup) < 5) {
            return $this->selectLineup($allPlayers);
        }

        return $lineup;
    }

    /**
     * Create empty stat line for a player.
     */
    private function emptyStatLine(array $player): array
    {
        return [
            'playerId' => $player['id'],
            'name' => $player['first_name'] . ' ' . $player['last_name'],
            'position' => $player['position'],
            'secondary_position' => $player['secondary_position'] ?? null,
            'overall_rating' => $player['overall_rating'] ?? null,
            'fatigue' => $player['fatigue'] ?? 0,
            'is_injured' => $player['is_injured'] ?? false,
            'minutes' => 0,
            'points' => 0,
            'rebounds' => 0,
            'offensiveRebounds' => 0,
            'defensiveRebounds' => 0,
            'assists' => 0,
            'steals' => 0,
            'blocks' => 0,
            'turnovers' => 0,
            'fouls' => 0,
            'fieldGoalsMade' => 0,
            'fieldGoalsAttempted' => 0,
            'threePointersMade' => 0,
            'threePointersAttempted' => 0,
            'freeThrowsMade' => 0,
            'freeThrowsAttempted' => 0,
            'plusMinus' => 0,
        ];
    }

    /**
     * Simulate a single quarter.
     */
    private function simulateQuarter(): void
    {
        $this->timeRemaining = $this->currentQuarter <= 4 ? self::QUARTER_LENGTH_MINUTES : 5.0;
        $possessionTeam = rand(0, 1) === 0 ? 'home' : 'away';
        $minutesSinceLastRotation = 0;

        while ($this->timeRemaining > 0) {
            // Realistic possession time: 10-24 seconds = 0.17 to 0.4 minutes
            // This gives ~30-70 possessions per quarter per team combined
            $possessionTime = rand(10, 24) / 60; // Convert seconds to minutes

            if ($possessionTime > $this->timeRemaining) {
                $possessionTime = $this->timeRemaining;
            }

            $gotOreb = $this->simulatePossession($possessionTeam, $possessionTime);
            $this->timeRemaining -= $possessionTime;
            $minutesSinceLastRotation += $possessionTime;

            // Switch possession (unless offensive rebound — team keeps ball)
            if (!$gotOreb) {
                $possessionTeam = $possessionTeam === 'home' ? 'away' : 'home';
            }

            // Rotate players every ~2 minutes of game time
            if ($minutesSinceLastRotation >= 2) {
                $this->rotatePlayers();
                $minutesSinceLastRotation = 0;
            }
        }
    }

    /**
     * Simulate a single possession using play-based system.
     * Returns true if offensive rebound occurred (team keeps possession).
     */
    private function simulatePossession(string $team, float $duration): bool
    {
        $isHome = $team === 'home';
        $offense = $isHome ? $this->homeLineup : $this->awayLineup;
        $defense = $isHome ? $this->awayLineup : $this->homeLineup;
        // Offensive team uses their offensive scheme, defensive team uses their defensive scheme
        $offensiveScheme = $isHome ? $this->homeOffensiveScheme : $this->awayOffensiveScheme;
        $defensiveScheme = $isHome ? $this->awayDefensiveScheme : $this->homeDefensiveScheme;

        // Update minutes for active players
        foreach ($offense as $player) {
            $playerId = $player['id'] ?? null;
            if ($playerId) {
                if ($isHome && isset($this->homeBoxScore[$playerId])) {
                    $this->homeBoxScore[$playerId]['minutes'] += $duration;
                } elseif (!$isHome && isset($this->awayBoxScore[$playerId])) {
                    $this->awayBoxScore[$playerId]['minutes'] += $duration;
                }
            }
        }
        foreach ($defense as $defPlayer) {
            $defPlayerId = $defPlayer['id'] ?? null;
            if ($defPlayerId) {
                if ($isHome && isset($this->awayBoxScore[$defPlayerId])) {
                    $this->awayBoxScore[$defPlayerId]['minutes'] += $duration;
                } elseif (!$isHome && isset($this->homeBoxScore[$defPlayerId])) {
                    $this->homeBoxScore[$defPlayerId]['minutes'] += $duration;
                }
            }
        }

        $this->possessionCount++;

        // Determine if this is a transition opportunity (based on offensive scheme)
        $isTransition = $this->coachingService->getTransitionFrequency($offensiveScheme) > (mt_rand() / mt_getrandmax());

        // Select a play based on team, scheme, and game situation
        $context = [
            'isTransition' => $isTransition,
            'shotClock' => self::SHOT_CLOCK_SECONDS,
            'scoreDifferential' => $isHome ? ($this->homeScore - $this->awayScore) : ($this->awayScore - $this->homeScore),
            'quarter' => $this->currentQuarter,
            'timeRemaining' => $this->timeRemaining,
            'defensiveScheme' => $defensiveScheme, // Pass defensive scheme for future use
        ];

        $play = $this->playService->selectPlay($offense, $defense, $offensiveScheme, $context);

        // Calculate defensive modifiers based on scheme and play
        $defensiveModifiers = $this->coachingService->calculateDefensiveModifiers($defensiveScheme, $play);

        // Execute the play with defensive context
        $playResult = $this->playEngine->executePlay($play, $offense, $defense, $defensiveScheme, $defensiveModifiers);

        // Calculate synergies for this possession (PlayExecutionEngine only tracks individual badges)
        $activatedSynergies = [];
        if (!empty($playResult['shotAttempt'])) {
            $shooterId = $playResult['shotAttempt']['shooter'] ?? null;
            $shooter = null;
            foreach ($offense as $player) {
                if (($player['id'] ?? null) === $shooterId) {
                    $shooter = $player;
                    break;
                }
            }
            if ($shooter) {
                $shotType = match($playResult['shotAttempt']['shotType'] ?? 'paint') {
                    'threePoint' => 'three_pointer',
                    'midRange' => 'mid_range',
                    default => 'paint',
                };
                $synergyResult = $this->calculateSynergyBoostWithActivations($shooter, $offense, $shotType);
                $activatedSynergies = $synergyResult['activatedSynergies'];

                // Track synergies by team for rewards
                if (!empty($activatedSynergies)) {
                    if ($isHome) {
                        $this->homeSynergiesActivated += count($activatedSynergies);
                    } else {
                        $this->awaySynergiesActivated += count($activatedSynergies);
                    }
                }
            }
        }
        $playResult['activatedSynergies'] = $activatedSynergies;

        // Process play result and update stats
        $gotOffensiveRebound = $this->processPlayResult($playResult, $offense, $defense, $isHome);

        // Record play-by-play and animation data (skip for AI-only games)
        if ($this->generateAnimationData) {
            $this->recordPlayByPlay($playResult, $team);

            // Store animation data with running scores and box score snapshot
            if (!empty($playResult['keyframes'])) {
                $this->animationData[] = [
                    'possession_id' => $this->possessionCount,
                    'team' => $team,
                    'quarter' => $this->currentQuarter,
                    'time' => $this->timeRemaining,
                    'play_id' => $playResult['playId'],
                    'play_name' => $playResult['playName'],
                    'duration' => $playResult['duration'],
                    'keyframes' => $playResult['keyframes'],
                    'home_score' => $this->homeScore,
                    'away_score' => $this->awayScore,
                    'box_score' => [
                        'home' => array_values(array_map(fn($s) => $this->formatBoxScoreStats($s), $this->homeBoxScore)),
                        'away' => array_values(array_map(fn($s) => $this->formatBoxScoreStats($s), $this->awayBoxScore)),
                    ],
                    'activated_badges' => $playResult['activatedBadges'] ?? [],
                    'activated_synergies' => $playResult['activatedSynergies'] ?? [],
                ];
            }
        }

        return $gotOffensiveRebound;
    }

    /**
     * Process play result and update box scores.
     * Returns true if an offensive rebound occurred (offense keeps possession).
     */
    private function processPlayResult(array $playResult, array $offense, array $defense, bool $isHome): bool
    {
        $outcome = $playResult['outcome'];
        $points = $playResult['points'] ?? 0;
        $shotAttempt = $playResult['shotAttempt'] ?? null;
        $freeThrows = $playResult['freeThrows'] ?? null;

        // Store scores before update for clutch play tracking
        $prevHomeScore = $this->homeScore;
        $prevAwayScore = $this->awayScore;

        // Update score
        if ($isHome) {
            $this->homeScore += $points;
        } else {
            $this->awayScore += $points;
        }

        // Track clutch plays in final 2 minutes (for game-winner news)
        if ($points > 0 && $this->timeRemaining < 2.0 && $this->currentQuarter >= 4) {
            // Check if this shot changed the lead or tied/broke tie
            $wasTied = $prevHomeScore === $prevAwayScore;
            $nowTied = $this->homeScore === $this->awayScore;
            $leadChanged = ($prevHomeScore > $prevAwayScore) !== ($this->homeScore > $this->awayScore);
            $margin = abs($this->homeScore - $this->awayScore);

            if (($wasTied || $leadChanged || !$nowTied) && $margin <= 3) {
                // Find the shooter from the play result
                $shooter = null;
                $shotType = 'shot';
                if ($shotAttempt) {
                    $shooterId = $shotAttempt['shooter'] ?? null;
                    if ($shooterId) {
                        foreach ($offense as $player) {
                            if (($player['id'] ?? null) === $shooterId) {
                                $shooter = $player;
                                break;
                            }
                        }
                    }
                    $shotType = match($shotAttempt['shotType'] ?? 'midRange') {
                        'threePoint' => 'three-pointer',
                        'layup', 'dunk' => 'layup',
                        default => 'jumper',
                    };
                }

                if ($shooter) {
                    $this->lastClutchPlay = [
                        'player' => $shooter,
                        'shotType' => $shotType,
                        'isHomeTeam' => $isHome,
                        'points' => $points,
                    ];
                }
            }
        }

        // Process shot attempt
        if ($shotAttempt) {
            $shooterId = $shotAttempt['shooter'];
            $boxScore = $isHome ? $this->homeBoxScore : $this->awayBoxScore;

            if (isset($boxScore[$shooterId])) {
                $boxScore[$shooterId]['fieldGoalsAttempted']++;
                $boxScore[$shooterId]['points'] += $shotAttempt['points'] ?? 0;

                if ($shotAttempt['made']) {
                    $boxScore[$shooterId]['fieldGoalsMade']++;
                }

                if ($shotAttempt['shotType'] === 'threePoint') {
                    $boxScore[$shooterId]['threePointersAttempted']++;
                    if ($shotAttempt['made']) {
                        $boxScore[$shooterId]['threePointersMade']++;
                    }
                }

                // Assign assist — chemistry boosts ball movement
                $chemMod = $isHome ? $this->homeChemistryModifier : $this->awayChemistryModifier;
                $assistPct = 65 * (1 + $chemMod);
                if ($shotAttempt['made'] && mt_rand(1, 100) <= $assistPct) {
                    foreach ($offense as $player) {
                        $playerId = $player['id'] ?? null;
                        if ($playerId && $playerId !== $shooterId && isset($boxScore[$playerId])) {
                            $boxScore[$playerId]['assists']++;
                            break;
                        }
                    }
                }

                // Save back
                if ($isHome) {
                    $this->homeBoxScore = $boxScore;
                } else {
                    $this->awayBoxScore = $boxScore;
                }
            }
        }

        // Process free throws
        if ($freeThrows) {
            $shooterId = $shotAttempt['shooter'] ?? null;
            $boxScore = $isHome ? $this->homeBoxScore : $this->awayBoxScore;

            if ($shooterId && isset($boxScore[$shooterId])) {
                $boxScore[$shooterId]['freeThrowsAttempted'] += $freeThrows['attempted'];
                $boxScore[$shooterId]['freeThrowsMade'] += $freeThrows['made'];
                $boxScore[$shooterId]['points'] += $freeThrows['made'];

                if ($isHome) {
                    $this->homeScore += $freeThrows['made'];
                    $this->homeBoxScore = $boxScore;
                } else {
                    $this->awayScore += $freeThrows['made'];
                    $this->awayBoxScore = $boxScore;
                }
            }
        }

        // Handle turnover
        if ($outcome === 'turnover') {
            $ballHandlerRoles = ['ballHandler', 'point', 'passer'];
            $turnoverPlayerId = null;

            foreach ($playResult['roleAssignments'] ?? [] as $role => $playerId) {
                if (in_array($role, $ballHandlerRoles)) {
                    $turnoverPlayerId = $playerId;
                    break;
                }
            }

            $boxScore = $isHome ? $this->homeBoxScore : $this->awayBoxScore;
            if ($turnoverPlayerId && isset($boxScore[$turnoverPlayerId])) {
                $boxScore[$turnoverPlayerId]['turnovers']++;
                if ($isHome) {
                    $this->homeBoxScore = $boxScore;
                } else {
                    $this->awayBoxScore = $boxScore;
                }
            }

            // Chance of steal — opposing chemistry boosts steal rate
            $defChem = $isHome ? $this->awayChemistryModifier : $this->homeChemistryModifier;
            if (mt_rand(1, 100) <= (60 * (1 + $defChem)) && !empty($defense)) {
                $stealer = $defense[array_rand($defense)];
                $stealerId = $stealer['id'] ?? null;
                if ($stealerId) {
                    if ($isHome && isset($this->awayBoxScore[$stealerId])) {
                        $this->awayBoxScore[$stealerId]['steals']++;
                    } elseif (!$isHome && isset($this->homeBoxScore[$stealerId])) {
                        $this->homeBoxScore[$stealerId]['steals']++;
                    }
                }
            }
        }

        // Handle rebound on miss
        $gotOffensiveRebound = false;
        if ($outcome === 'missed' || $outcome === 'offensive_rebound') {
            $gotOffensiveRebound = $this->handleRebound($offense, $defense, $isHome);
        }

        // Handle block
        if ($shotAttempt && ($shotAttempt['blocked'] ?? false)) {
            $blocker = $this->selectBlocker($defense);
            $blockerId = $blocker['id'] ?? null;
            if ($blockerId) {
                if ($isHome && isset($this->awayBoxScore[$blockerId])) {
                    $this->awayBoxScore[$blockerId]['blocks']++;
                } elseif (!$isHome && isset($this->homeBoxScore[$blockerId])) {
                    $this->homeBoxScore[$blockerId]['blocks']++;
                }
            }
        }

        return $gotOffensiveRebound;
    }

    /**
     * Record play-by-play entry.
     */
    private function recordPlayByPlay(array $playResult, string $team): void
    {
        $keyframes = $playResult['keyframes'] ?? [];
        $lastKeyframe = end($keyframes) ?: [];

        $this->playByPlay[] = [
            'possession' => $this->possessionCount,
            'quarter' => $this->currentQuarter,
            'time' => sprintf('%d:%02d', (int)$this->timeRemaining, (int)(($this->timeRemaining - (int)$this->timeRemaining) * 60)),
            'team' => $team,
            'play_name' => $playResult['playName'] ?? 'Play',
            'play_id' => $playResult['playId'] ?? null,
            'outcome' => $playResult['outcome'],
            'points' => $playResult['points'] ?? 0,
            'description' => $lastKeyframe['description'] ?? '',
            'home_score' => $this->homeScore,
            'away_score' => $this->awayScore,
        ];
    }

    /**
     * Select the primary ball handler for this possession.
     */
    private function selectBallHandler(array $lineup): array
    {
        // Return placeholder if lineup is empty
        if (empty($lineup)) {
            return [
                'id' => 'unknown_ball_handler',
                'first_name' => 'Unknown',
                'last_name' => 'Player',
                'position' => 'PG',
                'overall_rating' => 70,
                'attributes' => [],
            ];
        }

        // Weight selection towards higher overall players and guards
        $weights = [];
        foreach ($lineup as $index => $player) {
            $weight = $player['overall_rating'] ?? 70;
            if (in_array($player['position'] ?? 'SG', ['PG', 'SG'])) {
                $weight *= 1.5;
            }
            $weights[$index] = $weight;
        }

        $total = array_sum($weights);
        if ($total <= 0) {
            return $lineup[0];
        }

        $rand = mt_rand(1, (int)$total);
        $running = 0;

        foreach ($weights as $index => $weight) {
            $running += $weight;
            if ($rand <= $running) {
                return $lineup[$index];
            }
        }

        return $lineup[0];
    }

    /**
     * Get the defender matching up against the ball handler.
     */
    private function getMatchingDefender(array $ballHandler, array $defense): array
    {
        // Return placeholder if defense is empty
        if (empty($defense)) {
            return [
                'id' => 'unknown_defender',
                'first_name' => 'Unknown',
                'last_name' => 'Defender',
                'position' => $ballHandler['position'] ?? 'SF',
                'overall_rating' => 70,
                'attributes' => [],
            ];
        }

        $handlerPosition = $ballHandler['position'] ?? 'SF';
        foreach ($defense as $defender) {
            if (($defender['position'] ?? '') === $handlerPosition) {
                return $defender;
            }
        }
        return $defense[0];
    }

    /**
     * Determine what type of play will be run.
     */
    private function determinePlayType(array $player): string
    {
        $tendencies = $player['tendencies'] ?? [];
        $shotSelection = $tendencies['shotSelection'] ?? ['threePoint' => 0.33, 'midRange' => 0.33, 'paint' => 0.34];

        $rand = mt_rand(1, 100) / 100;

        // Small chance of turnover
        if ($rand < 0.12) {
            return 'turnover';
        }

        $rand = mt_rand(1, 100) / 100;

        if ($rand < $shotSelection['threePoint']) {
            return 'three_pointer';
        } elseif ($rand < $shotSelection['threePoint'] + $shotSelection['midRange']) {
            return 'mid_range';
        } else {
            return 'paint';
        }
    }

    /**
     * Execute a play and determine the outcome.
     */
    private function executePlay(array $shooter, array $defender, string $playType, array $offense, array $defense, bool $isHome): array
    {
        if ($isHome) {
            $boxScore = &$this->homeBoxScore;
            $defBoxScore = &$this->awayBoxScore;
        } else {
            $boxScore = &$this->awayBoxScore;
            $defBoxScore = &$this->homeBoxScore;
        }

        if ($playType === 'turnover') {
            $boxScore[$shooter['id']]['turnovers']++;

            // Chance of steal — opposing team chemistry boosts steal rate
            $defChemistry = $isHome ? $this->awayChemistryModifier : $this->homeChemistryModifier;
            $stealChance = 60 * (1 + $defChemistry);
            if (mt_rand(1, 100) <= $stealChance) {
                $stealer = $defense[array_rand($defense)];
                $defBoxScore[$stealer['id']]['steals']++;
            }

            return ['outcome' => 'turnover', 'player' => $shooter];
        }

        // Calculate shot success probability
        $shootingAttr = $shooter['attributes']['offense'] ?? [];
        $defenseAttr = $defender['attributes']['defense'] ?? [];
        $physicalAttr = $shooter['attributes']['physical'] ?? [];

        $basePercentage = $this->getBasePercentage($playType, $shootingAttr);
        $contestLevel = $this->calculateContestLevel($shooter, $defender, $playType);
        $badgeResult = $this->calculateBadgeBoostWithActivations($shooter, $playType, $offense);
        $badgeBoost = $badgeResult['boost'];
        $activatedBadges = $badgeResult['activatedBadges'];
        $activatedSynergies = $badgeResult['activatedSynergies'];
        $fatigueModifier = $this->calculateFatigueModifier($shooter);

        $chemistryMod = $isHome ? $this->homeChemistryModifier : $this->awayChemistryModifier;
        $finalPercentage = $basePercentage * (1 - $contestLevel * 0.3) * (1 + $badgeBoost) * $fatigueModifier * (1 + $chemistryMod);
        $finalPercentage = max(0.15, min(0.85, $finalPercentage)); // Clamp between 15% and 85%

        $made = mt_rand(1, 100) <= ($finalPercentage * 100);

        // Determine if there was an assist — chemistry boosts ball movement
        $assister = null;
        $assistChance = 60 * (1 + $chemistryMod);
        if ($made && mt_rand(1, 100) <= $assistChance) {
            foreach ($offense as $player) {
                if ($player['id'] !== $shooter['id']) {
                    $assister = $player;
                    break;
                }
            }
        }

        // Update stats
        $points = 0;
        if ($playType === 'three_pointer') {
            $boxScore[$shooter['id']]['threePointersAttempted']++;
            $boxScore[$shooter['id']]['fieldGoalsAttempted']++;
            if ($made) {
                $boxScore[$shooter['id']]['threePointersMade']++;
                $boxScore[$shooter['id']]['fieldGoalsMade']++;
                $points = 3;
            }
        } elseif ($playType === 'mid_range') {
            $boxScore[$shooter['id']]['fieldGoalsAttempted']++;
            if ($made) {
                $boxScore[$shooter['id']]['fieldGoalsMade']++;
                $points = 2;
            }
        } else { // paint
            $boxScore[$shooter['id']]['fieldGoalsAttempted']++;
            if ($made) {
                $boxScore[$shooter['id']]['fieldGoalsMade']++;
                $points = 2;

                // Check for and-one
                if (mt_rand(1, 100) <= 15) {
                    $boxScore[$shooter['id']]['freeThrowsAttempted']++;
                    if (mt_rand(1, 100) <= 75) {
                        $boxScore[$shooter['id']]['freeThrowsMade']++;
                        $points++;
                    }
                }
            } else {
                // Chance of foul on miss in the paint
                if (mt_rand(1, 100) <= 20) {
                    $fts = 2;
                    $boxScore[$shooter['id']]['freeThrowsAttempted'] += $fts;
                    $ftPct = ($shootingAttr['layup'] ?? 70) / 100 * 0.9;
                    for ($i = 0; $i < $fts; $i++) {
                        if (mt_rand(1, 100) <= ($ftPct * 100)) {
                            $boxScore[$shooter['id']]['freeThrowsMade']++;
                            $points++;
                        }
                    }
                }
            }
        }

        // Update points
        $boxScore[$shooter['id']]['points'] += $points;
        if ($isHome) {
            $this->homeScore += $points;
        } else {
            $this->awayScore += $points;
        }

        // Assist
        if ($assister && $made && $points > 0) {
            $boxScore[$assister['id']]['assists']++;
        }

        // Rebound on miss
        if (!$made && $points === 0) {
            $this->handleRebound($offense, $defense, $isHome);
        }

        // Check for block
        if (!$made && mt_rand(1, 100) <= 8) {
            $blocker = $this->selectBlocker($defense);
            $defBoxScore[$blocker['id']]['blocks']++;
        }

        return [
            'outcome' => $made ? 'made' : 'missed',
            'playType' => $playType,
            'player' => $shooter,
            'points' => $points,
            'assister' => $assister,
            'activatedBadges' => $activatedBadges,
            'activatedSynergies' => $activatedSynergies,
        ];
    }

    /**
     * Get base shooting percentage for play type.
     * Note: Base percentages boosted ~15% from original NBA averages for better game flow.
     */
    private function getBasePercentage(string $playType, array $shootingAttr): float
    {
        // Boosted base percentages for more exciting gameplay:
        // 3PT: ~40% effective, scale from 32% (50 rating) to 50% (99 rating)
        // Mid-range: ~48% effective, scale from 40% (50 rating) to 58% (99 rating)
        // Paint: ~68% effective, scale from 58% (50 rating) to 78% (99 rating)
        return match ($playType) {
            'three_pointer' => 0.32 + (($shootingAttr['threePoint'] ?? 70) / 100) * 0.18,
            'mid_range' => 0.40 + (($shootingAttr['midRange'] ?? 70) / 100) * 0.18,
            'paint' => 0.58 + (($shootingAttr['layup'] ?? 70) / 100) * 0.20,
            default => 0.46,
        };
    }

    /**
     * Calculate how contested the shot is.
     */
    private function calculateContestLevel(array $shooter, array $defender, string $playType): float
    {
        $defenseAttr = $defender['attributes']['defense'] ?? [];
        $shooterPhysical = $shooter['attributes']['physical'] ?? [];

        $defenseRating = match ($playType) {
            'three_pointer', 'mid_range' => $defenseAttr['perimeterD'] ?? 70,
            'paint' => $defenseAttr['interiorD'] ?? 70,
            default => 70,
        };

        // Speed and quickness help create separation
        $separation = ($shooterPhysical['speed'] ?? 70) + ($shooterPhysical['acceleration'] ?? 70);
        $separation = $separation / 200; // Normalize to 0-1

        $contest = ($defenseRating / 100) * (1 - $separation * 0.3);

        return max(0, min(1, $contest));
    }

    /**
     * Calculate badge boost for the shot.
     */
    private function calculateBadgeBoost(array $shooter, string $playType, array $teammates): float
    {
        $result = $this->calculateBadgeBoostWithActivations($shooter, $playType, $teammates);
        return $result['boost'];
    }

    /**
     * Calculate badge boost and return activated badges/synergies for animation.
     */
    private function calculateBadgeBoostWithActivations(array $shooter, string $playType, array $teammates): array
    {
        $badges = $shooter['badges'] ?? [];
        $boost = 0;
        $activatedBadges = [];
        $activatedSynergies = [];

        foreach ($badges as $badge) {
            $badgeId = $badge['id'];
            $level = $badge['level'];

            if (!isset($this->badgeDefinitions[$badgeId])) {
                continue;
            }

            $effects = $this->badgeDefinitions[$badgeId]['effects'][$level] ?? [];
            $badgeBoost = 0;

            // Apply relevant badge effects based on play type
            if ($playType === 'three_pointer') {
                $badgeBoost += $effects['catchShootBoost'] ?? 0;
                $badgeBoost += $effects['cornerThreeBoost'] ?? 0;
                $badgeBoost += $effects['deepRangeBoost'] ?? 0;
                $badgeBoost += $effects['contestReduction'] ?? 0;
            } elseif ($playType === 'mid_range') {
                $badgeBoost += $effects['movingShotBoost'] ?? 0;
                $badgeBoost += $effects['contestReduction'] ?? 0;
            } elseif ($playType === 'paint') {
                $badgeBoost += $effects['contestedLayupBoost'] ?? 0;
                $badgeBoost += $effects['contactFinishBoost'] ?? 0;
                $badgeBoost += $effects['floaterBoost'] ?? 0;
                $badgeBoost += $effects['giantSlayerBoost'] ?? 0;
            }

            if ($badgeBoost > 0) {
                $boost += $badgeBoost;
                $badgeDef = $this->badgeDefinitions[$badgeId];
                $activatedBadges[] = [
                    'id' => $badgeId,
                    'name' => $badgeDef['name'] ?? $badgeId,
                    'level' => $level,
                    'playerId' => $shooter['id'],
                    'playerName' => ($shooter['firstName'] ?? $shooter['first_name'] ?? '') . ' ' . ($shooter['lastName'] ?? $shooter['last_name'] ?? ''),
                ];
            }
        }

        // Check for badge synergies with teammates
        $synergyResult = $this->calculateSynergyBoostWithActivations($shooter, $teammates, $playType);
        $boost += $synergyResult['boost'];
        $activatedSynergies = $synergyResult['activatedSynergies'];

        return [
            'boost' => $boost,
            'activatedBadges' => $activatedBadges,
            'activatedSynergies' => $activatedSynergies,
        ];
    }

    /**
     * Calculate synergy boost from teammates' badges.
     */
    private function calculateSynergyBoost(array $shooter, array $teammates, string $playType): float
    {
        $result = $this->calculateSynergyBoostWithActivations($shooter, $teammates, $playType);
        return $result['boost'];
    }

    /**
     * Calculate synergy boost and return activated synergies for animation.
     */
    private function calculateSynergyBoostWithActivations(array $shooter, array $teammates, string $playType): array
    {
        $boost = 0;
        $activatedSynergies = [];
        $shooterBadgeIds = array_column($shooter['badges'] ?? [], 'id');

        foreach ($this->badgeSynergies as $synergy) {
            // Check if shooter has one of the synergy badges
            if (!in_array($synergy['badge1_id'], $shooterBadgeIds) && !in_array($synergy['badge2_id'], $shooterBadgeIds)) {
                continue;
            }

            $shooterBadge = in_array($synergy['badge1_id'], $shooterBadgeIds)
                ? $synergy['badge1_id']
                : $synergy['badge2_id'];
            $requiredBadge = in_array($synergy['badge1_id'], $shooterBadgeIds)
                ? $synergy['badge2_id']
                : $synergy['badge1_id'];

            // Check if any teammate has the other badge
            foreach ($teammates as $teammate) {
                if ($teammate['id'] === $shooter['id']) continue;

                $teammateBadgeIds = array_column($teammate['badges'] ?? [], 'id');
                if (in_array($requiredBadge, $teammateBadgeIds)) {
                    $effect = $synergy['effect'] ?? [];
                    $boostValues = $effect['boost'] ?? [];

                    // Sum shot-related boosts for the return value
                    $synergyBoost = 0;
                    $synergyBoost += $boostValues['shotPercentage'] ?? 0;
                    $synergyBoost += $boostValues['rollerFinishing'] ?? 0;
                    $boost += $synergyBoost;

                    // Always record the synergy activation (badges matched)
                    $activatedSynergies[] = [
                        'synergy_name' => $synergy['synergy_name'] ?? 'synergy',
                        'badge1' => $shooterBadge,
                        'badge2' => $requiredBadge,
                        'effect' => $synergy['effect_type'] ?? $synergy['synergy_name'] ?? 'synergy',
                        'player1' => [
                            'id' => $shooter['id'],
                            'name' => ($shooter['firstName'] ?? $shooter['first_name'] ?? '') . ' ' . ($shooter['lastName'] ?? $shooter['last_name'] ?? ''),
                        ],
                        'player2' => [
                            'id' => $teammate['id'],
                            'name' => ($teammate['firstName'] ?? $teammate['first_name'] ?? '') . ' ' . ($teammate['lastName'] ?? $teammate['last_name'] ?? ''),
                        ],
                    ];
                    break;
                }
            }
        }

        return [
            'boost' => $boost,
            'activatedSynergies' => $activatedSynergies,
        ];
    }

    /**
     * Calculate fatigue modifier.
     */
    private function calculateFatigueModifier(array $player): float
    {
        $stamina = $player['attributes']['physical']['stamina'] ?? 70;
        $fatigue = $player['fatigue'] ?? 0;

        // Higher stamina reduces fatigue impact
        $fatigueImpact = ($fatigue / 100) * (1 - $stamina / 200);

        return 1 - $fatigueImpact * 0.25;
    }

    /**
     * Calculate chemistry modifier from average team morale.
     * Baseline morale = 80. Below 80 = penalty, above 80 = bonus.
     * Range: -3% at morale 0 to +3% at morale 100.
     */
    private function calculateChemistryModifier(float $avgMorale): float
    {
        return max(-0.03, min(0.03, ($avgMorale - 80) / 80 * 0.03));
    }

    /**
     * Handle rebound after a missed shot.
     * Returns true if offensive rebound (offense keeps possession).
     */
    private function handleRebound(array $offense, array $defense, bool $isHome): bool
    {
        if ($isHome) {
            $offBoxScore = &$this->homeBoxScore;
            $defBoxScore = &$this->awayBoxScore;
        } else {
            $offBoxScore = &$this->awayBoxScore;
            $defBoxScore = &$this->homeBoxScore;
        }

        // Position multipliers for rebounding opportunity
        $posMult = ['C' => 1.8, 'PF' => 1.5, 'SF' => 1.1, 'SG' => 0.8, 'PG' => 0.6];

        // Calculate team offensive rebounding strength from actual attributes
        $offRebTotal = 0;
        foreach ($offense as $player) {
            $orebAttr = $player['attributes']['defense']['offensiveRebound'] ?? 40;
            $mult = $posMult[$player['position']] ?? 1.0;
            $offRebTotal += $orebAttr * $mult;
        }

        // Calculate team defensive rebounding strength from actual attributes
        $defRebTotal = 0;
        foreach ($defense as $player) {
            $drebAttr = $player['attributes']['defense']['defensiveRebound'] ?? 50;
            $mult = $posMult[$player['position']] ?? 1.0;
            $defRebTotal += $drebAttr * $mult;
        }

        // Defense has inherent positioning advantage (box out)
        // Factor of 2.5 produces ~27% OREB rate for average matchups (NBA average)
        $defAdvantage = 2.5;
        $totalWeighted = $offRebTotal + $defRebTotal * $defAdvantage;
        if ($totalWeighted <= 0) $totalWeighted = 1;

        $offRebChance = $offRebTotal / $totalWeighted;
        $offRebChance = max(0.15, min(0.40, $offRebChance));

        $isOffensiveRebound = mt_rand(1, 1000) <= (int)($offRebChance * 1000);

        // Select the specific rebounder using their rebound attributes
        $rebounders = $isOffensiveRebound ? $offense : $defense;
        $boxScore = $isOffensiveRebound ? $offBoxScore : $defBoxScore;

        $weights = [];
        foreach ($rebounders as $index => $player) {
            if ($isOffensiveRebound) {
                $rebAttr = $player['attributes']['defense']['offensiveRebound'] ?? 40;
            } else {
                $rebAttr = $player['attributes']['defense']['defensiveRebound'] ?? 50;
            }
            $mult = $posMult[$player['position']] ?? 1.0;
            $weights[$index] = $rebAttr * $mult;
        }

        $total = array_sum($weights);

        if ($total <= 0) {
            $rebounder = reset($rebounders);
            if ($rebounder) {
                $rebounderId = $rebounder['id'] ?? null;
                if ($rebounderId && isset($boxScore[$rebounderId])) {
                    $boxScore[$rebounderId]['rebounds']++;
                    if ($isOffensiveRebound) {
                        $boxScore[$rebounderId]['offensiveRebounds']++;
                    } else {
                        $boxScore[$rebounderId]['defensiveRebounds']++;
                    }
                }
            }
        } else {
            $rand = mt_rand(1, (int)$total);
            $running = 0;

            foreach ($weights as $index => $weight) {
                $running += $weight;
                if ($rand <= $running) {
                    $rebounder = $rebounders[$index];
                    $rebounderId = $rebounder['id'] ?? null;
                    if ($rebounderId && isset($boxScore[$rebounderId])) {
                        $boxScore[$rebounderId]['rebounds']++;
                        if ($isOffensiveRebound) {
                            $boxScore[$rebounderId]['offensiveRebounds']++;
                        } else {
                            $boxScore[$rebounderId]['defensiveRebounds']++;
                        }
                    }
                    break;
                }
            }
        }

        if ($isOffensiveRebound) {
            $offBoxScore = $boxScore;
        } else {
            $defBoxScore = $boxScore;
        }

        // Record offensive rebound in play-by-play
        if ($isOffensiveRebound && $this->generateAnimationData) {
            $rebName = isset($rebounder) ? ($rebounder['first_name'] ?? '') . ' ' . ($rebounder['last_name'] ?? '') : 'Unknown';
            $team = $isHome ? 'home' : 'away';
            $this->playByPlay[] = [
                'possession' => $this->possessionCount,
                'quarter' => $this->currentQuarter,
                'time' => sprintf('%d:%02d', (int)$this->timeRemaining, (int)(($this->timeRemaining - (int)$this->timeRemaining) * 60)),
                'team' => $team,
                'play_name' => 'Offensive Rebound',
                'play_id' => null,
                'outcome' => 'offensive_rebound',
                'points' => 0,
                'description' => "{$rebName} grabs the offensive rebound",
                'home_score' => $this->homeScore,
                'away_score' => $this->awayScore,
            ];
        }

        return $isOffensiveRebound;
    }

    /**
     * Select a player likely to get a block.
     */
    private function selectBlocker(array $defense): array
    {
        // Return placeholder if defense is empty
        if (empty($defense)) {
            return [
                'id' => 'unknown_blocker',
                'first_name' => 'Unknown',
                'last_name' => 'Defender',
                'position' => 'C',
                'attributes' => [],
            ];
        }

        $weights = [];
        foreach ($defense as $index => $player) {
            $blockRating = $player['attributes']['defense']['block'] ?? 50;
            $weights[$index] = $blockRating;
        }

        $total = array_sum($weights);
        if ($total <= 0) {
            return $defense[0];
        }

        $rand = mt_rand(1, (int)$total);
        $running = 0;

        foreach ($weights as $index => $weight) {
            $running += $weight;
            if ($rand <= $running) {
                return $defense[$index];
            }
        }

        return $defense[0];
    }

    /**
     * Rotate players using the substitution engine.
     */
    private function rotatePlayers(): void
    {
        // Home team
        $isUserHomeLive = $this->isLiveGame && $this->homeTeam->id === $this->userTeamId;
        $homeResult = $this->substitutionService->evaluateSubstitutions(
            $this->homeLineup, $this->homePlayers, $this->homeBoxScore,
            $this->homeTargetMinutes, $this->homeSubStrategy,
            $this->currentQuarter, $this->timeRemaining,
            $this->homeScore - $this->awayScore, $isUserHomeLive
        );
        if ($homeResult) {
            $this->homeLineup = $this->rebuildLineupFromIds($homeResult, $this->homePlayers);
        }

        // Away team
        $isUserAwayLive = $this->isLiveGame && $this->awayTeam->id === $this->userTeamId;
        $awayResult = $this->substitutionService->evaluateSubstitutions(
            $this->awayLineup, $this->awayPlayers, $this->awayBoxScore,
            $this->awayTargetMinutes, $this->awaySubStrategy,
            $this->currentQuarter, $this->timeRemaining,
            $this->awayScore - $this->homeScore, $isUserAwayLive
        );
        if ($awayResult) {
            $this->awayLineup = $this->rebuildLineupFromIds($awayResult, $this->awayPlayers);
        }
    }

    /**
     * Finalize game and return results.
     */
    private function finalizeGame(Game $game): array
    {
        // Convert box score keys to snake_case for frontend
        $homeBoxScoreFormatted = array_map(fn($stats) => $this->formatBoxScoreStats($stats), array_values($this->homeBoxScore));
        $awayBoxScoreFormatted = array_map(fn($stats) => $this->formatBoxScoreStats($stats), array_values($this->awayBoxScore));

        // Update game record
        $game->update([
            'home_score' => $this->homeScore,
            'away_score' => $this->awayScore,
            'is_complete' => true,
            'box_score' => [
                'home' => $homeBoxScoreFormatted,
                'away' => $awayBoxScoreFormatted,
                'quarter_scores' => $this->quarterScores,
            ],
        ]);

        // Process player evolution (fatigue, injuries, micro-development, morale)
        $this->evolutionService->processPostGame($game->campaign, $game, [
            'home' => $this->homeBoxScore,
            'away' => $this->awayBoxScore,
        ]);

        // Generate news for game-winner and OT thrillers
        $this->generateGameNews($game->campaign);

        return [
            'game_id' => $game->id,
            'home_team' => $this->homeTeam->name,
            'away_team' => $this->awayTeam->name,
            'home_score' => $this->homeScore,
            'away_score' => $this->awayScore,
            'winner' => $this->homeScore > $this->awayScore ? 'home' : 'away',
            'box_score' => [
                'home' => $homeBoxScoreFormatted,
                'away' => $awayBoxScoreFormatted,
            ],
            'quarter_scores' => $this->quarterScores,
            'play_by_play' => $this->playByPlay,
            'animation_data' => [
                'possessions' => $this->animationData,
                'total_possessions' => $this->possessionCount,
                'quarter_end_indices' => $this->quarterEndPossessions,
            ],
        ];
    }

    /**
     * Format box score stats with snake_case keys for frontend.
     */
    private function formatBoxScoreStats(array $stats): array
    {
        return [
            'player_id' => $stats['playerId'],
            'name' => $stats['name'],
            'position' => $stats['position'],
            'secondary_position' => $stats['secondary_position'] ?? null,
            'overall_rating' => $stats['overall_rating'] ?? $stats['overallRating'] ?? null,
            'fatigue' => $stats['fatigue'] ?? 0,
            'is_injured' => $stats['is_injured'] ?? $stats['isInjured'] ?? false,
            'minutes' => round($stats['minutes']),
            'points' => $stats['points'],
            'rebounds' => $stats['rebounds'] ?? ($stats['offensiveRebounds'] + $stats['defensiveRebounds']),
            'offensive_rebounds' => $stats['offensiveRebounds'],
            'defensive_rebounds' => $stats['defensiveRebounds'],
            'assists' => $stats['assists'],
            'steals' => $stats['steals'],
            'blocks' => $stats['blocks'],
            'turnovers' => $stats['turnovers'],
            'fouls' => $stats['fouls'],
            'fgm' => $stats['fieldGoalsMade'],
            'fga' => $stats['fieldGoalsAttempted'],
            'fg3m' => $stats['threePointersMade'],
            'fg3a' => $stats['threePointersAttempted'],
            'ftm' => $stats['freeThrowsMade'],
            'fta' => $stats['freeThrowsAttempted'],
            'plus_minus' => $stats['plusMinus'],
        ];
    }

    /**
     * Normalize player data from either DB (snake_case) or JSON (camelCase) format.
     * Simulation expects snake_case keys matching Player model structure.
     */
    private function normalizePlayerForSimulation(array $player): array
    {
        // If already in snake_case format (from DB), ensure 'id' exists
        if (isset($player['first_name'])) {
            // Generate fallback ID if missing
            if (empty($player['id'])) {
                $player['id'] = strtolower(($player['first_name'] ?? 'unknown') . '-' . ($player['last_name'] ?? 'player') . '-' . uniqid());
            }
            return $player;
        }

        // Generate fallback ID if missing
        $firstName = $player['firstName'] ?? '';
        $lastName = $player['lastName'] ?? '';
        $playerId = $player['id'] ?? null;

        if (empty($playerId)) {
            $playerId = strtolower(($firstName ?: 'unknown') . '-' . ($lastName ?: 'player') . '-' . uniqid());
        }

        // Convert from JSON camelCase to snake_case format
        return [
            'id' => $playerId,
            'first_name' => $firstName,
            'last_name' => $lastName,
            'position' => $player['position'] ?? 'SG',
            'secondary_position' => $player['secondaryPosition'] ?? null,
            'jersey_number' => $player['jerseyNumber'] ?? 0,
            'height_inches' => $player['heightInches'] ?? 78,
            'weight_lbs' => $player['weightLbs'] ?? 200,
            'overall_rating' => $player['overallRating'] ?? 70,
            'potential_rating' => $player['potentialRating'] ?? 70,
            'attributes' => $player['attributes'] ?? [],
            'badges' => $player['badges'] ?? [],
            'tendencies' => $player['tendencies'] ?? [],
            'fatigue' => $player['fatigue'] ?? 0,
            'is_injured' => $player['isInjured'] ?? false,
        ];
    }

    // =====================================================
    // QUARTER-BY-QUARTER SIMULATION METHODS
    // =====================================================

    /**
     * Start a new game and simulate the first quarter only.
     * Returns Q1 results and serialized state for continuation.
     *
     * @param Campaign $campaign
     * @param array $gameData
     * @param Team $homeTeam
     * @param Team $awayTeam
     * @param array|null $userLineup Optional array of player IDs for the user's starting lineup
     * @param array $coachingAdjustments Optional coaching style adjustments (offensiveStyle, defensiveStyle)
     */
    public function startGame(Campaign $campaign, array $gameData, Team $homeTeam, Team $awayTeam, ?array $userLineup = null, array $coachingAdjustments = []): array
    {
        // Initialize the game (loads players, creates lineups, resets state)
        $this->initializeGameFromData($campaign, $gameData, $homeTeam, $awayTeam, $userLineup);

        // Live game: user controls their own substitutions
        $this->isLiveGame = true;

        // Apply initial coaching adjustments if provided
        if (!empty($coachingAdjustments)) {
            $this->applyAdjustments($coachingAdjustments);
        }

        // Validate that we have valid lineups
        if (empty($this->homeLineup) || empty($this->awayLineup)) {
            throw new \RuntimeException(
                "Cannot simulate game: missing player lineup. " .
                "Home lineup count: " . count($this->homeLineup) . ", " .
                "Away lineup count: " . count($this->awayLineup) . ". " .
                "Home players: " . count($this->homePlayers) . ", " .
                "Away players: " . count($this->awayPlayers) . ". " .
                "Home team: " . ($this->homeTeam->abbreviation ?? 'unknown') . ", " .
                "Away team: " . ($this->awayTeam->abbreviation ?? 'unknown') . ", " .
                "Campaign: " . ($this->currentCampaign->id ?? 'unknown')
            );
        }

        // Track score at start of quarter
        $homeScoreAtQuarterStart = 0;
        $awayScoreAtQuarterStart = 0;

        // Simulate only Q1
        $this->currentQuarter = 1;
        $this->timeRemaining = self::QUARTER_LENGTH_MINUTES;
        $this->simulateQuarterOnly();

        // Record Q1 scores
        $this->quarterScores['home'][] = $this->homeScore - $homeScoreAtQuarterStart;
        $this->quarterScores['away'][] = $this->awayScore - $awayScoreAtQuarterStart;
        $this->quarterEndPossessions[] = $this->possessionCount;

        return [
            'quarterResult' => $this->buildQuarterResult(1),
            'gameState' => $this->serializeState(),
        ];
    }

    /**
     * Continue a game from saved state, simulate the next quarter.
     * Accepts optional adjustments for lineup and coaching style changes.
     */
    public function continueGame(array $gameState, ?array $adjustments = null): array
    {
        // Restore the game state
        $this->deserializeState($gameState);

        // Apply user adjustments if provided
        $this->applyAdjustments($adjustments);

        // Determine which quarter to simulate
        $nextQuarter = count($gameState['completedQuarters']) + 1;

        // Track score at start of quarter
        $homeScoreAtQuarterStart = $this->homeScore;
        $awayScoreAtQuarterStart = $this->awayScore;

        // Set up for next quarter
        $this->currentQuarter = $nextQuarter;
        $this->timeRemaining = $nextQuarter <= 4 ? self::QUARTER_LENGTH_MINUTES : 5.0; // OT is 5 min

        // Simulate the quarter
        $this->simulateQuarterOnly();

        // Record quarter scores (points scored THIS quarter only)
        $this->quarterScores['home'][] = $this->homeScore - $homeScoreAtQuarterStart;
        $this->quarterScores['away'][] = $this->awayScore - $awayScoreAtQuarterStart;
        $this->quarterEndPossessions[] = $this->possessionCount;

        // Check if game is complete
        $isComplete = $this->isGameComplete();

        return [
            'quarterResult' => $this->buildQuarterResult($nextQuarter),
            'gameState' => $isComplete ? null : $this->serializeState(),
            'isComplete' => $isComplete,
            'finalResult' => $isComplete ? $this->buildFinalResult() : null,
        ];
    }

    /**
     * Simulate the remainder of an in-progress game to completion.
     * Loops continueGame() until the game is complete.
     */
    public function simToEnd(array $gameState): array
    {
        $result = null;
        while (true) {
            $result = $this->continueGame($gameState);
            if ($result['isComplete']) {
                return $result;
            }
            $gameState = $result['gameState'];
        }
    }

    /**
     * Simulate a single quarter without resetting timeRemaining.
     * timeRemaining and currentQuarter must be set before calling.
     */
    private function simulateQuarterOnly(): void
    {
        $possessionTeam = rand(0, 1) === 0 ? 'home' : 'away';
        $minutesSinceLastRotation = 0;

        while ($this->timeRemaining > 0) {
            // Realistic possession time: 10-24 seconds = 0.17 to 0.4 minutes
            $possessionTime = rand(10, 24) / 60;

            if ($possessionTime > $this->timeRemaining) {
                $possessionTime = $this->timeRemaining;
            }

            $gotOreb = $this->simulatePossession($possessionTeam, $possessionTime);
            $this->timeRemaining -= $possessionTime;
            $minutesSinceLastRotation += $possessionTime;

            // Switch possession (unless offensive rebound — team keeps ball)
            if (!$gotOreb) {
                $possessionTeam = $possessionTeam === 'home' ? 'away' : 'home';
            }

            // Rotate players every ~2 minutes of game time
            if ($minutesSinceLastRotation >= 2) {
                $this->rotatePlayers();
                $minutesSinceLastRotation = 0;
            }
        }
    }

    /**
     * Serialize current game state for storage between quarters.
     * Uses compact player data to reduce storage size.
     */
    public function serializeState(): array
    {
        return [
            'version' => 4, // Bumped for substitution system
            'status' => 'in_progress',
            'currentQuarter' => $this->currentQuarter,
            'completedQuarters' => range(1, $this->currentQuarter),
            'homeScore' => $this->homeScore,
            'awayScore' => $this->awayScore,
            'quarterScores' => $this->quarterScores,
            'homeBoxScore' => $this->homeBoxScore,
            'awayBoxScore' => $this->awayBoxScore,
            'homeLineup' => array_map(fn($p) => $p['id'], $this->homeLineup),
            'awayLineup' => array_map(fn($p) => $p['id'], $this->awayLineup),
            'homePlayers' => array_map([$this, 'compactPlayerData'], $this->homePlayers),
            'awayPlayers' => array_map([$this, 'compactPlayerData'], $this->awayPlayers),
            'homeOffensiveScheme' => $this->homeOffensiveScheme,
            'homeDefensiveScheme' => $this->homeDefensiveScheme,
            'awayOffensiveScheme' => $this->awayOffensiveScheme,
            'awayDefensiveScheme' => $this->awayDefensiveScheme,
            'possessionCount' => $this->possessionCount,
            'quarterEndPossessions' => $this->quarterEndPossessions,
            'homeTeamId' => $this->homeTeam->id,
            'awayTeamId' => $this->awayTeam->id,
            'homeSynergiesActivated' => $this->homeSynergiesActivated,
            'awaySynergiesActivated' => $this->awaySynergiesActivated,
            // Substitution state
            'homeTargetMinutes' => $this->homeTargetMinutes,
            'awayTargetMinutes' => $this->awayTargetMinutes,
            'homeSubStrategy' => $this->homeSubStrategy,
            'awaySubStrategy' => $this->awaySubStrategy,
            'homeStarterIds' => $this->homeStarterIds,
            'awayStarterIds' => $this->awayStarterIds,
            'isLiveGame' => $this->isLiveGame,
            'userTeamId' => $this->userTeamId,
            'lastUpdatedAt' => now()->toIso8601String(),
        ];
    }

    /**
     * Compact player data for serialization - removes fields not needed for mid-game simulation.
     */
    private function compactPlayerData(array $player): array
    {
        return [
            'id' => $player['id'],
            'first_name' => $player['first_name'],
            'last_name' => $player['last_name'],
            'position' => $player['position'],
            'secondary_position' => $player['secondary_position'] ?? null,
            'overall_rating' => $player['overall_rating'],
            'attributes' => $player['attributes'] ?? [],
            'badges' => $player['badges'] ?? [],
            'tendencies' => $player['tendencies'] ?? [],
            'fatigue' => $player['fatigue'] ?? 0,
        ];
    }

    /**
     * Restore game state from serialized data.
     */
    public function deserializeState(array $state): void
    {
        $this->homeScore = $state['homeScore'];
        $this->awayScore = $state['awayScore'];
        $this->quarterScores = $state['quarterScores'];
        $this->homeBoxScore = $state['homeBoxScore'];
        $this->awayBoxScore = $state['awayBoxScore'];
        $this->homePlayers = $state['homePlayers'];
        $this->awayPlayers = $state['awayPlayers'];

        // Handle both old format (single scheme) and new format (offensive/defensive)
        if (isset($state['homeOffensiveScheme'])) {
            // New format (version 3+)
            $this->homeOffensiveScheme = $state['homeOffensiveScheme'];
            $this->homeDefensiveScheme = $state['homeDefensiveScheme'];
            $this->awayOffensiveScheme = $state['awayOffensiveScheme'];
            $this->awayDefensiveScheme = $state['awayDefensiveScheme'];
        } else {
            // Old format (version 2) - migrate to new structure
            $this->homeOffensiveScheme = $state['homeCoachingScheme'] ?? 'balanced';
            $this->homeDefensiveScheme = 'man';
            $this->awayOffensiveScheme = $state['awayCoachingScheme'] ?? 'balanced';
            $this->awayDefensiveScheme = 'man';
        }

        $this->possessionCount = $state['possessionCount'];
        $this->quarterEndPossessions = $state['quarterEndPossessions'];
        $this->currentQuarter = $state['currentQuarter'];

        // Rebuild lineups from IDs
        $this->homeLineup = $this->rebuildLineupFromIds($state['homeLineup'], $this->homePlayers);
        $this->awayLineup = $this->rebuildLineupFromIds($state['awayLineup'], $this->awayPlayers);

        // Reload team models
        $this->homeTeam = Team::find($state['homeTeamId']);
        $this->awayTeam = Team::find($state['awayTeamId']);

        // Restore synergy counters
        $this->homeSynergiesActivated = $state['homeSynergiesActivated'] ?? 0;
        $this->awaySynergiesActivated = $state['awaySynergiesActivated'] ?? 0;

        // Restore substitution state
        $this->homeTargetMinutes = $state['homeTargetMinutes'] ?? [];
        $this->awayTargetMinutes = $state['awayTargetMinutes'] ?? [];
        $this->homeSubStrategy = $state['homeSubStrategy'] ?? 'staggered';
        $this->awaySubStrategy = $state['awaySubStrategy'] ?? 'staggered';
        $this->homeStarterIds = $state['homeStarterIds'] ?? [];
        $this->awayStarterIds = $state['awayStarterIds'] ?? [];
        $this->isLiveGame = $state['isLiveGame'] ?? false;
        $this->userTeamId = $state['userTeamId'] ?? null;

        // Reset per-quarter data
        $this->animationData = [];
        $this->playByPlay = [];
    }

    /**
     * Rebuild lineup array from player IDs.
     */
    private function rebuildLineupFromIds(array $playerIds, array $players): array
    {
        $playerMap = [];
        foreach ($players as $player) {
            $playerMap[$player['id']] = $player;
        }

        $lineup = [];
        foreach ($playerIds as $id) {
            if (isset($playerMap[$id])) {
                $lineup[] = $playerMap[$id];
            }
        }

        return $lineup;
    }

    /**
     * Apply user adjustments (lineup, coaching styles) before simulating a quarter.
     * The adjustments are for the user's team, which may be home or away.
     */
    public function applyAdjustments(?array $adjustments): void
    {
        if (!$adjustments) {
            return;
        }

        // Update home lineup if provided
        if (!empty($adjustments['homeLineup'])) {
            $this->homeLineup = $this->rebuildLineupFromIds(
                $adjustments['homeLineup'],
                $this->homePlayers
            );
        }

        // Update away lineup if provided
        if (!empty($adjustments['awayLineup'])) {
            $this->awayLineup = $this->rebuildLineupFromIds(
                $adjustments['awayLineup'],
                $this->awayPlayers
            );
        }

        // Update coaching styles if provided
        // These apply to the user's team - determine which team based on lineup
        $isUserHome = !empty($adjustments['homeLineup']);
        $isUserAway = !empty($adjustments['awayLineup']);

        if (!empty($adjustments['offensiveStyle'])) {
            if ($isUserHome) {
                $this->homeOffensiveScheme = $adjustments['offensiveStyle'];
            } elseif ($isUserAway) {
                $this->awayOffensiveScheme = $adjustments['offensiveStyle'];
            } else {
                // Default to home if no lineup specified (backwards compatibility)
                $this->homeOffensiveScheme = $adjustments['offensiveStyle'];
            }
        }

        if (!empty($adjustments['defensiveStyle'])) {
            if ($isUserHome) {
                $this->homeDefensiveScheme = $adjustments['defensiveStyle'];
            } elseif ($isUserAway) {
                $this->awayDefensiveScheme = $adjustments['defensiveStyle'];
            } else {
                // Default to home if no lineup specified (backwards compatibility)
                $this->homeDefensiveScheme = $adjustments['defensiveStyle'];
            }
        }
    }

    /**
     * Check if game is complete (Q4+ and scores are not tied).
     */
    public function isGameComplete(): bool
    {
        return $this->currentQuarter >= 4 && $this->homeScore !== $this->awayScore;
    }

    /**
     * Build result for a single quarter (for quarter-by-quarter simulation).
     */
    public function buildQuarterResult(int $quarter): array
    {
        $homeBoxScoreFormatted = array_map(
            fn($stats) => $this->formatBoxScoreStats($stats),
            array_values($this->homeBoxScore)
        );
        $awayBoxScoreFormatted = array_map(
            fn($stats) => $this->formatBoxScoreStats($stats),
            array_values($this->awayBoxScore)
        );

        return [
            'quarter' => $quarter,
            'scores' => [
                'home' => $this->homeScore,
                'away' => $this->awayScore,
                'quarterScores' => $this->quarterScores,
            ],
            'animation_data' => [
                'possessions' => $this->animationData,
                'quarter_start_possession' => $quarter > 1
                    ? ($this->quarterEndPossessions[$quarter - 2] ?? 0) + 1
                    : 1,
                'quarter_end_index' => $this->possessionCount,
            ],
            'box_score' => [
                'home' => $homeBoxScoreFormatted,
                'away' => $awayBoxScoreFormatted,
            ],
            'play_by_play' => $this->playByPlay,
        ];
    }

    /**
     * Build final game result (for when quarter-by-quarter game completes).
     */
    public function buildFinalResult(): array
    {
        $homeBoxScoreFormatted = array_map(
            fn($stats) => $this->formatBoxScoreStats($stats),
            array_values($this->homeBoxScore)
        );
        $awayBoxScoreFormatted = array_map(
            fn($stats) => $this->formatBoxScoreStats($stats),
            array_values($this->awayBoxScore)
        );

        return [
            'home_score' => $this->homeScore,
            'away_score' => $this->awayScore,
            'winner' => $this->homeScore > $this->awayScore ? 'home' : 'away',
            'box_score' => [
                'home' => $homeBoxScoreFormatted,
                'away' => $awayBoxScoreFormatted,
            ],
            'quarter_scores' => $this->quarterScores,
            'synergies_activated' => [
                'home' => $this->homeSynergiesActivated,
                'away' => $this->awaySynergiesActivated,
            ],
        ];
    }

    /**
     * Generate news events for notable game outcomes.
     */
    private function generateGameNews(Campaign $campaign): void
    {
        // Generate game-winner news if last clutch play was the difference
        if ($this->lastClutchPlay !== null) {
            $margin = abs($this->homeScore - $this->awayScore);
            $scorerIsWinner = ($this->lastClutchPlay['isHomeTeam'] && $this->homeScore > $this->awayScore) ||
                              (!$this->lastClutchPlay['isHomeTeam'] && $this->awayScore > $this->homeScore);

            // Only generate if the clutch scorer's team won by a close margin
            if ($scorerIsWinner && $margin <= 3) {
                $this->gameNewsService->createGameWinnerNews(
                    $campaign,
                    $this->lastClutchPlay['player'],
                    ['id' => $this->homeTeam->id, 'name' => $this->homeTeam->name],
                    ['id' => $this->awayTeam->id, 'name' => $this->awayTeam->name],
                    $this->homeScore,
                    $this->awayScore,
                    $this->lastClutchPlay['isHomeTeam'],
                    $this->lastClutchPlay['shotType']
                );
            }
        }

        // Generate OT thriller news
        if ($this->currentQuarter > 4) {
            $overtimePeriods = $this->currentQuarter - 4;
            $this->gameNewsService->createOvertimeThrillerNews(
                $campaign,
                ['id' => $this->homeTeam->id, 'name' => $this->homeTeam->name],
                ['id' => $this->awayTeam->id, 'name' => $this->awayTeam->name],
                $this->homeScore,
                $this->awayScore,
                $overtimePeriods
            );
        }
    }
}
