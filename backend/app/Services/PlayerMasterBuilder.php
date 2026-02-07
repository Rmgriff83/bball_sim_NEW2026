<?php

namespace App\Services;

use Illuminate\Console\Command;

class PlayerMasterBuilder
{
    private array $nameTransformations;

    public function __construct()
    {
        $this->nameTransformations = config('player_names', []);
    }

    public function build(
        string $inputPath,
        string $outputPath,
        bool $dryRun,
        Command $output
    ): array {
        $output->info('Loading CSV file...');

        $players = $this->loadBasePlayerData($inputPath);
        $output->line("  Players loaded: " . count($players));

        // Build master player list
        $output->info('Processing players...');
        $masterPlayers = $this->processPlayers($players);

        // Count players with real vs inferred ratings (inferred players have no archetype set from CSV)
        $withRatings = count(array_filter($masterPlayers, fn($p) => $p['archetype'] !== null));
        $inferredRatings = count($masterPlayers) - $withRatings;

        $output->line("  Total players: " . count($masterPlayers));
        $output->line("  With full rating data: {$withRatings}");
        $output->line("  With inferred ratings: {$inferredRatings}");

        // Display sample
        $this->displaySampleTable($masterPlayers, $output);

        if (!$dryRun) {
            // Ensure output directory exists
            $dir = dirname($outputPath);
            if (!is_dir($dir)) {
                mkdir($dir, 0755, true);
            }

            $output->info('Writing master file...');
            $this->writeToFile($masterPlayers, $outputPath);
        }

        return [
            'total_players' => count($masterPlayers),
            'with_ratings' => $withRatings,
            'inferred_ratings' => $inferredRatings,
        ];
    }

    private function loadBasePlayerData(string $path): array
    {
        $players = [];
        $handle = fopen($path, 'r');
        $headers = fgetcsv($handle);

        // Clean headers - remove BOM and normalize
        $headers = array_map(function($h) {
            $h = preg_replace('/[\x00-\x1F\x80-\xFF]/', '', $h);
            return strtolower(trim($h));
        }, $headers);

        while (($row = fgetcsv($handle)) !== false) {
            if (count($row) < count($headers)) {
                $row = array_pad($row, count($headers), '');
            }
            $rowData = array_combine($headers, $row);

            $playerName = trim($rowData['player'] ?? '');
            if ($playerName) {
                $players[] = $rowData;
            }
        }

        fclose($handle);
        return $players;
    }

    private function processPlayers(array $players): array
    {
        $masterPlayers = [];

        foreach ($players as $data) {
            try {
                $player = $this->buildPlayer($data);
                if ($player) {
                    $masterPlayers[] = $player;
                }
            } catch (\Exception $e) {
                // Skip players that fail to build
                continue;
            }
        }

        // Sort by overall rating descending, then by name
        usort($masterPlayers, function ($a, $b) {
            if ($a['overallRating'] !== $b['overallRating']) {
                return $b['overallRating'] - $a['overallRating'];
            }
            return strcmp($a['lastName'] ?? '', $b['lastName'] ?? '');
        });

        return $masterPlayers;
    }

