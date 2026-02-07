<?php

namespace Database\Seeders;

use App\Models\Player;
use App\Models\Team;
use Illuminate\Database\Seeder;

class PlayerSeeder extends Seeder
{
    private array $firstNames = [
        'Marcus', 'Anthony', 'Jaylen', 'Derrick', 'Kyrie', 'James', 'Kevin', 'LeBroom', 'Steffen',
        'Damien', 'Devin', 'Luka', 'Giannis', 'Joel', 'Nikola', 'Jayson', 'Trae', 'Donovan',
        'Zion', 'Ja', 'Tyrese', 'Cade', 'Evan', 'Franz', 'Scottie', 'Paolo', 'Jalen', 'Desmond',
        'Darius', 'Brandon', 'Tyler', 'Cameron', 'Austin', 'Coby', 'Keldon', 'Anfernee', 'Josh',
        'DeAaron', 'Mikal', 'Miles', 'Patrick', 'Immanuel', 'RJ', 'Obi', 'Mitchell', 'Dillon',
        'Jarrett', 'Brook', 'Bobby', 'Khris', 'Jrue', 'Malcolm', 'Buddy', 'Terry', 'Spencer',
        'Russell', 'Draymond', 'Andrew', 'Jonathan', 'Klay', 'Chris', 'Deandre', 'Paul', 'Bradley',
        'Kyle', 'Fred', 'Pascal', 'OG', 'Gary', 'Precious', 'Scottie', 'Thad', 'Wendell', 'Ayo',
        'Alex', 'DeMar', 'Zach', 'Nikola', 'Lauri', 'Evan', 'Caris', 'Isaac', 'Deni', 'Rui',
        'Daniel', 'Corey', 'Monte', 'Bones', 'Aaron', 'Michael', 'Kentavious', 'Bruce', 'Rudy',
        'John', 'Jordan', 'Malik', 'Kelly', 'Reggie', 'Norman', 'Terance', 'Isaiah', 'Kawhi',
        'Victor', 'CJ', 'Larry', 'Herb', 'Jose', 'Trey', 'Jonas', 'Zach', 'Jaren', 'Desmond',
        'Shai', 'Luguentz', 'Josh', 'Darius', 'Aleksej', 'Chet', 'Jalen', 'Isaiah', 'Ousmane',
        'Tre', 'Onyeka', 'Bogdan', 'John', 'Clint', 'Jabari', 'AJ', 'Jalen', 'Keegan', 'Domantas',
        'Myles', 'Tyrese', 'Bennedict', 'Aaron', 'Buddy', 'TJ', 'Andrew', 'Chris', 'Chuma',
    ];

    private array $lastNames = [
        'Smart', 'Edwards', 'Brown', 'Rose', 'Irving', 'Harden', 'Durant', 'James', 'Curry',
        'Lillard', 'Booker', 'Doncic', 'Antetokounmpo', 'Embiid', 'Jokic', 'Tatum', 'Young', 'Mitchell',
        'Williamson', 'Morant', 'Haliburton', 'Cunningham', 'Mobley', 'Wagner', 'Barnes', 'Banchero', 'Green', 'Bane',
        'Garland', 'Ingram', 'Herro', 'Johnson', 'Reaves', 'White', 'Porter', 'Simons', 'Hart',
        'Fox', 'Bridges', 'Bridges', 'Williams', 'Quickley', 'Barrett', 'Toppin', 'Robinson', 'Brooks',
        'Allen', 'Lopez', 'Portis', 'Middleton', 'Holiday', 'Brogdon', 'Hield', 'Rozier', 'Dinwiddie',
        'Westbrook', 'Green', 'Wiggins', 'Kuminga', 'Thompson', 'Paul', 'Ayton', 'George', 'Beal',
        'Lowry', 'VanVleet', 'Siakam', 'Anunoby', 'Trent', 'Achiuwa', 'Barnes', 'Young', 'Carter',
        'Caruso', 'DeRozan', 'LaVine', 'Vucevic', 'Markkanen', 'Fournier', 'LeVert', 'Okoro', 'Avdija',
        'Hachimura', 'Gafford', 'Kispert', 'Morris', 'Hyland', 'Gordon', 'Porter', 'Caldwell-Pope', 'Brown',
        'Gobert', 'Collins', 'Poole', 'Beasley', 'Olynyk', 'Jackson', 'Powell', 'Mann', 'Thomas', 'Leonard',
        'Wembanyama', 'McCollum', 'Nance', 'Jones', 'Alvarado', 'Murphy', 'Valanciunas', 'Collins', 'Jackson',
        'Gilgeous-Alexander', 'Dort', 'Giddey', 'Bazley', 'Pokusevski', 'Holmgren', 'Williams', 'Joe', 'Dieng',
        'Jones', 'Okongwu', 'Bogdanovic', 'Collins', 'Capela', 'Smith', 'Griffin', 'Suggs', 'Murray', 'Sabonis',
        'Turner', 'Haliburton', 'Mathurin', 'Nesmith', 'Hield', 'McConnell', 'Nembhard', 'Duarte', 'Okeke',
    ];

