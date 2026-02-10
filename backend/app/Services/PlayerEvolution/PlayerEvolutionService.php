<?php

namespace App\Services\PlayerEvolution;

use App\Models\Campaign;
use App\Models\Game;
use App\Models\Player;
use App\Models\Team;
use App\Services\CampaignPlayerService;
use App\Services\AILineupService;

class PlayerEvolutionService
{
    public function __construct(
        private CampaignPlayerService $playerService,
        private DevelopmentCalculator $development,
        private AttributeAging $aging,
        private InjuryService $injuries,
        private MoraleService $morale,
        private PersonalityEffects $personality,
        private BadgeSynergyService $badgeSynergy,
        private EvolutionNewsService $news,
        private AILineupService $aiLineupService
    ) {}

    /**
     * Process evolution after a game is completed.
     * Called for ALL players who participated (both teams).
     * @deprecated Use processPostGameFromData for JSON-based storage
     */
    public function processPostGame(Campaign $campaign, Game $game, array $boxScores): void
    {
        $isPlayoff = $campaign->currentSeason?->phase === 'playoffs';

        // Process home team
        $this->processTeamPostGame(
            $campaign,
            $game->homeTeam->abbreviation,
            $boxScores['home'] ?? [],
            $game->home_score > $game->away_score,
            $isPlayoff
        );

        // Process away team
        $this->processTeamPostGame(
            $campaign,
            $game->awayTeam->abbreviation,
            $boxScores['away'] ?? [],
            $game->away_score > $game->home_score,
            $isPlayoff
        );
    }

    /**
     * Process evolution after a game using array data (for JSON-based storage).
     * Returns summary of evolution changes for the response.
     */
    public function processPostGameFromData(
        Campaign $campaign,
        array $gameData,
        int $homeScore,
        int $awayScore,
        array $boxScores
    ): array {
        $isPlayoff = $campaign->currentSeason?->phase === 'playoffs';

        // Process home team
        $homeSummary = $this->processTeamPostGame(
            $campaign,
            $gameData['homeTeamAbbreviation'],
            $boxScores['home'] ?? [],
            $homeScore > $awayScore,
            $isPlayoff
        );

        // Process away team
        $awaySummary = $this->processTeamPostGame(
            $campaign,
            $gameData['awayTeamAbbreviation'],
            $boxScores['away'] ?? [],
            $awayScore > $homeScore,
            $isPlayoff
        );

        return [
            'home' => $homeSummary,
            'away' => $awaySummary,
        ];
    }

