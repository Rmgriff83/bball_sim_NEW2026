<?php

namespace Database\Seeders;

use App\Models\Campaign;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * Run with: php artisan db:seed
     * For test campaign: php artisan db:seed --class=DatabaseSeeder
     */
    public function run(): void
    {
        // ═══════════════════════════════════════════════════════════
        // STATIC REFERENCE DATA (Always seeded)
        // ═══════════════════════════════════════════════════════════

        $this->call([
            BadgeDefinitionSeeder::class,
            BadgeSynergySeeder::class,
            AchievementSeeder::class,
        ]);

        $this->command->info('Static reference data seeded successfully!');

        // ═══════════════════════════════════════════════════════════
        // TEST USER & CAMPAIGN (For development/testing)
        // ═══════════════════════════════════════════════════════════

        // Create test user
        $user = User::firstOrCreate(
            ['email' => 'test@example.com'],
            [
                'username' => 'TestPlayer',
                'password' => Hash::make('password'),
                'email_verified_at' => now(),
                'settings' => ['theme' => 'dark', 'simSpeed' => 'normal'],
            ]
        );

        $this->command->info("Test user created: {$user->email}");

        // Create test campaign for the user (team_id set to null initially)
        $campaign = Campaign::create([
            'user_id' => $user->id,
            'name' => 'Test Dynasty',
            'current_date' => '2025-10-21', // Start of NBA season
            'game_year' => 1,
            'difficulty' => 'pro',
            'settings' => [
                'autoSave' => true,
                'injuryFrequency' => 'normal',
                'tradeFrequency' => 'normal',
            ],
            'last_played_at' => now(),
        ]);

        $this->command->info("Test campaign created: {$campaign->name}");

        // Seed teams, coaches, and players for this campaign
        $this->command->info('Seeding teams...');
        $this->seedCampaignData($campaign->id);

        // Update campaign with the first team as user's team
        $firstTeam = \App\Models\Team::where('campaign_id', $campaign->id)->first();
        if ($firstTeam) {
            $campaign->update(['team_id' => $firstTeam->id]);
        }

        // Create initial season
        $season = \App\Models\Season::create([
            'campaign_id' => $campaign->id,
            'year' => 2025,
            'phase' => 'regular',
            'standings' => $this->generateInitialStandings($campaign->id),
        ]);

        $campaign->update(['current_season_id' => $season->id]);

        $this->command->info('Test campaign fully seeded with teams, coaches, and players!');
        $this->command->info('');
        $this->command->info('═══════════════════════════════════════════════════════════');
        $this->command->info('  Database seeding complete!');
        $this->command->info('  Test login: test@example.com / password');
        $this->command->info('═══════════════════════════════════════════════════════════');
    }

    /**
     * Seed teams, coaches, and players for a campaign
     */
    private function seedCampaignData(int $campaignId): void
    {
        $teamSeeder = new TeamSeeder();
        $teamSeeder->campaignId = $campaignId;
        $teamSeeder->run();

        $this->command->info('Seeding coaches...');
        $coachSeeder = new CoachSeeder();
        $coachSeeder->campaignId = $campaignId;
        $coachSeeder->run();

        $this->command->info('Seeding players...');
        $playerSeeder = new PlayerSeeder();
        $playerSeeder->campaignId = $campaignId;
        $playerSeeder->run();
    }

    /**
     * Generate initial standings with all teams at 0-0
     */
    private function generateInitialStandings(int $campaignId): array
    {
        $teams = \App\Models\Team::where('campaign_id', $campaignId)->get();

        $east = [];
        $west = [];

        foreach ($teams as $team) {
            $teamStanding = [
                'teamId' => $team->id,
                'wins' => 0,
                'losses' => 0,
                'streak' => null,
                'last10' => '0-0',
                'homeRecord' => '0-0',
                'awayRecord' => '0-0',
            ];

            if ($team->conference === 'east') {
                $east[] = $teamStanding;
            } else {
                $west[] = $teamStanding;
            }
        }

        return [
            'east' => $east,
            'west' => $west,
        ];
    }
}