    private array $badgesByPosition = [
        'PG' => ['dimer', 'floor_general', 'pick_and_roll_maestro', 'ankle_breaker', 'quick_first_step', 'tight_handles', 'needle_threader', 'handles_for_days', 'space_creator', 'clamps'],
        'SG' => ['catch_and_shoot', 'deadeye', 'corner_specialist', 'clutch_shooter', 'difficult_shots', 'green_machine', 'clamps', 'interceptor', 'tireless_shooter', 'ankle_breaker'],
        'SF' => ['catch_and_shoot', 'slithery_finisher', 'contact_finisher', 'clamps', 'interceptor', 'rebound_chaser', 'corner_specialist', 'deadeye', 'pro_touch', 'chase_down_artist'],
        'PF' => ['contact_finisher', 'putback_boss', 'rim_protector', 'box', 'rebound_chaser', 'brick_wall', 'post_lockdown', 'intimidator', 'catch_and_shoot', 'pick_and_roll_maestro'],
        'C' => ['rim_protector', 'intimidator', 'box', 'rebound_chaser', 'post_lockdown', 'brick_wall', 'worm', 'pogo_stick', 'lob_city_finisher', 'putback_boss'],
    ];

    public int $campaignId = 1;

    public function run(): void
    {
        $campaignId = $this->campaignId;
        $teams = Team::where('campaign_id', $campaignId)->get();

        foreach ($teams as $index => $team) {
            $this->createRosterForTeam($team, $campaignId, $index);
        }
    }

