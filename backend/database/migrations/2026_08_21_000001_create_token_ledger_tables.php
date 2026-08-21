<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Offline token ledger (client queues token deltas while offline, flushes to
// POST /api/user/tokens/ledger when connectivity returns).
//
//  - token_ledger_batches: idempotency claims + stored results, mirroring the
//    payment-webhook events tables. The unique (user_id, batch_id) pair is the
//    claim (insertOrIgnore inside the credit transaction); `result` stores the
//    response summary so a lost-response retry replays the SAME outcome and
//    can never double-credit.
//  - user_token_earn_days: per-UTC-day earned counters backing the 5,000/day
//    ledger earn ceiling. Separate from the batches table so the O(1)
//    row-locked ceiling check never scans batches, and rows stay prunable
//    without touching the audit trail.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('token_ledger_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->uuid('batch_id');
            $table->integer('net')->default(0);
            $table->json('result')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'batch_id']);
        });

        Schema::create('user_token_earn_days', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('day');
            $table->unsignedInteger('earned')->default(0);
            $table->timestamps();
            $table->unique(['user_id', 'day']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_token_earn_days');
        Schema::dropIfExists('token_ledger_batches');
    }
};
