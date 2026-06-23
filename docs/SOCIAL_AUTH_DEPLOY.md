# Social Auth — production deploy checklist

Ships the backend `POST /api/auth/social/token` endpoint (Apple/Google one-tap) to
production. No DB migrations are involved. The iOS app built with `npm run build:ios`
talks to the **production** API, so this must be live before the Apple button works
on device/simulator.

> This repo has no CI/Dockerfile, so the steps below assume a manual SSH deploy of a
> Laravel app. Adapt the "pull latest code" step to however you ship (`git pull`,
> rsync, etc.).

---

## 0. Pre-deploy (already done locally — just confirm it's committed)
- [ ] `backend/composer.json` requires `firebase/php-jwt: ^6.4|^7.0` **and**
      `backend/composer.lock` is in sync (`composer validate` → "valid"). ✅ done
- [ ] New/changed backend files are committed:
      `routes/api.php`, `app/Http/Controllers/Auth/SocialAuthController.php`,
      `app/Services/SocialTokenVerifier.php`, `config/services.php`,
      `composer.json`, `composer.lock`.
- [ ] Frontend prod env has the Google web client id (`VITE_GOOGLE_WEB_CLIENT_ID`)
      — already set in `frontend/.env.production`.

## 1. Set backend env vars on the production server (`.env`)
Required for the **iOS Apple** flow (what you're testing now):
```
APPLE_APP_BUNDLE_ID=com.bballsim.app      # token aud for native iOS Apple sign-in
GOOGLE_WEB_CLIENT_ID=384957239257-6eb8r0bgrd9a8tcbbb3n8e362hcrfr78.apps.googleusercontent.com
```
Optional / later (leave blank until those flows exist):
```
APPLE_WEB_SERVICES_ID=        # only when web "Sign in with Apple" is wired
GOOGLE_IOS_CLIENT_ID=         # only for a future NATIVE Google flow (Android)
```
- [ ] Values added to the server `.env` **before** caching config (step 3).

## 2. Pull code + install deps (on the server)
```bash
cd /path/to/backend
git pull                              # or your deploy mechanism
composer install --no-dev --optimize-autoloader
```
- [ ] `vendor/firebase/php-jwt` is present after install.

## 3. Rebuild caches — this is what fixes the 405
A stale cached route table is exactly what produced
*"The POST method is not supported for api/auth/social/token"*.
```bash
php artisan config:clear && php artisan config:cache   # picks up new services.php + env
php artisan route:clear  && php artisan route:cache     # registers POST /auth/social/token
php artisan optimize                                    # optional: also caches events/views
```
- [ ] Order matters: env set (step 1) **then** `config:cache`.
- [ ] No migrations needed (`php artisan migrate --force` is a harmless no-op here).

## 4. Restart the app server
Restart PHP-FPM / your queue workers / Octane (whichever applies) so the new code
and caches are live, e.g. `sudo systemctl reload php8.2-fpm` (adjust to your setup).

## 5. Verify
```bash
# Route now exists → 422 (validation), NOT 405. Before deploy this returned 405.
curl -i -X POST https://api.bball-sim.com/api/auth/social/token \
  -H 'Accept: application/json' -H 'Content-Type: application/json' -d '{}'
# Expect: HTTP/1.1 422  (provider/credential required)

# Bogus token → 401 (verification failed), proving the verifier runs.
curl -i -X POST https://api.bball-sim.com/api/auth/social/token \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"provider":"apple","credential":"not-a-real-token"}'
# Expect: HTTP/1.1 401  Social authentication failed.
```
- [ ] 422 then 401 as above.
- [ ] In the iOS app: tap Sign in with Apple → completes → lands on dashboard.
- [ ] Watch `storage/logs/laravel.log` during a real attempt for any 500s.

## 6. Notes & gotchas
- **Outbound HTTPS required:** the server fetches Apple/Google JWKS
  (`appleid.apple.com/auth/keys`, `googleapis.com/oauth2/v3/certs`). Ensure egress
  isn't firewalled. JWKS is cached ~1 day via Laravel Cache (file cache is fine).
- **Email collision behavior:** an Apple-verified email matching an existing account
  auto-links + logs in (no password prompt). If you want the stricter "sign in then
  link" policy instead, change `resolveUserForSocial` before/after deploy (ask me).
- **Web app (`bball-sim.com`) is separate:** the Google button there needs that
  origin added to the Google OAuth client's Authorized JS origins; the Apple web
  button stays hidden/non-functional until `APPLE_WEB_SERVICES_ID` is set and the
  Services ID's domain + Return URL are configured.

## 7. Rollback
No schema changes, so rollback = redeploy the previous commit and rerun
`config:cache` + `route:cache`. The new route simply disappears; existing
email/password and the rest of the API are unaffected.