    /**
     * Process a single team's players after a game.
     * Returns summary of changes for each player.
     */
    private function processTeamPostGame(
        Campaign $campaign,
        string $teamAbbr,
        array $boxScores,
        bool $won,
        bool $isPlayoff
    ): array {
        $roster = $this->playerService->getTeamRoster($campaign->id, $teamAbbr);
        $isUserTeam = $this->isUserTeam($campaign, $teamAbbr);

        // Calculate team streak
        $streak = $this->getTeamStreak($campaign, $teamAbbr);

        // Collect updates for batch saving (for non-user teams)
        $leaguePlayerUpdates = [];

        // Evolution summary for response
        $evolutionSummary = [
            'injuries' => [],
            'development' => [],
            'regression' => [],
            'fatigue_warnings' => [],
            'morale_changes' => [],
            'hot_streaks' => [],
            'cold_streaks' => [],
        ];

        foreach ($boxScores as $stats) {
            // Handle both keyed (by player_id) and indexed arrays
            $playerId = $stats['player_id'] ?? $stats['playerId'] ?? null;
            if (!$playerId) continue;

            $player = $this->findPlayerInRoster($roster, $playerId);
            if (!$player) continue;

            $playerName = $this->getPlayerName($player);
            $oldMorale = $player['personality']['morale'] ?? 80;

            // Update fatigue
            $oldFatigue = $player['fatigue'] ?? 0;
            $player = $this->updateFatigue($player, $stats['minutes'] ?? 0);
            $newFatigue = $player['fatigue'] ?? 0;

            // Fatigue warning if getting high
            if ($newFatigue >= 70 && $oldFatigue < 70) {
                $evolutionSummary['fatigue_warnings'][] = [
                    'player_id' => $playerId,
                    'name' => $playerName,
                    'fatigue' => round($newFatigue),
                ];
            }

            // Check for injury
            $injury = $this->injuries->checkForInjury($player, $stats['minutes'] ?? 0, $isPlayoff);
            if ($injury) {
                $player['is_injured'] = true;
                $player['isInjured'] = true;
                $player['injury_details'] = $injury;
                $player['injuryDetails'] = $injury;

                // Create injury news
                $this->news->createInjuryNews($campaign, $player, $injury);

                // Add to summary
                $evolutionSummary['injuries'][] = [
                    'player_id' => $playerId,
                    'name' => $playerName,
                    'injury_type' => $injury['name'] ?? 'Unknown',
                    'games_out' => $injury['games_remaining'] ?? $injury['gamesRemaining'] ?? 0,
                    'severity' => $injury['severity'] ?? 'minor',
                ];

                // Handle AI team lineup adjustment for injured starters
                $team = Team::where('campaign_id', $campaign->id)
                    ->where('abbreviation', $teamAbbr)
                    ->first();

                if ($team && $team->id !== $campaign->team_id) {
                    $this->aiLineupService->handleInjuredStarter($campaign, $team, $playerId);
                }
            }

            // Update morale
            $gameResult = ['won' => $won, 'streak' => $streak];
            $player = $this->morale->updateAfterGame($player, $gameResult, $stats);
            $newMorale = $player['personality']['morale'] ?? 80;

            // Track significant morale changes
            $moraleDiff = $newMorale - $oldMorale;
            if (abs($moraleDiff) >= 3) {
                $evolutionSummary['morale_changes'][] = [
                    'player_id' => $playerId,
                    'name' => $playerName,
                    'change' => $moraleDiff,
                    'new_morale' => $newMorale,
                ];
            }

            // Apply micro-development (if not injured)
            if (!$this->injuries->isInjured($player)) {
                $microDev = $this->development->calculateMicroDevelopment($player, $stats);
                if (!empty($microDev['attributeChanges'])) {
                    $player = $this->applyAttributeChanges($player, $microDev['attributeChanges']);

                    // Add to development or regression summary
                    if ($microDev['type'] === 'development') {
                        $evolutionSummary['development'][] = [
                            'player_id' => $playerId,
                            'name' => $playerName,
                            'performance_rating' => round($microDev['performanceRating'], 1),
                            'attributes_improved' => array_keys($microDev['attributeChanges']),
                        ];
                    } elseif ($microDev['type'] === 'regression') {
                        $evolutionSummary['regression'][] = [
                            'player_id' => $playerId,
                            'name' => $playerName,
                            'performance_rating' => round($microDev['performanceRating'], 1),
                            'attributes_declined' => array_keys($microDev['attributeChanges']),
                        ];
                    }
                }

                // Track performance for streaks
                $oldStreakData = $player['streak_data'] ?? $player['streakData'] ?? null;
                $player = $this->trackPerformance($player, $microDev['performanceRating']);

                // Check for new streak
                $newStreakData = $player['streak_data'] ?? $player['streakData'] ?? null;
                if ($newStreakData && (!$oldStreakData || $newStreakData['games'] > ($oldStreakData['games'] ?? 0))) {
                    if ($newStreakData['type'] === 'hot') {
                        $evolutionSummary['hot_streaks'][] = [
                            'player_id' => $playerId,
                            'name' => $playerName,
                            'games' => $newStreakData['games'],
                        ];
                    } elseif ($newStreakData['type'] === 'cold') {
                        $evolutionSummary['cold_streaks'][] = [
                            'player_id' => $playerId,
                            'name' => $playerName,
                            'games' => $newStreakData['games'],
                        ];
                    }
                }
            }

            // Update season stats - only count as game played if player had minutes
            $minutesPlayed = $stats['minutes'] ?? 0;
            if ($minutesPlayed > 0) {
                $player['games_played_this_season'] = ($player['games_played_this_season'] ?? $player['gamesPlayedThisSeason'] ?? 0) + 1;
                $player['gamesPlayedThisSeason'] = $player['games_played_this_season'];
            }
            $player['minutes_played_this_season'] = ($player['minutes_played_this_season'] ?? $player['minutesPlayedThisSeason'] ?? 0) + $minutesPlayed;
            $player['minutesPlayedThisSeason'] = $player['minutes_played_this_season'];

            // Collect for batch save or save immediately for user team
            if ($isUserTeam && is_numeric($player['id'] ?? null)) {
                $dbPlayer = Player::find($player['id']);
                if ($dbPlayer) {
                    $dbPlayer->update($this->normalizeForDatabase($player));
                }
            } else {
                // Collect for batch update
                $leaguePlayerUpdates[$player['id']] = $player;
            }
        }

        // Batch save all league player updates at once
        if (!empty($leaguePlayerUpdates)) {
            $this->playerService->updateLeaguePlayersBatch($campaign->id, $leaguePlayerUpdates);
        }

        // Filter out empty arrays
        return array_filter($evolutionSummary, fn($arr) => !empty($arr));
    }

