<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add a global_admin boolean flag to the users table. Gates access to
     * the admin-only routes (e.g. /admin/headshots in the Vue app) and the
     * paired backend endpoints. Set manually via tinker — no UI for granting.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('global_admin')->default(false)->after('settings');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('global_admin');
        });
    }
};
