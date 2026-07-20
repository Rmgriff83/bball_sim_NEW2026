<?php

/*
|--------------------------------------------------------------------------
| App version gate (in-app "update available" nag)
|--------------------------------------------------------------------------
| The latest shipped BUILD number per platform — Android versionCode and iOS
| CURRENT_PROJECT_VERSION. The native client compares its running build to
| these and shows a soft "update available" prompt when it's behind.
|
| BUMP THESE EACH RELEASE (via .env ANDROID_LATEST_BUILD / IOS_LATEST_BUILD,
| or edit the defaults below) to match the build you upload to the stores.
| Keep the marketing/version string out of this — build numbers are the
| monotonic per-platform integers that change every release.
*/

return [
    'android' => [
        'latest_build' => (int) env('ANDROID_LATEST_BUILD', 21),
    ],
    'ios' => [
        'latest_build' => (int) env('IOS_LATEST_BUILD', 7),
    ],
];