    /**
     * Process weekly updates for all players in a campaign.
     */
    public function processWeeklyUpdates(Campaign $campaign): void
    {
        // Process user's team (database players)
        $userPlayers = Player::where('campaign_id', $campaign->id)->get();
        foreach ($userPlayers as $player) {
            $playerArray = $player->toArray();
            $playerArray = $this->processWeeklyPlayer($campaign, $playerArray);
            $player->update($this->normalizeForDatabase($playerArray));
        }

        // Process league players (JSON)
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        $teamRecord = $this->getTeamRecords($campaign);

        foreach ($leaguePlayers as &$player) {
            $player = $this->processWeeklyPlayer($campaign, $player, $teamRecord);
        }

        $this->playerService->saveLeaguePlayers($campaign->id, $leaguePlayers);
    }

    /**
     * Process weekly updates for a single player.
     */
    private function processWeeklyPlayer(Campaign $campaign, array $player, array $teamRecords = []): array
    {
        // Process injury recovery
        if ($this->injuries->isInjured($player)) {
            $wasInjured = true;
            $injury = $player['injury_details'] ?? $player['injuryDetails'] ?? null;
            $player = $this->injuries->processRecovery($player);

            // Check if just recovered
            if ($wasInjured && !$this->injuries->isInjured($player) && $injury) {
                $this->news->createRecoveryNews($campaign, $player, $injury);
            }
        }

        // Natural fatigue recovery
        $player = $this->recoverFatigue($player);

        // Update morale based on team performance
        $teamAbbr = $player['teamAbbreviation'] ?? $player['team']?->abbreviation ?? '';
        $record = $teamRecords[$teamAbbr] ?? ['wins' => 0, 'losses' => 0];
        $player = $this->morale->updateWeekly($player, $record);

        // Check for hot/cold streaks
        $player = $this->processStreaks($campaign, $player);

        // Recalculate overall rating
        $player = $this->recalculateOverall($player);

        return $player;
    }

    /**
     * Process monthly development checkpoint.
     */
    public function processMonthlyDevelopment(Campaign $campaign): void
    {
        // Process user's team
        $userPlayers = Player::where('campaign_id', $campaign->id)->get();
        $userRoster = $userPlayers->map(fn($p) => $p->toArray())->toArray();

        foreach ($userPlayers as $player) {
            $playerArray = $player->toArray();
            $playerArray = $this->processMonthlyPlayer($campaign, $playerArray, $userRoster);
            $player->update($this->normalizeForDatabase($playerArray));
        }

        // Process league teams
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        $teams = $this->groupPlayersByTeam($leaguePlayers);

        foreach ($teams as $teamAbbr => $roster) {
            foreach ($roster as &$player) {
                $player = $this->processMonthlyPlayer($campaign, $player, $roster);
            }
            // Update players back in main array
            foreach ($leaguePlayers as &$lp) {
                foreach ($roster as $rp) {
                    if (($lp['id'] ?? '') === ($rp['id'] ?? 'no-match')) {
                        $lp = $rp;
                        break;
                    }
                }
            }
        }

        $this->playerService->saveLeaguePlayers($campaign->id, $leaguePlayers);
    }