    private function createRosterForTeam(Team $team, int $campaignId, int $teamIndex): void
    {
        // 15-man roster: 2 PG, 3 SG, 3 SF, 3 PF, 2 C, 2 flex
        $positions = ['PG', 'PG', 'SG', 'SG', 'SG', 'SF', 'SF', 'SF', 'PF', 'PF', 'PF', 'C', 'C', 'SG', 'PF'];
        $jerseyNumbers = $this->getJerseyNumbers();

        // Higher seed teams get better players (simulate league parity)
        $teamTier = $this->getTeamTier($team->abbreviation);

        foreach ($positions as $posIndex => $position) {
            $isStarter = $posIndex < 5;
            $overallRange = $this->getOverallRange($teamTier, $isStarter, $posIndex);
            $overall = rand($overallRange[0], $overallRange[1]);
            $potential = min(99, $overall + rand(-5, 15));

            $age = $this->generateAge($overall);
            $attributes = $this->generateAttributes($position, $overall);
            $tendencies = $this->generateTendencies($position);
            $badges = $this->generateBadges($position, $overall);
            $personality = $this->generatePersonality();
            $contract = $this->generateContract($overall, $age);

            // Generate unique name
            $firstName = $this->firstNames[($teamIndex * 15 + $posIndex) % count($this->firstNames)];
            $lastName = $this->lastNames[($teamIndex * 15 + $posIndex + 7) % count($this->lastNames)];

            Player::create([
                'campaign_id' => $campaignId,
                'team_id' => $team->id,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'position' => $position,
                'secondary_position' => $this->getSecondaryPosition($position),
                'jersey_number' => $jerseyNumbers[$posIndex],
                'height_inches' => $this->getHeight($position),
                'weight_lbs' => $this->getWeight($position),
                'birth_date' => now()->subYears($age)->subDays(rand(0, 365)),
                'overall_rating' => $overall,
                'potential_rating' => $potential,
                'attributes' => $attributes,
                'tendencies' => $tendencies,
                'badges' => $badges,
                'personality' => $personality,
                'contract_years_remaining' => $contract['years'],
                'contract_salary' => $contract['salary'],
                'contract_details' => $contract['details'],
                'is_injured' => false,
                'fatigue' => 0,
            ]);
        }

        // Update team payroll
        $totalPayroll = Player::where('team_id', $team->id)->sum('contract_salary');
        $team->update(['total_payroll' => $totalPayroll]);
    }

    private function getTeamTier(string $abbreviation): int
    {
        // Tier 1: Contenders, Tier 2: Playoff teams, Tier 3: Average, Tier 4: Rebuilding
        $tiers = [
            1 => ['BOS', 'MIL', 'DEN', 'PHX', 'GSW', 'LAL', 'MIA'],
            2 => ['PHI', 'CLE', 'BKN', 'MEM', 'DAL', 'LAC', 'MIN', 'NOP', 'SAC'],
            3 => ['ATL', 'TOR', 'CHI', 'IND', 'OKC', 'POR', 'UTA', 'NYK'],
            4 => ['CHA', 'DET', 'ORL', 'WAS', 'HOU', 'SAS'],
        ];

        foreach ($tiers as $tier => $teams) {
            if (in_array($abbreviation, $teams)) {
                return $tier;
            }
        }
        return 3;
    }

    private function getOverallRange(int $tier, bool $isStarter, int $posIndex): array
    {
        if ($isStarter) {
            return match ($tier) {
                1 => $posIndex === 0 ? [85, 95] : [78, 88],
                2 => $posIndex === 0 ? [80, 88] : [75, 84],
                3 => $posIndex === 0 ? [76, 84] : [72, 80],
                4 => $posIndex === 0 ? [72, 80] : [68, 76],
                default => [70, 80],
            };
        }

        return match ($tier) {
            1 => [72, 80],
            2 => [68, 77],
            3 => [65, 74],
            4 => [62, 72],
            default => [65, 75],
        };
    }

    private function generateAge(int $overall): int
    {
        // Higher overall players tend to be in prime years (25-31)
        if ($overall >= 85) {
            return rand(25, 32);
        } elseif ($overall >= 78) {
            return rand(23, 30);
        } elseif ($overall >= 72) {
            return rand(21, 28);
        }
        return rand(19, 26);
    }

    private function generateAttributes(string $position, int $overall): array
    {
        $variance = 12;
        $base = $overall;

        $offense = $this->generateOffenseAttributes($position, $base, $variance);
        $defense = $this->generateDefenseAttributes($position, $base, $variance);
        $physical = $this->generatePhysicalAttributes($position, $base, $variance);
        $mental = $this->generateMentalAttributes($base, $variance);

        return [
            'offense' => $offense,
            'defense' => $defense,
            'physical' => $physical,
            'mental' => $mental,
        ];
    }

