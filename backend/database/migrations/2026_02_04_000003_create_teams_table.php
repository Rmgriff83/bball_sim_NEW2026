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
        Schema::create('teams', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->string('city', 100);
            $table->string('abbreviation', 5);
            $table->enum('conference', ['east', 'west']);
            $table->string('division', 50);

            // Financials
            $table->decimal('salary_cap', 12, 2)->default(136000000);
            $table->decimal('total_payroll', 12, 2)->default(0);
            $table->decimal('luxury_tax_bill', 12, 2)->default(0);

            // Facilities
            $table->json('facilities')->nullable();

            // Visual identity
            $table->string('primary_color', 7)->default('#000000');
            $table->string('secondary_color', 7)->default('#FFFFFF');
            $table->string('logo_url', 500)->nullable();

            $table->timestamps();

            $table->index('campaign_id');
            $table->index(['campaign_id', 'conference', 'division']);
        });

        // Add foreign key to campaigns after teams table exists
        Schema::table('campaigns', function (Blueprint $table) {
            $table->foreign('team_id')->references('id')->on('teams')->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('campaigns', function (Blueprint $table) {
            $table->dropForeign(['team_id']);
        });
        Schema::dropIfExists('teams');
    }
};