    /**
     * Process monthly development for a single player.
     */
    private function processMonthlyPlayer(Campaign $campaign, array $player, array $roster): array
    {
        if ($this->injuries->isInjured($player)) {
            return $player; // No development while injured
        }

        // Calculate context
        $gamesPlayed = $player['games_played_this_season'] ?? $player['gamesPlayedThisSeason'] ?? 0;
        $minutesPlayed = $player['minutes_played_this_season'] ?? $player['minutesPlayedThisSeason'] ?? 0;
        $avgMinutes = $gamesPlayed > 0 ? $minutesPlayed / $gamesPlayed : 0;

        // Check for mentors
        $mentors = $this->personality->findMentorsForPlayer($player, $roster);
        $hasMentor = count($mentors) > 0;

        // Calculate badge synergy boost
        $synergyBoost = $this->badgeSynergy->calculateDevelopmentBoost($player, $roster);

        $context = [
            'avgMinutesPerGame' => $avgMinutes,
            'hasMentor' => $hasMentor,
            'badgeSynergyBoost' => $synergyBoost,
        ];

        // Calculate development
        $devPoints = $this->development->calculateMonthlyDevelopment($player, $context);
        $regPoints = $this->development->calculateMonthlyRegression($player);

        // Apply personality modifiers
        $personalityMod = $this->personality->getDevelopmentModifier($player);
        $devPoints *= (1 + $personalityMod);

        // Apply to attributes
        if ($devPoints > 0 || $regPoints > 0) {
            $player = $this->applyMonthlyAttributeChanges($player, $devPoints, $regPoints);
        }

        // Recalculate overall
        $oldOverall = $player['overallRating'] ?? $player['overall_rating'] ?? 70;
        $player = $this->recalculateOverall($player);
        $newOverall = $player['overallRating'] ?? $player['overall_rating'] ?? 70;

        // Generate news for significant changes
        $change = $newOverall - $oldOverall;
        if ($change >= 3) {
            $this->news->createBreakoutNews($campaign, $player, $change);
        } elseif ($change <= -2) {
            $this->news->createDeclineNews($campaign, $player, abs($change));
        }

        return $player;
    }

    /**
     * Process offseason evolution for all players.
     */
    public function processOffseason(Campaign $campaign): array
    {
        $results = [
            'developed' => [],
            'regressed' => [],
            'retired' => [],
            'injuries_healed' => [],
        ];

        // Process user's team
        $userPlayers = Player::where('campaign_id', $campaign->id)->get();
        foreach ($userPlayers as $player) {
            $playerArray = $player->toArray();
            $oldOverall = $playerArray['overall_rating'];

            $playerArray = $this->processOffseasonPlayer($campaign, $playerArray);

            // Check for retirement
            if ($playerArray['is_retired'] ?? false) {
                $results['retired'][] = $this->getPlayerName($playerArray);
                $this->news->createRetirementNews($campaign, $playerArray, $playerArray['career_seasons'] ?? 1);
                $player->update(['is_retired' => true]);
                continue;
            }

            $player->update($this->normalizeForDatabase($playerArray));

            $newOverall = $playerArray['overall_rating'];
            $change = $newOverall - $oldOverall;
            if ($newOverall > $oldOverall) {
                $results['developed'][] = $this->getPlayerName($playerArray) . " (+{$change})";
            } elseif ($newOverall < $oldOverall) {
                $results['regressed'][] = $this->getPlayerName($playerArray) . " ({$change})";
            }
        }

        // Process league players
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        $activePlayers = [];

        foreach ($leaguePlayers as $player) {
            $oldOverall = $player['overallRating'] ?? 70;
            $player = $this->processOffseasonPlayer($campaign, $player);

            if ($player['isRetired'] ?? false) {
                $results['retired'][] = $this->getPlayerName($player);
                continue; // Don't add to active players
            }

            $newOverall = $player['overallRating'] ?? 70;
            $change = $newOverall - $oldOverall;
            if ($newOverall > $oldOverall) {
                $results['developed'][] = $this->getPlayerName($player) . " (+{$change})";
            } elseif ($newOverall < $oldOverall) {
                $results['regressed'][] = $this->getPlayerName($player) . " ({$change})";
            }

            $activePlayers[] = $player;
        }

        $this->playerService->saveLeaguePlayers($campaign->id, $activePlayers);

        return $results;
    }

