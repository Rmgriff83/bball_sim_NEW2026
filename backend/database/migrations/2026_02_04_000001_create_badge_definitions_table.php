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
        Schema::create('badge_definitions', function (Blueprint $table) {
            $table->string('id', 50)->primary();
            $table->string('name', 100);
            $table->enum('category', ['finishing', 'shooting', 'playmaking', 'defense', 'physical']);
            $table->text('description');
            $table->json('effects');
            $table->string('icon_url', 500)->nullable();
        });

        Schema::create('badge_synergies', function (Blueprint $table) {
            $table->id();
            $table->string('badge1_id', 50);
            $table->string('badge2_id', 50);
            $table->string('synergy_name', 100);
            $table->text('description');
            $table->json('effect');
            $table->enum('min_level1', ['bronze', 'silver', 'gold', 'hof'])->default('bronze');
            $table->enum('min_level2', ['bronze', 'silver', 'gold', 'hof'])->default('bronze');

            $table->foreign('badge1_id')->references('id')->on('badge_definitions');
            $table->foreign('badge2_id')->references('id')->on('badge_definitions');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('badge_synergies');
        Schema::dropIfExists('badge_definitions');
    }
};
