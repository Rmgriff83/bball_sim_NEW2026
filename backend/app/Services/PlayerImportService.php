<?php

namespace App\Services;

use App\Models\Player;
use App\Models\Team;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PlayerImportService
{
    private array $nameTransformations;
    private array $teamLookup = [];

    public function __construct()
    {
        $this->nameTransformations = config('player_names', []);
    }

    public function import(
        string $allPlayersPath,
        string $currentPlayersPath,
        int $campaignId,
        bool $dryRun,
        Command $output
    ): array {
        // Load current players CSV to get the list of players we want and their teams
        $output->info('Loading current players CSV...');
        $currentPlayers = $this->loadCurrentPlayersCsv($currentPlayersPath);
        $output->line("  Found {$currentPlayers['count']} current players");

        // Load all players CSV with full ratings data
        $output->info('Loading all players CSV...');
        $allPlayers = $this->loadAllPlayersCsv($allPlayersPath);
        $output->line("  Found {$allPlayers['count']} total players in database");

        // Build team lookup for the campaign
        $this->buildTeamLookup($campaignId);

        // Cross-reference to find current players with full data
        $output->info('Cross-referencing players...');
        $matchedPlayers = $this->crossReference($allPlayers['players'], $currentPlayers['players']);
        $output->line("  Matched " . count($matchedPlayers) . " current players");

        // Check for unmatched players
        $unmatchedCount = $currentPlayers['count'] - count($matchedPlayers);
        if ($unmatchedCount > 0) {
            $output->warn("  {$unmatchedCount} current players not found in ratings database");
        }

        // Display sample of what will be imported
        $this->displaySampleTable($matchedPlayers, $output);

        if ($dryRun) {
            return [
                'matched_count' => count($matchedPlayers),
                'unmatched_count' => $unmatchedCount,
            ];
        }

        // Perform actual import
        $output->info('Importing players...');
        $importedCount = $this->performImport($matchedPlayers, $campaignId, $output);

        return [
            'imported_count' => $importedCount,
            'matched_count' => count($matchedPlayers),
        ];
    }

    private function loadCurrentPlayersCsv(string $path): array
    {
        $players = [];
        $handle = fopen($path, 'r');

        // Read header row
        $headers = fgetcsv($handle);
        $headers = array_map('strtolower', array_map('trim', $headers));

        // CSV structure: playerid,fname,lname,position,height,weight,birthday,country,school,draft_year,draft_round,draft_number
        $fnameIndex = array_search('fname', $headers);
        $lnameIndex = array_search('lname', $headers);

        while (($row = fgetcsv($handle)) !== false) {
            $firstName = trim($row[$fnameIndex] ?? '');
            $lastName = trim($row[$lnameIndex] ?? '');
            $fullName = "{$firstName} {$lastName}";

            if ($firstName && $lastName) {
                $normalizedName = $this->normalizeName($fullName);
                $players[$normalizedName] = [
                    'original_name' => $fullName,
                    'first_name' => $firstName,
                    'last_name' => $lastName,
                    'team' => null, // Will be assigned to teams during import
                    'raw_data' => array_combine($headers, array_pad($row, count($headers), '')),
                ];
            }
        }

        fclose($handle);

        return [
            'count' => count($players),
            'players' => $players,
            'headers' => $headers,
        ];
    }

    private function loadAllPlayersCsv(string $path): array
    {
        $players = [];
        $handle = fopen($path, 'r');

        // Read header row
        $headers = fgetcsv($handle);
        $headers = array_map('strtolower', array_map('trim', $headers));

        while (($row = fgetcsv($handle)) !== false) {
            $rowData = array_combine($headers, array_pad($row, count($headers), ''));
            $name = $this->extractPlayerName($rowData, $headers);

            if ($name) {
                $normalizedName = $this->normalizeName($name);
                $players[$normalizedName] = [
                    'original_name' => $name,
                    'raw_data' => $rowData,
                    'headers' => $headers,
                ];
            }
        }

        fclose($handle);

        return [
            'count' => count($players),
            'players' => $players,
            'headers' => $headers,
        ];
    }

    private function extractPlayerName(array $row, array $headers): string
    {
        // Try common name column patterns
        $nameColumns = ['name', 'player', 'player_name', 'full_name'];
        foreach ($nameColumns as $col) {
            if (isset($row[$col]) && $row[$col]) {
                return trim($row[$col]);
            }
        }

        // Try first_name + last_name
        $firstName = $row['first_name'] ?? $row['firstname'] ?? '';
        $lastName = $row['last_name'] ?? $row['lastname'] ?? '';

        if ($firstName && $lastName) {
            return trim("{$firstName} {$lastName}");
        }

        return '';
    }

    private function findColumnIndex(array $headers, array $possibleNames): int
    {
        foreach ($possibleNames as $name) {
            $index = array_search(strtolower($name), $headers);
            if ($index !== false) {
                return $index;
            }
        }

        throw new \Exception("Could not find column. Tried: " . implode(', ', $possibleNames) . ". Available: " . implode(', ', $headers));
    }

    private function normalizeName(string $name): string
    {
        // Normalize for comparison: lowercase, remove punctuation, standardize spacing
        $normalized = strtolower($name);
        $normalized = preg_replace('/[^a-z0-9\s]/', '', $normalized);
        $normalized = preg_replace('/\s+/', ' ', $normalized);
        return trim($normalized);
    }

    private function buildTeamLookup(int $campaignId): void
    {
        $teams = Team::where('campaign_id', $campaignId)->get();

        foreach ($teams as $team) {
            // Map by abbreviation and variations
            $this->teamLookup[strtoupper($team->abbreviation)] = $team->id;
            $this->teamLookup[strtolower($team->name)] = $team->id;

            // Common variations
            $variations = $this->getTeamVariations($team->abbreviation);
            foreach ($variations as $variation) {
                $this->teamLookup[strtoupper($variation)] = $team->id;
            }
        }
    }

    private function getTeamVariations(string $abbrev): array
    {
        $variations = [
            'LAL' => ['LA Lakers', 'Lakers', 'Los Angeles Lakers'],
            'LAC' => ['LA Clippers', 'Clippers', 'Los Angeles Clippers'],
            'GSW' => ['GS', 'Warriors', 'Golden State', 'Golden State Warriors'],
            'NYK' => ['NY', 'Knicks', 'New York', 'New York Knicks'],
            'BKN' => ['BRK', 'Brooklyn', 'Nets', 'Brooklyn Nets'],
            'SAS' => ['SA', 'Spurs', 'San Antonio', 'San Antonio Spurs'],
            'NOP' => ['NO', 'Pelicans', 'New Orleans', 'New Orleans Pelicans'],
            'OKC' => ['Thunder', 'Oklahoma City', 'Oklahoma City Thunder'],
            'PHX' => ['PHO', 'Suns', 'Phoenix', 'Phoenix Suns'],
            'POR' => ['Portland', 'Trail Blazers', 'Blazers', 'Portland Trail Blazers'],
            'UTA' => ['Utah', 'Jazz', 'Utah Jazz'],
            'MEM' => ['Memphis', 'Grizzlies', 'Memphis Grizzlies'],
            'MIN' => ['Minnesota', 'Timberwolves', 'Wolves', 'Minnesota Timberwolves'],
            'DEN' => ['Denver', 'Nuggets', 'Denver Nuggets'],
            'SAC' => ['Sacramento', 'Kings', 'Sacramento Kings'],
            'DAL' => ['Dallas', 'Mavericks', 'Mavs', 'Dallas Mavericks'],
            'HOU' => ['Houston', 'Rockets', 'Houston Rockets'],
            'MIA' => ['Miami', 'Heat', 'Miami Heat'],
            'ORL' => ['Orlando', 'Magic', 'Orlando Magic'],
            'ATL' => ['Atlanta', 'Hawks', 'Atlanta Hawks'],
            'CHA' => ['CHO', 'Charlotte', 'Hornets', 'Charlotte Hornets'],
            'WAS' => ['WSH', 'Washington', 'Wizards', 'Washington Wizards'],
            'CHI' => ['Chicago', 'Bulls', 'Chicago Bulls'],
            'CLE' => ['Cleveland', 'Cavaliers', 'Cavs', 'Cleveland Cavaliers'],
            'DET' => ['Detroit', 'Pistons', 'Detroit Pistons'],
            'IND' => ['Indiana', 'Pacers', 'Indiana Pacers'],
            'MIL' => ['Milwaukee', 'Bucks', 'Milwaukee Bucks'],
            'TOR' => ['Toronto', 'Raptors', 'Toronto Raptors'],
            'BOS' => ['Boston', 'Celtics', 'Boston Celtics'],
            'PHI' => ['Philadelphia', '76ers', 'Sixers', 'Philadelphia 76ers'],
        ];

        return $variations[$abbrev] ?? [];
    }

    private function crossReference(array $allPlayers, array $currentPlayers): array
    {
        $matched = [];

        foreach ($currentPlayers as $normalizedName => $currentData) {
            if (isset($allPlayers[$normalizedName])) {
                $matched[] = [
                    'normalized_name' => $normalizedName,
                    'original_name' => $currentData['original_name'],
                    'team' => $currentData['team'] ?? null,
                    'ratings_data' => $allPlayers[$normalizedName]['raw_data'],
                    'current_data' => $currentData['raw_data'] ?? [],
                ];
            }
        }

        return $matched;
    }

    private function displaySampleTable(array $players, Command $output): void
    {
        $output->line('');
        $output->info('Sample Imports:');

        $sampleSize = min(15, count($players));
        $sample = array_slice($players, 0, $sampleSize);

        $tableData = [];
        foreach ($sample as $player) {
            $transformed = $this->transformName($player['original_name']);
            $overall = $this->extractOverallRating($player['ratings_data']);

            $tableData[] = [
                $player['original_name'],
                $transformed['first_name'] . ' ' . $transformed['last_name'],
                $player['team'],
                $overall,
            ];
        }

        $output->table(
            ['Original Name', 'Transformed Name', 'Team', 'OVR'],
            $tableData
        );

        if (count($players) > $sampleSize) {
            $output->line("  ... and " . (count($players) - $sampleSize) . " more players");
        }
    }

    private function performImport(array $players, int $campaignId, Command $output): int
    {
        // Clear existing players for this campaign
        $deletedCount = Player::where('campaign_id', $campaignId)->delete();
        $output->line("  Cleared {$deletedCount} existing players");

        $imported = 0;
        $progressBar = $output->getOutput()->createProgressBar(count($players));

        DB::beginTransaction();

        try {
            foreach ($players as $playerData) {
                $this->createPlayer($playerData, $campaignId);
                $imported++;
                $progressBar->advance();
            }

            DB::commit();
            $progressBar->finish();
            $output->line('');

        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }

        // Update team payrolls
        $this->updateTeamPayrolls($campaignId);

        return $imported;
    }

    private function createPlayer(array $playerData, int $campaignId): Player
    {
        $transformed = $this->transformName($playerData['original_name']);
        $teamId = $this->resolveTeamId($playerData['team'] ?? null);
        $ratingsData = $playerData['ratings_data'];
        $currentData = $playerData['current_data'] ?? [];

        return Player::create([
            'campaign_id' => $campaignId,
            'team_id' => $teamId,
            'first_name' => $transformed['first_name'],
            'last_name' => $transformed['last_name'],
            'position' => $this->extractPosition($ratingsData),
            'secondary_position' => $this->extractSecondaryPosition($ratingsData),
            'jersey_number' => $this->extractJerseyNumber($ratingsData),
            'height_inches' => $this->extractHeight($ratingsData),
            'weight_lbs' => $this->extractWeight($ratingsData),
            'birth_date' => $this->extractBirthDate($ratingsData, $currentData),
            'country' => $this->extractCountry($ratingsData, $currentData),
            'college' => $this->extractCollege($ratingsData, $currentData),
            'draft_year' => $this->extractDraftYear($currentData),
            'draft_round' => $this->extractDraftRound($currentData),
            'draft_pick' => $this->extractDraftPick($currentData),
            'overall_rating' => $this->extractOverallRating($ratingsData),
            'potential_rating' => $this->extractPotentialRating($ratingsData),
            'attributes' => $this->buildAttributes($ratingsData),
            'tendencies' => $this->buildTendencies($ratingsData),
            'badges' => $this->buildBadges($ratingsData),
            'personality' => $this->buildPersonality($ratingsData),
            'contract_years_remaining' => $this->extractContractYears($ratingsData),
            'contract_salary' => $this->extractContractSalary($ratingsData),
            'contract_details' => $this->buildContractDetails($ratingsData),
            'is_injured' => false,
            'fatigue' => 0,
        ]);
    }

    private function transformName(string $originalName): array
    {
        // Check if we have a manual transformation
        if (isset($this->nameTransformations[$originalName])) {
            return $this->nameTransformations[$originalName];
        }

        // Fall back to parsing and light transformation
        $parts = explode(' ', $originalName);
        $firstName = $parts[0] ?? 'Unknown';
        $lastName = implode(' ', array_slice($parts, 1)) ?: 'Player';

        // If no manual transformation exists, apply a generic one
        // This should ideally not happen if we have all names mapped
        return [
            'first_name' => $firstName,
            'last_name' => $lastName,
        ];
    }

    private function resolveTeamId(string $teamName): ?int
    {
        $normalized = strtoupper(trim($teamName));

        if (isset($this->teamLookup[$normalized])) {
            return $this->teamLookup[$normalized];
        }

        // Try lowercase for full names
        $lowered = strtolower(trim($teamName));
        if (isset($this->teamLookup[$lowered])) {
            return $this->teamLookup[$lowered];
        }

        return null; // Free agent
    }

    // ================================================================
    // EXTRACTION METHODS - Adjust these based on your actual CSV columns
    // ================================================================

    private function extractPosition(array $data): string
    {
        // All-time CSV uses position_1
        $position = $data['position_1'] ?? $data['position'] ?? $data['pos'] ?? 'SF';
        $position = strtoupper(trim($position));

        // Normalize position strings
        $mapping = [
            'POINT GUARD' => 'PG', 'POINT' => 'PG', 'G' => 'PG',
            'SHOOTING GUARD' => 'SG', 'GUARD' => 'SG',
            'SMALL FORWARD' => 'SF', 'FORWARD' => 'SF', 'F' => 'SF',
            'POWER FORWARD' => 'PF',
            'CENTER' => 'C',
        ];

        return $mapping[$position] ?? $position;
    }

    private function extractSecondaryPosition(array $data): ?string
    {
        // All-time CSV uses position_2
        $position = $data['position_2'] ?? $data['secondary_position'] ?? null;

        if (!$position || trim($position) === '') {
            return null;
        }

        return $this->extractPosition(['position' => $position]);
    }

    private function extractJerseyNumber(array $data): int
    {
        return (int) ($data['jersey'] ?? $data['number'] ?? rand(0, 99));
    }

    private function extractHeight(array $data): int
    {
        // All-time CSV has height_cm
        if (isset($data['height_cm']) && $data['height_cm']) {
            return (int) round((int) $data['height_cm'] / 2.54);
        }

        // Try feet format (e.g., "6'10"")
        $height = $data['height_feet'] ?? $data['height'] ?? '6\'6"';
        if (preg_match('/(\d+)[\'"](\d+)/', $height, $matches)) {
            return (int) $matches[1] * 12 + (int) $matches[2];
        }

        return 78; // Default 6'6"
    }

    private function extractWeight(array $data): int
    {
        // All-time CSV has weight_lbs
        $weight = $data['weight_lbs'] ?? $data['weight'] ?? 220;
        return (int) preg_replace('/[^0-9]/', '', $weight) ?: 220;
    }

    private function extractBirthDate(array $ratingsData, array $currentData = []): string
    {
        // Try current data first (birthday column)
        $birthDate = $currentData['birthday'] ?? null;

        // Fall back to ratings data
        if (!$birthDate) {
            $birthDate = $ratingsData['birthdate'] ?? $ratingsData['birth_date'] ?? $ratingsData['dob'] ?? null;
        }

        if ($birthDate) {
            try {
                return date('Y-m-d', strtotime($birthDate));
            } catch (\Exception $e) {
                // Fall through to default
            }
        }

        // Default to a reasonable age (25 years old)
        return now()->subYears(25)->format('Y-m-d');
    }

    private function extractCountry(array $ratingsData, array $currentData = []): ?string
    {
        // Try current data first
        $country = $currentData['country'] ?? null;

        // Fall back to ratings data (nationality_1)
        if (!$country) {
            $country = $ratingsData['nationality_1'] ?? $ratingsData['country'] ?? null;
        }

        return $country ?: null;
    }

    private function extractCollege(array $ratingsData, array $currentData = []): ?string
    {
        // Try current data first (school column)
        $college = $currentData['school'] ?? null;

        // Fall back to ratings data (prior_to_nba)
        if (!$college) {
            $college = $ratingsData['prior_to_nba'] ?? $ratingsData['college'] ?? $ratingsData['school'] ?? null;
        }

        return $college ?: null;
    }

    private function extractDraftYear(array $currentData): ?int
    {
        $year = $currentData['draft_year'] ?? null;
        return $year ? (int) $year : null;
    }

    private function extractDraftRound(array $currentData): ?int
    {
        $round = $currentData['draft_round'] ?? null;
        return $round ? (int) $round : null;
    }

    private function extractDraftPick(array $currentData): ?int
    {
        $pick = $currentData['draft_number'] ?? $currentData['draft_pick'] ?? null;
        return $pick ? (int) $pick : null;
    }

    private function extractOverallRating(array $data): int
    {
        // All-time CSV uses 'overall' column
        $overall = $data['overall'] ?? 75;
        return max(40, min(99, (int) $overall));
    }

    private function extractPotentialRating(array $data): int
    {
        // All-time CSV uses 'potential' column
        $potential = $data['potential'] ?? null;

        if ($potential && (int) $potential > 0) {
            return max(40, min(99, (int) $potential));
        }

        // Default to overall + small bonus (potential should never be below overall)
        $overall = $this->extractOverallRating($data);
        return min(99, $overall + rand(0, 5));
    }

    private function buildAttributes(array $data): array
    {
        // All-time CSV column names mapped to our attribute schema
        return [
            'offense' => [
                // Shooting
                'closeShot' => $this->getAttr($data, ['close_shot'], 75),
                'midRange' => $this->getAttr($data, ['mid_range_shot'], 75),
                'threePoint' => $this->getAttr($data, ['three_point_shot'], 75),
                'freeThrow' => $this->getAttr($data, ['free_throw'], 75),
                'shotIQ' => $this->getAttr($data, ['shot_iq'], 75),
                'offensiveConsistency' => $this->getAttr($data, ['offensive_consistency'], 75),

                // Finishing
                'layup' => $this->getAttr($data, ['layup'], 75),
                'standingDunk' => $this->getAttr($data, ['standing_dunk'], 75),
                'drivingDunk' => $this->getAttr($data, ['driving_dunk'], 75),
                'postHook' => $this->getAttr($data, ['post_hook'], 75),
                'postFade' => $this->getAttr($data, ['post_fade'], 75),
                'postControl' => $this->getAttr($data, ['post_control'], 75),
                'drawFoul' => $this->getAttr($data, ['draw_foul'], 75),
                'hands' => $this->getAttr($data, ['hands'], 75),

                // Playmaking
                'ballHandling' => $this->getAttr($data, ['ball_handle'], 75),
                'speedWithBall' => $this->getAttr($data, ['speed_with_ball'], 75),
                'passAccuracy' => $this->getAttr($data, ['pass_accuracy'], 75),
                'passVision' => $this->getAttr($data, ['pass_vision'], 75),
                'passIQ' => $this->getAttr($data, ['pass_iq'], 75),
            ],

            'defense' => [
                'interiorDefense' => $this->getAttr($data, ['interior_defense'], 75),
                'perimeterDefense' => $this->getAttr($data, ['perimeter_defense'], 75),
                'steal' => $this->getAttr($data, ['steal'], 75),
                'block' => $this->getAttr($data, ['block'], 75),
                'offensiveRebound' => $this->getAttr($data, ['offensive_rebound'], 75),
                'defensiveRebound' => $this->getAttr($data, ['defensive_rebound'], 75),
                'helpDefenseIQ' => $this->getAttr($data, ['help_defense_iq'], 75),
                'passPerception' => $this->getAttr($data, ['pass_perception'], 75),
                'defensiveConsistency' => $this->getAttr($data, ['defensive_consistency'], 75),
            ],

            'physical' => [
                'speed' => $this->getAttr($data, ['speed'], 75),
                'acceleration' => $this->getAttr($data, ['agility'], 75), // CSV uses 'agility'
                'strength' => $this->getAttr($data, ['strength'], 75),
                'vertical' => $this->getAttr($data, ['vertical'], 75),
                'stamina' => $this->getAttr($data, ['stamina'], 75),
                'hustle' => $this->getAttr($data, ['hustle'], 75),
                'durability' => $this->getAttr($data, ['overall_durability'], 75),
            ],

            'mental' => [
                'basketballIQ' => $this->getAttr($data, ['shot_iq', 'pass_iq'], 75), // Derive from other IQs
                'clutch' => 75, // Not in CSV, use default
                'workEthic' => 75, // Not in CSV, use default
                'coachability' => 75, // Not in CSV, use default
                'intangibles' => $this->getAttr($data, ['intangibles'], 75),
            ],
        ];
    }

    private function getAttr(array $data, array $possibleKeys, int $default): int
    {
        foreach ($possibleKeys as $key) {
            if (isset($data[$key]) && is_numeric($data[$key])) {
                return max(25, min(99, (int) $data[$key]));
            }
        }
        return $default;
    }

    private function buildTendencies(array $data): array
    {
        $position = $this->extractPosition($data);

        // Base tendencies by position
        $baseTendencies = [
            'PG' => ['threePoint' => 0.35, 'midRange' => 0.25, 'paint' => 0.40],
            'SG' => ['threePoint' => 0.45, 'midRange' => 0.25, 'paint' => 0.30],
            'SF' => ['threePoint' => 0.35, 'midRange' => 0.30, 'paint' => 0.35],
            'PF' => ['threePoint' => 0.25, 'midRange' => 0.25, 'paint' => 0.50],
            'C' => ['threePoint' => 0.10, 'midRange' => 0.20, 'paint' => 0.70],
        ];

        $base = $baseTendencies[$position] ?? $baseTendencies['SF'];

        return [
            'shotSelection' => [
                'threePoint' => $base['threePoint'],
                'midRange' => $base['midRange'],
                'paint' => $base['paint'],
            ],
            'defensiveAggression' => rand(50, 80) / 100,
            'passingWillingness' => rand(40, 70) / 100,
            'helpDefenseFrequency' => rand(50, 75) / 100,
        ];
    }

    private function buildBadges(array $data): array
    {
        $badges = [];

        // All-time CSV has badge columns like: badge_deadeye, badge_limitless_range, etc.
        // Values are: gold, silver, bronze, or empty
        $badgeColumns = [
            'badge_deadeye', 'badge_limitless_range', 'badge_mini_marksman',
            'badge_set_shot_specialist', 'badge_shifty_shooter', 'badge_aerial_wizard',
            'badge_float_game', 'badge_hook_specialist', 'badge_layup_mixmaster',
            'badge_paint_prodigy', 'badge_physical_finisher', 'badge_post_fade_phenom',
            'badge_post_powerhouse', 'badge_post_up_poet', 'badge_posterizer',
            'badge_rise_up', 'badge_ankle_assassin', 'badge_bail_out',
            'badge_break_starter', 'badge_dimer', 'badge_handles_for_days',
            'badge_lightning_launch', 'badge_strong_handle', 'badge_unpluckable',
            'badge_versatile_visionary', 'badge_challenger', 'badge_glove',
            'badge_high_flying_denier', 'badge_immovable_enforcer', 'badge_interceptor',
            'badge_off_ball_pest', 'badge_on_ball_menace', 'badge_paint_patroller',
            'badge_pick_dodger', 'badge_post_lockdown', 'badge_boxout_beast',
            'badge_rebound_chaser', 'badge_brick_wall', 'badge_slippery_off_ball',
            'badge_pogo_stick',
        ];

        foreach ($badgeColumns as $column) {
            $value = $data[$column] ?? null;

            if (!$value || trim($value) === '') {
                continue;
            }

            // Extract badge ID from column name (e.g., "badge_dimer" -> "dimer")
            $badgeId = str_replace('badge_', '', $column);

            // Determine level
            $level = $this->parseBadgeLevel($value);

            if ($level) {
                $badges[] = [
                    'id' => $badgeId,
                    'level' => $level,
                ];
            }
        }

        return $badges;
    }

    private function parseBadgeLevel($value): ?string
    {
        $value = strtolower(trim($value));

        if (in_array($value, ['hof', 'hall_of_fame', 'hall of fame', '4'])) {
            return 'hof';
        }
        if (in_array($value, ['gold', '3'])) {
            return 'gold';
        }
        if (in_array($value, ['silver', '2'])) {
            return 'silver';
        }
        if (in_array($value, ['bronze', '1'])) {
            return 'bronze';
        }

        return null;
    }

    private function buildPersonality(array $data): array
    {
        return [
            'traits' => [],
            'morale' => rand(70, 90),
            'chemistry' => rand(70, 85),
            'mediaProfile' => 'normal',
        ];
    }

    private function extractContractYears(array $data): int
    {
        return (int) ($data['contract_years'] ?? $data['years_remaining'] ?? rand(1, 4));
    }

    private function extractContractSalary(array $data): int
    {
        // All-time CSV uses 'season_salary' column
        $salary = $data['season_salary'] ?? $data['salary'] ?? null;

        if ($salary && (int) $salary > 0) {
            // Remove non-numeric characters and parse
            return (int) preg_replace('/[^0-9]/', '', $salary);
        }

        // Calculate based on overall rating
        $overall = $this->extractOverallRating($data);
        return match (true) {
            $overall >= 92 => rand(40000000, 50000000),
            $overall >= 88 => rand(30000000, 42000000),
            $overall >= 84 => rand(20000000, 32000000),
            $overall >= 80 => rand(12000000, 22000000),
            $overall >= 76 => rand(6000000, 14000000),
            $overall >= 72 => rand(3000000, 8000000),
            default => rand(1000000, 4000000),
        };
    }

    private function buildContractDetails(array $data): array
    {
        $years = $this->extractContractYears($data);
        $salary = $this->extractContractSalary($data);

        $salaries = [];
        for ($i = 0; $i < $years; $i++) {
            $salaries[] = (int) round($salary * (1 + 0.05 * $i), -4);
        }

        return [
            'totalYears' => $years,
            'salaries' => $salaries,
            'options' => [],
            'noTradeClause' => false,
        ];
    }

    private function updateTeamPayrolls(int $campaignId): void
    {
        $teams = Team::where('campaign_id', $campaignId)->get();

        foreach ($teams as $team) {
            $totalPayroll = Player::where('team_id', $team->id)->sum('contract_salary');
            $team->update(['total_payroll' => $totalPayroll]);
        }
    }
}