    private function generateOffenseAttributes(string $position, int $base, int $variance): array
    {
        $positionMods = [
            'PG' => ['threePoint' => 5, 'midRange' => 5, 'postScoring' => -20, 'layup' => 3, 'dunk' => -5, 'ballHandling' => 10, 'passing' => 10, 'speedWithBall' => 8],
            'SG' => ['threePoint' => 8, 'midRange' => 8, 'postScoring' => -15, 'layup' => 5, 'dunk' => 0, 'ballHandling' => 5, 'passing' => 3, 'speedWithBall' => 5],
            'SF' => ['threePoint' => 3, 'midRange' => 5, 'postScoring' => -5, 'layup' => 5, 'dunk' => 3, 'ballHandling' => 0, 'passing' => 0, 'speedWithBall' => 0],
            'PF' => ['threePoint' => -5, 'midRange' => 0, 'postScoring' => 8, 'layup' => 5, 'dunk' => 8, 'ballHandling' => -10, 'passing' => -5, 'speedWithBall' => -8],
            'C' => ['threePoint' => -15, 'midRange' => -10, 'postScoring' => 12, 'layup' => 8, 'dunk' => 10, 'ballHandling' => -15, 'passing' => -8, 'speedWithBall' => -12],
        ];

        $mods = $positionMods[$position];

        return [
            'threePoint' => $this->clampRating($base + $mods['threePoint'] + rand(-$variance, $variance)),
            'midRange' => $this->clampRating($base + $mods['midRange'] + rand(-$variance, $variance)),
            'postScoring' => $this->clampRating($base + $mods['postScoring'] + rand(-$variance, $variance)),
            'layup' => $this->clampRating($base + $mods['layup'] + rand(-$variance, $variance)),
            'dunk' => $this->clampRating($base + $mods['dunk'] + rand(-$variance, $variance)),
            'ballHandling' => $this->clampRating($base + $mods['ballHandling'] + rand(-$variance, $variance)),
            'passing' => $this->clampRating($base + $mods['passing'] + rand(-$variance, $variance)),
            'speedWithBall' => $this->clampRating($base + $mods['speedWithBall'] + rand(-$variance, $variance)),
        ];
    }

    private function generateDefenseAttributes(string $position, int $base, int $variance): array
    {
        $positionMods = [
            'PG' => ['perimeterD' => 5, 'interiorD' => -15, 'steal' => 8, 'block' => -20, 'defensiveIQ' => 5],
            'SG' => ['perimeterD' => 5, 'interiorD' => -10, 'steal' => 5, 'block' => -15, 'defensiveIQ' => 3],
            'SF' => ['perimeterD' => 3, 'interiorD' => 0, 'steal' => 3, 'block' => 0, 'defensiveIQ' => 3],
            'PF' => ['perimeterD' => -5, 'interiorD' => 8, 'steal' => -3, 'block' => 8, 'defensiveIQ' => 3],
            'C' => ['perimeterD' => -12, 'interiorD' => 12, 'steal' => -8, 'block' => 15, 'defensiveIQ' => 5],
        ];

        $mods = $positionMods[$position];

        return [
            'perimeterD' => $this->clampRating($base + $mods['perimeterD'] + rand(-$variance, $variance)),
            'interiorD' => $this->clampRating($base + $mods['interiorD'] + rand(-$variance, $variance)),
            'steal' => $this->clampRating($base + $mods['steal'] + rand(-$variance, $variance)),
            'block' => $this->clampRating($base + $mods['block'] + rand(-$variance, $variance)),
            'defensiveIQ' => $this->clampRating($base + $mods['defensiveIQ'] + rand(-$variance, $variance)),
        ];
    }

