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
            // Season tracking
            $table->integer('games_played_this_season')->default(0)->after('fatigue');
            $table->integer('minutes_played_this_season')->default(0)->after('games_played_this_season');

            // Development tracking
            $table->json('development_history')->nullable()->after('minutes_played_this_season');
            $table->json('streak_data')->nullable()->after('development_history');

            // Career tracking
            $table->integer('career_seasons')->default(0)->after('streak_data');
            $table->boolean('is_retired')->default(false)->after('career_seasons');

            // Performance tracking for micro-development
            $table->json('recent_performances')->nullable()->after('is_retired');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('players', function (Blueprint $table) {
            $table->dropColumn([
                'games_played_this_season',
                'minutes_played_this_season',
                'development_history',
                'streak_data',
                'career_seasons',
                'is_retired',
                'recent_performances',
            ]);
        });
    }
};
