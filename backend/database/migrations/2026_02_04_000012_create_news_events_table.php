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
        Schema::create('news_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();

            $table->enum('event_type', [
                'trade', 'injury', 'milestone', 'contract', 'drama', 'award', 'retirement', 'general',
                'recovery', 'hot_streak', 'cold_streak', 'development', 'breakout', 'decline', 'trade_request', 'game_winner'
            ]);
            $table->string('headline', 255);
            $table->text('body')->nullable();

            // Related entities
            $table->foreignId('player_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('team_id')->nullable()->constrained()->nullOnDelete();

            $table->date('game_date');
            $table->boolean('is_read')->default(false);

            $table->timestamp('created_at')->useCurrent();

            $table->index(['campaign_id', 'game_date']);
            $table->index(['campaign_id', 'is_read', 'game_date']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('news_events');
    }
};
