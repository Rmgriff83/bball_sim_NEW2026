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
        Schema::table('coaches', function (Blueprint $table) {
            // Career regular season stats
            $table->unsignedInteger('career_wins')->default(0)->after('contract_salary');
            $table->unsignedInteger('career_losses')->default(0)->after('career_wins');

            // Career playoff stats
            $table->unsignedInteger('playoff_wins')->default(0)->after('career_losses');
            $table->unsignedInteger('playoff_losses')->default(0)->after('playoff_wins');

            // Achievements
            $table->unsignedSmallInteger('championships')->default(0)->after('playoff_losses');
            $table->unsignedSmallInteger('conference_titles')->default(0)->after('championships');
            $table->unsignedSmallInteger('coach_of_year_awards')->default(0)->after('conference_titles');

            // Season tracking
            $table->unsignedSmallInteger('seasons_coached')->default(0)->after('coach_of_year_awards');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('coaches', function (Blueprint $table) {
            $table->dropColumn([
                'career_wins',
                'career_losses',
                'playoff_wins',
                'playoff_losses',
                'championships',
                'conference_titles',
                'coach_of_year_awards',
                'seasons_coached',
            ]);
        });
    }
};
