<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaigns', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('client_id', 36)->nullable()->unique();
            $table->string('name', 100);
            $table->date('current_date');
            $table->enum('difficulty', ['rookie', 'pro', 'all_star', 'hall_of_fame'])->default('pro');
            $table->json('settings')->nullable();
            $table->timestamp('last_played_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'last_played_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('campaigns');
    }
};
