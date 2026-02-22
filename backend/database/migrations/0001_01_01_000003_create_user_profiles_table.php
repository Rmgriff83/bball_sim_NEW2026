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
        Schema::create('user_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->unsignedInteger('total_games')->default(0);
            $table->unsignedInteger('total_wins')->default(0);
            $table->unsignedInteger('championships')->default(0);
            $table->unsignedInteger('seasons_completed')->default(0);
            $table->unsignedInteger('play_time_minutes')->default(0);
            $table->unsignedInteger('player_level')->default(1);
            $table->unsignedInteger('experience_points')->default(0);
            $table->json('rewards')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('user_profiles');
    }
};
