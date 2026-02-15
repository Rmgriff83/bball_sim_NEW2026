<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\Player;
use App\Models\Team;
use Illuminate\Support\Facades\Storage;

class PlayoffService
{
    public function __construct(
        private CampaignSeasonService $seasonService
    ) {}

    /**
     * Generate the playoff bracket based on final standings.
     */
    public function generatePlayoffBracket(Campaign $campaign): array
    {
        $year = $campaign->currentSeason?->year ?? 2025;
        $standings = $this->seasonService->getStandings($campaign->id, $year);

        // Get top 8 from each conference
        $eastTeams = $this->getPlayoffTeams($campaign->id, $standings['east']);
        $westTeams = $this->getPlayoffTeams($campaign->id, $standings['west']);

        // Create bracket structure
        $bracket = [
            'east' => [
                'round1' => [
                    $this->createMatchup($eastTeams[0], $eastTeams[7], 'east', 1, 'E_R1_1v8'),
                    $this->createMatchup($eastTeams[3], $eastTeams[4], 'east', 1, 'E_R1_4v5'),
                    $this->createMatchup($eastTeams[2], $eastTeams[5], 'east', 1, 'E_R1_3v6'),
                    $this->createMatchup($eastTeams[1], $eastTeams[6], 'east', 1, 'E_R1_2v7'),
                ],
                'round2' => [],
                'confFinals' => null,
                'confFinalsMVP' => null,
            ],
            'west' => [
                'round1' => [
                    $this->createMatchup($westTeams[0], $westTeams[7], 'west', 1, 'W_R1_1v8'),
                    $this->createMatchup($westTeams[3], $westTeams[4], 'west', 1, 'W_R1_4v5'),
                    $this->createMatchup($westTeams[2], $westTeams[5], 'west', 1, 'W_R1_3v6'),
                    $this->createMatchup($westTeams[1], $westTeams[6], 'west', 1, 'W_R1_2v7'),
                ],
                'round2' => [],
                'confFinals' => null,
                'confFinalsMVP' => null,
            ],
            'finals' => null,
            'finalsMVP' => null,
            'champion' => null,
        ];

        // Save bracket to season data
        $season = $this->seasonService->loadSeason($campaign->id, $year);
        $season['playoffBracket'] = $bracket;
        $this->seasonService->saveSeason($campaign->id, $year, $season);

        return $bracket;
    }

    /**
     * Get playoff teams from standings (top 8).
     */
    private function getPlayoffTeams(int $campaignId, array $conferenceStandings): array
    {
        // Sort by win percentage descending, then point differential as tiebreaker
        usort($conferenceStandings, function ($a, $b) {
            $totalA = $a['wins'] + $a['losses'];
            $totalB = $b['wins'] + $b['losses'];
            $pctA = $totalA > 0 ? $a['wins'] / $totalA : 0;
            $pctB = $totalB > 0 ? $b['wins'] / $totalB : 0;
            if ($pctA !== $pctB) return $pctB <=> $pctA;
            $diffA = ($a['pointsFor'] ?? 0) - ($a['pointsAgainst'] ?? 0);
            $diffB = ($b['pointsFor'] ?? 0) - ($b['pointsAgainst'] ?? 0);
            return $diffB <=> $diffA;
        });

        // Take top 8
        $top8 = array_slice($conferenceStandings, 0, 8);

        // Get full team info
        $teams = Team::where('campaign_id', $campaignId)
            ->whereIn('id', array_column($top8, 'teamId'))
            ->get()
            ->keyBy('id');

        $playoffTeams = [];
        foreach ($top8 as $index => $standing) {
            $team = $teams[$standing['teamId']] ?? null;
            if ($team) {
                $playoffTeams[] = [
                    'teamId' => $team->id,
                    'seed' => $index + 1,
                    'name' => $team->name,
                    'city' => $team->city,
                    'abbreviation' => $team->abbreviation,
                    'primaryColor' => $team->primary_color,
                    'wins' => $standing['wins'],
                    'losses' => $standing['losses'],
                ];
            }
        }

        return $playoffTeams;
    }

