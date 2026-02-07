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
        // Player Season Stats (Aggregated - kept forever)
        Schema::create('player_season_stats', function (Blueprint $table) {
            $table->id();
            $table->foreignId('player_id')->constrained()->cascadeOnDelete();
            $table->foreignId('season_id')->constrained()->cascadeOnDelete();
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();

            // Counting stats
            $table->unsignedSmallInteger('games_played')->default(0);
            $table->unsignedSmallInteger('games_started')->default(0);
            $table->unsignedInteger('minutes_played')->default(0);

            // Per-game stats stored as totals
            $table->unsignedInteger('points')->default(0);
            $table->unsignedInteger('rebounds')->default(0);
            $table->unsignedInteger('offensive_rebounds')->default(0);
            $table->unsignedInteger('defensive_rebounds')->default(0);
            $table->unsignedInteger('assists')->default(0);
            $table->unsignedInteger('steals')->default(0);
            $table->unsignedInteger('blocks')->default(0);
            $table->unsignedInteger('turnovers')->default(0);
            $table->unsignedInteger('personal_fouls')->default(0);

            // Shooting
            $table->unsignedInteger('field_goals_made')->default(0);
            $table->unsignedInteger('field_goals_attempted')->default(0);
            $table->unsignedInteger('three_pointers_made')->default(0);
            $table->unsignedInteger('three_pointers_attempted')->default(0);
            $table->unsignedInteger('free_throws_made')->default(0);
            $table->unsignedInteger('free_throws_attempted')->default(0);

            // Advanced (calculated at end of season)
            $table->decimal('player_efficiency_rating', 5, 2)->nullable();
            $table->decimal('true_shooting_pct', 5, 4)->nullable();
            $table->decimal('usage_rate', 5, 4)->nullable();
            $table->decimal('win_shares', 5, 2)->nullable();

            $table->timestamps();

            $table->unique(['player_id', 'season_id']);
            $table->index(['season_id', 'points']);
        });

        // Team Season Stats (Aggregated - kept forever)
        Schema::create('team_season_stats', function (Blueprint $table) {
            $table->id();
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();
            $table->foreignId('season_id')->constrained()->cascadeOnDelete();

            $table->unsignedSmallInteger('wins')->default(0);
            $table->unsignedSmallInteger('losses')->default(0);
            $table->unsignedSmallInteger('home_wins')->default(0);
            $table->unsignedSmallInteger('home_losses')->default(0);

            // Offensive totals
            $table->unsignedInteger('points_scored')->default(0);
            $table->unsignedInteger('points_allowed')->default(0);

            // Playoff results
            $table->unsignedTinyInteger('playoff_seed')->nullable();
            $table->enum('playoff_result', [
                'missed', 'first_round', 'second_round', 'conf_finals', 'finals', 'champion'
            ])->nullable();

            $table->timestamps();

            $table->unique(['team_id', 'season_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('team_season_stats');
        Schema::dropIfExists('player_season_stats');
    }
};
