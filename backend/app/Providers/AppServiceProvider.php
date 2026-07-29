<?php

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Support\Facades\RateLimiter;
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
        // Override Laravel's DEFAULT 'api' limiter (60 req/min per user) —
        // the game client is legitimately chatty: a chunked sync push alone
        // can be dozens of requests in a burst, after which EVERY api call
        // (including unrelated taps like the community handoff mint) 429s
        // for the rest of the minute. 300/min per user keeps real abuse
        // bounded while never throttling normal play; sensitive endpoints
        // keep their own tighter per-route throttles (handoff 6/min,
        // publish 5/day, report 10/hr).
        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute(300)->by($request->user()?->getAuthIdentifier() ?: $request->ip());
        });

        // Build the password reset link against the SPA frontend so it lands
        // in the app's /reset-password route (which reads ?token= & ?email=),
        // not the API. The base is config-driven so it follows domain moves.
        ResetPassword::createUrlUsing(function ($notifiable, string $token) {
            $base = rtrim(config('app.frontend_url'), '/');
            $email = urlencode($notifiable->getEmailForPasswordReset());

            return "{$base}/reset-password?token={$token}&email={$email}";
        });

        // Branded copy for the reset email (the visual theme lives in
        // resources/views/vendor/mail). The URL builder above is reused via
        // ResetPassword::$createUrlCallback so both stay in sync.
        ResetPassword::toMailUsing(function ($notifiable, string $token) {
            $url = call_user_func(ResetPassword::$createUrlCallback, $notifiable, $token);
            $expireMinutes = config(
                'auth.passwords.' . config('auth.defaults.passwords') . '.expire',
                60
            );

            return (new MailMessage)
                ->subject('Reset your Bball Sim - Dynasty Basketball password')
                ->greeting('Hey GM,')
                ->line('Someone asked to reset the password for your account. Hit the button below to set a new one.')
                ->action('Reset Password', $url)
                ->line("This link expires in {$expireMinutes} minutes. If you didn't request a reset, you can safely ignore this email — your password won't change and your franchise is untouched.")
                ->salutation('See you courtside — The Bball Sim - Dynasty Basketball Team');
        });
    }
}