    private function generatePhysicalAttributes(string $position, int $base, int $variance): array
    {
        $positionMods = [
            'PG' => ['speed' => 10, 'acceleration' => 10, 'strength' => -15, 'vertical' => 0, 'stamina' => 5],
            'SG' => ['speed' => 8, 'acceleration' => 8, 'strength' => -8, 'vertical' => 3, 'stamina' => 3],
            'SF' => ['speed' => 3, 'acceleration' => 3, 'strength' => 0, 'vertical' => 3, 'stamina' => 0],
            'PF' => ['speed' => -5, 'acceleration' => -5, 'strength' => 8, 'vertical' => 5, 'stamina' => 0],
            'C' => ['speed' => -12, 'acceleration' => -12, 'strength' => 15, 'vertical' => -3, 'stamina' => -3],
        ];

        $mods = $positionMods[$position];

        return [
            'speed' => $this->clampRating($base + $mods['speed'] + rand(-$variance, $variance)),
            'acceleration' => $this->clampRating($base + $mods['acceleration'] + rand(-$variance, $variance)),
            'strength' => $this->clampRating($base + $mods['strength'] + rand(-$variance, $variance)),
            'vertical' => $this->clampRating($base + $mods['vertical'] + rand(-$variance, $variance)),
            'stamina' => $this->clampRating($base + $mods['stamina'] + rand(-$variance, $variance)),
        ];
    }

    private function generateMentalAttributes(int $base, int $variance): array
    {
        return [
            'basketballIQ' => $this->clampRating($base + rand(-$variance, $variance)),
            'consistency' => $this->clampRating($base + rand(-$variance, $variance)),
            'clutch' => $this->clampRating($base + rand(-$variance, $variance)),
            'workEthic' => $this->clampRating(rand(60, 95)),
        ];
    }

    private function generateTendencies(string $position): array
    {
        $positionTendencies = [
            'PG' => ['threePoint' => 0.35, 'midRange' => 0.25, 'paint' => 0.40],
            'SG' => ['threePoint' => 0.45, 'midRange' => 0.25, 'paint' => 0.30],
            'SF' => ['threePoint' => 0.35, 'midRange' => 0.30, 'paint' => 0.35],
            'PF' => ['threePoint' => 0.25, 'midRange' => 0.25, 'paint' => 0.50],
            'C' => ['threePoint' => 0.10, 'midRange' => 0.20, 'paint' => 0.70],
        ];

        $base = $positionTendencies[$position];
        $variance = 0.10;

        return [
            'shotSelection' => [
                'threePoint' => max(0.05, min(0.60, $base['threePoint'] + (rand(-10, 10) / 100))),
                'midRange' => max(0.10, min(0.45, $base['midRange'] + (rand(-10, 10) / 100))),
                'paint' => max(0.20, min(0.80, $base['paint'] + (rand(-10, 10) / 100))),
            ],
            'defensiveAggression' => rand(40, 90) / 100,
            'passingWillingness' => rand(30, 80) / 100,
            'helpDefenseFrequency' => rand(40, 80) / 100,
        ];
    }

    private function generateBadges(string $position, int $overall): array
    {
        $availableBadges = $this->badgesByPosition[$position];
        $numBadges = match (true) {
            $overall >= 90 => rand(8, 12),
            $overall >= 85 => rand(6, 10),
            $overall >= 80 => rand(5, 8),
            $overall >= 75 => rand(4, 7),
            $overall >= 70 => rand(3, 5),
            default => rand(1, 4),
        };

        $badges = [];
        $selectedBadges = array_rand(array_flip($availableBadges), min($numBadges, count($availableBadges)));
        if (!is_array($selectedBadges)) {
            $selectedBadges = [$selectedBadges];
        }

        foreach ($selectedBadges as $badgeId) {
            $level = $this->getBadgeLevel($overall);
            $badges[] = ['id' => $badgeId, 'level' => $level];
        }

        return $badges;
    }

    private function getBadgeLevel(int $overall): string
    {
        $roll = rand(1, 100);
        if ($overall >= 90) {
            if ($roll <= 20) return 'hof';
            if ($roll <= 50) return 'gold';
            if ($roll <= 80) return 'silver';
            return 'bronze';
        } elseif ($overall >= 82) {
            if ($roll <= 10) return 'hof';
            if ($roll <= 35) return 'gold';
            if ($roll <= 70) return 'silver';
            return 'bronze';
        } elseif ($overall >= 75) {
            if ($roll <= 5) return 'gold';
            if ($roll <= 40) return 'silver';
            return 'bronze';
        }
        if ($roll <= 20) return 'silver';
        return 'bronze';
    }

