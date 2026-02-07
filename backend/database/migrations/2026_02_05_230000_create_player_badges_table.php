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
        Schema::create('player_badges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('player_id')->constrained()->cascadeOnDelete();
            $table->string('badge_definition_id', 50);
            $table->enum('level', ['bronze', 'silver', 'gold', 'hof']);
            $table->timestamps();

            $table->foreign('badge_definition_id')
                ->references('id')
                ->on('badge_definitions')
                ->cascadeOnDelete();

            $table->unique(['player_id', 'badge_definition_id'], 'unique_player_badge');
            $table->index('badge_definition_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('player_badges');
    }
};
