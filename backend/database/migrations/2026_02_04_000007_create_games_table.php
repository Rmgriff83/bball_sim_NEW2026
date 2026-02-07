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
        Schema::create('games', function (Blueprint $table) {
            $table->id();
            $table->foreignId('season_id')->constrained()->cascadeOnDelete();
            $table->foreignId('home_team_id')->constrained('teams')->cascadeOnDelete();
            $table->foreignId('away_team_id')->constrained('teams')->cascadeOnDelete();

            $table->date('game_date');
            $table->boolean('is_playoff')->default(false);
            $table->unsignedTinyInteger('playoff_round')->nullable();
            $table->unsignedTinyInteger('playoff_game_number')->nullable();

            // Results (NULL if not yet played)
            $table->unsignedSmallInteger('home_score')->nullable();
            $table->unsignedSmallInteger('away_score')->nullable();
            $table->boolean('is_complete')->default(false);

            // Box score (stored as JSON, discarded after season)
            $table->json('box_score')->nullable();

            $table->timestamps();

            $table->index(['season_id', 'game_date']);
            $table->index(['season_id', 'home_team_id']);
            $table->index(['season_id', 'away_team_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('games');
    }
};
