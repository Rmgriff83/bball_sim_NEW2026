<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('revenuecat_webhook_events', function (Blueprint $table) {
            // RevenueCat event id is the primary key — duplicate deliveries
            // hit the unique constraint and short-circuit (mirrors the
            // stripe_webhook_events idempotency pattern).
            $table->string('id')->primary();
            $table->string('type');
            $table->timestamp('processed_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('revenuecat_webhook_events');
    }
};
