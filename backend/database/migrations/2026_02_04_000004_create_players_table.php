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
        Schema::create('players', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('team_id')->nullable()->constrained()->nullOnDelete();

            // Identity
            $table->string('first_name', 50);
            $table->string('last_name', 50);
            $table->enum('position', ['PG', 'SG', 'SF', 'PF', 'C']);
            $table->enum('secondary_position', ['PG', 'SG', 'SF', 'PF', 'C'])->nullable();
            $table->unsignedTinyInteger('jersey_number')->nullable();

            // Physical
            $table->unsignedTinyInteger('height_inches');
            $table->unsignedSmallInteger('weight_lbs');
            $table->date('birth_date');

            // Ratings (denormalized for quick sorting/filtering)
            $table->unsignedTinyInteger('overall_rating');
            $table->unsignedTinyInteger('potential_rating');

            // JSON columns for flexible data
            $table->json('attributes');
            $table->json('tendencies');
            $table->json('badges')->nullable();
            $table->json('personality')->nullable();

            // Contract (denormalized for cap calculations)
            $table->unsignedTinyInteger('contract_years_remaining')->default(0);
            $table->decimal('contract_salary', 12, 2)->default(0);
            $table->json('contract_details')->nullable();

            // Status
            $table->boolean('is_injured')->default(false);
            $table->json('injury_details')->nullable();
            $table->unsignedTinyInteger('fatigue')->default(0);

            $table->timestamps();

            $table->index('campaign_id');
            $table->index('team_id');
            $table->index(['campaign_id', 'team_id', 'overall_rating']);
            $table->index(['campaign_id', 'position', 'overall_rating']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('players');
    }
};
