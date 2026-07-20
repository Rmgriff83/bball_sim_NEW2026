<?php

namespace App\Http\Controllers;

/**
 * Public, unauthenticated endpoint powering the native "update available" nag.
 * Returns the latest shipped build number per platform (see config/appversion.php).
 * Invokable (not a route closure) so `php artisan route:cache` keeps working.
 */
class AppVersionController extends Controller
{
    public function __invoke()
    {
        return response()->json([
            'android' => ['latestBuild' => (int) config('appversion.android.latest_build')],
            'ios' => ['latestBuild' => (int) config('appversion.ios.latest_build')],
        ]);
    }
}
