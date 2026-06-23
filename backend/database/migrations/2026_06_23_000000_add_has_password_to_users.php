<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Track whether a user has set a real password. Email/password users have
     * one (default true); accounts created purely via Sign in with Apple/Google
     * get a random throwaway password and are flagged false. Used to prevent
     * unlinking a user's only sign-in method and (later) to gate password-less
     * account deletion.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('has_password')->default(true)->after('password');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('has_password');
        });
    }
};
