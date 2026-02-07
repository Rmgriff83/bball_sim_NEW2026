<?php

namespace Database\Seeders;

use App\Models\Team;
use Illuminate\Database\Seeder;

class TeamSeeder extends Seeder
{
    public int $campaignId = 1;

    public function run(): void
    {
        $campaignId = $this->campaignId;

        $teams = [
            // ═══════════════════════════════════════════════════════════
            // EASTERN CONFERENCE - ATLANTIC DIVISION
            // ═══════════════════════════════════════════════════════════
            [
                'name' => 'Boston Seltics',
                'city' => 'Boston',
                'abbreviation' => 'BOS',
                'conference' => 'east',
                'division' => 'Atlantic',
                'primary_color' => '#007A33',
                'secondary_color' => '#BA9653',
                'facilities' => ['training' => 4, 'medical' => 4, 'scouting' => 3, 'analytics' => 4],
            ],
            [
                'name' => 'Brooklyn Netts',
                'city' => 'Brooklyn',
                'abbreviation' => 'BKN',
                'conference' => 'east',
                'division' => 'Atlantic',
                'primary_color' => '#000000',
                'secondary_color' => '#FFFFFF',
                'facilities' => ['training' => 4, 'medical' => 4, 'scouting' => 3, 'analytics' => 5],
            ],
            [
                'name' => 'New York Bricks',
                'city' => 'New York',
                'abbreviation' => 'NYK',
                'conference' => 'east',
                'division' => 'Atlantic',
                'primary_color' => '#006BB6',
                'secondary_color' => '#F58426',
                'facilities' => ['training' => 3, 'medical' => 4, 'scouting' => 3, 'analytics' => 3],
            ],
            [
                'name' => 'Philadelphia 67ers',
                'city' => 'Philadelphia',
                'abbreviation' => 'PHI',
                'conference' => 'east',
                'division' => 'Atlantic',
                'primary_color' => '#006BB6',
                'secondary_color' => '#ED174C',
                'facilities' => ['training' => 4, 'medical' => 3, 'scouting' => 4, 'analytics' => 4],
            ],
            [
                'name' => 'Toronto Velociraptors',
                'city' => 'Toronto',
                'abbreviation' => 'TOR',
                'conference' => 'east',
                'division' => 'Atlantic',
                'primary_color' => '#CE1141',
                'secondary_color' => '#000000',
                'facilities' => ['training' => 3, 'medical' => 3, 'scouting' => 4, 'analytics' => 4],
            ],

            // ═══════════════════════════════════════════════════════════
            // EASTERN CONFERENCE - CENTRAL DIVISION
            // ═══════════════════════════════════════════════════════════
            [
                'name' => 'Chicago Bullies',
                'city' => 'Chicago',
                'abbreviation' => 'CHI',
                'conference' => 'east',
                'division' => 'Central',
                'primary_color' => '#CE1141',
                'secondary_color' => '#000000',
                'facilities' => ['training' => 3, 'medical' => 3, 'scouting' => 3, 'analytics' => 3],
            ],
            [
                'name' => 'Cleveland Cavemen',
                'city' => 'Cleveland',
                'abbreviation' => 'CLE',
                'conference' => 'east',
                'division' => 'Central',
                'primary_color' => '#6F263D',
                'secondary_color' => '#FFB81C',
                'facilities' => ['training' => 4, 'medical' => 3, 'scouting' => 3, 'analytics' => 4],
            ],
            [
                'name' => 'Detroit Pistons',
                'city' => 'Detroit',
                'abbreviation' => 'DET',
                'conference' => 'east',
                'division' => 'Central',
                'primary_color' => '#C8102E',
                'secondary_color' => '#1D42BA',
                'facilities' => ['training' => 2, 'medical' => 3, 'scouting' => 3, 'analytics' => 2],
            ],
            [
                'name' => 'Indiana Racers',
                'city' => 'Indiana',
                'abbreviation' => 'IND',
                'conference' => 'east',
                'division' => 'Central',
                'primary_color' => '#002D62',
                'secondary_color' => '#FDBB30',
                'facilities' => ['training' => 3, 'medical' => 3, 'scouting' => 3, 'analytics' => 3],
            ],
            [
                'name' => 'Milwaukee Ducks',
                'city' => 'Milwaukee',
                'abbreviation' => 'MIL',
                'conference' => 'east',
                'division' => 'Central',
                'primary_color' => '#00471B',
                'secondary_color' => '#EEE1C6',
                'facilities' => ['training' => 4, 'medical' => 4, 'scouting' => 3, 'analytics' => 4],
            ],

            // ═══════════════════════════════════════════════════════════
            // EASTERN CONFERENCE - SOUTHEAST DIVISION
            // ═══════════════════════════════════════════════════════════
            [
                'name' => 'Atlanta Falcons',
                'city' => 'Atlanta',
                'abbreviation' => 'ATL',
                'conference' => 'east',
                'division' => 'Southeast',
                'primary_color' => '#E03A3E',
                'secondary_color' => '#C1D32F',
                'facilities' => ['training' => 3, 'medical' => 3, 'scouting' => 3, 'analytics' => 3],
            ],
            [
                'name' => 'Charlotte Stingers',
                'city' => 'Charlotte',
                'abbreviation' => 'CHA',
                'conference' => 'east',
                'division' => 'Southeast',
                'primary_color' => '#1D1160',
                'secondary_color' => '#00788C',
                'facilities' => ['training' => 2, 'medical' => 3, 'scouting' => 3, 'analytics' => 2],
            ],
            [
                'name' => 'Miami Warm',
                'city' => 'Miami',
                'abbreviation' => 'MIA',
                'conference' => 'east',
                'division' => 'Southeast',
                'primary_color' => '#98002E',
                'secondary_color' => '#F9A01B',
                'facilities' => ['training' => 5, 'medical' => 5, 'scouting' => 4, 'analytics' => 4],
            ],
            [
                'name' => 'Orlando Tragic',
                'city' => 'Orlando',
                'abbreviation' => 'ORL',
                'conference' => 'east',
                'division' => 'Southeast',
                'primary_color' => '#0077C0',
                'secondary_color' => '#C4CED4',
                'facilities' => ['training' => 3, 'medical' => 3, 'scouting' => 4, 'analytics' => 3],
            ],
            [
                'name' => 'Washington Lizards',
                'city' => 'Washington',
                'abbreviation' => 'WAS',
                'conference' => 'east',
                'division' => 'Southeast',
                'primary_color' => '#002B5C',
                'secondary_color' => '#E31837',
                'facilities' => ['training' => 2, 'medical' => 3, 'scouting' => 2, 'analytics' => 2],
            ],

            // ═══════════════════════════════════════════════════════════
            // WESTERN CONFERENCE - NORTHWEST DIVISION
            // ═══════════════════════════════════════════════════════════
            [
                'name' => 'Denver Chunks',
                'city' => 'Denver',
                'abbreviation' => 'DEN',
                'conference' => 'west',
                'division' => 'Northwest',
                'primary_color' => '#0E2240',
                'secondary_color' => '#FEC524',
                'facilities' => ['training' => 4, 'medical' => 4, 'scouting' => 4, 'analytics' => 4],
            ],
            [
                'name' => 'Minnesota Timberpups',
                'city' => 'Minnesota',
                'abbreviation' => 'MIN',
                'conference' => 'west',
                'division' => 'Northwest',
                'primary_color' => '#0C2340',
                'secondary_color' => '#236192',
                'facilities' => ['training' => 3, 'medical' => 3, 'scouting' => 3, 'analytics' => 3],
            ],
            [
                'name' => 'Oklahoma City Blunder',
                'city' => 'Oklahoma City',
                'abbreviation' => 'OKC',
                'conference' => 'west',
                'division' => 'Northwest',
                'primary_color' => '#007AC1',
                'secondary_color' => '#EF3B24',
                'facilities' => ['training' => 4, 'medical' => 3, 'scouting' => 5, 'analytics' => 5],
            ],
            [
                'name' => 'Portland Trail Losers',
                'city' => 'Portland',
                'abbreviation' => 'POR',
                'conference' => 'west',
                'division' => 'Northwest',
                'primary_color' => '#E03A3E',
                'secondary_color' => '#000000',
                'facilities' => ['training' => 2, 'medical' => 3, 'scouting' => 3, 'analytics' => 2],
            ],
            [
                'name' => 'Utah Jizz',
                'city' => 'Utah',
                'abbreviation' => 'UTA',
                'conference' => 'west',
                'division' => 'Northwest',
                'primary_color' => '#002B5C',
                'secondary_color' => '#00471B',
                'facilities' => ['training' => 3, 'medical' => 3, 'scouting' => 4, 'analytics' => 3],
            ],

            // ═══════════════════════════════════════════════════════════
            // WESTERN CONFERENCE - PACIFIC DIVISION
            // ═══════════════════════════════════════════════════════════
            [
                'name' => 'Golden State Worriers',
                'city' => 'San Francisco',
                'abbreviation' => 'GSW',
                'conference' => 'west',
                'division' => 'Pacific',
                'primary_color' => '#1D428A',
                'secondary_color' => '#FFC72C',
                'facilities' => ['training' => 5, 'medical' => 5, 'scouting' => 4, 'analytics' => 5],
            ],
            [
                'name' => 'Los Angeles Fakers',
                'city' => 'Los Angeles',
                'abbreviation' => 'LAL',
                'conference' => 'west',
                'division' => 'Pacific',
                'primary_color' => '#552583',
                'secondary_color' => '#FDB927',
                'facilities' => ['training' => 5, 'medical' => 5, 'scouting' => 4, 'analytics' => 4],
            ],
            [
                'name' => 'Los Angeles Snippers',
                'city' => 'Los Angeles',
                'abbreviation' => 'LAC',
                'conference' => 'west',
                'division' => 'Pacific',
                'primary_color' => '#C8102E',
                'secondary_color' => '#1D428A',
                'facilities' => ['training' => 4, 'medical' => 4, 'scouting' => 3, 'analytics' => 4],
            ],
            [
                'name' => 'Phoenix Buns',
                'city' => 'Phoenix',
                'abbreviation' => 'PHX',
                'conference' => 'west',
                'division' => 'Pacific',
                'primary_color' => '#1D1160',
                'secondary_color' => '#E56020',
                'facilities' => ['training' => 4, 'medical' => 4, 'scouting' => 3, 'analytics' => 4],
            ],
            [
                'name' => 'Sacramento Monarchs',
                'city' => 'Sacramento',
                'abbreviation' => 'SAC',
                'conference' => 'west',
                'division' => 'Pacific',
                'primary_color' => '#5A2D81',
                'secondary_color' => '#63727A',
                'facilities' => ['training' => 3, 'medical' => 3, 'scouting' => 3, 'analytics' => 3],
            ],

            // ═══════════════════════════════════════════════════════════
            // WESTERN CONFERENCE - SOUTHWEST DIVISION
            // ═══════════════════════════════════════════════════════════
            [
                'name' => 'Dallas Mavericks',
                'city' => 'Dallas',
                'abbreviation' => 'DAL',
                'conference' => 'west',
                'division' => 'Southwest',
                'primary_color' => '#00538C',
                'secondary_color' => '#002B5E',
                'facilities' => ['training' => 4, 'medical' => 4, 'scouting' => 4, 'analytics' => 5],
            ],
            [
                'name' => 'HoustonOckets',
                'city' => 'Houston',
                'abbreviation' => 'HOU',
                'conference' => 'west',
                'division' => 'Southwest',
                'primary_color' => '#CE1141',
                'secondary_color' => '#000000',
                'facilities' => ['training' => 3, 'medical' => 3, 'scouting' => 4, 'analytics' => 4],
            ],
            [
                'name' => 'Memphis Grindlies',
                'city' => 'Memphis',
                'abbreviation' => 'MEM',
                'conference' => 'west',
                'division' => 'Southwest',
                'primary_color' => '#5D76A9',
                'secondary_color' => '#12173F',
                'facilities' => ['training' => 3, 'medical' => 4, 'scouting' => 3, 'analytics' => 3],
            ],
            [
                'name' => 'New Orleans Parrots',
                'city' => 'New Orleans',
                'abbreviation' => 'NOP',
                'conference' => 'west',
                'division' => 'Southwest',
                'primary_color' => '#0C2340',
                'secondary_color' => '#C8102E',
                'facilities' => ['training' => 3, 'medical' => 4, 'scouting' => 3, 'analytics' => 3],
            ],
            [
                'name' => 'San Antonio Spurts',
                'city' => 'San Antonio',
                'abbreviation' => 'SAS',
                'conference' => 'west',
                'division' => 'Southwest',
                'primary_color' => '#C4CED4',
                'secondary_color' => '#000000',
                'facilities' => ['training' => 4, 'medical' => 4, 'scouting' => 5, 'analytics' => 4],
            ],
        ];

        foreach ($teams as $team) {
            Team::create(array_merge($team, [
                'campaign_id' => $campaignId,
                'salary_cap' => 136000000,
                'total_payroll' => 0,
                'luxury_tax_bill' => 0,
            ]));
        }
    }
}
