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
        Schema::create('coaches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('team_id')->nullable()->constrained()->nullOnDelete();

            $table->string('first_name', 50);
            $table->string('last_name', 50);

            // Ratings
            $table->unsignedTinyInteger('overall_rating');
            $table->json('attributes');

            // Schemes
            $table->enum('offensive_scheme', [
                'motion', 'iso_heavy', 'pick_and_roll', 'post_up', 'pace_and_space', 'princeton'
            ]);
            $table->enum('defensive_scheme', [
                'man_to_man', 'zone_2_3', 'zone_3_2', 'switch_everything', 'drop_coverage'
            ]);

            // Contract
            $table->unsignedTinyInteger('contract_years_remaining')->default(0);
            $table->decimal('contract_salary', 12, 2)->default(0);

            $table->timestamps();

            $table->index('campaign_id');
            $table->index(['campaign_id', 'team_id', 'overall_rating']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('coaches');
    }
};
