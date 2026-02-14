<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('simulation_results', function (Blueprint $table) {
            $table->id();
            $table->string('batch_id')->index();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->string('game_id');
            $table->string('game_date');
            $table->unsignedBigInteger('home_team_id');
            $table->unsignedBigInteger('away_team_id');
            $table->smallInteger('home_score');
            $table->smallInteger('away_score');
            $table->string('home_conference', 10);
            $table->string('away_conference', 10);
            $table->json('box_score');
            $table->json('quarter_scores')->nullable();
            $table->boolean('is_user_game')->default(false);
            $table->boolean('is_playoff')->default(false);
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['batch_id', 'game_id']);
            $table->index(['batch_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('simulation_results');
    }
};