    /**
     * Create a playoff matchup.
     */
    private function createMatchup(array $higherSeed, array $lowerSeed, string $conference, int $round, string $seriesId): array
    {
        return [
            'seriesId' => $seriesId,
            'conference' => $conference,
            'round' => $round,
            'team1' => $higherSeed,
            'team2' => $lowerSeed,
            'team1Wins' => 0,
            'team2Wins' => 0,
            'games' => [],
            'status' => 'pending',
            'winner' => null,
            'seriesMVP' => null,
        ];
    }

    /**
     * Generate playoff schedule for a round.
     */
    public function generatePlayoffSchedule(Campaign $campaign, int $round): int
    {
        $year = $campaign->currentSeason?->year ?? 2025;
        $season = $this->seasonService->loadSeason($campaign->id, $year);
        $bracket = $season['playoffBracket'] ?? null;

        if (!$bracket) {
            return 0;
        }

        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('id');
        $schedule = $season['schedule'] ?? [];
        $gameNumber = count($schedule) + 1;
        $gamesCreated = 0;

        // Determine start date (after last regular season game)
        $lastGame = end($schedule);
        $startDate = $lastGame
            ? \Carbon\Carbon::parse($lastGame['gameDate'])->addDays(3)
            : \Carbon\Carbon::parse('2026-04-15');

        // Get series for this round
        $allSeries = $this->getSeriesForRound($bracket, $round);

        foreach ($allSeries as $series) {
            if ($series['status'] !== 'pending') {
                continue;
            }

            $homeTeam = $teams[$series['team1']['teamId']] ?? null;
            $awayTeam = $teams[$series['team2']['teamId']] ?? null;

            if (!$homeTeam || !$awayTeam) {
                continue;
            }

            // Schedule 7 potential games (2-2-1-1-1 format)
            $homeAwayPattern = [true, true, false, false, true, false, true]; // Home team perspective
            $gameDate = $startDate->copy();
            $seriesGames = [];

            for ($gameNum = 1; $gameNum <= 7; $gameNum++) {
                $isHomeGame = $homeAwayPattern[$gameNum - 1];
                $gameId = sprintf('game_%d_%04d', $year, $gameNumber);

                $game = [
                    'id' => $gameId,
                    'homeTeamId' => $isHomeGame ? $series['team1']['teamId'] : $series['team2']['teamId'],
                    'homeTeamAbbreviation' => $isHomeGame ? $homeTeam->abbreviation : $awayTeam->abbreviation,
                    'awayTeamId' => $isHomeGame ? $series['team2']['teamId'] : $series['team1']['teamId'],
                    'awayTeamAbbreviation' => $isHomeGame ? $awayTeam->abbreviation : $homeTeam->abbreviation,
                    'gameDate' => $gameDate->format('Y-m-d'),
                    'isPlayoff' => true,
                    'playoffRound' => $round,
                    'playoffSeriesId' => $series['seriesId'],
                    'playoffGameNumber' => $gameNum,
                    'isComplete' => false,
                    'homeScore' => null,
                    'awayScore' => null,
                    'boxScore' => null,
                ];

                $schedule[] = $game;
                $seriesGames[] = $gameId;
                $gameNumber++;
                $gamesCreated++;

                // Games every 2 days, extra day for travel games
                $gameDate->addDays($gameNum === 2 || $gameNum === 4 ? 3 : 2);
            }

            // Update series with game IDs
            $this->updateSeriesGames($season, $series['seriesId'], $seriesGames);
        }

        $season['schedule'] = $schedule;
        $this->seasonService->saveSeason($campaign->id, $year, $season);

        return $gamesCreated;
    }

    /**
     * Get all series for a given round.
     */
    private function getSeriesForRound(array $bracket, int $round): array
    {
        $series = [];

        if ($round === 1) {
            $series = array_merge($bracket['east']['round1'], $bracket['west']['round1']);
        } elseif ($round === 2) {
            $series = array_merge($bracket['east']['round2'] ?? [], $bracket['west']['round2'] ?? []);
        } elseif ($round === 3) {
            if ($bracket['east']['confFinals']) {
                $series[] = $bracket['east']['confFinals'];
            }
            if ($bracket['west']['confFinals']) {
                $series[] = $bracket['west']['confFinals'];
            }
        } elseif ($round === 4) {
            if ($bracket['finals']) {
                $series[] = $bracket['finals'];
            }
        }

        return $series;
    }

