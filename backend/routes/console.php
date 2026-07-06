<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Hard-delete campaigns soft-deleted >30 days ago (row + S3 files).
// Requires the standard `schedule:run` cron entry on the server.
Schedule::command('campaigns:prune-deleted')->daily();
