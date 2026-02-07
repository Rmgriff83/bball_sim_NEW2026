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
        Schema::create('campaigns', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->unsignedBigInteger('team_id')->nullable(); // Set after teams created
            $table->unsignedBigInteger('current_season_id')->nullable(); // Set after seasons created
            $table->date('current_date');
            $table->unsignedInteger('game_year')->default(1);
            $table->enum('difficulty', ['rookie', 'pro', 'all_star', 'hall_of_fame'])->default('pro');
            $table->json('settings')->nullable();
            $table->timestamp('last_played_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'last_played_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('campaigns');
    }
};
