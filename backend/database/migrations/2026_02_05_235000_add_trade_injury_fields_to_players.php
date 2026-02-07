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
            $table->decimal('trade_value', 8, 2)->nullable()->after('contract_details');
            $table->decimal('trade_value_total', 8, 2)->nullable()->after('trade_value');
            $table->enum('injury_risk', ['L', 'M', 'H'])->default('M')->after('trade_value_total');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('players', function (Blueprint $table) {
            $table->dropColumn(['trade_value', 'trade_value_total', 'injury_risk']);
        });
    }
};
