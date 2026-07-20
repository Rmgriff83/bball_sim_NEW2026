<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => rtrim(env('APP_URL', 'http://localhost'), '/').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

        // Second S3 disk for the admin-authored headshot asset bucket
        // (bball-sim-assets). Kept separate from the campaigns bucket above so
        // each can use its own IAM user / scope. Falls back to the shared
        // AWS_* credentials if the ASSETS_AWS_* keys aren't set, since the
        // same IAM user may have access to both buckets in some envs.
        'assets' => [
            'driver' => 's3',
            'key' => env('ASSETS_AWS_ACCESS_KEY_ID', env('AWS_ACCESS_KEY_ID')),
            'secret' => env('ASSETS_AWS_SECRET_ACCESS_KEY', env('AWS_SECRET_ACCESS_KEY')),
            'region' => env('ASSETS_AWS_DEFAULT_REGION', env('AWS_DEFAULT_REGION')),
            'bucket' => env('ASSETS_AWS_BUCKET'),
            'endpoint' => env('ASSETS_AWS_ENDPOINT', env('AWS_ENDPOINT')),
            'url' => env('ASSETS_AWS_URL'),
            'use_path_style_endpoint' => env('ASSETS_AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

        // Community roster builds bucket (Roster Editor IAP Part B). Private —
        // blobs are only ever streamed through authenticated, entitlement-
        // gated endpoints (no public ACLs / presigned URLs). Same separate-
        // bucket + fallback-credentials convention as `assets` above.
        'roster_builds' => [
            'driver' => 's3',
            'key' => env('ROSTER_BUILDS_AWS_ACCESS_KEY_ID', env('AWS_ACCESS_KEY_ID')),
            'secret' => env('ROSTER_BUILDS_AWS_SECRET_ACCESS_KEY', env('AWS_SECRET_ACCESS_KEY')),
            'region' => env('ROSTER_BUILDS_AWS_DEFAULT_REGION', env('AWS_DEFAULT_REGION')),
            'bucket' => env('ROSTER_BUILDS_AWS_BUCKET'),
            'endpoint' => env('ROSTER_BUILDS_AWS_ENDPOINT', env('AWS_ENDPOINT')),
            'url' => env('ROSTER_BUILDS_AWS_URL'),
            'use_path_style_endpoint' => env('ROSTER_BUILDS_AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
