<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('campaigns', function (Blueprint $table) {
            $table->enum('draft_mode', ['standard', 'fantasy'])->default('standard')->after('difficulty');
            $table->boolean('draft_completed')->default(true)->after('draft_mode');
        });
    }

    public function down(): void
    {
        Schema::table('campaigns', function (Blueprint $table) {
            $table->dropColumn(['draft_mode', 'draft_completed']);
        });
    }
};
