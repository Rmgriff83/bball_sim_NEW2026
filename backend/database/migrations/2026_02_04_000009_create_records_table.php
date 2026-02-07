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
        Schema::create('records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();

            $table->enum('record_type', ['single_game', 'season', 'career', 'franchise']);
            $table->string('category', 50);
            $table->decimal('record_value', 10, 2);

            // Who holds the record
            $table->foreignId('player_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('team_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('season_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('game_id')->nullable()->constrained()->nullOnDelete();

            $table->string('description', 255)->nullable();
            $table->date('achieved_date');

            $table->timestamp('created_at')->useCurrent();

            $table->index(['campaign_id', 'record_type', 'category']);
        });

        Schema::create('hall_of_fame', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('player_id')->constrained()->cascadeOnDelete();

            $table->json('career_stats');
            $table->unsignedInteger('induction_year');
            $table->timestamp('inducted_at')->useCurrent();

            $table->unique(['campaign_id', 'player_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('hall_of_fame');
        Schema::dropIfExists('records');
    }
};