    /**
     * Update series with game IDs.
     */
    private function updateSeriesGames(array &$season, string $seriesId, array $gameIds): void
    {
        $bracket = &$season['playoffBracket'];

        foreach (['east', 'west'] as $conf) {
            foreach (['round1', 'round2'] as $round) {
                if (!isset($bracket[$conf][$round])) continue;
                foreach ($bracket[$conf][$round] as &$series) {
                    if ($series['seriesId'] === $seriesId) {
                        $series['games'] = $gameIds;
                        $series['status'] = 'in_progress';
                        return;
                    }
                }
            }
            if (isset($bracket[$conf]['confFinals']) && $bracket[$conf]['confFinals']['seriesId'] === $seriesId) {
                $bracket[$conf]['confFinals']['games'] = $gameIds;
                $bracket[$conf]['confFinals']['status'] = 'in_progress';
                return;
            }
        }

        if (isset($bracket['finals']) && $bracket['finals']['seriesId'] === $seriesId) {
            $bracket['finals']['games'] = $gameIds;
            $bracket['finals']['status'] = 'in_progress';
        }
    }

    /**
     * Update series after a game is completed.
     */
    public function updateSeriesAfterGame(Campaign $campaign, array $game, int $homeScore, int $awayScore): ?array
    {
        if (!($game['isPlayoff'] ?? false) || !isset($game['playoffSeriesId'])) {
            return null;
        }

        $year = $campaign->currentSeason?->year ?? 2025;
        $season = $this->seasonService->loadSeason($campaign->id, $year);
        $bracket = &$season['playoffBracket'];

        $seriesId = $game['playoffSeriesId'];
        $series = $this->findSeriesById($bracket, $seriesId);

        if (!$series) {
            return null;
        }

        // Determine winner
        $homeTeamId = $game['homeTeamId'];
        $team1Won = ($homeTeamId === $series['team1']['teamId'] && $homeScore > $awayScore) ||
                    ($homeTeamId === $series['team2']['teamId'] && $awayScore > $homeScore);

        // Update wins
        if ($team1Won) {
            $series['team1Wins']++;
        } else {
            $series['team2Wins']++;
        }

        // Check if series is complete
        $seriesComplete = $series['team1Wins'] >= 4 || $series['team2Wins'] >= 4;

        if ($seriesComplete) {
            $series['status'] = 'complete';
            $series['winner'] = $series['team1Wins'] >= 4 ? $series['team1'] : $series['team2'];

            // Calculate series MVP
            $mvp = $this->calculateSeriesMVP($campaign, $series);
            $series['seriesMVP'] = $mvp;
        }

        // Update series in bracket
        $this->updateSeriesInBracket($bracket, $seriesId, $series);

        // Save updated bracket
        $season['playoffBracket'] = $bracket;
        $this->seasonService->saveSeason($campaign->id, $year, $season);

        $result = [
            'seriesId' => $seriesId,
            'series' => $series,
            'seriesComplete' => $seriesComplete,
            'round' => $game['playoffRound'],
        ];

        if ($seriesComplete) {
            $result['winner'] = $series['winner'];
            $result['seriesMVP'] = $series['seriesMVP'];

            // Check if this was conference finals or finals
            if ($game['playoffRound'] === 3) {
                $result['isConferenceFinals'] = true;
            } elseif ($game['playoffRound'] === 4) {
                $result['isFinals'] = true;
                $result['isChampion'] = true;
            }
        }

        return $result;
    }

    /**
     * Find a series by its ID in the bracket.
     */
    private function findSeriesById(array $bracket, string $seriesId): ?array
    {
        foreach (['east', 'west'] as $conf) {
            foreach (['round1', 'round2'] as $round) {
                if (!isset($bracket[$conf][$round])) continue;
                foreach ($bracket[$conf][$round] as $series) {
                    if ($series['seriesId'] === $seriesId) {
                        return $series;
                    }
                }
            }
            if (isset($bracket[$conf]['confFinals']) && $bracket[$conf]['confFinals']['seriesId'] === $seriesId) {
                return $bracket[$conf]['confFinals'];
            }
        }

        if (isset($bracket['finals']) && $bracket['finals']['seriesId'] === $seriesId) {
            return $bracket['finals'];
        }

        return null;
    }

