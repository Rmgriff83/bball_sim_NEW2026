<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Community roster builds (Roster Editor IAP Part B): published builds,
// per-user download attachments ("My Downloads"), and abuse reports.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('roster_builds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 100);
            $table->text('description')->nullable();
            // S3 key inside the roster_builds disk — always server-generated
            // (rosters/{uuid}.json.gz), never derived from client input.
            $table->string('s3_key');
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->unsignedInteger('player_count')->default(0);
            $table->unsignedInteger('downloads')->default(0);
            $table->string('status', 16)->default('active'); // active | removed
            $table->unsignedInteger('report_count')->default(0);
            $table->timestamps();
            $table->index(['status', 'created_at']);
            $table->index(['status', 'downloads']);
        });

        Schema::create('roster_build_downloads', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('roster_build_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['user_id', 'roster_build_id']);
        });

        Schema::create('roster_build_reports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('roster_build_id')->constrained()->cascadeOnDelete();
            $table->string('reason', 500)->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'roster_build_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('roster_build_reports');
        Schema::dropIfExists('roster_build_downloads');
        Schema::dropIfExists('roster_builds');
    }
};
