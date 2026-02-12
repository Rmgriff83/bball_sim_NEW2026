<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\NewsEvent;
use App\Models\Player;
use App\Models\Team;
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;

class AllStarService
{
    private const ALL_STAR_MONTH = 2;
    private const ALL_STAR_DAY = 12;
    private const ALL_STAR_MIN_GAMES_PCT = 0.60;
    private const RISING_STARS_MIN_GAMES_PCT = 0.40;

    public function __construct(
        private CampaignSeasonService $seasonService,
        private CampaignPlayerService $playerService
    ) {}

    /**
     * Process All-Star and Rising Stars selections if date conditions are met.
     */
    public function processAllStarSelections(Campaign $campaign): ?array
    {
        $settings = $campaign->settings ?? [];
        $year = $campaign->currentSeason?->year ?? $campaign->game_year ?? 2025;
        $flagKey = "all_star_selected_{$year}";

        // Already processed this season
        if ($settings[$flagKey] ?? false) {
            return null;
        }

        // Check if current date >= Feb 12 of season+1 year
        $triggerDate = Carbon::create($year + 1, self::ALL_STAR_MONTH, self::ALL_STAR_DAY);
        if ($campaign->current_date->lt($triggerDate)) {
            return null;
        }

        Log::info("Processing All-Star selections for campaign {$campaign->id}, season {$year}");

        // Gather data
        $allStats = $this->seasonService->getAllPlayerStats($campaign->id, $year);
        $standings = $this->seasonService->getStandings($campaign->id, $year);
        $leaguePlayers = $this->playerService->loadLeaguePlayers($campaign->id);
        $teams = Team::where('campaign_id', $campaign->id)->get()->keyBy('id');
        $dbPlayers = Player::where('campaign_id', $campaign->id)->get();

        // Build team win percentages from standings
        $teamWinPcts = $this->buildTeamWinPcts($standings);

        // Build unified player lookup
        $playerLookup = $this->buildPlayerLookup($dbPlayers, $leaguePlayers, $teams);

        // Select All-Stars
        $allStars = $this->selectTeam($allStats, $playerLookup, $teamWinPcts, $teams, false, $year);

        // Select Rising Stars
        $risingStars = $this->selectTeam($allStats, $playerLookup, $teamWinPcts, $teams, true, $year);

        // Persist selections
        $this->persistSelections($campaign, $allStars, $risingStars, $year, $dbPlayers, $leaguePlayers);

        // Create news events
        $this->createNewsEvents($campaign, $allStars, $risingStars, $playerLookup);

        // Build rosters data for storage
        $rosters = [
            'allStars' => $allStars,
            'risingStars' => $risingStars,
        ];

        // Set flags in campaign settings
        $settings[$flagKey] = true;
        $settings["all_star_rosters_{$year}"] = $rosters;
        $settings["all_star_viewed_{$year}"] = false;
        $campaign->update(['settings' => $settings]);

        // Also save to season JSON
        $season = $this->seasonService->loadSeason($campaign->id, $year);
        if ($season) {
            $season['allStarRosters'] = $rosters;
            $this->seasonService->saveSeason($campaign->id, $year, $season);
        }

        Log::info("All-Star selections completed for campaign {$campaign->id}");

        return $rosters;
    }

    /**
     * Build team win percentages from standings data.
     */
    private function buildTeamWinPcts(array $standings): array
    {
        $winPcts = [];
        foreach (['east', 'west'] as $conf) {
            foreach ($standings[$conf] ?? [] as $standing) {
                $teamId = $standing['teamId'] ?? null;
                if (!$teamId) continue;
                $wins = $standing['wins'] ?? 0;
                $losses = $standing['losses'] ?? 0;
                $total = $wins + $losses;
                $winPcts[$teamId] = $total > 0 ? $wins / $total : 0;
            }
        }
        return $winPcts;
    }

