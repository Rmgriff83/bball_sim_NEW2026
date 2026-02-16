<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            AchievementSeeder::class,
        ]);

        $this->command->info('Static reference data seeded successfully!');

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
        $this->command->info('');
        $this->command->info('Database seeding complete!');
        $this->command->info('Test login: test@example.com / password');
    }
}