    private function buildPlayer(array $data): ?array
    {
        $playerName = trim($data['player'] ?? '');
        if (!$playerName) {
            return null;
        }

        $transformed = $this->transformName($playerName);
        $teamAbbr = strtoupper(trim($data['team abbv'] ?? 'FA'));

        // Check if we have valid overall rating
        $overall = $this->getNumeric($data, 'overall', 0);
        $hasRatings = $overall > 0;

        // Parse positions (may be slash-separated like "PG/SG" or "SF/PF/C")
        $positions = $this->parsePositions($data['pos'] ?? 'SF');

        // For players without ratings, infer from stats
        $inferredOverall = $hasRatings ? null : $this->inferOverallRating($data);
        $finalOverall = $hasRatings ? (int) $overall : $inferredOverall;

        return [
            'id' => $this->generatePlayerId($transformed['first_name'], $transformed['last_name']),
            'originalName' => $playerName,
            'firstName' => $transformed['first_name'],
            'lastName' => $transformed['last_name'],
            'position' => $positions['primary'],
            'secondaryPosition' => $positions['secondary'],
            'teamAbbreviation' => $teamAbbr,
            'jerseyNumber' => rand(0, 99),
            'heightInches' => $this->extractHeight($data),
            'weightLbs' => $this->extractWeight($data),
            'wingspanInches' => $this->extractWingspan($data),
            'birthDate' => $this->extractBirthDate($data),
            'country' => trim($data['nationality_1'] ?? '') ?: 'USA',
            'college' => trim($data['prior_to_nba'] ?? '') ?: null,
            'hometown' => trim($data['hometown'] ?? '') ?: null,
            'draftYear' => null,
            'draftRound' => null,
            'draftPick' => null,
            'overallRating' => $finalOverall,
            'potentialRating' => $this->extractPotential($data, $hasRatings, $inferredOverall),
            'archetype' => trim($data['archetype'] ?? '') ?: null,
            'tier' => trim($data['tier'] ?? '') ?: null,
            'attributes' => $hasRatings ? $this->buildAttributes($data) : $this->inferAttributes($data, $inferredOverall, $positions['primary']),
            'badges' => $hasRatings ? $this->buildBadges($data) : $this->inferBadges($data, $positions['primary']),
            'tendencies' => $this->buildTendencies($data),
            'personality' => $this->buildPersonality(),
            'contractSalary' => $this->extractSalary($data),
            'tradeValue' => $this->getFloat($data, 'adj value', null),
            'tradeValueTotal' => $this->getFloat($data, 'adj value total', null),
            'injuryRisk' => $this->normalizeInjuryRisk($data['inj risk'] ?? 'M'),
        ];
    }

    private function generatePlayerId(string $firstName, string $lastName): string
    {
        $id = strtolower($firstName . '-' . $lastName);
        $id = preg_replace('/[^a-z0-9\-]/', '', $id);
        $id = preg_replace('/-+/', '-', $id);
        return trim($id, '-');
    }

    private function transformName(string $originalName): array
    {
        // Check manual dictionary first
        if (isset($this->nameTransformations[$originalName])) {
            return $this->nameTransformations[$originalName];
        }

        // Parse name and return as-is if no transformation exists
        $parts = explode(' ', $originalName);
        $firstName = $parts[0] ?? 'Unknown';
        $lastName = implode(' ', array_slice($parts, 1)) ?: 'Player';

        return [
            'first_name' => $firstName,
            'last_name' => $lastName,
        ];
    }

    /**
     * Parse position string that may contain multiple positions (e.g., "PG/SG", "SF/PF/C").
     * Returns primary and secondary positions (first two listed).
     */
    private function parsePositions(string $positionStr): array
    {
        $positionStr = strtoupper(trim($positionStr));

        // Split by slash, hyphen, or comma
        $parts = preg_split('/[\/\-,]/', $positionStr);
        $parts = array_map('trim', $parts);
        $parts = array_filter($parts);

        // Normalize each position
        $normalized = [];
        foreach ($parts as $pos) {
            $normalizedPos = $this->normalizePosition($pos);
            if ($normalizedPos && !in_array($normalizedPos, $normalized)) {
                $normalized[] = $normalizedPos;
            }
        }

        // Ensure we have at least one position
        if (empty($normalized)) {
            $normalized[] = 'SF';
        }

        return [
            'primary' => $normalized[0],
            'secondary' => $normalized[1] ?? null,
        ];
    }

    private function normalizePosition(string $position): string
    {
        $position = strtoupper(trim($position));

        $mapping = [
            'POINT GUARD' => 'PG', 'POINT' => 'PG', 'G' => 'PG',
            'SHOOTING GUARD' => 'SG', 'GUARD' => 'SG',
            'GUARD-FORWARD' => 'SG', 'FORWARD-GUARD' => 'SF',
            'SMALL FORWARD' => 'SF', 'FORWARD' => 'SF', 'F' => 'SF',
            'POWER FORWARD' => 'PF', 'FORWARD-CENTER' => 'PF',
            'CENTER' => 'C', 'CENTER-FORWARD' => 'C',
        ];

        return $mapping[$position] ?? (in_array($position, ['PG', 'SG', 'SF', 'PF', 'C']) ? $position : 'SF');
    }