    /**
     * Update a series in the bracket.
     */
    private function updateSeriesInBracket(array &$bracket, string $seriesId, array $updatedSeries): void
    {
        foreach (['east', 'west'] as $conf) {
            foreach (['round1', 'round2'] as $round) {
                if (!isset($bracket[$conf][$round])) continue;
                foreach ($bracket[$conf][$round] as &$series) {
                    if ($series['seriesId'] === $seriesId) {
                        $series = $updatedSeries;
                        return;
                    }
                }
            }
            if (isset($bracket[$conf]['confFinals']) && $bracket[$conf]['confFinals']['seriesId'] === $seriesId) {
                $bracket[$conf]['confFinals'] = $updatedSeries;
                return;
            }
        }

        if (isset($bracket['finals']) && $bracket['finals']['seriesId'] === $seriesId) {
            $bracket['finals'] = $updatedSeries;
        }
    }

    /**
     * Calculate the series MVP based on aggregate stats.
     * Score = (PTS * 1.0) + (REB * 1.2) + (AST * 1.5) + (STL * 3.0) + (BLK * 3.0) - (TO * 1.5)
     */
    public function calculateSeriesMVP(Campaign $campaign, array $series): ?array
    {
        $year = $campaign->currentSeason?->year ?? 2025;
        $season = $this->seasonService->loadSeason($campaign->id, $year);

        if (!$season || empty($series['games'])) {
            return null;
        }

        // Get winning team ID
        $winningTeamId = $series['winner']['teamId'] ?? null;
        if (!$winningTeamId) {
            return null;
        }

        // Aggregate stats for all players from winning team across series games
        $playerStats = [];
        $gamesPlayed = 0;

        foreach ($series['games'] as $gameId) {
            $game = $this->seasonService->getGame($campaign->id, $year, $gameId);
            if (!$game || !$game['isComplete'] || !isset($game['boxScore'])) {
                continue;
            }

            $gamesPlayed++;

            // Determine which side the winning team was on
            $side = $game['homeTeamId'] == $winningTeamId ? 'home' : 'away';

            foreach ($game['boxScore'][$side] ?? [] as $playerGame) {
                $playerId = $playerGame['player_id'] ?? $playerGame['playerId'] ?? null;
                if (!$playerId) continue;

                if (!isset($playerStats[$playerId])) {
                    $playerStats[$playerId] = [
                        'playerId' => $playerId,
                        'name' => $playerGame['name'] ?? 'Unknown',
                        'points' => 0,
                        'rebounds' => 0,
                        'assists' => 0,
                        'steals' => 0,
                        'blocks' => 0,
                        'turnovers' => 0,
                        'games' => 0,
                    ];
                }

                $playerStats[$playerId]['points'] += $playerGame['points'] ?? 0;
                $playerStats[$playerId]['rebounds'] += $playerGame['rebounds'] ?? 0;
                $playerStats[$playerId]['assists'] += $playerGame['assists'] ?? 0;
                $playerStats[$playerId]['steals'] += $playerGame['steals'] ?? 0;
                $playerStats[$playerId]['blocks'] += $playerGame['blocks'] ?? 0;
                $playerStats[$playerId]['turnovers'] += $playerGame['turnovers'] ?? 0;
                $playerStats[$playerId]['games']++;
            }
        }

        if (empty($playerStats)) {
            return null;
        }

        // Calculate MVP score for each player
        $bestPlayer = null;
        $bestScore = -999;

        foreach ($playerStats as $playerId => $stats) {
            if ($stats['games'] < 2) continue; // Must have played at least 2 games

            $score = ($stats['points'] * 1.0)
                   + ($stats['rebounds'] * 1.2)
                   + ($stats['assists'] * 1.5)
                   + ($stats['steals'] * 3.0)
                   + ($stats['blocks'] * 3.0)
                   - ($stats['turnovers'] * 1.5);

            if ($score > $bestScore) {
                $bestScore = $score;
                $bestPlayer = $stats;
            }
        }

        if (!$bestPlayer) {
            return null;
        }

        // Calculate averages
        $games = $bestPlayer['games'];
        return [
            'playerId' => $bestPlayer['playerId'],
            'name' => $bestPlayer['name'],
            'teamId' => $winningTeamId,
            'ppg' => round($bestPlayer['points'] / $games, 1),
            'rpg' => round($bestPlayer['rebounds'] / $games, 1),
            'apg' => round($bestPlayer['assists'] / $games, 1),
            'spg' => round($bestPlayer['steals'] / $games, 1),
            'bpg' => round($bestPlayer['blocks'] / $games, 1),
            'mvpScore' => round($bestScore, 1),
        ];
    }