    /**
     * Process offseason for a single player.
     */
    private function processOffseasonPlayer(Campaign $campaign, array $player): array
    {
        // Heal all injuries
        $player['is_injured'] = false;
        $player['isInjured'] = false;
        $player['injury_details'] = null;
        $player['injuryDetails'] = null;

        // Reset fatigue
        $player['fatigue'] = 0;

        // Increment career seasons
        $player['career_seasons'] = ($player['career_seasons'] ?? $player['careerSeasons'] ?? 0) + 1;
        $player['careerSeasons'] = $player['career_seasons'];

        // Apply seasonal aging
        $age = $this->development->calculateAge($player['birthDate'] ?? $player['birth_date'] ?? '1995-01-01');
        $player['attributes'] = $this->aging->applySeasonalAging($player['attributes'], $age);

        // Check for retirement
        if ($this->shouldRetire($player, $age)) {
            $player['is_retired'] = true;
            $player['isRetired'] = true;
            return $player;
        }

        // Reset season stats
        $player['games_played_this_season'] = 0;
        $player['gamesPlayedThisSeason'] = 0;
        $player['minutes_played_this_season'] = 0;
        $player['minutesPlayedThisSeason'] = 0;
        $player['recent_performances'] = [];
        $player['recentPerformances'] = [];
        $player['streak_data'] = null;
        $player['streakData'] = null;

        // Decrement contract
        $yearsRemaining = $player['contract_years_remaining'] ?? $player['contractYearsRemaining'] ?? 1;
        $player['contract_years_remaining'] = max(0, $yearsRemaining - 1);
        $player['contractYearsRemaining'] = $player['contract_years_remaining'];

        // Recalculate overall
        $player = $this->recalculateOverall($player);

        return $player;
    }

    /**
     * Check if player should retire.
     */
    private function shouldRetire(array $player, int $age): bool
    {
        $config = config('player_evolution.retirement');

        if ($age < $config['min_age']) {
            return false;
        }

        $chance = $config['base_chance'];
        $chance += ($age - $config['min_age']) * $config['age_factor'];

        $overall = $player['overallRating'] ?? $player['overall_rating'] ?? 70;
        if ($overall < $config['low_rating_threshold']) {
            $chance += $config['low_rating_bonus'];
        }

        return mt_rand(1, 100) / 100 <= $chance;
    }

    /**
     * Apply attribute changes from micro-development and record to history.
     */
    private function applyAttributeChanges(array $player, array $changes): array
    {
        // Initialize development_history if not exists
        if (!isset($player['development_history'])) {
            $player['development_history'] = [];
        }

        $today = date('Y-m-d');

        foreach ($changes as $path => $change) {
            $parts = explode('.', $path);
            if (count($parts) === 2) {
                $category = $parts[0];
                $attr = $parts[1];
                if (isset($player['attributes'][$category][$attr])) {
                    $current = $player['attributes'][$category][$attr];
                    $newValue = max(25, min(99, $current + $change));
                    $player['attributes'][$category][$attr] = $newValue;

                    // Record to development history
                    $player['development_history'][] = [
                        'date' => $today,
                        'category' => $category,
                        'attribute' => $attr,
                        'change' => round($change, 2),
                        'old_value' => $current,
                        'new_value' => $newValue,
                    ];
                }
            }
        }

        // Limit history to last 200 entries to prevent bloat
        if (count($player['development_history']) > 200) {
            $player['development_history'] = array_slice($player['development_history'], -200);
        }

        return $player;
    }

