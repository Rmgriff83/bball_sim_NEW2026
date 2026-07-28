<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Stamps the source campaign's client UUID on each published build so the
// report-notice email (and support work generally) can trace a flagged build
// back to the campaign snapshot it was assembled from. Nullable: rows
// published before this column existed simply have no value.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('roster_builds', function (Blueprint $table) {
            $table->string('campaign_client_id', 64)->nullable()->after('user_id');
        });
    }

    public function down(): void
    {
        Schema::table('roster_builds', function (Blueprint $table) {
            $table->dropColumn('campaign_client_id');
        });
    }
};
