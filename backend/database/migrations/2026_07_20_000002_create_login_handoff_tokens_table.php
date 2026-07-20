<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// One-time app→web login handoff nonces. The nonce itself is never stored —
// only its sha256 hash. Rows are single-use (used_at claim) with a short TTL,
// and pruned opportunistically on mint.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('login_handoff_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('token_hash', 64)->unique();
            $table->string('return_to', 500)->nullable();
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('login_handoff_tokens');
    }
};