    /**
     * Build a unified player lookup from DB players and JSON league players.
     */
    private function buildPlayerLookup($dbPlayers, array $leaguePlayers, $teams): array
    {
        $lookup = [];

        // DB players (user's team)
        foreach ($dbPlayers as $player) {
            $team = $teams[$player->team_id] ?? null;
            $lookup[(string)$player->id] = [
                'playerId' => (string)$player->id,
                'playerName' => $player->first_name . ' ' . $player->last_name,
                'position' => $player->position,
                'secondaryPosition' => $player->secondary_position,
                'draftYear' => $player->draft_year,
                'teamId' => $player->team_id,
                'teamAbbr' => $team?->abbreviation ?? '???',
                'teamColor' => $team?->primary_color ?? '#6B7280',
                'conference' => $team?->conference ?? 'east',
                'overallRating' => $player->overall_rating,
                'isDbPlayer' => true,
            ];
        }

        // JSON players (AI teams)
        foreach ($leaguePlayers as $player) {
            $playerId = (string)($player['id'] ?? '');
            if (!$playerId) continue;

            $teamAbbr = $player['teamAbbreviation'] ?? 'FA';
            if ($teamAbbr === 'FA') continue; // Skip free agents

            // Find team by abbreviation
            $team = $teams->first(fn($t) => $t->abbreviation === $teamAbbr);
            if (!$team) continue;

            $firstName = $player['firstName'] ?? $player['first_name'] ?? '';
            $lastName = $player['lastName'] ?? $player['last_name'] ?? '';

            $lookup[$playerId] = [
                'playerId' => $playerId,
                'playerName' => trim($firstName . ' ' . $lastName),
                'position' => $player['position'] ?? 'SG',
                'secondaryPosition' => $player['secondaryPosition'] ?? $player['secondary_position'] ?? null,
                'draftYear' => $player['draftYear'] ?? $player['draft_year'] ?? null,
                'teamId' => $team->id,
                'teamAbbr' => $team->abbreviation,
                'teamColor' => $team->primary_color ?? '#6B7280',
                'conference' => $team->conference ?? 'east',
                'overallRating' => $player['overallRating'] ?? $player['overall_rating'] ?? 70,
                'isDbPlayer' => false,
            ];
        }

        return $lookup;
    }

    /**
     * Select All-Star or Rising Stars teams for both conferences.
     */
    private function selectTeam(
        array $allStats,
        array $playerLookup,
        array $teamWinPcts,
        $teams,
        bool $risingStarsOnly,
        int $seasonYear
    ): array {
        // Find max games played to compute threshold
        $maxGames = 0;
        foreach ($allStats as $stats) {
            $gp = $stats['gamesPlayed'] ?? 0;
            if ($gp > $maxGames) $maxGames = $gp;
        }

        $minGamesPct = $risingStarsOnly ? self::RISING_STARS_MIN_GAMES_PCT : self::ALL_STAR_MIN_GAMES_PCT;
        $minGames = (int)ceil($maxGames * $minGamesPct);

        // Score eligible players
        $scoredPlayers = [];
        foreach ($allStats as $playerId => $stats) {
            $playerId = (string)$playerId;
            $gp = $stats['gamesPlayed'] ?? 0;

            // Min games filter
            if ($gp < $minGames) continue;

            // Must exist in player lookup
            $playerInfo = $playerLookup[$playerId] ?? null;
            if (!$playerInfo) continue;

            // Rising Stars filter: rookies and 2nd-year players
            if ($risingStarsOnly) {
                $draftYear = $playerInfo['draftYear'] ?? null;
                if ($draftYear === null || $draftYear < $seasonYear - 1) continue;
            }

            $teamWinPct = $teamWinPcts[$playerInfo['teamId']] ?? 0;
            $score = $this->scorePlayer($stats, $teamWinPct);

            $scoredPlayers[$playerId] = [
                'playerId' => $playerId,
                'playerName' => $playerInfo['playerName'],
                'teamId' => $playerInfo['teamId'],
                'teamAbbr' => $playerInfo['teamAbbr'],
                'teamColor' => $playerInfo['teamColor'],
                'position' => $playerInfo['position'],
                'secondaryPosition' => $playerInfo['secondaryPosition'],
                'conference' => $playerInfo['conference'],
                'stats' => [
                    'ppg' => round(($stats['points'] ?? 0) / $gp, 1),
                    'rpg' => round(($stats['rebounds'] ?? 0) / $gp, 1),
                    'apg' => round(($stats['assists'] ?? 0) / $gp, 1),
                    'spg' => round(($stats['steals'] ?? 0) / $gp, 1),
                    'bpg' => round(($stats['blocks'] ?? 0) / $gp, 1),
                ],
                'score' => round($score, 1),
            ];
        }

        // Split by conference
        $eastPlayers = array_filter($scoredPlayers, fn($p) => $p['conference'] === 'east');
        $westPlayers = array_filter($scoredPlayers, fn($p) => $p['conference'] === 'west');

        return [
            'east' => $this->selectConference($eastPlayers, $risingStarsOnly),
            'west' => $this->selectConference($westPlayers, $risingStarsOnly),
        ];
    }

