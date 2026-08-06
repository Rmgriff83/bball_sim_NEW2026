<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Workshop campaigns are standalone Builder projects (roster or draft-class
// WIPs) that ride the normal campaign sync pipeline but are NOT playable
// campaigns. The flag is stamped server-side from the pushed meta part and
// lets listCampaigns exclude them by default — old app versions never learn
// they exist, so they can't render a teams-less workshop as a broken
// campaign or lose a campaign slot to one.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('campaigns', function (Blueprint $table) {
            $table->boolean('workshop')->default(false)->after('difficulty');
        });
    }

    public function down(): void
    {
        Schema::table('campaigns', function (Blueprint $table) {
            $table->dropColumn('workshop');
        });
    }
};