    /**
     * Advance winner to next round.
     */
    public function advanceWinnerToNextRound(Campaign $campaign, array $completedSeries): void
    {
        $year = $campaign->currentSeason?->year ?? 2025;
        $season = $this->seasonService->loadSeason($campaign->id, $year);
        $bracket = &$season['playoffBracket'];

        $series = $completedSeries['series'];
        $winner = $series['winner'];
        $round = $completedSeries['round'];
        $conference = $series['conference'] ?? null;

        if ($round === 1) {
            // Advance to round 2
            $this->createRound2MatchupIfReady($bracket, $conference);
        } elseif ($round === 2) {
            // Advance to conference finals
            $this->createConferenceFinals($bracket, $conference);
        } elseif ($round === 3) {
            // Advance to finals
            $this->createFinalsIfReady($bracket);
        } elseif ($round === 4) {
            // Championship!
            $bracket['champion'] = $winner;
        }

        $season['playoffBracket'] = $bracket;
        $this->seasonService->saveSeason($campaign->id, $year, $season);
    }

    /**
     * Create round 2 matchup when both required round 1 series are complete.
     */
    private function createRound2MatchupIfReady(array &$bracket, string $conference): void
    {
        $round1 = $bracket[$conference]['round1'];

        // Check 1v8 and 4v5 matchup
        $series1 = $round1[0]; // 1v8
        $series2 = $round1[1]; // 4v5
        if ($series1['status'] === 'complete' && $series2['status'] === 'complete'
            && count($bracket[$conference]['round2']) < 1) {
            $confPrefix = strtoupper(substr($conference, 0, 1));
            $bracket[$conference]['round2'][] = $this->createMatchup(
                $series1['winner'],
                $series2['winner'],
                $conference,
                2,
                "{$confPrefix}_R2_A"
            );
        }

        // Check 3v6 and 2v7 matchup
        $series3 = $round1[2]; // 3v6
        $series4 = $round1[3]; // 2v7
        if ($series3['status'] === 'complete' && $series4['status'] === 'complete'
            && count($bracket[$conference]['round2']) < 2) {
            $confPrefix = strtoupper(substr($conference, 0, 1));
            $bracket[$conference]['round2'][] = $this->createMatchup(
                $series4['winner'], // 2v7 winner (higher seed branch)
                $series3['winner'], // 3v6 winner
                $conference,
                2,
                "{$confPrefix}_R2_B"
            );
        }
    }

    /**
     * Create conference finals when both round 2 series are complete.
     */
    private function createConferenceFinals(array &$bracket, string $conference): void
    {
        $round2 = $bracket[$conference]['round2'] ?? [];

        if (count($round2) < 2) return;

        $series1 = $round2[0];
        $series2 = $round2[1];

        if ($series1['status'] === 'complete' && $series2['status'] === 'complete'
            && !$bracket[$conference]['confFinals']) {
            $confPrefix = strtoupper(substr($conference, 0, 1));
            $bracket[$conference]['confFinals'] = $this->createMatchup(
                $series1['winner'],
                $series2['winner'],
                $conference,
                3,
                "{$confPrefix}_CF"
            );
        }
    }

