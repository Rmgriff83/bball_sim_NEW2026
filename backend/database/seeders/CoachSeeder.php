<?php

namespace Database\Seeders;

use App\Models\Coach;
use App\Models\Team;
use Illuminate\Database\Seeder;

class CoachSeeder extends Seeder
{
    private array $firstNames = [
        'Greg', 'Steve', 'Mike', 'Erik', 'Joe', 'Tyronn', 'Doc', 'Nick', 'Taylor',
        'Ime', 'Billy', 'Quin', 'Michael', 'Rick', 'Jason', 'Monty', 'Chris',
        'Chauncey', 'Mark', 'Willie', 'Tom', 'JB', 'Jamahl', 'Darvin', 'Wes',
        'Frank', 'Nate', 'Charles', 'Terry', 'Dwane',
    ];

    private array $lastNames = [
        'Popovich', 'Kerr', 'Budenholzer', 'Spoelstra', 'Mazzulla', 'Lue', 'Rivers', 'Nurse', 'Jenkins',
        'Udoka', 'Donovan', 'Snyder', 'Malone', 'Carlisle', 'Kidd', 'Williams', 'Finch',
        'Billups', 'Daigneault', 'Green', 'Thibodeau', 'Bickerstaff', 'Mosley', 'Ham', 'Unseld',
        'Vogel', 'McMillan', 'Lee', 'Stotts', 'Casey',
    ];

    private array $offensiveSchemes = ['motion', 'iso_heavy', 'pick_and_roll', 'post_up', 'pace_and_space', 'princeton'];
    private array $defensiveSchemes = ['man_to_man', 'zone_2_3', 'zone_3_2', 'switch_everything', 'drop_coverage'];

    public int $campaignId = 1;

    public function run(): void
    {
        $campaignId = $this->campaignId;
        $teams = Team::where('campaign_id', $campaignId)->get();

        foreach ($teams as $index => $team) {
            $this->createCoachForTeam($team, $campaignId, $index);
        }

        // Create some free agent coaches
        $this->createFreeAgentCoaches($campaignId, count($teams));
    }

    private function createCoachForTeam(Team $team, int $campaignId, int $index): void
    {
        $teamTier = $this->getTeamTier($team->abbreviation);
        $overallRange = $this->getOverallRange($teamTier);
        $overall = rand($overallRange[0], $overallRange[1]);

        $attributes = $this->generateAttributes($overall);
        $offensiveScheme = $this->offensiveSchemes[array_rand($this->offensiveSchemes)];
        $defensiveScheme = $this->defensiveSchemes[array_rand($this->defensiveSchemes)];

        Coach::create([
            'campaign_id' => $campaignId,
            'team_id' => $team->id,
            'first_name' => $this->firstNames[$index % count($this->firstNames)],
            'last_name' => $this->lastNames[$index % count($this->lastNames)],
            'overall_rating' => $overall,
            'attributes' => $attributes,
            'offensive_scheme' => $offensiveScheme,
            'defensive_scheme' => $defensiveScheme,
            'contract_years_remaining' => rand(1, 4),
            'contract_salary' => $this->calculateSalary($overall),
        ]);
    }

    private function createFreeAgentCoaches(int $campaignId, int $startIndex): void
    {
        // Create 5 free agent coaches
        for ($i = 0; $i < 5; $i++) {
            $overall = rand(55, 72);
            $attributes = $this->generateAttributes($overall);

            Coach::create([
                'campaign_id' => $campaignId,
                'team_id' => null,
                'first_name' => $this->firstNames[($startIndex + $i) % count($this->firstNames)],
                'last_name' => $this->lastNames[($startIndex + $i + 5) % count($this->lastNames)],
                'overall_rating' => $overall,
                'attributes' => $attributes,
                'offensive_scheme' => $this->offensiveSchemes[array_rand($this->offensiveSchemes)],
                'defensive_scheme' => $this->defensiveSchemes[array_rand($this->defensiveSchemes)],
                'contract_years_remaining' => 0,
                'contract_salary' => 0,
            ]);
        }
    }

    private function getTeamTier(string $abbreviation): int
    {
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

    private function getOverallRange(int $tier): array
    {
        return match ($tier) {
            1 => [78, 92],
            2 => [72, 85],
            3 => [65, 78],
            4 => [58, 72],
            default => [65, 78],
        };
    }

    private function generateAttributes(int $overall): array
    {
        $variance = 10;

        return [
            'offensiveIQ' => $this->clampRating($overall + rand(-$variance, $variance)),
            'defensiveIQ' => $this->clampRating($overall + rand(-$variance, $variance)),
            'playerDevelopment' => $this->clampRating($overall + rand(-$variance, $variance)),
            'motivation' => $this->clampRating($overall + rand(-$variance, $variance)),
            'gameManagement' => $this->clampRating($overall + rand(-$variance, $variance)),
        ];
    }

    private function calculateSalary(int $overall): int
    {
        return match (true) {
            $overall >= 85 => rand(8000000, 12000000),
            $overall >= 78 => rand(5000000, 9000000),
            $overall >= 70 => rand(3000000, 6000000),
            $overall >= 62 => rand(1500000, 4000000),
            default => rand(800000, 2000000),
        };
    }

    private function clampRating(int $rating): int
    {
        return max(40, min(99, $rating));
    }
}
