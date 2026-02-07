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
        Schema::create('achievements', function (Blueprint $table) {
            $table->string('id', 50)->primary();
            $table->string('name', 100);
            $table->text('description');
            $table->enum('category', ['rookie', 'veteran', 'mastery', 'hidden']);
            $table->unsignedInteger('points')->default(10);
            $table->string('icon_url', 500)->nullable();
            $table->json('criteria');
            $table->boolean('hidden')->default(false);
            $table->timestamps();
        });

        Schema::create('user_achievements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('achievement_id', 50);
            $table->foreignId('campaign_id')->nullable();
            $table->timestamp('unlocked_at')->useCurrent();

            $table->unique(['user_id', 'achievement_id']);
            $table->foreign('achievement_id')->references('id')->on('achievements');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('user_achievements');
        Schema::dropIfExists('achievements');
    }
};
