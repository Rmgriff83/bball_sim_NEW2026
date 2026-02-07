<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('players', function (Blueprint $table) {
            // Career counting stats (totals across all seasons)
            $table->unsignedInteger('career_games_played')->default(0)->after('injury_details');
            $table->unsignedInteger('career_games_started')->default(0)->after('career_games_played');
            $table->unsignedInteger('career_minutes')->default(0)->after('career_games_started');
            $table->unsignedInteger('career_points')->default(0)->after('career_minutes');
            $table->unsignedInteger('career_rebounds')->default(0)->after('career_points');
            $table->unsignedInteger('career_assists')->default(0)->after('career_rebounds');
            $table->unsignedInteger('career_steals')->default(0)->after('career_assists');
            $table->unsignedInteger('career_blocks')->default(0)->after('career_steals');
            $table->unsignedInteger('career_turnovers')->default(0)->after('career_blocks');

            // Career shooting totals
            $table->unsignedInteger('career_fgm')->default(0)->after('career_turnovers');
            $table->unsignedInteger('career_fga')->default(0)->after('career_fgm');
            $table->unsignedInteger('career_fg3m')->default(0)->after('career_fga');
            $table->unsignedInteger('career_fg3a')->default(0)->after('career_fg3m');
            $table->unsignedInteger('career_ftm')->default(0)->after('career_fg3a');
            $table->unsignedInteger('career_fta')->default(0)->after('career_ftm');

            // Achievements
            $table->unsignedSmallInteger('championships')->default(0)->after('career_fta');
            $table->unsignedSmallInteger('all_star_selections')->default(0)->after('championships');
            $table->unsignedSmallInteger('mvp_awards')->default(0)->after('all_star_selections');
            $table->unsignedSmallInteger('finals_mvp_awards')->default(0)->after('mvp_awards');

            // Season tracking
            $table->unsignedSmallInteger('seasons_played')->default(0)->after('finals_mvp_awards');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('players', function (Blueprint $table) {
            $table->dropColumn([
                'career_games_played',
                'career_games_started',
                'career_minutes',
                'career_points',
                'career_rebounds',
                'career_assists',
                'career_steals',
                'career_blocks',
                'career_turnovers',
                'career_fgm',
                'career_fga',
                'career_fg3m',
                'career_fg3a',
                'career_ftm',
                'career_fta',
                'championships',
                'all_star_selections',
                'mvp_awards',
                'finals_mvp_awards',
                'seasons_played',
            ]);
        });
    }
};