    /**
     * Score a player for All-Star consideration.
     */
    private function scorePlayer(array $stats, float $teamWinPct): float
    {
        $gp = $stats['gamesPlayed'] ?? 1;
        if ($gp === 0) $gp = 1;

        $ppg = ($stats['points'] ?? 0) / $gp;
        $rpg = ($stats['rebounds'] ?? 0) / $gp;
        $apg = ($stats['assists'] ?? 0) / $gp;
        $spg = ($stats['steals'] ?? 0) / $gp;
        $bpg = ($stats['blocks'] ?? 0) / $gp;
        $tovpg = ($stats['turnovers'] ?? 0) / $gp;

        $statScore = ($ppg * 3) + ($rpg * 2) + ($apg * 2.5) + ($spg * 2) + ($bpg * 1.5) - ($tovpg * 1);
        $teamBonus = $teamWinPct * 10;

        return $statScore + $teamBonus;
    }

    /**
     * Select starters and reserves for one conference.
     */
    private function selectConference(array $conferencePlayers, bool $risingStarsOnly = false): array
    {
        $positions = ['PG', 'SG', 'SF', 'PF', 'C'];
        $starters = [];
        $pool = $conferencePlayers;

        // Sort pool by score descending for starter selection
        uasort($pool, fn($a, $b) => $b['score'] <=> $a['score']);

        // Select one starter per position
        foreach ($positions as $pos) {
            $bestForPos = null;
            $bestId = null;

            foreach ($pool as $id => $player) {
                if ($player['position'] === $pos || $player['secondaryPosition'] === $pos) {
                    if ($bestForPos === null || $player['score'] > $bestForPos['score']) {
                        $bestForPos = $player;
                        $bestId = $id;
                    }
                }
            }

            if ($bestForPos) {
                $bestForPos['starterPosition'] = $pos;
                $starters[$pos] = $bestForPos;
                unset($pool[$bestId]);
            }
        }

        // Sort remaining by score, take top 7 as reserves
        uasort($pool, fn($a, $b) => $b['score'] <=> $a['score']);

        $maxReserves = $risingStarsOnly ? min(7, count($pool)) : 7;
        $reserves = array_values(array_slice($pool, 0, $maxReserves, true));

        return [
            'starters' => $starters,
            'reserves' => $reserves,
        ];
    }

