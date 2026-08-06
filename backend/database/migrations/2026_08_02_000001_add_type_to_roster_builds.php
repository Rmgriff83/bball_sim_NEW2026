<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Community builds gain a content type: 'roster' (full league builds, the
// only kind that existed before this column) and 'draft_class' (rookie-only
// classes). Defaulting to 'roster' makes every pre-existing row a roster
// build, and the controller maps an ABSENT ?type= param to 'roster' — so old
// app versions keep seeing exactly the board they saw before.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('roster_builds', function (Blueprint $table) {
            $table->string('type', 20)->default('roster')->after('user_id');
            $table->index(['type', 'status', 'created_at']);
            $table->index(['type', 'status', 'downloads']);
        });
    }

    public function down(): void
    {
        Schema::table('roster_builds', function (Blueprint $table) {
            $table->dropIndex(['type', 'status', 'created_at']);
            $table->dropIndex(['type', 'status', 'downloads']);
            $table->dropColumn('type');
        });
    }
};
