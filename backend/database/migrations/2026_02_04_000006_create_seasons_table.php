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
        Schema::create('seasons', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('year');
            $table->enum('phase', [
                'preseason', 'regular', 'playoffs', 'offseason', 'draft', 'free_agency'
            ])->default('preseason');

            // Cached standings (updated after each game)
            $table->json('standings')->nullable();

            // Playoff bracket (populated when playoffs start)
            $table->json('playoff_bracket')->nullable();

            $table->boolean('is_archived')->default(false);
            $table->timestamps();

            $table->unique(['campaign_id', 'year']);
        });

        // Add foreign key to campaigns after seasons table exists
        Schema::table('campaigns', function (Blueprint $table) {
            $table->foreign('current_season_id')->references('id')->on('seasons')->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('campaigns', function (Blueprint $table) {
            $table->dropForeign(['current_season_id']);
        });
        Schema::dropIfExists('seasons');
    }
};