    /**
     * Persist All-Star selections to player records.
     */
    private function persistSelections(
        Campaign $campaign,
        array $allStars,
        array $risingStars,
        int $year,
        $dbPlayers,
        array $leaguePlayers
    ): void {
        // Collect all selected player IDs (deduplicate between All-Star and Rising Stars)
        $selectedPlayerIds = $this->collectSelectedPlayerIds($allStars);
        $risingStarIds = $this->collectSelectedPlayerIds($risingStars);

        // Merge (player only gets +1 even if in both)
        $allSelectedIds = array_unique(array_merge($selectedPlayerIds, $risingStarIds));

        // Update DB players (user's team)
        $dbPlayerIds = $dbPlayers->pluck('id')->map(fn($id) => (string)$id)->toArray();
        $dbSelectedIds = array_intersect($allSelectedIds, $dbPlayerIds);

        if (!empty($dbSelectedIds)) {
            Player::where('campaign_id', $campaign->id)
                ->whereIn('id', $dbSelectedIds)
                ->increment('all_star_selections');
        }

        // Update JSON players (AI teams)
        $jsonSelectedIds = array_diff($allSelectedIds, $dbPlayerIds);
        if (!empty($jsonSelectedIds)) {
            $updates = [];
            foreach ($jsonSelectedIds as $playerId) {
                // Find current value
                $currentVal = 0;
                foreach ($leaguePlayers as $lp) {
                    if ((string)($lp['id'] ?? '') === $playerId) {
                        $currentVal = $lp['allStarSelections'] ?? $lp['all_star_selections'] ?? 0;
                        break;
                    }
                }
                $updates[$playerId] = [
                    'allStarSelections' => $currentVal + 1,
                    'all_star_selections' => $currentVal + 1,
                ];
            }
            $this->playerService->updateLeaguePlayersBatch($campaign->id, $updates);
        }
    }

    /**
     * Collect all player IDs from a selection result.
     */
    private function collectSelectedPlayerIds(array $selection): array
    {
        $ids = [];
        foreach (['east', 'west'] as $conf) {
            foreach ($selection[$conf]['starters'] ?? [] as $player) {
                $ids[] = (string)$player['playerId'];
            }
            foreach ($selection[$conf]['reserves'] ?? [] as $player) {
                $ids[] = (string)$player['playerId'];
            }
        }
        return $ids;
    }

    /**
     * Create news events for All-Star announcements.
     */
    private function createNewsEvents(Campaign $campaign, array $allStars, array $risingStars, array $playerLookup): void
    {
        // Build body with starter names
        $bodyParts = [];

        foreach (['east' => 'Eastern', 'west' => 'Western'] as $conf => $confName) {
            $starters = $allStars[$conf]['starters'] ?? [];
            $names = array_map(fn($p) => $p['playerName'], $starters);
            if (!empty($names)) {
                $bodyParts[] = "{$confName} Conference starters: " . implode(', ', $names);
            }
        }

        $body = implode('. ', $bodyParts) . '.';

        // Main announcement
        NewsEvent::create([
            'campaign_id' => $campaign->id,
            'event_type' => 'award',
            'headline' => 'All-Star & Rising Stars teams announced',
            'body' => $body,
            'game_date' => $campaign->current_date,
        ]);

        // Individual news for user team players selected
        $userTeamId = $campaign->team_id;
        $allSelectedIds = array_unique(array_merge(
            $this->collectSelectedPlayerIds($allStars),
            $this->collectSelectedPlayerIds($risingStars)
        ));

        foreach ($allSelectedIds as $playerId) {
            $playerInfo = $playerLookup[$playerId] ?? null;
            if (!$playerInfo || $playerInfo['teamId'] !== $userTeamId) continue;

            $inAllStar = in_array($playerId, $this->collectSelectedPlayerIds($allStars));
            $inRising = in_array($playerId, $this->collectSelectedPlayerIds($risingStars));

            $label = $inAllStar && $inRising
                ? 'All-Star & Rising Stars'
                : ($inAllStar ? 'All-Star' : 'Rising Stars');

            NewsEvent::create([
                'campaign_id' => $campaign->id,
                'event_type' => 'award',
                'headline' => "{$playerInfo['playerName']} selected to {$label} team",
                'body' => "Your player {$playerInfo['playerName']} has been named to the {$label} team this season.",
                'player_id' => is_numeric($playerId) ? (int)$playerId : null,
                'team_id' => $userTeamId,
                'game_date' => $campaign->current_date,
            ]);
        }
    }
}