    private function extractHeight(array $data): int
    {
        $heightFeet = trim($data['height_feet'] ?? '');
        if ($heightFeet) {
            return $this->parseHeight($heightFeet);
        }
        return 78; // Default 6'6"
    }

    private function parseHeight(string $height): int
    {
        // Handle formats like "6'6" or "6-6" or "6'6""
        if (preg_match('/(\d+)[\'"\-](\d+)/', $height, $matches)) {
            return (int) $matches[1] * 12 + (int) $matches[2];
        }
        // Handle decimal feet (e.g., "6.5")
        if (is_numeric($height)) {
            $feet = (float) $height;
            $wholeFeet = (int) $feet;
            $inches = round(($feet - $wholeFeet) * 12);
            return $wholeFeet * 12 + $inches;
        }
        return 78; // Default 6'6"
    }

    private function extractWeight(array $data): int
    {
        $weight = $data['weight_lbs'] ?? 200;
        return (int) preg_replace('/[^0-9]/', '', $weight) ?: 200;
    }

    private function extractWingspan(array $data): ?int
    {
        $wingspan = trim($data['wingspan_feet'] ?? '');
        if ($wingspan) {
            return $this->parseHeight($wingspan);
        }
        return null;
    }

    private function extractBirthDate(array $data): string
    {
        $birthDate = trim($data['birthdate'] ?? '');

        if ($birthDate) {
            try {
                return date('Y-m-d', strtotime($birthDate));
            } catch (\Exception $e) {
                // Fall through
            }
        }

        return now()->subYears(25)->format('Y-m-d');
    }

    private function extractPotential(array $data, bool $hasRatings, ?int $inferredOverall = null): int
    {
        $potential = $data['potential'] ?? null;
        $overall = $hasRatings ? (int) ($data['overall'] ?? 75) : ($inferredOverall ?? 44);

        if ($potential && (int) $potential > 0) {
            return max($overall, min(99, (int) $potential));
        }

        return min(99, $overall + rand(0, 5));
    }