    /**
     * Create NBA Finals when both conference finals are complete.
     */
    private function createFinalsIfReady(array &$bracket): void
    {
        $eastCF = $bracket['east']['confFinals'] ?? null;
        $westCF = $bracket['west']['confFinals'] ?? null;

        if ($eastCF && $westCF &&
            $eastCF['status'] === 'complete' && $westCF['status'] === 'complete' &&
            !$bracket['finals']) {
            $bracket['finals'] = $this->createMatchup(
                $eastCF['winner'],
                $westCF['winner'],
                'finals',
                4,
                'FINALS'
            );
        }
    }

    /**
     * Persist a player award (for database players).
     */
    public function persistPlayerAward(Campaign $campaign, $playerId, string $awardType, int $year): void
    {
        // Try to find in database first
        $player = Player::find($playerId);

        if ($player) {
            // Database player
            $column = match($awardType) {
                'finals_mvp' => 'finals_mvp_awards',
                'conference_finals_mvp' => 'conference_finals_mvp_awards',
                'championship' => 'championships',
                default => null,
            };

            if ($column) {
                $player->increment($column);
            }
        } else {
            // AI/JSON player - store in league_players.json
            $this->persistAIPlayerAward($campaign->id, $playerId, $awardType, $year);
        }
    }

    /**
     * Persist award for AI team player (stored in JSON).
     */
    private function persistAIPlayerAward(int $campaignId, string $playerId, string $awardType, int $year): void
    {
        $path = "campaigns/{$campaignId}/league_players.json";

        if (!Storage::exists($path)) {
            return;
        }

        $players = json_decode(Storage::get($path), true);

        foreach ($players as &$player) {
            if (($player['id'] ?? null) == $playerId) {
                $player['awards'] = $player['awards'] ?? [];
                $player['awards'][$awardType] = $player['awards'][$awardType] ?? [];
                $player['awards'][$awardType][] = $year;
                break;
            }
        }

        Storage::put($path, json_encode($players));
    }

    /**
     * Persist championship to all players on winning team's roster.
     */
    public function persistChampionshipToRoster(Campaign $campaign, int $teamId, int $year): void
    {
        // Update database players
        Player::where('team_id', $teamId)->increment('championships');

        // Update AI players if this is an AI team
        $team = Team::find($teamId);
        if ($team && $team->id !== $campaign->team_id) {
            $path = "campaigns/{$campaign->id}/league_players.json";

            if (Storage::exists($path)) {
                $players = json_decode(Storage::get($path), true);

                foreach ($players as &$player) {
                    if (($player['team_id'] ?? null) == $teamId) {
                        $player['awards'] = $player['awards'] ?? [];
                        $player['awards']['championship'] = $player['awards']['championship'] ?? [];
                        $player['awards']['championship'][] = $year;
                    }
                }

                Storage::put($path, json_encode($players));
            }
        }
    }

    /**
     * Get the current playoff bracket.
     */
    public function getBracket(Campaign $campaign): ?array
    {
        $year = $campaign->currentSeason?->year ?? 2025;
        $season = $this->seasonService->loadSeason($campaign->id, $year);

        return $season['playoffBracket'] ?? null;
    }

    /**
     * Get a specific series by ID.
     */
    public function getSeries(Campaign $campaign, string $seriesId): ?array
    {
        $bracket = $this->getBracket($campaign);

        if (!$bracket) {
            return null;
        }

        return $this->findSeriesById($bracket, $seriesId);
    }