    /**
     * Apply monthly attribute changes considering aging.
     */
    private function applyMonthlyAttributeChanges(array $player, float $devPoints, float $regPoints): array
    {
        $age = $this->development->calculateAge($player['birthDate'] ?? $player['birth_date'] ?? '1995-01-01');
        $potential = $player['potentialRating'] ?? $player['potential_rating'] ?? 75;

        foreach ($player['attributes'] as $category => &$attrs) {
            if (!is_array($attrs)) continue;

            foreach ($attrs as $attrName => &$value) {
                $change = $this->aging->calculateAttributeChange($attrName, $age, $devPoints, $regPoints);

                // Can't exceed potential
                $newValue = $value + $change;
                $value = max(25, min($potential, round($newValue, 1)));
            }
        }

        return $player;
    }

    /**
     * Track performance for streak detection.
     */
    private function trackPerformance(array $player, float $rating): array
    {
        $performances = $player['recent_performances'] ?? $player['recentPerformances'] ?? [];
        $performances[] = $rating;

        // Keep last 10 performances
        if (count($performances) > 10) {
            $performances = array_slice($performances, -10);
        }

        $player['recent_performances'] = $performances;
        $player['recentPerformances'] = $performances;

        return $player;
    }

    /**
     * Process hot/cold streaks.
     */
    private function processStreaks(Campaign $campaign, array $player): array
    {
        $performances = $player['recent_performances'] ?? $player['recentPerformances'] ?? [];
        $streakConfig = config('player_evolution.streaks');

        if (count($performances) < $streakConfig['hot_streak_games']) {
            return $player;
        }

        $recent = array_slice($performances, -$streakConfig['hot_streak_games']);

        // Check for hot streak
        $allHot = array_reduce($recent, fn($carry, $p) => $carry && $p >= $streakConfig['hot_streak_threshold'], true);
        if ($allHot) {
            $streakLength = $this->countStreak($performances, $streakConfig['hot_streak_threshold'], true);
            $player['streak_data'] = [
                'type' => 'hot',
                'games' => min($streakLength, $streakConfig['max_streak_length']),
            ];
            $player['streakData'] = $player['streak_data'];

            // Apply streak bonus to relevant attributes
            if ($streakLength === $streakConfig['hot_streak_games']) {
                $boosts = ['offense.threePoint' => $streakConfig['hot_streak_bonus']];
                $this->news->createHotStreakNews($campaign, $player, $streakLength, $boosts);
            }
        }

        // Check for cold streak
        $allCold = array_reduce($recent, fn($carry, $p) => $carry && $p <= $streakConfig['cold_streak_threshold'], true);
        if ($allCold) {
            $streakLength = $this->countStreak($performances, $streakConfig['cold_streak_threshold'], false);
            $player['streak_data'] = [
                'type' => 'cold',
                'games' => min($streakLength, $streakConfig['max_streak_length']),
            ];
            $player['streakData'] = $player['streak_data'];

            if ($streakLength === $streakConfig['cold_streak_games']) {
                $this->news->createColdStreakNews($campaign, $player, $streakLength);
            }
        }

        return $player;
    }

    /**
     * Count consecutive games meeting streak threshold.
     */
    private function countStreak(array $performances, float $threshold, bool $above): int
    {
        $count = 0;
        for ($i = count($performances) - 1; $i >= 0; $i--) {
            $meetsThreshold = $above ? $performances[$i] >= $threshold : $performances[$i] <= $threshold;
            if ($meetsThreshold) {
                $count++;
            } else {
                break;
            }
        }
        return $count;
    }

