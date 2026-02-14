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
        // Set difficulty for calculations
        $this->development->setDifficulty($campaign->difficulty ?? 'pro');

        $isPlayoff = $campaign->currentSeason?->phase === 'playoffs';
        $gameDate = $gameData['gameDate'] ?? $campaign->current_date->format('Y-m-d');

        // Process home team
        $homeSummary = $this->processTeamPostGame(
            $campaign,
            $gameData['homeTeamAbbreviation'],
            $boxScores['home'] ?? [],
            $homeScore > $awayScore,
            $isPlayoff,
            $gameDate,
            $gameData['awayTeamAbbreviation'],
            $homeScore,
            $awayScore
        );

        // Process away team
        $awaySummary = $this->processTeamPostGame(
            $campaign,
            $gameData['awayTeamAbbreviation'],
            $boxScores['away'] ?? [],
            $awayScore > $homeScore,
            $isPlayoff,
            $gameDate,
            $gameData['homeTeamAbbreviation'],
            $awayScore,
            $homeScore
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
        bool $isPlayoff,
        string $gameDate = null,
        string $opponentAbbr = '',
        int $teamScore = 0,
        int $opponentScore = 0
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
            'recoveries' => [],
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

            // Process injury recovery for already-injured players FIRST
            if ($this->injuries->isInjured($player)) {
                $existingInjury = $player['injury_details'] ?? $player['injuryDetails'] ?? null;
                $player = $this->injuries->processRecovery($player);

                // Check if just recovered
                if ($existingInjury && !$this->injuries->isInjured($player)) {
                    $this->news->createRecoveryNews($campaign, $player, $existingInjury);

                    $evolutionSummary['recoveries'][] = [
                        'player_id' => $playerId,
                        'name' => $playerName,
                        'injury_type' => $existingInjury['name'] ?? $existingInjury['injury_type'] ?? 'Injury',
                    ];
                }
            }

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

            // Check for NEW injury (only for players who actually played minutes)
            $minutesPlayed = $stats['minutes'] ?? 0;
            $injury = ($minutesPlayed > 0 && !$this->injuries->isInjured($player))
                ? $this->injuries->checkForInjury($player, $minutesPlayed, $isPlayoff)
                : null;
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
                    $player = $this->applyAttributeChanges($player, $microDev['attributeChanges'], $gameDate);

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
                $player = $this->trackPerformance(
                    $player,
                    $microDev['performanceRating'],
                    $stats,
                    $gameDate ?? date('Y-m-d'),
                    $opponentAbbr,
                    $won
                );

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
     * Returns array of upgrade point awards for user's team players.
     */
    public function processWeeklyUpdates(Campaign $campaign): array
    {
        // Set difficulty for calculations
        $this->development->setDifficulty($campaign->difficulty ?? 'pro');

        $upgradePointsAwarded = [];

        // Process user's team (database players) - no AI upgrades
        $userPlayers = Player::where('campaign_id', $campaign->id)->get();
        foreach ($userPlayers as $player) {
            $playerArray = $player->toArray();
            $pointsBefore = $playerArray['upgrade_points'] ?? $playerArray['upgradePoints'] ?? 0;
            $playerArray = $this->processWeeklyPlayer($campaign, $playerArray, [], false);
            $pointsAfter = $playerArray['upgrade_points'] ?? $playerArray['upgradePoints'] ?? 0;
            $player->update($this->normalizeForDatabase($playerArray));

            $earned = $pointsAfter - $pointsBefore;
            if ($earned > 0) {
                $upgradePointsAwarded[] = [
                    'player_id' => $player->id,
                    'name' => $playerArray['name'] ?? ($playerArray['firstName'] ?? '') . ' ' . ($playerArray['lastName'] ?? ''),
                    'points_earned' => $earned,
                    'total_points' => $pointsAfter,
                ];
            }
        }

        // Process league players (JSON) - with AI upgrades
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        $teamRecord = $this->getTeamRecords($campaign);

        foreach ($leaguePlayers as &$player) {
            $player = $this->processWeeklyPlayer($campaign, $player, $teamRecord, true);
        }

        $this->playerService->saveLeaguePlayers($campaign->id, $leaguePlayers);

        return $upgradePointsAwarded;
    }

    /**
     * Process weekly updates for a single player.
     */
    private function processWeeklyPlayer(Campaign $campaign, array $player, array $teamRecords = [], bool $isAI = false): array
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

        // Award upgrade points based on weekly growth (use campaign date, not real-world date)
        $weekAgo = $campaign->current_date->copy()->subDays(7)->format('Y-m-d');
        $earnedPoints = $this->calculateUpgradePointsFromGrowth($player, $weekAgo);
        if ($earnedPoints > 0) {
            $maxPoints = config('player_evolution.upgrade_points.max_stored_points', 99);
            $currentPoints = $player['upgrade_points'] ?? $player['upgradePoints'] ?? 0;
            $player['upgrade_points'] = min($maxPoints, $currentPoints + $earnedPoints);
            $player['upgradePoints'] = $player['upgrade_points'];
        }

        // AI teams automatically spend upgrade points
        if ($isAI) {
            $player = $this->processAIUpgrades($player, $campaign);
        }

        // Recalculate overall rating
        $player = $this->recalculateOverall($player);

        return $player;
    }

    /**
     * Process AI auto-upgrades for a player.
     * AI spends all available upgrade points intelligently.
     */
    private function processAIUpgrades(array $player, Campaign $campaign = null): array
    {
        $points = $player['upgrade_points'] ?? $player['upgradePoints'] ?? 0;
        if ($points <= 0) {
            return $player;
        }

        $potential = $player['potentialRating'] ?? $player['potential_rating'] ?? 99;
        $position = $player['position'] ?? 'SF';
        $upgradeDate = $campaign?->current_date?->format('Y-m-d') ?? now()->format('Y-m-d');

        // Spend all available points
        while ($points > 0) {
            $upgrade = $this->selectAIUpgrade($player, $position, $potential);
            if (!$upgrade) {
                break; // No valid upgrades available (all at cap)
            }

            // Apply the upgrade
            $category = $upgrade['category'];
            $attribute = $upgrade['attribute'];
            $currentValue = $player['attributes'][$category][$attribute];
            $newValue = min($potential, $currentValue + 1);

            $player['attributes'][$category][$attribute] = $newValue;

            // Record in development history
            $history = $player['development_history'] ?? $player['developmentHistory'] ?? [];
            $history[] = [
                'date' => $upgradeDate,
                'category' => $category,
                'attribute' => $attribute,
                'change' => 1,
                'old_value' => $currentValue,
                'new_value' => $newValue,
                'source' => 'ai_upgrade',
            ];
            $player['development_history'] = array_slice($history, -200);
            $player['developmentHistory'] = $player['development_history'];

            $points--;
        }

        $player['upgrade_points'] = $points;
        $player['upgradePoints'] = $points;

        return $player;
    }

    /**
     * Select which attribute the AI should upgrade.
     * Balances between improving weaknesses and enhancing strengths.
     */
    private function selectAIUpgrade(array $player, string $position, int $potential): ?array
    {
        $attributes = $player['attributes'] ?? [];
        $upgradeableCategories = ['offense', 'defense', 'physical']; // Mental cannot be upgraded

        // Get position-relevant attribute weights
        $positionWeights = $this->getPositionAttributeWeights($position);

        // Collect all upgradeable attributes with their scores
        $candidates = [];

        foreach ($upgradeableCategories as $category) {
            if (!isset($attributes[$category]) || !is_array($attributes[$category])) {
                continue;
            }

            foreach ($attributes[$category] as $attrName => $value) {
                // Skip if already at potential cap
                if ($value >= $potential) {
                    continue;
                }

                // Calculate priority score
                $positionRelevance = $positionWeights[$category][$attrName] ?? 0.5;

                // Determine if this is a weakness or strength relative to category average
                $categoryValues = array_values($attributes[$category]);
                $categoryAvg = count($categoryValues) > 0 ? array_sum($categoryValues) / count($categoryValues) : 70;

                $isWeakness = $value < $categoryAvg - 3;
                $isStrength = $value > $categoryAvg + 3;

                // Base score from position relevance (0-1)
                $score = $positionRelevance;

                // 60% chance to prioritize weaknesses, 40% strengths
                $prioritizeWeakness = mt_rand(1, 100) <= 60;

                if ($prioritizeWeakness && $isWeakness) {
                    // Boost score for weaknesses (bigger gap = higher priority)
                    $gap = $categoryAvg - $value;
                    $score += 0.3 + ($gap / 30); // Up to +0.6 bonus for big gaps
                } elseif (!$prioritizeWeakness && $isStrength) {
                    // Boost score for strengths (already good, make better)
                    $score += 0.25;
                } elseif ($isWeakness) {
                    // Still give some bonus to weaknesses even when not prioritizing
                    $score += 0.1;
                }

                // Small random factor for variety
                $score += mt_rand(0, 20) / 100;

                $candidates[] = [
                    'category' => $category,
                    'attribute' => $attrName,
                    'value' => $value,
                    'score' => $score,
                ];
            }
        }

        if (empty($candidates)) {
            return null;
        }

        // Sort by score descending and pick the best
        usort($candidates, fn($a, $b) => $b['score'] <=> $a['score']);

        return $candidates[0];
    }

    /**
     * Get attribute weights based on position.
     * Higher weight = more important for that position.
     */
    private function getPositionAttributeWeights(string $position): array
    {
        $weights = [
            'PG' => [
                'offense' => [
                    'ballHandling' => 1.0, 'passAccuracy' => 1.0, 'passVision' => 0.9, 'passIQ' => 0.9,
                    'threePoint' => 0.8, 'midRange' => 0.7, 'layup' => 0.7, 'closeShot' => 0.5,
                    'freeThrow' => 0.6, 'postControl' => 0.2, 'drawFoul' => 0.6,
                    'standingDunk' => 0.1, 'drivingDunk' => 0.4,
                ],
                'defense' => [
                    'perimeterDefense' => 1.0, 'steal' => 0.9, 'passPerception' => 0.8,
                    'helpDefenseIQ' => 0.7, 'interiorDefense' => 0.3, 'block' => 0.2,
                    'offensiveRebound' => 0.2, 'defensiveRebound' => 0.4,
                ],
                'physical' => [
                    'speed' => 1.0, 'acceleration' => 0.9, 'stamina' => 0.8,
                    'vertical' => 0.5, 'strength' => 0.4,
                ],
            ],
            'SG' => [
                'offense' => [
                    'threePoint' => 1.0, 'midRange' => 0.9, 'ballHandling' => 0.7, 'layup' => 0.8,
                    'closeShot' => 0.6, 'freeThrow' => 0.7, 'passAccuracy' => 0.6, 'passVision' => 0.5,
                    'passIQ' => 0.5, 'drawFoul' => 0.7, 'drivingDunk' => 0.6,
                    'standingDunk' => 0.3, 'postControl' => 0.2,
                ],
                'defense' => [
                    'perimeterDefense' => 1.0, 'steal' => 0.8, 'passPerception' => 0.7,
                    'helpDefenseIQ' => 0.6, 'interiorDefense' => 0.3, 'block' => 0.3,
                    'offensiveRebound' => 0.3, 'defensiveRebound' => 0.5,
                ],
                'physical' => [
                    'speed' => 0.9, 'acceleration' => 0.8, 'stamina' => 0.8,
                    'vertical' => 0.7, 'strength' => 0.5,
                ],
            ],
            'SF' => [
                'offense' => [
                    'threePoint' => 0.8, 'midRange' => 0.8, 'layup' => 0.8, 'closeShot' => 0.7,
                    'ballHandling' => 0.6, 'passAccuracy' => 0.5, 'passVision' => 0.4, 'passIQ' => 0.4,
                    'freeThrow' => 0.6, 'drawFoul' => 0.7, 'drivingDunk' => 0.7,
                    'standingDunk' => 0.5, 'postControl' => 0.4,
                ],
                'defense' => [
                    'perimeterDefense' => 0.8, 'interiorDefense' => 0.6, 'steal' => 0.7,
                    'block' => 0.5, 'helpDefenseIQ' => 0.7, 'passPerception' => 0.6,
                    'offensiveRebound' => 0.5, 'defensiveRebound' => 0.7,
                ],
                'physical' => [
                    'speed' => 0.7, 'acceleration' => 0.7, 'stamina' => 0.8,
                    'vertical' => 0.7, 'strength' => 0.7,
                ],
            ],
            'PF' => [
                'offense' => [
                    'postControl' => 0.8, 'closeShot' => 0.9, 'midRange' => 0.7, 'layup' => 0.8,
                    'standingDunk' => 0.8, 'drivingDunk' => 0.6, 'threePoint' => 0.5,
                    'freeThrow' => 0.6, 'drawFoul' => 0.7, 'ballHandling' => 0.3,
                    'passAccuracy' => 0.4, 'passVision' => 0.3, 'passIQ' => 0.4,
                ],
                'defense' => [
                    'interiorDefense' => 0.9, 'block' => 0.8, 'defensiveRebound' => 0.9,
                    'offensiveRebound' => 0.8, 'helpDefenseIQ' => 0.7, 'perimeterDefense' => 0.5,
                    'steal' => 0.4, 'passPerception' => 0.5,
                ],
                'physical' => [
                    'strength' => 0.9, 'vertical' => 0.7, 'stamina' => 0.7,
                    'speed' => 0.5, 'acceleration' => 0.5,
                ],
            ],
            'C' => [
                'offense' => [
                    'postControl' => 1.0, 'closeShot' => 0.9, 'standingDunk' => 0.9, 'layup' => 0.7,
                    'freeThrow' => 0.5, 'drawFoul' => 0.6, 'midRange' => 0.4, 'drivingDunk' => 0.4,
                    'threePoint' => 0.2, 'ballHandling' => 0.2, 'passAccuracy' => 0.4,
                    'passVision' => 0.3, 'passIQ' => 0.4,
                ],
                'defense' => [
                    'interiorDefense' => 1.0, 'block' => 1.0, 'defensiveRebound' => 1.0,
                    'offensiveRebound' => 0.9, 'helpDefenseIQ' => 0.7, 'perimeterDefense' => 0.3,
                    'steal' => 0.3, 'passPerception' => 0.4,
                ],
                'physical' => [
                    'strength' => 1.0, 'vertical' => 0.6, 'stamina' => 0.6,
                    'speed' => 0.3, 'acceleration' => 0.3,
                ],
            ],
        ];

        return $weights[$position] ?? $weights['SF'];
    }

    /**
     * Calculate upgrade points earned from recent attribute growth.
     * Higher potential players have slightly better point generation.
     */
    private function calculateUpgradePointsFromGrowth(array $player, string $sinceDate): int
    {
        $config = config('player_evolution.upgrade_points');
        if (!($config['enabled'] ?? false)) {
            return 0;
        }

        $history = $player['development_history'] ?? $player['developmentHistory'] ?? [];

        // Sum positive changes from this week
        $totalGrowth = 0;
        foreach ($history as $entry) {
            $entryDate = $entry['date'] ?? null;
            $change = $entry['change'] ?? 0;
            if ($entryDate && $entryDate >= $sinceDate && $change > 0) {
                $totalGrowth += $change;
            }
        }

        if ($totalGrowth < $config['min_growth_threshold']) {
            return 0;
        }

        // Get player's potential rating for scaling
        $potential = $player['potentialRating'] ?? $player['potential_rating'] ?? 75;

        // Scale points_per_growth by potential (75 is baseline = 1.0x, 99 = ~1.32x, 60 = ~0.8x)
        $potentialMultiplier = $potential / 75;
        $adjustedPointsPerGrowth = $config['points_per_growth'] * $potentialMultiplier;

        // Calculate base points
        $points = (int) floor($totalGrowth * $adjustedPointsPerGrowth);

        // Determine max weekly points - elite potential (90+) gets +1 bonus cap
        $maxWeekly = $config['max_weekly_points'];
        if ($potential >= 90) {
            $maxWeekly += 1;
        }

        return min($points, $maxWeekly);
    }

    /**
     * Process monthly development checkpoint.
     */
    public function processMonthlyDevelopment(Campaign $campaign): void
    {
        // Set difficulty for calculations
        $this->development->setDifficulty($campaign->difficulty ?? 'pro');

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

        // Calculate Dynamic Duo boost
        $duoBoost = $this->badgeSynergy->getDynamicDuoBoost($player, $roster);

        $context = [
            'avgMinutesPerGame' => $avgMinutes,
            'hasMentor' => $hasMentor,
            'badgeSynergyBoost' => $synergyBoost,
            'dynamicDuoBoost' => $duoBoost,
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
        // Set difficulty for calculations
        $this->development->setDifficulty($campaign->difficulty ?? 'pro');

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
        $age = $this->development->getPlayerAge($player);
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
    private function applyAttributeChanges(array $player, array $changes, string $gameDate = null): array
    {
        // Initialize development_history if not exists
        if (!isset($player['development_history'])) {
            $player['development_history'] = [];
        }

        $today = $gameDate ?? date('Y-m-d');

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
        $age = $this->development->getPlayerAge($player);
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
     * Stores full game log entry with box score stats.
     */
    private function trackPerformance(array $player, float $rating, array $stats = [], string $date = '', string $opponent = '', bool $won = false): array
    {
        $performances = $player['recent_performances'] ?? $player['recentPerformances'] ?? [];

        // Dedup: skip if this game was already tracked (same date + opponent)
        if ($date && $opponent) {
            foreach ($performances as $existing) {
                if (is_array($existing) && ($existing['date'] ?? '') === $date && ($existing['opponent'] ?? '') === $opponent) {
                    return $player;
                }
            }
        }

        $entry = [
            'rating' => round($rating, 1),
            'date' => $date,
            'opponent' => $opponent,
            'won' => $won,
            'min' => (int) ($stats['minutes'] ?? 0),
            'pts' => (int) ($stats['points'] ?? 0),
            'reb' => (int) (($stats['offensiveRebounds'] ?? $stats['offensive_rebounds'] ?? 0) + ($stats['defensiveRebounds'] ?? $stats['defensive_rebounds'] ?? 0)),
            'ast' => (int) ($stats['assists'] ?? 0),
            'stl' => (int) ($stats['steals'] ?? 0),
            'blk' => (int) ($stats['blocks'] ?? 0),
            'to' => (int) ($stats['turnovers'] ?? 0),
            'fgm' => (int) ($stats['fieldGoalsMade'] ?? $stats['fgm'] ?? 0),
            'fga' => (int) ($stats['fieldGoalsAttempted'] ?? $stats['fga'] ?? 0),
            'tpm' => (int) ($stats['threePointersMade'] ?? $stats['tpm'] ?? $stats['fg3m'] ?? 0),
            'tpa' => (int) ($stats['threePointersAttempted'] ?? $stats['tpa'] ?? $stats['fg3a'] ?? 0),
            'ftm' => (int) ($stats['freeThrowsMade'] ?? $stats['ftm'] ?? 0),
            'fta' => (int) ($stats['freeThrowsAttempted'] ?? $stats['fta'] ?? 0),
        ];

        $performances[] = $entry;

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

        // Extract ratings from objects (with backwards compat for old float entries)
        $ratings = array_map(fn($p) => is_array($p) ? ($p['rating'] ?? 0) : $p, $performances);

        $recent = array_slice($ratings, -$streakConfig['hot_streak_games']);

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
     * Handles both old float entries and new object entries.
     */
    private function countStreak(array $performances, float $threshold, bool $above): int
    {
        $count = 0;
        for ($i = count($performances) - 1; $i >= 0; $i--) {
            $val = is_array($performances[$i]) ? ($performances[$i]['rating'] ?? 0) : $performances[$i];
            $meetsThreshold = $above ? $val >= $threshold : $val <= $threshold;
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
     * Stamina and durability reduce fatigue accumulation.
     * If player plays 0 minutes, they get rest recovery instead.
     */
    private function updateFatigue(array $player, int $minutes): array
    {
        $config = config('player_evolution.fatigue');
        $current = $player['fatigue'] ?? 0;

        // If player didn't play at all, they get full rest day recovery
        if ($minutes === 0) {
            $recovery = $this->getAttributeWeightedRecovery($player, $config['rest_day_recovery']);
            $player['fatigue'] = max(0, $current - $recovery);
            return $player;
        }

        // Find the matching minute threshold bracket
        $thresholds = $config['minute_thresholds'];
        $bracket = null;
        foreach ($thresholds as $t) {
            if ($minutes >= $t['min'] && $minutes <= $t['max']) {
                $bracket = $t;
                break;
            }
        }

        // Fallback to last bracket if minutes exceed all ranges
        if (!$bracket) {
            $bracket = end($thresholds);
        }

        // Calculate stamina/durability modifier
        $stamina = $player['attributes']['physical']['stamina'] ?? 70;
        $durability = $player['attributes']['physical']['durability'] ?? 70;
        $athleticAvg = ($stamina * 0.6 + $durability * 0.4) / 100;

        if ($bracket['type'] === 'recovery') {
            // Light minutes: player RECOVERS fatigue (attribute-weighted like rest recovery)
            $recovery = $this->getAttributeWeightedRecovery($player, $bracket['base']);
            $player['fatigue'] = max(0, $current - $recovery);
        } else {
            // Moderate/heavy minutes: player GAINS fatigue (high attributes reduce gain)
            $gain = $bracket['base'] * (1.2 - $athleticAvg * 0.4);

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
        }

        return $player;
    }

    /**
     * Recover fatigue during rest.
     * Recovery rate varies by ~15% and is weighted by stamina/durability.
     */
    private function recoverFatigue(array $player): array
    {
        $config = config('player_evolution.fatigue');
        $current = $player['fatigue'] ?? 0;
        $recovery = $this->getAttributeWeightedRecovery($player, $config['weekly_recovery']);
        $player['fatigue'] = max(0, $current - $recovery);
        return $player;
    }

    /**
     * Calculate attribute-weighted recovery with ~15% natural variance.
     * Higher stamina/durability = faster recovery.
     */
    private function getAttributeWeightedRecovery(array $player, float $baseRecovery): float
    {
        $stamina = $player['attributes']['physical']['stamina'] ?? 70;
        $durability = $player['attributes']['physical']['durability'] ?? 70;
        $athleticAvg = ($stamina * 0.6 + $durability * 0.4) / 100; // 0.0 - 1.0

        // High attributes recover faster: 100-rated player gets ~20% more recovery, 50-rated gets ~10% less
        $attrModifier = 0.8 + $athleticAvg * 0.4;

        // Add ~15% random variance (0.85 to 1.15)
        $variance = 0.85 + (mt_rand(0, 30) / 100);

        return $baseRecovery * $attrModifier * $variance;
    }

    /**
     * Process rest day recovery across multiple days.
     * For each team, calculates how many days they had no game and applies
     * that many days of rest recovery (same as playing 0 minutes).
     *
     * @param Campaign $campaign
     * @param array $teamsPerDay Array of arrays, each containing team IDs that played on that day
     */
    public function processMultiDayRestRecovery(Campaign $campaign, array $teamsPerDay): void
    {
        $totalDays = count($teamsPerDay);
        if ($totalDays === 0) return;

        // Count games per team ID
        $gamesPerTeam = [];
        foreach ($teamsPerDay as $dayTeams) {
            foreach ($dayTeams as $teamId) {
                $gamesPerTeam[$teamId] = ($gamesPerTeam[$teamId] ?? 0) + 1;
            }
        }

        // Get all teams
        $allTeams = Team::where('campaign_id', $campaign->id)->pluck('id', 'abbreviation')->toArray();

        // Calculate rest days per team
        $restDaysPerTeam = [];
        foreach ($allTeams as $abbr => $teamId) {
            $games = $gamesPerTeam[$teamId] ?? 0;
            $restDays = $totalDays - $games;
            if ($restDays > 0) {
                $restDaysPerTeam[$abbr] = $restDays;
            }
        }

        if (empty($restDaysPerTeam)) return;

        $config = config('player_evolution.fatigue');
        $restRecovery = $config['rest_day_recovery'];

        // Process user team
        $userTeamAbbr = $campaign->team?->abbreviation;
        if ($userTeamAbbr && isset($restDaysPerTeam[$userTeamAbbr])) {
            $userPlayers = Player::where('campaign_id', $campaign->id)->get();
            $days = $restDaysPerTeam[$userTeamAbbr];
            foreach ($userPlayers as $player) {
                $currentFatigue = $player->fatigue ?? 0;
                if ($currentFatigue > 0) {
                    $playerArr = $player->toArray();
                    $totalRecovery = 0;
                    for ($i = 0; $i < $days; $i++) {
                        $totalRecovery += $this->getAttributeWeightedRecovery($playerArr, $restRecovery);
                    }
                    $player->update(['fatigue' => max(0, $currentFatigue - $totalRecovery)]);
                }
            }
            unset($restDaysPerTeam[$userTeamAbbr]);
        }

        // Process league teams
        if (!empty($restDaysPerTeam)) {
            $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
            $modified = false;

            foreach ($leaguePlayers as &$player) {
                $teamAbbr = $player['teamAbbreviation'] ?? '';
                if (isset($restDaysPerTeam[$teamAbbr])) {
                    $currentFatigue = $player['fatigue'] ?? 0;
                    if ($currentFatigue > 0) {
                        $days = $restDaysPerTeam[$teamAbbr];
                        $totalRecovery = 0;
                        for ($i = 0; $i < $days; $i++) {
                            $totalRecovery += $this->getAttributeWeightedRecovery($player, $restRecovery);
                        }
                        $player['fatigue'] = max(0, $currentFatigue - $totalRecovery);
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
                    $playerArr = $player->toArray();
                    $recovery = $this->getAttributeWeightedRecovery($playerArr, $restRecovery);
                    $player->update(['fatigue' => max(0, $currentFatigue - $recovery)]);
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
                        $recovery = $this->getAttributeWeightedRecovery($player, $restRecovery);
                        $player['fatigue'] = max(0, $currentFatigue - $recovery);
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
            'upgrade_points' => $player['upgrade_points'] ?? $player['upgradePoints'] ?? 0,
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
