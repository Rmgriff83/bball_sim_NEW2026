<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Campaign deletes become soft deletes so a user's cloud save can never be
 * irreversibly destroyed by a single API call. S3 part files are retained on
 * delete and pruned by campaigns:prune-deleted after a 30-day grace window.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('campaigns', function (Blueprint $table) {
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::table('campaigns', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });
    }
};