    private function generatePersonality(): array
    {
        $allTraits = ['team_player', 'ball_hog', 'mentor', 'hot_head', 'media_darling', 'quiet', 'leader', 'joker', 'competitor'];
        $numTraits = rand(1, 3);
        $traits = array_slice($allTraits, rand(0, count($allTraits) - $numTraits), $numTraits);

        return [
            'traits' => array_values($traits),
            'morale' => rand(70, 95),
            'chemistry' => rand(65, 90),
            'mediaProfile' => ['low_key', 'normal', 'high_profile'][rand(0, 2)],
        ];
    }

    private function generateContract(int $overall, int $age): array
    {
        $yearsRemaining = rand(1, 4);
        $salary = $this->calculateSalary($overall, $age);

        $salaries = [];
        for ($i = 0; $i < $yearsRemaining + 1; $i++) {
            $salaries[] = round($salary * (1 + 0.05 * $i), -4);
        }

        return [
            'years' => $yearsRemaining,
            'salary' => $salary,
            'details' => [
                'totalYears' => $yearsRemaining + rand(0, 2),
                'salaries' => $salaries,
                'options' => rand(0, 1) ? ['year' . ($yearsRemaining + 1) => rand(0, 1) ? 'player' : 'team'] : [],
                'noTradeClause' => $overall >= 88 && rand(0, 1),
                'signedYear' => 2024 - rand(0, 3),
            ],
        ];
    }

    private function calculateSalary(int $overall, int $age): int
    {
        $baseSalary = match (true) {
            $overall >= 92 => rand(40000000, 50000000),
            $overall >= 88 => rand(30000000, 42000000),
            $overall >= 84 => rand(20000000, 32000000),
            $overall >= 80 => rand(12000000, 22000000),
            $overall >= 76 => rand(6000000, 14000000),
            $overall >= 72 => rand(3000000, 8000000),
            $overall >= 68 => rand(1500000, 4000000),
            default => rand(900000, 2000000),
        };

        // Age adjustment
        if ($age >= 33) {
            $baseSalary = (int) ($baseSalary * 0.85);
        } elseif ($age <= 23) {
            $baseSalary = (int) ($baseSalary * 0.7);
        }

        return (int) round($baseSalary, -4);
    }

    private function getSecondaryPosition(string $position): ?string
    {
        $options = [
            'PG' => ['SG', null],
            'SG' => ['PG', 'SF', null],
            'SF' => ['SG', 'PF', null],
            'PF' => ['SF', 'C', null],
            'C' => ['PF', null],
        ];

        return $options[$position][array_rand($options[$position])];
    }

    private function getHeight(string $position): int
    {
        return match ($position) {
            'PG' => rand(72, 76),   // 6'0" - 6'4"
            'SG' => rand(74, 78),   // 6'2" - 6'6"
            'SF' => rand(77, 81),   // 6'5" - 6'9"
            'PF' => rand(79, 83),   // 6'7" - 6'11"
            'C' => rand(82, 88),    // 6'10" - 7'4"
            default => rand(76, 80),
        };
    }

    private function getWeight(string $position): int
    {
        return match ($position) {
            'PG' => rand(175, 200),
            'SG' => rand(185, 215),
            'SF' => rand(210, 235),
            'PF' => rand(225, 250),
            'C' => rand(240, 280),
            default => rand(200, 230),
        };
    }

    private function getJerseyNumbers(): array
    {
        $numbers = range(0, 99);
        shuffle($numbers);
        return array_slice($numbers, 0, 15);
    }

    private function clampRating(int $rating): int
    {
        return max(25, min(99, $rating));
    }
}