    /**
     * Recalculate player's overall rating from attributes.
     */
    private function recalculateOverall(array $player): array
    {
        $weights = config('player_evolution.overall_weights');
        $attrs = $player['attributes'];

        $categoryAverages = [];
        foreach ($attrs as $category => $categoryAttrs) {
            if (!is_array($categoryAttrs) || empty($categoryAttrs)) continue;
            $categoryAverages[$category] = array_sum($categoryAttrs) / count($categoryAttrs);
        }

        $overall = 0;
        foreach ($weights as $category => $weight) {
            $overall += ($categoryAverages[$category] ?? 75) * $weight;
        }

        $overall = (int) round(min(99, max(40, $overall)));

        $player['overallRating'] = $overall;
        $player['overall_rating'] = $overall;

        return $player;
    }

    /**
     * Update player fatigue based on minutes played.
     * If player plays 0 minutes, they get rest recovery instead.
     */
    private function updateFatigue(array $player, int $minutes): array
    {
        $config = config('player_evolution.fatigue');
        $current = $player['fatigue'] ?? 0;

        // If player didn't play, they get rest recovery
        if ($minutes === 0) {
            $player['fatigue'] = max(0, $current - $config['rest_day_recovery']);
            return $player;
        }

        $gain = $minutes * $config['per_minute_gain'];

        // Rookie wall penalty
        $gamesPlayed = $player['games_played_this_season'] ?? $player['gamesPlayedThisSeason'] ?? 0;
        $careerSeasons = $player['career_seasons'] ?? $player['careerSeasons'] ?? 0;
        $rookieConfig = config('player_evolution.rookie_wall');

        if ($careerSeasons === 0 && $gamesPlayed >= $rookieConfig['game_threshold']) {
            if ($gamesPlayed < $rookieConfig['game_threshold'] + $rookieConfig['duration_games']) {
                $gain *= $rookieConfig['fatigue_multiplier'];
            }
        }

        $player['fatigue'] = min($config['max_fatigue'], $current + $gain);

        return $player;
    }

    /**
     * Recover fatigue during rest.
     */
    private function recoverFatigue(array $player): array
    {
        $config = config('player_evolution.fatigue');
        $current = $player['fatigue'] ?? 0;
        $player['fatigue'] = max(0, $current - $config['weekly_recovery']);
        return $player;
    }

    /**
     * Process rest day recovery for all teams that didn't play on a given day.
     * Called after simulating all games for a day to give recovery to teams without games.
     *
     * @param Campaign $campaign
     * @param array $teamsWithGames Array of team IDs that had games on this day
     */
    public function processRestDayRecovery(Campaign $campaign, array $teamsWithGames): void
    {
        $config = config('player_evolution.fatigue');
        $restRecovery = $config['rest_day_recovery'];

        // Get all team IDs for this campaign
        $allTeams = Team::where('campaign_id', $campaign->id)->pluck('id', 'abbreviation')->toArray();

        // Find teams that didn't have games
        $teamsWithoutGames = array_filter($allTeams, fn($teamId) => !in_array($teamId, $teamsWithGames));

        if (empty($teamsWithoutGames)) {
            return; // All teams played today
        }

        // Process user team if they didn't play
        $userTeamAbbr = $campaign->team?->abbreviation;
        if ($userTeamAbbr && isset($teamsWithoutGames[$userTeamAbbr])) {
            $userPlayers = Player::where('campaign_id', $campaign->id)->get();
            foreach ($userPlayers as $player) {
                $currentFatigue = $player->fatigue ?? 0;
                if ($currentFatigue > 0) {
                    $player->update(['fatigue' => max(0, $currentFatigue - $restRecovery)]);
                }
            }
            unset($teamsWithoutGames[$userTeamAbbr]);
        }

        // Process league teams that didn't play
        if (!empty($teamsWithoutGames)) {
            $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
            $teamsWithoutGamesAbbrs = array_keys($teamsWithoutGames);
            $modified = false;

            foreach ($leaguePlayers as &$player) {
                $teamAbbr = $player['teamAbbreviation'] ?? '';
                if (in_array($teamAbbr, $teamsWithoutGamesAbbrs)) {
                    $currentFatigue = $player['fatigue'] ?? 0;
                    if ($currentFatigue > 0) {
                        $player['fatigue'] = max(0, $currentFatigue - $restRecovery);
                        $modified = true;
                    }
                }
            }

            if ($modified) {
                $this->playerService->saveLeaguePlayers($campaign->id, $leaguePlayers);
            }
        }
    }

