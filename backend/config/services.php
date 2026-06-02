<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'stripe' => [
        'secret' => env('STRIPE_SECRET'),
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),
        'checkout_success_url' => env('STRIPE_CHECKOUT_SUCCESS_URL'),
        'checkout_cancel_url' => env('STRIPE_CHECKOUT_CANCEL_URL'),

        // Bundle catalog — authoritative source for what each bundle id grants.
        // The webhook looks up the matched price id here to decide what to
        // credit, so frontend-supplied amounts can never grant extras.
        // Two shapes are supported:
        //   - tokens (int)        → consumable; calls profile->creditTokens()
        //   - unlocks (string[])  → one-time non-consumable feature unlocks;
        //                            calls profile->setUnlock() for each
        // A bundle may set both; the webhook applies whichever are present.
        'bundles' => [
            'tokens_1000' => [
                'price_id' => env('STRIPE_PRICE_TOKENS_1000'),
                'tokens' => 1000,
            ],
            'tokens_6500' => [
                'price_id' => env('STRIPE_PRICE_TOKENS_6500'),
                'tokens' => 6500,
            ],
            'headshot_editor_unlock' => [
                'price_id' => env('STRIPE_PRICE_HEADSHOT_EDITOR_UNLOCK'),
                'tokens' => 0,
                'unlocks' => ['headshot_editor'],
            ],
        ],
    ],

    // iOS In-App Purchase (RevenueCat).
    'iap' => [
        // Shared secret RC sends as the Authorization header on webhook deliveries.
        // Configured in RC dashboard → Project Settings → Integrations → Webhooks.
        'webhook_auth' => env('REVENUECAT_WEBHOOK_AUTH'),

        // Bundle catalog keyed by App Store product id. Same dual shape as
        // stripe.bundles: tokens credit consumables, unlocks grant one-time
        // non-consumable feature flags on the user profile.
        'bundles' => [
            'tokens_1000' => ['tokens' => 1000],
            'tokens_6500' => ['tokens' => 6500],
            'headshot_editor_unlock' => [
                'tokens' => 0,
                'unlocks' => ['headshot_editor'],
            ],
        ],
    ],

];