    /**
     * Check if regular season is complete.
     * Season is complete when every scheduled regular-season game is done.
     * Works for both old (68-game) and new (54-game) campaigns.
     */
    public function isRegularSeasonComplete(Campaign $campaign): bool
    {
        $year = $campaign->currentSeason?->year ?? 2025;
        $schedule = $this->seasonService->getSchedule($campaign->id, $year);

        // Filter to regular season games only
        $regularSeasonGames = array_filter($schedule, fn($g) => !($g['isPlayoff'] ?? false));

        if (empty($regularSeasonGames)) {
            return false;
        }

        // Season is complete when every regular season game is done
        foreach ($regularSeasonGames as $game) {
            if (!($game['isComplete'] ?? false)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Get user's playoff status (qualification, seed, opponent).
     */
    public function getUserPlayoffStatus(Campaign $campaign): array
    {
        $year = $campaign->currentSeason?->year ?? 2025;
        $standings = $this->seasonService->getStandings($campaign->id, $year);
        $userTeamId = $campaign->team_id;

        // Find user's standing
        $userStanding = null;
        $userConference = null;
        $seed = null;

        foreach (['east', 'west'] as $conf) {
            $sorted = $standings[$conf];
            usort($sorted, function ($a, $b) {
                $totalA = $a['wins'] + $a['losses'];
                $totalB = $b['wins'] + $b['losses'];
                $pctA = $totalA > 0 ? $a['wins'] / $totalA : 0;
                $pctB = $totalB > 0 ? $b['wins'] / $totalB : 0;
                if ($pctA !== $pctB) return $pctB <=> $pctA;
                $diffA = ($a['pointsFor'] ?? 0) - ($a['pointsAgainst'] ?? 0);
                $diffB = ($b['pointsFor'] ?? 0) - ($b['pointsAgainst'] ?? 0);
                return $diffB <=> $diffA;
            });

            foreach ($sorted as $index => $standing) {
                if ($standing['teamId'] == $userTeamId) {
                    $userStanding = $standing;
                    $userConference = $conf;
                    $seed = $index + 1;
                    break 2;
                }
            }
        }

        if (!$userStanding) {
            return ['qualified' => false];
        }

        $qualified = $seed <= 8;

        $result = [
            'qualified' => $qualified,
            'seed' => $seed,
            'conference' => $userConference,
            'wins' => $userStanding['wins'],
            'losses' => $userStanding['losses'],
        ];

        if ($qualified) {
            // Get first round opponent
            $opponents = [1 => 8, 2 => 7, 3 => 6, 4 => 5, 5 => 4, 6 => 3, 7 => 2, 8 => 1];
            $opponentSeed = $opponents[$seed];

            $confStandings = $standings[$userConference];
            usort($confStandings, function ($a, $b) {
                $totalA = $a['wins'] + $a['losses'];
                $totalB = $b['wins'] + $b['losses'];
                $pctA = $totalA > 0 ? $a['wins'] / $totalA : 0;
                $pctB = $totalB > 0 ? $b['wins'] / $totalB : 0;
                if ($pctA !== $pctB) return $pctB <=> $pctA;
                $diffA = ($a['pointsFor'] ?? 0) - ($a['pointsAgainst'] ?? 0);
                $diffB = ($b['pointsFor'] ?? 0) - ($b['pointsAgainst'] ?? 0);
                return $diffB <=> $diffA;
            });

            if (isset($confStandings[$opponentSeed - 1])) {
                $opponentStanding = $confStandings[$opponentSeed - 1];
                $opponent = Team::find($opponentStanding['teamId']);

                if ($opponent) {
                    $result['opponent'] = [
                        'teamId' => $opponent->id,
                        'name' => $opponent->name,
                        'abbreviation' => $opponent->abbreviation,
                        'seed' => $opponentSeed,
                        'wins' => $opponentStanding['wins'],
                        'losses' => $opponentStanding['losses'],
                    ];
                }
            }
        }

        return $result;
    }

    /**
     * Get the next incomplete playoff series for the user's team.
     */
    public function getNextUserSeries(Campaign $campaign): ?array
    {
        $bracket = $this->getBracket($campaign);
        if (!$bracket) {
            return null;
        }

        $userTeamId = $campaign->team_id;

        // Search all series for user's team
        $allSeries = [];

        foreach (['east', 'west'] as $conf) {
            foreach ($bracket[$conf]['round1'] ?? [] as $series) {
                $allSeries[] = $series;
            }
            foreach ($bracket[$conf]['round2'] ?? [] as $series) {
                $allSeries[] = $series;
            }
            if ($bracket[$conf]['confFinals'] ?? null) {
                $allSeries[] = $bracket[$conf]['confFinals'];
            }
        }

        if ($bracket['finals'] ?? null) {
            $allSeries[] = $bracket['finals'];
        }

        foreach ($allSeries as $series) {
            if ($series['status'] !== 'complete' &&
                ($series['team1']['teamId'] == $userTeamId || $series['team2']['teamId'] == $userTeamId)) {
                return $series;
            }
        }

        return null;
    }
}
