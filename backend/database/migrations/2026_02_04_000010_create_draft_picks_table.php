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
        Schema::create('draft_picks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();

            $table->unsignedBigInteger('original_team_id');
            $table->unsignedBigInteger('current_owner_id');

            $table->unsignedInteger('year');
            $table->unsignedTinyInteger('round');

            // After draft lottery / draft
            $table->unsignedTinyInteger('pick_number')->nullable();
            $table->foreignId('player_id')->nullable()->constrained()->nullOnDelete();

            // Trade tracking
            $table->boolean('is_traded')->default(false);
            $table->json('trade_conditions')->nullable();

            $table->timestamps();

            $table->index(['current_owner_id', 'year']);

            $table->foreign('original_team_id')->references('id')->on('teams')->cascadeOnDelete();
            $table->foreign('current_owner_id')->references('id')->on('teams')->cascadeOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('draft_picks');
    }
};