    private function extractSalary(array $data): int
    {
        // Try season_salary first, then salary
        $salary = $data['season_salary'] ?? $data['salary'] ?? null;

        if ($salary) {
            $cleaned = (int) preg_replace('/[^0-9]/', '', $salary);
            if ($cleaned > 0) {
                return $cleaned;
            }
        }

        // Generate based on overall rating
        $overall = (int) ($data['overall'] ?? 44);
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

    private function buildAttributes(array $data): array
    {
        return [
            'offense' => [
                'closeShot' => $this->getAttr($data, 'close_shot', 75),
                'midRange' => $this->getAttr($data, 'mid_range_shot', 75),
                'threePoint' => $this->getAttr($data, 'three_point_shot', 75),
                'freeThrow' => $this->getAttr($data, 'free_throw', 75),
                'shotIQ' => $this->getAttr($data, 'shot_iq', 75),
                'offensiveConsistency' => $this->getAttr($data, 'offensive_consistency', 75),
                'layup' => $this->getAttr($data, 'layup', 75),
                'standingDunk' => $this->getAttr($data, 'standing_dunk', 75),
                'drivingDunk' => $this->getAttr($data, 'driving_dunk', 75),
                'postHook' => $this->getAttr($data, 'post_hook', 75),
                'postFade' => $this->getAttr($data, 'post_fade', 75),
                'postControl' => $this->getAttr($data, 'post_control', 75),
                'drawFoul' => $this->getAttr($data, 'draw_foul', 75),
                'hands' => $this->getAttr($data, 'hands', 75),
                'ballHandling' => $this->getAttr($data, 'ball_handle', 75),
                'speedWithBall' => $this->getAttr($data, 'speed_with_ball', 75),
                'passAccuracy' => $this->getAttr($data, 'pass_accuracy', 75),
                'passVision' => $this->getAttr($data, 'pass_vision', 75),
                'passIQ' => $this->getAttr($data, 'pass_iq', 75),
            ],
            'defense' => [
                'interiorDefense' => $this->getAttr($data, 'interior_defense', 75),
                'perimeterDefense' => $this->getAttr($data, 'perimeter_defense', 75),
                'steal' => $this->getAttr($data, 'steal', 75),
                'block' => $this->getAttr($data, 'block', 75),
                'offensiveRebound' => $this->getAttr($data, 'offensive_rebound', 75),
                'defensiveRebound' => $this->getAttr($data, 'defensive_rebound', 75),
                'helpDefenseIQ' => $this->getAttr($data, 'help_defense_iq', 75),
                'passPerception' => $this->getAttr($data, 'pass_perception', 75),
                'defensiveConsistency' => $this->getAttr($data, 'defensive_consistency', 75),
            ],
            'physical' => [
                'speed' => $this->getAttr($data, 'speed', 75),
                'acceleration' => $this->getAttr($data, 'agility', 75),
                'strength' => $this->getAttr($data, 'strength', 75),
                'vertical' => $this->getAttr($data, 'vertical', 75),
                'stamina' => $this->getAttr($data, 'stamina', 75),
                'hustle' => $this->getAttr($data, 'hustle', 75),
                'durability' => $this->getAttr($data, 'overall_durability', 75),
            ],
            'mental' => [
                'basketballIQ' => $this->getAttr($data, 'intangibles', 75),
                'clutch' => 75,
                'workEthic' => 75,
                'coachability' => 75,
                'intangibles' => $this->getAttr($data, 'intangibles', 75),
            ],
        ];
    }

    private function getAttr(array $data, string $key, int $default): int
    {
        $value = $data[$key] ?? null;
        if ($value !== null && $value !== '' && is_numeric($value)) {
            return max(25, min(99, (int) $value));
        }
        return $default;
    }

    private function getNumeric(array $data, string $key, int $default): int
    {
        $value = $data[$key] ?? null;
        if ($value !== null && $value !== '' && is_numeric($value)) {
            return (int) $value;
        }
        return $default;
    }

    private function getFloat(array $data, string $key, ?float $default): ?float
    {
        $value = $data[$key] ?? null;
        if ($value !== null && $value !== '' && is_numeric($value)) {
            return round((float) $value, 2);
        }
        return $default;
    }

    private function normalizeInjuryRisk(string $risk): string
    {
        $risk = strtoupper(trim($risk));
        return in_array($risk, ['L', 'M', 'H']) ? $risk : 'M';
    }

    private function getDefaultAttributes(int $rating): array
    {
        return [
            'offense' => [
                'closeShot' => $rating, 'midRange' => $rating, 'threePoint' => $rating,
                'freeThrow' => $rating, 'shotIQ' => $rating, 'offensiveConsistency' => $rating,
                'layup' => $rating, 'standingDunk' => $rating, 'drivingDunk' => $rating,
                'postHook' => $rating, 'postFade' => $rating, 'postControl' => $rating,
                'drawFoul' => $rating, 'hands' => $rating, 'ballHandling' => $rating,
                'speedWithBall' => $rating, 'passAccuracy' => $rating, 'passVision' => $rating,
                'passIQ' => $rating,
            ],
            'defense' => [
                'interiorDefense' => $rating, 'perimeterDefense' => $rating, 'steal' => $rating,
                'block' => $rating, 'offensiveRebound' => $rating, 'defensiveRebound' => $rating,
                'helpDefenseIQ' => $rating, 'passPerception' => $rating, 'defensiveConsistency' => $rating,
            ],
            'physical' => [
                'speed' => $rating, 'acceleration' => $rating, 'strength' => $rating,
                'vertical' => $rating, 'stamina' => $rating, 'hustle' => $rating, 'durability' => $rating,
            ],
            'mental' => [
                'basketballIQ' => $rating, 'clutch' => $rating, 'workEthic' => $rating,
                'coachability' => $rating, 'intangibles' => $rating,
            ],
        ];
    }

    /**
     * Infer overall rating from tier and stats for players without rating data.
     */
    private function inferOverallRating(array $data): int
    {
        $tier = trim($data['tier'] ?? '');
        $pts = (float) ($data['pts'] ?? 0);
        $ast = (float) ($data['ast'] ?? 0);
        $treb = (float) ($data['treb'] ?? 0);

        // Parse tier (e.g., "PG 2" → tier number 2)
        $tierNumber = 8; // Default to lowest tier
        if (preg_match('/\d+/', $tier, $matches)) {
            $tierNumber = min(8, max(1, (int) $matches[0]));
        }

        // Base rating from tier (tier 1 = 82-88, tier 8 = 55-62)
        $tierRanges = [
            1 => [82, 88], 2 => [78, 84], 3 => [74, 80], 4 => [70, 76],
            5 => [66, 72], 6 => [62, 68], 7 => [58, 64], 8 => [54, 60],
        ];
        [$minBase, $maxBase] = $tierRanges[$tierNumber] ?? [54, 60];

        // Stat bonus (high performers get slight boost, max +4)
        $statScore = ($pts / 30) + ($ast / 10) + ($treb / 12); // Normalized 0-3
        $statBonus = min(4, (int) ($statScore * 1.5));

        return rand($minBase, $maxBase) + $statBonus;
    }

    /**
     * Infer attributes from stats for players without rating data.
     */
    private function inferAttributes(array $data, int $overall, string $position): array
    {
        $pts = (float) ($data['pts'] ?? 0);
        $threepm = (float) ($data['3ptm'] ?? 0);
        $treb = (float) ($data['treb'] ?? 0);
        $ast = (float) ($data['ast'] ?? 0);
        $stl = (float) ($data['stl'] ?? 0);
        $blk = (float) ($data['blk'] ?? 0);
        $fgPct = (float) ($data['fg%'] ?? 0.45);
        $ftPct = (float) ($data['ft%'] ?? 0.75);

        // Helper: generate attribute with variance around a base
        $attr = fn(int $base, int $variance = 8) => max(35, min(99, $base + rand(-$variance, $variance)));

        // Position-based attribute tendencies
        $isGuard = in_array($position, ['PG', 'SG']);
        $isBig = in_array($position, ['PF', 'C']);
        $isWing = $position === 'SF';

        // Shooting ratings influenced by stats
        $shootingBase = $overall + ($fgPct > 0.5 ? 5 : 0);
        $threeBase = $overall + ($threepm > 2 ? 8 : ($threepm > 1 ? 4 : -5));
        $ftBase = min(99, (int) ($ftPct * 100) + rand(-5, 5));

        // Playmaking for high-assist players
        $playBase = $overall + ($ast > 6 ? 10 : ($ast > 4 ? 5 : 0));

        // Rebounding for high-rebound players
        $rebBase = $overall + ($treb > 8 ? 10 : ($treb > 5 ? 5 : ($isBig ? 3 : -8)));

        // Defense from steals/blocks
        $perimDef = $overall + ($stl > 1.5 ? 8 : ($stl > 1 ? 4 : 0)) + ($isGuard ? 3 : -3);
        $intDef = $overall + ($blk > 1.5 ? 10 : ($blk > 0.5 ? 5 : 0)) + ($isBig ? 5 : -5);

        return [
            'offense' => [
                'closeShot' => $attr($shootingBase + ($isBig ? 5 : 0)),
                'midRange' => $attr($shootingBase),
                'threePoint' => $attr($threeBase + ($isGuard ? 3 : ($isBig ? -10 : 0))),
                'freeThrow' => $attr($ftBase),
                'shotIQ' => $attr($overall),
                'offensiveConsistency' => $attr($overall),
                'layup' => $attr($shootingBase + 5),
                'standingDunk' => $attr($overall + ($isBig ? 10 : -10)),
                'drivingDunk' => $attr($overall + ($isWing ? 5 : ($isBig ? -5 : 0))),
                'postHook' => $attr($overall + ($isBig ? 10 : -15)),
                'postFade' => $attr($overall + ($isBig ? 8 : -15)),
                'postControl' => $attr($overall + ($isBig ? 10 : -15)),
                'drawFoul' => $attr($overall + ($pts > 20 ? 5 : 0)),
                'hands' => $attr($overall),
                'ballHandling' => $attr($playBase + ($isGuard ? 8 : -8)),
                'speedWithBall' => $attr($overall + ($isGuard ? 5 : -5)),
                'passAccuracy' => $attr($playBase),
                'passVision' => $attr($playBase + ($ast > 5 ? 5 : 0)),
                'passIQ' => $attr($playBase),
            ],
            'defense' => [
                'interiorDefense' => $attr($intDef),
                'perimeterDefense' => $attr($perimDef),
                'steal' => $attr($overall + ($stl > 1 ? 8 : 0)),
                'block' => $attr($overall + ($blk > 1 ? 12 : ($isBig ? 5 : -10))),
                'offensiveRebound' => $attr($rebBase - 5),
                'defensiveRebound' => $attr($rebBase),
                'helpDefenseIQ' => $attr($overall),
                'passPerception' => $attr($overall + ($stl > 1 ? 5 : 0)),
                'defensiveConsistency' => $attr($overall),
            ],
            'physical' => [
                'speed' => $attr($overall + ($isGuard ? 8 : ($isBig ? -8 : 0))),
                'acceleration' => $attr($overall + ($isGuard ? 5 : -3)),
                'strength' => $attr($overall + ($isBig ? 10 : ($isGuard ? -8 : 0))),
                'vertical' => $attr($overall + ($blk > 1 ? 5 : 0)),
                'stamina' => $attr($overall + 5),
                'hustle' => $attr($overall),
                'durability' => $attr($overall),
            ],
            'mental' => [
                'basketballIQ' => $attr($overall + ($ast > 5 ? 5 : 0)),
                'clutch' => $attr($overall),
                'workEthic' => $attr($overall),
                'coachability' => $attr($overall),
                'intangibles' => $attr($overall),
            ],
        ];
    }

    /**
     * Infer badges from stats for players without rating data.
     */
    private function inferBadges(array $data, string $position): array
    {
        $badges = [];
        $pts = (float) ($data['pts'] ?? 0);
        $threepm = (float) ($data['3ptm'] ?? 0);
        $treb = (float) ($data['treb'] ?? 0);
        $ast = (float) ($data['ast'] ?? 0);
        $stl = (float) ($data['stl'] ?? 0);
        $blk = (float) ($data['blk'] ?? 0);
        $fgPct = (float) ($data['fg%'] ?? 0);

        $isGuard = in_array($position, ['PG', 'SG']);
        $isBig = in_array($position, ['PF', 'C']);

        // Shooting badges (for 3PT shooters)
        if ($threepm > 2.5) {
            $badges[] = ['id' => 'deadeye', 'level' => 'gold'];
            $badges[] = ['id' => 'limitless_range', 'level' => 'silver'];
        } elseif ($threepm > 1.5) {
            $badges[] = ['id' => 'deadeye', 'level' => 'silver'];
        } elseif ($threepm > 0.8) {
            $badges[] = ['id' => 'deadeye', 'level' => 'bronze'];
        }

        // Playmaking badges (for high-assist players)
        if ($ast > 7) {
            $badges[] = ['id' => 'dimer', 'level' => 'gold'];
            $badges[] = ['id' => 'handles_for_days', 'level' => 'silver'];
        } elseif ($ast > 5) {
            $badges[] = ['id' => 'dimer', 'level' => 'silver'];
        } elseif ($ast > 3 && $isGuard) {
            $badges[] = ['id' => 'dimer', 'level' => 'bronze'];
        }

        // Inside scoring (high FG% or big men scorers)
        if ($fgPct > 0.55 && $isBig) {
            $badges[] = ['id' => 'paint_prodigy', 'level' => 'gold'];
        } elseif ($fgPct > 0.50 && $pts > 15) {
            $badges[] = ['id' => 'paint_prodigy', 'level' => 'silver'];
        }

        // Rebounding badges
        if ($treb > 10) {
            $badges[] = ['id' => 'rebound_chaser', 'level' => 'gold'];
            $badges[] = ['id' => 'boxout_beast', 'level' => 'silver'];
        } elseif ($treb > 7) {
            $badges[] = ['id' => 'rebound_chaser', 'level' => 'silver'];
        } elseif ($treb > 5 && $isBig) {
            $badges[] = ['id' => 'rebound_chaser', 'level' => 'bronze'];
        }

        // Defensive badges
        if ($blk > 2) {
            $badges[] = ['id' => 'paint_patroller', 'level' => 'gold'];
            $badges[] = ['id' => 'high_flying_denier', 'level' => 'silver'];
        } elseif ($blk > 1) {
            $badges[] = ['id' => 'paint_patroller', 'level' => 'silver'];
        } elseif ($blk > 0.5 && $isBig) {
            $badges[] = ['id' => 'paint_patroller', 'level' => 'bronze'];
        }

        if ($stl > 1.5) {
            $badges[] = ['id' => 'glove', 'level' => 'gold'];
            $badges[] = ['id' => 'interceptor', 'level' => 'silver'];
        } elseif ($stl > 1) {
            $badges[] = ['id' => 'interceptor', 'level' => 'silver'];
        } elseif ($stl > 0.7 && $isGuard) {
            $badges[] = ['id' => 'interceptor', 'level' => 'bronze'];
        }

        // Ball handling for guards with assists
        if ($isGuard && $ast > 4) {
            $badges[] = ['id' => 'unpluckable', 'level' => $ast > 6 ? 'silver' : 'bronze'];
        }

        return $badges;
    }

    private function buildBadges(array $data): array
    {
        $badges = [];
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

            $badgeId = str_replace('badge_', '', $column);
            $level = $this->parseBadgeLevel($value);

            if ($level) {
                $badges[] = ['id' => $badgeId, 'level' => $level];
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

    private function buildTendencies(array $data): array
    {
        $positions = $this->parsePositions($data['pos'] ?? 'SF');
        $position = $positions['primary'];

        $baseTendencies = [
            'PG' => ['threePoint' => 0.35, 'midRange' => 0.25, 'paint' => 0.40],
            'SG' => ['threePoint' => 0.45, 'midRange' => 0.25, 'paint' => 0.30],
            'SF' => ['threePoint' => 0.35, 'midRange' => 0.30, 'paint' => 0.35],
            'PF' => ['threePoint' => 0.25, 'midRange' => 0.25, 'paint' => 0.50],
            'C' => ['threePoint' => 0.10, 'midRange' => 0.20, 'paint' => 0.70],
        ];

        $base = $baseTendencies[$position] ?? $baseTendencies['SF'];

        return [
            'shotSelection' => $base,
            'defensiveAggression' => 0.65,
            'passingWillingness' => 0.55,
            'helpDefenseFrequency' => 0.60,
        ];
    }

    private function buildPersonality(): array
    {
        return [
            'traits' => [],
            'morale' => 80,
            'chemistry' => 75,
            'mediaProfile' => 'normal',
        ];
    }

    private function displaySampleTable(array $players, Command $output): void
    {
        $output->line('');
        $output->info('Sample Output (Top 10 by rating):');

        $sample = array_slice($players, 0, 10);

        $tableData = [];
        foreach ($sample as $player) {
            $tableData[] = [
                $player['originalName'],
                $player['firstName'] . ' ' . $player['lastName'],
                $player['teamAbbreviation'],
                $player['position'],
                $player['overallRating'],
                count($player['badges']),
            ];
        }

        $output->table(
            ['Original Name', 'Transformed Name', 'Team', 'Pos', 'OVR', 'Badges'],
            $tableData
        );

        if (count($players) > 10) {
            $output->line('  ... and ' . (count($players) - 10) . ' more players');
        }
    }

    private function writeToFile(array $players, string $outputPath): void
    {
        $json = json_encode($players, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

        $content = "// Auto-generated by: php artisan players:build-master\n";
        $content .= "// Generated: " . now()->toIso8601String() . "\n";
        $content .= "// Total players: " . count($players) . "\n\n";
        $content .= "export const playersMaster = " . $json . ";\n\n";
        $content .= "export default playersMaster;\n";

        file_put_contents($outputPath, $content);
    }
}
