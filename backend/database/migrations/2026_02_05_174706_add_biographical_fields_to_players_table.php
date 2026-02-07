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
        Schema::table('players', function (Blueprint $table) {
            $table->string('country')->nullable()->after('birth_date');
            $table->string('college')->nullable()->after('country');
            $table->integer('draft_year')->nullable()->after('college');
            $table->integer('draft_round')->nullable()->after('draft_year');
            $table->integer('draft_pick')->nullable()->after('draft_round');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('players', function (Blueprint $table) {
            $table->dropColumn(['country', 'college', 'draft_year', 'draft_round', 'draft_pick']);
        });
    }
};
