<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     * Converts coaching_scheme from a string (offensive style only) to a JSON object
     * with both offensive and defensive styles.
     */
    public function up(): void
    {
        // First, get all existing coaching schemes
        $teams = DB::table('teams')->select('id', 'coaching_scheme')->get();

        // Change column type to JSON
        Schema::table('teams', function (Blueprint $table) {
            $table->json('coaching_scheme_new')->nullable()->after('coaching_scheme');
        });

        // Convert existing string values to JSON objects
        foreach ($teams as $team) {
            $oldScheme = $team->coaching_scheme ?? 'balanced';
            $newScheme = json_encode([
                'offensive' => $oldScheme,
                'defensive' => 'man', // Default defensive scheme
            ]);

            DB::table('teams')
                ->where('id', $team->id)
                ->update(['coaching_scheme_new' => $newScheme]);
        }

        // Drop old column and rename new one
        Schema::table('teams', function (Blueprint $table) {
            $table->dropColumn('coaching_scheme');
        });

        Schema::table('teams', function (Blueprint $table) {
            $table->renameColumn('coaching_scheme_new', 'coaching_scheme');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Get all existing coaching schemes
        $teams = DB::table('teams')->select('id', 'coaching_scheme')->get();

        // Add back the string column
        Schema::table('teams', function (Blueprint $table) {
            $table->string('coaching_scheme_old')->default('balanced')->after('coaching_scheme');
        });

        // Convert JSON back to string (take offensive value)
        foreach ($teams as $team) {
            $scheme = json_decode($team->coaching_scheme, true);
            $offensive = $scheme['offensive'] ?? 'balanced';

            DB::table('teams')
                ->where('id', $team->id)
                ->update(['coaching_scheme_old' => $offensive]);
        }

        // Drop JSON column and rename old one back
        Schema::table('teams', function (Blueprint $table) {
            $table->dropColumn('coaching_scheme');
        });

        Schema::table('teams', function (Blueprint $table) {
            $table->renameColumn('coaching_scheme_old', 'coaching_scheme');
        });
    }
};
