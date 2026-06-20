<?php

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Build the password reset link against the SPA frontend so it lands
        // in the app's /reset-password route (which reads ?token= & ?email=),
        // not the API. The base is config-driven so it follows domain moves.
        ResetPassword::createUrlUsing(function ($notifiable, string $token) {
            $base = rtrim(config('app.frontend_url'), '/');
            $email = urlencode($notifiable->getEmailForPasswordReset());

            return "{$base}/reset-password?token={$token}&email={$email}";
        });
    }
}