    /**
     * Check if team is the user's team.
     */
    private function isUserTeam(Campaign $campaign, string $teamAbbr): bool
    {
        return $campaign->team?->abbreviation === $teamAbbr;
    }

    /**
     * Find player in roster by ID.
     */
    private function findPlayerInRoster(array $roster, $playerId): ?array
    {
        foreach ($roster as $player) {
            if (($player['id'] ?? '') == $playerId) {
                return $player;
            }
        }
        return null;
    }

    /**
     * Save player to appropriate storage.
     */
    private function savePlayer(int $campaignId, array $player, bool $isUserTeam): void
    {
        if ($isUserTeam && is_numeric($player['id'] ?? null)) {
            $dbPlayer = Player::find($player['id']);
            if ($dbPlayer) {
                $dbPlayer->update($this->normalizeForDatabase($player));
            }
        } else {
            $this->playerService->updateLeaguePlayer($campaignId, $player['id'], $player);
        }
    }

    /**
     * Normalize player array for database storage.
     */
    private function normalizeForDatabase(array $player): array
    {
        return [
            'fatigue' => $player['fatigue'] ?? 0,
            'is_injured' => $player['is_injured'] ?? $player['isInjured'] ?? false,
            'injury_details' => $player['injury_details'] ?? $player['injuryDetails'] ?? null,
            'attributes' => $player['attributes'],
            'personality' => $player['personality'],
            'overall_rating' => $player['overall_rating'] ?? $player['overallRating'] ?? 70,
            'games_played_this_season' => $player['games_played_this_season'] ?? $player['gamesPlayedThisSeason'] ?? 0,
            'minutes_played_this_season' => $player['minutes_played_this_season'] ?? $player['minutesPlayedThisSeason'] ?? 0,
            'development_history' => $player['development_history'] ?? $player['developmentHistory'] ?? [],
            'streak_data' => $player['streak_data'] ?? $player['streakData'] ?? null,
            'career_seasons' => $player['career_seasons'] ?? $player['careerSeasons'] ?? 0,
            'is_retired' => $player['is_retired'] ?? $player['isRetired'] ?? false,
            'recent_performances' => $player['recent_performances'] ?? $player['recentPerformances'] ?? [],
        ];
    }

    /**
     * Get player name from array.
     */
    private function getPlayerName(array $player): string
    {
        $first = $player['firstName'] ?? $player['first_name'] ?? '';
        $last = $player['lastName'] ?? $player['last_name'] ?? '';
        return trim("{$first} {$last}");
    }

    /**
     * Get team streak (simplified - would need game history).
     */
    private function getTeamStreak(Campaign $campaign, string $teamAbbr): int
    {
        // This would need to query recent game results
        // For now, return 0 (no streak)
        return 0;
    }

    /**
     * Get team records for all teams.
     */
    private function getTeamRecords(Campaign $campaign): array
    {
        $standings = $campaign->currentSeason?->standings ?? [];
        $records = [];

        foreach (['east', 'west'] as $conference) {
            foreach ($standings[$conference] ?? [] as $team) {
                $teamModel = $campaign->teams()->find($team['teamId'] ?? 0);
                if ($teamModel) {
                    $records[$teamModel->abbreviation] = [
                        'wins' => $team['wins'] ?? 0,
                        'losses' => $team['losses'] ?? 0,
                    ];
                }
            }
        }

        return $records;
    }

    /**
     * Group players by team abbreviation.
     */
    private function groupPlayersByTeam(array $players): array
    {
        $teams = [];
        foreach ($players as $player) {
            $abbr = $player['teamAbbreviation'] ?? 'FA';
            if (!isset($teams[$abbr])) {
                $teams[$abbr] = [];
            }
            $teams[$abbr][] = $player;
        }
        return $teams;
    }
}
